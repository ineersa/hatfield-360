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

/** A workspace project, or a repository found directly inside a multi-repo project. */
type Project = {
  folder: string
  /** The multi-repo project this repository was found in; null for a workspace project. */
  parent: string | null
  multiRepo: boolean
  /** The repositories found directly inside a multi-repo project, by name. */
  children: string[]
  /** A multi-repo project's subfolders as last listed: a rename of one is a folder added or removed. */
  subfolders: Set<string>
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

/** A workspace folder git is asked about: a project, or a multi-repo folder whose children are. */
export type WatchedFolder = { path: string; multiRepo: boolean }

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Names in a watched folder whose change can't alter the worktree list. */
const isNoise = (name: string | null): boolean =>
  name !== null && (name.endsWith('.lock') || name === 'index' || name === 'FETCH_HEAD')

/** The git worktrees of each workspace project, listed again whenever git changes them. */
export class WorktreeStore {
  private readonly projects = new Map<string, Project>()
  private order: string[] = []
  private readonly listeners = new Set<ChangeListener>()

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  view(): ProjectWorktrees[] {
    return this.order.flatMap((folder) => {
      const project = this.projects.get(folder)
      if (!project?.state) return []
      if (!project.multiRepo) return [project.state]
      const repositories = project.children.flatMap((child) => {
        const state = this.projects.get(child)?.state
        return state && state.status !== 'not-git' ? [state] : []
      })
      return [{ ...project.state, repositories }]
    })
  }

  /** Follows the workspace's folders: new ones are listed and watched, removed ones dropped. */
  async setFolders(folders: WatchedFolder[]): Promise<void> {
    const paths = folders.map((folder) => folder.path)
    const projectsChanged = JSON.stringify(paths) !== JSON.stringify(this.order)
    this.order = paths
    const marked = new Map(folders.map((folder) => [folder.path, folder.multiRepo]))
    const refreshed: string[] = []
    for (const [folder, project] of this.projects) {
      const multiRepo = marked.get(folder)
      if (project.parent === null && multiRepo !== undefined) {
        // A marked folder looks again: a repository in it may have become a project, or stopped being one.
        if (project.multiRepo !== multiRepo || (multiRepo && projectsChanged))
          refreshed.push(folder)
        project.multiRepo = multiRepo
        continue
      }
      // A repository that became a workspace project of its own is listed there from now on.
      if (project.parent !== null && marked.get(project.parent) === true && !marked.has(folder))
        continue
      this.drop(project)
    }
    const added = this.order.filter((folder) => !this.projects.has(folder))
    for (const folder of added) {
      this.projects.set(folder, this.track(folder, null, marked.get(folder) === true))
    }
    await Promise.all([...added, ...refreshed].map((folder) => this.refresh(folder)))
    this.emit()
  }

  async pruneMissing(folder: string, path: string): Promise<void> {
    const project = this.projects.get(folder)
    if (!project || project.parent !== null) throw new Error('Project is not in the workspace')
    // The worktree belongs to the project's own repository or one inside a multi-repo project.
    const repository = [folder, ...project.children].find((each) => {
      const state = this.projects.get(each)?.state
      return state?.status === 'git' && state.worktrees.some((tree) => tree.path === path)
    })
    if (repository === undefined)
      throw new Error('That worktree entry is no longer eligible for removal')
    const { state } = await readProject(repository)
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
    await runGit(repository, ['worktree', 'remove', '--', entry.path])
    if (await this.refresh(repository)) this.emit()
  }

  /** Lists a repository's worktrees again now, as after a branch switch, without waiting for its watch. */
  async relist(folder: string): Promise<void> {
    if (await this.refresh(folder)) this.emit()
  }

  private track(folder: string, parent: string | null, multiRepo: boolean): Project {
    return {
      folder,
      parent,
      multiRepo,
      children: [],
      subfolders: new Set(),
      state: null,
      watchers: new Map(),
      gitDir: null,
      timer: null,
      generation: 0
    }
  }

  /** Stops following a project and the repositories found in it. */
  private drop(project: Project): void {
    for (const child of project.children) {
      const tracked = this.projects.get(child)
      if (tracked?.parent === project.folder) this.drop(tracked)
    }
    this.close(project)
    this.projects.delete(project.folder)
  }

  private async refresh(folder: string): Promise<boolean> {
    const project = this.projects.get(folder)
    if (!project) return false
    const generation = ++project.generation
    const [{ state, gitDir }, found] = await Promise.all([
      readProject(folder),
      project.multiRepo ? this.repositoriesIn(folder) : Promise.resolve([])
    ])
    const current = (): boolean =>
      this.projects.get(folder) === project && generation === project.generation
    if (!current()) return false
    if (gitDir) project.gitDir = gitDir
    else if (state.status === 'not-git') project.gitDir = null
    // Broken: keep watching the git dir so a repair shows, found from `.git` if never read.
    else project.gitDir ??= await gitDirOfEntry(folder)
    const dirs = project.gitDir ? await this.gitDirs(project.gitDir) : []
    // A multi-repo folder's other subfolders are watched for a `.git` (`git init`, a clone finishing).
    const plain = project.multiRepo ? await this.plainSubfolders(folder, found) : []
    const wanted = await this.existing([project.folder, ...dirs, ...plain])
    if (!current()) return false
    this.watch(project, wanted, new Set(dirs))
    const changed =
      JSON.stringify(state) !== JSON.stringify(project.state) ||
      JSON.stringify(found) !== JSON.stringify(project.children)
    // Saved before the new repositories are read, so a refresh started meanwhile still wins.
    project.state = state
    project.subfolders = new Set([...found, ...plain])
    const added = this.setChildren(project, found)
    await Promise.all(added.map((child) => this.refresh(child)))
    return changed
  }

  /** The repositories directly inside a folder, by name: each subfolder with a `.git` that isn't a workspace project. */
  private async repositoriesIn(folder: string): Promise<string[]> {
    const names = await readdir(folder).catch(() => [])
    const found = await Promise.all(
      names.map(async (name) => {
        const path = join(folder, name)
        return !this.order.includes(path) && (await hasGitEntry(path)) ? path : null
      })
    )
    return found
      .filter((path) => path !== null)
      .toSorted((a, b) => byName.compare(basename(a), basename(b)))
  }

  private async plainSubfolders(folder: string, repositories: string[]): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== '.git')
      .map((entry) => join(folder, entry.name))
      .filter((path) => !repositories.includes(path))
  }

  /** Follows the repositories now found in a multi-repo project; returns those new to it. */
  private setChildren(project: Project, found: string[]): string[] {
    for (const child of project.children) {
      const tracked = this.projects.get(child)
      if (!found.includes(child) && tracked?.parent === project.folder) this.drop(tracked)
    }
    project.children = found
    const added = found.filter((child) => !this.projects.has(child))
    for (const child of added) this.projects.set(child, this.track(child, project.folder, false))
    return added
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
      // Outside a git dir only `.git` counts, except a subfolder added to or removed from a multi-repo folder.
      const gitDir = gitDirs.has(dir)
      try {
        const watcher = watch(dir, (event, name) => {
          if (
            dir === project.folder &&
            project.multiRepo &&
            event === 'rename' &&
            name !== '.git'
          ) {
            this.subfolderRenamed(project, name)
            return
          }
          const onlyGitEntry = !gitDir && (dir === project.folder || project.multiRepo)
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

  /** Lists a multi-repo project again for a subfolder added or removed, not for a file (an atomic save). */
  private subfolderRenamed(project: Project, name: string | null): void {
    if (name === null || project.subfolders.has(join(project.folder, name))) {
      this.schedule(project)
      return
    }
    void stat(join(project.folder, name)).then(
      (info) => {
        if (info.isDirectory()) this.schedule(project)
      },
      () => undefined
    )
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
