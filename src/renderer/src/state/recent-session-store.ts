import { create } from 'zustand'
import type { RecentCatalog } from '../../../shared/recent-conversation'
import type { WorkspaceView } from '../../../shared/workspace-api'
import type { ProjectWorktrees } from '../../../shared/worktree-api'
import { mainErrorMessage } from '@/lib/main-error-message'

/** What the catalog covers: the workspace's projects and their worktrees. It reloads when this changes. */
export function recentCatalogScope(
  folders: WorkspaceView['folders'],
  projects: Record<string, ProjectWorktrees>
): string {
  return JSON.stringify(
    folders
      .filter((folder) => folder.kind === 'project')
      .map(({ path, missing }) => [
        path,
        missing,
        projects[path]?.status === 'git'
          ? projects[path].worktrees.map(({ path: treePath, prunable }) => [treePath, prunable])
          : []
      ])
  )
}

type CatalogState = {
  catalog: (RecentCatalog & { key: string; loading: boolean }) | null
  load: (generation: number, scope: string) => Promise<void>
}

export const useRecentSessionStore = create<CatalogState>((set, get) => {
  let active: { key: string; done: Promise<void> } | undefined
  let wanted = ''

  function load(generation: number, scope: string): Promise<void> {
    const key = JSON.stringify([generation, scope])
    wanted = key
    if (scope === '[]') {
      set({ catalog: null })
      return Promise.resolve()
    }
    if (active) {
      if (active.key === key) return active.done
      return active.done.then(async () => {
        if (wanted === key) await load(generation, scope)
      })
    }
    const previous = get().catalog
    const initial = {
      key,
      sessions: previous?.key === key ? previous.sessions : [],
      scopeAliases: previous?.key === key ? previous.scopeAliases : new Map<string, string>(),
      errors: [],
      loading: true
    }
    const publish = (result: RecentCatalog): void => {
      if (wanted === key) set({ catalog: { ...result, key, loading: false } })
    }
    const done = window.desktop
      .getRecentConversations(generation)
      .then(publish, (error: unknown) => publish({ ...initial, errors: [mainErrorMessage(error)] }))
      .finally(() => {
        active = undefined
      })
    active = { key, done }
    set({ catalog: initial })
    return done
  }

  return { catalog: null, load }
})
