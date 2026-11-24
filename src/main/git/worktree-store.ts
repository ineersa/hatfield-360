import { type FSWatcher, watch } from 'node:fs'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, normalize, resolve } from 'node:path'
import type { ProjectWorktrees, Worktree } from '../../shared/worktree-api'
import { GitError, runGit } from './git-command'
import { parseWorktreeList, shortBranchName } from './worktree-list'

type ChangeListener = (projects: ProjectWorktrees[]) => void

/** Git writes several files per command; list again once it is done. */
const REFRESH_DELAY_MS = 150

/** A watch on one folder, tied to the folder that existed then: a recreated folder needs a new one. */
type Watch = { watcher: FSWatcher; ino: number }

type Project = {
  folder: string
  state: ProjectWorktrees | null
  /** Watched folders by path: the project, the repository's git dir and its worktree records. */
  watchers: Map<string, Watch>
  /** The repository's common git dir as last known, kept while git can't read it so its repair is seen. */
  gitDir: string | null
  timer: NodeJS.Timeout | null
  /** Bumped per listing, so a slow older listing can't overwrite a newer one. */
  generation: number
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Git prints `C:/x` on Windows; the workspace keeps native paths. */
const nativePath = (path: string): string => normalize(path)

async function hasGitEntry(folder: string): Promise<boolean> {
  return lstat(join(folder, '.git')).then(
    () => true,
    () => false
  )
}

/** The git dir a `.git` entry points at, for a repository git can't read: the folder itself or a `gitdir:` file. */
async function gitDirOfEntry(folder: string): Promise<string | null> {
  const entry = join(folder, '.git')
  const info = await lstat(entry).catch(() => null)
  if (!info) return null
  if (info.isDirectory()) return entry
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(entry, 'utf8').catch(() => ''))
  return pointer?.[1] ? resolve(folder, pointer[1]) : null
}

