import { describe, expect, it } from 'vitest'
import { parseDiscussion } from '../git/pull-request-discussion'
import {
  appliedIds,
  conversationRoot,
  firstFile,
  type LoadedNote,
  parseNoteList,
  publishPlan,
  replyTo,
  threadRoot
} from './hunk-pull-request-notes'

// Captured from `gh api graphql` with DISCUSSION_QUERY on a throwaway pull request (github.com,
// 2026-11): a thread on a new line with a reply, one on a removed line, an outdated one, a
// resolved one, one on the whole file, a thread from a published note, two conversation comments
// (one a published reply) and five reviews without text.
const DISCUSSION = String.raw`{"data":{"repository":{"pullRequest":{"headRefOid":"0caaa86af971a2473ff63f050668ac029b982cee","comments":{"totalCount":2,"nodes":[{"databaseId":7232985258,"author":{"login":"ineersa"},"body":"QA: a conversation comment on the PR","createdAt":"2026-11-28T03:19:48Z"},{"databaseId":7233038357,"author":{"login":"ineersa"},"body":"> ineersa: QA: a conversation comment on the PR\n\nQA reply from hunk to the PR comment","createdAt":"2026-11-28T03:23:36Z"}]},"reviews":{"totalCount":5,"nodes":[{"databaseId":6095393883,"author":{"login":"ineersa"},"body":"","createdAt":"2026-11-28T03:19:35Z"},{"databaseId":6095394896,"author":{"login":"ineersa"},"body":"","createdAt":"2026-11-28T03:19:46Z"},{"databaseId":6095395018,"author":{"login":"ineersa"},"body":"","createdAt":"2026-11-28T03:19:47Z"},{"databaseId":6095406912,"author":{"login":"ineersa"},"body":"","createdAt":"2026-11-28T03:22:05Z"},{"databaseId":6095414506,"author":{"login":"ineersa"},"body":"","createdAt":"2026-11-28T03:23:35Z"}]},"reviewThreads":{"totalCount":6,"nodes":[{"isResolved":false,"path":"docs/product/vision.md","line":5,"diffSide":"RIGHT","subjectType":"LINE","comments":{"totalCount":3,"nodes":[{"databaseId":4725222043,"author":{"login":"ineersa"},"body":"QA: why drop the Orca path?","createdAt":"2026-11-28T03:19:35Z"},{"databaseId":4725222764,"author":{"login":"ineersa"},"body":"QA reply: it's a local path, meaningless to others.","createdAt":"2026-11-28T03:19:46Z"},{"databaseId":4725235923,"author":{"login":"ineersa"},"body":"QA reply from hunk to the thread","createdAt":"2026-11-28T03:23:35Z"}]}},{"isResolved":false,"path":"docs/product/vision.md","line":9,"diffSide":"LEFT","subjectType":"LINE","comments":{"totalCount":1,"nodes":[{"databaseId":4725222046,"author":{"login":"ineersa"},"body":"QA: on the removed line","createdAt":"2026-11-28T03:19:35Z"}]}},{"isResolved":false,"path":"docs/product/vision.md","line":null,"diffSide":"RIGHT","subjectType":"LINE","comments":{"totalCount":1,"nodes":[{"databaseId":4725222049,"author":{"login":"ineersa"},"body":"QA: this one goes outdated","createdAt":"2026-11-28T03:19:35Z"}]}},{"isResolved":true,"path":"docs/product/vision.md","line":9,"diffSide":"RIGHT","subjectType":"LINE","comments":{"totalCount":1,"nodes":[{"databaseId":4725222053,"author":{"login":"ineersa"},"body":"QA: this one gets resolved","createdAt":"2026-11-28T03:19:35Z"}]}},{"isResolved":false,"path":"docs/product/vision.md","line":1,"diffSide":"RIGHT","subjectType":"FILE","comments":{"totalCount":1,"nodes":[{"databaseId":4725222871,"author":{"login":"ineersa"},"body":"QA: a comment on the whole file","createdAt":"2026-11-28T03:19:47Z"}]}},{"isResolved":false,"path":"docs/product/vision.md","line":5,"diffSide":"RIGHT","subjectType":"LINE","comments":{"totalCount":1,"nodes":[{"databaseId":4725230968,"author":{"login":"ineersa"},"body":"QA from hunk: published by Hatfield","createdAt":"2026-11-28T03:22:05Z"}]}}]}}}}}`

