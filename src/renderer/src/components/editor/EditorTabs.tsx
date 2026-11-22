import { CircleAlert, X } from 'lucide-react'
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
import { type EditorTab, useEditorTabStore } from '@/state/editor-tab-store'
import { CodeEditor } from './CodeEditor'
import { loadDocument, saveDocument } from './editor-documents'
import { fileName, type TabLabel, tabLabels } from './editor-tab-labels'

function TabStatus({ tab }: { tab: EditorTab }): React.JSX.Element | null {
  if (tab.load.status === 'loading') {
    return <p className="type-description m-auto">Loading…</p>
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
  const title = label.folder ? `${label.name} ${label.folder}` : label.name
  return (
    <div
      draggable
      data-path={tab.path}
      data-dirty={tab.dirty || undefined}
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
        'type-tab group flex max-w-60 min-w-0 shrink-0 items-center gap-2 border-r border-separator pr-2 pl-3 select-none',
        active
          ? 'bg-island text-foreground'
          : 'text-muted-foreground hover:bg-tab-hover hover:text-foreground',
        dragging && 'opacity-50'
      )}
    >
      <FileTreeIcon kind="file" name={label.name} className="size-4 shrink-0" />
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={tab.dirty ? `${title}, unsaved` : title}
        title={tab.path}
        onClick={onActivate}
        className="flex min-w-0 items-baseline gap-1.5 outline-none focus-visible:underline"
      >
        <span className="truncate">{label.name}</span>
        {label.folder ? <span className="type-hint truncate">{label.folder}</span> : null}
      </button>
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:opacity-100',
          active || tab.dirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        {/* An unsaved tab shows a dot where its close button is, until the pointer is over it. */}
        {tab.dirty ? (
          <>
            <span className="size-2 rounded-full bg-foreground group-hover:hidden" aria-hidden />
            <X className="hidden size-3.5 group-hover:block" aria-hidden />
          </>
        ) : (
          <X className="size-3.5" aria-hidden />
        )}
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
  const [closing, setClosing] = useState<string | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const labels = useMemo(() => tabLabels(tabs.map((tab) => tab.path)), [tabs])
  const active = tabs.find((tab) => tab.path === activePath)

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
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-island">
        {active ? <TabStatus tab={active} /> : null}
        {active ? (
          <CodeEditor
            path={active.path}
            ready={active.load.status === 'ready'}
            hidden={hidden}
            focusRequest={focusRequest}
          />
        ) : null}
      </div>
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
