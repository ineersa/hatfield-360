import { CircleAlert, Eye, FileX, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/class-names'
import { appCommandForKey, appShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { type EditorTab, useEditorTabStore } from '@/state/editor-tab-store'
import { CodeEditor } from './CodeEditor'
import { loadDocument, saveDocument } from './editor-documents'
import { fileName, type TabLabel, tabLabels } from './editor-tab-labels'
import { EDITOR_FILE_LIMITS } from '../../../../shared/editor-api'
import { isDependencyFile } from '../../../../shared/dependency-folders'
import { ExternalChangeDialog } from './ExternalChangeDialog'
import { isMarkdown, MarkdownPreview } from './MarkdownPreview'

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function TabStatus({ tab }: { tab: EditorTab }): React.JSX.Element | null {
  if (tab.load.status === 'loading') {
    return <p className="type-description m-auto">Loading…</p>
  }
  if (tab.load.status === 'ready' && tab.load.file === 'binary') {
    return (
      <div
        role="status"
        className="m-auto flex max-w-md flex-col items-center gap-3 p-8 text-center"
      >
        <FileX
          className="size-empty-state-icon text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <p className="type-description">
          {fileName(tab.path)} is a binary file ({fileSize(tab.load.size)}), not shown.
        </p>
      </div>
    )
  }
  if (tab.load.status === 'error') {
    return (
      <div
        role="alert"
        className="m-auto flex max-w-md flex-col items-center gap-3 p-8 text-center"
      >
        <CircleAlert className="size-empty-state-icon text-error" strokeWidth={1.5} aria-hidden />
        <p className="type-description">
          Couldn't open {fileName(tab.path)}: {tab.load.message}
        </p>
        <button
          type="button"
          onClick={() => void loadDocument(tab.path)}
          className="type-button flex h-control items-center rounded-button border border-button-border bg-button px-3.5 text-button-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }
  return null
}

function Tab({
  tab,
  label,
  active,
  dragging,
  onActivate,
  onClose,
  onDragStart,
  onDragOver,
  onDragEnd
}: {
  tab: EditorTab
  label: TabLabel
  active: boolean
  dragging: boolean
  onActivate: () => void
  onClose: () => void
  onDragStart: () => void
  onDragOver: () => boolean
  onDragEnd: () => void
}): React.JSX.Element {
  const keymap = useKeymapStore((state) => state.shell)
  const title = label.folder ? `${label.name} ${label.folder}` : label.name
  const state = [tab.dirty && 'unsaved', tab.deleted && 'deleted on disk'].filter(Boolean)
  return (
    <div
      draggable
      data-path={tab.path}
      data-dirty={tab.dirty || undefined}
      data-deleted={tab.deleted || undefined}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', tab.path)
        onDragStart()
      }}
      onDragOver={(event) => {
        if (onDragOver()) event.preventDefault()
      }}
      onDrop={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      // Middle click closes, as in IDEs and browsers.
      onAuxClick={(event) => {
        if (event.button === 1) onClose()
      }}
      className={cn(
        'type-tab group flex max-w-60 min-w-0 shrink-0 items-stretch border-r border-separator select-none',
        active
          ? 'bg-island text-foreground'
          : 'text-muted-foreground hover:bg-tab-hover hover:text-foreground',
        dragging && 'opacity-50'
      )}
    >
      {/* The whole tab box selects it, not just its text. */}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={[title, ...state].join(', ')}
        title={tab.deleted ? `${tab.path} (deleted on disk)` : tab.path}
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-center gap-2 pr-2 pl-3 outline-none focus-visible:underline"
      >
        <FileTreeIcon kind="file" name={label.name} className="size-4 shrink-0" />
        <span className={cn('truncate', tab.deleted && 'line-through')}>{label.name}</span>
        {label.folder ? <span className="type-hint truncate">{label.folder}</span> : null}
      </button>
      <button
        type="button"
        aria-label={`Close ${title}`}
        title={`Close (${appShortcutLabel(keymap, 'close-editor-tab')})`}
        onClick={onClose}
        className={cn(
          'group/close flex shrink-0 items-center pr-2 text-muted-foreground hover:text-foreground focus-visible:opacity-100',
          active || tab.dirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <span className="flex size-5 items-center justify-center rounded-button group-hover/close:bg-hover">
          {/* An unsaved tab shows a dot where its close button is, until the pointer is over it. */}
          {tab.dirty ? (
            <>
              <span className="size-2 rounded-full bg-foreground group-hover:hidden" aria-hidden />
              <X className="hidden size-3.5 group-hover:block" aria-hidden />
            </>
          ) : (
            <X className="size-3.5" aria-hidden />
          )}
        </span>
      </button>
    </div>
  )
}

/** Editor tabs in the Files view: a tab strip over the active file's editor. */
export function EditorTabs({ hidden }: { hidden: boolean }): React.JSX.Element {
  const tabs = useEditorTabStore((state) => state.tabs)
  const activePath = useEditorTabStore((state) => state.activePath)
  const activate = useEditorTabStore((state) => state.activate)
  const move = useEditorTabStore((state) => state.move)
  const close = useEditorTabStore((state) => state.close)
  const togglePreview = useEditorTabStore((state) => state.togglePreview)
  const [closing, setClosing] = useState<string | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const labels = useMemo(() => tabLabels(tabs.map((tab) => tab.path)), [tabs])
  const active = tabs.find((tab) => tab.path === activePath)
  const activeFile = active?.load.status === 'ready' ? active.load : null
  const showsText = activeFile !== null && activeFile.file !== 'binary'
  const canPreview = active !== undefined && showsText && isMarkdown(active.path)
  const previewing = canPreview && active.preview

  useEffect(() => {
    for (const tab of tabs) if (tab.load.status === 'loading') void loadDocument(tab.path)
  }, [tabs])

  // File > Save; the editor handles the shortcut itself while it has the keys.
  useEffect(
    () =>
      window.desktop.subscribeSaveCommand(() => {
        const path = useEditorTabStore.getState().activePath
        if (!hidden && path) void saveDocument(path)
      }),
    [hidden]
  )

  const requestClose = (tab: EditorTab): void => {
    if (tab.dirty) setClosing(tab.path)
    else close(tab.path)
  }

  // Close Tab and Select Next/Previous Tab, after the editor and other controls had the key.
  // Terminals share some of these keys; they act only while on screen, and never are with the editor.
  useEffect(() => {
    if (hidden) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const command = appCommandForKey(event, useKeymapStore.getState().shell)
      const state = useEditorTabStore.getState()
      const index = state.tabs.findIndex((tab) => tab.path === state.activePath)
      const tab = state.tabs[index]
      if (!tab) return
      if (command === 'close-editor-tab') {
        if (tab.dirty) setClosing(tab.path)
        else state.close(tab.path)
      } else if (command === 'next-editor-tab' || command === 'previous-editor-tab') {
        const step = command === 'next-editor-tab' ? 1 : -1
        const next = state.tabs.at((index + step) % state.tabs.length)
        if (next) state.activate(next.path)
        setFocusRequest((count) => count + 1)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hidden])
  const closingName = closing ? fileName(closing) : ''

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-island" hidden={hidden}>
      <div className="flex h-tab-bar shrink-0 items-stretch bg-frame shadow-[inset_0_-1px_0_var(--separator)]">
        <div
          role="tablist"
          aria-label="Editor tabs"
          className="flex min-w-0 items-stretch overflow-x-auto"
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.path}
              tab={tab}
              label={labels.get(tab.path) ?? { name: fileName(tab.path) }}
              active={tab.path === activePath}
              dragging={tab.path === dragged}
              onActivate={() => {
                activate(tab.path)
                setFocusRequest((count) => count + 1)
              }}
              onClose={() => requestClose(tab)}
              onDragStart={() => setDragged(tab.path)}
              onDragOver={() => {
                if (dragged === null) return false
                if (dragged !== tab.path) move(dragged, tab.path)
                return true
              }}
              onDragEnd={() => setDragged(null)}
            />
          ))}
        </div>
        {canPreview ? (
          <button
            type="button"
            aria-pressed={active.preview}
            aria-label="Preview"
            title={active.preview ? 'Show the Markdown source' : 'Preview the rendered Markdown'}
            onClick={() => togglePreview(active.path)}
            className={cn(
              'my-auto mr-1.5 ml-auto flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active.preview && 'bg-pressed text-foreground'
            )}
          >
            <Eye className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-island">
        {active ? <TabStatus tab={active} /> : null}
        {active && activeFile?.file === 'large' ? (
          <p
            role="status"
            className="type-description mx-2 mt-2 rounded-banner border border-warning-border bg-warning-background px-3 py-1.5"
          >
            {fileName(active.path)} is {fileSize(activeFile.size)}: only its first{' '}
            {fileSize(EDITOR_FILE_LIMITS.editable)} are shown, read-only.
          </p>
        ) : null}
        {previewing ? <MarkdownPreview path={active.path} /> : null}
        {active ? (
          <CodeEditor
            path={active.path}
            ready={showsText}
            readOnly={
              activeFile?.file === 'large' ||
              activeFile?.outside === true ||
              isDependencyFile(active.path)
            }
            hidden={hidden || previewing}
            focusRequest={focusRequest}
          />
        ) : null}
      </div>
      <ExternalChangeDialog hidden={hidden} />
      <AlertDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Save changes to {closingName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes will be lost if you close the tab without saving them.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogAction
              className="mr-auto"
              onClick={() => {
                if (closing) close(closing)
              }}
            >
              Don't Save
            </AlertDialogAction>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              primary
              autoFocus
              onClick={() => {
                const path = closing
                // Closed only once the file holds the tab's text: edits made while saving stay open.
                if (path) void saveDocument(path).then((saved) => saved && close(path))
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