describe('parseDiscussion', () => {
  it('keeps unresolved threads and the said conversation', () => {
    const discussion = parseDiscussion(DISCUSSION)
    expect(discussion?.head).toBe('0caaa86af971a2473ff63f050668ac029b982cee')
    expect(discussion?.threads.map((each) => [each.side, each.line, each.onFile])).toEqual([
      ['new', 5, false],
      ['old', 9, false],
      ['new', null, false],
      ['new', 1, true],
      ['new', 5, false]
    ])
    expect(discussion?.threads[0]?.comments.map((each) => each.id)).toEqual([
      4725222043, 4725222764, 4725235923
    ])
    expect(discussion?.conversation.map((each) => each.id)).toEqual([7232985258, 7233038357])
    expect(discussion?.missing).toBe(0)
  })

  it("names a deleted account's comments as GitHub does, and refuses other shapes as a whole", () => {
    // Past the first 100 threads: counted, as they weren't read.
    expect(
      parseDiscussion(
        DISCUSSION.replace('"reviewThreads":{"totalCount":6', '"reviewThreads":{"totalCount":130')
      )?.missing
    ).toBe(124)
    const ghost = parseDiscussion(DISCUSSION.replace('{"login":"ineersa"}', 'null'))
    expect(ghost?.conversation[0]?.author).toBe('ghost')
    expect(parseDiscussion(DISCUSSION.replace('"LEFT"', '"MIDDLE"'))).toBe(null)
    expect(parseDiscussion('{"data":{"repository":{"pullRequest":null}}}')).toBe(null)
    expect(parseDiscussion('{"errors":[{"message":"Could not resolve"}]}')).toBe(null)
  })
})

describe('into hunk', () => {
  const discussion = parseDiscussion(DISCUSSION)
  const [onNew, onOld, outdated, onFile] = discussion?.threads ?? []
  const path = 'docs/product/vision.md'

  it("puts a thread on its line and side, a file's on its first hunk, and an outdated one nowhere", () => {
    expect(onNew && threadRoot(onNew)).toEqual({
      filePath: path,
      newLine: 5,
      summary: 'QA: why drop the Orca path?',
      author: 'ineersa'
    })
    expect(onOld && threadRoot(onOld)).toMatchObject({ filePath: path, oldLine: 9 })
    expect(outdated && threadRoot(outdated)).toBe(null)
    expect(onFile && threadRoot(onFile)).toEqual({
      filePath: path,
      hunk: 1,
      summary: 'QA: a comment on the whole file',
      author: 'ineersa'
    })
  })

  it('marks comments on the pull request itself, and answers by note id', () => {
    const [first] = discussion?.conversation ?? []
    expect(first && conversationRoot(first, path)).toEqual({
      filePath: path,
      hunk: 1,
      summary: 'QA: a conversation comment on the PR',
      author: 'ineersa · GitHub PR Comment'
    })
    const reply = onNew?.comments[1]
    expect(reply && replyTo('mcp:1:0', reply)).toEqual({
      replyTo: 'mcp:1:0',
      summary: "QA reply: it's a local path, meaningless to others.",
      author: 'ineersa'
    })
  })

  it("reads back what hunk added and the diff's first file", () => {
    // Captured from hunk 0.25.0.
    expect(
      appliedIds(
        '{"result":{"applied":[{"commentId":"mcp:e6c176a1-ce6c-4321-8af6-3e667c658e86:0","fileId":"/r:0:a.txt","filePath":"a.txt","hunkIndex":0,"side":"new","line":2}]}}'
      )
    ).toEqual(['mcp:e6c176a1-ce6c-4321-8af6-3e667c658e86:0'])
    expect(appliedIds('{"result":{"applied":[{}]}}')).toBe(null)
    expect(
      firstFile(
        '{"session":{"sessionId":"666e","files":[{"id":"/r:0:a.txt","path":"a.txt","additions":2,"deletions":1,"hunkCount":1}]}}'
      )
    ).toBe('a.txt')
    expect(firstFile('{"session":{"files":[]}}')).toBe(null)
  })
})

