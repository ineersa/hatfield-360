import type { McpServer, NewSessionRequest } from '@agentclientprotocol/sdk/unstable'

/** Claude Code's tools a chat may use; the preset's subagents, web, todo and skill tools are left out. */
const CHAT_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'] as const

/** The workspace map turn only reads. */
const MAP_TOOLS = ['Read', 'Grep', 'Glob'] as const

export const PLAYBOOK_TOOL = 'save_to_playbook'

export const PLAYBOOK_TOOL_DESCRIPTION = [
  'Save one reusable learning to the workspace playbook, which every later chat in this workspace reads in its instructions.',
  'Call it when the user asks you to save or remember something, and on your own right after you learn something reusable:',
  'a command that finally worked, a project convention, a gotcha that cost time.',
  "Don't save what the playbook already says or what only matters to this chat.",
  'One short, self-contained sentence per entry.'
].join(' ')

const CHAT_PROMPT = [
  '# Hatfield 360 workspace chat',
  'You answer questions about the projects in this workspace ("where is X implemented", "how does Y work", "find me Z") and run small jobs for the user.',
  'Keep answers short. Refer to code as `path:line` or `path:start-end`, with paths relative to the working directory; the app turns these into links that open the editor.',
  `Use the ${PLAYBOOK_TOOL} tool to keep reusable learnings, as its description says.`
].join('\n')

export const MAP_PROMPT = [
  'Write the workspace map for the folders you can read: the working directory and the additional directories.',
  'For each folder, read its layout, its AGENTS.md / CLAUDE.md / README and its manifests (package.json, composer.json, castor.php, pyproject.toml, Cargo.toml, go.mod, Makefile, ...).',
  'Answer with only the map in Markdown between the lines `<!-- workspace -->` and `<!-- /workspace -->`:',
  'for each project its absolute path, what it is, the tech stack, where sources and tests are, and its commands (pnpm, composer, castor, uv, make, ...) with what each does.',
  'Be concise: under 150 lines in all. Do not change any file.'
].join('\n')

type SessionSetup = {
  cwd: string
  additionalDirectories: string[]
  /** The workspace map file's text, or empty when there is none. */
  instructions: string
  mcpServers: McpServer[]
  /** The map turn runs read-only, without the chat's prompt or tools. */
  purpose: 'chat' | 'map'
}

/**
 * A lean, unpersisted Claude Code session: only the basic tools, no MCP servers but the app's, no
 * CLAUDE.md, settings, plugins, hooks or skills, and Bash in Claude Code's own sandbox.
 */
export function newSessionRequest({
  cwd,
  additionalDirectories,
  instructions,
  mcpServers,
  purpose
}: SessionSetup): NewSessionRequest {
  const append =
    purpose === 'chat'
      ? [CHAT_PROMPT, instructions ? `# Workspace instructions\n\n${instructions}` : '']
          .filter(Boolean)
          .join('\n\n')
      : ''
  return {
    cwd,
    additionalDirectories,
    mcpServers,
    _meta: {
      ...(append ? { systemPrompt: { append } } : {}),
      claudeCode: {
        options: {
          persistSession: false,
          tools: purpose === 'chat' ? [...CHAT_TOOLS] : [...MAP_TOOLS],
          strictMcpConfig: true,
          settingSources: [],
          // Without this Claude Code keeps a memory folder under ~/.claude/projects.
          settings: { autoMemoryEnabled: false },
          sandbox: {
            enabled: true,
            // A missing sandbox (bubblewrap or socat not installed) stops the chat instead of running unsandboxed.
            failIfUnavailable: true,
            autoAllowBashIfSandboxed: true,
            filesystem: { allowWrite: additionalDirectories }
          }
        }
      }
    }
  }
}
