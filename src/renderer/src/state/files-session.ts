import type { FilesSession } from '../../../shared/files-session-api'
import { useEditorTabStore } from './editor-tab-store'
import {
  editorViewState,
  isEditorViewState,
  setEditorViewState,
  subscribeEditorViewStates
} from './editor-view-states'
import { useFileTreeStore } from './file-tree-store'
import { useWorkspaceStore } from './workspace-store'

/** Scrolling records many view states a second; they are sent to main once it pauses. */
const SAVE_DELAY_MS = 200

function currentSession(): FilesSession {
  const tree = useFileTreeStore.getState()
  const { tabs, activePath } = useEditorTabStore.getState()
  return {
    expanded: Object.keys(tree.expanded).filter((path) => tree.expanded[path]),
    hideIgnored: tree.hideIgnored,
    tabs: tabs.map(({ path }) => ({ path, view: editorViewState(path) ?? null })),
    activePath
  }
}

function restore(session: FilesSession): void {
  for (const { path, view } of session.tabs) {
    if (isEditorViewState(view) && !editorViewState(path)) setEditorViewState(path, view)
  }
  useEditorTabStore.getState().restore(
    session.tabs.map((tab) => tab.path),
    session.activePath
  )
  useFileTreeStore.getState().restore(session.expanded, session.hideIgnored)
}

const workspaceFile = (): string | null | undefined => useWorkspaceStore.getState().workspace?.file

/**
 * Keeps each workspace's Files view (expanded folders, open tabs and where each tab was) across
 * restarts: restores it when the workspace opens and saves it as it changes. Returns the unsubscribe.
 */
export function connectFilesSession(): () => void {
  /** The workspace whose session is shown, once restored; undefined until then, so nothing is saved. */
  let shown: string | null | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let opening = 0

  const save = (): void => {
    if (shown === undefined) return
    const workspace = shown
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      window.desktop
        .saveFilesSession(workspace, currentSession())
        .catch((error: unknown) => console.error('Saving the Files view failed:', error))
    }, SAVE_DELAY_MS)
  }

  const open = (workspace: string | null): void => {
    if (workspace === shown) return
    // The previous workspace's last changes are saved before its view is replaced.
    if (saveTimer !== undefined && shown !== undefined) {
      clearTimeout(saveTimer)
      void window.desktop.saveFilesSession(shown, currentSession()).catch(() => undefined)
    }
    shown = undefined
    const request = ++opening
    window.desktop
      .getFilesSession(workspace)
      .then((session) => {
        if (request !== opening) return
        restore(session)
      })
      .catch((error: unknown) => console.error('Restoring the Files view failed:', error))
      .finally(() => {
        if (request === opening) shown = workspace
      })
  }

  const follow = (): void => {
    const file = workspaceFile()
    if (file !== undefined) open(file)
  }
  follow()
  const unsubscribers = [
    useWorkspaceStore.subscribe(follow),
    useEditorTabStore.subscribe(save),
    useFileTreeStore.subscribe((state, previous) => {
      if (state.expanded !== previous.expanded || state.hideIgnored !== previous.hideIgnored) save()
    }),
    subscribeEditorViewStates(save)
  ]
  return () => {
    clearTimeout(saveTimer)
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
