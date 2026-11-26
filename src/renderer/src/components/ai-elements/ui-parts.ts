/** The message and tool-part shapes AI Elements was written against, without the `ai` package. */

export type MessageRole = 'system' | 'user' | 'assistant'

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error'

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

export type FileUIPart = { type: 'file'; mediaType: string; filename?: string; url: string }

export type SourceDocumentUIPart = {
  type: 'source-document'
  sourceId: string
  mediaType: string
  title: string
  filename?: string
}

export type UIMessage = {
  id: string
  role: MessageRole
  parts: ({ type: 'text'; text: string } | { type: string })[]
}
