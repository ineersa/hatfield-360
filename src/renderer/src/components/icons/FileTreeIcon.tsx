import { File, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useSettingsStore } from '@/state/settings-store'
import { fileIconName, folderIconName } from './catppuccin-icon-set'
import { CatppuccinIcon } from './CatppuccinIcons'

/**
 * A file tree entry's icon, drawn from the icon set in `workbench.iconTheme`: Catppuccin picks one
 * by the file or folder name, Lucide has one per kind.
 */
export function FileTreeIcon({
  kind,
  name,
  open = false,
  className
}: {
  kind: 'file' | 'folder'
  name: string
  open?: boolean
  className?: string
}): React.JSX.Element {
  const iconTheme = useSettingsStore((state) => state.values['workbench.iconTheme'])
  if (iconTheme === 'lucide') {
    const Icon = kind === 'file' ? File : open ? FolderOpen : Folder
    return (
      <Icon
        data-icon-theme="lucide"
        className={cn('text-muted-foreground', className)}
        strokeWidth={1.75}
        aria-hidden
      />
    )
  }
  return (
    <CatppuccinIcon
      name={kind === 'file' ? fileIconName(name) : folderIconName(name, open)}
      data-icon-theme="catppuccin"
      className={className}
    />
  )
}
