import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { NumberRange } from '../../../../shared/settings-api'

/** Typing pauses this long before a value applies, so "16" doesn't pass through 1. */
const TYPING_DELAY_MS = 350

// Rounds away float noise from stepping by 0.1 (1.2 + 0.1 is 1.3000000000000003).
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6

const STEP_BUTTON_CLASS =
  'flex size-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50'

/** A number (font size, line height) that applies while the user types or steps it; Escape puts the saved one back. */
export function NumberStepper({
  label,
  value,
  range,
  disabled,
  onChange
}: {
  label: string
  value: number
  range: NumberRange
  disabled: boolean
  onChange: (value: number) => void
}): React.JSX.Element {
  const clamp = (next: number): number => tidy(Math.min(range.max, Math.max(range.min, next)))
  // A fractional step shows whole values as 1.0, so the field reads as a multiplier.
  const shown = (next: number): string =>
    range.step < 1 && Number.isInteger(next) ? next.toFixed(1) : String(next)
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
    const next = Number(text)
    if (text.trim() !== '' && Number.isFinite(next) && clamp(next) !== value) onChange(clamp(next))
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
        disabled={disabled || value <= range.min}
        onClick={() => step(-range.step)}
        className={STEP_BUTTON_CLASS}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? shown(value)}
        onFocus={() => setDraft(shown(value))}
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
            const by = event.key === 'ArrowUp' ? range.step : -range.step
            step(by)
            setDraft(shown(clamp(value + by)))
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
        disabled={disabled || value >= range.max}
        onClick={() => step(range.step)}
        className={STEP_BUTTON_CLASS}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}
