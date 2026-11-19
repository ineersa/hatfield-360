import { FolderTree, GitCommitHorizontal, TerminalSquare, type LucideIcon } from 'lucide-react'

export type ShellViewId = 'agents' | 'files' | 'git'

export type ShellView = {
  id: ShellViewId
  label: string
  description: string
  Icon: LucideIcon
  panelTitle: string
  panelPlaceholder: string
  mainPlaceholder: string
}

export const SHELL_VIEWS: readonly ShellView[] = [
  {
    id: 'agents',
    label: 'Agents',
    description: 'Workspace, worktrees and agent sessions',
    Icon: TerminalSquare,
    panelTitle: 'Agent Sessions',
    panelPlaceholder: 'Projects, their worktrees and running agent sessions will be listed here.',
    mainPlaceholder: 'Terminals with tabs and split panes will open here.'
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Project file tree and editor',
    Icon: FolderTree,
    panelTitle: 'Project',
    panelPlaceholder: 'The file tree of the selected project will appear here.',
    mainPlaceholder: 'Opened files will appear here in editor tabs.'
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
