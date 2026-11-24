export async function claudeSessionTitle(id: string, cwd: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null
  try {
    const { getSessionInfo } = await import('@anthropic-ai/claude-agent-sdk')
    const session = await getSessionInfo(id, { dir: cwd })
    // customTitle includes the provider's generated title; summary may be a prompt.
    return session?.sessionId === id ? session.customTitle?.trim().slice(0, 1024) || null : null
  } catch {
    return null
  }
}
