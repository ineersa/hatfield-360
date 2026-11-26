import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/class-names'
import { Slot } from 'radix-ui'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-component type-body whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error-border aria-invalid:ring-error-border [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary',
        destructive:
          'bg-error text-primary-foreground hover:bg-error focus-visible:ring-error-border',
        outline: 'border bg-island hover:bg-hover hover:text-foreground',
        secondary: 'bg-button text-button-foreground hover:bg-hover',
        ghost: 'hover:bg-hover hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-control px-4 py-2 has-[>svg]:px-3',
        xs: "h-tree-row gap-1 rounded-component px-2 type-hint has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-control gap-1.5 rounded-component px-3 has-[>svg]:px-2.5',
        lg: 'h-control rounded-component px-6 has-[>svg]:px-4',
        icon: 'size-icon-button',
        'icon-xs': "size-small-icon-button rounded-component [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-icon-button',
        'icon-lg': 'size-icon-button'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
