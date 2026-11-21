import {
  File,
  FileArchive,
  FileAudio,
  FileChartColumn,
  FileCode,
  FileCog,
  FileDiff,
  FileDatabase,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderArchive,
  FolderBookmark,
  FolderCheck,
  FolderCode,
  FolderCog,
  FolderGit,
  FolderKey,
  FolderOpen,
  FolderOutput,
  type LucideIcon,
  type LucideProps
} from 'lucide-react'
import { createElement } from 'react'
import { cn } from '@/lib/class-names'
import { useSettingsStore } from '@/state/settings-store'
import { fileIconName, folderIconName } from './catppuccin-icon-set'
import { CatppuccinIcon } from './CatppuccinIcons'
import {
  type FileCategory,
  type FolderCategory,
  fileCategory,
  folderCategory
} from './lucide-icon-category'

const LUCIDE_FILES: Record<FileCategory, LucideIcon> = {
  archive: FileArchive,
  audio: FileAudio,
  code: FileCode,
  config: FileCog,
  data: FileChartColumn,
  database: FileDatabase,
  diff: FileDiff,
  file: File,
  font: FileType,
  image: FileImage,
  json: FileJson,
  key: FileKey,
  lock: FileLock,
  shell: FileTerminal,
  spreadsheet: FileSpreadsheet,
  text: FileText,
  video: FileVideo
}

/** Lucide has no open variants of these; a plain folder shows open as `FolderOpen`. */
const LUCIDE_FOLDERS: Record<FolderCategory, LucideIcon> = {
  build: FolderOutput,
  code: FolderCode,
  config: FolderCog,
  dependencies: FolderArchive,
  docs: FolderBookmark,
  folder: Folder,
  git: FolderGit,
  key: FolderKey,
  tests: FolderCheck
}

/** The Lucide icon for an entry, with a name for it (`file-code`, `folder-open`). */
function lucideIcon(kind: 'file' | 'folder', name: string, open: boolean): [string, LucideIcon] {
  if (kind === 'file') {
    const category = fileCategory(name)
    return [`file-${category}`, LUCIDE_FILES[category]]
  }
  const category = folderCategory(name)
  return category === 'folder' && open
    ? ['folder-open', FolderOpen]
    : [`folder-${category}`, LUCIDE_FOLDERS[category]]
}

/**
 * A file tree entry's icon, picked by the file or folder name from the icon set in
 * `workbench.iconTheme`: Catppuccin has one per language and tool, Lucide one per category.
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
    const [icon, Icon] = lucideIcon(kind, name, open)
    const props: LucideProps & Record<`data-${string}`, string> = {
      'data-icon-theme': 'lucide',
      'data-icon': icon,
      className: cn('text-muted-foreground', className),
      strokeWidth: 1.75,
      'aria-hidden': true
    }
    return createElement(Icon, props)
  }
  return (
    <CatppuccinIcon
      name={kind === 'file' ? fileIconName(name) : folderIconName(name, open)}
      data-icon-theme="catppuccin"
      className={className}
    />
  )
}
