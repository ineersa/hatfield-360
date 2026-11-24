import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const scrollButtonClass =
  'my-auto flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground enabled:hover:bg-hover enabled:hover:text-foreground disabled:opacity-40'

/** A tab strip that scrolls sideways with arrow buttons instead of a scrollbar and keeps the selected tab in view. */
export function ScrollingTabList({
  label,
  selected,
  children
}: {
  label: string
  /** Changes whenever another tab is selected, so the strip brings it into view. */
  selected: string | null
  children: ReactNode
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const measure = useCallback(() => {
    const strip = list.current
    if (!strip) return
    const start = strip.scrollLeft <= 0
    const end = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1
    setEdges((current) =>
      current.start === start && current.end === end ? current : { start, end }
    )
  }, [])

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure)
    if (list.current) observer.observe(list.current)
    return () => observer.disconnect()
  }, [measure])

  const shown = useRef<string | null | undefined>(undefined)
  // Runs after every render: tabs come and go without resizing the strip itself.
  useLayoutEffect(() => {
    const strip = list.current
    if (strip && shown.current !== selected) {
      shown.current = selected
      const tab = strip.querySelector('[aria-selected="true"]')
      const item = tab ? [...strip.children].find((child) => child.contains(tab)) : null
      const box = item?.getBoundingClientRect()
      const view = strip.getBoundingClientRect()
      if (box && box.left < view.left) strip.scrollLeft -= view.left - box.left
      else if (box && box.right > view.right) strip.scrollLeft += box.right - view.right
    }
    measure()
  })

  const scroll = (direction: 1 | -1) => {
    const strip = list.current
    if (strip) strip.scrollLeft += direction * strip.clientWidth * 0.8
  }
  const overflowing = !(edges.start && edges.end)

  return (
    <div className="flex min-w-0 items-stretch">
      {overflowing ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll tabs left"
          disabled={edges.start}
          onClick={() => scroll(-1)}
          className={`mx-0.5 ${scrollButtonClass}`}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
      ) : null}
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        onScroll={measure}
        onWheel={(event) => {
          if (event.deltaX === 0 && list.current) list.current.scrollLeft += event.deltaY
        }}
        className="scrollbar-hidden flex min-w-0 items-stretch overflow-x-auto"
      >
        {children}
      </div>
      {overflowing ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll tabs right"
          disabled={edges.end}
          onClick={() => scroll(1)}
          className={`mx-0.5 ${scrollButtonClass}`}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
