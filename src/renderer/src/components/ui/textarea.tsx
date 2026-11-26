import * as React from 'react'
import { cn } from '@/lib/class-names'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-control w-full rounded-component border border-input-border bg-transparent px-3 py-2 type-body transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error-border aria-invalid:ring-error-border',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
