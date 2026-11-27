import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const KEYBOARD_STEP_PX = 16
export const SIDE_PANEL_HANDLE_WIDTH = 6

type PanelResizeHandleProps = {
  label: string
  /** The panel's stored width, or height for a handle above or below it. */
  size: number
  /** On screen size, which is smaller than `size` when a small window caps the panel. */
  renderedSize: () => number
  minSize: number
  /** Largest the panel can be in the current window. */
  maxSize: () => number
  onSizeChange: (size: number) => void
  /** Where the panel is from the handle; a panel on the right or below grows as the handle moves left or up. */
  panelSide?: 'left' | 'right' | 'above' | 'below'
}

const KEYS = {
  horizontal: { less: 'ArrowLeft', more: 'ArrowRight' },
  vertical: { less: 'ArrowUp', more: 'ArrowDown' }
} as const

/** Drags or arrow keys resize the panel beside it; it resizes nothing itself. */
export function PanelResizeHandle({
  label,
  size,
  renderedSize,
  minSize,
  maxSize,
  onSizeChange,
  panelSide = 'left'
}: PanelResizeHandleProps): React.JSX.Element {
  const across = panelSide === 'left' || panelSide === 'right'
  const grow = panelSide === 'left' || panelSide === 'above' ? 1 : -1
  const keys = KEYS[across ? 'horizontal' : 'vertical']
  const drag = useRef<{ start: number; startSize: number } | null>(null)
  const position = (event: PointerEvent<HTMLDivElement>): number =>
    across ? event.clientX : event.clientY

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { start: position(event), startSize: renderedSize() }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    onSizeChange(drag.current.startSize + grow * (position(event) - drag.current.start))
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = Math.round(renderedSize())
    const next = {
      [keys.less]: current - grow * KEYBOARD_STEP_PX,
      [keys.more]: current + grow * KEYBOARD_STEP_PX,
      Home: minSize,
      End: maxSize()
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onSizeChange(next)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={across ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      aria-valuemin={minSize}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      style={across ? { width: SIDE_PANEL_HANDLE_WIDTH } : { height: SIDE_PANEL_HANDLE_WIDTH }}
      className={`group relative shrink-0 touch-none focus-visible:outline-none ${across ? 'cursor-col-resize' : 'cursor-row-resize'}`}
    >
      <div
        className={`absolute rounded-full transition-colors group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary ${across ? 'inset-y-3 left-1/2 w-0.5 -translate-x-1/2' : 'inset-x-3 top-1/2 h-0.5 -translate-y-1/2'}`}
      />
    </div>
  )
}
