import { basename } from 'node:path'
import { mapWithConcurrency } from '../../shared/limited-concurrency'
import { projectRepositories } from '../../shared/project-repositories'
import type { SourceControlGroup } from '../../shared/source-control-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'
import { readWorkingTreeStatus } from './source-control'

type Place = Pick<SourceControlGroup, 'project' | 'root' | 'name' | 'worktree' | 'parent'> & {
  /** The repository the working tree belongs to: the project's own, or one inside a multi-repo project. */
  repository: string
}

type GroupPlace =
  | (Place & { status: 'git' })
  | (Place & { status: 'not-git' })
  | (Place & { status: 'error'; message: string })

/**
 * One place per working tree of the workspace's projects, in workspace order: every worktree git
 * still has a folder for, each listed once even when two projects share a repository. A project's
 * own working tree goes by its workspace folder, as the Files tree and editor tabs name its files,
 * even when that folder is a symlink and git prints the resolved path; linked worktrees go by git's
 * path, as the Files tree lists them.
 */
function groupPlaces(projects: ProjectWorktrees[]): GroupPlace[] {
  const ownFolder = new Map<string, string>()
  for (const project of projects)
    for (const repository of projectRepositories(project))
      if (repository.status === 'git')
        for (const tree of repository.worktrees)
          if (tree.project && !ownFolder.has(tree.path)) ownFolder.set(tree.path, repository.folder)
  const rootOf = (path: string): string => ownFolder.get(path) ?? path
  const places = projects.flatMap((project): GroupPlace[] => {
    const repositories = projectRepositories(project)
    if (repositories.length === 0) {
      const own = { project: project.folder, repository: project.folder, root: project.folder }
      return [
        { ...own, name: basename(project.folder), worktree: false, parent: null, status: 'not-git' }
      ]
    }
    return repositories.flatMap((repository): GroupPlace[] => {
      // A repository inside a multi-repo project goes by `project/repository`.
      const inside = repository.folder !== project.folder
      const label = (folder: string): string =>
        inside && folder === repository.folder
          ? `${basename(project.folder)}/${basename(folder)}`
          : basename(folder)
      const place = { project: project.folder, repository: repository.folder }
      if (repository.status === 'error')
        return [
          {
            ...place,
            root: repository.folder,
            name: label(repository.folder),
            worktree: false,
            parent: null,
            status: 'error',
            message: repository.message
          }
        ]
      const own = repository.worktrees.find((tree) => tree.project && !tree.prunable)
      return repository.worktrees
        .filter((tree) => !tree.prunable)
        .map((tree) => {
          const folder = ownFolder.get(tree.path)
          return {
            ...place,
            root: rootOf(tree.path),
            name: folder === undefined ? tree.name : label(folder),
            worktree: !tree.project,
            parent: tree.project || own === undefined ? null : rootOf(own.path),
            status: 'git'
          }
        })
    })
  })
  return places.filter(
    (place, index) => places.findIndex((other) => other.root === place.root) === index
  )
}

/** How many `git status` runs at once: a multi-repo folder can hold dozens of working trees. */
const STATUS_CONCURRENCY = 8

/** Each place's branch and changes, read now; a working tree git can't read becomes an error group. */
export function sourceControlStatus(projects: ProjectWorktrees[]): Promise<SourceControlGroup[]> {
  return mapWithConcurrency(
    groupPlaces(projects),
    STATUS_CONCURRENCY,
    async (place): Promise<SourceControlGroup> => {
      const { repository: _repository, ...group } = place
      if (group.status !== 'git') return group
      try {
        return { ...group, ...(await readWorkingTreeStatus(group.root)) }
      } catch (error) {
        return {
          ...group,
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )
}

/** The git working tree a request names, or an error: only the workspace's own are used. */
export function workingTreeOf(projects: ProjectWorktrees[], root: unknown): Place {
  const place =
    typeof root === 'string'
      ? groupPlaces(projects).find((candidate) => candidate.root === root)
      : undefined
  if (place?.status !== 'git') throw new Error('Choose a git repository in the current workspace.')
  return place
}
