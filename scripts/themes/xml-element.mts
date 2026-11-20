/** An XML element: enough of XML for JetBrains scheme and plugin files (no text content, no namespaces). */
export type XmlElement = {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(value: string): string {
  return value.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
    return ENTITIES[code] ?? entity
  })
}

const TAG = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Parses an XML document and returns its root element. */
export function parseXml(text: string): XmlElement {
  const stack: XmlElement[] = [{ name: '#document', attributes: {}, children: [] }]
  let position = 0
  while (position < text.length) {
    const open = text.indexOf('<', position)
    if (open === -1) break
    if (text.startsWith('<!--', open)) {
      position = skipPast(text, '-->', open)
    } else if (text.startsWith('<?', open)) {
      position = skipPast(text, '?>', open)
    } else if (text.startsWith('<![CDATA[', open)) {
      position = skipPast(text, ']]>', open)
    } else if (text.startsWith('<!', open)) {
      position = skipPast(text, '>', open)
    } else {
      TAG.lastIndex = open
      const match = TAG.exec(text)
      if (!match) throw new Error(`Malformed XML tag at offset ${open}`)
      const [whole, closing, name = '', rawAttributes = '', selfClosing] = match
      position = open + whole.length
      const parent = stack.at(-1)
      if (!parent) throw new Error('Unbalanced XML')
      if (closing) {
        if (parent.name !== name) throw new Error(`Unexpected </${name}> at offset ${open}`)
        stack.pop()
        continue
      }
      const attributes: Record<string, string> = {}
      for (const [, key = '', double, single] of rawAttributes.matchAll(ATTRIBUTE)) {
        attributes[key] = decode(double ?? single ?? '')
      }
      const element: XmlElement = { name, attributes, children: [] }
      parent.children.push(element)
      if (!selfClosing) stack.push(element)
    }
  }
  const [document] = stack
  const root = document?.children[0]
  if (stack.length !== 1 || !root) throw new Error('Unbalanced XML')
  return root
}

function skipPast(text: string, terminator: string, from: number): number {
  const end = text.indexOf(terminator, from)
  if (end === -1) throw new Error(`Unterminated XML markup at offset ${from}`)
  return end + terminator.length
}

/** Every element below `element` (depth first) with the given name. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  return element.children.flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name)
  ])
}
