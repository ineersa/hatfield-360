import { type FSWatcher, watch } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { basename, join, normalize } from 'node:path'
import type { ProjectWorktrees, Worktree } from '../../shared/worktree-api'
import { GitError, runGit } from './git-command'
import { parseWorktreeList, shortBranchName } from './worktree-list'

type ChangeListener = (projects: ProjectWorktrees[]) => void

/** Git writes several files per command; list again once it is done. */
const REFRESH_DELAY_MS = 150

type Project = {
  folder: string
  state: ProjectWorktrees | null
  /** Watched folders by path: the project, the repository's git dir and its worktree records. */
  watchers: Map<string, FSWatcher>
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

async function readProject(
  folder: string
): Promise<{ state: ProjectWorktrees; gitDir: string | null }> {
  try {
    const [listing, commonDir] = await Promise.all([
      runGit(folder, ['worktree', 'list', '--porcelain', '-z']),
      runGit(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ])
    const worktrees: Worktree[] = parseWorktreeList(listing)
      .filter((listed) => !listed.bare)
      .map((listed, index) => ({
        path: nativePath(listed.path),
        name: basename(nativePath(listed.path)),
        branch: listed.branch === null ? null : shortBranchName(listed.branch),
        head: listed.head,
        main: index === 0,
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
class WorktreeStore {
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
        timer: null,
        generation: 0
      })
    }
    await Promise.all(added.map((folder) => this.refresh(folder)))
    this.emit()
  }

  private async refresh(folder: string): Promise<boolean> {
    const project = this.projects.get(folder)
    if (!project) return false
    const generation = ++project.generation
    const { state, gitDir } = await readProject(folder)
    if (this.projects.get(folder) !== project || generation !== project.generation) return false
    this.watch(project, gitDir ? await this.gitDirs(gitDir) : [])
    const changed = JSON.stringify(state) !== JSON.stringify(project.state)
    project.state = state
    return changed
  }

  /** The git dir (main HEAD, `worktrees` appearing), its `worktrees` folder and each record (linked HEADs). */
  private async gitDirs(gitDir: string): Promise<string[]> {
    const records = join(gitDir, 'worktrees')
    const names = await readdir(records).catch((): string[] => [])
    return [gitDir, records, ...names.map((name) => join(records, name))]
  }

  private watch(project: Project, gitDirs: string[]): void {
    // The project folder itself catches `git init` and a deleted `.git`.
    const wanted = new Set([project.folder, ...gitDirs])
    for (const [dir, watcher] of project.watchers) {
      if (wanted.has(dir)) continue
      watcher.close()
      project.watchers.delete(dir)
    }
    for (const dir of wanted) {
      if (project.watchers.has(dir)) continue
      try {
        const watcher = watch(dir, (_event, name) => {
          if (dir === project.folder ? name !== null && name !== '.git' : isNoise(name)) return
          this.schedule(project)
        })
        // A watched record folder disappears when its worktree is removed.
        watcher.on('error', () => {
          watcher.close()
          project.watchers.delete(dir)
          this.schedule(project)
        })
        project.watchers.set(dir, watcher)
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
    for (const watcher of project.watchers.values()) watcher.close()
    project.watchers.clear()
  }

  private emit(): void {
    const projects = this.view()
    for (const listener of this.listeners) listener(projects)
  }
}

export const worktreeStore = new WorktreeStore()
