import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useAfterMenu } from '@/components/tree/use-after-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { mainErrorMessage } from '@/lib/main-error-message'
import { rendererPlatform, shortcutLabel } from '@/lib/shortcut-keys'
import { notify } from '@/state/notification-store'
import {
  isCopyable,
  isWritable,
  selectAllText,
  type TextMenuTarget,
  textMenuTarget
} from './text-menu-target'

const MOD = rendererPlatform === 'darwin' ? 'Command+' : 'Ctrl+'
const keyLabel = (key: string): string => shortcutLabel(MOD + key, rendererPlatform)

const failed = (error: unknown): void => {
  notify({ severity: 'error', title: "Couldn't use the clipboard", body: mainErrorMessage(error) })
}

/** Puts text on the clipboard, which is main's: the sandboxed page has no clipboard permission. */
export function copyText(text: string): void {
  window.desktop.writeTerminalClipboard(text).catch(failed)
}

/** Types `text` into the field over its selection, as typing would: undoable, and React sees it. */
function typeIntoField(field: HTMLElement, text: string): void {
  field.focus()
  // The one way to edit a field that keeps its undo history and fires its input events.
  document.execCommand('insertText', false, text)
}

/** Cut, Copy, Paste and Select All for what a right-click landed on. */
function TextMenuItems({
  target,
  choose
}: {
  target: TextMenuTarget
  choose: (action: () => void) => void
}): React.JSX.Element {
  const { field, selection } = target
  const copyable = isCopyable(target)
  const writable = isWritable(field) ? field : null
  return (
    <>
      {writable ? (
        <ContextMenuItem
          disabled={!copyable}
          onSelect={() =>
            choose(() => {
              copyText(selection)
              typeIntoField(writable, '')
            })
          }
        >
          <Scissors aria-hidden />
          Cut
          <ContextMenuShortcut>{keyLabel('X')}</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem disabled={!copyable} onSelect={() => copyText(selection)}>
        <Copy aria-hidden />
        Copy
        <ContextMenuShortcut>{keyLabel('C')}</ContextMenuShortcut>
      </ContextMenuItem>
      {writable ? (
        <ContextMenuItem
          onSelect={() =>
            choose(() => {
              window.desktop
                .readTerminalClipboard()
                .then((text) => typeIntoField(writable, text))
                .catch(failed)
            })
          }
        >
          <ClipboardPaste aria-hidden />
          Paste
          <ContextMenuShortcut>{keyLabel('V')}</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => choose(() => selectAllText(target))}>
        <TextSelect aria-hidden />
        Select All
        <ContextMenuShortcut>{keyLabel('A')}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}

/**
 * A right-click menu with Cut, Copy, Paste and Select All for the text under the pointer, after a
 * place's own `items`. Wraps one element; a menu of an element inside it takes precedence.
 */
export function TextContextMenu({
  children,
  items
}: {
  children: ReactNode
  /** The place's own items for the element the click landed on, or null for none. */
  items?: (element: Element, choose: (action: () => void) => void) => ReactNode
}): React.JSX.Element {
  const [opened, setOpened] = useState<{ target: TextMenuTarget; element: Element } | null>(null)
  const afterMenu = useAfterMenu()
  const own = opened && items ? items(opened.element, afterMenu.choose) : null
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          // An inner menu took it.
          if (event.defaultPrevented || !(event.target instanceof Element)) return
          setOpened({
            target: textMenuTarget(event.target, event.currentTarget),
            element: event.target
          })
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={afterMenu.onCloseAutoFocus}>
        {own ? (
          <>
            {own}
            <ContextMenuSeparator />
          </>
        ) : null}
        {opened ? <TextMenuItems target={opened.target} choose={afterMenu.choose} /> : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
