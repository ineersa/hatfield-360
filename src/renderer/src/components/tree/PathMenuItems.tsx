import { Copy, CopySlash, FolderOpen } from 'lucide-react'
import { ContextMenuItem, ContextMenuShortcut } from '@/components/ui/context-menu'
import { appShortcutLabel } from '@/lib/keymap-match'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { useFileTreeStore } from '@/state/file-tree-store'
import { useKeymapStore } from '@/state/keymap-store'

const REVEAL_LABEL =
  rendererPlatform === 'darwin'
    ? 'Reveal in Finder'
    : /Windows/.test(navigator.userAgent)
      ? 'Show in Explorer'
      : 'Show in File Manager'

/** Copy Path, Copy Relative Path (below a root only) and reveal in the system file manager. */
export function PathMenuItems({
  path,
  relative
}: {
  path: string
  relative: boolean
}): React.JSX.Element {
  const copyPath = useFileTreeStore((state) => state.copyPath)
  const reveal = useFileTreeStore((state) => state.reveal)
  const keymap = useKeymapStore((state) => state.shell)
  return (
    <>
      <ContextMenuItem onSelect={() => copyPath(path, 'absolute')}>
        <Copy aria-hidden />
        Copy Path
        <ContextMenuShortcut>{appShortcutLabel(keymap, 'copy-absolute-path')}</ContextMenuShortcut>
      </ContextMenuItem>
      {relative ? (
        <ContextMenuItem onSelect={() => copyPath(path, 'relative')}>
          <CopySlash aria-hidden />
          Copy Relative Path
          <ContextMenuShortcut>
            {appShortcutLabel(keymap, 'copy-relative-path')}
          </ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => reveal(path)}>
        <FolderOpen aria-hidden />
        {REVEAL_LABEL}
      </ContextMenuItem>
    </>
  )
}
