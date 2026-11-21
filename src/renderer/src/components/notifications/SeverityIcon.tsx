import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/class-names'
import type { NotificationSeverity } from '@/state/notification-store'

const ICONS = {
  error: { Icon: CircleAlert, className: 'text-error', label: 'Error' },
  warning: { Icon: TriangleAlert, className: 'text-warning', label: 'Warning' },
  info: { Icon: Info, className: 'text-info', label: 'Info' }
} as const

export function SeverityIcon({
  severity,
  className
}: {
  severity: NotificationSeverity
  className?: string
}): React.JSX.Element {
  const { Icon, className: colour, label } = ICONS[severity]
  return <Icon role="img" aria-label={label} className={cn('size-4 shrink-0', colour, className)} />
}
