import { CircleAlert, FolderPlus } from 'lucide-react'
import { useWorkspaceStore } from '@/state/workspace-store'

/** Why the open workspace is read-only, above a panel's folders. */
export function WorkspaceProblemBanner({ problem }: { problem: string }): React.JSX.Element {
  return (
    <p
      role="alert"
      className="mx-2 mb-2 flex gap-2 rounded-banner border border-error-border bg-error-background px-2 py-1.5"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      {problem}
    </p>
  )
}

/** A panel with nothing to list: why, and the way to add a folder. */
export function OpenFolderEmptyState({ message }: { message: string }): React.JSX.Element {
  const addFolder = useWorkspaceStore((state) => state.addFolder)
  return (
    <div className="flex flex-col items-start gap-3 px-4 pt-1">
      <p className="type-description">{message}</p>
      <button
        type="button"
        onClick={() => void addFolder()}
        className="type-button flex h-control items-center gap-2 rounded-button bg-primary px-3.5 text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <FolderPlus className="size-4" aria-hidden />
        Open Folder
      </button>
    </div>
  )
}
