import { Columns2, Plus, Rows2, SquareTerminal } from 'lucide-react'
import { ScrollingTabList } from '@/components/shell/ScrollingTabList'
import { StripTab } from '@/components/shell/StripTab'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { terminalShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useTerminalStore } from '@/state/terminal-store'
import type { TerminalCommand } from '../../../../shared/terminal-api'
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

/** Terminal tabs in the Agents view: a tab strip over each tab's split panes. */
export function TerminalTabs({ hidden }: { hidden: boolean }): React.JSX.Element {
  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const activateTab = useTerminalStore((state) => state.activateTab)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const keymap = useKeymapStore((state) => state.shell)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-island" hidden={hidden}>
      {/* The active tab covers the strip's bottom line, so it reads as one piece with its panes. */}
      <div className="flex h-tab-bar shrink-0 items-stretch bg-frame shadow-[inset_0_-1px_0_var(--separator)]">
        <ScrollingTabList label="Terminals" selected={activeTabId}>
          {tabs.map((tab) => (
            <StripTab
              key={tab.id}
              title={tab.title}
              label={tab.label}
              active={tab.id === activeTabId}
              icon={
                tab.agent ? (
                  <AgentProviderIcon provider={tab.agent.provider} className="size-4" />
                ) : (
                  <SquareTerminal className="size-4 shrink-0" aria-hidden />
                )
              }
              tip={
                <>
                  <div>{tab.cwd ?? tab.title}</div>
                  <div className="text-tooltip-muted-foreground">
                    Previous tab: {terminalShortcutLabel(keymap, 'previous-tab')}
                    {' · '}
                    Next tab: {terminalShortcutLabel(keymap, 'next-tab')}
                  </div>
                </>
              }
              onActivate={() => activateTab(tab.id)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
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
    </div>
  )
}
