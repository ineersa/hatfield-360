/// <reference types="vite/client" />
import type { DesktopApi } from '../../shared/desktop-api'

declare global {
  interface Window {
    desktop: DesktopApi
    /** Local Font Access API (Chromium); main grants the `local-fonts` permission to the app's page. */
    queryLocalFonts?: () => Promise<{ family: string }[]>
  }
}
