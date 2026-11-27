import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  GitBranch,
  Plus
} from 'lucide-react'
import { type KeyboardEvent, type SyntheticEvent, useEffect, useId, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/class-names'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useSourceControlStore } from '@/state/source-control-store'
import type { BranchList, LocalBranch, RemoteBranch } from '../../../../shared/branch-api'
import type { GitGroup } from './change-tree-rows'

type BranchChoice =
  | { kind: 'local'; branch: LocalBranch }
  | { kind: 'remote'; branch: RemoteBranch }

type Row = { kind: 'new' } | { kind: 'heading'; label: string } | BranchChoice

type Action = { label: string; run: () => void }

/** The working tree's branches, read when the popup's content mounts: each time it opens. */
function useBranchList(root: string): { list: BranchList | null; error: string | null } {
  const [state, setState] = useState<{ list: BranchList | null; error: string | null }>({
    list: null,
    error: null
  })
  useEffect(() => {
    let current = true
    window.desktop
      .listBranches(root)
      .then((list) => current && setState({ list, error: null }))
      .catch(
        (error: unknown) => current && setState({ list: null, error: mainErrorMessage(error) })
      )
    return () => {
      current = false
    }
  }, [root])
  return state
}

/** New Branch, then local branches, then each remote's, keeping those whose name has `query`. */
function branchRows(list: BranchList, query: string): Row[] {
  const wanted = query.trim().toLowerCase()
  const matches = (name: string): boolean => name.toLowerCase().includes(wanted)
  const local = list.local.filter((branch) => matches(branch.name))
  const remote = list.remote.filter((branch) => matches(branch.name))
  const rows: Row[] = wanted === '' ? [{ kind: 'new' }] : []
  if (local.length > 0)
    rows.push(
      { kind: 'heading', label: 'Local' },
      ...local.map((branch) => ({ kind: 'local' as const, branch }))
    )
  for (const name of new Set(remote.map((branch) => branch.remote)))
    rows.push(
      { kind: 'heading', label: `Remote · ${name}` },
      ...remote
        .filter((branch) => branch.remote === name)
        .map((branch) => ({ kind: 'remote' as const, branch }))
    )
  return rows
}

const folderName = (path: string): string =>
  path.slice(path.replace(/[\\/]+$/, '').search(/[^\\/]*$/))

/** What can be done with a branch, the first being what choosing it does. */
function branchActions(group: GitGroup, choice: BranchChoice): Action[] {
  const store = useSourceControlStore.getState()
  const { name } = choice.branch
  const newFrom: Action = {
    label: `New Branch from ${name}…`,
    run: () => store.openNewBranch(group, { kind: choice.kind, name })
  }
  if (choice.kind === 'remote')
    return [
      {
        label: `Switch to ${name}`,
        run: () => void store.switchBranch(group, { kind: 'remote', name })
      },
      newFrom
    ]
  const { current, worktree } = choice.branch
  if (current || worktree !== null) return [newFrom]
  return [
    {
      label: `Switch to ${name}`,
      run: () => void store.switchBranch(group, { kind: 'local', name })
    },
    newFrom,
    { label: `Delete ${name}…`, run: () => store.openDeleteBranch(group, name) }
  ]
}

/** Up, Down, Home and End move `index` within `count`; returns whether the key was one of them. */
function moveActive(
  event: KeyboardEvent,
  count: number,
  index: number,
  setIndex: (next: number) => void
): boolean {
  const last = count - 1
  const next =
    event.key === 'ArrowDown'
      ? Math.min(last, index + 1)
      : event.key === 'ArrowUp'
        ? Math.max(0, index - 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (next === null) return false
  event.preventDefault()
  setIndex(next)
  return true
}

/** Inside the tree's row, the popup's events must not reach the row (select, fold, tree keys). */
const contain = (event: SyntheticEvent): void => event.stopPropagation()

/** A branch option's name read out: the branch and what its row shows besides. */
function optionLabel(choice: BranchChoice): string {
  if (choice.kind === 'remote') return choice.branch.name
  const { name, current, ahead, behind, worktree, upstreamGone } = choice.branch
  return [
    name,
    current ? 'current' : null,
    worktree === null ? null : `checked out in ${folderName(worktree)}`,
    upstreamGone ? 'upstream gone' : null,
    ahead ? `${ahead} to push` : null,
    behind ? `${behind} to pull` : null
  ]
    .filter(Boolean)
    .join(', ')
}

function BranchRow({ choice }: { choice: BranchChoice }): React.JSX.Element {
  if (choice.kind === 'remote')
    return (
      <>
        <Cloud className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{choice.branch.name}</span>
      </>
    )
  const { name, current, ahead, behind, worktree, upstreamGone } = choice.branch
  return (
    <>
      {current ? (
        <Check className="size-4 shrink-0" aria-hidden />
      ) : (
        <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className={cn('min-w-0 flex-1 truncate', worktree !== null && 'text-muted-foreground')}>
        {name}
      </span>
      {worktree === null ? null : (
        <span className="type-hint max-w-1/3 shrink-0 truncate" aria-hidden>
          {folderName(worktree)}
        </span>
      )}
      {upstreamGone ? (
        <span className="type-hint shrink-0" aria-hidden>
          gone
        </span>
      ) : null}
      {ahead ? (
        <span className="type-hint flex shrink-0 items-center tabular-nums" aria-hidden>
          <ArrowUp className="size-3" />
          {ahead}
        </span>
      ) : null}
      {behind ? (
        <span className="type-hint flex shrink-0 items-center tabular-nums" aria-hidden>
          <ArrowDown className="size-3" />
          {behind}
        </span>
      ) : null}
    </>
  )
}

const OPTION =
  'flex h-list-row shrink-0 cursor-default items-center gap-2 rounded-component px-2 data-[active=true]:bg-popover-selection data-[active=true]:text-popover-selection-foreground'

/** The popup's search and lists: mounted while it is open, so each opening starts afresh. */
function BranchesContent({ group }: { group: GitGroup }): React.JSX.Element {
  const { list, error } = useBranchList(group.root)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [chosen, setChosen] = useState<BranchChoice | null>(null)
  const [actionIndex, setActionIndex] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const actionList = useRef<HTMLUListElement>(null)
  const listId = useId()

  const rows = list === null ? [] : branchRows(list, query)
  const options = rows.filter((row) => row.kind !== 'heading')
  const index = Math.min(active, options.length - 1)
  const actions = chosen === null ? [] : branchActions(group, chosen)

  const showActions = (choice: BranchChoice): void => {
    setChosen(choice)
    setActionIndex(0)
  }
  const back = (): void => {
    setChosen(null)
    search.current?.focus()
  }
  useEffect(() => {
    if (chosen !== null) actionList.current?.focus()
  }, [chosen])

  const pick = (row: Row): void => {
    const store = useSourceControlStore.getState()
    if (row.kind === 'new') store.openNewBranch(group, { kind: 'head' })
    else if (row.kind === 'local' && (row.branch.current || row.branch.worktree !== null))
      showActions(row)
    else if (row.kind === 'local' || row.kind === 'remote') branchActions(group, row)[0]?.run()
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (moveActive(event, options.length, index, setActive)) return
    const row = options[index]
    if (event.key === 'Enter') {
      event.preventDefault()
      if (row) pick(row)
    } else if (
      row &&
      event.key === 'ArrowRight' &&
      (row?.kind === 'local' || row?.kind === 'remote') &&
      event.currentTarget.selectionStart === query.length
    ) {
      event.preventDefault()
      showActions(row)
    }
  }

  const onActionKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (moveActive(event, actions.length, actionIndex, setActionIndex)) return
    if (event.key === 'Enter') {
      event.preventDefault()
      actions[actionIndex]?.run()
    } else if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      event.preventDefault()
      back()
    }
  }

  return (
    <>
      {chosen === null ? (
        <>
          <input
            ref={search}
            role="combobox"
            aria-label="Search branches"
            aria-controls={listId}
            aria-expanded
            aria-activedescendant={index < 0 ? undefined : `${listId}-${index}`}
            placeholder="Search branches"
            autoFocus
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onSearchKey}
            className="h-control rounded-component border border-input-border bg-input px-2.5 text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {list !== null && list.current === null ? (
            <p className="type-hint px-2">
              {list.head === null ? 'HEAD is detached.' : `HEAD is detached at ${list.head}.`}
            </p>
          ) : null}
          {error !== null ? (
            <p role="alert" className="type-hint px-2 text-error">
              {error}
            </p>
          ) : list === null ? (
            <p className="type-hint flex items-center gap-2 px-2" role="status">
              <Spinner className="size-3.5" aria-hidden />
              Reading branches…
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label="Branches"
              className="flex max-h-80 flex-col overflow-y-auto"
            >
              {rows.map((row) => {
                if (row.kind === 'heading')
                  return (
                    <li
                      key={`heading:${row.label}`}
                      role="presentation"
                      className="type-hint shrink-0 px-2 pt-1.5 pb-0.5"
                    >
                      {row.label}
                    </li>
                  )
                const at = options.indexOf(row)
                const key = row.kind === 'new' ? 'new' : `${row.kind}:${row.branch.name}`
                return (
                  <li
                    key={key}
                    id={`${listId}-${at}`}
                    role="option"
                    aria-label={row.kind === 'new' ? undefined : optionLabel(row)}
                    aria-selected={at === index}
                    aria-disabled={
                      row.kind === 'local' && row.branch.worktree !== null ? true : undefined
                    }
                    data-active={at === index}
                    ref={
                      at === index
                        ? (item) => item?.scrollIntoView({ block: 'nearest' })
                        : undefined
                    }
                    onMouseEnter={() => setActive(at)}
                    onClick={() => pick(row)}
                    className={cn(OPTION, 'group/option')}
                  >
                    {row.kind === 'new' ? (
                      <>
                        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">New Branch…</span>
                      </>
                    ) : (
                      <>
                        <BranchRow choice={row} />
                        <span
                          aria-hidden
                          title="More actions"
                          onClick={(event) => {
                            event.stopPropagation()
                            showActions(row)
                          }}
                          className="flex size-small-icon-button shrink-0 items-center justify-center rounded-button opacity-0 group-hover/option:opacity-100 group-data-[active=true]/option:opacity-100 hover:bg-hover"
                        >
                          <ChevronRight className="size-3.5" />
                        </span>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {list !== null && options.length === 0 ? (
            <p className="type-hint px-2" role="status">
              No branches match.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={back}
            tabIndex={-1}
            className="type-hint flex h-list-row items-center gap-1 rounded-component px-1 hover:bg-hover"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{chosen.branch.name}</span>
            <span className="sr-only">: back to the branches</span>
          </button>
          {chosen.kind === 'local' && chosen.branch.worktree !== null ? (
            <p className="type-hint px-2">{`Checked out in ${chosen.branch.worktree}: switch there instead.`}</p>
          ) : null}
          <ul
            ref={actionList}
            role="listbox"
            tabIndex={0}
            aria-label={`Actions for ${chosen.branch.name}`}
            aria-activedescendant={`${listId}-action-${actionIndex}`}
            onKeyDown={onActionKey}
            className="flex flex-col outline-none"
          >
            {actions.map((action, at) => (
              <li
                key={action.label}
                id={`${listId}-action-${at}`}
                role="option"
                aria-selected={at === actionIndex}
                data-active={at === actionIndex}
                onMouseEnter={() => setActionIndex(at)}
                onClick={action.run}
                className={OPTION}
              >
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * The working tree's branch on its row, opening its branches: type to filter, Enter or a click
 * switches, Right Arrow (or the arrow at a row's end) lists what else can be done with one.
 */
export function BranchPopover({ group }: { group: GitGroup }): React.JSX.Element {
  const open = useSourceControlStore((state) => state.branchesOpen === group.root)
  const openBranches = useSourceControlStore((state) => state.openBranches)
  const switching = useSourceControlStore((state) => state.running === 'switch-branch')
  return (
    <Popover open={open} onOpenChange={(next) => openBranches(next ? group.root : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Branches of ${group.name}`}
          aria-haspopup="dialog"
          onClick={contain}
          onDoubleClick={contain}
          className="type-hint ml-1 flex min-w-3.5 shrink-[4] items-center gap-1 overflow-hidden rounded-button px-0.5 hover:bg-hover hover:text-foreground"
        >
          {switching ? (
            <Spinner className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{group.branch ?? 'detached'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`Branches of ${group.name}`}
        className="flex w-80 flex-col gap-1.5"
        onClick={contain}
        onDoubleClick={contain}
        onKeyDown={contain}
        onContextMenu={contain}
        onFocus={contain}
      >
        <BranchesContent group={group} />
      </PopoverContent>
    </Popover>
  )
}