describe('publishPlan', () => {
  // Shaped as hunk 0.25.0 lists them: a GitHub thread loaded by Hatfield and its reply, the user's
  // reply to it, the user's new note on a removed line with a reply of their own, a reply to an
  // agent's note, a reply to a conversation comment, and an agent's own note.
  const listed = JSON.stringify({
    comments: [
      {
        noteId: 'mcp:gh:0',
        source: 'agent',
        filePath: 'a.txt',
        hunkIndex: 0,
        newRange: [2, 2],
        body: 'Why a Map here?',
        author: 'alice'
      },
      {
        noteId: 'mcp:gh2:0',
        parentId: 'mcp:gh:0',
        source: 'agent',
        filePath: 'a.txt',
        hunkIndex: 0,
        newRange: [2, 2],
        body: 'Lookups by id.',
        author: 'bob'
      },
      {
        noteId: 'user:1',
        parentId: 'mcp:gh2:0',
        source: 'user',
        filePath: 'a.txt',
        hunkIndex: 0,
        newRange: [2, 2],
        body: 'Fair.',
        author: 'user',
        editable: true
      },
      {
        noteId: 'user:2',
        source: 'user',
        filePath: 'a.txt',
        hunkIndex: 0,
        oldRange: [2, 3],
        body: 'why uppercase?',
        author: 'user',
        editable: true
      },
      {
        noteId: 'user:3',
        parentId: 'user:2',
        source: 'user',
        filePath: 'a.txt',
        hunkIndex: 0,
        oldRange: [2, 3],
        body: 'and here',
        author: 'user',
        editable: true
      },
      {
        noteId: 'mcp:agent:0',
        source: 'agent',
        filePath: 'b.txt',
        hunkIndex: 0,
        newRange: [5, 5],
        body: 'Possible null.\n\nWhen empty.',
        author: 'pi'
      },
      {
        noteId: 'user:4',
        parentId: 'mcp:agent:0',
        source: 'user',
        filePath: 'b.txt',
        hunkIndex: 0,
        newRange: [5, 5],
        body: 'Agreed',
        author: 'user',
        editable: true
      },
      {
        noteId: 'mcp:conv:0',
        source: 'agent',
        filePath: 'a.txt',
        hunkIndex: 0,
        newRange: [1, 4],
        body: 'Mostly fine.',
        author: 'bob · GitHub PR Comment'
      },
      {
        noteId: 'user:5',
        parentId: 'mcp:conv:0',
        source: 'user',
        filePath: 'a.txt',
        hunkIndex: 0,
        newRange: [1, 4],
        body: 'Thanks',
        author: 'user',
        editable: true
      }
    ]
  })
  const loaded = new Map<string, LoadedNote>([
    ['mcp:gh:0', { kind: 'thread', commentId: 11, githubId: 11 }],
    ['mcp:gh2:0', { kind: 'thread', commentId: 11, githubId: 12 }],
    ['mcp:conv:0', { kind: 'conversation', author: 'bob', body: 'Mostly fine.', githubId: 7 }]
  ])

  it("posts only the user's notes: new threads as one review, replies where they belong", () => {
    const notes = parseNoteList(listed)
    expect(notes).not.toBe(null)
    expect(publishPlan(notes ?? [], loaded, new Set())).toEqual({
      review: [
        {
          post: {
            path: 'a.txt',
            line: 3,
            side: 'LEFT',
            start_line: 2,
            start_side: 'LEFT',
            body: 'why uppercase?\n\nand here'
          },
          noteIds: ['user:2', 'user:3']
        },
        {
          post: { path: 'b.txt', line: 5, side: 'RIGHT', body: '> Possible null.\n\nAgreed' },
          noteIds: ['user:4']
        }
      ],
      replies: [{ post: { commentId: 11, body: 'Fair.' }, noteIds: ['user:1'] }],
      conversation: [{ post: '> bob: Mostly fine.\n\nThanks', noteIds: ['user:5'] }],
      unplaced: 0
    })
  })

  it('posts nothing when the user wrote nothing', () => {
    const agentsOnly = parseNoteList(
      '{"comments":[{"noteId":"mcp:gh:0","source":"agent","filePath":"a.txt","hunkIndex":0,"newRange":[2,2],"body":"x"}]}'
    )
    expect(publishPlan(agentsOnly ?? [], loaded, new Set())).toEqual({
      review: [],
      replies: [],
      conversation: [],
      unplaced: 0
    })
    expect(parseNoteList('No live comments.')).toBe(null)
  })

  it('never posts a note twice, and counts the empty ones it leaves', () => {
    // user:2 was posted, but hunk kept it: an agent replied under it. The user answered again.
    const kept = parseNoteList(
      JSON.stringify({
        comments: [
          {
            noteId: 'user:2',
            source: 'user',
            filePath: 'a.txt',
            hunkIndex: 0,
            newRange: [2, 2],
            body: 'why uppercase?'
          },
          {
            noteId: 'mcp:agent:1',
            parentId: 'user:2',
            source: 'agent',
            filePath: 'a.txt',
            hunkIndex: 0,
            newRange: [2, 2],
            body: 'Style guide.'
          },
          {
            noteId: 'user:6',
            parentId: 'mcp:agent:1',
            source: 'user',
            filePath: 'a.txt',
            hunkIndex: 0,
            newRange: [2, 2],
            body: 'Which one?'
          },
          {
            noteId: 'user:7',
            source: 'user',
            filePath: 'a.txt',
            hunkIndex: 0,
            newRange: [3, 3],
            body: '  '
          }
        ]
      })
    )
    expect(publishPlan(kept ?? [], loaded, new Set(['user:2']))).toEqual({
      review: [
        {
          post: { path: 'a.txt', line: 2, side: 'RIGHT', body: '> Style guide.\n\nWhich one?' },
          noteIds: ['user:6']
        }
      ],
      replies: [],
      conversation: [],
      unplaced: 1
    })
  })
})
