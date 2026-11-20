import { Check, ChevronDown, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/class-names'
import { cssFontFamily } from '@/lib/css-font-family'
import { type InstalledFont, loadInstalledFonts } from '@/lib/installed-fonts'

/** Marks the picker's popup, which is rendered outside the page, so the page's Escape can leave it alone. */
export const FONT_PICKER_ATTRIBUTE = 'data-font-picker'

type Choice =
  | { kind: 'default' }
  | { kind: 'font'; family: string }
  | { kind: 'custom'; value: string }

function choiceLabel(choice: Choice): string {
  if (choice.kind === 'default') return 'Default'
  return choice.kind === 'font' ? choice.family : `Use “${choice.value}”`
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function useInstalledFonts(open: boolean): { fonts: InstalledFont[] | null; error: string | null } {
  const [fonts, setFonts] = useState<InstalledFont[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    if (open && !fonts) {
      loadInstalledFonts()
        .then((loaded) => current && setFonts(loaded))
        .catch((loadError: unknown) => current && setError(message(loadError)))
    }
    return () => {
      current = false
    }
  }, [open, fonts])
  return { fonts, error }
}

/**
 * Chooses a font family from the fonts installed on this computer, each shown in its own face. What the
 * search box holds can be used as is, for a font stack or a font that isn't listed.
 */
export function FontPicker({
  label,
  value,
  defaultValue,
  customized,
  monospaceFirst,
  disabled,
  onChange
}: {
  label: string
  value: string
  defaultValue: string
  customized: boolean
  /** Terminal and editor fonts: list monospace fonts unless the user asks for all. */
  monospaceFirst: boolean
  disabled: boolean
  /** null picks the default. */
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [monospaceOnly, setMonospaceOnly] = useState(monospaceFirst)
  const [active, setActive] = useState(0)
  const { fonts, error } = useInstalledFonts(open)
  const listId = useId()

  const choices = useMemo((): Choice[] => {
    const query = search.trim().toLowerCase()
    const matching = (fonts ?? [])
      .filter((font) => !monospaceOnly || font.monospace)
      .filter((font) => font.family.toLowerCase().includes(query))
      .map((font): Choice => ({ kind: 'font', family: font.family }))
    const exact = (fonts ?? []).some((font) => font.family.toLowerCase() === query)
    return [
      ...(query === '' ? [{ kind: 'default' } as const] : []),
      ...(query !== '' && !exact ? [{ kind: 'custom', value: search.trim() } as const] : []),
      ...matching
    ]
  }, [fonts, search, monospaceOnly])

  const pick = (choice: Choice): void => {
    onChange(
      choice.kind === 'default' ? null : choice.kind === 'font' ? choice.family : choice.value
    )
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
          aria-label={label}
          aria-haspopup="listbox"
          disabled={disabled}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate" style={{ fontFamily: cssFontFamily(value) }}>
            {customized ? value : `Default (${value})`}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        {...{ [FONT_PICKER_ATTRIBUTE]: '' }}
        align="start"
        className="flex w-(--radix-popover-trigger-width) min-w-72 flex-col gap-1.5"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((index) => Math.min(choices.length - 1, Math.max(0, index + step)))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const choice = choices[active]
            if (choice) pick(choice)
          }
        }}
      >
        <input
          aria-label="Search fonts"
          aria-controls={listId}
          role="combobox"
          aria-expanded
          placeholder="Search fonts, or type a font stack"
          value={search}
          spellCheck={false}
          onChange={(event) => {
            setSearch(event.target.value)
            setActive(0)
          }}
          className="h-9 rounded-md border border-border bg-background px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label className="flex items-center gap-2 px-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={monospaceOnly}
            onChange={(event) => {
              setMonospaceOnly(event.target.checked)
              setActive(0)
            }}
            className="accent-primary"
          />
          Monospace only
        </label>
        <ul
          id={listId}
          role="listbox"
          aria-label="Fonts"
          className="flex max-h-72 flex-col overflow-y-auto"
        >
          {choices.map((choice, index) => {
            const family =
              choice.kind === 'default'
                ? defaultValue
                : choice.kind === 'font'
                  ? choice.family
                  : choice.value
            const selected =
              choice.kind === 'default' ? !customized : customized && family === value
            return (
              <li
                key={`${choice.kind}:${family}`}
                role="option"
                aria-selected={selected}
                data-active={index === active}
                // Keeps the row picked with the arrow keys in view.
                ref={
                  index === active ? (row) => row?.scrollIntoView({ block: 'nearest' }) : undefined
                }
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(choice)}
                className={cn(
                  'flex h-8 shrink-0 cursor-default items-center gap-2 rounded-md px-2',
                  index === active && 'bg-accent'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{choiceLabel(choice)}</span>
                {/* A sample in the font itself; the name stays readable for symbol fonts. */}
                <span
                  aria-hidden
                  className="shrink-0 text-muted-foreground"
                  style={{ fontFamily: cssFontFamily(family) }}
                >
                  Abc 123
                </span>
                <Check
                  className={cn('size-4 shrink-0 text-primary', !selected && 'invisible')}
                  aria-hidden
                />
              </li>
            )
          })}
        </ul>
        {fonts ? null : (
          <p className="flex items-center gap-2 px-2 pb-1 text-muted-foreground">
            {error ?? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Loading installed fonts…
              </>
            )}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
