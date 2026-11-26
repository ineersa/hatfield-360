import type { WorkspaceView } from '../../shared/workspace-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'

export function catalogScopes(
  folders: WorkspaceView['folders'],
  projects: ProjectWorktrees[]
): Map<string, string> {
  const scopes = new Map<string, string>()
  for (const folder of folders) {
    if (folder.missing || folder.kind !== 'project') continue
    scopes.set(folder.path, folder.path)
    const project = projects.find((entry) => entry.folder === folder.path)
    if (project?.status !== 'git') continue
    for (const tree of project.worktrees) {
      if (!tree.prunable && !scopes.has(tree.path)) scopes.set(tree.path, folder.path)
    }
  }
  return scopes
}
