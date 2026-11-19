import { create } from 'zustand'
import type { AppInfo } from '../../../shared/desktop-api'

type AppInfoState = {
  appInfo: AppInfo | null
  loadAppInfo: () => Promise<void>
}

export const useAppInfoStore = create<AppInfoState>((set) => ({
  appInfo: null,
  loadAppInfo: async () => set({ appInfo: await window.desktop.getAppInfo() })
}))
