import { useEffect, useState } from 'react'

/** Something slow says "Loading…" after this; something fast never flashes it. */
const LOADING_DELAY_MS = 150

/** False until the loading text has waited out its delay; true at once when nothing is loading. */
export function useLoadingShown(loading: boolean): boolean {
  const [shown, setShown] = useState(!loading)
  useEffect(() => {
    if (shown) return undefined
    const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [shown])
  return shown
}
