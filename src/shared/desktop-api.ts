export type AppInfo = {
  name: string
  version: string
  platform: string
  electronVersion: string
}

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info'
} as const

/** Everything the preload bridge exposes to the renderer as `window.desktop`. */
export type DesktopApi = {
  getAppInfo: () => Promise<AppInfo>
}
