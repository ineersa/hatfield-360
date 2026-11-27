import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  FilePlus,
  GitBranch,
  GitCompareArrows,
  History,
  type LucideIcon,
  TriangleAlert
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { treeIndent, treeRowClass } from '@/components/tree/tree-row-style'
import { useLoadingShown } from '@/components/tree/use-loading-delay'
import { SECONDARY_BUTTON } from '@/components/ui/action-button-classes'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Spinner } from '@/components/ui/spinner'
import {
  PATH_TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  usePointerTooltip
} from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { tabFor, useHunkTabStore } from '@/state/hunk-tab-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { useSourceControlStore } from '@/state/source-control-store'
import type {
  ChangedFile,
  ChangeKind,
  HunkKind,
  SourceControlGroup
} from '../../../../shared/source-control-api'
import { isDeleteKey } from '@/components/files/delete-key'
import {
  addableFiles,
  type ChangeRow,
  type CheckState,
  fileKey,
  filesCheckState,
  type GitGroup,
  isUntracked,
  trackedFiles
} from './change-tree-rows'
import { FileRowMenu, GroupMenu, type RowMenuRequests, UnversionedMenu } from './ChangeRowMenus'
import { COMMIT_MESSAGE_ID } from './CommitBox'
import { OPERATION_NAMES, operationNotice } from './operation-notice'

/** Each kind's letter and colour; the letter and its description carry it, never the colour alone. */
export const CHANGE_KINDS: Record<ChangeKind, { letter: string; label: string; text: string }> = {
  modified: { letter: 'M', label: 'modified', text: 'text-vcs-modified' },
  added: { letter: 'A', label: 'added', text: 'text-vcs-added' },
  deleted: { letter: 'D', label: 'deleted', text: 'text-vcs-deleted' },
  renamed: { letter: 'R', label: 'renamed', text: 'text-vcs-renamed' },
  untracked: { letter: 'U', label: 'untracked', text: 'text-vcs-untracked' },
  conflicted: { letter: 'C', label: 'conflicted', text: 'text-vcs-conflicted' }
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

const isNavigable = (row: ChangeRow): boolean => row.type !== 'note' && row.type !== 'error'

const rootOf = (row: ChangeRow): string =>
  row.type === 'note' || row.type === 'error' ? row.key : row.group.root

/** Keys that move through the tree even from a row's button, so focus never gets stuck there. */
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** "merge in progress", as the group row describes it to assistive tech. */
const operationDescription = (group: GitGroup): string | null =>
  group.operation === null ? null : `${OPERATION_NAMES[group.operation.kind].noun} in progress`

/** "1 file", "3 files". */
const fileCount = (count: number): string => (count === 1 ? '1 file' : `${count} files`)

/** Rings a row while its menu is open, as in the Files tree. */
const MENU_OPEN =
  'data-[state=open]:ring-1 data-[state=open]:ring-ring data-[state=open]:ring-inset'

/** Opens the file in the editor, in the Files view, as the Files tree does; a deleted one or a folder has nothing to open. */
function openFile(file: ChangedFile): void {
  if (file.kind === 'deleted' || file.nestedRepository) return
  useShellLayoutStore.getState().showFiles()
  useEditorTabStore.getState().open(file.absolutePath)
}

/** A native checkbox in a row: clicking it never selects or opens the row; Space on the row toggles it. */
function RowCheckbox({
  state,
  label,
  disabled = false,
  onToggle
}: {
  state: CheckState
  label: string
  disabled?: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      tabIndex={-1}
      aria-label={label}
      disabled={disabled}
      checked={state === 'checked'}
      ref={(input) => {
        if (input) input.indeterminate = state === 'mixed'
      }}
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="mr-1 shrink-0 accent-primary"
    />
  )
}

/** A row's tooltip, under the pointer after a moment, as in the Files tree. */
function RowTip({ text, children }: { text: ReactNode; children: ReactNode }): React.JSX.Element {
  const pointerTip = usePointerTooltip()
  return (
    <Tooltip delayDuration={PATH_TOOLTIP_DELAY_MS} onOpenChange={pointerTip.onOpenChange}>
      <TooltipTrigger
        asChild
        onPointerMove={pointerTip.track}
        // Arrowing through the tree would pop a tooltip at every row; the name is read out anyway.
        onFocus={(event) => event.preventDefault()}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent {...pointerTip.placement}>{text}</TooltipContent>
    </Tooltip>
  )
}

function HunkButton({
  kind,
  group,
  icon: Icon
}: {
  kind: HunkKind
  group: GitGroup
  icon: LucideIcon
}): React.JSX.Element {
  const open = useHunkTabStore((state) => state.open)
  const starting = useHunkTabStore((state) => {
    const tab = tabFor(state.tabs, kind, group.root)
    return tab !== undefined && state.pending.has(tab.id)
  })
  const action = kind === 'review' ? 'Review' : 'Log'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${action} ${group.name}`}
          aria-busy={starting || undefined}
          onClick={(event) => {
            event.stopPropagation()
            open(kind, group.root, group.name)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {starting ? (
            <Spinner className="size-3.5" aria-hidden />
          ) : (
            <Icon className="size-3.5" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {kind === 'review'
          ? `Review ${group.name}'s changes in hunk`
          : `Browse ${group.name}'s history in hunk`}
      </TooltipContent>
    </Tooltip>
  )
}

