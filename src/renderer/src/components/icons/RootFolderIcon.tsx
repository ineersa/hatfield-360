import { FolderGit2, FolderRoot } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useSettingsStore } from '@/state/settings-store'
import { CatppuccinIcon, CatppuccinRootFolderIcon } from './CatppuccinIcons'

/** A workspace project's root folder, drawn from the icon set in `workbench.iconTheme`. */
export function RootFolderIcon({
  open = false,
  multiRepo = false,
  className
}: {
  /** Expanded in the file tree; Lucide draws a root the same either way. */
  open?: boolean
  /** A multi-repo folder, which holds several repositories. */
  multiRepo?: boolean
  className?: string
}): React.JSX.Element {
  const iconTheme = useSettingsStore((state) => state.values['workbench.iconTheme'])
  if (iconTheme === 'lucide') {
    const Icon = multiRepo ? FolderGit2 : FolderRoot
    return (
      <Icon
        data-icon-theme="lucide"
        className={cn('text-muted-foreground', className)}
        strokeWidth={1.75}
        aria-hidden
      />
    )
  }
  return multiRepo ? (
    <CatppuccinIcon
      name={open ? 'folder_packages_open' : 'folder_packages'}
      data-icon-theme="catppuccin"
      className={className}
    />
  ) : (
    <CatppuccinRootFolderIcon open={open} data-icon-theme="catppuccin" className={className} />
  )
}
