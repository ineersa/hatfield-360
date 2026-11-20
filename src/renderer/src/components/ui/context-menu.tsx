import type { ComponentProps } from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { cn } from '@/lib/class-names'

export function ContextMenu(
  props: ComponentProps<typeof ContextMenuPrimitive.Root>
): React.JSX.Element {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

export function ContextMenuTrigger(
  props: ComponentProps<typeof ContextMenuPrimitive.Trigger>
): React.JSX.Element {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          'type-menu-item z-50 min-w-48 overflow-hidden rounded-popup border border-popover-border bg-popover p-1 shadow-lg',
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        'flex h-list-row cursor-default items-center gap-2 rounded-component px-2 outline-hidden select-none focus:bg-popover-selection focus:text-popover-selection-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-separator', className)}
      {...props}
    />
  )
}

export function ContextMenuShortcut({
  className,
  ...props
}: ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn('type-shortcut ml-auto pl-6', className)}
      {...props}
    />
  )
}