async function readProject(
  folder: string
): Promise<{ state: ProjectWorktrees; gitDir: string | null }> {
  try {
    const [listing, commonDir, resolved] = await Promise.all([
      runGit(folder, ['worktree', 'list', '--porcelain', '-z']),
      runGit(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      // Git prints resolved paths; the workspace may hold the folder through a symlink.
      realpath(folder).catch(() => folder)
    ])
    const worktrees: Worktree[] = parseWorktreeList(listing)
      .filter((listed) => !listed.bare)
      .map((listed) => ({
        path: nativePath(listed.path),
        name: basename(nativePath(listed.path)),
        branch: listed.branch === null ? null : shortBranchName(listed.branch),
        head: listed.head,
        project: nativePath(listed.path) === nativePath(resolved),
        locked: listed.locked,
        prunable: listed.prunable
      }))
    return { state: { folder, status: 'git', worktrees }, gitDir: nativePath(commonDir.trim()) }
  } catch (error) {
    // A `.git` that git won't read is a broken repository, not a plain folder.
    if (error instanceof GitError && error.reason === 'not-git' && !(await hasGitEntry(folder))) {
      return { state: { folder, status: 'not-git' }, gitDir: null }
    }
    return { state: { folder, status: 'error', message: message(error) }, gitDir: null }
  }
}

/** Names in a watched folder whose change can't alter the worktree list. */
const isNoise = (name: string | null): boolean =>
  name !== null && (name.endsWith('.lock') || name === 'index' || name === 'FETCH_HEAD')

/** The git worktrees of each workspace project, listed again whenever git changes them. */
export class WorktreeStore {
  private readonly projects = new Map<string, Project>()
  private order: string[] = []
  private readonly listeners = new Set<ChangeListener>()

  onChange(listener: ChangeListener): void {
    this.listeners.add(listener)
  }

  view(): ProjectWorktrees[] {
    return this.order.flatMap((folder) => {
      const state = this.projects.get(folder)?.state
      return state ? [state] : []
    })
  }

  /** Follows the workspace's folders: new ones are listed and watched, removed ones dropped. */
  async setFolders(folders: string[]): Promise<void> {
    this.order = folders
    for (const [folder, project] of this.projects) {
      if (folders.includes(folder)) continue
      this.close(project)
      this.projects.delete(folder)
    }
    const added = folders.filter((folder) => !this.projects.has(folder))
    for (const folder of added) {
      this.projects.set(folder, {
        folder,
        state: null,
        watchers: new Map(),
        gitDir: null,
        timer: null,
        generation: 0
      })
    }
    await Promise.all(added.map((folder) => this.refresh(folder)))
    this.emit()
  }

  async pruneMissing(folder: string, path: string): Promise<void> {
    const project = this.projects.get(folder)
    if (!project) throw new Error('Project is not in the workspace')
    const { state } = await readProject(folder)
    const entry = state.status === 'git' && state.worktrees.find((tree) => tree.path === path)
    if (!entry || entry.project || entry.locked || !entry.prunable) {
      throw new Error('That worktree entry is no longer eligible for removal')
    }
    const absent = await lstat(entry.path).then(
      () => false,
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )
    if (!absent || this.projects.get(folder) !== project) {
      throw new Error('That worktree is no longer missing from this workspace project')
    }
    await runGit(folder, ['worktree', 'remove', '--', entry.path])
    if (await this.refresh(folder)) this.emit()
  }

  private async refresh(folder: string): Promise<boolean> {
    const project = this.projects.get(folder)
    if (!project) return false
    const generation = ++project.generation
    const { state, gitDir } = await readProject(folder)
    const current = (): boolean =>
      this.projects.get(folder) === project && generation === project.generation
    if (!current()) return false
    if (gitDir) project.gitDir = gitDir
    else if (state.status === 'not-git') project.gitDir = null
    // Broken: keep watching the git dir so a repair shows, found from `.git` if never read.
    else project.gitDir ??= await gitDirOfEntry(folder)
    const dirs = project.gitDir ? await this.gitDirs(project.gitDir) : []
    const wanted = await this.existing([project.folder, ...dirs])
    if (!current()) return false
    this.watch(project, wanted, new Set(dirs))
    const changed = JSON.stringify(state) !== JSON.stringify(project.state)
    project.state = state
    return changed
  }

  /** The git dir (main HEAD, `worktrees` appearing), its `worktrees` folder and each record (linked HEADs). */
  private async gitDirs(gitDir: string): Promise<string[]> {
    const records = join(gitDir, 'worktrees')
    const names = await readdir(records).catch(() => null)
    // Git deletes `worktrees` with the last linked worktree; the git dir's watch sees it come back.
    if (names === null) return [gitDir]
    return [gitDir, records, ...names.map((name) => join(records, name))]
  }

  /** Each folder that exists now, with its inode, so a folder deleted and made again is told apart. */
  private async existing(dirs: string[]): Promise<Map<string, number>> {
    const found = await Promise.all(
      dirs.map(
        async (dir) =>
          [
            dir,
            await stat(dir).then(
              (info) => info.ino,
              () => null
            )
          ] as const
      )
    )
    return new Map(found.flatMap(([dir, ino]) => (ino === null ? [] : [[dir, ino]])))
  }

  private watch(project: Project, wanted: Map<string, number>, gitDirs: Set<string>): void {
    for (const [dir, held] of project.watchers) {
      if (wanted.get(dir) === held.ino) continue
      held.watcher.close()
      project.watchers.delete(dir)
    }
    for (const [dir, ino] of wanted) {
      if (project.watchers.has(dir)) continue
      // The project folder alone only matters for `.git` (`git init`, a deleted `.git`); a bare
      // repository's folder is also its git dir, where every change counts.
      const onlyGitEntry = dir === project.folder && !gitDirs.has(dir)
      try {
        const watcher = watch(dir, (_event, name) => {
          if (onlyGitEntry ? name !== null && name !== '.git' : isNoise(name)) return
          this.schedule(project)
        })
        // A watched record folder disappears when its worktree is removed.
        watcher.on('error', () => {
          watcher.close()
          if (project.watchers.get(dir)?.watcher === watcher) project.watchers.delete(dir)
          this.schedule(project)
        })
        project.watchers.set(dir, { watcher, ino })
      } catch {
        // Gone between listing and watching; the next refresh sees that.
      }
    }
  }

  private schedule(project: Project): void {
    if (project.timer) clearTimeout(project.timer)
    project.timer = setTimeout(() => {
      project.timer = null
      void this.refresh(project.folder).then((changed) => {
        if (changed) this.emit()
      })
    }, REFRESH_DELAY_MS)
  }

  private close(project: Project): void {
    if (project.timer) clearTimeout(project.timer)
    for (const { watcher } of project.watchers.values()) watcher.close()
    project.watchers.clear()
  }

  private emit(): void {
    const projects = this.view()
    for (const listener of this.listeners) listener(projects)
  }
}

export const worktreeStore = new WorktreeStore()
