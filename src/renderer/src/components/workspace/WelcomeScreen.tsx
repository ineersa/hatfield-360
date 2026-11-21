import { FileX, FolderOpen, FolderX, House, Layers, X } from 'lucide-react'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { cn } from '@/lib/class-names'
import { useWorkspaceStore } from '@/state/workspace-store'
import type { RecentEntry } from '../../../../shared/workspace-api'

function RecentIcon({ entry }: { entry: RecentEntry }): React.JSX.Element {
  const className = 'size-4.5 shrink-0'
  if (entry.missing) {
    const Missing = entry.kind === 'folder' ? FolderX : FileX
    return <Missing className={cn(className, 'text-error')} aria-hidden />
  }
  if (entry.kind === 'folder') return <RootFolderIcon className={className} />
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
        'group flex items-center gap-1 rounded-component',
        !entry.current && 'hover:bg-row-hover focus-within:bg-row-hover'
      )}
    >
      <button
        type="button"
        aria-label={name}
        disabled={entry.missing || entry.current}
        onClick={() => void openRecent(entry)}
        className="flex h-list-row min-w-0 flex-1 items-center gap-2.5 rounded-component px-2.5 text-left outline-none disabled:cursor-default focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RecentIcon entry={entry} />
        <span
          className={cn(
            'type-section-title shrink-0',
            entry.missing && 'text-muted-foreground line-through'
          )}
        >
          {entry.name}
        </span>
        <span className="type-description min-w-0 truncate">
          {entry.stored ? 'Saved in Hatfield' : entry.path}
        </span>
      </button>
      {entry.current ? <span className="type-description shrink-0 pr-3">current</span> : null}
      {entry.missing ? <span className="shrink-0 pr-1 text-error">missing</span> : null}
      {entry.stored && !entry.missing ? null : (
        <button
          type="button"
          aria-label={`Remove ${entry.name} from Recent`}
          onClick={() => void removeRecent(entry)}
          className="mr-1 flex size-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </li>
  )
}

const startActionClass =
  'type-button flex h-control items-center gap-2.5 rounded-button px-2.5 text-link hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

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
          <h1 className="type-display">Hatfield 360</h1>
          <p className="type-description">{workspace.name} has no folders yet.</p>
        </header>
        <section aria-labelledby="welcome-start" className="flex flex-col gap-1">
          <h2 id="welcome-start" className="type-group-label px-2.5">
            Start
          </h2>
          <div className="flex flex-col items-start">
            <button type="button" onClick={() => void addFolder()} className={startActionClass}>
              <FolderOpen className="size-4.5" aria-hidden />
              Open Folder…
            </button>
            <button
              type="button"
              onClick={() => void openWorkspaceFile()}
              className={startActionClass}
            >
              <Layers className="size-4.5" aria-hidden />
              Open Workspace…
            </button>
          </div>
        </section>
        <section aria-labelledby="welcome-recent" className="flex flex-col gap-1">
          <h2 id="welcome-recent" className="type-group-label px-2.5">
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
