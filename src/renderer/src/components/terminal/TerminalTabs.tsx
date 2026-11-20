import { Plus, SquareTerminal, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useTerminalStore } from '@/state/terminal-store'
import { TerminalTabBody } from './TerminalTabBody'

/** Terminal tabs in the Agents view: a tab strip over each tab's split panes. */
export function TerminalTabs({ hidden }: { hidden: boolean }): React.JSX.Element {
  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const activateTab = useTerminalStore((state) => state.activateTab)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const openTerminal = useTerminalStore((state) => state.openTerminal)
  const activeCwd = tabs.find((tab) => tab.id === activeTabId)?.cwd ?? null

  return (
    <div className="flex min-w-0 flex-1 flex-col" hidden={hidden}>
      <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto px-2 pt-1.5">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 items-end gap-1">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={cn(
                  'group flex h-8 max-w-56 min-w-0 items-center gap-1.5 rounded-t-lg pr-1 pl-3 select-none',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                )}
              >
                <SquareTerminal className="size-4 shrink-0" aria-hidden />
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.cwd ?? undefined}
                  onClick={() => activateTab(tab.id)}
                  className="min-w-0 truncate text-ui-sm outline-none focus-visible:underline"
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => closeTab(tab.id)}
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New Terminal"
              onClick={() => openTerminal(activeCwd)}
              className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Terminal</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        {tabs.map((tab) => (
          <TerminalTabBody key={tab.id} tab={tab} active={tab.id === activeTabId} />
        ))}
      </div>
    </div>
  )
}
