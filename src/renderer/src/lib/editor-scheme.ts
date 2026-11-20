import { useEffect, useState } from 'react'
import type { EditorThemeId } from '../../../shared/settings-api'
import type { EditorScheme, TextAttributes } from '../../../shared/themes/editor-scheme'

/** The schemes `pnpm themes:import` writes, each loaded only when chosen. */
const SCHEMES = import.meta.glob<EditorScheme>('../assets/themes/editor/*.json', {
  import: 'default'
})

function loadEditorScheme(id: EditorThemeId): Promise<EditorScheme> {
  const load = SCHEMES[`../assets/themes/editor/${id}.json`]
  return load ? load() : Promise.reject(new Error(`No editor scheme ${id}`))
}

/** The scheme of an editor theme, or null while it loads. */
export function useEditorScheme(id: EditorThemeId): EditorScheme | null {
  const [loaded, setLoaded] = useState<{ id: EditorThemeId; scheme: EditorScheme } | null>(null)
  useEffect(() => {
    let current = true
    void loadEditorScheme(id).then((scheme) => {
      if (current) setLoaded({ id, scheme })
    })
    return () => {
      current = false
    }
  }, [id])
  return loaded?.id === id ? loaded.scheme : null
}

/**
 * A token kind's attributes: the first of `keys` the scheme sets. The IDE falls back the same way in
 * code (a parameter without its own colour is drawn as an identifier, then as plain text).
 */
export function tokenAttributes(scheme: EditorScheme, keys: readonly string[]): TextAttributes {
  for (const key of keys) {
    const attributes = scheme.attributes[key]
    if (attributes) return attributes
  }
  return {}
}
