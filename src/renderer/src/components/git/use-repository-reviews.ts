import { useEffect } from 'react'
import { useReviewStore } from '@/state/review-store'
import type { SourceControlGroup } from '../../../../shared/source-control-api'

/**
 * Reads each repository's review base and current pull request when its branch changes, and again
 * when the window gets focus: a pull request opened in the browser shows on coming back.
 */
export function useRepositoryReviews(groups: readonly SourceControlGroup[] | null): void {
  // One string, so a refresh that changes no branch reads nothing again.
  const repositories = JSON.stringify(
    (groups ?? []).flatMap((group) =>
      group.status === 'git' ? [[group.root, group.branch] as const] : []
    )
  )
  useEffect(() => {
    const parsed: unknown = JSON.parse(repositories)
    const list: unknown[] = Array.isArray(parsed) ? parsed : []
    const load = (): void => {
      for (const entry of list) {
        const pair: unknown[] = Array.isArray(entry) ? entry : []
        const [root, branch] = pair
        if (typeof root === 'string')
          void useReviewStore.getState().load(root, typeof branch === 'string' ? branch : null)
      }
    }
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [repositories])
}
