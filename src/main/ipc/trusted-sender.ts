/** True when an IPC sender URL belongs to the app's own renderer page (dev server origin or bundled file). */
export function isTrustedSenderUrl(senderUrl: string, entryUrl: string): boolean {
  let sender: URL
  let entry: URL
  try {
    sender = new URL(senderUrl)
    entry = new URL(entryUrl)
  } catch {
    return false
  }
  if (entry.protocol === 'file:') {
    return sender.protocol === 'file:' && sender.pathname === entry.pathname
  }
  return sender.origin === entry.origin
}
