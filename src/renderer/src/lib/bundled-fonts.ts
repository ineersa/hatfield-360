/**
 * Loads the bundled monospace font before the first terminal exists: xterm measures its cells once,
 * and a font that arrives later leaves it measured for the fallback.
 */
export async function loadBundledFonts(): Promise<void> {
  await Promise.allSettled([
    document.fonts.load("1em 'JetBrains Mono Variable'"),
    document.fonts.load("italic 1em 'JetBrains Mono Variable'")
  ])
}
