import { mainErrorMessage } from '@/lib/main-error-message'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { notify } from '@/state/notification-store'
import { monaco } from './monaco-environment'
import { fileName } from './editor-tab-labels'

type EditorDocument = {
  model: monaco.editor.ITextModel
  /** The undo-history position of the text on disk; undoing back to it clears the dirty mark. */
  savedVersion: number
}

const documents = new Map<string, EditorDocument>()
const loading = new Set<string>()

const isOpen = (path: string): boolean =>
  useEditorTabStore.getState().tabs.some((tab) => tab.path === path)

export const editorDocument = (path: string): monaco.editor.ITextModel | undefined =>
  documents.get(path)?.model

/** Reads the file into a model, once per open tab; the tab shows the outcome. */
export async function loadDocument(path: string): Promise<void> {
  if (documents.has(path) || loading.has(path)) return
  const { setLoad, setDirty } = useEditorTabStore.getState()
  loading.add(path)
  setLoad(path, { status: 'loading' })
  try {
    const text = await window.desktop.readTextFile(path)
    if (!isOpen(path)) return
    // The URI's extension picks the language.
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(path))
    // Brackets keep the scheme's colour, as in JetBrains IDEs; Monaco sets this per model, not per editor.
    model.updateOptions({
      bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false }
    })
    const document: EditorDocument = { model, savedVersion: model.getAlternativeVersionId() }
    model.onDidChangeContent(() =>
      setDirty(path, model.getAlternativeVersionId() !== document.savedVersion)
    )
    documents.set(path, document)
    setLoad(path, { status: 'ready' })
  } catch (error) {
    if (isOpen(path)) setLoad(path, { status: 'error', message: mainErrorMessage(error) })
  } finally {
    loading.delete(path)
  }
}

/** Each file's latest save; a save starts once the one before it has finished. */
const saves = new Map<string, Promise<boolean>>()

/**
 * Writes the tab's text to disk, after any save of the same file still running, so an older text
 * never lands last. Resolves true when the file then holds the tab's text: false when the write
 * failed (it says why and keeps the changes) or the text was edited during it.
 */
export function saveDocument(path: string): Promise<boolean> {
  const save = (saves.get(path) ?? Promise.resolve(true)).then(() => writeDocument(path))
  saves.set(path, save)
  void save.finally(() => {
    if (saves.get(path) === save) saves.delete(path)
  })
  return save
}

/** Saves every tab with unsaved changes; true when all of them are saved. */
export async function saveAllDocuments(): Promise<boolean> {
  const dirty = useEditorTabStore.getState().tabs.filter((tab) => tab.dirty)
  const saved = await Promise.all(dirty.map((tab) => saveDocument(tab.path)))
  return saved.every(Boolean)
}

async function writeDocument(path: string): Promise<boolean> {
  const document = documents.get(path)
  if (!document) return false
  const { model } = document
  const version = model.getAlternativeVersionId()
  try {
    await window.desktop.writeTextFile(path, model.getValue())
  } catch (error) {
    notify({
      severity: 'error',
      title: `Couldn't save ${fileName(path)}`,
      body: mainErrorMessage(error)
    })
    return false
  }
  document.savedVersion = version
  // Typing during the write leaves the tab dirty.
  const edited = model.getAlternativeVersionId() !== version
  useEditorTabStore.getState().setDirty(path, edited)
  return !edited
}

// A model lives as long as its tab.
useEditorTabStore.subscribe((state) => {
  for (const [path, document] of documents) {
    if (state.tabs.some((tab) => tab.path === path)) continue
    document.model.dispose()
    documents.delete(path)
  }
})
