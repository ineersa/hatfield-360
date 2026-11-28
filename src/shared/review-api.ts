/** An open pull request of a repository's GitHub remote. */
export type PullRequest = {
  number: number
  title: string
  /** The author's login. */
  author: string
  /** The branch it merges (`headRefName`). */
  branch: string
  draft: boolean
  url: string
}

/** A repository's `origin` on GitHub (github.com or a `<tenant>.ghe.com` host). */
export type GitHubRemote = { host: string; owner: string; repo: string }

/** What a repository offers to review beyond its uncommitted changes. */
export type RepositoryReview = {
  /** The branch Review Branch compares with: `origin/HEAD`, else `origin/main`, `origin/master`, `main`, `master`; null when none exists. */
  base: string | null
  /** Null without a GitHub `origin`: no pull request actions then. */
  github: GitHubRemote | null
  /** The current branch's open pull request; null when it has none, or `gh` can't say. */
  pullRequest: PullRequest | null
}

/** The open pull requests, or why `gh` couldn't list them. */
export type PullRequestList =
  | { status: 'listed'; pullRequests: PullRequest[] }
  /** No `gh` on the user's shell PATH. */
  | { status: 'no-gh' }
  /** `gh` isn't signed in to the remote's host. */
  | { status: 'signed-out'; host: string }
  | { status: 'failed'; output: string }

export const REVIEW_CHANNELS = {
  repository: 'review:repository',
  pullRequests: 'review:pull-requests'
} as const

export type ReviewApi = {
  /** The review base, GitHub remote and current pull request of the repository at `root`, read now. */
  repositoryReview: (root: string) => Promise<RepositoryReview>
  /** The open pull requests of the repository's GitHub remote, through the user's `gh`. */
  listPullRequests: (root: string) => Promise<PullRequestList>
}
