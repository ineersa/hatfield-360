// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): pane-layout/pane-tree-ops.ts,
// pane-tree-equalization.ts and pane-close-focus-successor.ts.
import type { ManagedPaneInternal, SplitDirection } from './pane-manager-types'

export function findPaneChildren(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      (child.classList.contains('pane') || child.classList.contains('pane-split'))
  )
}

function getSplitDirection(split: HTMLElement): SplitDirection {
  return split.classList.contains('is-horizontal') ? 'horizontal' : 'vertical'
}

function applyPaneFlexStyle(el: HTMLElement): void {
  el.style.flex = '1 1 0%'
  el.style.minWidth = '0'
  el.style.minHeight = '0'
  el.style.position = 'relative'
  el.style.overflow = 'hidden'
  // Flex controls the size from here on, not the initial 100% box.
  el.style.width = ''
  el.style.height = ''
}

function splitElement(isVertical: boolean): HTMLElement {
  const split = document.createElement('div')
  split.className = `pane-split ${isVertical ? 'is-vertical' : 'is-horizontal'}`
  split.style.display = 'flex'
  split.style.flexDirection = isVertical ? 'row' : 'column'
  return split
}

export function restoreSplit(
  first: HTMLElement,
  second: HTMLElement,
  isVertical: boolean,
  ratio: number,
  divider: HTMLElement
): HTMLElement {
  const split = splitElement(isVertical)
  applyPaneFlexStyle(first)
  applyPaneFlexStyle(second)
  first.style.flexGrow = String(ratio)
  second.style.flexGrow = String(1 - ratio)
  split.append(first, divider, second)
  return split
}

/** Replaces `existing` with a flex split holding [existing] [divider] [added], or the reverse. */
export function wrapInSplit(
  existing: HTMLElement,
  added: HTMLElement,
  isVertical: boolean,
  divider: HTMLElement,
  addedFirst = false
): void {
  const parent = existing.parentElement
  if (!parent) return
  const split = splitElement(isVertical)
  const previousFlex = existing.style.flex
  if (parent.classList.contains('pane-split')) {
    split.style.flex = previousFlex || '1 1 0%'
    split.style.minWidth = existing.style.minWidth || '0'
    split.style.minHeight = existing.style.minHeight || '0'
  } else {
    split.style.width = '100%'
    split.style.height = '100%'
  }
  applyPaneFlexStyle(existing)
  applyPaneFlexStyle(added)
  parent.replaceChild(split, existing)
  if (addedFirst) split.append(added, divider, existing)
  else split.append(existing, divider, added)
}

/** After a pane leaves a split, its sibling takes the split's place and size. */
export function promoteSibling(
  sibling: HTMLElement | null,
  parent: HTMLElement,
  root: HTMLElement
): void {
  if (!sibling) {
    parent.remove()
    return
  }
  const grandparent = parent.parentElement
  if (!grandparent) return
  if (grandparent === root) {
    sibling.style.flex = ''
    sibling.style.minWidth = ''
    sibling.style.minHeight = ''
    sibling.style.width = '100%'
    sibling.style.height = '100%'
    sibling.style.position = 'relative'
    sibling.style.overflow = 'hidden'
  } else if (grandparent.classList.contains('pane-split')) {
    sibling.style.flex = parent.style.flex || '1 1 0%'
    sibling.style.minWidth = parent.style.minWidth || '0'
    sibling.style.minHeight = parent.style.minHeight || '0'
    sibling.style.overflow = 'hidden'
  }
  grandparent.replaceChild(sibling, parent)
}

/** Before a pane is removed: the neighbour touching the freed edge, which inherits its space and focus. */
export function findClosedPaneSuccessor(
  closed: HTMLElement,
  panes: ReadonlyMap<number, ManagedPaneInternal>
): ManagedPaneInternal | null {
  const parent = closed.parentElement
  if (!parent?.classList.contains('pane-split')) return null
  const children = findPaneChildren(parent)
  const closedIndex = children.indexOf(closed)
  if (closedIndex === -1) return null
  const closedIsFirst = closedIndex === 0
  const axis = getSplitDirection(parent)
  let node: HTMLElement | undefined = closedIsFirst ? children[1] : children[closedIndex - 1]
  while (node?.classList.contains('pane-split')) {
    const nested = findPaneChildren(node)
    // An orthogonal split touches the closed edge with every child; reading order breaks the tie.
    node = getSplitDirection(node) === axis && !closedIsFirst ? nested.at(-1) : nested[0]
  }
  const paneId = Number(node?.dataset.paneId)
  return Number.isFinite(paneId) ? (panes.get(paneId) ?? null) : null
}

/** Pane ids in reading order (left to right, top to bottom through the split tree). */
export function paneIdsInOrder(root: HTMLElement): number[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.pane[data-pane-id]'), (el) =>
    Number(el.dataset.paneId)
  )
}
