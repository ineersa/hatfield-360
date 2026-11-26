import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lookedUpPath } from './chat-agent-launch'

describe('lookedUpPath', () => {
  it('takes a path as printed', () => {
    expect(lookedUpPath('/usr/local/bin/claude')).toBe('/usr/local/bin/claude')
  })

  it("takes an alias's command, as bash and zsh print it, with ~ expanded", () => {
    expect(lookedUpPath("alias claude='/opt/claude/bin/claude --verbose'")).toBe(
      '/opt/claude/bin/claude'
    )
    expect(lookedUpPath('claude=~/.claude/local/claude')).toBe(
      join(homedir(), '.claude', 'local', 'claude')
    )
  })

  it('refuses anything that names no absolute path', () => {
    expect(lookedUpPath('claude')).toBeNull()
    expect(lookedUpPath("alias claude='npx claude'")).toBeNull()
    expect(lookedUpPath(null)).toBeNull()
  })
})
