import {
  FolderTree,
  GitCommitHorizontal,
  Search,
  TerminalSquare,
  type LucideIcon
} from 'lucide-react'
import type { ComponentType } from 'react'
import { FilesPanel } from '@/components/files/FilesPanel'
import { GitMainEmpty } from '@/components/git/GitMainEmpty'
import { GitPanel } from '@/components/git/GitPanel'
import { SearchPanel } from '@/components/search/SearchPanel'
import { TerminalEmptyState } from '@/components/terminal/TerminalEmptyState'
import { WorkspacePanel } from '@/components/workspace/WorkspacePanel'
import type { ShellViewId } from '../../../../shared/shell-layout-api'

export type ShellView = {
  id: ShellViewId
  label: string
  description: string
  Icon: LucideIcon
  mainPlaceholder: string
  /** Replaces the placeholder text when the view has something to start with. */
  MainEmpty?: ComponentType
  Panel: ComponentType
}

export const SHELL_VIEWS: readonly ShellView[] = [
  {
    id: 'agents',
    label: 'Agents',
    description: 'Workspace, worktrees and agent sessions',
    Icon: TerminalSquare,
    Panel: WorkspacePanel,
    MainEmpty: TerminalEmptyState,
    mainPlaceholder: 'Terminals with tabs and split panes open here.'
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Project file tree and editor',
    Icon: FolderTree,
    Panel: FilesPanel,
    mainPlaceholder: 'Opened files will appear here in editor tabs.'
  },
  {
    id: 'search',
    label: 'Find in Files',
    description: 'Search text across the workspace',
    Icon: Search,
    Panel: SearchPanel,
    mainPlaceholder: 'Search results open here in editor tabs.'
  },
  {
    id: 'git',
    label: 'Git',
    description: 'Changes, commit, and review in hunk',
    Icon: GitCommitHorizontal,
    Panel: GitPanel,
    MainEmpty: GitMainEmpty,
    mainPlaceholder: 'hunk Review and Log tabs open here.'
  }
]
