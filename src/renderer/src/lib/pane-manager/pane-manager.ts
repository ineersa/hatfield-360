import type { PaneLayout } from '../../../../shared/terminal-workspace-api'
// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): pane-manager.ts, pane-manager-pane-creation.ts
// and pane-layout/pane-split-close.ts.
import type { ITerminalOptions } from '@xterm/xterm'
import { createDivider, disposeDividersIn, removeDividers } from './pane-divider'
import {
  attachWebgl,
  createPaneDom,
  disposePane,
  disposeWebgl,
  openTerminal,
  safeFit
} from './managed-pane'
import type {
  DropZone,
  ManagedPane,
  ManagedPaneInternal,
  PaneManagerOptions,
  SplitDirection
} from './pane-manager-types'
import {
  findClosedPaneSuccessor,
  findPaneChildren,
  paneIdsInOrder,
  promoteSibling,
  restoreSplit,
  wrapInSplit
} from './pane-tree'
import { isPaneDropNoOp, startPaneRearrange, type PaneRearrange } from './pane-rearrange'

const toPublic = ({ id, terminal, container }: ManagedPaneInternal): ManagedPane => ({
  id,
  terminal,
  container
})

/**
 * Terminal panes in a split tree, as plain DOM: `.pane` leaves inside `.pane-split` flex rows
 * (split right) or columns (split down), separated by draggable `.pane-divider`s.
 */
