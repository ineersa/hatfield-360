import { Copy, MessageCircleQuestion } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ContextMenuItem, ContextMenuShortcut } from '@/components/ui/context-menu'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useChatStore } from '@/state/chat-store'
import { type HunkTab, hunkTerminalOf } from '@/state/hunk-tab-store'
import { notify } from '@/state/notification-store'
import type { HunkSessionView } from '../../../../shared/source-control-api'

function Item({
  icon,
  label,
  unavailable,
  onSelect
}: {
  icon: ReactNode
  label: string
  /** Why it can't run now, shown in place of a shortcut; false when it can. */
  unavailable: string | false
  onSelect: () => void
}): React.JSX.Element {
  return (
    <ContextMenuItem disabled={unavailable !== false} onSelect={onSelect}>
      {icon}
      {label}
      {unavailable === false ? null : <ContextMenuShortcut>{unavailable}</ContextMenuShortcut>}
    </ContextMenuItem>
  )
}

const failed = (title: string) => (error: unknown) =>
  notify({ severity: 'error', title, body: mainErrorMessage(error) })

async function copySession(session: string): Promise<void> {
  await window.desktop.writeTerminalClipboard(session).catch(failed("Couldn't copy"))
}

async function askInChat(tab: HunkTab, terminalId: string): Promise<void> {
  const ask = await window.desktop.askAboutHunk(terminalId).catch((error: unknown) => {
    failed("Couldn't read hunk's notes")(error)
    return null
  })
  if (ask === null) return
  if (ask.status === 'none') {
    notify({ severity: 'info', title: 'Nothing to ask', body: `${ask.reason}.` })
    return
  }
  useChatStore.getState().ask(tab.root, ask.prompt)
}

/**
 * A hunk tab's own menu items: copying its hunk session ID, for an agent already working on the
 * code, and asking a chat about the `?` questions in the hunk selected in hunk. Read when the menu
 * opens: hunk may have started, quit or moved since.
 */
export function HunkTabMenuItems({
  tab,
  choose
}: {
  tab: HunkTab
  choose: (action: () => void) => void
}): React.JSX.Element {
  const terminalId = hunkTerminalOf(tab.id)
  const [read, setRead] = useState<HunkSessionView | 'reading'>('reading')
  useEffect(() => {
    if (terminalId === undefined) return undefined
    let current = true
    void window.desktop
      .hunkSession(terminalId)
      .catch((): HunkSessionView => ({ session: null }))
      .then((view) => {
        if (current) setRead(view)
      })
    return () => {
      current = false
    }
  }, [terminalId])
  const view: HunkSessionView | 'reading' = terminalId === undefined ? { session: null } : read

  const notRunning = view === 'reading' ? 'Reading…' : view.session === null && 'hunk isn’t running'
  const session = view !== 'reading' && view.session !== null ? view.session : null
  const askable =
    notRunning ||
    (view !== 'reading' && view.session !== null && view.questions === 0
      ? (view.reason ?? 'No ? questions in this hunk')
      : false)
  return (
    <>
      <Item
        icon={<Copy aria-hidden />}
        label="Copy Hunk Session ID"
        unavailable={notRunning}
        onSelect={() => choose(() => session !== null && void copySession(session))}
      />
      <Item
        icon={<MessageCircleQuestion aria-hidden />}
        label="Ask in Chat About This Hunk"
        unavailable={askable}
        onSelect={() => choose(() => terminalId !== undefined && void askInChat(tab, terminalId))}
      />
    </>
  )
}
