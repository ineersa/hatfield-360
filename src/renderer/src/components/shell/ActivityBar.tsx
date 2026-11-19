import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { SHELL_VIEWS } from './shell-views'

export function ActivityBar(): React.JSX.Element {
  const activeView = useShellLayoutStore((state) => state.activeView)
  const panels = useShellLayoutStore((state) => state.panels)
  const activateView = useShellLayoutStore((state) => state.activateView)

  return (
    <nav
      aria-label="Views"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2"
    >
      {SHELL_VIEWS.map((view) => {
        const active = view.id === activeView
        const open = active && !panels[view.id].collapsed
        return (
          <Tooltip key={view.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={view.label}
                aria-pressed={active}
                aria-expanded={active ? open : undefined}
                onClick={() => activateView(view.id)}
                className={cn(
                  'text-muted-foreground',
                  active && 'text-foreground',
                  open &&
                    'bg-highlight text-highlight-foreground hover:bg-highlight/90 hover:text-highlight-foreground'
                )}
              >
                <view.Icon className="size-5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span className="font-medium">{view.label}</span>
              <span className="opacity-70"> · {view.description}</span>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}
