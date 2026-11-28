import { Columns2, Pin, PinOff, Plus, Rows2, SquareTerminal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ScrollingTabList } from '@/components/shell/ScrollingTabList'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { StripTab } from '@/components/shell/StripTab'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { terminalShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useTerminalStore } from '@/state/terminal-store'
import { useAgentSessionStore } from '@/state/agent-session-store'
import { closeUnlessPinned } from '@/state/pinned-close'
import { isPinned, pinnedIn, pinnedTabIds, stripOrder } from '@/state/pinned-sessions'
import { ContextMenuItem } from '@/components/ui/context-menu'
import {
  agentSessionIdentity,
  sessionState,
  statuses
} from '@/components/workspace/AgentSessionRows'
import { cn } from '@/lib/class-names'
import type { AgentSession } from '../../../../shared/agent-api'
import { pinKey } from '../../../../shared/pinned-session'
import type { TerminalCommand } from '../../../../shared/terminal-api'
import { PinnedCloseDialog } from './PinnedCloseDialog'
import { TerminalTabBody } from './TerminalTabBody'
import { runTerminalCommand } from './use-terminal-commands'

/** An icon button in the tab strip that runs a Terminal command, with its shortcut in the tooltip. */
function StripCommand({
  command,
  label,
  icon: Icon
}: {
  command: TerminalCommand
  label: string
  icon: typeof Plus
}): React.JSX.Element {
  const keymap = useKeymapStore((state) => state.shell)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => runTerminalCommand(command)}
          className="flex size-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}{' '}
        <span className="ml-1 text-tooltip-muted-foreground">
          {terminalShortcutLabel(keymap, command)}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

const dots = {
  working: 'bg-info',
  attention: 'bg-warning',
  idle: 'bg-success',
  scheduled: 'bg-foreground',
  stopped: 'bg-error'
} as const

/** A pinned tab's icon: its session's provider, with a dot in the session's status colour. */
function PinnedIcon({ session }: { session: AgentSession }): React.JSX.Element {
  const state = sessionState(session)
  return (
    <span className="relative flex shrink-0">
      <AgentProviderIcon provider={session.provider} className="size-4" />
      {state ? (
        <span
          aria-hidden
          className={cn(
            'absolute -top-0.5 -right-1 size-1.5 rounded-full ring-2 ring-frame',
            dots[state]
          )}
        />
      ) : null}
    </span>
  )
}

/** The session the tab's Pin item acts on: a pinned one (the active pane's first), else the active pane's. */
function menuSession(
  terminals: readonly string[],
  active: string | null,
  sessions: readonly AgentSession[],
  pinned: readonly string[]
): AgentSession | undefined {
  const live = sessions.filter(
    (session) =>
      session.process === 'running' &&
      session.providerSessionId !== null &&
      terminals.includes(session.terminalId)
  )
  const held = live.filter((session) => isPinned(session, pinned))
  return (
    held.find((session) => session.terminalId === active) ??
    held[0] ??
    live.find((session) => session.terminalId === active) ??
    live[0]
  )
}

