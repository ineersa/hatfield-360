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
    <footer className="flex min-h-7 shrink-0 items-center justify-end gap-3 px-3 py-0.5 text-ui-sm text-muted-foreground">
      {error ? (
        <span role="alert" className="truncate text-destructive">
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
