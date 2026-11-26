import { Box, Braces, SquareFunction, Variable } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { folderLabel, useNamedFolders } from '@/components/search/workspace-folder-label'
import { cn } from '@/lib/class-names'
import { useSearchEverywhereStore } from '@/state/search-everywhere-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import type { MatchRanges } from '../../../../shared/fuzzy-path-match'
import type { FileHit, SearchEverywhereKind } from '../../../../shared/search-everywhere-api'
import { isClassKind, type SymbolHit } from '../../../../shared/workspace-symbol-hits'

const KINDS: { kind: SearchEverywhereKind; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'classes', label: 'Classes' },
  { kind: 'files', label: 'Files' },
  { kind: 'symbols', label: 'Symbols' }
]

/** On All, each kind lists its best few; its own tab lists them all. */
const ALL_TAB_LIMIT = 15

/** `text[from, to)` with the matched characters of `ranges` (indexes into the whole text) marked. */
function Highlighted({
  text,
  ranges,
  from = 0,
  to = text.length
}: {
  text: string
  ranges: MatchRanges
  from?: number
  to?: number
}): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = from
  for (const [start, end] of ranges) {
    const s = Math.max(start, from)
    const e = Math.min(end, to)
    if (s >= e) continue
    if (s > at) parts.push(text.slice(at, s))
    parts.push(
      <mark key={s} className="rounded-component bg-search-match text-foreground">
        {text.slice(s, e)}
      </mark>
    )
    at = e
  }
  if (at < to) parts.push(text.slice(at, to))
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  )
}

function SymbolIcon({ kind }: { kind: number }): React.JSX.Element {
  // LSP SymbolKind: Method, Constructor, Function; Variable, Constant, Field, Property.
  if (isClassKind(kind)) return <Box aria-hidden />
  if (kind === 6 || kind === 9 || kind === 12) return <SquareFunction aria-hidden />
  if (kind === 7 || kind === 8 || kind === 13 || kind === 14) return <Variable aria-hidden />
  return <Braces aria-hidden />
}

const fileKey = (hit: FileHit): string => `file:${hit.path}`
const symbolKey = (hit: SymbolHit): string =>
  `symbol:${hit.path}:${String(hit.line)}:${String(hit.column)}:${hit.name}:${String(hit.kind)}`

/** Cut from its start when it doesn't fit, so the folders nearest the file stay visible. */
function StartTruncated({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span dir="rtl" className="min-w-0 truncate text-left">
      <bdi dir="ltr">{children}</bdi>
    </span>
  )
}

/** The container's own name: `RunEventLog` of `App\Session\RunEventLog`. */
const shortContainer = (container: string): string =>
  container.split(/\\|::|[./]/).findLast((part) => part !== '') ?? container

function FileItem({
  hit,
  showFolder,
  onChoose
}: {
  hit: FileHit
  showFolder: boolean
  onChoose: () => void
}): React.JSX.Element {
  const slash = hit.relative.lastIndexOf('/')
  const name = hit.relative.slice(slash + 1)
  return (
    <CommandItem value={fileKey(hit)} onSelect={onChoose} title={hit.path}>
      <FileTreeIcon kind="file" name={name} className="size-4 shrink-0" />
      <span className="shrink-0">
        <Highlighted text={hit.relative} ranges={hit.ranges} from={slash + 1} />
      </span>
      {showFolder || slash >= 0 ? (
        <span className="flex min-w-0 type-hint">
          <StartTruncated>
            {showFolder ? `${hit.folder}/` : null}
            {slash < 0 ? null : <Highlighted text={hit.relative} ranges={hit.ranges} to={slash} />}
          </StartTruncated>
        </span>
      ) : null}
    </CommandItem>
  )
}

function SymbolItem({
  hit,
  folder,
  unlisted,
  onChoose
}: {
  hit: SymbolHit
  /** Where its file is, from the workspace folder. */
  folder: string
  /** Ignored by git, a dependency or outside the workspace: coloured as JetBrains colours ignored files. */
  unlisted: boolean
  onChoose: () => void
}): React.JSX.Element {
  const file = hit.path.split(/[\\/]/).pop() ?? hit.path
  const at = hit.line === null ? file : `${file}:${String(hit.line)}`
  return (
    <CommandItem
      value={symbolKey(hit)}
      onSelect={onChoose}
      title={[hit.container, `${hit.path}${hit.line === null ? '' : `:${String(hit.line)}`}`]
        .filter(Boolean)
        .join('\n')}
    >
      <SymbolIcon kind={hit.kind} />
      <span className={cn('max-w-[40%] shrink-0 truncate', unlisted && 'text-file-ignored')}>
        <Highlighted text={hit.name} ranges={hit.ranges} />
      </span>
      {/* Short of room, the container gives way first, then the folder; the file and line stay. */}
      <span className="min-w-0 flex-1 basis-0 truncate type-hint">
        {hit.container === null ? null : shortContainer(hit.container)}
      </span>
      <span className={cn('flex min-w-0 pl-4 type-hint', unlisted && 'text-file-ignored')}>
        {folder === '' ? null : <StartTruncated>{`${folder}/`}</StartTruncated>}
        <span className="shrink-0">{at}</span>
      </span>
    </CommandItem>
  )
}

