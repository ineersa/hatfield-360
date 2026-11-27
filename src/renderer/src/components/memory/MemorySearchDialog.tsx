import {
  ChevronRight,
  CircleDashed,
  Clock,
  Copy,
  GitBranch,
  History,
  LoaderCircle,
  Play,
  Search,
  Settings,
  SquareTerminal,
  TriangleAlert
} from 'lucide-react'
import { Dialog } from 'radix-ui'
import { copyText, TextContextMenu } from '@/components/text-menu/TextContextMenu'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { Fragment, useEffect, useRef, useState } from 'react'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import { resumeRecentConversation } from '@/components/terminal/resume-recent-conversation'
import { selectTerminal } from '@/components/terminal/terminal-tab-controllers'
import { focusActiveTerminal } from '@/components/terminal/use-terminal-commands'
import {
  agentSessionIdentity,
  sessionState,
  statuses,
  useAgentSessions
} from '@/components/workspace/AgentSessionRows'
import { cn } from '@/lib/class-names'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useMemorySearchStore } from '@/state/memory-search-store'
import { notify } from '@/state/notification-store'
import { recentCatalogScope, useRecentSessionStore } from '@/state/recent-session-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import { AGENT_PROVIDERS } from '../../../../shared/agent-api'
import type {
  MemoryEvidence,
  MemoryHit,
  MemoryImportance,
  MemoryRecallResult,
  MemorySearchResult
} from '../../../../shared/memory-search-api'
import { memorySource, type MemorySource } from './memory-sources'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const DEBOUNCE_MS = 250

const chipClass =
  'type-hint inline-flex items-center gap-1 rounded-component border border-separator px-1.5 py-0.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const buttonClass =
  'type-button flex h-control shrink-0 items-center gap-1.5 rounded-button px-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const primaryClass = 'bg-primary text-primary-foreground hover:bg-primary/90'
const quietClass = 'text-muted-foreground hover:bg-hover hover:text-foreground'
const outlineClass = 'border border-button-border bg-button hover:bg-hover'

const importanceClass: Record<MemoryImportance, string> = {
  critical: 'border-error-border bg-error-background text-error',
  high: 'border-warning-border bg-warning-background text-warning',
  medium: 'border-info-border bg-info-background text-info',
  low: 'border-separator text-muted-foreground'
}
const ranges = [
  { id: 'any', label: 'Any time', days: null },
  { id: 'week', label: 'Past week', days: 7 },
  { id: 'month', label: 'Past month', days: 30 }
] as const
type Range = (typeof ranges)[number]['id']
const examples = ['design decision', 'test failure', 'why was this changed']

function stamp(at: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return `Today ${time}`
  if (date.toDateString() === new Date(today.getTime() - DAY).toDateString())
    return `Yesterday ${time}`
  const sameYear = date.getFullYear() === today.getFullYear()
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} ${time}`
}

function ago(at: number): string {
  const elapsed = Date.now() - at
  if (elapsed < HOUR) return `${Math.max(1, Math.round(elapsed / MINUTE))}m ago`
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h ago`
  if (elapsed < 2 * DAY) return 'yesterday'
  return `${Math.floor(elapsed / DAY)}d ago`
}

const queryTerms = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((word) => word.length > 2)

/** Plain text with the query's words marked; never parsed as markup. */
function Highlighted({ text, terms }: { text: string; terms: string[] }): React.JSX.Element {
  if (terms.length === 0) return <>{text}</>
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu'
  )
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded-component bg-selection-inactive text-foreground">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  )
}

