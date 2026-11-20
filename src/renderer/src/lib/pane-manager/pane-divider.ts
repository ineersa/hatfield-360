// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): pane-layout/pane-divider.ts and pane-divider-drag.ts.

const MIN_PANE_SIZE = 50
const DIVIDER_THICKNESS = 1
/** A wide transparent hit target; CSS ::after paints only the thin visible line. */
const DIVIDER_HIT_SIZE = 8

export type DividerCallbacks = {
  /** Fits the terminals under a split side after its size changed. */
  refitPanesUnder: (el: HTMLElement) => void
}

const dividerCleanups = new WeakMap<HTMLElement, () => void>()

/** Coalesces flex writes to one reflow per frame when pointer motion outruns paint. */
function createFlexFrameScheduler(apply: (prev: number, next: number) => void): {
  schedule: (prev: number, next: number) => void
  flush: () => void
  cancel: () => void
} {
  let frame: number | null = null
  let pending: { prev: number; next: number } | null = null
  const applyPending = (): void => {
    frame = null
    const sizes = pending
    pending = null
    if (sizes) apply(sizes.prev, sizes.next)
  }
  return {
    schedule(prev, next) {
      pending = { prev, next }
      frame ??= requestAnimationFrame(applyPending)
    },
    flush() {
      if (frame !== null) cancelAnimationFrame(frame)
      applyPending()
    },
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      pending = null
    }
  }
}

function attachDividerDrag(
  divider: HTMLElement,
  isVertical: boolean,
  callbacks: DividerCallbacks
): void {
  let dragging = false
  let didMove = false
  let startPos = 0
  let prevStart = 0
  let totalSize = 0
  let prevEl: HTMLElement | null = null
  let nextEl: HTMLElement | null = null
  let prevInitialFlex = ''
  let nextInitialFlex = ''
  let activePointerId: number | null = null
  const flex = createFlexFrameScheduler((prev, next) => {
    if (!prevEl || !nextEl) return
    prevEl.style.flex = `${prev} 1 0%`
    nextEl.style.flex = `${next} 1 0%`
  })

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== activePointerId || !prevEl || !nextEl) return
    didMove = true
    const delta = (isVertical ? event.clientX : event.clientY) - startPos
    // Layouts too small for two minimums must not get a negative flex.
    const minSize = Math.min(MIN_PANE_SIZE, totalSize / 2)
    const prev = Math.min(Math.max(prevStart + delta, minSize), totalSize - minSize)
    flex.schedule(prev, totalSize - prev)
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) finish(true)
  }
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) finish(false)
  }
  const onWindowBlur = (): void => finish(false)

  // Chromium can lose pointer capture with the button held; the window keeps the drag until release.
  const listenOnWindow = (listen: boolean): void => {
    if (listen) {
      window.addEventListener('pointermove', onPointerMove, true)
      window.addEventListener('pointerup', onPointerUp, true)
      window.addEventListener('pointercancel', onPointerCancel, true)
      window.addEventListener('blur', onWindowBlur)
    } else {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }

  function finish(commit: boolean): void {
    if (!dragging) return
    const pointerId = activePointerId
    dragging = false
    activePointerId = null
    listenOnWindow(false)
    if (commit) {
      flex.flush()
    } else {
      flex.cancel()
      if (didMove && prevEl && nextEl) {
        prevEl.style.flex = prevInitialFlex
        nextEl.style.flex = nextInitialFlex
      }
    }
    try {
      if (pointerId !== null && divider.hasPointerCapture(pointerId)) {
        divider.releasePointerCapture(pointerId)
      }
    } catch {
      // Capture can already be gone after the pointer crossed native window chrome.
    }
    divider.classList.remove('is-dragging')
    if (prevEl) callbacks.refitPanesUnder(prevEl)
    if (nextEl) callbacks.refitPanesUnder(nextEl)
    prevEl = null
    nextEl = null
    didMove = false
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    finish(false)
    const previous = divider.previousElementSibling
    const next = divider.nextElementSibling
    if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) return
    const prevRect = previous.getBoundingClientRect()
    const nextRect = next.getBoundingClientRect()
    const prevSize = isVertical ? prevRect.width : prevRect.height
    const nextSize = isVertical ? nextRect.width : nextRect.height
    if (!(prevSize + nextSize > 0)) return
    divider.setPointerCapture(event.pointerId)
    activePointerId = event.pointerId
    divider.classList.add('is-dragging')
    dragging = true
    didMove = false
    listenOnWindow(true)
    startPos = isVertical ? event.clientX : event.clientY
    prevEl = previous
    nextEl = next
    prevInitialFlex = previous.style.flex
    nextInitialFlex = next.style.flex
    totalSize = prevSize + nextSize
    prevStart = prevSize
  }

  // Double-click shares the space equally again.
  const onDoubleClick = (): void => {
    const previous = divider.previousElementSibling
    const next = divider.nextElementSibling
    if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) return
    previous.style.flex = '1 1 0%'
    next.style.flex = '1 1 0%'
    callbacks.refitPanesUnder(previous)
    callbacks.refitPanesUnder(next)
  }

  divider.addEventListener('pointerdown', onPointerDown)
  divider.addEventListener('dblclick', onDoubleClick)
  dividerCleanups.set(divider, () => {
    finish(false)
    divider.removeEventListener('pointerdown', onPointerDown)
    divider.removeEventListener('dblclick', onDoubleClick)
  })
}

export function createDivider(isVertical: boolean, callbacks: DividerCallbacks): HTMLElement {
  const divider = document.createElement('div')
  divider.className = `pane-divider ${isVertical ? 'is-vertical' : 'is-horizontal'}`
  divider.setAttribute('role', 'separator')
  divider.setAttribute('aria-orientation', isVertical ? 'vertical' : 'horizontal')
  divider.setAttribute(
    'aria-label',
    isVertical ? 'Resize panes left and right' : 'Resize panes above and below'
  )
  if (isVertical) {
    divider.style.width = `${DIVIDER_HIT_SIZE}px`
    divider.style.cursor = 'col-resize'
  } else {
    divider.style.height = `${DIVIDER_HIT_SIZE}px`
    divider.style.cursor = 'row-resize'
  }
  divider.style.flex = 'none'
  divider.style.position = 'relative'
  divider.style.setProperty('--divider-thickness', `${DIVIDER_THICKNESS}px`)
  // The visible line reaches perpendicular dividers' centres so split intersections join.
  divider.style.setProperty('--divider-extension', `${DIVIDER_HIT_SIZE / 2}px`)
  attachDividerDrag(divider, isVertical, callbacks)
  return divider
}

function disposeDivider(divider: HTMLElement): void {
  dividerCleanups.get(divider)?.()
  dividerCleanups.delete(divider)
}

export function removeDividers(parent: HTMLElement): void {
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.classList.contains('pane-divider')) {
      disposeDivider(child)
      child.remove()
    }
  }
}

export function disposeDividersIn(root: HTMLElement): void {
  for (const divider of root.querySelectorAll<HTMLElement>('.pane-divider')) disposeDivider(divider)
}
