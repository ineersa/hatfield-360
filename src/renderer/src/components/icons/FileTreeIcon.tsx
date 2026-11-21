import { File, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useSettingsStore } from '@/state/settings-store'
import {
  CatppuccinFileIcon,
  CatppuccinFolderIcon,
  CatppuccinFolderOpenIcon
} from './CatppuccinIcons'

type Kind = 'folder' | 'folder-open' | 'file'

const LUCIDE = { folder: Folder, 'folder-open': FolderOpen, file: File } as const
const CATPPUCCIN = {
  folder: CatppuccinFolderIcon,
  'folder-open': CatppuccinFolderOpenIcon,
  file: CatppuccinFileIcon
} as const

/** A file tree entry's icon, drawn from the icon set in `workbench.iconTheme`. */
export function FileTreeIcon({
  kind,
  className
}: {
  kind: Kind
  className?: string
}): React.JSX.Element {
  const iconTheme = useSettingsStore((state) => state.values['workbench.iconTheme'])
  if (iconTheme === 'lucide') {
    const Icon = LUCIDE[kind]
    return (
      <Icon
        data-icon-theme="lucide"
        className={cn('text-muted-foreground', className)}
        strokeWidth={1.75}
        aria-hidden
      />
    )
  }
  const Icon = CATPPUCCIN[kind]
  return <Icon data-icon-theme="catppuccin" className={className} />
}
