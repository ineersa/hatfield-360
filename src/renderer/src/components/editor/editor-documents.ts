import type { IReference } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import type { ITextFileEditorModel } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textfiles'
import { registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { notify } from '@/state/notification-store'
import type { EditorFile } from '../../../../shared/editor-api'
import { monaco } from './monaco-environment'
import { fileName } from './editor-tab-labels'
import { attachLanguageServer, detachLanguageServer } from './language-clients'
import { WorkspaceFileSystem } from './workspace-file-system'

type EditorDocument = {
  /** VS Code's text file model, whose dirty mark is the tab's; the editor tabs save and reload it. */
  file: IReference<ITextFileEditorModel>
  model: monaco.editor.ITextModel
  /** The file's version on disk the text is based on; saving over any other asks first. */
  base: string
  /** A large file's start: never edited or saved. */
  readOnly: boolean
  /** The file as it is on disk now, while the user picks between it and the tab's edits. */
  disk: EditorFile | null
}

const documents = new Map<string, EditorDocument>()
const loading = new Set<string>()
/** Files main holds for a tab (it watches them and lets them be saved), with or without a model. */
const held = new Set<string>()

const tabOf = (path: string) => useEditorTabStore.getState().tabs.find((tab) => tab.path === path)

const isEdited = (document: EditorDocument): boolean => document.file.object.isDirty()

/** The model's text is what the file on disk holds. */
const markSaved = (document: EditorDocument): Promise<void> =>
  document.file.object.revert({ soft: true })

/** Lets VS Code dispose the model once nothing else (a peek) uses it; unsaved edits are dropped. */
function releaseModel(document: EditorDocument): void {
  void markSaved(document)
    .catch(() => undefined)
    .then(() => document.file.dispose())
}

const files = new WorkspaceFileSystem((path) => held.has(path) || loading.has(path))
registerFileSystemOverlay(1, files)

export const editorDocument = (path: string): monaco.editor.ITextModel | undefined =>
  documents.get(path)?.model

/** Reads the file into a model, once per open tab; the tab shows the outcome. */
export async function loadDocument(path: string): Promise<void> {
  if (documents.has(path) || loading.has(path)) return
  const { setLoad, setDirty } = useEditorTabStore.getState()
  loading.add(path)
  setLoad(path, { status: 'loading' })
  try {
    const file = await window.desktop.readTextFile(path)
    // Closed while it loaded: main is told the editor doesn't hold it.
    if (!tabOf(path)) {
      await window.desktop.releaseTextFile(path)
      return
    }
    if (file.kind === 'missing') {
      setLoad(path, { status: 'error', message: 'there is no such file.' })
      return
    }
    held.add(path)
    if (file.kind === 'binary') {
      setLoad(path, { status: 'ready', file: 'binary', size: file.size })
      return
    }
    files.prime(path, file)
    // The URI's extension picks the language.
    const reference = await monaco.editor.createModelReference(monaco.Uri.file(path))
    const model = reference.object.textEditorModel
    if (!model || !tabOf(path)) {
      reference.dispose()
      if (!model) setLoad(path, { status: 'error', message: "the editor couldn't read it." })
      return
    }
    // Still open in a peek since its tab closed: it gets the text on disk.
    if (model.getValue() !== file.text) model.setValue(file.text)
    await reference.object.revert({ soft: true })
    // Brackets keep the scheme's colour, as in JetBrains IDEs; Monaco sets this per model, not per editor.
    model.updateOptions({
      bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false }
    })
    const document: EditorDocument = {
      file: reference,
      model,
      base: file.version,
      readOnly: file.kind === 'large',
      disk: null
    }
    reference.object.onDidChangeDirty(() => setDirty(path, isEdited(document)))
    documents.set(path, document)
    if (!document.readOnly) void attachLanguageServer(path, model.getLanguageId())
    setLoad(path, {
      status: 'ready',
      file: file.kind,
      size: file.kind === 'large' ? file.size : file.text.length
    })
  } catch (error) {
    if (tabOf(path)) setLoad(path, { status: 'error', message: mainErrorMessage(error) })
  } finally {
    loading.delete(path)
  }
}