export class PaneManager {
  private readonly panes = new Map<number, ManagedPaneInternal>()
  private activePaneId: number | null = null
  private nextPaneId = 1
  private destroyed = false
  private rearrange: PaneRearrange | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly options: PaneManagerOptions,
    private readonly onLayoutChange: () => void
  ) {
    root.classList.add('pane-manager-root')
  }

  createInitialPane(): ManagedPane {
    const pane = this.createPane()
    pane.container.style.width = '100%'
    pane.container.style.height = '100%'
    pane.container.style.position = 'relative'
    pane.container.style.overflow = 'hidden'
    this.root.appendChild(pane.container)
    openTerminal(pane)
    this.activate(pane, true)
    this.options.onPaneCreated(toPublic(pane))
    return toPublic(pane)
  }

  restore(
    layout: PaneLayout,
    active: string | null,
    create: (pane: ManagedPane, leaf: Extract<PaneLayout, { kind: 'pane' }>) => void
  ): void {
    const leaves: [ManagedPaneInternal, Extract<PaneLayout, { kind: 'pane' }>][] = []
    const build = (node: PaneLayout): HTMLElement => {
      if (node.kind === 'pane') {
        const pane = this.createPane()
        leaves.push([pane, node])
        return pane.container
      }
      const vertical = node.direction === 'vertical'
      return restoreSplit(
        build(node.first),
        build(node.second),
        vertical,
        node.ratio,
        this.divider(vertical)
      )
    }
    const root = build(layout)
    root.style.width = '100%'
    root.style.height = '100%'
    this.root.appendChild(root)
    for (const [pane, leaf] of leaves) {
      openTerminal(pane)
      create(toPublic(pane), leaf)
    }
    const selected = leaves.find(([, leaf]) => leaf.id === active) ?? leaves[0]
    if (selected) this.activate(selected[0], false)
  }

  layout(leaf: (pane: HTMLElement) => PaneLayout): PaneLayout | null {
    const read = (element: HTMLElement): PaneLayout | null => {
      if (element.classList.contains('pane')) return leaf(element)
      const [a, b] = findPaneChildren(element)
      if (!a || !b) return null
      const first = read(a)
      const second = read(b)
      if (!first || !second) return null
      const left = Number(a.style.flexGrow) || 1
      const right = Number(b.style.flexGrow) || 1
      return {
        kind: 'split',
        direction: element.classList.contains('is-vertical') ? 'vertical' : 'horizontal',
        ratio: left / (left + right),
        first,
        second
      }
    }
    const item = findPaneChildren(this.root)[0]
    return item ? read(item) : null
  }

  private divider(vertical: boolean): HTMLElement {
    return createDivider(vertical, {
      refitPanesUnder: (el) => this.refitPanesUnder(el),
      onResize: this.onLayoutChange
    })
  }

  /** `vertical` puts the new pane on the right, `horizontal` below. */
  splitPane(paneId: number, direction: SplitDirection): ManagedPane | null {
    const existing = this.panes.get(paneId)
    if (!existing?.container.parentElement) return null
    this.stopRearrange()
    const pane = this.createPane()
    const isVertical = direction === 'vertical'
    const divider = this.divider(isVertical)
    // Reparenting can silently invalidate a WebGL canvas; it is rebuilt once the layout settles.
    const hadWebgl = !!existing.webglAddon
    disposeWebgl(existing)
    wrapInSplit(existing.container, pane.container, isVertical, divider)
    openTerminal(pane)
    if (hadWebgl) {
      requestAnimationFrame(() => {
        if (this.destroyed || !this.panes.has(existing.id)) return
        attachWebgl(existing)
        safeFit(existing)
      })
    }
    this.activate(pane, true)
    this.options.onPaneCreated(toPublic(pane))
    return toPublic(pane)
  }

  closePane(paneId: number): void {
    const pane = this.panes.get(paneId)
    if (!pane) return
    this.stopRearrange()
    const successor =
      this.activePaneId === paneId ? findClosedPaneSuccessor(pane.container, this.panes) : null
    disposePane(pane)
    this.panes.delete(paneId)
    this.detachFromTree(pane.container)
    if (this.activePaneId === paneId) {
      this.activePaneId = null
      const next = successor ?? this.panes.values().next().value
      if (next) this.activate(next, true)
    }
    this.updateMultiPaneState()
    this.options.onPaneClosed(paneId)
  }

  /** Docks a pane to an edge of another one; its shell keeps running. */
  movePane(sourceId: number, targetId: number, zone: DropZone): void {
    const source = this.panes.get(sourceId)
    const target = this.panes.get(targetId)
    if (!source || !target || isPaneDropNoOp(source.container, target.container, zone)) return
    // Reparenting can silently invalidate a WebGL canvas; it is rebuilt once the layout settles.
    const hadWebgl = [source, target].filter((pane) => pane.webglAddon)
    for (const pane of hadWebgl) disposeWebgl(pane)
    this.detachFromTree(source.container)
    const isVertical = zone === 'left' || zone === 'right'
    wrapInSplit(
      target.container,
      source.container,
      isVertical,
      this.divider(isVertical),
      zone === 'left' || zone === 'top'
    )
    requestAnimationFrame(() => {
      if (this.destroyed) return
      for (const pane of hadWebgl) if (this.panes.has(pane.id)) attachWebgl(pane)
      for (const pane of this.panes.values()) safeFit(pane)
    })
    this.activate(source, true)
    this.onLayoutChange()
  }

  /** Lays a drag handle over every pane until one is dropped onto another, or Esc. */
  startRearrange(): void {
    if (this.rearrange || this.panes.size < 2) return
    this.rearrange = startPaneRearrange({
      root: this.root,
      paneElements: () => Array.from(this.panes.values(), (pane) => pane.container),
      onDrop: (sourceId, target) => this.movePane(sourceId, target.paneId, target.zone),
      onEnd: () => {
        this.rearrange = null
      }
    })
  }

  stopRearrange(): void {
    this.rearrange?.stop()
  }

  getPanes(): ManagedPane[] {
    return paneIdsInOrder(this.root).flatMap((id) => {
      const pane = this.panes.get(id)
      return pane ? [toPublic(pane)] : []
    })
  }

  getActivePane(): ManagedPane | null {
    const pane = this.activePaneId === null ? null : this.panes.get(this.activePaneId)
    return pane ? toPublic(pane) : null
  }

  setActivePane(paneId: number, focus = true): void {
    const pane = this.panes.get(paneId)
    if (pane) this.activate(pane, focus)
  }

  /** Moves focus to the next (1) or previous (-1) pane in reading order, wrapping around. */
  focusSibling(step: 1 | -1): void {
    const ids = paneIdsInOrder(this.root)
    if (ids.length < 2 || this.activePaneId === null) return
    const index = ids.indexOf(this.activePaneId)
    const nextId = ids[(index + step + ids.length) % ids.length]
    if (nextId !== undefined) this.setActivePane(nextId)
  }

  setTerminalOptions(options: ITerminalOptions): void {
    for (const pane of this.panes.values()) {
      pane.terminal.options = options
      safeFit(pane)
    }
  }

  setGpuAcceleration(enabled: boolean): void {
    for (const pane of this.panes.values()) {
      pane.gpuAcceleration = enabled
      if (enabled) attachWebgl(pane)
      else disposeWebgl(pane)
      // Each renderer measures cells its own way.
      safeFit(pane)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.stopRearrange()
    for (const pane of this.panes.values()) disposePane(pane)
    this.panes.clear()
    disposeDividersIn(this.root)
    this.root.replaceChildren()
    this.activePaneId = null
  }

  private createPane(): ManagedPaneInternal {
    const pane = createPaneDom(
      this.nextPaneId++,
      this.options,
      (id) => this.setActivePane(id, false),
      (id) => (this.options.requestClosePane ?? ((paneId) => this.closePane(paneId)))(id)
    )
    this.panes.set(pane.id, pane)
    this.updateMultiPaneState()
    return pane
  }

  /** Takes a pane's element out of the tree, without disposing it; its sibling takes the split's place. */
  private detachFromTree(container: HTMLElement): void {
    const parent = container.parentElement
    if (parent?.classList.contains('pane-split')) {
      const sibling = findPaneChildren(parent).find((child) => child !== container) ?? null
      container.remove()
      removeDividers(parent)
      promoteSibling(sibling, parent, this.root)
    } else {
      container.remove()
    }
  }

  private activate(pane: ManagedPaneInternal, focus: boolean): void {
    const changed = this.activePaneId !== pane.id
    this.activePaneId = pane.id
    for (const other of this.panes.values()) {
      other.container.classList.toggle('is-active', other.id === pane.id)
    }
    if (focus) pane.terminal.focus()
    if (changed) this.options.onActivePaneChange?.(toPublic(pane))
  }

  private updateMultiPaneState(): void {
    this.root.classList.toggle('has-multiple-panes', this.panes.size > 1)
  }

  private refitPanesUnder(el: HTMLElement): void {
    const leaves = el.classList.contains('pane')
      ? [el]
      : Array.from(el.querySelectorAll<HTMLElement>('.pane[data-pane-id]'))
    for (const leaf of leaves) {
      const pane = this.panes.get(Number(leaf.dataset.paneId))
      if (pane) safeFit(pane)
    }
  }
}
