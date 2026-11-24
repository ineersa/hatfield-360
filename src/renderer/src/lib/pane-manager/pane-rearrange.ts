// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): pane-layout/pane-drag-pointer.ts and
// pane-layout/pane-drag-reorder.ts. Orca drags from pane headers; here a rearrange mode lays a
// handle over each pane instead, which also keeps the pointer away from xterm's text selection.
import type { DropZone } from './pane-manager-types'
import { findPaneChildren } from './pane-tree'

const DRAG_THRESHOLD = 5

type PaneDropTarget = { paneId: number; zone: DropZone }

export type PaneRearrange = {
  /** Leaves the mode without moving anything. */
  stop: () => void
}

type PaneRearrangeOptions = {
  root: HTMLElement
  paneElements: () => HTMLElement[]
  onDrop: (sourcePaneId: number, target: PaneDropTarget) => void
  /** The mode ended: after a drop, a click without a drag, Esc, or `stop`. */
  onEnd: () => void
}

const paneIdOf = (pane: HTMLElement): number => Number(pane.dataset.paneId)

/** The edge of `rect` nearest the pointer. */
function resolveDropZone(clientX: number, clientY: number, rect: DOMRect): DropZone {
  const relX = (clientX - rect.left) / rect.width
  const relY = (clientY - rect.top) / rect.height
  const distances: [DropZone, number][] = [
    ['top', relY],
    ['bottom', 1 - relY],
    ['left', relX],
    ['right', 1 - relX]
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0]?.[0] ?? 'right'
}

/** Whether docking `source` to `zone` of `target` leaves the layout as it is. */
export function isPaneDropNoOp(source: HTMLElement, target: HTMLElement, zone: DropZone): boolean {
  if (source === target) return true
  const parent = target.parentElement
  if (!parent?.classList.contains('pane-split') || source.parentElement !== parent) return false
  const children = findPaneChildren(parent)
  const targetIndex = children.indexOf(target)
  const sourceIndex = children.indexOf(source)
  const zoneIsVertical = zone === 'left' || zone === 'right'
  if (zoneIsVertical !== parent.classList.contains('is-vertical')) return false
  return zone === 'right' || zone === 'bottom'
    ? sourceIndex === targetIndex + 1
    : sourceIndex === targetIndex - 1
}

/** Covers each pane with a drag handle until one drop, a click without a drag, or Esc. */
export function startPaneRearrange(options: PaneRearrangeOptions): PaneRearrange {
  const { root } = options
  let stopped = false
  root.classList.add('is-rearranging-panes')
  const highlight = document.createElement('div')
  highlight.className = 'pane-drop-highlight'
  highlight.hidden = true
  root.appendChild(highlight)

  const findTarget = (source: HTMLElement, x: number, y: number): PaneDropTarget | null => {
    for (const pane of options.paneElements()) {
      if (pane === source) continue
      const rect = pane.getBoundingClientRect()
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
      const zone = resolveDropZone(x, y, rect)
      return isPaneDropNoOp(source, pane, zone) ? null : { paneId: paneIdOf(pane), zone }
    }
    return null
  }

  const showHighlight = (target: PaneDropTarget | null): void => {
    const pane = target && options.paneElements().find((el) => paneIdOf(el) === target.paneId)
    if (!target || !pane) {
      highlight.hidden = true
      return
    }
    const rect = pane.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const half = target.zone === 'left' || target.zone === 'right' ? 'width' : 'height'
    highlight.hidden = false
    highlight.dataset.zone = target.zone
    highlight.style.left = `${rect.left - rootRect.left + (target.zone === 'right' ? rect.width / 2 : 0)}px`
    highlight.style.top = `${rect.top - rootRect.top + (target.zone === 'bottom' ? rect.height / 2 : 0)}px`
    highlight.style.width = `${half === 'width' ? rect.width / 2 : rect.width}px`
    highlight.style.height = `${half === 'height' ? rect.height / 2 : rect.height}px`
  }

  const beginDrag = (handle: HTMLElement, source: HTMLElement, down: PointerEvent): void => {
    if (down.button !== 0) return
    down.preventDefault()
    handle.setPointerCapture(down.pointerId)
    let dragging = false
    let finished = false
    let target: PaneDropTarget | null = null

    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return
      const moved = Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY)
      if (!dragging && moved >= DRAG_THRESHOLD) {
        dragging = true
        source.classList.add('is-drag-source')
      }
      if (!dragging) return
      target = findTarget(source, event.clientX, event.clientY)
      showHighlight(target)
    }
    const finish = (commit: boolean): void => {
      if (finished) return
      finished = true
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onCancel)
      handle.removeEventListener('lostpointercapture', onCancel)
      source.classList.remove('is-drag-source')
      const drop = commit && dragging ? target : null
      stop()
      if (drop) options.onDrop(paneIdOf(source), drop)
    }
    const onUp = (event: PointerEvent): void => {
      if (event.pointerId === down.pointerId) finish(true)
    }
    const onCancel = (event: PointerEvent): void => {
      if (event.pointerId === down.pointerId) finish(false)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onCancel)
    handle.addEventListener('lostpointercapture', onCancel)
  }

  const handles = options.paneElements().map((pane) => {
    const handle = document.createElement('div')
    handle.className = 'pane-rearrange-handle'
    handle.dataset.testid = 'pane-rearrange-handle'
    handle.textContent = 'Drag onto another pane'
    handle.addEventListener('pointerdown', (event) => beginDrag(handle, pane, event))
    pane.appendChild(handle)
    return handle
  })

  // Capture phase, so Esc leaves the mode instead of reaching the shell.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    stop()
  }
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', stop)

  function stop(): void {
    if (stopped) return
    stopped = true
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', stop)
    for (const handle of handles) handle.remove()
    highlight.remove()
    root.classList.remove('is-rearranging-panes')
    options.onEnd()
  }

  return { stop }
}
