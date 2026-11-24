import { expect, test } from 'vitest'
import {
  isWritableTerminalWorkspace,
  parseTerminalLayout,
  parseTerminalWorkspace
} from './terminal-workspace-document'

const tab = '00000000-0000-0000-0000-000000000001'
const pane = '00000000-0000-0000-0000-000000000002'

test('a corrupted checkpoint recovers a valid sibling pane without accepting it as a renderer checkpoint', () => {
  const leaf = { kind: 'pane', id: pane, conversation: null }
  const layout = {
    activeTabId: tab,
    tabs: [
      {
        id: tab,
        label: 'project',
        cwd: '/tmp/project',
        activePane: pane,
        layout: {
          kind: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: leaf,
          second: { ...leaf, id: 'bad' }
        }
      }
    ]
  }
  const document = { version: 1, layout, conversations: [] }
  expect(parseTerminalLayout(layout, true)).toBeNull()
  const recovered = parseTerminalWorkspace(document)
  expect(recovered?.layout).toEqual({
    activeTabId: tab,
    tabs: [{ ...layout.tabs[0], layout: leaf }]
  })
  if (!recovered) throw new Error('Expected the healthy pane to survive')
  expect(isWritableTerminalWorkspace(document, recovered)).toBe(false)
  expect(parseTerminalWorkspace({ ...document, version: 2 })).toBeNull()
})
