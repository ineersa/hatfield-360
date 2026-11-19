import { describe, expect, it } from 'vitest'
import { parseWorkspaceDocument, serializeWorkspaceDocument } from './workspace-document'

describe('parseWorkspaceDocument', () => {
  it('reads folders from a valid file and round-trips through serialize', () => {
    const text =
      '{\n  "version": 1,\n  "folders": [\n    {\n      "path": "/home/me/app"\n    }\n  ]\n}\n'
    const parsed = parseWorkspaceDocument(text)
    expect(parsed).toEqual({
      status: 'ok',
      document: { version: 1, folders: [{ path: '/home/me/app' }] }
    })
    expect(serializeWorkspaceDocument({ version: 1, folders: [{ path: '/home/me/app' }] })).toBe(
      text
    )
  })

  it('drops repeated folders, keeping the first', () => {
    const parsed = parseWorkspaceDocument(
      '{"version":1,"folders":[{"path":"/a"},{"path":"/b"},{"path":"/a"}]}'
    )
    expect(parsed).toEqual({
      status: 'ok',
      document: { version: 1, folders: [{ path: '/a' }, { path: '/b' }] }
    })
  })

  it('reports truncated JSON, wrong shapes and bad entries as corrupt', () => {
    expect(parseWorkspaceDocument('{"version":1,"fol')).toEqual({
      status: 'corrupt',
      reason: 'not valid JSON'
    })
    expect(parseWorkspaceDocument('[]')).toEqual({ status: 'corrupt', reason: 'not a JSON object' })
    expect(parseWorkspaceDocument('{"folders":[]}')).toEqual({
      status: 'corrupt',
      reason: 'missing or invalid version'
    })
    expect(parseWorkspaceDocument('{"version":1,"folders":{}}')).toEqual({
      status: 'corrupt',
      reason: 'folders is not a list'
    })
    expect(parseWorkspaceDocument('{"version":1,"folders":[{"path":3}]}')).toEqual({
      status: 'corrupt',
      reason: 'a folder entry has no path'
    })
  })

  it('recognizes a file from a newer app version instead of calling it corrupt', () => {
    expect(parseWorkspaceDocument('{"version":2,"folders":[],"layout":{}}')).toEqual({
      status: 'newer',
      version: 2
    })
  })
})
