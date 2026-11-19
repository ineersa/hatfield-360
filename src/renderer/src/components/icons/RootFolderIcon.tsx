import { FolderRoot } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useSettingsStore } from '@/state/settings-store'
import { CatppuccinRootFolderIcon } from './CatppuccinIcons'

/** A workspace project's root folder, drawn from the icon set in `workbench.iconTheme`. */
export function RootFolderIcon({ className }: { className?: string }): React.JSX.Element {
  const iconTheme = useSettingsStore((state) => state.values['workbench.iconTheme'])
  return iconTheme === 'lucide' ? (
    <FolderRoot
      data-icon-theme="lucide"
      className={cn('text-muted-foreground', className)}
      strokeWidth={1.75}
      aria-hidden
    />
  ) : (
    <CatppuccinRootFolderIcon data-icon-theme="catppuccin" className={className} />
  )
}
