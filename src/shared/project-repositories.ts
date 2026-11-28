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

const within = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`)

/** The repository inside a multi-repo project whose folder or linked worktree holds `path`; null for any other path. */
export function innerRepositoryOf(
  project: ProjectWorktrees | undefined,
  path: string
): string | null {
  for (const repository of project?.repositories ?? []) {
    const trees = repository.status === 'git' ? repository.worktrees.map((tree) => tree.path) : []
    if ([repository.folder, ...trees].some((folder) => within(path, folder)))
      return repository.folder
  }
  return null
}
