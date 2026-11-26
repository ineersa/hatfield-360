import { describe, expect, it } from 'vitest'
import {
  appendToPlaybook,
  instructionsForPrompt,
  mapBlockFromReply,
  replaceSection,
  SECTION_CAPS
} from './workspace-map-document'

const file = [
  'My rules: be brief.',
  '',
  '<!-- workspace -->',
  'old map',
  '<!-- /workspace -->',
  '',
  'More of my text.',
  '',
  '<!-- playbook -->',
  '- run pnpm check',
  '<!-- /playbook -->',
  ''
].join('\n')

describe('replaceSection', () => {
  it('replaces only the workspace block, keeping the user text and the playbook', () => {
    expect(replaceSection(file, 'workspace', 'new map')).toBe(file.replace('old map', 'new map'))
  })

  it('adds a missing block after the user text', () => {
    expect(replaceSection('My rules.\n', 'workspace', 'map')).toBe(
      'My rules.\n\n<!-- workspace -->\nmap\n<!-- /workspace -->\n'
    )
  })

  it('writes a block into an empty file', () => {
    expect(replaceSection('', 'workspace', 'map')).toBe(
      '<!-- workspace -->\nmap\n<!-- /workspace -->\n'
    )
  })
})

describe('appendToPlaybook', () => {
  it('adds an entry after the existing ones', () => {
    expect(appendToPlaybook(file, 'use castor for builds')).toEqual({
      status: 'saved',
      text: file.replace('- run pnpm check', '- run pnpm check\n- use castor for builds')
    })
  })

  it('creates the playbook when the file has none, joining a multi-line entry', () => {
    expect(appendToPlaybook('Rules.', 'first\nsecond')).toEqual({
      status: 'saved',
      text: 'Rules.\n\n<!-- playbook -->\n- first second\n<!-- /playbook -->\n'
    })
  })

  it('refuses an entry past the cap and leaves the file alone', () => {
    const full = replaceSection('', 'playbook', `- ${'x'.repeat(SECTION_CAPS.playbook - 10)}`)
    expect(appendToPlaybook(full, 'one more learning')).toEqual({ status: 'full' })
  })
})

describe('mapBlockFromReply', () => {
  it('takes the text between the markers', () => {
    expect(
      mapBlockFromReply('Here it is:\n<!-- workspace -->\n# Map\n<!-- /workspace -->\nDone.')
    ).toBe('# Map')
  })

  it('takes the whole reply when it has no markers', () => {
    expect(mapBlockFromReply('\n# Map\n')).toBe('# Map')
  })
})

describe('instructionsForPrompt', () => {
  it('caps an oversized section a user pasted in', () => {
    const big = replaceSection('', 'playbook', 'x'.repeat(SECTION_CAPS.playbook)).replace(
      'x',
      'x'.repeat(100)
    )
    expect(instructionsForPrompt(big)).toBe(
      replaceSection('', 'playbook', 'x'.repeat(SECTION_CAPS.playbook)).trim()
    )
  })
})
