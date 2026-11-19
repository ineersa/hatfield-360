import { CircleAlert, Folder, FolderPlus, FolderX } from 'lucide-react'
import { useEffect } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useWorkspaceStore } from '@/state/workspace-store'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'

function ProjectRow({ folder }: { folder: WorkspaceFolder }): React.JSX.Element {
  const removeFolder = useWorkspaceStore((state) => state.removeFolder)
  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <li
              tabIndex={0}
              aria-label={folder.missing ? `${folder.name} (missing)` : folder.name}
              className="flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none hover:bg-accent focus-visible:bg-accent"
            >
              {folder.missing ? (
                <FolderX className="size-4 shrink-0 text-destructive" aria-hidden />
              ) : (
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span
                className={cn('truncate', folder.missing && 'text-muted-foreground line-through')}
              >
                {folder.name}
              </span>
              {folder.missing ? (
                <span className="ml-auto shrink-0 text-xs text-destructive">missing</span>
              ) : null}
            </li>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" align="start">
          {folder.path}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
          <FolderX aria-hidden />
          Remove from Workspace
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Agents side panel: the open workspace's project folders. */
export function WorkspacePanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const error = useWorkspaceStore((state) => state.error)
  const connect = useWorkspaceStore((state) => state.connect)
  const addFolder = useWorkspaceStore((state) => state.addFolder)

  useEffect(() => connect(), [connect])

  const problem = error ?? workspace?.problem ?? null
  const folders = workspace?.folders ?? []

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="flex-1 truncate font-semibold">Agent Sessions</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Add Folder to Workspace"
              onClick={() => void addFolder()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FolderPlus className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add Folder to Workspace</TooltipContent>
        </Tooltip>
      </div>
      {problem ? (
        <p role="alert" className="mx-2 mb-2 flex gap-2 rounded-md px-2 py-1.5 text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {problem}
        </p>
      ) : null}
      {workspace && folders.length === 0 && !workspace.problem ? (
        <div className="flex flex-col items-start gap-3 px-4 pt-2">
          <p className="text-muted-foreground">No folders in this workspace yet.</p>
          <button
            type="button"
            onClick={() => void addFolder()}
            className="flex h-8 items-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FolderPlus className="size-4" aria-hidden />
            Open Folder
          </button>
        </div>
      ) : (
        <ul aria-label="Workspace folders" className="flex min-h-0 flex-col overflow-y-auto px-2">
          {folders.map((folder) => (
            <ProjectRow key={folder.path} folder={folder} />
          ))}
        </ul>
      )}
    </>
  )
}
