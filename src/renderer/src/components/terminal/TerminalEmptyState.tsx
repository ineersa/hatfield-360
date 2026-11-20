import { SquareTerminal } from 'lucide-react'
import { terminalShortcutLabel } from '@/lib/terminal-shortcut-label'
import { runTerminalCommand } from './use-terminal-commands'

/** The Agents view before any terminal is open: one click (or the shortcut) opens one. */
export function TerminalEmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <SquareTerminal className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <button
        type="button"
        onClick={() => runTerminalCommand('new-terminal')}
        className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <SquareTerminal className="size-4" aria-hidden />
        New Terminal
      </button>
      <div className="flex flex-col gap-1 text-muted-foreground">
        <p>
          Shortcut{' '}
          <kbd className="font-sans text-foreground">{terminalShortcutLabel('new-terminal')}</kbd>
        </p>
        <p>Or right-click a project → Open Terminal Here</p>
      </div>
    </div>
  )
}
