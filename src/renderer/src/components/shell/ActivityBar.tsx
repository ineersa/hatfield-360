import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { SHELL_VIEWS } from './shell-views'

export function ActivityBar(): React.JSX.Element {
  const activeView = useShellLayoutStore((state) => state.activeView)
  const panels = useShellLayoutStore((state) => state.panels)
  const activateView = useShellLayoutStore((state) => state.activateView)

  return (
    <nav aria-label="Views" className="flex w-14 shrink-0 flex-col items-center gap-1.5 pt-0.5">
      {SHELL_VIEWS.map((view) => {
        const active = view.id === activeView
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
                  'flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active && 'text-foreground',
                  open &&
                    'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                )}
              >
                <view.Icon className="size-[22px]" strokeWidth={1.75} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span className="font-medium">{view.label}</span>
              <span className="text-muted-foreground"> · {view.description}</span>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}
