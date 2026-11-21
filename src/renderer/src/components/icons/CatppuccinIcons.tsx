import { createElement, type ReactNode, type SVGProps } from 'react'
import { catppuccinIcon, type IconNode, rootIconName } from './catppuccin-icon-set'

const render = (nodes: IconNode[]): ReactNode[] =>
  nodes.map(([tag, props, children], index) =>
    createElement(tag, { key: index, ...props }, children && render(children))
  )

/** Icons are drawn once and the elements reused, since a tree shows the same few many times. */
const drawn = new Map<string, { viewBox: string; children: ReactNode[] }>()

function drawing(name: string): { viewBox: string; children: ReactNode[] } {
  const cached = drawn.get(name)
  if (cached) return cached
  const [viewBox, nodes] = catppuccinIcon(name) ?? catppuccinIcon('_file') ?? ['0 0 16 16', []]
  const result = { viewBox, children: render(nodes) }
  drawn.set(name, result)
  return result
}

/** A Catppuccin icon by its upstream name (`typescript`, `folder_src_open`, `_root`). */
export function CatppuccinIcon({
  name,
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'name'> & { name: string }): React.JSX.Element {
  const { viewBox, children } = drawing(name)
  return (
    <svg viewBox={viewBox} aria-hidden data-icon={name} {...props}>
      {children}
    </svg>
  )
}

/** A workspace project's root folder. */
export function CatppuccinRootFolderIcon({
  open = false,
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'name'> & { open?: boolean }): React.JSX.Element {
  return <CatppuccinIcon {...props} name={rootIconName(open)} />
}
