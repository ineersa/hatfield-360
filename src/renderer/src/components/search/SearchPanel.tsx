import { CaseSensitive, PackageOpen, Regex, WholeWord, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { separatorOf } from '@/components/editor/editor-tab-labels'
import { treeRoots } from '@/components/files/file-tree-rows'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import { HidePanelButton } from '@/components/shell/HidePanelButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { appShortcutLabel } from '@/lib/keymap-match'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { useKeymapStore } from '@/state/keymap-store'
import { useSearchStore } from '@/state/search-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import {
  SEARCH_MATCH_LIMIT,
  type SearchFileResult,
  type SearchMatch
} from '../../../../shared/search-api'

/** A folder results are shown under: a workspace folder or a worktree, by its name. */
type NamedFolder = { path: string; name: string }

/** Where a result's file is, from the workspace folder it is in: `app/src/deep`. */
function folderLabel(path: string, folders: NamedFolder[]): string {
  const separator = separatorOf(path)
  const folder = path.slice(0, path.lastIndexOf(separator))
  const root = folders
    .filter((each) => folder === each.path || folder.startsWith(each.path + separator))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
  if (!root) return folder
  return [root.name, folder.slice(root.path.length + 1)].filter(Boolean).join('/')
}

const fileName = (path: string): string => path.slice(path.lastIndexOf(separatorOf(path)) + 1)

/** A match's line without its indent, the match highlighted. */
function MatchText({ match }: { match: SearchMatch }): React.JSX.Element {
  const { text, textStart } = match
  const start = match.start - textStart
  const end = match.end - textStart
  const indent = Math.min(text.length - text.trimStart().length, start)
  return (
    <span className="min-w-0 flex-1 truncate whitespace-pre">
      {textStart > 0 ? '…' : ''}
      {text.slice(indent, start)}
      <mark className="rounded-component bg-search-match text-foreground">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </span>
  )
}

