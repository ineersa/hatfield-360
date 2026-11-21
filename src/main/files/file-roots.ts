import type { WorkspaceFolder } from '../../shared/workspace-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'
import { worktreeStore } from '../git/worktree-store'
import { workspaceStore } from '../workspace/workspace-store'

/** A folder main may read inside: a workspace folder or a project's linked worktree. */
export type FileRoot = {
  path: string
  /** Projects and worktrees get git's ignore status; plain folders don't. */
  git: boolean
}

type ChangeListener = () => void

function rootsOf(folders: WorkspaceFolder[], projects: ProjectWorktrees[]): FileRoot[] {
  const present = folders.filter((folder) => !folder.missing)
  const projectPaths = new Set(
    present.filter((folder) => folder.kind === 'project').map((folder) => folder.path)
  )
  const worktrees = projects.flatMap((project) =>
    project.status === 'git' && projectPaths.has(project.folder)
      ? project.worktrees
          .filter((worktree) => !worktree.project && !worktree.prunable)
          .map((worktree) => ({ path: worktree.path, git: true }))
      : []
  )
  return [
    ...present.map((folder) => ({ path: folder.path, git: folder.kind === 'project' })),
    ...worktrees
  ]
}

/** The roots of the open workspace, following its folders and their worktrees as they change. */
class FileRoots {
  private folders: WorkspaceFolder[] = []
  private projects: ProjectWorktrees[] = []
  private loaded: Promise<void> | null = null
  private readonly listeners = new Set<ChangeListener>()

  onChange(listener: ChangeListener): void {
    this.listeners.add(listener)
  }

  async current(): Promise<FileRoot[]> {
    this.loaded ??= this.start()
    await this.loaded
    return rootsOf(this.folders, this.projects)
  }

  private async start(): Promise<void> {
    workspaceStore.onChange((view) => {
      this.folders = view.folders
      this.emit()
    })
    worktreeStore.onChange((projects) => {
      this.projects = projects
      this.emit()
    })
    this.folders = (await workspaceStore.view()).folders
    this.projects = worktreeStore.view()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const fileRoots = new FileRoots()
