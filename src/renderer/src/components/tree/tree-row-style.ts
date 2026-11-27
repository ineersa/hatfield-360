import { cn } from '@/lib/class-names'

/** A tree row's look, as in JetBrains trees: the selection takes the accent while the tree has focus. */
export const treeRowClass = (selected: boolean): string =>
  cn(
    'type-tree-row flex h-tree-row shrink-0 cursor-default items-center gap-1 rounded-component pr-2.5 outline-none select-none',
    selected
      ? 'bg-selection-inactive group-focus-within/tree:bg-selection group-focus-within/tree:text-selection-foreground'
      : 'hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset'
  )

/** The left padding of a row `depth` levels down; the tree container carries `group/tree`. */
export const treeIndent = (depth: number, extra = 1): string =>
  `calc(${depth} * var(--file-tree-indent) + var(--spacing) * ${extra})`
