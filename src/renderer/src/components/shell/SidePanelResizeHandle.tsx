import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const KEYBOARD_STEP_PX = 16

type SidePanelResizeHandleProps = {
  label: string
  width: number
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number) => void
}

export function SidePanelResizeHandle({
  label,
  width,
  minWidth,
  maxWidth,
  onWidthChange
}: SidePanelResizeHandleProps): React.JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    onWidthChange(drag.current.startWidth + event.clientX - drag.current.startX)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = {
      ArrowLeft: width - KEYBOARD_STEP_PX,
      ArrowRight: width + KEYBOARD_STEP_PX,
      Home: minWidth,
      End: maxWidth
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onWidthChange(next)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none focus-visible:outline-none"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-highlight group-focus-visible:bg-highlight group-active:bg-highlight" />
    </div>
  )
}
