export const DIAGNOSTICS_CHANNELS = {
  reportSlowTask: 'diagnostics:report-slow-task'
} as const

/** A script the browser blames for a long frame. */
export type SlowTaskScript = {
  /** What started it, such as `DOMWindow.onclick` or `Response.json.then`. */
  invoker: string
  /** `function @ url:position`, as far as the browser knows them. */
  source: string
  duration: number
}

/** A page frame that took 200 ms or more, with what the user last did before it. */
type SlowTaskReport = {
  duration: number
  /** The active view, or `settings`. */
  view: string
  action: { label: string; before: number } | null
  scripts: SlowTaskScript[]
}

export type DiagnosticsApi = {
  /** Appends a long page frame to the app's performance log. */
  reportSlowTask: (report: SlowTaskReport) => Promise<void>
}
