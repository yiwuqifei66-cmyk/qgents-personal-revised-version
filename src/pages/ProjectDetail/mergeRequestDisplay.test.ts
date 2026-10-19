import { describe, expect, it } from 'vitest'
import type { MergeRequestSummary } from '@/types/task-model'
import { findOpenMergeRequestForDiff, githubPullRequestUrl } from './mergeRequestDisplay'

const review = {
  repositoryId: 'bound-1',
  sourceBranch: 'feat/login',
  taskId: 'task-1',
}

function mr(partial: Partial<MergeRequestSummary>): MergeRequestSummary {
  return {
    id: 'mr-1',
    repositoryId: 'bound-1',
    groupIds: [],
    provider: 'GITHUB',
    number: 10,
    title: 'demo',
    sourceBranch: 'feat/login',
    targetBranch: 'main',
    status: 'OPEN',
    headCommit: 'abc',
    webUrl: null,
    taskId: 'task-1',
    ...partial,
    createMode: partial.createMode ?? 'UNKNOWN',
  }
}

describe('githubPullRequestUrl', () => {
  it('prefers the backend webUrl', () => {
    expect(
      githubPullRequestUrl('https://github.com/org/repo/pull/3', 99, {
        fullName: 'other/repo',
        githubUrl: 'https://github.com/other/repo',
      }),
    ).toBe('https://github.com/org/repo/pull/3')
  })

  it('builds from githubUrl when webUrl is missing', () => {
    expect(
      githubPullRequestUrl(null, 18, {
        githubUrl: 'https://github.com/mock/auth-service/',
        fullName: 'ignored/name',
      }),
    ).toBe('https://github.com/mock/auth-service/pull/18')
  })

  it('builds from fullName when githubUrl is also missing', () => {
    expect(githubPullRequestUrl(undefined, 7, { fullName: 'mock/web' })).toBe(
      'https://github.com/mock/web/pull/7',
    )
  })

  it('returns null when there is no repo identity', () => {
    expect(githubPullRequestUrl(null, 7, { fullName: 'auth-service' })).toBeNull()
  })
})

describe('findOpenMergeRequestForDiff', () => {
  it('prefers the OPEN MR with the same taskId and the highest number', () => {
    const found = findOpenMergeRequestForDiff(
      [
        mr({ id: 'mr-old', number: 3, taskId: 'task-1' }),
        mr({ id: 'mr-new', number: 12, taskId: 'task-1' }),
        mr({ id: 'mr-other-task', number: 99, taskId: 'task-2' }),
        mr({ id: 'mr-closed', number: 20, status: 'MERGED', taskId: 'task-1' }),
      ],
      review,
    )
    expect(found?.id).toBe('mr-new')
  })

  it('falls back to repository and source branch when list items omit taskId', () => {
    const found = findOpenMergeRequestForDiff(
      [mr({ id: 'mr-branch', taskId: null, number: 4 })],
      review,
    )
    expect(found?.id).toBe('mr-branch')
  })
})
