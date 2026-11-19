import { create } from 'zustand'
import type { AppInfo } from '../../../shared/desktop-api'

type AppInfoState = {
  appInfo: AppInfo | null
  error: string | null
  loadAppInfo: () => Promise<void>
}

export const useAppInfoStore = create<AppInfoState>((set) => ({
  appInfo: null,
  error: null,
  loadAppInfo: async () => {
    try {
      set({ appInfo: await window.desktop.getAppInfo(), error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}))
