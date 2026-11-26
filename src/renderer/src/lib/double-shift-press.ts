/** The longest pause between the two Shift presses, as in JetBrains. */
const DOUBLE_PRESS_MS = 400

type KeyEvent = { key: string; repeat: boolean; timeStamp: number }

/** Spots Shift pressed twice on its own: a lone press, released, then another soon after. */
export class DoubleShiftPress {
  private releasedAt: number | null = null
  private alone = false

  /** True on the press that completes a double Shift. */
  keyDown(event: KeyEvent): boolean {
    if (event.key !== 'Shift') {
      this.reset()
      return false
    }
    if (event.repeat) return false
    const double = this.releasedAt !== null && event.timeStamp - this.releasedAt <= DOUBLE_PRESS_MS
    this.releasedAt = null
    this.alone = !double
    return double
  }

  keyUp(event: KeyEvent): void {
    if (event.key !== 'Shift') return
    this.releasedAt = this.alone ? event.timeStamp : null
    this.alone = false
  }

  /** A click or another key in between means it wasn't a double Shift. */
  reset(): void {
    this.releasedAt = null
    this.alone = false
  }
}
