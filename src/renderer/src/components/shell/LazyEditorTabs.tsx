import { CircleAlert } from 'lucide-react'
import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react'
import type { EditorTabs } from '@/components/editor/EditorTabs'
import { importWithRetry } from '@/lib/module-load-retry'

/**
 * The editor's code, imported once the Files view shows, so neither startup nor the first file
 * waits. Under `pnpm dev` it is hundreds of requests, any of which the browser can drop.
 */
export const loadEditorTabs = (): Promise<{ EditorTabs: typeof EditorTabs }> =>
  importWithRetry(() => import('@/components/editor/EditorTabs'))

const lazyEditorTabs = () =>
  lazy(() => loadEditorTabs().then((module) => ({ default: module.EditorTabs })))

type BoundaryProps = { hidden: boolean; onRetry: () => void; children: ReactNode }

/** Keeps a failed editor load to the editor area, with a retry, instead of unmounting the app. */
class EditorLoadBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The editor failed to load', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.hidden) return null
    return (
      <div
        role="alert"
        className="m-auto flex max-w-md flex-col items-center gap-3 p-8 text-center"
      >
        <CircleAlert className="size-empty-state-icon text-error" strokeWidth={1.5} aria-hidden />
        <p className="type-description">The editor couldn't load: {error.message}</p>
        <button
          type="button"
          onClick={this.props.onRetry}
          className="type-button flex h-control items-center rounded-button border border-button-border bg-button px-3.5 text-button-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }
}

/** The editor tabs, loaded on first use; a load that fails can be retried without reloading the page. */
export function LazyEditorTabs({ hidden }: { hidden: boolean }): React.JSX.Element {
  // A lazy component keeps its failure, so a retry needs a new one.
  const [attempt, setAttempt] = useState(() => ({ id: 0, EditorTabs: lazyEditorTabs() }))
  const { EditorTabs } = attempt
  return (
    <EditorLoadBoundary
      key={attempt.id}
      hidden={hidden}
      onRetry={() => setAttempt((last) => ({ id: last.id + 1, EditorTabs: lazyEditorTabs() }))}
    >
      <Suspense fallback={null}>
        <EditorTabs hidden={hidden} />
      </Suspense>
    </EditorLoadBoundary>
  )
}
