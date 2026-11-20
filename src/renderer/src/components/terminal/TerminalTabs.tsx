import { Columns2, Plus, Rows2, SquareTerminal, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { terminalShortcutLabel } from '@/lib/terminal-shortcut-label'
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
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => runTerminalCommand(command)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} <span className="ml-1 text-muted-foreground">{terminalShortcutLabel(command)}</span>
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

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl" hidden={hidden}>
      {/* The active tab covers the strip's bottom line, so it reads as one piece with its panes. */}
      <div className="flex h-10 shrink-0 items-stretch bg-background shadow-[inset_0_-1px_0_var(--border)]">
        <div
          role="tablist"
          aria-label="Terminals"
          className="flex min-w-0 items-stretch overflow-x-auto"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={cn(
                  'group flex max-w-60 min-w-0 shrink-0 items-center gap-2 border-r border-border pr-2 pl-3.5 select-none',
                  active
                    ? 'bg-island text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <SquareTerminal className="size-4 shrink-0" aria-hidden />
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.cwd ?? undefined}
                  onClick={() => activateTab(tab.id)}
                  className="min-w-0 truncate outline-none focus-visible:underline"
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => closeTab(tab.id)}
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
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
