import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  EyeOff,
  FileCode,
  FilePlus,
  GitCommitHorizontal,
  GitCompareArrows,
  History,
  RefreshCw,
  Trash2,
  Undo2
} from 'lucide-react'
import type { ReactNode } from 'react'
import { DELETE_LABEL } from '@/components/files/delete-key'
import { OpenTerminalMenuContent } from '@/components/terminal/OpenTerminalMenuContent'
import { PathMenuItems } from '@/components/tree/PathMenuItems'
import { useAfterMenu } from '@/components/tree/use-after-menu'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut
} from '@/components/ui/context-menu'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { useHunkTabStore } from '@/state/hunk-tab-store'
import { type FileTargets, useSourceControlStore } from '@/state/source-control-store'
import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'
import { fileKey, type GitGroup, isUntracked } from './change-tree-rows'

const ENTER_LABEL = rendererPlatform === 'darwin' ? '↩' : 'Enter'

/** What the row menus ask the panel to confirm first. */
export type RowMenuRequests = {
  onRollback: (targets: FileTargets) => void
  onTrash: (group: GitGroup, files: ChangedFile[]) => void
  /** Opens the file in the editor, as Enter and a double click do. */
  onOpen: (file: ChangedFile) => void
  /** Puts focus in the commit message box. */
  onFocusMessage: () => void
}

/** A menu item that can't act now, with why where it says more than the grey does. */
function Item({
  icon,
  label,
  shortcut,
  unavailable,
  onSelect
}: {
  icon: ReactNode
  label: string
  shortcut?: string
  /** Why it can't act (shown in the shortcut's place), `true` for no stated reason, or false. */
  unavailable?: string | boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <ContextMenuItem
      disabled={unavailable !== undefined && unavailable !== false}
      onSelect={onSelect}
    >
      {icon}
      {label}
      {typeof unavailable === 'string' ? (
        <ContextMenuShortcut>{unavailable}</ContextMenuShortcut>
      ) : shortcut ? (
        <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>
      ) : null}
    </ContextMenuItem>
  )
}

function RefreshItem(): React.JSX.Element {
  const refresh = useSourceControlStore((state) => state.refresh)
  const busy = useSourceControlStore((state) => state.running !== null)
  return (
    <Item
      icon={<RefreshCw aria-hidden />}
      label="Refresh"
      unavailable={busy}
      onSelect={() => void refresh(true)}
    />
  )
}

/** A changed file's menu: commit or roll back just it, open it, its paths, delete or ignore it. */
export function FileRowMenu({
  group,
  file,
  requests
}: {
  group: GitGroup
  file: ChangedFile
  requests: RowMenuRequests
}): React.JSX.Element {
  const busy = useSourceControlStore((state) => state.running !== null)
  const checkOnly = useSourceControlStore((state) => state.checkOnly)
  const addToVcs = useSourceControlStore((state) => state.addToVcs)
  const ignore = useSourceControlStore((state) => state.ignore)
  const openHunk = useHunkTabStore((state) => state.open)
  const afterMenu = useAfterMenu()
  const untracked = isUntracked(file)
  const deleted = file.kind === 'deleted'
  return (
    <ContextMenuContent onCloseAutoFocus={afterMenu.onCloseAutoFocus}>
      {untracked ? (
        <Item
          icon={<FilePlus aria-hidden />}
          label="Add to VCS"
          unavailable={busy}
          onSelect={() => void addToVcs(group, [file])}
        />
      ) : (
        <>
          <Item
            icon={<GitCommitHorizontal aria-hidden />}
            label="Commit File…"
            onSelect={() => {
              checkOnly(group.root, file.path)
              afterMenu.choose(requests.onFocusMessage)
            }}
          />
          <Item
            icon={<Undo2 aria-hidden />}
            label="Rollback…"
            unavailable={busy}
            onSelect={() => requests.onRollback([{ group, files: [file] }])}
          />
        </>
      )}
      <Item
        icon={<FileCode aria-hidden />}
        label="Jump to Source"
        shortcut={ENTER_LABEL}
        unavailable={deleted && 'Deleted'}
        onSelect={() => requests.onOpen(file)}
      />
      {untracked ? null : (
        <Item
          icon={<GitCompareArrows aria-hidden />}
          label="Review Changes"
          onSelect={() => openHunk('review', group.root, group.name)}
        />
      )}
      {deleted ? null : (
        <>
          <ContextMenuSeparator />
          <PathMenuItems path={file.absolutePath} relative />
          <ContextMenuSeparator />
          <Item
            icon={<Trash2 aria-hidden />}
            label="Delete…"
            shortcut={DELETE_LABEL}
            onSelect={() => requests.onTrash(group, [file])}
          />
          {untracked ? (
            <Item
              icon={<EyeOff aria-hidden />}
              label="Add to .gitignore"
              unavailable={busy}
              onSelect={() => void ignore(group, file)}
            />
          ) : null}
        </>
      )}
      <ContextMenuSeparator />
      <RefreshItem />
    </ContextMenuContent>
  )
}

