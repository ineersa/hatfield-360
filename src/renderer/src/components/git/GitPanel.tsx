import { ArrowDownToLine, ChevronsDownUp, ChevronsUpDown, RefreshCw, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { HidePanelButton } from '@/components/shell/HidePanelButton'
import { PanelHeaderButton } from '@/components/shell/PanelHeaderButton'
import {
  OpenFolderEmptyState,
  WorkspaceProblemBanner
} from '@/components/workspace/WorkspaceNotices'
import { TrashDialog } from '@/components/files/TrashDialog'
import { type FileTargets, useSourceControlStore } from '@/state/source-control-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import { ActionFailureNotice } from './ActionFailureNotice'
import type { ChangedFile } from '../../../../shared/source-control-api'
import {
  changeTreeRows,
  checkedFilesByGroup,
  type GitGroup,
  trackedFiles
} from './change-tree-rows'
import { ChangesLoading, ChangesTree } from './ChangesTree'
import { pullPlan } from './commit-plan'
import { CommitBox } from './CommitBox'
import { RollbackDialog } from './RollbackDialog'
import { AbortOperationDialog } from './AbortOperationDialog'
import { BranchDialogs } from './BranchDialogs'

const ICON = 'size-4.5'

/**
 * Git side panel: each working tree's changes to check, commit, push, pull or roll back. Nothing
 * is pushed from main: status is read on opening, on window focus, on Refresh and after each action.
 */
export function GitPanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const groups = useSourceControlStore((state) => state.groups)
  const checked = useSourceControlStore((state) => state.checked)
  const collapsed = useSourceControlStore((state) => state.collapsed)
  const unversionedOpen = useSourceControlStore((state) => state.unversionedOpen)
  const selected = useSourceControlStore((state) => state.selected)
  const running = useSourceControlStore((state) => state.running)
  const failure = useSourceControlStore((state) => state.failure)
  const refresh = useSourceControlStore((state) => state.refresh)
  const pull = useSourceControlStore((state) => state.pull)
  const rollback = useSourceControlStore((state) => state.rollback)
  const expandAll = useSourceControlStore((state) => state.expandAll)
  const collapseAll = useSourceControlStore((state) => state.collapseAll)
  const dismissFailure = useSourceControlStore((state) => state.dismissFailure)
  const abort = useSourceControlStore((state) => state.abort)
  const [rollingBack, setRollingBack] = useState<FileTargets | null>(null)
  const [aborting, setAborting] = useState<GitGroup | null>(null)
  const [trashing, setTrashing] = useState<{ group: GitGroup; files: ChangedFile[] } | null>(null)

  // Opening the panel, folders added or removed, and branches or worktrees git reports read it again.
  useEffect(() => {
    void refresh()
    const unfollowWorkspace = useWorkspaceStore.subscribe((state, previous) => {
      if (state.workspace?.folders !== previous.workspace?.folders) void refresh()
    })
    const unfollowWorktrees = useWorktreeStore.subscribe((state, previous) => {
      if (state.projects !== previous.projects) void refresh()
    })
    return () => {
      unfollowWorkspace()
      unfollowWorktrees()
    }
  }, [refresh])
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const rows = useMemo(
    () => changeTreeRows(groups ?? [], collapsed, unversionedOpen),
    [groups, collapsed, unversionedOpen]
  )
  const checkedTargets = useMemo(
    () => checkedFilesByGroup(groups ?? [], checked, trackedFiles),
    [groups, checked]
  )
  const checkedCount = checkedTargets.reduce((sum, target) => sum + target.files.length, 0)
  const pulling = pullPlan(groups, selected?.root ?? null)
  const busy = running !== null
  const problem = workspace?.problem ?? null

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title min-w-0 flex-1 truncate">Commit</h2>
        <PanelHeaderButton
          label="Refresh"
          busy={running === 'refresh'}
          disabled={busy && running !== 'refresh'}
          onClick={() => void refresh(true)}
        >
          <RefreshCw className={ICON} strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <PanelHeaderButton
          label="Pull"
          busy={running === 'pull'}
          disabled={pulling.blocked !== null || (busy && running !== 'pull')}
          onClick={() => void pull()}
          tip={pulling.blocked ?? pulling.tip}
        >
          <ArrowDownToLine className={ICON} strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <PanelHeaderButton
          label="Rollback"
          busy={running === 'rollback'}
          disabled={checkedCount === 0 || (busy && running !== 'rollback')}
          onClick={() => setRollingBack(checkedTargets)}
          tip={checkedCount === 0 ? 'Check the files to roll back' : 'Roll back checked files…'}
        >
          <Undo2 className={ICON} strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <PanelHeaderButton label="Expand All" onClick={expandAll}>
          <ChevronsUpDown className={ICON} strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <PanelHeaderButton label="Collapse All" onClick={collapseAll}>
          <ChevronsDownUp className={ICON} strokeWidth={1.75} aria-hidden />
        </PanelHeaderButton>
        <HidePanelButton view="git" />
      </div>
      {problem ? <WorkspaceProblemBanner problem={problem} /> : null}
      {workspace && workspace.folders.length === 0 && !problem ? (
        <div className="flex-1">
          <OpenFolderEmptyState message="Open a project folder to see its changes and commit them here." />
        </div>
      ) : groups === null ? (
        <div className="flex-1">
          <ChangesLoading />
        </div>
      ) : (
        <ChangesTree
          rows={rows}
          onRollback={setRollingBack}
          onTrash={(group, files) => setTrashing({ group, files })}
          onAbort={setAborting}
        />
      )}
      {failure ? <ActionFailureNotice failure={failure} onDismiss={dismissFailure} /> : null}
      <CommitBox />
      {rollingBack ? (
        <RollbackDialog
          targets={rollingBack}
          onConfirm={() => void rollback(rollingBack)}
          onClose={() => setRollingBack(null)}
        />
      ) : null}
      {aborting?.operation ? (
        <AbortOperationDialog
          name={aborting.name}
          operation={aborting.operation.kind}
          onConfirm={() => void abort(aborting)}
          onClose={() => setAborting(null)}
        />
      ) : null}
      <BranchDialogs />
      {trashing ? (
        <TrashDialog
          entries={trashing.files.map((file) => ({
            name: file.path.slice(file.path.lastIndexOf('/') + 1),
            path: file.absolutePath,
            kind: file.nestedRepository ? 'directory' : 'file'
          }))}
          onClose={() => setTrashing(null)}
          onTrashed={() => void refresh()}
        />
      ) : null}
    </>
  )
}
