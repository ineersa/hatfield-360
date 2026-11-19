import { FileX, FolderOpen, FolderX, House, Layers, X } from 'lucide-react'
import { CatppuccinRootFolderIcon } from '@/components/icons/CatppuccinIcons'
import { cn } from '@/lib/class-names'
import { useWorkspaceStore } from '@/state/workspace-store'
import type { RecentEntry } from '../../../../shared/workspace-api'

function RecentIcon({ entry }: { entry: RecentEntry }): React.JSX.Element {
  const className = 'size-[18px] shrink-0'
  if (entry.missing) {
    const Missing = entry.kind === 'folder' ? FolderX : FileX
    return <Missing className={cn(className, 'text-destructive')} aria-hidden />
  }
  if (entry.kind === 'folder') return <CatppuccinRootFolderIcon className={className} />
  const Icon = entry.kind === 'default' ? House : Layers
  return <Icon className={cn(className, 'text-muted-foreground')} aria-hidden />
}

function RecentRow({ entry }: { entry: RecentEntry }): React.JSX.Element {
  const openRecent = useWorkspaceStore((state) => state.openRecent)
  const removeRecent = useWorkspaceStore((state) => state.removeRecent)
  const name = entry.missing ? `${entry.name} (missing)` : entry.name
  return (
    <li
      className={cn(
        'group flex items-center gap-1 rounded-lg',
        !entry.current && 'hover:bg-accent focus-within:bg-accent'
      )}
    >
      <button
        type="button"
        aria-label={name}
        disabled={entry.missing || entry.current}
        onClick={() => void openRecent(entry)}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left outline-none disabled:cursor-default focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RecentIcon entry={entry} />
        <span
          className={cn(
            'shrink-0 font-semibold',
            entry.missing && 'font-medium text-muted-foreground line-through'
          )}
        >
          {entry.name}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {entry.stored ? 'Saved in Hatfield' : entry.path}
        </span>
      </button>
      {entry.current ? <span className="shrink-0 pr-3 text-muted-foreground">current</span> : null}
      {entry.missing ? <span className="shrink-0 pr-1 text-destructive">missing</span> : null}
      {entry.stored && !entry.missing ? null : (
        <button
          type="button"
          aria-label={`Remove ${entry.name} from Recent`}
          onClick={() => void removeRecent(entry)}
          className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </li>
  )
}

const startActionClass =
  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 font-medium text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** Main area of an empty workspace: open a folder, open a workspace file, or pick something recent. */
export function WelcomeScreen(): React.JSX.Element | null {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const addFolder = useWorkspaceStore((state) => state.addFolder)
  const openWorkspaceFile = useWorkspaceStore((state) => state.openWorkspaceFile)
  if (!workspace) return null

  return (
    <div className="flex min-h-0 w-full flex-1 justify-center overflow-y-auto px-8 py-12">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Hatfield 360</h1>
          <p className="text-muted-foreground">{workspace.name} has no folders yet.</p>
        </header>
        <section aria-labelledby="welcome-start" className="flex flex-col gap-1">
          <h2 id="welcome-start" className="px-2.5 font-medium text-muted-foreground">
            Start
          </h2>
          <div className="flex flex-col items-start">
            <button type="button" onClick={() => void addFolder()} className={startActionClass}>
              <FolderOpen className="size-[18px]" aria-hidden />
              Open Folder…
            </button>
            <button
              type="button"
              onClick={() => void openWorkspaceFile()}
              className={startActionClass}
            >
              <Layers className="size-[18px]" aria-hidden />
              Open Workspace…
            </button>
          </div>
        </section>
        <section aria-labelledby="welcome-recent" className="flex flex-col gap-1">
          <h2 id="welcome-recent" className="px-2.5 font-medium text-muted-foreground">
            Recent
          </h2>
          <ul aria-label="Recent" className="flex flex-col gap-0.5">
            {workspace.recent.map((entry) => (
              <RecentRow key={`${entry.kind}:${entry.path}`} entry={entry} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
