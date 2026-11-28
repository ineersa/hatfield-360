const CHOICE_ROW =
  'type-body flex h-tree-row shrink-0 cursor-pointer items-center gap-2 rounded-component px-2 hover:bg-row-hover has-checked:bg-selection has-focus-visible:ring-2 has-focus-visible:ring-ring'

export type Choice = { id: string; label: string; hint: string }

/** One of several things to act on, as radio rows: the label, and a hint on the right. */
export function ChoiceList({
  labelledBy,
  name,
  choices,
  chosen,
  onChoose
}: {
  labelledBy: string
  /** The radios' group name. */
  name: string
  choices: readonly Choice[]
  chosen: string | null
  onChoose: (id: string) => void
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex max-h-64 flex-col overflow-y-auto"
    >
      {choices.map((choice) => (
        <label key={choice.id} className={CHOICE_ROW}>
          <input
            type="radio"
            name={name}
            value={choice.id}
            checked={choice.id === chosen}
            onChange={() => onChoose(choice.id)}
            className="sr-only"
          />
          <span className="min-w-0 truncate">{choice.label}</span>
          {choice.hint === '' ? null : (
            <span className="type-hint ml-auto shrink-0 pl-2">{choice.hint}</span>
          )}
        </label>
      ))}
    </div>
  )
}
