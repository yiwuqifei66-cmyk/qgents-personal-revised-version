import { describe, expect, it } from 'vitest'
import { mapWorkBranch } from '@/api/workBranches'

describe('mapWorkBranch', () => {
  it('maps the frozen work-branch shape and tolerates null nests', () => {
    const mapped = mapWorkBranch({
      id: 'wb-1',
      projectRepositoryId: 'bound-1',
      name: 'feat/a',
      workspaceId: 'ws-1',
      lastKnownHead: 'abc',
      latestTask: { id: 't1', displayCode: 'T-1', title: 'Login' },
      requirementGroups: [{ id: 'g1', title: 'Login' }],
      latestDiff: {
        id: 'd1',
        taskId: 't1',
        status: 'PENDING_REVIEW',
        changeStats: { additions: 2, deletions: 1 },
      },
      openMergeRequest: null,
      lastVerification: {
        kind: 'TEST_RUN',
        status: 'PASSED',
        commitSha: 'abc',
        completedAt: '2026-08-17T12:00:00Z',
      },
    })
    expect(mapped).toMatchObject({
      id: 'wb-1',
      projectRepositoryId: 'bound-1',
      name: 'feat/a',
      latestDiff: { id: 'd1', taskId: 't1', changeStats: { additions: 2, deletions: 1 } },
      lastVerification: { kind: 'TEST_RUN', status: 'PASSED' },
      openMergeRequest: null,
    })
  })

  it('maps latestTask.finalDiff null without clearing latestDiff', () => {
    const mapped = mapWorkBranch({
      projectRepositoryId: 'bound-1',
      name: 'feat/a',
      latestTask: { id: 't2', displayCode: 'T-2', title: 'Next', finalDiff: null },
      requirementGroups: [],
      latestDiff: { id: 'd-old', taskId: 't1', status: 'ACCEPTED', changeStats: { additions: 1, deletions: 0 } },
      openMergeRequest: null,
      lastVerification: null,
    })
    expect(mapped?.latestTask?.finalDiff).toBeNull()
    expect(mapped?.latestDiff?.id).toBe('d-old')
    expect(mapped?.latestDiff?.taskId).toBe('t1')
  })

  it('accepts repositoryId as an alias for projectRepositoryId', () => {
    const mapped = mapWorkBranch({
      repositoryId: 'bound-2',
      name: 'feat/b',
      latestTask: null,
      requirementGroups: [],
      latestDiff: null,
      openMergeRequest: null,
      lastVerification: null,
    })
    expect(mapped?.projectRepositoryId).toBe('bound-2')
  })
})