/** The Unversioned Files row's menu: add the selected (else every) untracked file, or delete them. */
export function UnversionedMenu({
  group,
  files,
  requests
}: {
  group: GitGroup
  files: ChangedFile[]
  requests: RowMenuRequests
}): React.JSX.Element {
  const busy = useSourceControlStore((state) => state.running !== null)
  const toAdd = useSourceControlStore((state) => state.toAdd)
  const addToVcs = useSourceControlStore((state) => state.addToVcs)
  const selected = files.filter((file) => toAdd.has(fileKey(group.root, file.path)))
  const targets = selected.length > 0 ? selected : files
  const which = selected.length > 0 ? 'Selected' : 'All'
  return (
    <ContextMenuContent>
      <Item
        icon={<FilePlus aria-hidden />}
        label={`Add ${which} to VCS`}
        unavailable={busy}
        onSelect={() => void addToVcs(group, targets)}
      />
      <Item
        icon={<Trash2 aria-hidden />}
        label={`Delete ${which}…`}
        onSelect={() => requests.onTrash(group, targets)}
      />
      <ContextMenuSeparator />
      <RefreshItem />
    </ContextMenuContent>
  )
}

/** A working tree's menu, after Open Terminal Here as in the Files tree: hunk, remote, its path. */
export function GroupMenu({ group }: { group: SourceControlGroup }): React.JSX.Element {
  const busy = useSourceControlStore((state) => state.running !== null)
  const fetch = useSourceControlStore((state) => state.fetch)
  const pull = useSourceControlStore((state) => state.pull)
  const push = useSourceControlStore((state) => state.push)
  const openHunk = useHunkTabStore((state) => state.open)
  return (
    <OpenTerminalMenuContent cwd={group.root} disabled={false}>
      {group.status === 'git' ? (
        <>
          <ContextMenuSeparator />
          <Item
            icon={<GitCompareArrows aria-hidden />}
            label="Review"
            onSelect={() => openHunk('review', group.root, group.name)}
          />
          <Item
            icon={<History aria-hidden />}
            label="Log"
            onSelect={() => openHunk('log', group.root, group.name)}
          />
          <ContextMenuSeparator />
          <Item
            icon={<CloudDownload aria-hidden />}
            label="Fetch"
            unavailable={busy}
            onSelect={() => void fetch(group)}
          />
          <Item
            icon={<ArrowDownToLine aria-hidden />}
            label="Pull"
            // git pull has nothing to merge from without an upstream (or on a detached HEAD).
            unavailable={busy || (group.upstream === null && 'No upstream')}
            onSelect={() => void pull(group.root)}
          />
          <Item
            icon={<ArrowUpFromLine aria-hidden />}
            label="Push"
            unavailable={busy || (group.branch === null && 'Detached HEAD')}
            onSelect={() => void push(group)}
          />
        </>
      ) : null}
      <ContextMenuSeparator />
      <PathMenuItems path={group.root} relative={false} />
      <ContextMenuSeparator />
      <RefreshItem />
    </OpenTerminalMenuContent>
  )
}
