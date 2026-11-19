/** Agents and E2E runs set APP_BACKGROUND_LAUNCH=1 so the window never appears or takes focus. */
export function isBackgroundLaunch(env: NodeJS.ProcessEnv): boolean {
  return env.APP_BACKGROUND_LAUNCH === '1'
}
