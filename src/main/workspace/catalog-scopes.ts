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
    // Agents start in the project folder or a linked worktree, also one of a repository inside a
    // multi-repo folder; those repositories' own folders aren't scanned, as agents don't start there.
    for (const repository of projectRepositories(project)) {
      if (repository.status !== 'git') continue
      for (const tree of repository.worktrees) {
        if (tree.project && repository.folder !== folder.path) continue
        if (!tree.prunable && !scopes.has(tree.path)) scopes.set(tree.path, folder.path)
      }
    }
  }
  return scopes
}
