// Monaco ships its Monarch language definitions untyped.
declare module 'monaco-editor/languages/definitions/markdown/markdown.js' {
  import type { languages } from 'monaco-editor'

  export const language: languages.IMonarchLanguage
}
