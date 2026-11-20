import { describe, expect, it } from 'vitest'
import { terminalEnvironment } from './terminal-environment'

const options = { platform: 'linux', appVersion: '1.2.3' } as const

describe('terminalEnvironment', () => {
  it("drops the app's own runtime and colour settings and advertises the terminal", () => {
    const env = terminalEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1',
        APP_BACKGROUND_LAUNCH: '1',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CLICOLOR: '0',
        DBUS_SESSION_BUS_ADDRESS: 'disabled:',
        TERM: 'dumb'
      },
      options
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Hatfield360',
      TERM_PROGRAM_VERSION: '1.2.3',
      FORCE_HYPERLINK: '1',
      LANG: 'en_US.UTF-8'
    })
  })

  it("keeps the user's locale, colour forcing and session bus", () => {
    const env = terminalEnvironment(
      { LANG: 'de_DE.UTF-8', FORCE_COLOR: '3', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus' },
      options
    )
    expect(env).toMatchObject({
      LANG: 'de_DE.UTF-8',
      FORCE_COLOR: '3',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus'
    })
  })

  it("removes an AppImage's mount from PATH and its runtime variables", () => {
    const env = terminalEnvironment(
      {
        APPIMAGE: '/home/me/Hatfield.AppImage',
        APPDIR: '/tmp/.mount_HatfiX/',
        ARGV0: 'Hatfield.AppImage',
        OWD: '/home/me',
        PATH: '/tmp/.mount_HatfiX/usr/bin:/usr/local/bin:/tmp/.mount_HatfiX:/usr/bin',
        LD_LIBRARY_PATH: '/tmp/.mount_HatfiX/usr/lib'
      },
      options
    )
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin')
    for (const key of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'LD_LIBRARY_PATH']) {
      expect(env).not.toHaveProperty(key)
    }
  })

  it('asks Python for UTF-8 on Windows only', () => {
    expect(terminalEnvironment({}, { ...options, platform: 'win32' }).PYTHONUTF8).toBe('1')
    expect(terminalEnvironment({}, options)).not.toHaveProperty('PYTHONUTF8')
  })
})
