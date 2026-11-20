import { useEffect } from 'react'
import { useAppInfoStore } from '@/state/app-info-store'

export function StatusBar(): React.JSX.Element {
  const appInfo = useAppInfoStore((state) => state.appInfo)
  const error = useAppInfoStore((state) => state.error)
  const loadAppInfo = useAppInfoStore((state) => state.loadAppInfo)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <footer className="type-status flex min-h-status-bar shrink-0 items-center justify-end gap-3 px-3 py-0.5">
      {error ? (
        <span role="alert" className="truncate text-error">
          Could not load app info: {error}
        </span>
      ) : (
        <span data-testid="app-info" className="truncate">
          {appInfo
            ? `Hatfield 360 v${appInfo.version} · Electron ${appInfo.electronVersion} · ${appInfo.platform}`
            : 'Loading…'}
        </span>
      )}
    </footer>
  )
}
