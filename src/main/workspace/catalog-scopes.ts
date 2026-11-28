import type { WorkspaceView } from '../../shared/workspace-api'
import { projectRepositories } from '../../shared/project-repositories'
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
    // Every working tree of the project's repositories, also those inside a multi-repo folder.
    for (const repository of projectRepositories(project)) {
      if (repository.status !== 'git') continue
      for (const tree of repository.worktrees) {
        if (!tree.prunable && !scopes.has(tree.path)) scopes.set(tree.path, folder.path)
      }
    }
  }
  return scopes
}