/** Each file's latest save or reload; each starts once the one before it has finished. */
const queues = new Map<string, Promise<unknown>>()

function queued<T>(path: string, task: () => Promise<T>): Promise<T> {
  // Whatever became of the task before, this one still runs.
  const previous = queues.get(path)?.catch(() => undefined) ?? Promise.resolve()
  const run = previous.then(task)
  queues.set(path, run)
  void run
    .finally(() => {
      if (queues.get(path) === run) queues.delete(path)
    })
    .catch(() => undefined)
  return run
}

/**
 * Writes the tab's text to disk, after any save or reload of the same file still running, so an
 * older text never lands last. Resolves true when the file then holds the tab's text: false when
 * the write failed (it says why and keeps the changes), the file changed on disk since it was read
 * (the user is asked) or the text was edited during it.
 */
export const saveDocument = (path: string): Promise<boolean> =>
  queued(path, () => writeDocument(path))

/** Saves every tab with unsaved changes; true when all of them are saved. */
export async function saveAllDocuments(): Promise<boolean> {
  const dirty = useEditorTabStore.getState().tabs.filter((tab) => tab.dirty)
  const saved = await Promise.all(dirty.map((tab) => saveDocument(tab.path)))
  return saved.every(Boolean)
}

async function writeDocument(path: string): Promise<boolean> {
  const document = documents.get(path)
  if (!document) return false
  if (document.readOnly) return true
  const { model } = document
  const version = model.getAlternativeVersionId()
  const { setConflict, setDeleted, setDirty } = useEditorTabStore.getState()
  try {
    const result = await window.desktop.writeTextFile(path, model.getValue(), document.base)
    // Closed (and maybe reopened as a new document) during the write: there is nothing to update.
    if (documents.get(path) !== document) return false
    if (result.status === 'changed') {
      document.disk = await window.desktop.readTextFile(path)
      if (documents.get(path) === document) setConflict(path, 'save')
      return false
    }
    document.base = result.version
  } catch (error) {
    notify({
      severity: 'error',
      title: `Couldn't save ${fileName(path)}`,
      body: mainErrorMessage(error)
    })
    return false
  }
  setDeleted(path, false)
  // Typing during the write leaves the tab dirty.
  if (model.getAlternativeVersionId() !== version) return false
  await markSaved(document)
  setDirty(path, false)
  return true
}

/** Never split a line break or a character made of two code units. */
const splitsAt = (value: string, at: number): boolean =>
  /[\r\uD800-\uDBFF]/.test(value[at - 1] ?? '')

/**
 * Replaces the model's text with `text` as one undoable edit of the part that differs, so the
 * cursor, scroll and folds outside it stay where they were.
 */
function replaceText(model: monaco.editor.ITextModel, text: string): void {
  const old = model.getValue()
  const shorter = Math.min(old.length, text.length)
  let start = 0
  while (start < shorter && old[start] === text[start]) start += 1
  let end = 0
  while (end < shorter - start && old[old.length - 1 - end] === text[text.length - 1 - end])
    end += 1
  if (start === old.length && start === text.length) return
  if (start > 0 && splitsAt(old, start)) start -= 1
  if (end > 0 && splitsAt(old, old.length - end)) end -= 1
  const range = monaco.Range.fromPositions(
    model.getPositionAt(start),
    model.getPositionAt(old.length - end)
  )
  model.pushEditOperations([], [{ range, text: text.slice(start, text.length - end) }], () => null)
}

