# Product Vision

Hatfield 360 is a desktop workspace for running coding agents in terminals, with just enough editor and git to stop switching to an IDE. Think "a better tmux that knows about projects, worktrees and agents, and tells me when an agent needs me", plus a file editor and a JetBrains-style git view.

Orca covers most of this ground (QA scratch change, not for merge).

## Layout

Two columns, JetBrains-style (QA scratch change).
QA scratch line that a later commit changes.

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
- **Workspace chat** (right, `Ctrl/Cmd+Shift+L` from anywhere or the Chat button under the notifications bell; Shift Shift is Search Everywhere): Claude Code over ACP, for questions about the workspace's projects ("where is X implemented") and small jobs. It is a tool window over any view, like the notifications panel, not a third column. It runs the user's own `claude` with its login (never an API key), Haiku at medium effort by default, and reads the workspace map file (`<workspace>.workspace.md`) as its instructions; Generate Workspace Map writes that file's map section, and the chat saves learnings to its playbook section.

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

- Default look is JetBrains **Islands Dark**: rounded "island" panels on a slightly lighter frame, activity bar and status bar on the frame.
- Themes are ported once from JetBrains UI themes and editor schemes (IntelliJ Platform Islands, Darcula, Light, High Contrast; Catppuccin) into the app's theme files, which are then maintained as ours.
- Three independent theme choices, each a separate setting:
  - **App theme** (`workbench.colorTheme`): colour roles, radii and row heights (`src/renderer/src/assets/themes/app/<id>.css`, selected by `data-theme` on `<html>`). Text styles and control sizes shared by every app theme are in `themes/base.css`. Components use only these roles; lint rejects raw colours, text sizes, weights, radii and heights.
  - **Editor theme** (`editor.colorTheme`): syntax, editor and diff colours for the editor and diff viewer (#6, #7), one scheme JSON per theme in `src/renderer/src/assets/themes/editor/`.
  - **Terminal theme** (`terminal.colorTheme`): xterm colours and ANSI palette (#4), from each scheme's console colours.
- File and folder icons: Catppuccin icon set (catppuccin/vscode-icons, MIT) in the file tree, tabs and changes list.
- A theme picker (settings) comes after the first views exist; until then Islands Dark is fixed.

## Later (not in the first implementation)

Rough priority order; each becomes its own issue when it's next.

1. **Agent integration:** detect agent state (working / needs input / finished), show it in the tree and status bar, desktop notifications, agents notifying the app directly (Claude Code hooks, Hatfield).
2. **Session persistence:** save sessions, terminals and layout on close; restore them on reopen.
3. **Search:** Search Everywhere (Shift Shift: files, classes, symbols), find in files; maybe semantic search.
4. **GitHub:** issues/tasks tracking (Hatfield task workflow), PRs, code review comments inside the editor.
5. **Editor depth:** LSP (go-to-definition, diagnostics). Nice to have, not crucial.

## Non-goals

- A third column / right-hand file panel.
- Everything Orca has beyond the above (remote/SSH runtimes, mobile, browser panes, ...) unless a concrete need appears.
- Being a full IDE: the editor only needs to be good enough to not open an IDE for routine work.