/** Terminal tabs in the Agents view: a tab strip over each tab's split panes. */
export function TerminalTabs({ hidden }: { hidden: boolean }): React.JSX.Element {
  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const activateTab = useTerminalStore((state) => state.activateTab)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const keymap = useKeymapStore((state) => state.shell)
  const sessions = useAgentSessionStore((state) => state.sessions)
  const pinned = useTerminalStore((state) => state.pinned)
  const setPinned = useTerminalStore((state) => state.setPinned)
  const tabTerminals = useTerminalStore((state) => state.tabTerminals)
  const paneByTab = useTerminalStore((state) => state.paneByTab)
  const pinnedTabs = useMemo(
    () => pinnedTabIds(tabTerminals, sessions, pinned),
    [tabTerminals, sessions, pinned]
  )
  const ordered = stripOrder(tabs, pinnedTabs)
  const tabIds = ordered.map((tab) => tab.id)
  const [confirming, setConfirming] = useState<string[] | null>(null)
  // One tab closes as its close button does, asking first for a pinned one; several leave pinned
  // tabs open and end the others' shells and agents only once confirmed.
  const close = (ids: string[]) => {
    const [only] = ids
    if (ids.length === 1 && only !== undefined) {
      closeUnlessPinned(tabTerminals[only] ?? [], () => closeTab(only))
      return
    }
    const closable = ids.filter((id) => !pinnedTabs.has(id))
    if (closable.length > 1) setConfirming(closable)
    else closable.forEach((id) => closeTab(id))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-island" hidden={hidden}>
      {/* The active tab covers the strip's bottom line, so it reads as one piece with its panes. */}
      <div className="flex h-tab-bar shrink-0 items-stretch bg-frame shadow-[inset_0_-1px_0_var(--separator)]">
        <ScrollingTabList label="Terminals" selected={activeTabId}>
          {ordered.map((tab) => {
            const terminals = tabTerminals[tab.id] ?? []
            const held = pinnedIn(terminals, sessions, pinned)
            const [lead] = held
            const target = menuSession(terminals, paneByTab[tab.id] ?? null, sessions, pinned)
            const targetKey = target ? pinKey(target) : null
            const targetPinned = target !== undefined && isPinned(target, pinned)
            return (
              <StripTab
                key={tab.id}
                id={tab.id}
                menu={{
                  tabs: tabIds,
                  keep: pinnedTabs,
                  close,
                  renderItems: (choose) => (
                    <ContextMenuItem
                      disabled={targetKey === null}
                      onSelect={() =>
                        choose(() => {
                          if (targetKey) setPinned(targetKey, !targetPinned)
                        })
                      }
                    >
                      {targetPinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                      {targetPinned ? 'Unpin Session' : 'Pin Session'}
                    </ContextMenuItem>
                  )
                }}
                title={lead ? `${tab.title} · pinned` : tab.title}
                label={tab.label}
                active={tab.id === activeTabId}
                compact={lead !== undefined}
                icon={
                  lead ? (
                    <PinnedIcon session={lead} />
                  ) : tab.agent ? (
                    <AgentProviderIcon provider={tab.agent.provider} className="size-4" />
                  ) : (
                    <SquareTerminal className="size-4 shrink-0" aria-hidden />
                  )
                }
                tip={
                  <>
                    {held.map((session) => {
                      const state = sessionState(session)
                      return (
                        <div key={session.id}>
                          {agentSessionIdentity(session).displayName}
                          {state ? (
                            <span className="text-tooltip-muted-foreground">
                              {' · '}
                              {statuses[state].label}
                            </span>
                          ) : null}
                        </div>
                      )
                    })}
                    <div className={held.length ? 'text-tooltip-muted-foreground' : undefined}>
                      {tab.cwd ?? tab.title}
                    </div>
                    {held.length ? (
                      <div className="text-tooltip-muted-foreground">
                        Pinned · closing asks first
                      </div>
                    ) : null}
                    <div className="text-tooltip-muted-foreground">
                      Previous tab: {terminalShortcutLabel(keymap, 'previous-tab')}
                      {' · '}
                      Next tab: {terminalShortcutLabel(keymap, 'next-tab')}
                    </div>
                  </>
                }
                onActivate={() => activateTab(tab.id)}
                {...(lead ? {} : { onClose: () => closeTab(tab.id) })}
              />
            )
          })}
        </ScrollingTabList>
        <div className="flex flex-1 items-center gap-0.5 px-2">
          <StripCommand command="new-terminal" label="New Terminal" icon={Plus} />
          <div className="flex-1" />
          <StripCommand command="split-right" label="Split Right" icon={Columns2} />
          <StripCommand command="split-down" label="Split Down" icon={Rows2} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <TerminalTabBody
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            shown={tab.id === activeTabId && !hidden}
          />
        ))}
      </div>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Close {confirming?.length ?? 0} terminals?</AlertDialogTitle>
          <AlertDialogDescription>
            Their shells, and any agents running in them, will stop.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              primary
              autoFocus
              onClick={() => {
                for (const id of confirming ?? []) closeTab(id)
              }}
            >
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PinnedCloseDialog />
    </div>
  )
}
