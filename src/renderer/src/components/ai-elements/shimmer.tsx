import { cn } from '@/lib/class-names'
import { motion } from 'motion/react'

import { memo, useMemo } from 'react'

// Motion's elements are made once here: one made during render would remount every time.
const MOTION_ELEMENTS = { p: motion.p, span: motion.span, div: motion.div } as const

export type TextShimmerProps = {
  children: string
  as?: keyof typeof MOTION_ELEMENTS
  className?: string
  duration?: number
  spread?: number
}

const ShimmerComponent = ({
  children,
  as: element = 'p',
  className,
  duration = 2,
  spread = 2
}: TextShimmerProps) => {
  const MotionComponent = MOTION_ELEMENTS[element]

  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread])

  return (
    <MotionComponent
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
        'bg-no-repeat',
        className
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={{
        backgroundImage: `linear-gradient(90deg, transparent calc(50% - ${dynamicSpread}px), var(--color-foreground), transparent calc(50% + ${dynamicSpread}px)), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))`
      }}
      transition={{
        duration,
        ease: 'linear',
        repeat: Number.POSITIVE_INFINITY
      }}
    >
      {children}
    </MotionComponent>
  )
}

export const Shimmer = memo(ShimmerComponent)
