import { HidePanelButton } from '@/components/shell/HidePanelButton'
import {
  hotkeysCoreFeature,
  type ItemInstance,
  renamingFeature,
  type SelectionDataRef,
  selectionFeature,
  syncDataLoaderFeature,
  type TreeInstance
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import {
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  Crosshair,
  Eye,
  EyeOff,
  FolderInput,
  FolderMinus,
  FilePlus,
  FolderPlus,
  FolderX,
  GitBranch,
  PencilLine,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import { PanelHeaderButton } from '@/components/shell/PanelHeaderButton'
import { treeIndent, treeRowClass } from '@/components/tree/tree-row-style'
import { useLoadingShown } from '@/components/tree/use-loading-delay'
import { Input } from '@/components/ui/input'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { OpenTerminalMenuContent } from '@/components/terminal/OpenTerminalMenuContent'
import { PathMenuItems } from '@/components/tree/PathMenuItems'
import { useAfterMenu } from '@/components/tree/use-after-menu'
import { DELETE_LABEL, isDeleteKey } from './delete-key'
import { TrashDialog } from './TrashDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  PATH_TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  usePointerTooltip
} from '@/components/ui/tooltip'
import {
  OpenFolderEmptyState,
  WorkspaceProblemBanner
} from '@/components/workspace/WorkspaceNotices'
import { separatorOf } from '@/components/editor/editor-tab-labels'
import { cn } from '@/lib/class-names'
import { appCommandForKey, appShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useSearchStore } from '@/state/search-store'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { type FileTreeRoot, useFileTreeStore } from '@/state/file-tree-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import {
  entryKey,
  folderOf,
  locateInTree,
  nameOf,
  pathOf,
  type Row,
  type TreeRoot,
  type TreeWorktree,
  treeRoots,
  treeRows
} from './file-tree-rows'
import type { DirectoryEntry } from '../../../../shared/file-tree-api'

/** Typed letters within this gap add up to one name prefix to jump to. */
const TYPE_AHEAD_GAP_MS = 700

/** headless-tree's hidden top item, whose children are the workspace roots. */
const TREE_ID = '\0tree'
const TREE_ROW: Row = {
  type: 'empty',
  key: TREE_ID,
  onlyIgnored: false,
  depth: -1,
  parent: null,
  setSize: 0,
  position: 0
}

/** Loading and Empty rows only say how a folder is; keys and selection pass them by. */
const isNavigable = (row: Row): boolean => row.type !== 'loading' && row.type !== 'empty'

const isTruncated = (element: HTMLElement | null): boolean =>
  element !== null && element.scrollWidth > element.clientWidth

type Tree = TreeInstance<Row>
type Item = ItemInstance<Row>

/** Moves focus to `item` and makes it the only selected row, as plain arrows and clicks do. */
function selectOnly(tree: Tree, item: Item): void {
  item.setFocused()
  tree.setSelectedItems([item.getId()])
  tree.getDataRef<SelectionDataRef>().current.selectUpToAnchorId = item.getId()
  tree.updateDomFocus()
}

const navigableItems = (tree: Tree): Item[] =>
  tree.getItems().filter((item) => isNavigable(item.getItemData()))

/** Selects the navigable row `step` rows from the focused one, or the first or last for ±Infinity. */
function moveFocus(tree: Tree, step: number): void {
  const items = navigableItems(tree)
  const index = items.findIndex((item) => item.isFocused())
  const target =
    step === -Infinity
      ? items[0]
      : step === Infinity
        ? items.at(-1)
        : items[Math.min(Math.max(index + step, 0), items.length - 1)]
  if (target) selectOnly(tree, target)
}

/** Entries a menu or key acts on: the selection when `item` is part of it, else `item` alone. */
function targetEntries(tree: Tree, item: Item): DirectoryEntry[] {
  const items = item.isSelected() ? tree.getSelectedItems() : [item]
  const entries = items.flatMap((each) => {
    const row = each.getItemData()
    return row.type === 'entry' ? [row.entry] : []
  })
  // What is inside a selected folder goes with it.
  return entries.filter(
    (entry) =>
      !entries.some(
        (folder) =>
          folder.kind === 'directory' &&
          entry.path.startsWith(folder.path + separatorOf(folder.path))
      )
  )
}

