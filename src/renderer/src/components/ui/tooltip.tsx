import { type ComponentProps, type PointerEvent, useCallback, useRef, useState } from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { cn } from '@/lib/class-names'

export function TooltipProvider({
  delayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>): React.JSX.Element {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

export function TooltipTrigger(
  props: ComponentProps<typeof TooltipPrimitive.Trigger>
): React.JSX.Element {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

export function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'type-tooltip z-50 w-fit max-w-[min(36rem,var(--radix-tooltip-content-available-width))] rounded-popup border border-tooltip-border bg-tooltip px-2.5 py-1.5 break-words shadow-lg',
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/** Below the pointer, clear of the cursor arrow. */
const BELOW_POINTER_PX = 20

type PointerPlacement = Pick<
  ComponentProps<typeof TooltipPrimitive.Content>,
  'side' | 'align' | 'sideOffset' | 'alignOffset'
>

/**
 * Opens a tooltip just under the mouse pointer instead of beside its trigger:
 * spread `track` on the trigger, `onOpenChange` on the Tooltip and `placement` on the content.
 */
export function usePointerTooltip(): {
  track: (event: PointerEvent<HTMLElement>) => void
  onOpenChange: (open: boolean) => void
  placement: PointerPlacement
} {
  const last = useRef<{ x: number; y: number; rect: DOMRect } | null>(null)
  const [offsets, setOffsets] = useState({ sideOffset: 0, alignOffset: 0 })
  const track = useCallback((event: PointerEvent<HTMLElement>) => {
    last.current = {
      x: event.clientX,
      y: event.clientY,
      rect: event.currentTarget.getBoundingClientRect()
    }
  }, [])
  const onOpenChange = useCallback((open: boolean) => {
    const pointer = last.current
    if (!open || !pointer) return
    setOffsets({
      sideOffset: pointer.y - pointer.rect.bottom + BELOW_POINTER_PX,
      alignOffset: pointer.x - pointer.rect.left
    })
  }, [])
  return { track, onOpenChange, placement: { side: 'bottom', align: 'start', ...offsets } }
}
