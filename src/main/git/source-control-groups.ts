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
 * still has a folder for, each listed once even when two projects share a repository. A project's
 * own working tree goes by its workspace folder, as the Files tree and editor tabs name its files,
 * even when that folder is a symlink and git prints the resolved path; linked worktrees go by git's
 * path, as the Files tree lists them.
 */
function groupPlaces(projects: ProjectWorktrees[]): GroupPlace[] {
  const ownFolder = new Map<string, string>()
  for (const project of projects)
    if (project.status === 'git')
      for (const tree of project.worktrees)
        if (tree.project && !ownFolder.has(tree.path)) ownFolder.set(tree.path, project.folder)
  const places = projects.flatMap((project): GroupPlace[] => {
    const own = { project: project.folder, root: project.folder, name: basename(project.folder) }
    if (project.status === 'not-git') return [{ ...own, worktree: false, status: 'not-git' }]
    if (project.status === 'error')
      return [{ ...own, worktree: false, status: 'error', message: project.message }]
    return project.worktrees
      .filter((tree) => !tree.prunable)
      .map((tree) => {
        const folder = ownFolder.get(tree.path)
        return {
          project: project.folder,
          root: folder ?? tree.path,
          name: folder === undefined ? tree.name : basename(folder),
          worktree: !tree.project,
          status: 'git'
        }
      })
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
