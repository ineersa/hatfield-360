import { isAbsolute } from 'node:path'
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { RECENT_CONVERSATION_MS, type RecentConversation } from '../../shared/recent-conversation'
import type { WorkspaceView } from '../../shared/workspace-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'

export async function listClaudeCatalog(
  folders: WorkspaceView['folders'],
  projects: ProjectWorktrees[],
  now = Date.now(),
  sessionId?: string
): Promise<RecentConversation[]> {
  const scopes = new Map<string, string>()
  for (const folder of folders) {
    if (folder.missing || folder.kind !== 'project') continue
    scopes.set(folder.path, folder.path)
    const project = projects.find((entry) => entry.folder === folder.path)
    if (project?.status !== 'git') continue
    for (const tree of project.worktrees) {
      if (!tree.prunable && !scopes.has(tree.path)) scopes.set(tree.path, folder.path)
    }
  }
  const entries = new Map<string, RecentConversation>()
  for (const [dir, project] of scopes) {
    for (const summary of await listSessions({
      dir,
      includeWorktrees: false,
      includeProgrammatic: false
    })) {
      if (sessionId && summary.sessionId.toLowerCase() !== sessionId) continue
      const info = sessionId ? await getSessionInfo(summary.sessionId, { dir }) : summary
      if (
        !info ||
        info.archived ||
        !info.cwd ||
        !isAbsolute(info.cwd) ||
        !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(info.sessionId) ||
        !Number.isFinite(info.lastModified) ||
        info.lastModified <= now - RECENT_CONVERSATION_MS
      )
        continue
      const id = info.sessionId.toLowerCase()
      const existing = entries.get(id)
      if (existing && existing.lastModified >= info.lastModified) continue
      entries.set(id, {
        provider: 'claude',
        providerSessionId: id,
        project,
        cwd: info.cwd,
        title: info.summary || null,
        branch: info.gitBranch ?? null,
        lastModified: info.lastModified
      })
    }
  }
  return [...entries.values()].toSorted((a, b) => b.lastModified - a.lastModified)
}
