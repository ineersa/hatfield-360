import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  EyeOff,
  FileCode,
  FilePlus,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequest,
  GitPullRequestArrow,
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
import { useReviewStore } from '@/state/review-store'
import { useStashStore } from '@/state/stash-store'
import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'
import { addableFiles, fileKey, type GitGroup, isUntracked } from './change-tree-rows'
import { pullBlocker, stashPlan } from './commit-plan'

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
  const nested = file.nestedRepository
  return (
    <ContextMenuContent onCloseAutoFocus={afterMenu.onCloseAutoFocus}>
      {untracked ? (
        <Item
          icon={<FilePlus aria-hidden />}
          label="Add to VCS"
          // Git would record a nested repository as a bare commit pointer, not its files.
          unavailable={(nested && 'Nested repository') || busy}
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
        unavailable={(deleted && 'Deleted') || (nested && 'Folder')}
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

/**
 * The Unversioned Files row's menu: add the selected (else every) untracked file, or delete them.
 * A nested repository is never among them: it is added by no one and deleted only on its own row.
 */
export function UnversionedMenu({
  group,
  requests
}: {
  group: GitGroup
  requests: RowMenuRequests
}): React.JSX.Element {
  const busy = useSourceControlStore((state) => state.running !== null)
  const toAdd = useSourceControlStore((state) => state.toAdd)
  const addToVcs = useSourceControlStore((state) => state.addToVcs)
  const addable = addableFiles(group)
  const selected = addable.filter((file) => toAdd.has(fileKey(group.root, file.path)))
  const targets = selected.length > 0 ? selected : addable
  const which = selected.length > 0 ? 'Selected' : 'All'
  const none = targets.length === 0 && 'Only nested repositories'
  return (
    <ContextMenuContent>
      <Item
        icon={<FilePlus aria-hidden />}
        label={`Add ${which} to VCS`}
        unavailable={none || busy}
        onSelect={() => void addToVcs(group, targets)}
      />
      <Item
        icon={<Trash2 aria-hidden />}
        label={`Delete ${which}…`}
        unavailable={none}
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
  const openBranches = useSourceControlStore((state) => state.openBranches)
  const openNewBranch = useSourceControlStore((state) => state.openNewBranch)
  const groups = useSourceControlStore((state) => state.groups)
  const checked = useSourceControlStore((state) => state.checked)
  const toAdd = useSourceControlStore((state) => state.toAdd)
  const stashing = stashPlan(groups ?? [], checked, toAdd, { root: group.root, only: true })
  const openStash = useStashStore((state) => state.openStash)
  const openUnstash = useStashStore((state) => state.openUnstash)
  const afterMenu = useAfterMenu()
  const review = useReviewStore((state) => state.reviews[group.root])
  const reviewBranch = useReviewStore((state) => state.reviewBranch)
  const openBaseChooser = useReviewStore((state) => state.openBaseChooser)
  const openPullRequests = useReviewStore((state) => state.openPullRequests)
  const reviewPullRequest = useReviewStore((state) => state.reviewPullRequest)
  return (
    <OpenTerminalMenuContent
      cwd={group.root}
      disabled={false}
      onCloseAutoFocus={afterMenu.onCloseAutoFocus}
    >
      {group.status === 'git' ? (
        <>
          <ContextMenuSeparator />
          <Item
            icon={<GitBranch aria-hidden />}
            label="Branches…"
            onSelect={() => afterMenu.choose(() => openBranches(group.root))}
          />
          <Item
            icon={<GitBranchPlus aria-hidden />}
            label="New Branch…"
            unavailable={busy}
            onSelect={() => afterMenu.choose(() => openNewBranch(group, { kind: 'head' }))}
          />
          <ContextMenuSeparator />
          <Item
            icon={<Archive aria-hidden />}
            label="Stash Changes…"
            unavailable={stashing.blocked ?? busy}
            onSelect={() => {
              const { target } = stashing
              if (target) afterMenu.choose(() => openStash(target))
            }}
          />
          <Item
            icon={<ArchiveRestore aria-hidden />}
            label="Unstash Changes…"
            unavailable={busy}
            onSelect={() => afterMenu.choose(() => void openUnstash(group))}
          />
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
          <Item
            icon={<GitBranch aria-hidden />}
            label="Review Branch"
            {...(review?.base ? { shortcut: `vs ${review.base}` } : {})}
            unavailable={
              review === undefined ? 'Reading…' : review.base === null ? 'No main branch' : false
            }
            onSelect={() => reviewBranch(group)}
          />
          <Item
            icon={<GitBranch aria-hidden />}
            label="Review Branch Against…"
            onSelect={() => afterMenu.choose(() => void openBaseChooser(group))}
          />
          {review?.github ? (
            <>
              {review.pullRequest ? (
                <Item
                  icon={<GitPullRequestArrow aria-hidden />}
                  label={`Review Pull Request #${review.pullRequest.number}`}
                  onSelect={() => {
                    const own = review.pullRequest
                    if (own) reviewPullRequest(group, own)
                  }}
                />
              ) : null}
              <Item
                icon={<GitPullRequest aria-hidden />}
                label="Review Pull Request…"
                onSelect={() => afterMenu.choose(() => void openPullRequests(group))}
              />
            </>
          ) : null}
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
            unavailable={pullBlocker(group) ?? busy}
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
