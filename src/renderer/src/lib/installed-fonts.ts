import { cssFontFamily } from './css-font-family'

export type InstalledFont = { family: string; monospace: boolean }

let loading: Promise<InstalledFont[]> | null = null

/** Monospace fonts draw a narrow and a wide letter at the same width. */
function isMonospace(context: CanvasRenderingContext2D, family: string): boolean {
  context.font = `32px ${cssFontFamily(family)}, serif`
  return context.measureText('iiiii').width === context.measureText('WWWWW').width
}

async function queryInstalledFonts(): Promise<InstalledFont[]> {
  if (!window.queryLocalFonts) throw new Error("This system can't list its fonts.")
  const fonts = await window.queryLocalFonts()
  const families = [...new Set(fonts.map((font) => font.family))].toSorted((a, b) =>
    a.localeCompare(b)
  )
  const context = document.createElement('canvas').getContext('2d')
  return families.map((family) => ({
    family,
    monospace: context ? isMonospace(context, family) : false
  }))
}

/** The font families installed on this computer, by name; loaded once, on first use. */
export function loadInstalledFonts(): Promise<InstalledFont[]> {
  loading ??= queryInstalledFonts().catch((error: unknown) => {
    // Try again next time (e.g. after a missing user gesture).
    loading = null
    throw error
  })
  return loading
}
