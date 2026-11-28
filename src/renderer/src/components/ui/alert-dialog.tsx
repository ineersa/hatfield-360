import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import { TextContextMenu } from '@/components/text-menu/TextContextMenu'
import { cn } from '@/lib/class-names'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './action-button-classes'

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      {/* JetBrains dialogs don't dim the window; the overlay only keeps clicks off it. */}
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50"
      />
      {/* Its own text menu: the app's is outside the dialog's focus trap. */}
      <TextContextMenu>
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-popup border border-dialog-border bg-dialog p-5 shadow-lg sm:max-w-md',
            className
          )}
          {...props}
        />
      </TextContextMenu>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('type-section-title', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('type-description', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex justify-end gap-2', className)}
      {...props}
    />
  )
}

/** A choice that closes the dialog; `primary` marks the default one. */
function AlertDialogAction({
  className,
  primary = false,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & { primary?: boolean }) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(primary ? PRIMARY_BUTTON : SECONDARY_BUTTON, className)}
      {...props}
    />
  )
}

/** The choice that keeps things as they are; the dialog opens with it focused. */
function AlertDialogCancel({
  className,
  primary = false,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & { primary?: boolean }) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(primary ? PRIMARY_BUTTON : SECONDARY_BUTTON, className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
}
