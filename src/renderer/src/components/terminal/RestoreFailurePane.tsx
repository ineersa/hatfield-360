import { useTerminalWorkspace } from '@/state/terminal-workspace'
import { Copy, LoaderCircle, RotateCw, Settings, TriangleAlert, X } from 'lucide-react'
import { AGENT_PROVIDERS } from '../../../../shared/agent-api'
import { cn } from '@/lib/class-names'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { notify } from '@/state/notification-store'

const buttonClass =
  'type-button flex h-control items-center gap-2 rounded-button px-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const primaryClass = 'bg-primary text-primary-foreground hover:bg-primary/90'
const secondaryClass = 'border border-separator hover:bg-hover'

export function RestoreFailurePane({
  pane,
  retry,
  close
}: {
  pane: string
  retry: (() => void) | null
  close: () => void
}): React.JSX.Element | null {
  const restore = useTerminalWorkspace((state) => state.restore[pane])
  if (!restore && retry) return null
  const session = restore?.session
  const failure = restore?.failure ?? null
  const name = session?.title ?? session?.providerSessionId?.slice(0, 8) ?? 'this session'
  const resuming = Boolean(restore && !failure)

  return (
    <div className="absolute inset-0 z-10 grid overflow-auto bg-terminal p-4">
      <div className="m-auto flex w-full max-w-md flex-col gap-4">
        <div className="flex gap-3">
          {resuming ? (
            <LoaderCircle
              className="mt-0.5 size-5 shrink-0 text-muted-foreground motion-safe:animate-spin"
              aria-hidden
            />
          ) : (
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="type-section-title" role="status">
              {resuming ? `Resuming “${name}”…` : `Couldn't resume “${name}”`}
            </h2>
            {failure ? <p className="type-body">{failure.detail}</p> : null}
            {!session && (
              <p className="type-body">The saved conversation details are unavailable.</p>
            )}
            {session && (
              <p className="type-hint break-all text-muted-foreground">
                {AGENT_PROVIDERS[session.provider]} ·{' '}
                {session.providerSessionId ?? 'ID not reported'} · {session.cwd}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-8">
          {retry && (
            <button
              type="button"
              disabled={resuming}
              onClick={retry}
              data-resume-action
              className={cn(
                buttonClass,
                failure && !failure.settings ? primaryClass : secondaryClass,
                'disabled:opacity-50'
              )}
            >
              <RotateCw className="size-4" aria-hidden />
              Retry
            </button>
          )}
          {failure?.settings ? (
            <button
              type="button"
              onClick={() => useShellLayoutStore.getState().openSettings()}
              className={cn(buttonClass, primaryClass)}
            >
              <Settings className="size-4" aria-hidden />
              Open Settings
            </button>
          ) : null}
          <button
            type="button"
            data-resume-action
            onClick={close}
            className={cn(buttonClass, secondaryClass)}
          >
            <X className="size-4" aria-hidden />
            Close pane
          </button>
          {session && (
            <button
              type="button"
              disabled={!session.providerSessionId}
              onClick={() => {
                if (session.providerSessionId)
                  void window.desktop
                    .writeTerminalClipboard(session.providerSessionId)
                    .catch(() => notify({ severity: 'error', title: 'Could not copy session ID' }))
              }}
              className={cn(
                buttonClass,
                'text-muted-foreground hover:bg-hover hover:text-foreground'
              )}
            >
              <Copy className="size-4" aria-hidden />
              Copy session ID
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
