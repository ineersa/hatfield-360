import { basename } from 'node:path'
import type { SourceControlGroup } from '../../shared/source-control-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'
import { readWorkingTreeStatus } from './source-control'

type Place = Pick<SourceControlGroup, 'project' | 'root' | 'name' | 'worktree'>

type GroupPlace =
  | (Place & { status: 'git' })
  | (Place & { status: 'not-git' })
  | (Place & { status: 'error'; message: string })

/**
 * One place per working tree of the workspace's projects, in workspace order: every worktree git
 * still has a folder for, each listed once even when two projects share a repository.
 */
function groupPlaces(projects: ProjectWorktrees[]): GroupPlace[] {
  const places = projects.flatMap((project): GroupPlace[] => {
    const own = { project: project.folder, root: project.folder, name: basename(project.folder) }
    if (project.status === 'not-git') return [{ ...own, worktree: false, status: 'not-git' }]
    if (project.status === 'error')
      return [{ ...own, worktree: false, status: 'error', message: project.message }]
    return project.worktrees
      .filter((tree) => !tree.prunable)
      .map((tree) => ({
        project: project.folder,
        root: tree.path,
        name: tree.name,
        worktree: !tree.project,
        status: 'git'
      }))
  })
  return places.filter(
    (place, index) => places.findIndex((other) => other.root === place.root) === index
  )
}

/** Each place's branch and changes, read now; a working tree git can't read becomes an error group. */
export function sourceControlStatus(projects: ProjectWorktrees[]): Promise<SourceControlGroup[]> {
  return Promise.all(
    groupPlaces(projects).map(async (place): Promise<SourceControlGroup> => {
      if (place.status !== 'git') return place
      try {
        return { ...place, ...(await readWorkingTreeStatus(place.root)) }
      } catch (error) {
        return {
          ...place,
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    })
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
