import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
// The release workflow points E2E_EXECUTABLE at the packaged app to smoke-test the installable build.
const packagedExecutable = process.env.E2E_EXECUTABLE
const launchTarget = packagedExecutable ? { executablePath: packagedExecutable } : { args: [root] }

/** A fresh temp directory, removed by the returned cleanup. */
export async function makeTempDir(prefix: string): Promise<[string, () => Promise<void>]> {
  const dir = await mkdtemp(join(tmpdir(), `hatfield-e2e-${prefix}-`))
  return [dir, () => rm(dir, { recursive: true, force: true })]
}

/**
 * A Hatfield command no machine has, as on the release runners. Otherwise the app runs the user's
 * own `hatfield session:list` in every test project, which writes a `.hatfield` folder into it.
 */
const NO_AGENT_SETTINGS = {
  'agents.hatfield': { executable: 'hatfield-360-e2e-no-agent', args: [] },
  // The Git view starts the commit message agent: never the user's real Claude Code.
  'agents.claude': { executable: 'hatfield-360-e2e-no-agent', args: [] }
}

/** Settings for a launch whose test wrote none; a test's own settings.json is left as it is. */
async function isolateAgents(userDataDir: string): Promise<void> {
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify(NO_AGENT_SETTINGS), {
    flag: 'wx'
  }).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  })
}

/** Whether the app under test is the packaged executable (release smoke tests) rather than the build. */
export const testingPackagedApp = packagedExecutable !== undefined

/**
 * Launches the app with a hidden window, runs `body`, and always closes the app. Each launch gets its
 * own app data folder (so tests never touch the user's), unless `userDataDir` is passed to share one
 * across restarts, or is null to let the app choose its own (with `env` redirecting where that is).
 */
export async function withApp(
  body: (app: ElectronApplication, page: Page) => Promise<void>,
  options: {
    userDataDir?: string | null
    env?: Record<string, string>
    recordVideo?: { dir: string; size: { width: number; height: number } }
  } = {}
): Promise<void> {
  const [ownDir, cleanup] =
    options.userDataDir === undefined
      ? await makeTempDir('user-data')
      : [options.userDataDir, async () => {}]
  if (ownDir !== null) await isolateAgents(ownDir)
  // Test terminals run the user's real shell: keep what they type out of the user's history.
  const [historyDir, cleanHistory] = await makeTempDir('shell-history')
  const app = await electron.launch({
    ...launchTarget,
    ...(options.recordVideo ? { recordVideo: options.recordVideo } : {}),
    args: [
      ...(launchTarget.args ?? []),
      '--mute-audio',
      ...(ownDir === null ? [] : [`--user-data-dir=${ownDir}`])
    ],
    env: {
      ...process.env,
      HISTFILE: join(historyDir, 'history'),
      fish_private_mode: '1',
      ...options.env,
      APP_BACKGROUND_LAUNCH: '1'
    }
  })
  try {
    await body(app, await app.firstWindow())
  } finally {
    await app.close()
    await cleanup()
    await cleanHistory()
  }
}

/** Saves visual evidence to test-results/; nothing compares it to a baseline. */
export async function saveScreenshot(page: Page, name: string): Promise<void> {
  // Under xvfb a hidden window's first capture can fail or hang until a frame is composited, so each attempt is short.
  await expect(async () => {
    await page.screenshot({
      path: resolve(root, `test-results/${name}.png`),
      timeout: 1_000,
      // Hidden windows advance CSS transitions slowly; capture their end state.
      animations: 'disabled'
    })
  }).toPass({ timeout: 15_000 })
}

/** Tests that lock a folder need a user that folder permissions apply to: root ignores them. */
export function requireFolderPermissions(): void {
  if (process.getuid?.() === 0)
    throw new Error('Run the E2E suite as a normal user: root ignores folder permissions.')
}