function OptionButton({
  label,
  pressed,
  onClick,
  children
}: {
  label: string
  pressed: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            'flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            pressed && 'bg-selection-inactive text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const optionId = (index: number): string => `search-result-${index}`

/** Find in Files: a text or regex search over the workspace folders, results grouped by file. */
export function SearchPanel(): React.JSX.Element {
  const query = useSearchStore((state) => state.query)
  const status = useSearchStore((state) => state.status)
  const files = useSearchStore((state) => state.files)
  const limited = useSearchStore((state) => state.limited)
  const error = useSearchStore((state) => state.error)
  const focusRequest = useSearchStore((state) => state.focusRequest)
  const setQuery = useSearchStore((state) => state.setQuery)
  const cancel = useSearchStore((state) => state.cancel)
  const resume = useSearchStore((state) => state.resume)
  const openFile = useEditorTabStore((state) => state.open)
  const folders = useWorkspaceStore((state) => state.workspace?.folders)
  const projects = useWorktreeStore((state) => state.projects)
  const shortcut = appShortcutLabel(
    useKeymapStore((state) => state.shell),
    'find-in-files'
  )
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const generation = useSearchStore((state) => state.generation)
  const [chosen, setChosen] = useState({ generation: 0, index: 0 })
  // Each search starts at its first result.
  const active = chosen.generation === generation ? chosen.index : 0
  const setActive = (index: number): void => setChosen({ generation, index })

  const namedFolders = useMemo(
    (): NamedFolder[] =>
      treeRoots(folders ?? [], projects).flatMap((root) => [
        { path: root.path, name: root.name },
        ...root.worktrees.map((tree) => ({ path: tree.path, name: tree.name }))
      ]),
    [folders, projects]
  )
  /** Every match in list order, with the file it is in. */
  const matches = useMemo(
    () => files.flatMap((file) => file.matches.map((match) => ({ file, match }))),
    [files]
  )
  /** Where each file's first match is in `matches`. */
  const firstIndex = useMemo(() => {
    const starts: number[] = []
    let total = 0
    for (const file of files) {
      starts.push(total)
      total += file.matches.length
    }
    return starts
  }, [files])
  const count = matches.length

  useEffect(() => {
    if (focusRequest === 0) return
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])
  // A search still running when the panel closes stops, and runs again when it opens.
  useEffect(() => {
    resume()
    return cancel
  }, [cancel, resume])
  useEffect(() => {
    list.current?.querySelector(`#${optionId(active)}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (index: number, focus: boolean): void => {
    const target = matches[index]
    if (!target) return
    setActive(index)
    const { line, start, end } = target.match
    openFile(target.file.path, { line, start, end, focus })
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'PageDown'
            ? 10
            : event.key === 'PageUp'
              ? -10
              : 0
    if (step !== 0) {
      event.preventDefault()
      if (event.key === 'ArrowUp' && active === 0) {
        input.current?.focus()
        return
      }
      setActive(Math.min(Math.max(active + step, 0), count - 1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : count - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      open(active, true)
    }
  }

  const summary =
    status === 'idle'
      ? null
      : status === 'searching' && count === 0
        ? 'Searching…'
        : count === 0
          ? 'No matches'
          : `${limited ? `${SEARCH_MATCH_LIMIT}+` : count} ${count === 1 ? 'match' : 'matches'} in ${files.length} ${files.length === 1 ? 'file' : 'files'}${status === 'searching' ? '…' : ''}${limited ? `: only the first ${SEARCH_MATCH_LIMIT} are shown` : ''}`

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title flex-1 truncate">Find in Files</h2>
        <HidePanelButton view="search" />
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <div className="flex h-control items-center gap-0.5 rounded-component border border-input-border bg-input pr-1 focus-within:ring-2 focus-within:ring-ring">
          <input
            ref={input}
            aria-label="Search text"
            placeholder={shortcut ? `Search (${shortcut})` : 'Search'}
            spellCheck={false}
            value={query.text}
            onChange={(event) => setQuery({ text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && count > 0) {
                event.preventDefault()
                list.current?.focus()
              } else if (event.key === 'Enter') {
                event.preventDefault()
                open(active, true)
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-input-foreground outline-none"
          />
          <OptionButton
            label="Match Case"
            pressed={query.matchCase}
            onClick={() => setQuery({ matchCase: !query.matchCase })}
          >
            <CaseSensitive className="size-4" aria-hidden />
          </OptionButton>
          <OptionButton
            label="Words"
            pressed={query.wholeWord}
            onClick={() => setQuery({ wholeWord: !query.wholeWord })}
          >
            <WholeWord className="size-4" aria-hidden />
          </OptionButton>
          <OptionButton
            label="Regex"
            pressed={query.regex}
            onClick={() => setQuery({ regex: !query.regex })}
          >
            <Regex className="size-4" aria-hidden />
          </OptionButton>
        </div>
        <div className="flex items-center gap-1">
          <input
            aria-label="File mask"
            placeholder="File mask: *.ts, !*.test.ts"
            spellCheck={false}
            value={query.fileMask}
            onChange={(event) => setQuery({ fileMask: event.target.value })}
            className="h-control min-w-0 flex-1 rounded-component border border-input-border bg-input px-2 text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <OptionButton
            label="Include Non-Project Items"
            pressed={query.includeNonProject}
            onClick={() => setQuery({ includeNonProject: !query.includeNonProject })}
          >
            <PackageOpen className="size-4" aria-hidden />
          </OptionButton>
        </div>
        {query.scope.length > 0 ? (
          <div className="type-hint flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">
              In {query.scope.map((path) => fileName(path)).join(', ')}
            </span>
            <OptionButton
              label="Search the Whole Workspace"
              pressed={false}
              onClick={() => setQuery({ scope: [] })}
            >
              <X className="size-3.5" aria-hidden />
            </OptionButton>
          </div>
        ) : null}
        {summary ? (
          <p role="status" className="type-hint truncate">
            {summary}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="type-hint text-error">
            {error}
          </p>
        ) : null}
      </div>
      {count > 0 ? (
        <div
          ref={list}
          role="listbox"
          aria-label="Results"
          tabIndex={0}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKeyDown}
          className="group/results flex min-h-0 flex-col overflow-y-auto px-2 pb-2 outline-none"
        >
          {files.map((file: SearchFileResult, fileIndex) => (
            <div key={file.path} role="group" aria-label={fileName(file.path)}>
              <div className="type-tree-row flex h-tree-row items-center gap-1.5 px-1.5">
                <FileTreeIcon kind="file" name={fileName(file.path)} className="size-4 shrink-0" />
                <span className="shrink-0">{fileName(file.path)}</span>
                <span className="type-hint min-w-0 flex-1 truncate">
                  {folderLabel(file.path, namedFolders)}
                </span>
                <span className="type-hint shrink-0">{file.matches.length}</span>
              </div>
              {file.matches.map((match, matchIndex) => {
                const at = (firstIndex[fileIndex] ?? 0) + matchIndex
                const selected = at === active
                return (
                  <div
                    key={`${match.line}:${match.start}`}
                    id={optionId(at)}
                    role="option"
                    aria-selected={selected}
                    aria-label={`${fileName(file.path)} line ${match.line}: ${match.text.trim()}`}
                    onClick={() => open(at, false)}
                    onDoubleClick={() => open(at, true)}
                    className={cn(
                      'type-tree-row flex h-tree-row cursor-default items-center gap-2 rounded-component pr-1.5 pl-7 select-none',
                      selected
                        ? 'bg-selection-inactive group-focus-within/results:bg-selection group-focus-within/results:text-selection-foreground'
                        : 'hover:bg-row-hover'
                    )}
                  >
                    <MatchText match={match} />
                    <span className="type-hint shrink-0">{match.line}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
