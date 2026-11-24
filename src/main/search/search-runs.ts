/**
 * Each window's search: a new one replaces the running one, and cancelling also stops one that
 * is still checking its folders, so it never starts ripgrep after the panel has closed.
 */
export class SearchRuns<Owner> {
  private readonly running = new Map<Owner, () => void>()
  /** The search each owner wants now; null once cancelled. */
  private readonly latest = new Map<Owner, number | null>()

  /**
   * Starts search `id` once `paths` is known, unless a newer search or a cancel came first.
   * `launch` starts it and returns its stop; it calls `finished` when it ends on its own.
   * Resolves whether it started.
   */
  async start(
    owner: Owner,
    id: number,
    paths: Promise<string[]>,
    launch: (paths: string[], finished: () => void) => () => void
  ): Promise<boolean> {
    this.stop(owner)
    this.latest.set(owner, id)
    const found = await paths
    if (this.latest.get(owner) !== id) return false
    const stop = launch(found, () => {
      if (this.running.get(owner) === stop) this.running.delete(owner)
    })
    this.running.set(owner, stop)
    return true
  }

  cancel(owner: Owner): void {
    this.stop(owner)
    if (this.latest.has(owner)) this.latest.set(owner, null)
  }

  /** Whether the owner has searched before, so its cleanup is already arranged. */
  knows(owner: Owner): boolean {
    return this.latest.has(owner)
  }

  forget(owner: Owner): void {
    this.stop(owner)
    this.latest.delete(owner)
  }

  private stop(owner: Owner): void {
    this.running.get(owner)?.()
    this.running.delete(owner)
  }
}
