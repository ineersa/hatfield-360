import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  GitBranch,
  GitCompareArrows,
  History,
  type LucideIcon
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { treeIndent, treeRowClass } from '@/components/tree/tree-row-style'
import { useLoadingShown } from '@/components/tree/use-loading-delay'
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
import { useHunkTabStore } from '@/state/hunk-tab-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { useSourceControlStore } from '@/state/source-control-store'
import type {
  ChangedFile,
  ChangeKind,
  HunkKind,
  SourceControlGroup
} from '../../../../shared/source-control-api'
import {
  type ChangeRow,
  type CheckState,
  fileKey,
  type GitGroup,
  groupCheckState
} from './change-tree-rows'

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

const isNavigable = (row: ChangeRow): boolean => row.type === 'group' || row.type === 'file'

const rootOf = (row: ChangeRow): string =>
  row.type === 'group' || row.type === 'file' ? row.group.root : row.key

/** Opens the file in the editor, in the Files view, as the Files tree does; a deleted one has nothing to open. */
function openFile(file: ChangedFile): void {
  if (file.kind === 'deleted') return
  useShellLayoutStore.getState().showFiles()
  useEditorTabStore.getState().open(file.absolutePath)
}

/** A native checkbox in a row: clicking it never selects or opens the row; Space on the row toggles it. */
function RowCheckbox({
  state,
  label,
  onToggle
}: {
  state: CheckState
  label: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      tabIndex={-1}
      aria-label={label}
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
  const starting = useHunkTabStore((state) => state.starting.has(`${kind}\0${group.root}`))
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
            void open(kind, group.root, group.name)
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
  checked
}: {
  group: SourceControlGroup
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
      {group.files.length > 0 ? (
        <RowCheckbox
          state={groupCheckState(group, checked)}
          label={`Include all changes in ${group.name}`}
          onToggle={() => toggleGroup(group)}
        />
      ) : null}
      <RootFolderIcon className="size-4.5 shrink-0" />
      <span className="type-project-row ml-1 min-w-0 shrink truncate">{group.name}</span>
      <span className="type-hint ml-1 flex min-w-0 shrink-[2] items-center gap-1">
        <GitBranch className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{group.branch ?? 'detached'}</span>
      </span>
      {group.ahead ? (
        <span className="type-hint ml-1 flex shrink-0 items-center tabular-nums">
          <ArrowUp className="size-3" aria-hidden />
          {group.ahead}
        </span>
      ) : null}
      {group.behind ? (
        <span className="type-hint ml-0.5 flex shrink-0 items-center tabular-nums">
          <ArrowDown className="size-3" aria-hidden />
          {group.behind}
        </span>
      ) : null}
      {sync ? <span className="sr-only">{sync}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
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
    </span>
  )
}

function FileRowContent({
  group,
  file,
  checked,
  selected
}: {
  group: GitGroup
  file: ChangedFile
  checked: ReadonlySet<string>
  selected: boolean
}): React.JSX.Element {
  const toggleFile = useSourceControlStore((state) => state.toggleFile)
  const kind = CHANGE_KINDS[file.kind]
  const folder = folderOf(file.path)
  // A selected row in the focused tree takes the selection's text colour, so its name stays legible.
  const onSelection = selected && 'group-focus-within/tree:text-selection-foreground'
  return (
    <>
      <RowCheckbox
        state={checked.has(fileKey(group.root, file.path)) ? 'checked' : 'unchecked'}
        label={`Include ${file.path}`}
        onToggle={() => toggleFile(group.root, file.path)}
      />
      <FileTreeIcon kind="file" name={nameOf(file.path)} className="size-4 shrink-0" />
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

function fileDescription(file: ChangedFile): string {
  const kind = CHANGE_KINDS[file.kind].label
  const where = folderOf(file.path)
  return [
    file.originalPath === null ? kind : `${kind} from ${file.originalPath}`,
    where ? `in ${where}` : null
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * The Commit panel's changes: a row per working tree, with its changed files under it. A click
 * selects, a double click or Enter opens a file, Space checks the focused row.
 */
export function ChangesTree({ rows }: { rows: ChangeRow[] }): React.JSX.Element {
  const checked = useSourceControlStore((state) => state.checked)
  const selected = useSourceControlStore((state) => state.selected)
  const select = useSourceControlStore((state) => state.select)
  const toggleFold = useSourceControlStore((state) => state.toggleFold)
  const toggleFile = useSourceControlStore((state) => state.toggleFile)
  const toggleGroup = useSourceControlStore((state) => state.toggleGroup)
  const elements = useRef(new Map<string, HTMLElement>())

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
    if (row.type === 'file') toggleFile(row.group.root, row.file.path)
    else if (row.type === 'group' && row.group.status === 'git' && row.group.files.length > 0)
      toggleGroup(row.group)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLButtonElement) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const index = navigable.findIndex((row) => row.key === tabbable)
    const row = navigable[index]
    if (!row) return
    const move = (step: number): void => {
      const target =
        step === -Infinity
          ? navigable[0]
          : step === Infinity
            ? navigable.at(-1)
            : navigable[Math.min(Math.max(index + step, 0), navigable.length - 1)]
      if (target) choose(target)
    }
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
          if (row.type === 'group' && !row.expanded) toggleFold(row.group.root)
          else move(1)
          return true
        case 'ArrowLeft': {
          if (row.type === 'group' && row.expanded) toggleFold(row.group.root)
          const parent =
            row.type === 'file' ? navigable.find((each) => each.key === row.group.root) : undefined
          if (parent) choose(parent)
          return true
        }
        case 'Enter':
          if (row.type === 'group') toggleFold(row.group.root)
          else if (row.type === 'file') openFile(row.file)
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
      onFocus: () => {
        if (!isSelected) select(row.key, rootOf(row))
      }
    }
    if (row.type === 'group')
      return (
        <div key={row.key} className="sticky top-0 z-10 -mx-2 bg-island px-2 not-first:mt-1.5">
          <RowTip text={groupTip(row.group)}>
            <div
              {...common}
              aria-level={1}
              aria-expanded={row.expanded}
              aria-label={row.group.name}
              aria-description={
                row.group.status === 'git'
                  ? [`branch ${row.group.branch ?? 'detached'}`, syncSummary(row.group)]
                      .filter(Boolean)
                      .join(', ')
                  : undefined
              }
              className={treeRowClass(isSelected)}
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
              <GroupRowContent group={row.group} checked={checked} />
            </div>
          </RowTip>
        </div>
      )
    const { file, group } = row
    return (
      <RowTip
        key={row.key}
        text={
          file.originalPath === null ? file.path : `${file.path}, renamed from ${file.originalPath}`
        }
      >
        <div
          {...common}
          aria-level={2}
          aria-label={nameOf(file.path)}
          aria-description={fileDescription(file)}
          className={treeRowClass(isSelected)}
          style={{ paddingLeft: treeIndent(1) }}
          onClick={() => choose(row)}
          onDoubleClick={() => openFile(file)}
        >
          <span className="size-4 shrink-0" aria-hidden />
          <FileRowContent group={group} file={file} checked={checked} selected={isSelected} />
        </div>
      </RowTip>
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