function SessionSource({
  source,
  hit
}: {
  source: MemorySource
  hit: MemoryHit
}): React.JSX.Element {
  if (source.kind === 'unknown') {
    const owner = source.provider ? `${AGENT_PROVIDERS[source.provider]} session` : 'Session'
    return (
      <span className="type-hint flex min-w-0 items-center gap-1.5">
        {source.provider ? (
          <AgentProviderIcon provider={source.provider} className="size-4" />
        ) : (
          <CircleDashed className="size-4 shrink-0" aria-hidden />
        )}
        <span className="truncate" title={hit.sessionId}>
          {owner} {source.provider === 'hatfield' ? `#${hit.sessionId}` : hit.sessionId.slice(0, 8)}{' '}
          · not in this project&apos;s recent sessions
        </span>
      </span>
    )
  }
  const identity = agentSessionIdentity(
    source.kind === 'live' ? source.session : source.entry
  ).displayName
  const provider = source.kind === 'live' ? source.session.provider : source.entry.provider
  const branch = source.kind === 'history' ? source.entry.branch : null
  const state = source.kind === 'live' ? sessionState(source.session) : null
  return (
    <span className="type-hint flex min-w-0 items-center gap-2">
      <AgentProviderIcon provider={provider} className="size-4" />
      <span className="truncate text-foreground">{identity}</span>
      {branch ? (
        <span className="flex shrink-0 items-center gap-1">
          <GitBranch className="size-3.5" aria-hidden />
          {branch}
        </span>
      ) : null}
      <span aria-hidden>·</span>
      {source.kind === 'live' ? (
        <span className={cn('shrink-0', state ? statuses[state].color : undefined)}>
          {state ? statuses[state].label : 'Running'}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1">
          <History className="size-3.5" aria-hidden />
          last active {ago(source.entry.lastModified)}
        </span>
      )}
    </span>
  )
}

const speakers: Record<MemoryEvidence['speaker'], string> = {
  user: 'User',
  assistant: 'Agent',
  tool: 'Tool'
}

function Evidence({ project, hit }: { project: string; hit: MemoryHit }): React.JSX.Element {
  const [answer, setAnswer] = useState<{ attempt: number; result: MemoryRecallResult } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    const settle = (result: MemoryRecallResult): void => {
      if (current) setAnswer({ attempt, result })
    }
    window.desktop
      .recallMemory(project, hit.id)
      .then(settle, (error: unknown) =>
        settle({ status: 'error', message: mainErrorMessage(error) })
      )
    return () => {
      current = false
    }
  }, [project, hit.id, attempt])
  const result = answer?.attempt === attempt ? answer.result : null
  return (
    <div
      role="region"
      aria-label="Source evidence"
      className="flex flex-col gap-1.5 border-l border-separator pl-3"
    >
      {result === null ? (
        <p className="type-hint flex items-center gap-1.5">
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />
          Recalling the source events…
        </p>
      ) : result.status === 'ok' ? (
        result.evidence.length === 0 ? (
          <p className="type-hint">Librarian kept no readable source events for this memory.</p>
        ) : (
          <>
            <p className="type-hint">What the session recorded when this was remembered:</p>
            <ol className="flex flex-col gap-1.5">
              {result.evidence.map((line, index) => (
                <li key={index} className="grid grid-cols-[auto_auto_1fr] gap-x-3">
                  <span className="type-hint pt-px tabular-nums">
                    {line.at === null ? '' : stamp(line.at)}
                  </span>
                  <span className="type-hint pt-px">{speakers[line.speaker]}</span>
                  <p className="type-body line-clamp-4 break-words whitespace-pre-wrap text-muted-foreground">
                    {line.text}
                  </p>
                </li>
              ))}
            </ol>
          </>
        )
      ) : (
        <p className="type-hint flex flex-wrap items-center gap-2 text-error">
          {result.status === 'unconfigured'
            ? 'Memory search is no longer set up.'
            : result.status === 'error'
              ? `Couldn't recall the source: ${result.message}`
              : null}
          <button
            type="button"
            onClick={() => setAttempt(attempt + 1)}
            className={cn(buttonClass, outlineClass, 'text-foreground')}
          >
            Try again
          </button>
        </p>
      )}
    </div>
  )
}

