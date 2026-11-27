import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentShellCommand, expandHome } from './agent-shell-command'

describe('expandHome', () => {
  it('expands only ~ and a leading ~/', () => {
    expect(expandHome('~', '/home/me')).toBe('/home/me')
    expect(expandHome('~/bin/hatfield.phar', '/home/me')).toBe(
      join('/home/me', 'bin', 'hatfield.phar')
    )
  })

  it('keeps every other tilde and variable literal', () => {
    for (const literal of ['~user/x', 'a~/b', '--flag=~/x', '$HOME/x', '~~/x', 'x~']) {
      expect(expandHome(literal, '/home/me')).toBe(literal)
    }
  })
})

it('runs a profile with a home-relative script and keeps the startup quiet when asked', () => {
  const zsh = { file: '/bin/zsh', args: [] }
  const profile = { executable: 'php', args: ['~/bin/hatfield.phar', '~user'] }
  const quiet = agentShellCommand(profile, '/projects/app', zsh, { quietStartup: true })
  expect(quiet.args.slice(1)).toEqual([
    'cd -- "$1" && shift && exec -- "$@" 1>&3 3>&-',
    'hatfield-360',
    '/projects/app',
    'php',
    expandHome('~/bin/hatfield.phar'),
    '~user'
  ])
  expect(agentShellCommand(profile, '/projects/app', zsh).args[1]).toBe(
    'cd -- "$1" && shift && exec -- "$@"'
  )
})
