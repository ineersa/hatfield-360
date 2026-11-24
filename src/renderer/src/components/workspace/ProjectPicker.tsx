import { Check, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/class-names'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'

export function ProjectPicker({
  folders,
  value,
  onChange
}: {
  folders: WorkspaceFolder[]
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const query = search.trim().toLowerCase()
  const choices = [{ name: 'All projects', path: '' }, ...folders].filter(
    ({ name, path }) => name.toLowerCase().includes(query) || path.toLowerCase().includes(query)
  )
  const index = Math.min(active, choices.length - 1)
  const pick = (path: string): void => {
    onChange(path)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch('')
        setActive(0)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter by project"
          className="type-body flex h-control w-full min-w-0 items-center gap-2 rounded-component border border-input-border bg-input px-2.5 text-left text-input-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 truncate">
            {folders.find(({ path }) => path === value)?.name ?? 'All projects'}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-(--radix-popover-trigger-width) flex-col gap-1.5"
      >
        <input
          role="combobox"
          aria-label="Search projects"
          aria-controls={listId}
          aria-expanded
          aria-activedescendant={index < 0 ? undefined : `${listId}-${index}`}
          placeholder="Search projects"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(
                Math.max(
                  0,
                  Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
                )
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const choice = choices[index]
              if (choice) pick(choice.path)
            }
          }}
          className="h-control rounded-component border border-input-border bg-input px-2.5 text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Projects"
          className="flex max-h-72 flex-col overflow-y-auto"
        >
          {choices.map(({ name, path }, row) => (
            <li
              key={path}
              id={`${listId}-${row}`}
              role="option"
              aria-selected={path === value}
              title={path || undefined}
              ref={row === index ? (item) => item?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseEnter={() => setActive(row)}
              onClick={() => pick(path)}
              className={cn(
                'flex h-list-row shrink-0 cursor-default items-center gap-2 rounded-component px-2',
                row === index && 'bg-popover-selection text-popover-selection-foreground'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <Check className={cn('size-4 shrink-0', path !== value && 'invisible')} aria-hidden />
            </li>
          ))}
        </ul>
        {choices.length === 0 ? (
          <p className="type-hint px-2" role="status">
            No projects match.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
