# Product Vision

Hatfield 360 is a desktop workspace for running coding agents in terminals, with just enough editor and git to stop switching to an IDE. Think "a better tmux that knows about projects, worktrees and agents, and tells me when an agent needs me", plus a file editor and a JetBrains-style git view.

Orca (`~/projects/orca`) covers most of this ground and is the main code reference, but Hatfield 360 deliberately does less and uses a different layout.

## Layout

Two columns, JetBrains-style, not Orca's three columns (no right-hand file/project panel).

```
┌──┬──────────────────┬───────────────────────────────────────────┐
│▣ │ Side panel       │ Main area                                 │
│  │ (per view)       │ (per view)                                │
│⎇ │                  │                                           │
│  │                  │                                           │
│◫ │                  │                                           │
│  │                  │                                           │
│… │                  │                                           │
├──┴──────────────────┴───────────────────────────────────────────┤
│ status bar                                                      │
└─────────────────────────────────────────────────────────────────┘
 ↑ activity bar: icon buttons that switch the view
```

- **Activity bar** (far left, narrow): one icon button per view. Clicking the active view's icon collapses its side panel.
- **Side panel**: content depends on the view; resizable and collapsible.
- **Main area**: content depends on the view.
- Each view keeps its own state (open tabs, splits, selection) when you switch away and back.

## Views (first implementation)

### 1. Agents (default view)

- **Side panel: workspace tree.**
  - A workspace holds projects (folders), added like VS Code's "Add Folder to Workspace".
  - Under each project: its active git worktrees.
  - Under each project/worktree: agent sessions with live state (running, waiting for input, done, failed).
  - Context menu (right click) on a project or worktree: open a terminal there, start an agent session there.
  - Toolbar: New Session (with a dropdown to choose the agent), Add Folder, filter, search.
- **Main area: terminals.**
  - Terminal tabs, each split horizontally/vertically into panes (tmux-like).
  - Agent sessions are terminals running an agent CLI (Claude Code, Hatfield agents, ...).

### 2. Files

- **Side panel:** file tree of the selected project/worktree.
- **Main area:** editor with tabs (basic editing, syntax highlighting, Markdown preview).

### 3. Git

- **Side panel:** PhpStorm-style commit panel.
  - Changes tree grouped by repository, with the current branch; per-file and per-group checkboxes to choose what to commit.
  - Toolbar: refresh, rollback, update/pull, shelve/stash, show diff, expand/collapse all.
  - Commit message box, Amend toggle, Commit and Commit and Push buttons.
- **Main area:** diff viewer for the selected change.

## Look and themes

- Default look is JetBrains **Islands Dark**: rounded "island" panels on a slightly lighter frame, activity bar and status bar on the frame. The PhpStorm editor scheme export is `resources/themes/islands-dark.icls` (source for editor and console colours).
- Three independent theme choices, each a separate setting:
  - **App theme**: CSS colour roles (`src/renderer/src/assets/themes/<id>.css`, selected by `data-theme` on `<html>`).
  - **Editor theme**: syntax and editor colours for the editor and diff viewer (#6, #7); default derived from the Islands Dark `.icls`.
  - **Terminal theme**: xterm colours and ANSI palette (#4); default derived from Islands Dark console colours.
- File and folder icons: Catppuccin icon set (catppuccin/vscode-icons, MIT) in the file tree, tabs and changes list.
- A theme picker (settings) comes after the first views exist; until then Islands Dark is fixed.

## Later (not in the first implementation)

Rough priority order; each becomes its own issue when it's next.

1. **Agent integration:** detect agent state (working / needs input / finished), show it in the tree and status bar, desktop notifications, agents notifying the app directly (Claude Code hooks, Hatfield).
2. **Session persistence:** save sessions, terminals and layout on close; restore them on reopen.
3. **Search:** fuzzy file/command finder (Ctrl/Cmd+P style), find in files; maybe semantic search.
4. **GitHub:** issues/tasks tracking (Hatfield task workflow), PRs, code review comments inside the editor.
5. **Editor depth:** LSP (go-to-definition, diagnostics). Nice to have, not crucial.

## Non-goals

- A third column / right-hand file panel.
- Everything Orca has beyond the above (remote/SSH runtimes, mobile, browser panes, ...) unless a concrete need appears.
- Being a full IDE: the editor only needs to be good enough to not open an IDE for routine work.