/** "2 to push, 1 to pull" for an upstream's ahead/behind counts; empty when in step or untracked. */
function syncSummary(group: GitGroup): string {
  return [
    group.ahead ? `${group.ahead} to push` : null,
    group.behind ? `${group.behind} to pull` : null
  ]
    .filter(Boolean)
    .join(', ')
}

function GroupRowContent({
  group,
  expanded,
  checked
}: {
  group: SourceControlGroup
  expanded: boolean
  checked: ReadonlySet<string>
}): React.JSX.Element {
  const toggleGroup = useSourceControlStore((state) => state.toggleGroup)
  if (group.status !== 'git')
    return (
      <>
        <RootFolderIcon className="size-4.5 shrink-0" />
        <span className="type-project-row ml-1 truncate">{group.name}</span>
      </>
    )
  const sync = syncSummary(group)
  return (
    <>
      {trackedFiles(group).length > 0 ? (
        <RowCheckbox
          state={filesCheckState(group.root, trackedFiles(group), checked)}
          label={`Include all changes in ${group.name}`}
          onToggle={() => toggleGroup(group)}
        />
      ) : null}
      <RootFolderIcon className="size-4.5 shrink-0" />
      {/* Both give way on a narrow row, the branch first; the counts and buttons go below a width (all are in the tooltip and menu). */}
      <span className="type-project-row ml-1 max-w-1/2 min-w-0 truncate">{group.name}</span>
      <span className="type-hint ml-1 flex min-w-3.5 shrink-[4] items-center gap-1 overflow-hidden">
        <GitBranch className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{group.branch ?? 'detached'}</span>
      </span>
      {/* Unfolded, the notice under the row says it; folded, this keeps it in sight without crowding the branch. */}
      {group.operation === null || expanded ? null : (
        <TriangleAlert className="ml-1 size-3.5 shrink-0 text-warning" aria-hidden />
      )}
      {group.ahead ? (
        <span className="type-hint ml-1 flex shrink-0 items-center tabular-nums @max-[220px]:hidden">
          <ArrowUp className="size-3" aria-hidden />
          {group.ahead}
        </span>
      ) : null}
      {group.behind ? (
        <span className="type-hint ml-0.5 flex shrink-0 items-center tabular-nums @max-[220px]:hidden">
          <ArrowDown className="size-3" aria-hidden />
          {group.behind}
        </span>
      ) : null}
      {sync ? <span className="sr-only">{sync}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-1 @max-[260px]:hidden">
        <HunkButton kind="review" group={group} icon={GitCompareArrows} />
        <HunkButton kind="log" group={group} icon={History} />
      </span>
    </>
  )
}

function groupTip(group: SourceControlGroup): ReactNode {
  if (group.status !== 'git') return group.root
  const sync = syncSummary(group)
  return (
    <span className="flex flex-col">
      <span>{group.root}</span>
      <span className="text-tooltip-muted-foreground">
        {group.upstream === null
          ? 'No upstream branch'
          : `Tracking ${group.upstream}${sync ? ` · ${sync}` : ''}`}
      </span>
      {group.operation === null ? null : (
        <span className="text-tooltip-muted-foreground">{operationNotice(group)?.title}</span>
      )}
    </span>
  )
}

function FileRowContent({
  group,
  file,
  checked,
  toAdd,
  selected
}: {
  group: GitGroup
  file: ChangedFile
  checked: ReadonlySet<string>
  toAdd: ReadonlySet<string>
  selected: boolean
}): React.JSX.Element {
  const toggleFile = useSourceControlStore((state) => state.toggleFile)
  const toggleToAdd = useSourceControlStore((state) => state.toggleToAdd)
  const kind = CHANGE_KINDS[file.kind]
  const key = fileKey(group.root, file.path)
  // An untracked file is checked to be added, never to be committed as it is.
  const untracked = isUntracked(file)
  const folder = folderOf(file.path)
  // A selected row in the focused tree takes the selection's text colour, so its name stays legible.
  const onSelection = selected && 'group-focus-within/tree:text-selection-foreground'
  return (
    <>
      <RowCheckbox
        state={(untracked ? toAdd : checked).has(key) ? 'checked' : 'unchecked'}
        label={
          file.nestedRepository
            ? `${file.path} is a nested repository`
            : untracked
              ? `Select ${file.path} to add`
              : `Include ${file.path}`
        }
        disabled={file.nestedRepository}
        onToggle={() => (untracked ? toggleToAdd : toggleFile)(group.root, file.path)}
      />
      <FileTreeIcon
        kind={file.nestedRepository ? 'folder' : 'file'}
        name={nameOf(file.path)}
        className="size-4 shrink-0"
      />
      <span className={cn('ml-1 min-w-0 truncate', kind.text, onSelection)}>
        {nameOf(file.path)}
      </span>
      {folder ? (
        <span className="type-hint ml-1.5 min-w-0 shrink-[1000] truncate">{folder}</span>
      ) : null}
      <span
        aria-hidden
        className={cn('ml-auto w-4 shrink-0 pl-1 text-center font-mono', kind.text, onSelection)}
      >
        {kind.letter}
      </span>
    </>
  )
}

/** Adds the group's untracked files checked to add; stays hoverable when none are, to say why. */
function AddToVcsButton({
  group,
  files,
  toAdd
}: {
  group: GitGroup
  files: ChangedFile[]
  toAdd: ReadonlySet<string>
}): React.JSX.Element {
  const addToVcs = useSourceControlStore((state) => state.addToVcs)
  const running = useSourceControlStore((state) => state.running)
  const selected = files.filter((file) => toAdd.has(fileKey(group.root, file.path)))
  const blocked =
    selected.length === 0
      ? 'Check the files to add'
      : running !== null
        ? 'Wait for the current action to finish'
        : null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Add to VCS in ${group.name}`}
          aria-disabled={blocked !== null || undefined}
          aria-busy={running === 'add' || undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (blocked === null) void addToVcs(group, selected)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="ml-auto flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
        >
          {running === 'add' ? (
            <Spinner className="size-3.5" aria-hidden />
          ) : (
            <FilePlus className="size-3.5" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="flex flex-col">
          <span>Add to VCS</span>
          <span className="text-tooltip-muted-foreground">
            {blocked ?? `Add ${fileCount(selected.length)} to version control`}
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function fileDescription(file: ChangedFile): string {
  const kind = file.nestedRepository ? 'nested repository' : CHANGE_KINDS[file.kind].label
  const where = folderOf(file.path)
  return [
    file.originalPath === null ? kind : `${kind} from ${file.originalPath}`,
    where ? `in ${where}` : null
  ]
    .filter(Boolean)
    .join(', ')
}

/** A row with its right-click (or context menu key) menu, and its tooltip if it has one. */
function withMenu(
  key: string,
  menu: ReactNode,
  tip: ReactNode,
  row: React.JSX.Element
): React.JSX.Element {
  const trigger = <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
  return (
    <ContextMenu key={key}>
      {tip === null ? trigger : <RowTip text={tip}>{trigger}</RowTip>}
      {menu}
    </ContextMenu>
  )
}

/**
 * The Commit panel's changes: a row per working tree, with its tracked changes under it and its
 * untracked files under Unversioned Files. A click selects, a double click or Enter opens a file,
 * Space checks the focused row, the delete key asks to trash its file, the context menu key opens
 * its menu.
 */
export function ChangesTree({
  rows,
  onRollback,
  onTrash,
  onAbort
}: {
  rows: ChangeRow[]
  onRollback: RowMenuRequests['onRollback']
  onTrash: RowMenuRequests['onTrash']
  /** Asks to confirm aborting the group's operation. */
  onAbort: (group: GitGroup) => void
}): React.JSX.Element {
  const running = useSourceControlStore((state) => state.running)
  const checked = useSourceControlStore((state) => state.checked)
  const toAdd = useSourceControlStore((state) => state.toAdd)
  const selected = useSourceControlStore((state) => state.selected)
  const select = useSourceControlStore((state) => state.select)
  const toggleFold = useSourceControlStore((state) => state.toggleFold)
  const toggleUnversionedFold = useSourceControlStore((state) => state.toggleUnversionedFold)
  const toggleFile = useSourceControlStore((state) => state.toggleFile)
  const toggleToAdd = useSourceControlStore((state) => state.toggleToAdd)
  const toggleGroup = useSourceControlStore((state) => state.toggleGroup)
  const toggleUnversioned = useSourceControlStore((state) => state.toggleUnversioned)
  const elements = useRef(new Map<string, HTMLElement>())

  const requests: RowMenuRequests = {
    onRollback,
    onTrash,
    onOpen: openFile,
    onFocusMessage: () => document.getElementById(COMMIT_MESSAGE_ID)?.focus()
  }

  const navigable = rows.filter(isNavigable)
  const selectedKey = navigable.some((row) => row.key === selected?.key)
    ? (selected?.key ?? null)
    : null
  const tabbable = selectedKey ?? navigable[0]?.key ?? null

  const choose = (row: ChangeRow): void => {
    select(row.key, rootOf(row))
    elements.current.get(row.key)?.focus()
  }

  const toggleCheck = (row: ChangeRow): void => {
    if (row.type === 'file') {
      if (!row.file.nestedRepository)
        (isUntracked(row.file) ? toggleToAdd : toggleFile)(row.group.root, row.file.path)
    } else if (row.type === 'unversioned') toggleUnversioned(row.group)
    else if (
      row.type === 'group' &&
      row.group.status === 'git' &&
      trackedFiles(row.group).length > 0
    )
      toggleGroup(row.group)
  }

  /** The row a file or Unversioned Files row hangs under. */
  const parentOf = (row: ChangeRow): ChangeRow | undefined => {
    if (
      row.type === 'unversioned' ||
      row.type === 'operation' ||
      (row.type === 'file' && row.depth === 1)
    )
      return navigable.find((each) => each.key === row.group.root)
    if (row.type === 'file')
      return navigable.find((each) => each.type === 'unversioned' && each.group === row.group)
    return undefined
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLButtonElement && !NAVIGATION_KEYS.has(event.key)) return
    const index = navigable.findIndex((row) => row.key === tabbable)
    const row = navigable[index]
    if (!row) return
    if (isDeleteKey(event)) {
      if (row.type === 'file' && row.file.kind !== 'deleted') {
        event.preventDefault()
        onTrash(row.group, [row.file])
      }
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const move = (step: number): void => {
      const target =
        step === -Infinity
          ? navigable[0]
          : step === Infinity
            ? navigable.at(-1)
            : navigable[Math.min(Math.max(index + step, 0), navigable.length - 1)]
      if (target) choose(target)
    }
    const fold = (): void => {
      if (row.type === 'group') toggleFold(row.group.root)
      else if (row.type === 'unversioned') toggleUnversionedFold(row.group.root)
    }
    const folds = row.type === 'group' || row.type === 'unversioned'
    const handled = ((): boolean => {
      switch (event.key) {
        case 'ArrowDown':
          move(1)
          return true
        case 'ArrowUp':
          move(-1)
          return true
        case 'Home':
          move(-Infinity)
          return true
        case 'End':
          move(Infinity)
          return true
        case 'ArrowRight':
          if (folds && !row.expanded) fold()
          else move(1)
          return true
        case 'ArrowLeft': {
          if (folds && row.expanded) fold()
          else {
            const parent = parentOf(row)
            if (parent) choose(parent)
          }
          return true
        }
        case 'Enter':
          if (row.type === 'file') openFile(row.file)
          else fold()
          return true
        case ' ':
          toggleCheck(row)
          return true
        default:
          return false
      }
    })()
    if (handled) event.preventDefault()
  }

  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(key, element)
    else elements.current.delete(key)
  }

  const renderRow = (row: ChangeRow): React.JSX.Element => {
    if (row.type === 'note' || row.type === 'error')
      return (
        <div
          key={row.key}
          role="treeitem"
          aria-level={2}
          aria-disabled
          aria-selected={false}
          className={cn(
            'type-hint flex h-tree-row shrink-0 items-center gap-1.5 select-none',
            row.type === 'error' && 'text-foreground'
          )}
          style={{ paddingLeft: treeIndent(1, 6) }}
        >
          {row.type === 'error' ? (
            <>
              <CircleAlert className="size-4 shrink-0 text-error" aria-hidden />
              <RowTip text={row.message}>
                <span className="truncate">{row.message}</span>
              </RowTip>
            </>
          ) : row.note === 'clean' ? (
            'No changes'
          ) : (
            'Not a git repository'
          )}
        </div>
      )
    const isSelected = row.key === selectedKey
    const common = {
      ref: register(row.key),
      role: 'treeitem',
      'data-tree-key': row.key,
      'aria-selected': isSelected,
      tabIndex: row.key === tabbable ? 0 : -1,
      className: cn(treeRowClass(isSelected), MENU_OPEN),
      onFocus: () => {
        if (!isSelected) select(row.key, rootOf(row))
      },
      onContextMenu: () => choose(row)
    }
    if (row.type === 'group')
      return (
        <div
          key={row.key}
          className="@container sticky top-0 z-10 -mx-2 bg-island px-2 not-first:mt-1.5"
        >
          {withMenu(
            row.key,
            <GroupMenu group={row.group} />,
            groupTip(row.group),
            <div
              {...common}
              aria-level={1}
              aria-expanded={row.expanded}
              aria-label={row.group.name}
              aria-description={
                row.group.status === 'git'
                  ? [
                      `branch ${row.group.branch ?? 'detached'}`,
                      operationDescription(row.group),
                      syncSummary(row.group)
                    ]
                      .filter(Boolean)
                      .join(', ')
                  : undefined
              }
              style={{ paddingLeft: treeIndent(0) }}
              onClick={() => {
                choose(row)
                toggleFold(row.group.root)
              }}
            >
              <ChevronRight
                className={cn('size-4 shrink-0 text-muted-foreground', row.expanded && 'rotate-90')}
                aria-hidden
              />
              <GroupRowContent group={row.group} expanded={row.expanded} checked={checked} />
            </div>
          )}
        </div>
      )
    if (row.type === 'operation') {
      const { group } = row
      const notice = operationNotice(group)
      if (notice === null) return <div key={row.key} />
      const noun = group.operation === null ? '' : OPERATION_NAMES[group.operation.kind].noun
      const blocked = running !== null
      return (
        <Alert
          {...common}
          key={row.key}
          role="treeitem"
          aria-level={2}
          aria-label={notice.title}
          aria-description={[notice.detail, notice.status].filter(Boolean).join(' ')}
          className={cn(
            'my-1 shrink-0 cursor-default gap-x-2 border-warning-border bg-warning-background px-2.5 py-2 outline-none select-none focus-visible:ring-1 focus-visible:ring-ring',
            isSelected && 'group-focus-within/tree:ring-1 group-focus-within/tree:ring-ring'
          )}
          onClick={() => choose(row)}
        >
          <TriangleAlert className="text-warning" aria-hidden />
          <div className="col-start-2 flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
            <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-0.5">
              <AlertTitle className="type-section-title line-clamp-none break-words">
                {notice.title}
              </AlertTitle>
              {notice.detail === null ? null : (
                <p className="type-hint break-words">{notice.detail}</p>
              )}
              <p className="type-hint break-words text-foreground" aria-live="polite">
                {notice.status}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  tabIndex={row.key === tabbable ? 0 : -1}
                  aria-label={`Abort the ${noun} in ${group.name}…`}
                  aria-disabled={blocked || undefined}
                  aria-busy={running === 'abort' || undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!blocked) onAbort(group)
                  }}
                  className={cn(SECONDARY_BUTTON, 'shrink-0')}
                >
                  {running === 'abort' ? <Spinner className="size-4" aria-hidden /> : null}
                  Abort
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {blocked ? 'Wait for the current action to finish' : `Abort the ${noun}…`}
              </TooltipContent>
            </Tooltip>
          </div>
        </Alert>
      )
    }
    if (row.type === 'unversioned') {
      const { group, files } = row
      return withMenu(
        row.key,
        <UnversionedMenu group={group} requests={requests} />,
        null,
        <div
          {...common}
          aria-level={2}
          aria-expanded={row.expanded}
          aria-label="Unversioned Files"
          aria-description={fileCount(files.length)}
          style={{ paddingLeft: treeIndent(1) }}
          onClick={() => {
            choose(row)
            toggleUnversionedFold(group.root)
          }}
        >
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground', row.expanded && 'rotate-90')}
            aria-hidden
          />
          {addableFiles(group).length > 0 ? (
            <RowCheckbox
              state={filesCheckState(group.root, addableFiles(group), toAdd)}
              label={`Select all unversioned files in ${group.name} to add`}
              onToggle={() => toggleUnversioned(group)}
            />
          ) : null}
          <span className="ml-1 min-w-0 truncate">Unversioned Files</span>
          <span
            className={cn(
              'type-hint ml-1.5 shrink-0 tabular-nums',
              isSelected && 'group-focus-within/tree:text-selection-foreground'
            )}
          >
            {fileCount(files.length)}
          </span>
          <AddToVcsButton group={group} files={files} toAdd={toAdd} />
        </div>
      )
    }
    const { file, group, depth } = row
    return withMenu(
      row.key,
      <FileRowMenu group={group} file={file} requests={requests} />,
      file.originalPath === null ? file.path : `${file.path}, renamed from ${file.originalPath}`,
      <div
        {...common}
        aria-level={depth + 1}
        aria-label={nameOf(file.path)}
        aria-description={fileDescription(file)}
        style={{ paddingLeft: treeIndent(depth) }}
        onClick={() => choose(row)}
        onDoubleClick={() => openFile(file)}
      >
        <span className="size-4 shrink-0" aria-hidden />
        <FileRowContent
          group={group}
          file={file}
          checked={checked}
          toAdd={toAdd}
          selected={isSelected}
        />
      </div>
    )
  }

  return (
    <div
      role="tree"
      aria-label="Changes"
      className="group/tree flex min-h-0 flex-1 scroll-pt-tree-row flex-col gap-px overflow-y-auto px-2 pb-2"
      onKeyDown={onKeyDown}
    >
      {rows.map(renderRow)}
    </div>
  )
}

/** "Loading…" in the tree's place while the first status read is slow; nothing when it is fast. */
export function ChangesLoading(): React.JSX.Element {
  const shown = useLoadingShown(true)
  return (
    <p className="type-hint px-4 pt-1" aria-live="polite">
      {shown ? 'Loading…' : null}
    </p>
  )
}
