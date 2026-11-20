import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FONT_SIZE_RANGE } from '../../../../shared/settings-api'

/** Typing pauses this long before a size applies, so "16" doesn't pass through 1. */
const TYPING_DELAY_MS = 350

const clamp = (size: number): number =>
  Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, size))

const STEP_BUTTON_CLASS =
  'flex size-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50'

/** A font size that applies while the user types or steps it; Escape puts the saved size back. */
export function FontSizeInput({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (size: number) => void
}): React.JSX.Element {
  // While the field has focus it shows what the user typed; otherwise the saved size.
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Escape blurs the field; the blur handler still sees the old draft, so it must be told to drop it.
  const discard = useRef(false)

  const cancelPending = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const apply = (text: string): void => {
    cancelPending()
    const size = Number(text)
    if (text.trim() !== '' && Number.isFinite(size) && clamp(size) !== value) onChange(clamp(size))
  }

  const step = (by: number): void => {
    cancelPending()
    setDraft(null)
    onChange(clamp(value + by))
  }

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= FONT_SIZE_RANGE.min}
        onClick={() => step(-1)}
        className={STEP_BUTTON_CLASS}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          cancelPending()
          timer.current = setTimeout(() => apply(text), TYPING_DELAY_MS)
        }}
        onBlur={() => {
          if (draft !== null && !discard.current) apply(draft)
          discard.current = false
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            step(event.key === 'ArrowUp' ? 1 : -1)
            setDraft(String(clamp(value + (event.key === 'ArrowUp' ? 1 : -1))))
          }
          if (event.key === 'Escape') {
            // Escape here only undoes the typing; it doesn't close the page.
            event.stopPropagation()
            cancelPending()
            discard.current = true
            event.currentTarget.blur()
          }
        }}
        className="h-control w-14 rounded-component border border-input-border bg-input px-2 text-center text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || value >= FONT_SIZE_RANGE.max}
        onClick={() => step(1)}
        className={STEP_BUTTON_CLASS}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}
