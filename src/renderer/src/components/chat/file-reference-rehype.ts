import { findCodeReferences } from '../../../../shared/chat-references'

/** The element a file named in a reply's prose becomes; `ChatMarkdown` renders it. */
export const FILE_REFERENCE_TAG = 'file-reference'

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/** Text in these is left as written: code is shown verbatim, a link already goes somewhere. */
const VERBATIM = new Set(['code', 'pre', 'a', 'button', FILE_REFERENCE_TAG])

const split = (text: HastNode & { value: string }): HastNode[] => {
  const nodes: HastNode[] = []
  let at = 0
  for (const { start, end } of findCodeReferences(text.value)) {
    if (start > at) nodes.push({ type: 'text', value: text.value.slice(at, start) })
    nodes.push({
      type: 'element',
      tagName: FILE_REFERENCE_TAG,
      properties: {},
      children: [{ type: 'text', value: text.value.slice(start, end) }]
    })
    at = end
  }
  if (nodes.length === 0) return [text]
  if (at < text.value.length) nodes.push({ type: 'text', value: text.value.slice(at) })
  return nodes
}

const visit = (node: HastNode): void => {
  if (node.children === undefined || VERBATIM.has(node.tagName ?? '')) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string')
      return split({ ...child, value: child.value })
    visit(child)
    return [child]
  })
}

/** Wraps each file a reply names in its prose, so the chat can link the ones that exist. */
export const fileReferenceRehype = () => visit
