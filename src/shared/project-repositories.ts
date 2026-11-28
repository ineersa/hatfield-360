import type { ProjectWorktrees, RepositoryWorktrees, Worktree } from './worktree-api'

/** A project's repositories: the folder's own when it is one, then those inside a multi-repo folder. */
export function projectRepositories(project: ProjectWorktrees | undefined): RepositoryWorktrees[] {
  if (!project) return []
  const repositories = project.repositories ?? []
  if (project.status === 'not-git') return repositories
  const own: RepositoryWorktrees =
    project.status === 'git'
      ? { folder: project.folder, status: 'git', worktrees: project.worktrees }
      : { folder: project.folder, status: 'error', message: project.message }
  return [own, ...repositories]
}

/** A linked worktree with the repository it belongs to. */
export type LinkedWorktree = Worktree & { repository: string }

/** The linked worktrees (`git worktree add`) of every repository of a project. */
export function linkedWorktrees(project: ProjectWorktrees | undefined): LinkedWorktree[] {
  return projectRepositories(project).flatMap((repository) =>
    repository.status === 'git'
      ? repository.worktrees
          .filter((tree) => !tree.project)
          .map((tree) => ({ ...tree, repository: repository.folder }))
      : []
  )
}
