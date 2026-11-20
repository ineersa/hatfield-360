import { Settings } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { SHELL_VIEWS } from './shell-views'

export function ActivityBar(): React.JSX.Element {
  const activeView = useShellLayoutStore((state) => state.activeView)
  const panels = useShellLayoutStore((state) => state.panels)
  const activateView = useShellLayoutStore((state) => state.activateView)
  const settingsOpen = useShellLayoutStore((state) => state.settingsOpen)
  const openSettings = useShellLayoutStore((state) => state.openSettings)

  return (
    <nav
      aria-label="Views"
      className="flex w-activity-bar shrink-0 flex-col items-center gap-1.5 pt-0.5 pb-1.5"
    >
      {SHELL_VIEWS.map((view) => {
        const active = view.id === activeView && !settingsOpen
        const open = active && !panels[view.id].collapsed
        return (
          <Tooltip key={view.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={view.label}
                aria-pressed={active}
                aria-expanded={active ? open : undefined}
                onClick={() => activateView(view.id)}
                className={cn(
                  'flex size-activity-button items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active && 'text-foreground',
                  open &&
                    'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                )}
              >
                <view.Icon className="size-5.5" strokeWidth={1.75} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span className="type-tooltip-title">{view.label}</span>
              <span className="text-tooltip-muted-foreground"> · {view.description}</span>
            </TooltipContent>
          </Tooltip>
        )
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Settings"
            aria-pressed={settingsOpen}
            onClick={openSettings}
            className={cn(
              'mt-auto flex size-activity-button items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              settingsOpen &&
                'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
            )}
          >
            <Settings className="size-5.5" strokeWidth={1.75} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span className="type-tooltip-title">Settings</span>
        </TooltipContent>
      </Tooltip>
    </nav>
  )
}
