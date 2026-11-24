import {
  FolderTree,
  GitCommitHorizontal,
  Search,
  TerminalSquare,
  type LucideIcon
} from 'lucide-react'
import type { ComponentType } from 'react'
import { FilesPanel } from '@/components/files/FilesPanel'
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
} & (
  | { Panel: ComponentType; panelTitle?: never; panelPlaceholder?: never }
  | { Panel?: never; panelTitle: string; panelPlaceholder: string }
)

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
    description: 'Changes, commit and diff',
    Icon: GitCommitHorizontal,
    panelTitle: 'Commit',
    panelPlaceholder:
      'Changed files, the commit message and Commit / Commit and Push will appear here.',
    mainPlaceholder: 'The diff of the selected change will appear here.'
  }
]
