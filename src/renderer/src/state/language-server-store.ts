import { create } from 'zustand'

/** A file's language server as the status bar shows it. */
type FileLanguageServer = {
  server: string
  state: 'starting' | 'ready' | 'restarting' | 'failed'
}

type LanguageServerState = {
  /** Open files with a language server, by path. */
  files: Record<string, FileLanguageServer>
  setFiles: (paths: Iterable<string>, status: FileLanguageServer) => void
  clearFiles: (paths: Iterable<string>) => void
}

export const useLanguageServerStore = create<LanguageServerState>((set) => ({
  files: {},
  setFiles: (paths, status) =>
    set((state) => {
      const files = { ...state.files }
      for (const path of paths) files[path] = status
      return { files }
    }),
  clearFiles: (paths) =>
    set((state) => {
      const files = { ...state.files }
      for (const path of paths) delete files[path]
      return { files }
    })
}))
