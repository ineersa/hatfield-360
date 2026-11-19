import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAppInfoStore } from './state/app-info-store'

export function App(): React.JSX.Element {
  const appInfo = useAppInfoStore((state) => state.appInfo)
  const error = useAppInfoStore((state) => state.error)
  const loadAppInfo = useAppInfoStore((state) => state.loadAppInfo)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Hatfield 360</h1>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load app info: {error}
        </p>
      ) : (
        <p data-testid="app-info" className="text-sm text-muted-foreground">
          {appInfo
            ? `v${appInfo.version} · Electron ${appInfo.electronVersion} · ${appInfo.platform}`
            : 'Loading…'}
        </p>
      )}
      <Button variant="outline" onClick={() => void loadAppInfo()}>
        Reload info
      </Button>
    </main>
  )
}