/** Folders Find in Folder… searches: the selected folders when `item` is selected, else `item`'s; a file stands for its folder. */
function searchScope(tree: Tree, item: Item): string[] {
  const items = item.isSelected() ? tree.getSelectedItems() : [item]
  const folders = items.flatMap((each) => {
    const row = each.getItemData()
    return folderOf(row) ?? (row.type === 'entry' ? row.folder : [])
  })
  return [...new Set(folders)]
}

type RowState = {
  /** headless-tree's props for the row element: focus, selection, clicks and ARIA. */
  props: Record<string, unknown>
  selected: boolean
  onContextMenu: () => void
  /** Runs Find in Folder… on this row, or on the selection it is part of. */
  onFindInFolder: () => void
  /** Asks for the name of a new file or folder to create in `folder`. */
  onCreate: (folder: string, kind: DirectoryEntry['kind']) => void
}

function TreeRow({
  row,
  label,
  description,
  expanded,
  dimmed = false,
  props,
  selected,
  onContextMenu,
  onOpen,
  icon,
  hint,
  tip,
  menu,
  children
}: RowState & {
  row: Row
  label: string
  description?: string
  /** Undefined for rows that don't fold. */
  expanded?: boolean
  /** Ignored by git: in the ignored-file colour, as JetBrains trees show it. */
  dimmed?: boolean
  /** Double-clicked, as JetBrains trees open files; a single click only selects. */
  onOpen?: () => void
  icon: ReactNode
  hint?: ReactNode
  /** Shown under the pointer: always (a root's path), or only when the name is cut off. */
  tip: { text: string; always: boolean }
  menu?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const labelRef = useRef<HTMLSpanElement>(null)
  const pointerTip = usePointerTooltip()
  const [tipOpen, setTipOpen] = useState(false)
  const item = (
    <div
      {...props}
      data-tree-key={row.key}
      aria-label={label}
      aria-description={description}
      data-ignored={dimmed || undefined}
      className={cn(
        treeRowClass(selected),
        'data-[state=open]:ring-1 data-[state=open]:ring-ring data-[state=open]:ring-inset',
        dimmed && 'text-file-ignored'
      )}
      style={{ paddingLeft: treeIndent(row.depth) }}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
    >
      {expanded === undefined ? (
        <span className="size-4 shrink-0" aria-hidden />
      ) : (
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-90')}
          aria-hidden
        />
      )}
      {icon}
      <span ref={labelRef} className="ml-1 truncate">
        {children}
      </span>
      {hint}
    </div>
  )
  const withTip = (
    <Tooltip
      delayDuration={PATH_TOOLTIP_DELAY_MS}
      open={tipOpen}
      onOpenChange={(open) => {
        pointerTip.onOpenChange(open)
        setTipOpen(open && (tip.always || isTruncated(labelRef.current)))
      }}
    >
      {menu ? (
        <ContextMenuTrigger asChild>
          <TooltipTrigger
            asChild
            onPointerMove={pointerTip.track}
            // Arrowing through the tree would pop a tooltip at every row; the name is read out anyway.
            onFocus={(event) => event.preventDefault()}
          >
            {item}
          </TooltipTrigger>
        </ContextMenuTrigger>
      ) : (
        <TooltipTrigger
          asChild
          onPointerMove={pointerTip.track}
          onFocus={(event) => event.preventDefault()}
        >
          {item}
        </TooltipTrigger>
      )}
      <TooltipContent {...pointerTip.placement}>{tip.text}</TooltipContent>
    </Tooltip>
  )
  if (!menu) return withTip
  return (
    <ContextMenu>
      {withTip}
      {menu}
    </ContextMenu>
  )
}

function ReloadItem({ path }: { path: string }): React.JSX.Element {
  const reload = useFileTreeStore((state) => state.reload)
  return (
    <ContextMenuItem onSelect={() => reload(path)}>
      <RefreshCw aria-hidden />
      Reload from Disk
    </ContextMenuItem>
  )
}

/** New File… and New Folder…, creating in `folder`, once the menu has closed. */
function CreateItems({
  folder,
  onCreate,
  choose
}: {
  folder: string
  onCreate: RowState['onCreate']
  choose: (action: () => void) => void
}): React.JSX.Element {
  return (
    <>
      <ContextMenuItem onSelect={() => choose(() => onCreate(folder, 'file'))}>
        <FilePlus aria-hidden />
        New File…
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => choose(() => onCreate(folder, 'directory'))}>
        <FolderPlus aria-hidden />
        New Folder…
      </ContextMenuItem>
    </>
  )
}

