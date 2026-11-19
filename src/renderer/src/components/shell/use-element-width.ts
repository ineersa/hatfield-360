import { useLayoutEffect, useState, type RefObject } from 'react'

/** Tracks an element's rendered width, including window resizes. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    const observer = new ResizeObserver(() => setWidth(element?.clientWidth ?? 0))
    if (element) {
      setWidth(element.clientWidth)
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [ref])
  return width
}
