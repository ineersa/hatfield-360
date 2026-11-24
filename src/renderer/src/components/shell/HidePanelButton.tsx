import { PanelLeftClose } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import type { ShellViewId } from '../../../../shared/shell-layout-api'

/** Collapses a view's side panel from its own header; the view's rail button brings it back. */
export function HidePanelButton({ view }: { view: ShellViewId }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Hide Side Panel"
          onClick={() => useShellLayoutStore.getState().hidePanel(view)}
          className="flex size-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <PanelLeftClose className="size-4.5" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Hide Side Panel</TooltipContent>
    </Tooltip>
  )
}
