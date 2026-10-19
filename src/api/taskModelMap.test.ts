import { describe, expect, it } from 'vitest'
import {
  mapDiffComment,
  mapDiffFile,
  mapMergeRequest,
  mapMergeRequestChecks,
  mapMergeRequestCommitList,
  mapMergeRequestCqReviews,
  mapTaskPreflightList,
} from './taskModelMap'

describe('task model Diff / MR mapping', () => {
  it('maps DiffFileResponse changeType and leaves hunks empty when absent', () => {
    const file = mapDiffFile({
      id: 'file-1',
      sequence: 2,
      path: 'src/a.ts',
      changeType: 'ADDED',
      additions: 3,
      deletions: 0,
      binary: false,
    })
    expect(file).toMatchObject({
      id: 'file-1',
      sequence: 2,
      changeType: 'ADDED',
      status: 'ADDED',
      hunks: [],
    })
  })

  it('maps backend hunk structure (header object + type/oldLineNo/newLineNo/content lines)', () => {
    const file = mapDiffFile({
      id: 'file-1',
      sequence: 1,
      path: 'src/a.ts',
      changeType: 'MODIFIED',
      additions: 2,
      deletions: 1,
      binary: false,
      hunks: [
        {
          header: { oldStart: 10, newStart: 10, oldLines: 3, newLines: 4 },
          lines: [
            { type: 'CONTEXT', oldLineNo: 10, newLineNo: 10, content: 'const x = 1' },
            { type: 'DELETE', oldLineNo: 11, newLineNo: null, content: 'const y = 2' },
            { type: 'ADD', oldLineNo: null, newLineNo: 11, content: 'const z = 3' },
            { type: 'ADD', oldLineNo: null, newLineNo: 12, content: 'const w = 4' },
          ],
        },
      ],
    })
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0].header).toBe('@@ -10,3 +10,4 @@')
    expect(file.hunks[0].lines).toEqual([
      { kind: 'CONTEXT', oldLine: 10, newLine: 10, text: 'const x = 1' },
      { kind: 'DEL', oldLine: 11, newLine: null, text: 'const y = 2' },
      { kind: 'ADD', oldLine: null, newLine: 11, text: 'const z = 3' },
      { kind: 'ADD', oldLine: null, newLine: 12, text: 'const w = 4' },
    ])
  })

  it('still maps legacy frontend hunk shape (string header + kind/oldLine/newLine/text)', () => {
    const file = mapDiffFile({
      id: 'file-1',
      sequence: 1,
      path: 'src/a.ts',
      changeType: 'MODIFIED',
      additions: 1,
      deletions: 1,
      binary: false,
      hunks: [
        { id: 'hunk-a', header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'ADD', oldLine: null, newLine: 1, text: 'x' }] },
      ],
    })
    expect(file.hunks[0].header).toBe('@@ -1,1 +1,1 @@')
    expect(file.hunks[0].lines[0]).toEqual({ kind: 'ADD', oldLine: null, newLine: 1, text: 'x' })
  })

  it('maps DiffCommentResponse authorUserId without inventing authorName', () => {
    const comment = mapDiffComment({
      id: 'c1',
      diffId: 'd1',
      path: 'src/a.ts',
      side: 'RIGHT',
      line: 12,
      body: 'looks good',
      authorUserId: 'user-002',
      createdAt: '2026-08-15T00:00:00Z',
    })
    expect(comment.authorUserId).toBe('user-002')
    expect(comment.authorName).toBeNull()
    expect(comment.createdAt).toBe('2026-08-15T00:00:00Z')
  })

  it('maps MR checks as a flat array and also accepts a wrapped items payload', () => {
    expect(
      mapMergeRequestChecks([
        { id: 'ck-1', type: 'TESTSET', status: 'PASSED', attemptNo: 1, testRunId: 'testrun-1' },
        { id: 'ck-2', type: 'CR_BLOCKING_COMMENTS', status: 'FAILED' },
      ]),
    ).toMatchObject([{ type: 'TESTSET', testRunId: 'testrun-1' }])

    expect(
      mapMergeRequestChecks({
        status: 'PENDING',
        requiredChecks: ['TESTSET'],
        items: [{ id: 'ck-1', name: 'DRY_RUN', status: 'PENDING' }],
      }).map((item) => item.type),
    ).toEqual(['DRY_RUN'])
  })

  it('maps MR summary aliases and treats missing webUrl / description / groupIds as empty', () => {
    const mr = mapMergeRequest({
      id: 'mr-1',
      projectRepositoryId: 'bound-1',
      provider: 'GITHUB',
      number: 42,
      title: '实现邮箱登录',
      sourceBranch: 'feat/login-api',
      targetBranch: 'main',
      status: 'OPEN',
      headCommit: 'abc',
      taskId: 'task-1',
      qualityGate: { status: 'PENDING', requiredChecks: ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'] },
    })
    expect(mr.repositoryId).toBe('bound-1')
    expect(mr.webUrl).toBeNull()
    expect(mr.description).toBeNull()
    expect(mr.groupIds).toEqual([])
    expect(mr.taskId).toBe('task-1')
  })

  it('maps optional CQ reviewer fields from aliases or a nested reviewer object', () => {
    expect(
      mapMergeRequestChecks([
        {
          id: 'ck-4',
          type: 'CQ_PLUS_ONE',
          status: 'PASSED',
          commitSha: 'abc1234',
          reviewedBy: { id: 'user-9', displayName: '审同学' },
          reviewReason: 'LGTM',
          completedAt: '2026-08-17T08:00:00Z',
        },
      ]),
    ).toMatchObject([
      {
        type: 'CQ_PLUS_ONE',
        reviewedByUserId: 'user-9',
        reviewedByName: '审同学',
        reviewReason: 'LGTM',
        commitSha: 'abc1234',
      },
    ])
  })

  it('maps CQ review history and ignores non-CQ review rows', () => {
    expect(
      mapMergeRequestCqReviews({
        items: [
          { id: 'ai-1', kind: 'AI_REVIEW', status: 'PASSED' },
          {
            id: 'cq-1',
            kind: 'CQ',
            decision: 'APPROVED',
            reviewedByName: '审同学',
            reason: 'LGTM',
            createdAt: '2026-08-17T08:00:00Z',
            commitSha: 'abc1234',
          },
          {
            id: 'cq-2',
            type: 'CQ_PLUS_ONE',
            status: 'REJECTED',
            reviewerName: '王同学',
            reviewReason: '缺测试',
            completedAt: '2026-08-17T09:00:00Z',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'cq-1',
        decision: 'APPROVED',
        reviewerName: '审同学',
        reason: 'LGTM',
        createdAt: '2026-08-17T08:00:00Z',
        commitSha: 'abc1234',
      },
      {
        id: 'cq-2',
        decision: 'REJECTED',
        reviewerName: '王同学',
        reason: '缺测试',
        createdAt: '2026-08-17T09:00:00Z',
        commitSha: null,
      },
    ])
  })

  it('maps MR commit list with totalCount and author aliases', () => {
    expect(
      mapMergeRequestCommitList({
        totalCount: 2,
        items: [
          {
            sha: 'a81f3c2',
            message: 'feat(login): 实现登录接口与 JWT 鉴权',
            author: { id: 'u1', displayName: '陈同学' },
            committedAt: '2026-08-17T10:00:00Z',
          },
          {
            commitSha: 'b47d9e1',
            title: 'refactor: 优化校验逻辑与异常处理',
            authorName: '李同学',
            authoredAt: '2026-08-17T08:00:00Z',
          },
        ],
      }),
    ).toEqual({
      totalCount: 2,
      items: [
        {
          sha: 'a81f3c2',
          message: 'feat(login): 实现登录接口与 JWT 鉴权',
          authorName: '陈同学',
          authorUserId: 'u1',
          committedAt: '2026-08-17T10:00:00Z',
        },
        {
          sha: 'b47d9e1',
          message: 'refactor: 优化校验逻辑与异常处理',
          authorName: '李同学',
          authorUserId: null,
          committedAt: '2026-08-17T08:00:00Z',
        },
      ],
    })
  })

  it('maps the task preflight endpoint when the backend returns a bare array', () => {
    const result = mapTaskPreflightList([
      {
        taskId: 'task-1',
        repositoryId: 'repo-1',
        sourceBranch: 'feat/task-1',
        targetBranch: 'main',
        headCommit: 'head-1',
        targetCommit: 'base-1',
        status: 'WAITING_CQ',
        dryRunId: 'dry-1',
        failureCode: null,
        failureReason: null,
        coveredTaskIds: ['task-1', 'task-2'],
        coveredDiffIds: ['diff-1', 'diff-2'],
      },
      {
        taskId: 'task-1',
        repositoryId: 'repo-2',
        status: 'FAILED',
        failureCode: 'GIT_STORE_SYNC_FAILED',
        failureReason: '同步失败',
      },
    ])

    expect(result.taskId).toBe('task-1')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      repositoryId: 'repo-1',
      dryRunStatus: 'PASSED',
      cqStatus: 'PENDING',
      dryRunId: 'dry-1',
    })
    expect(result.items[1]).toMatchObject({
      repositoryId: 'repo-2',
      dryRunStatus: 'FAILED',
      failureCode: 'GIT_STORE_SYNC_FAILED',
    })
  })

  it('keeps compatibility with the wrapped items response shape', () => {
    const result = mapTaskPreflightList({
      taskId: 'task-2',
      items: [{ repositoryId: 'repo-1', status: 'MR_CREATED' }],
    })

    expect(result).toMatchObject({
      taskId: 'task-2',
      totalCount: 1,
      items: [{ repositoryId: 'repo-1', dryRunStatus: 'PASSED', cqStatus: 'APPROVED' }],
    })
  })

  it('uses nested CQ and Dry Run facts returned by the preflight endpoint', () => {
    const result = mapTaskPreflightList({
      taskId: 'task-3',
      items: [{
        repositoryId: 'repo-1',
        status: 'CREATING_MR',
        dryRun: { status: 'PASSED' },
        cqPlusOne: { status: 'APPROVED', reviewerUserId: 'reviewer-1' },
      }],
    })

    expect(result.items[0]).toMatchObject({
      dryRunStatus: 'PASSED',
      cqStatus: 'APPROVED',
      cqReviewerUserId: 'reviewer-1',
    })
  })
})
