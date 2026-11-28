import { useShellLayoutStore } from '@/state/shell-layout-store'
import { MAX_SCRIPTS, SLOW_MS, type SlowTaskScript } from '../../../shared/diagnostics-api'
import {
  actionBefore,
  type UserAction,
  clickActionLabel,
  keyActionLabel
} from './user-action-label'

/** Recent actions kept, so a frame reported late is matched to the action before it, not a newer one. */
const ACTIONS_KEPT = 16

/** A property the DOM types don't know yet (Long Animation Frames); browser getters, so not own keys. */
function field(entry: object, name: string): unknown {
  const value: unknown = Reflect.get(entry, name)
  return value
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The scripts a long animation frame blames, longest first. */
function blamedScripts(entry: PerformanceEntry): SlowTaskScript[] {
  const scripts = field(entry, 'scripts')
  if (!Array.isArray(scripts)) return []
  return scripts
    .filter((script): script is object => typeof script === 'object' && script !== null)
    .map((script) => {
      const url = text(field(script, 'sourceURL'))
      const position = field(script, 'sourceCharPosition')
      const where = url ? ` @ ${url.slice(url.lastIndexOf('/') + 1)}:${String(position)}` : ''
      const duration = field(script, 'duration')
      return {
        invoker: text(field(script, 'invoker')) || 'unknown',
        source: `${text(field(script, 'sourceFunctionName')) || 'anonymous'}${where}`,
        duration: typeof duration === 'number' ? duration : 0
      }
    })
    .toSorted((a, b) => b.duration - a.duration)
    .slice(0, MAX_SCRIPTS)
}

/**
 * Reports each page frame of SLOW_MS or more to main's performance log, with the active view and
 * what the user last did; returns the stop. Nothing runs until a frame is that slow.
 */
export function startSlowTaskReports(): () => void {
  if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) return () => {}
  const actions: UserAction[] = []
  const remember = (label: string): void => {
    actions.push({ label, at: performance.now() })
    if (actions.length > ACTIONS_KEPT) actions.shift()
  }
  const onPointer = (event: PointerEvent): void => {
    if (event.target instanceof Element) remember(clickActionLabel(event.target))
  }
  const onKey = (event: KeyboardEvent): void => {
    const label = keyActionLabel(event)
    if (label !== null) remember(label)
  }
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  window.addEventListener('keydown', onKey, { capture: true, passive: true })
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < SLOW_MS) continue
      const layout = useShellLayoutStore.getState()
      window.desktop
        .reportSlowTask({
          duration: entry.duration,
          view: layout.settingsOpen ? 'settings' : layout.activeView,
          action: actionBefore(actions, entry.startTime),
          scripts: blamedScripts(entry)
        })
        .catch((error: unknown) => console.warn('Reporting a slow frame failed:', error))
    }
  })
  observer.observe({ type: 'long-animation-frame', buffered: true })
  return () => {
    observer.disconnect()
    window.removeEventListener('pointerdown', onPointer, { capture: true })
    window.removeEventListener('keydown', onKey, { capture: true })
  }
}