/** The tab shows the file as it is on disk, with no unsaved edits left. */
function showDisk(path: string, document: EditorDocument, file: EditorFile): void {
  const { setConflict, setDirty, setLoad } = useEditorTabStore.getState()
  document.disk = null
  setConflict(path, null)
  if (file.kind === 'missing') return
  if (file.kind === 'binary' || (file.kind === 'large') !== document.readOnly) {
    // Now another kind of file: opened afresh.
    detachLanguageServer(path)
    releaseModel(document)
    documents.delete(path)
    setLoad(path, { status: 'loading' })
    return
  }
  replaceText(document.model, file.text)
  document.base = file.version
  void markSaved(document)
  setDirty(path, false)
}

/** Brings an open file's tab up to date after its file changed, appeared or went away on disk. */
async function refreshDocument(path: string): Promise<void> {
  const tab = tabOf(path)
  if (!tab) return
  const document = documents.get(path)
  const { setConflict, setDeleted, setLoad } = useEditorTabStore.getState()
  if (!document) {
    // A binary file has no model to keep: it is read again.
    if (tab.load.status === 'ready') setLoad(path, { status: 'loading' })
    return
  }
  const file = await window.desktop.readTextFile(path)
  if (documents.get(path) !== document) return
  setDeleted(path, file.kind === 'missing')
  const conflict = tabOf(path)?.conflict ?? null
  // The app's own save, only touched, or changed back before the user answered: nothing to ask.
  if (file.kind === 'missing' || file.version === document.base) {
    if (conflict === 'disk') {
      document.disk = null
      setConflict(path, null)
    }
    return
  }
  if (!isEdited(document)) {
    showDisk(path, document, file)
    return
  }
  document.disk = file
  setConflict(path, conflict ?? 'disk')
}

// Reloads wait for saves of the same file still running, so the app's own save isn't a change.
window.desktop.subscribeFileChanges((paths) => {
  for (const path of paths) {
    void queued(path, () => refreshDocument(path)).catch((error: unknown) =>
      console.error('Reloading a changed file failed:', error)
    )
  }
})

/** The file on disk differs from a tab's edits: keep the edits, so the next save overwrites it. */
export function keepEdits(path: string): void {
  const document = documents.get(path)
  const conflict = tabOf(path)?.conflict
  if (!document || !conflict) return
  if (document.disk && document.disk.kind !== 'missing') document.base = document.disk.version
  document.disk = null
  useEditorTabStore.getState().setConflict(path, null)
  if (conflict === 'save') void saveDocument(path)
}

/** The file on disk differs from a tab's edits: discard the edits for the file's text as it is now. */
export function loadDiskVersion(path: string): void {
  void queued(path, async () => {
    const document = documents.get(path)
    if (!document) return
    const file = await window.desktop.readTextFile(path)
    if (documents.get(path) !== document) return
    useEditorTabStore.getState().setDeleted(path, file.kind === 'missing')
    showDisk(path, document, file)
  }).catch((error: unknown) =>
    notify({
      severity: 'error',
      title: `Couldn't load ${fileName(path)}`,
      body: mainErrorMessage(error)
    })
  )
}

/** A save found the file changed on disk, and the user wants neither version yet. */
export function cancelConflict(path: string): void {
  const document = documents.get(path)
  if (document) document.disk = null
  useEditorTabStore.getState().setConflict(path, null)
}

// A model, and main's hold on the file, last as long as its tab.
useEditorTabStore.subscribe((state) => {
  for (const path of held) {
    if (state.tabs.some((tab) => tab.path === path)) continue
    detachLanguageServer(path)
    const document = documents.get(path)
    if (document) releaseModel(document)
    documents.delete(path)
    held.delete(path)
    // Main stops letting the file be written once a save still running ends, unless it was reopened.
    void (queues.get(path)?.catch(() => undefined) ?? Promise.resolve()).then(() => {
      if (held.has(path) || loading.has(path)) return
      window.desktop
        .releaseTextFile(path)
        .catch((error: unknown) => console.error('Releasing the file failed:', error))
    })
  }
})
