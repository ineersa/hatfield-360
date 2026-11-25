import { create } from 'zustand'
import type { RecentConversation } from '../../../shared/recent-conversation'
import { mainErrorMessage } from '@/lib/main-error-message'

type CatalogState = {
  catalog: {
    generation: number
    sessions: RecentConversation[]
    error: string | null
    loading: boolean
  } | null
  load: (generation: number) => () => void
}

export const useRecentSessionStore = create<CatalogState>((set) => ({
  catalog: null,
  load: (generation) => {
    let cancelled = false
    set((state) => ({
      catalog: {
        generation,
        sessions: state.catalog?.generation === generation ? state.catalog.sessions : [],
        error: null,
        loading: true
      }
    }))
    void window.desktop.getRecentConversations(generation).then(
      (sessions) => {
        if (!cancelled) set({ catalog: { generation, sessions, error: null, loading: false } })
      },
      (error: unknown) => {
        if (!cancelled)
          set({
            catalog: { generation, sessions: [], error: mainErrorMessage(error), loading: false }
          })
      }
    )
    return () => {
      cancelled = true
    }
  }
}))
