import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The single URL the app window loads; IPC accepts calls only from this page. */
export function rendererEntryUrl(): string {
  return (
    process.env.ELECTRON_RENDERER_URL ??
    pathToFileURL(join(__dirname, '../renderer/index.html')).href
  )
}
