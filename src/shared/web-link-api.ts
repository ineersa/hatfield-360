export const WEB_LINK_CHANNELS = {
  open: 'web-link:open'
} as const

export type WebLinkApi = {
  /** Opens an http(s) link, from a terminal or a Markdown preview, in the default browser. */
  openWebLink: (url: string) => Promise<void>
}