function ResultItem({
  project,
  hit,
  source,
  terms,
  selected,
  onSelect,
  onOpen
}: {
  project: string
  hit: MemoryHit
  source: MemorySource
  terms: string[]
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}): React.JSX.Element {
  const [context, setContext] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <TextContextMenu
      renderItems={(_element, choose) => (
        <>
          {source.kind === 'unknown' ? null : (
            <ContextMenuItem onSelect={() => choose(onOpen)}>
              {source.kind === 'live' ? <SquareTerminal aria-hidden /> : <Play aria-hidden />}
              {source.kind === 'live' ? 'Open Terminal' : 'Resume'}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => setContext(!context)}>
            <ChevronRight aria-hidden />
            {context ? 'Hide Context' : 'Show Context'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => copyText(hit.content)}>
            <Copy aria-hidden />
            Copy Memory
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copyText(hit.sessionId)}>
            <Copy aria-hidden />
            Copy Session ID
          </ContextMenuItem>
        </>
      )}
    >
      <li
        ref={ref}
        data-text-scope
        aria-label={`${hit.kind === 'observation' ? 'Observation' : 'Reflection'} from ${stamp(hit.at)}`}
        aria-current={selected || undefined}
        onMouseDown={onSelect}
        className={cn(
          'flex flex-col gap-2 border-l-2 py-3 pr-4 pl-3.5',
          selected ? 'border-l-ring bg-hover' : 'border-l-transparent'
        )}
      >
        <div className="flex items-center gap-2">
          <span className="type-hint text-foreground capitalize">{hit.kind}</span>
          {hit.importance ? (
            <span
              className={cn(
                'type-hint rounded-component border px-1.5 leading-normal',
                importanceClass[hit.importance]
              )}
            >
              {hit.importance}
            </span>
          ) : null}
          <span className="flex-1" />
          <span className="type-hint tabular-nums" title={new Date(hit.at).toLocaleString()}>
            {stamp(hit.at)}
          </span>
        </div>
        <p className="type-body break-words whitespace-pre-wrap text-foreground">
          <Highlighted text={hit.content} terms={terms} />
        </p>
        {context ? <Evidence project={project} hit={hit} /> : null}
        <div className="flex min-w-0 items-center gap-2">
          <SessionSource source={source} hit={hit} />
          <span className="flex-1" />
          <button
            type="button"
            aria-expanded={context}
            onClick={() => setContext(!context)}
            className={cn(buttonClass, quietClass)}
          >
            <ChevronRight className={cn('size-4', context && 'rotate-90')} aria-hidden />
            Context
          </button>
          {source.kind === 'unknown' ? (
            <button
              type="button"
              onClick={() => {
                void window.desktop.writeTerminalClipboard(hit.sessionId).then(
                  () => notify({ severity: 'info', title: 'Session ID copied' }),
                  (error: unknown) =>
                    notify({
                      severity: 'error',
                      title: "Couldn't copy the session ID",
                      body: mainErrorMessage(error)
                    })
                )
              }}
              className={cn(buttonClass, quietClass)}
            >
              <Copy className="size-4" aria-hidden />
              Copy session ID
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className={cn(buttonClass, selected ? primaryClass : outlineClass)}
            >
              {source.kind === 'live' ? (
                <SquareTerminal className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {source.kind === 'live' ? 'Open terminal' : 'Resume'}
            </button>
          )}
        </div>
      </li>
    </TextContextMenu>
  )
}

function Notice({
  icon: Icon,
  tone,
  title,
  children
}: {
  icon: typeof Search
  tone?: 'error'
  title: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div role="status" className="flex flex-col items-center gap-2 px-8 py-12 text-center">
      <Icon
        className={cn('size-5', tone === 'error' ? 'text-error' : 'text-muted-foreground')}
        aria-hidden
      />
      <p className="type-section-title">{title}</p>
      {children}
    </div>
  )
}

let searchInput: HTMLInputElement | null = null

/** Gives the open popup's search input the keys, for a menu that would return them to its row. */
export function focusMemorySearch(): void {
  searchInput?.focus()
}

type SearchKey = { project: string; query: string; range: Range; attempt: number }
type Outcome = { search: SearchKey; result: MemorySearchResult }

function useRecentCatalog(): {
  generation: number
  catalog: ReturnType<typeof useRecentSessionStore.getState>['catalog']
} {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const projects = useWorktreeStore((state) => state.projects)
  const catalog = useRecentSessionStore((state) => state.catalog)
  const load = useRecentSessionStore((state) => state.load)
  const generation = workspace?.terminalGeneration ?? 0
  const scope = recentCatalogScope(workspace?.folders ?? [], projects)
  const key = JSON.stringify([generation, scope])
  useEffect(() => {
    if (useRecentSessionStore.getState().catalog?.key !== key) void load(generation, scope)
  }, [key, generation, scope, load])
  return { generation, catalog: catalog?.key === key ? catalog : null }
}

function MemorySearch({
  project,
  onNavigated
}: {
  project: string
  onNavigated: () => void
}): React.JSX.Element {
  const close = useMemorySearchStore((state) => state.close)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const projectName =
    workspace?.folders.find((folder) => folder.path === project)?.name ?? 'this project'
  const { sessions } = useAgentSessions()
  const { generation, catalog } = useRecentCatalog()
  const [query, setQuery] = useState('')
  const [settled, setSettled] = useState('')
  const [range, setRange] = useState<Range>('any')
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    searchInput = input.current
    return () => {
      searchInput = null
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const wantedKey = JSON.stringify({ project, query: settled, range, attempt })
  useEffect(() => {
    const search: SearchKey = { project, query: settled, range, attempt }
    let current = true
    const days = ranges.find(({ id }) => id === search.range)?.days ?? null
    if (search.query)
      window.desktop
        .searchMemory({
          project: search.project,
          query: search.query,
          after: days === null ? null : Date.now() - days * DAY
        })
        .then(
          (result) => {
            if (current && result.status !== 'superseded') {
              setOutcome({ search, result })
              setSelected(0)
            }
          },
          (error: unknown) => {
            if (current)
              setOutcome({ search, result: { status: 'error', message: mainErrorMessage(error) } })
          }
        )
    return () => {
      current = false
    }
  }, [project, settled, range, attempt])

  // Results stay on screen, dimmed, while a newer search for the same project runs.
  const shown = outcome?.search.project === project && settled ? outcome : null
  const searching =
    query.trim() !== settled || (!!settled && JSON.stringify(shown?.search) !== wantedKey)
  const result = shown?.result ?? null
  const hits = result?.status === 'ok' ? result.hits : []
  const terms = queryTerms(shown?.search.query ?? '')
  const sources = hits.map((hit) =>
    memorySource(
      hit,
      project,
      sessions,
      catalog?.sessions ?? [],
      catalog?.scopeAliases ?? new Map<string, string>()
    )
  )
  const openSource = (source: MemorySource | undefined): void => {
    if (!source || source.kind === 'unknown') return
    if (source.kind === 'live') {
      if (!selectTerminal(source.session.terminalId)) {
        notify({ severity: 'warning', title: 'Terminal is no longer available' })
        return
      }
    } else {
      resumeRecentConversation(source.entry, generation, false, sessions)
    }
    onNavigated()
    close()
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (hits.length === 0) return
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setSelected((index) => Math.min(Math.max(index + step, 0), hits.length - 1))
        } else if (event.key === 'Enter' && event.target === input.current) {
          event.preventDefault()
          openSource(sources[selected])
        }
      }}
    >
      <div className="flex flex-col gap-2.5 border-b border-separator px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <RootFolderIcon className="size-4 shrink-0" />
          <Dialog.Title className="type-section-title">
            Search memory<span className="text-muted-foreground"> · </span>
            {projectName}
          </Dialog.Title>
        </div>
        <div className="flex h-control items-center gap-2.5 rounded-button border border-input-border bg-input px-2.5 focus-within:border-ring">
          {searching ? (
            <LoaderCircle
              className="size-4.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
              aria-label="Searching"
            />
          ) : (
            <Search className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <input
            ref={input}
            type="text"
            aria-label="Search memory"
            placeholder="Ask about a decision, fix or finding…"
            maxLength={2000}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="type-body min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-1">
          <div role="group" aria-label="Memory date" className="flex items-center gap-1">
            {ranges.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={range === id}
                onClick={() => setRange(id)}
                className={cn(chipClass, range === id && 'border-ring bg-hover text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {result?.status === 'ok' && result.partial ? (
            <span className="type-hint flex items-center gap-1 text-warning">
              <Clock className="size-3.5" aria-hidden />
              Index is catching up: the newest memories may be missing
            </span>
          ) : hits.length > 0 ? (
            <span className="type-hint">
              {hits.length} {hits.length === 1 ? 'memory' : 'memories'}, most relevant first
            </span>
          ) : null}
        </div>
      </div>

      <div
        aria-busy={searching}
        className={cn('min-h-0 flex-1 overflow-y-auto', searching && shown && 'opacity-60')}
      >
        {result?.status === 'unconfigured' ? (
          <Notice icon={Settings} title={`Memory search isn't set up for ${projectName}`}>
            <p className="type-description max-w-md">
              It needs a Librarian server: add its MCP endpoint in Settings. Terminals and agent
              sessions work without it.
            </p>
            <button
              type="button"
              onClick={() => {
                close()
                useShellLayoutStore.getState().openSettings()
              }}
              className={cn(buttonClass, primaryClass, 'mt-2')}
            >
              <Settings className="size-4" aria-hidden />
              Open Settings
            </button>
          </Notice>
        ) : result?.status === 'error' ? (
          <Notice icon={TriangleAlert} tone="error" title="Search failed">
            <p className="type-description max-w-md break-words">{result.message}</p>
            <button
              type="button"
              onClick={() => setAttempt(attempt + 1)}
              className={cn(buttonClass, outlineClass, 'mt-2')}
            >
              Try again
            </button>
          </Notice>
        ) : !settled ? (
          <Notice icon={Search} title={`What did your agents learn in ${projectName}?`}>
            <p className="type-description max-w-md">
              Searches the observations and reflections agents kept, from live and closed sessions.
              Open the session a memory came from to continue there.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setQuery(example)
                    input.current?.focus()
                  }}
                  className={chipClass}
                >
                  {example}
                </button>
              ))}
            </div>
          </Notice>
        ) : result === null ? (
          <Notice icon={LoaderCircle} title="Searching memory…" />
        ) : hits.length === 0 ? (
          <Notice icon={Search} title={`Nothing remembered matches “${shown?.search.query ?? ''}”`}>
            <p className="type-description max-w-md">
              Memory holds what agents chose to keep, so a conversation can exist without a match.
              Try other words, or ask the agent in that session.
            </p>
          </Notice>
        ) : (
          <ul aria-label="Memories" className="flex flex-col divide-y divide-separator">
            {hits.map((hit, index) => (
              <ResultItem
                key={hit.id}
                project={project}
                hit={hit}
                source={sources[index] ?? { kind: 'unknown', provider: hit.provider }}
                terms={terms}
                selected={index === selected}
                onSelect={() => setSelected(index)}
                onOpen={() => openSource(sources[index])}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="type-hint flex items-center gap-4 border-t border-separator px-4 py-2">
        <span className="truncate">Searches memories agents kept, not every transcript.</span>
        <span className="flex-1" />
        <span className="whitespace-nowrap">↑↓ select · ↵ open session · Esc close</span>
      </div>
    </div>
  )
}

/** Librarian memory search for one project, over the still-mounted workspace. */
export function MemorySearchDialog(): React.JSX.Element {
  const project = useMemorySearchStore((state) => state.project)
  const close = useMemorySearchStore((state) => state.close)
  const navigated = useRef(false)
  return (
    <Dialog.Root open={project !== null} onOpenChange={(open) => (open ? null : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" />
        {/* Its own text menu: the app's is outside the dialog's focus trap. */}
        <TextContextMenu>
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // The search input focuses itself.
              event.preventDefault()
              navigated.current = false
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              // After opening a session its terminal takes the keys, not what had focus before.
              if (navigated.current) focusActiveTerminal()
              else useMemorySearchStore.getState().returnFocus?.focus()
            }}
            className="fixed top-[8vh] left-1/2 z-50 flex max-h-[84vh] w-[min(60rem,calc(100vw-4rem))] -translate-x-1/2 flex-col overflow-hidden rounded-popup border border-dialog-border bg-dialog shadow-lg"
          >
            {project === null ? null : (
              <MemorySearch
                key={project}
                project={project}
                onNavigated={() => {
                  navigated.current = true
                }}
              />
            )}
          </Dialog.Content>
        </TextContextMenu>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
