import type { languages } from 'monaco-editor'
import { language as monacoMarkdown } from 'monaco-editor/languages/definitions/markdown/markdown.js'

const FENCE = 'markup.code.fence'

/**
 * Monaco's Markdown tokenizer with a class for each Markdown element, so the scheme's Markdown
 * colours apply: Monaco's own gives headings, list markers and table pipes all `keyword`, and code
 * `variable`. Its HTML and embedded script and style states are kept as they are.
 */
export const markdownLanguage: languages.IMonarchLanguage = {
  ...monacoMarkdown,
  tokenizer: {
    ...monacoMarkdown.tokenizer,
    root: [
      [/^\s*\|/, '@rematch', '@table_header'],
      [
        /^\s{0,3}(#{1,6})(?=\s|$).*$/,
        {
          cases: {
            '$1==#': 'markup.heading.1',
            '$1==##': 'markup.heading.2',
            '$1==###': 'markup.heading.3',
            '$1==####': 'markup.heading.4',
            '$1==#####': 'markup.heading.5',
            '@default': 'markup.heading.6'
          }
        }
      ],
      [/^\s*=+\s*$/, 'markup.heading.1'],
      [/^\s*([-*_])(\s*\1){2,}\s*$/, 'markup.hrule'],
      [/^\s*>+/, 'markup.quote'],
      [/^\s*([*+-]|\d+[.)])(?=\s)/, 'markup.list'],
      [/^(\t|[ ]{4})[^ ].*$/, 'markup.code.block'],
      [/^\s*~~~\s*((?:\w|[/\-#])+)?\s*$/, { token: FENCE, next: '@codeblock' }],
      // A fence naming a language highlights the code in it as that language.
      [/^\s*```\s*((?:\w|[/\-#])+).*$/, { token: FENCE, next: '@codeblockgh', nextEmbedded: '$1' }],
      [/^\s*```\s*$/, { token: FENCE, next: '@codeblock' }],
      { include: '@linecontent' }
    ],
    table_header: [{ include: '@table_common' }, [/[^|]+/, 'markup.table.header']],
    table_body: [{ include: '@table_common' }, { include: '@linecontent' }],
    table_common: [
      [/\s*[-:]+\s*/, { token: 'markup.table', switchTo: 'table_body' }],
      [/^\s*\|/, 'markup.table'],
      [/^\s*[^|]/, '@rematch', '@pop'],
      [/^\s*$/, '@rematch', '@pop'],
      [/\|/, 'markup.table']
    ],
    codeblock: [
      [/^\s*~~~\s*$/, { token: FENCE, next: '@pop' }],
      [/^\s*```\s*$/, { token: FENCE, next: '@pop' }],
      [/.*$/, 'markup.code.block']
    ],
    codeblockgh: [
      [/```\s*$/, { token: FENCE, next: '@pop', nextEmbedded: '@pop' }],
      [/[^`]+/, 'markup.code.block']
    ],
    linecontent: [
      [/&\w+;/, 'string.escape'],
      [/@escapes/, 'string.escape'],
      [/\b__([^\\_]|@escapes|_(?!_))+__\b/, 'markup.bold'],
      [/\*\*([^\\*]|@escapes|\*(?!\*))+\*\*/, 'markup.bold'],
      [/\b_[^_]+_\b/, 'markup.italic'],
      [/\*([^\\*]|@escapes)+\*/, 'markup.italic'],
      [/`([^\\`]|@escapes)+`/, 'markup.code.span'],
      [/(!?\[(?:[^\]\\]|@escapes)*\])(\([^)]*\))/, ['markup.link.text', 'markup.link.destination']],
      [/!?\[(?:[^\]\\]|@escapes)*\]/, 'markup.link.text'],
      [/<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>()[\]]+/, 'markup.link.auto'],
      { include: 'html' }
    ]
  }
}