/** JetBrains' Search Everywhere: files, classes and symbols of the workspace, from one box. */
export function SearchEverywhere(): React.JSX.Element {
  const { open, kind, query, files, symbols, unlisted, searching, error } =
    useSearchEverywhereStore()
  const close = useSearchEverywhereStore((state) => state.close)
  const setKind = useSearchEverywhereStore((state) => state.setKind)
  const setQuery = useSearchEverywhereStore((state) => state.setQuery)
  const choose = useSearchEverywhereStore((state) => state.choose)
  const returnFocus = useSearchEverywhereStore((state) => state.returnFocus)
  const input = useRef<HTMLInputElement>(null)
  const chose = useRef(false)
  // What the arrow keys selected among the current results; new results start at their best one.
  const [selection, setSelection] = useState({ among: '', value: '' })
  const namedFolders = useNamedFolders()
  const workspaceFolders = useWorkspaceStore((state) => state.workspace?.folders.length ?? 0)
  const multiFolder = new Set(files.map((hit) => hit.folder)).size > 1

  const all = kind === 'all'
  const shownFiles = all ? files.slice(0, ALL_TAB_LIMIT) : files
  const classes = all ? symbols.filter((hit) => isClassKind(hit.kind)).slice(0, ALL_TAB_LIMIT) : []
  const others = all
    ? symbols.filter((hit) => !isClassKind(hit.kind)).slice(0, ALL_TAB_LIMIT)
    : symbols
  const first = shownFiles[0] ?? classes[0] ?? others[0]
  const firstKey =
    first === undefined ? '' : 'relative' in first ? fileKey(first) : symbolKey(first)

  const selected = selection.among === firstKey ? selection.value : firstKey
  useEffect(() => {
    if (open) {
      chose.current = false
      input.current?.select()
    }
  }, [open])

  const pick = (hit: { path: string; line: number | null; column: number | null }): void => {
    chose.current = true
    choose(hit)
  }
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const index = KINDS.findIndex((entry) => entry.kind === kind)
    const next = KINDS[(index + (event.shiftKey ? KINDS.length - 1 : 1)) % KINDS.length]
    if (next) setKind(next.kind)
  }
  const fileItem = (hit: FileHit): React.JSX.Element => (
    <FileItem
      key={fileKey(hit)}
      hit={hit}
      showFolder={multiFolder}
      onChoose={() => pick({ path: hit.path, line: null, column: null })}
    />
  )
  const symbolItem = (hit: SymbolHit): React.JSX.Element => (
    <SymbolItem
      key={symbolKey(hit)}
      hit={hit}
      folder={folderLabel(hit.path, namedFolders, workspaceFolders > 1)}
      unlisted={unlisted.has(hit.path)}
      onChoose={() => pick(hit)}
    />
  )
  const empty =
    query.trim() === ''
      ? 'Type a file path fragment, a class or a symbol name'
      : searching
        ? 'Searching…'
        : (error ??
          (kind === 'files'
            ? 'No files found'
            : 'Nothing found. Classes and symbols come from language servers, which start when a file of their language is open.'))

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        aria-label="Search Everywhere"
        className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton={false}
        // Radix would focus a trigger, which this has none of: choosing a result focuses the
        // editor, closing otherwise gives the keys back where they were.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!chose.current) returnFocus()
        }}
      >
        <DialogTitle className="sr-only">Search Everywhere</DialogTitle>
        <DialogDescription className="sr-only">
          Find a workspace file, class or symbol and open it
        </DialogDescription>
        <Command
          // Its Ctrl+N / Ctrl+J would take Go to Class's key on Linux.
          vimBindings={false}
          shouldFilter={false}
          value={selected}
          onValueChange={(value) => setSelection({ among: firstKey, value })}
          loop
        >
          <div role="tablist" aria-label="Search in" className="flex gap-1 border-b px-2 pt-1">
            {KINDS.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                role="tab"
                aria-selected={entry.kind === kind}
                tabIndex={-1}
                onClick={() => {
                  setKind(entry.kind)
                  input.current?.focus()
                }}
                className={cn(
                  'rounded-component px-2 py-1 type-body',
                  entry.kind === kind ? 'bg-hover text-foreground' : 'text-muted-foreground'
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <CommandInput
            ref={input}
            aria-label="Search Everywhere"
            placeholder="Search files, classes and symbols"
            value={query}
            onValueChange={setQuery}
            onKeyDown={onKeyDown}
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty className="px-4 py-6 text-center type-description">{empty}</CommandEmpty>
            {kind === 'all' ? (
              <>
                {shownFiles.length > 0 ? (
                  <CommandGroup heading="Files">{shownFiles.map(fileItem)}</CommandGroup>
                ) : null}
                {classes.length > 0 ? (
                  <CommandGroup heading="Classes">{classes.map(symbolItem)}</CommandGroup>
                ) : null}
                {others.length > 0 ? (
                  <CommandGroup heading="Symbols">{others.map(symbolItem)}</CommandGroup>
                ) : null}
              </>
            ) : kind === 'files' ? (
              <CommandGroup>{shownFiles.map(fileItem)}</CommandGroup>
            ) : (
              <CommandGroup>{others.map(symbolItem)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