function FindInFolderItem({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  const keymap = useKeymapStore((state) => state.shell)
  return (
    <ContextMenuItem onSelect={onSelect}>
      <Search aria-hidden />
      Find in Folder…
      <ContextMenuShortcut>{appShortcutLabel(keymap, 'find-in-files')}</ContextMenuShortcut>
    </ContextMenuItem>
  )
}

function RootRow({
  row,
  root,
  expanded,
  ...state
}: RowState & { row: Row; root: TreeRoot; expanded: boolean }): React.JSX.Element {
  const setFolderKind = useWorkspaceStore((store) => store.setFolderKind)
  const removeFolder = useWorkspaceStore((store) => store.removeFolder)
  const afterMenu = useAfterMenu()
  const { folder } = root
  const missing = folder.missing
  return (
    <TreeRow
      row={row}
      label={
        missing ? `${root.name} (missing)` : [root.name, root.branch].filter(Boolean).join(' ')
      }
      {...(missing ? {} : { expanded })}
      {...state}
      icon={
        missing ? (
          <FolderX className="size-4.5 shrink-0 text-error" aria-hidden />
        ) : folder.kind === 'folder' ? (
          <FileTreeIcon
            kind="folder"
            name={root.name}
            open={expanded}
            className="size-4.5 shrink-0"
          />
        ) : (
          <RootFolderIcon open={expanded} className="size-4.5 shrink-0" />
        )
      }
      hint={
        missing ? (
          <span className="type-hint ml-auto shrink-0 text-error">missing</span>
        ) : root.branch ? (
          <span className="type-hint flex min-w-0 shrink items-center gap-1">
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{root.branch}</span>
          </span>
        ) : null
      }
      tip={{ text: folder.path, always: true }}
      menu={
        <OpenTerminalMenuContent
          cwd={root.path}
          disabled={missing}
          onCloseAutoFocus={afterMenu.onCloseAutoFocus}
        >
          {missing ? null : (
            <>
              <CreateItems folder={root.path} onCreate={state.onCreate} choose={afterMenu.choose} />
              <ContextMenuSeparator />
              <FindInFolderItem onSelect={() => afterMenu.choose(state.onFindInFolder)} />
              <ContextMenuSeparator />
              <PathMenuItems path={root.path} relative={false} />
              <ContextMenuSeparator />
              <ReloadItem path={root.path} />
            </>
          )}
          <ContextMenuSeparator />
          {folder.kind === 'folder' ? (
            <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'project')}>
              <FolderInput aria-hidden />
              Show in Projects
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'folder')}>
              <FolderMinus aria-hidden />
              Hide from Projects
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
            <FolderX aria-hidden />
            Remove from Workspace
          </ContextMenuItem>
        </OpenTerminalMenuContent>
      }
    >
      <span className="type-project-row">{root.name}</span>
    </TreeRow>
  )
}

/** A project's linked worktree, under the project as in the Projects view: its branch first. */
function WorktreeRow({
  row,
  worktree,
  expanded,
  ...state
}: RowState & { row: Row; worktree: TreeWorktree; expanded: boolean }): React.JSX.Element {
  const afterMenu = useAfterMenu()
  return (
    <TreeRow
      row={row}
      label={`${worktree.branch} worktree ${worktree.name}`}
      expanded={expanded}
      {...state}
      icon={<GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      hint={<span className="type-hint min-w-0 flex-1 truncate">{worktree.name}</span>}
      tip={{ text: worktree.path, always: true }}
      menu={
        <OpenTerminalMenuContent
          cwd={worktree.path}
          disabled={false}
          onCloseAutoFocus={afterMenu.onCloseAutoFocus}
        >
          <CreateItems folder={worktree.path} onCreate={state.onCreate} choose={afterMenu.choose} />
          <ContextMenuSeparator />
          <FindInFolderItem onSelect={() => afterMenu.choose(state.onFindInFolder)} />
          <ContextMenuSeparator />
          <PathMenuItems path={worktree.path} relative={false} />
          <ContextMenuSeparator />
          <ReloadItem path={worktree.path} />
        </OpenTerminalMenuContent>
      }
    >
      {worktree.branch}
    </TreeRow>
  )
}

/** The name being edited in place of an entry's label (F2 or Rename…). */
function RenameInput({
  name,
  value,
  onChange,
  onCancel
}: {
  name: string
  value: string
  onChange: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <input
      aria-label={`New name for ${name}`}
      className="type-tree-row w-full min-w-0 rounded-component bg-input px-1 text-foreground ring-1 ring-ring outline-none"
      value={value}
      spellCheck={false}
      ref={(input) => {
        if (!input || input.dataset.started) return
        input.dataset.started = 'true'
        input.focus()
        // As in IDEs: the name is selected without its extension.
        const dot = name.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : name.length)
      }}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCancel}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}

