import type { WebContents } from 'electron'
import { isPlainObject } from '../../shared/plain-object'
import { SEARCH_CHANNELS, type SearchEvent, type SearchQuery } from '../../shared/search-api'
import { fileRoots } from '../files/file-roots'
import { resolveInsideRoots } from '../files/path-containment'
import { startRipgrep } from '../search/ripgrep-search'
import { SearchRuns } from '../search/search-runs'
import { handleTrusted } from './trusted-ipc'

/** Longer than any search box holds; a longer query is a bug or abuse. */
const MAX_TEXT = 10_000
/** More folders than anyone selects in the tree. */
const MAX_SCOPE = 500

function parseQuery(value: unknown): SearchQuery {
  if (!isPlainObject(value)) throw new Error('Expected a search query')
  const { text, regex, matchCase, wholeWord, fileMask, includeNonProject, scope } = value
  if (typeof text !== 'string' || text === '' || text.length > MAX_TEXT) {
    throw new Error('Expected search text')
  }
  if (
    typeof regex !== 'boolean' ||
    typeof matchCase !== 'boolean' ||
    typeof wholeWord !== 'boolean' ||
    typeof includeNonProject !== 'boolean'
  ) {
    throw new Error('Expected search options')
  }
  if (typeof fileMask !== 'string' || fileMask.length > MAX_TEXT) {
    throw new Error('Expected a file mask')
  }
  if (
    !Array.isArray(scope) ||
    scope.length > MAX_SCOPE ||
    !scope.every((path): path is string => typeof path === 'string' && path !== '')
  ) {
    throw new Error('Expected a list of folders')
  }
  return { text, regex, matchCase, wholeWord, fileMask, includeNonProject, scope }
}

/** Where to search: the chosen folders once each is known to be inside the workspace, or every root. */
async function searchPaths(scope: string[]): Promise<string[]> {
  const roots = (await fileRoots.current()).map((root) => root.path)
  if (scope.length === 0) return roots
  for (const path of scope) {
    if ((await resolveInsideRoots(path, roots)) === null) {
      throw new Error(`${path} is not inside the workspace`)
    }
  }
  return scope
}

export function registerSearchIpc(): void {
  const runs = new SearchRuns<WebContents>()

  handleTrusted(SEARCH_CHANNELS.start, async (event, id, value) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('Expected a search id')
    const query = parseQuery(value)
    const sender = event.sender
    if (!runs.knows(sender)) sender.once('destroyed', () => runs.forget(sender))
    const send = (message: SearchEvent): void => {
      if (!sender.isDestroyed()) sender.send(SEARCH_CHANNELS.event, message)
    }
    await runs.start(sender, id, searchPaths(query.scope), (paths, finished) => {
      if (paths.length === 0) {
        send({ id, kind: 'done', limited: false, error: null })
        return () => {}
      }
      return startRipgrep(query, paths, {
        results: (files) => send({ id, kind: 'results', files }),
        done: (limited, error) => {
          finished()
          send({ id, kind: 'done', limited, error })
        }
      })
    })
  })

  handleTrusted(SEARCH_CHANNELS.cancel, (event) => runs.cancel(event.sender))
}
