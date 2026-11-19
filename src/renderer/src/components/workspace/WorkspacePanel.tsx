import { CircleAlert, FolderPlus, FolderX } from 'lucide-react'
import { CatppuccinRootFolderIcon } from '@/components/icons/CatppuccinIcons'
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
              className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 outline-none select-none hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent"
            >
              {folder.missing ? (
                <FolderX className="size-[18px] shrink-0 text-destructive" aria-hidden />
              ) : (
                <CatppuccinRootFolderIcon className="size-[18px] shrink-0" />
              )}
              <span
                className={cn(
                  'truncate text-[15px] font-semibold',
                  folder.missing && 'font-medium text-muted-foreground line-through'
                )}
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
  const addFolder = useWorkspaceStore((state) => state.addFolder)

  const folders = workspace?.folders ?? []
  // With no folders the welcome screen shows errors and notices; the panel keeps the workspace's own problem.
  const problem =
    (folders.length > 0 ? (error ?? workspace?.notice) : null) ?? workspace?.problem ?? null

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="flex-1 truncate font-medium text-muted-foreground">Projects</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Add Folder to Workspace"
              onClick={() => void addFolder()}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FolderPlus className="size-[18px]" strokeWidth={1.75} aria-hidden />
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
        <div className="flex flex-col items-start gap-3 px-4 pt-1">
          <p className="text-muted-foreground">No folders in this workspace yet.</p>
          <button
            type="button"
            onClick={() => void addFolder()}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FolderPlus className="size-4" aria-hidden />
            Open Folder
          </button>
        </div>
      ) : (
        <ul
          aria-label="Workspace folders"
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2"
        >
          {folders.map((folder) => (
            <ProjectRow key={folder.path} folder={folder} />
          ))}
        </ul>
      )}
    </>
  )
}