function EntryRow({
  row,
  entry,
  ignored,
  folder,
  expanded,
  renaming,
  onStartRename,
  onDelete,
  ...state
}: RowState & {
  row: Row
  entry: DirectoryEntry
  ignored: boolean
  folder: string
  expanded: boolean
  /** The name field, while the entry is being renamed. */
  renaming: ReactNode
  onStartRename: () => void
  onDelete: () => void
}): React.JSX.Element {
  const openFile = useEditorTabStore((store) => store.open)
  const afterMenu = useAfterMenu()
  const directory = entry.kind === 'directory'
  return (
    <TreeRow
      row={row}
      label={entry.name}
      {...(ignored ? { description: 'Ignored by git' } : {})}
      {...(directory ? { expanded } : { onOpen: () => openFile(entry.path) })}
      dimmed={ignored}
      {...state}
      icon={
        <FileTreeIcon
          kind={directory ? 'folder' : 'file'}
          name={entry.name}
          open={expanded}
          className={cn('size-4 shrink-0', ignored && 'opacity-50')}
        />
      }
      tip={{ text: entry.name, always: false }}
      menu={
        <OpenTerminalMenuContent
          cwd={directory ? entry.path : folder}
          disabled={false}
          onCloseAutoFocus={afterMenu.onCloseAutoFocus}
        >
          <CreateItems
            folder={directory ? entry.path : folder}
            onCreate={state.onCreate}
            choose={afterMenu.choose}
          />
          <ContextMenuSeparator />
          {directory ? (
            <>
              <FindInFolderItem onSelect={() => afterMenu.choose(state.onFindInFolder)} />
              <ContextMenuSeparator />
            </>
          ) : null}
          <PathMenuItems path={entry.path} relative />
          {directory ? (
            <>
              <ContextMenuSeparator />
              <ReloadItem path={entry.path} />
            </>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => afterMenu.choose(onStartRename)}>
            <PencilLine aria-hidden />
            Rename…
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={onDelete}>
            <Trash2 aria-hidden />
            Delete…
            <ContextMenuShortcut>{DELETE_LABEL}</ContextMenuShortcut>
          </ContextMenuItem>
        </OpenTerminalMenuContent>
      }
    >
      {renaming ?? entry.name}
    </TreeRow>
  )
}

function ErrorRow({
  row,
  folder,
  message,
  ...state
}: RowState & { row: Row; folder: string; message: string }): React.JSX.Element {
  const reload = useFileTreeStore((store) => store.reload)
  return (
    <TreeRow
      row={row}
      label={`Couldn't list this folder: ${message}`}
      description="Press Enter to try again"
      {...state}
      icon={<CircleAlert className="size-4 shrink-0 text-error" aria-hidden />}
      hint={
        <button
          type="button"
          tabIndex={-1}
          className="type-hint ml-auto shrink-0 rounded-button px-1 text-link hover:bg-hover"
          onClick={(event) => {
            event.stopPropagation()
            reload(folder)
          }}
        >
          Retry
        </button>
      }
      tip={{ text: message, always: false }}
    >
      {message}
    </TreeRow>
  )
}

/** "Loading…" for a folder still being listed (after a moment), "Empty" for one with nothing shown. */
function StatusRow({
  row,
  props,
  loading,
  onlyIgnored
}: {
  row: Row
  props: Record<string, unknown>
  loading: boolean
  onlyIgnored: boolean
}): React.JSX.Element {
  const shown = useLoadingShown(loading)
  const text = loading ? 'Loading…' : onlyIgnored ? 'Only ignored files' : 'Empty'
  return (
    <div
      {...props}
      tabIndex={-1}
      aria-disabled
      aria-label={text}
      aria-selected={false}
      onClick={undefined}
      className="type-hint flex h-tree-row shrink-0 items-center select-none"
      style={{ paddingLeft: treeIndent(row.depth, 6) }}
    >
      {shown ? text : null}
    </div>
  )
}

/** Asks for the name of a new file or folder in `folder`; `/` in the name creates folders on the way. */
function CreateDialog({
  folder,
  kind,
  onClose
}: {
  folder: string
  kind: DirectoryEntry['kind']
  onClose: () => void
}): React.JSX.Element {
  const create = useFileTreeStore((state) => state.create)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const what = kind === 'file' ? 'File' : 'Folder'
  const created = useRef<string | null>(null)
  const submit = (): void => {
    if (busy || name.trim() === '') return
    setBusy(true)
    void create(folder, name, kind).then((result) => {
      setBusy(false)
      if (!result.ok) {
        setProblem(result.message)
        return
      }
      created.current = result.path
      onClose()
    })
  }
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent
        // Once the dialog is gone (its focus trap would take focus back), a new file opens to be
        // written in and the tree shows where it is; a new folder's row takes focus.
        onCloseAutoFocus={(event) => {
          const path = created.current
          if (path === null) return
          event.preventDefault()
          useFileTreeStore.getState().select(path, kind !== 'file')
          if (kind === 'file')
            useEditorTabStore.getState().open(path, { line: 1, start: 0, end: 0, focus: true })
        }}
      >
        <AlertDialogTitle>{`New ${what}`}</AlertDialogTitle>
        <AlertDialogDescription className="truncate" title={folder}>
          {`In ${folder}`}
        </AlertDialogDescription>
        <div className="flex flex-col gap-1.5">
          <Input
            aria-label={`${what} name`}
            aria-invalid={problem !== null}
            autoFocus
            spellCheck={false}
            placeholder={kind === 'file' ? 'name.ext or folder/name.ext' : 'name or folder/name'}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setProblem(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              submit()
            }}
          />
          {problem ? (
            <p role="alert" className="type-hint text-error">
              {problem}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            primary
            disabled={busy || name.trim() === ''}
            onClick={(event) => {
              // It stays open until main has created the entry, to show why it couldn't.
              event.preventDefault()
              submit()
            }}
          >
            Create
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Files side panel: every workspace folder, with its project's worktrees, as a live, lazily listed tree. */
export function FilesPanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const addFolder = useWorkspaceStore((state) => state.addFolder)
  const projects = useWorktreeStore((state) => state.projects)
  const expanded = useFileTreeStore((state) => state.expanded)
  const listings = useFileTreeStore((state) => state.listings)
  const hideIgnored = useFileTreeStore((state) => state.hideIgnored)
  const toggleHideIgnored = useFileTreeStore((state) => state.toggleHideIgnored)
  const setRoots = useFileTreeStore((state) => state.setRoots)
  const connect = useFileTreeStore((state) => state.connect)
  const toggle = useFileTreeStore((state) => state.toggle)
  const openFile = useEditorTabStore((state) => state.open)
  const expand = useFileTreeStore((state) => state.expand)
  const collapseAll = useFileTreeStore((state) => state.collapseAll)
  const reload = useFileTreeStore((state) => state.reload)
  const copyPath = useFileTreeStore((state) => state.copyPath)
  const rename = useFileTreeStore((state) => state.rename)
  const locating = useFileTreeStore((state) => state.locating)
  const selectOpenedFile = useFileTreeStore((state) => state.selectOpenedFile)
  const locateDone = useFileTreeStore((state) => state.locateDone)
  const activePath = useEditorTabStore((state) => state.activePath)
  const selectOpenedFileKey = appShortcutLabel(
    useKeymapStore((state) => state.shell),
    'select-opened-file'
  )
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [focusedItem, setFocusedItem] = useState<string | null>(null)
  const [renamingItem, setRenamingItem] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [deleting, setDeleting] = useState<DirectoryEntry[] | null>(null)
  const [creating, setCreating] = useState<{
    folder: string
    kind: DirectoryEntry['kind']
  } | null>(null)
  const typeAhead = useRef({ text: '', at: 0 })

  const folders = workspace?.folders
  const roots = useMemo(() => treeRoots(folders ?? [], projects), [folders, projects])
  const watchedRoots = useMemo(
    (): FileTreeRoot[] =>
      roots
        .filter((root) => !root.folder.missing)
        .map((root) => ({
          path: root.path,
          kind: root.folder.kind,
          worktrees: root.worktrees.map((tree) => tree.path)
        })),
    [roots]
  )
  useEffect(() => connect(), [connect])
  useEffect(() => setRoots(watchedRoots), [watchedRoots, setRoots])
  // Closing the panel stops every watch; reopening lists its open folders fresh.
  useEffect(() => () => setRoots([]), [setRoots])

  const { rows, hiddenIgnored } = useMemo(
    () => treeRows(roots, expanded, listings, hideIgnored),
    [roots, expanded, listings, hideIgnored]
  )
  const { rowsByKey, childrenOf, expandedItems } = useMemo(() => {
    const children = new Map<string, string[]>()
    for (const row of rows) {
      const parent = row.parent ?? TREE_ID
      children.set(parent, [...(children.get(parent) ?? []), row.key])
    }
    return {
      rowsByKey: new Map(rows.map((row) => [row.key, row])),
      childrenOf: children,
      // A new list whenever the rows change: that is what makes headless-tree read them again.
      expandedItems: rows.flatMap((row) => {
        const folder = folderOf(row)
        return folder !== null && expanded[folder] ? [row.key] : []
      })
    }
  }, [rows, expanded])

  const tree = useTree<Row>({
    rootItemId: TREE_ID,
    dataLoader: {
      getItem: (key) => rowsByKey.get(key) ?? TREE_ROW,
      getChildren: (key) => childrenOf.get(key) ?? []
    },
    getItemName: (item) => nameOf(item.getItemData()) ?? '',
    isItemFolder: (item) => folderOf(item.getItemData()) !== null,
    canRename: (item) => item.getItemData().type === 'entry',
    onRename: (item, value) => {
      const row = item.getItemData()
      if (row.type !== 'entry' || row.parent === null || value === row.entry.name) return
      const renamed = entryKey(row.parent, value)
      void rename(row.entry.path, value).then((done) => {
        if (!done) return
        // The row comes back under its new name; it stays the selected one.
        setSelectedItems([renamed])
        setFocusedItem(renamed)
      })
    },
    state: {
      expandedItems,
      // Rows that went away (deleted, or under a folder that was collapsed) leave the selection.
      selectedItems: selectedItems.filter((key) => rowsByKey.has(key)),
      focusedItem: focusedItem !== null && rowsByKey.has(focusedItem) ? focusedItem : null,
      renamingItem,
      renamingValue
    },
    // Folding goes through the store, which lists and watches what opens.
    setExpandedItems: (update) => {
      const next = new Set(typeof update === 'function' ? update(expandedItems) : update)
      const before = new Set(expandedItems)
      for (const key of new Set([...next, ...before])) {
        const row = rowsByKey.get(key)
        const folder = row ? folderOf(row) : null
        if (folder !== null && next.has(key) !== before.has(key)) toggle(folder)
      }
    },
    setSelectedItems,
    setFocusedItem,
    setRenamingItem: (update) =>
      setRenamingItem(
        (current) => (typeof update === 'function' ? update(current) : update) ?? null
      ),
    setRenamingValue: (update) =>
      setRenamingValue(
        (current) => (typeof update === 'function' ? update(current) : update) ?? ''
      ),
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, renamingFeature],
    // Plain arrows move the selection with the focus, as in JetBrains trees, passing status rows by.
    // Each keeps its key: headless-tree matches keys on the override alone, not merged with the preset.
    hotkeys: {
      focusNextItem: {
        hotkey: 'ArrowDown',
        handler: (_event, current) => moveFocus(current, 1)
      },
      focusPreviousItem: {
        hotkey: 'ArrowUp',
        handler: (_event, current) => moveFocus(current, -1)
      },
      focusFirstItem: {
        hotkey: 'Home',
        handler: (_event, current) => moveFocus(current, -Infinity)
      },
      focusLastItem: {
        hotkey: 'End',
        handler: (_event, current) => moveFocus(current, Infinity)
      },
      expandOrDown: {
        hotkey: 'ArrowRight',
        handler: (_event, current) => {
          const item = current.getFocusedItem()
          if (item.isFolder() && !item.isExpanded()) item.expand()
          else moveFocus(current, 1)
        }
      },
      collapseOrUp: {
        hotkey: 'ArrowLeft',
        handler: (_event, current) => {
          const item = current.getFocusedItem()
          const parent = item.getParent()
          if (item.isFolder() && item.isExpanded()) item.collapse()
          else if (parent && parent.getId() !== TREE_ID) selectOnly(current, parent)
        }
      },
      selectAll: {
        hotkey: 'metaorcontrol+KeyA',
        handler: (_event, current) =>
          current.setSelectedItems(navigableItems(current).map((item) => item.getId()))
      }
    }
  })

  const canSelectOpenedFile = activePath !== null && locateInTree(watchedRoots, activePath) !== null
  const locatedShown = locating !== null && rowsByKey.has(locating.key)
  const problem = workspace?.problem ?? null

  // Select Opened File: once the file's row shows, it is selected and scrolled into view.
  useEffect(() => {
    if (!locatedShown || !locating) return
    const item = tree.getItemInstance(locating.key)
    if (locating.focus) selectOnly(tree, item)
    else {
      item.setFocused()
      tree.setSelectedItems([item.getId()])
      void item.scrollTo({ block: 'nearest' })
    }
    locateDone()
  }, [locatedShown, locating, locateDone, tree])

  // Select Opened File on a key bound in keybindings.json, from the editor as from the tree.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (appCommandForKey(event, useKeymapStore.getState().shell) !== 'select-opened-file') return
      event.preventDefault()
      selectOpenedFile()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectOpenedFile])

  const askDelete = (item: Item): void => {
    const entries = targetEntries(tree, item)
    if (entries.length > 0) setDeleting(entries)
  }

  /** Keys headless-tree has no preset for: Enter, Delete, copying paths, `*` and type-ahead. */
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLInputElement) return
    const item = tree.getFocusedItem()
    const row = item.getItemData()
    if (!isNavigable(row)) return
    const command = appCommandForKey(event, useKeymapStore.getState().shell)
    if (command === 'find-in-files') {
      // Before the window's own Find in Files, which searches the whole workspace.
      event.preventDefault()
      useSearchStore.getState().findInFiles(searchScope(tree, item))
      return
    }
    const form =
      command === 'copy-absolute-path'
        ? 'absolute'
        : command === 'copy-relative-path'
          ? 'relative'
          : null
    if (form) {
      event.preventDefault()
      const path = pathOf(row)
      if (path !== null && (form === 'absolute' || row.type === 'entry')) copyPath(path, form)
      return
    }
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey
    if (isDeleteKey(event)) {
      event.preventDefault()
      askDelete(item)
      return
    }
    if (!plain) return
    const folder = folderOf(row)
    if (event.key === 'Enter') {
      event.preventDefault()
      if (row.type === 'error') reload(row.folder)
      else if (folder !== null) toggle(folder)
      else if (row.type === 'entry') openFile(row.entry.path)
      return
    }
    if (event.key === '*') {
      event.preventDefault()
      expand(
        rows
          .filter((sibling) => sibling.parent === row.parent)
          .flatMap((sibling) => folderOf(sibling) ?? [])
      )
      return
    }
    if (event.key.length !== 1 || (event.key === ' ' && typeAhead.current.text === '')) return
    event.preventDefault()
    const typed = typeAhead.current
    typed.text =
      event.timeStamp - typed.at > TYPE_AHEAD_GAP_MS
        ? event.key.toLowerCase()
        : typed.text + event.key.toLowerCase()
    typed.at = event.timeStamp
    const items = navigableItems(tree)
    const index = items.findIndex((candidate) => candidate.isFocused())
    // A new search starts after the current row; a longer prefix may still match it.
    const start = typed.text.length === 1 ? index + 1 : index
    for (let step = 0; step < items.length; step++) {
      const candidate = items[(start + step) % items.length]
      if (candidate?.getItemName().toLowerCase().startsWith(typed.text)) {
        selectOnly(tree, candidate)
        break
      }
    }
  }

  const renderItem = (item: Item): React.JSX.Element => {
    const row = item.getItemData()
    const key = item.getKey()
    const props: Record<string, unknown> = item.getProps()
    const state: RowState = {
      props,
      selected: item.isSelected(),
      // Right-clicking outside the selection selects that row, as in IDE trees.
      onContextMenu: () => {
        if (!item.isSelected()) selectOnly(tree, item)
      },
      onFindInFolder: () => useSearchStore.getState().findInFiles(searchScope(tree, item)),
      onCreate: (folder, kind) => setCreating({ folder, kind })
    }
    switch (row.type) {
      case 'root':
        return (
          // A root stays on top while its folders scroll under it.
          <div key={key} className="sticky top-0 z-10 -mx-2 bg-island px-2 not-first:mt-1.5">
            <RootRow row={row} root={row.root} expanded={item.isExpanded()} {...state} />
          </div>
        )
      case 'worktree':
        return (
          <WorktreeRow
            key={key}
            row={row}
            worktree={row.worktree}
            expanded={item.isExpanded()}
            {...state}
          />
        )
      case 'entry':
        return (
          <EntryRow
            key={key}
            row={row}
            entry={row.entry}
            ignored={row.ignored}
            folder={row.folder}
            expanded={item.isExpanded()}
            renaming={
              item.isRenaming() ? (
                <RenameInput
                  name={row.entry.name}
                  value={renamingValue}
                  onChange={setRenamingValue}
                  onCancel={() => tree.abortRenaming()}
                />
              ) : null
            }
            onStartRename={() => {
              // Not selectOnly: moving DOM focus to the row would take it from the name field.
              item.setFocused()
              item.startRenaming()
            }}
            onDelete={() => askDelete(item)}
            {...state}
          />
        )
      case 'error':
        return <ErrorRow key={key} row={row} folder={row.folder} message={row.message} {...state} />
      default:
        return (
          <StatusRow
            key={key}
            row={row}
            props={props}
            loading={row.type === 'loading'}
            onlyIgnored={row.onlyIgnored}
          />
        )
    }
  }

  const containerProps: Record<string, unknown> = tree.getContainerProps('Files')

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title flex-1 truncate">Files</h2>
        <PanelHeaderButton
          label="Select Opened File"
          disabled={!canSelectOpenedFile}
          onClick={selectOpenedFile}
          tip={
            <span className="flex flex-col">
              <span>Select Opened File</span>
              {selectOpenedFileKey ? (
                <span className="text-tooltip-muted-foreground">{selectOpenedFileKey}</span>
              ) : null}
            </span>
          }
        >
          <Crosshair className="size-4.5" strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <PanelHeaderButton label="Collapse All" onClick={collapseAll}>
          <ChevronsDownUp className="size-4.5" strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <PanelHeaderButton
          label="Hide Ignored Files"
          pressed={hideIgnored}
          onClick={toggleHideIgnored}
          tip={
            <span className="flex flex-col">
              <span>Hide Ignored Files</span>
              <span className="text-tooltip-muted-foreground">
                {hideIgnored
                  ? `${hiddenIgnored} hidden in open folders`
                  : 'Files git ignores are shown in their own colour'}
              </span>
            </span>
          }
        >
          {hideIgnored ? (
            <EyeOff className="size-4.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <Eye className="size-4.5" strokeWidth={1.75} aria-hidden />
          )}
        </PanelHeaderButton>
        <PanelHeaderButton label="Add Folder to Workspace" onClick={() => void addFolder()}>
          <FolderPlus className="size-4.5" strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <HidePanelButton view="files" />
      </div>
      {problem ? <WorkspaceProblemBanner problem={problem} /> : null}
      {workspace && roots.length === 0 && !problem ? (
        <OpenFolderEmptyState message="No folders in this workspace yet." />
      ) : (
        <div
          {...containerProps}
          aria-multiselectable
          className="group/tree flex min-h-0 scroll-pt-tree-row flex-col gap-px overflow-y-auto px-2 pb-2"
          onKeyDown={onTreeKeyDown}
        >
          {tree.getItems().map(renderItem)}
        </div>
      )}
      {deleting ? <TrashDialog entries={deleting} onClose={() => setDeleting(null)} /> : null}
      {creating ? <CreateDialog {...creating} onClose={() => setCreating(null)} /> : null}
    </>
  )
}
