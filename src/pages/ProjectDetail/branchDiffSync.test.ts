import { describe, expect, it } from 'vitest'
import type { ProjectBranchRow } from '@/types/codeBranch'
import type { DiffListItem } from '@/types/task-model'
import { latestDiffByRepoBranch, syncBranchesWithDiffs } from './branchDiffSync'

function branch(partial: Partial<ProjectBranchRow> & Pick<ProjectBranchRow, 'id' | 'name'>): ProjectBranchRow {
  return {
    projectRepositoryId: 'bound-1',
    protected: false,
    healthStatus: 'HEALTHY',
    relatedTask: null,
    commitCount: 0,
    diffAdditions: 99,
    diffDeletions: 9,
    mrCount: 0,
    testStatus: 'PENDING',
    ...partial,
  }
}

function diff(partial: Partial<DiffListItem> & Pick<DiffListItem, 'id' | 'sourceBranch' | 'createdAt'>): DiffListItem {
  return {
    projectId: 'project-1',
    taskId: 'task-1',
    taskRunId: 'run-1',
    taskStepId: 'step-1',
    requirementGroupId: 'group-1',
    workspaceId: 'ws-1',
    repositoryId: 'bound-1',
    baseCommit: 'base',
    headCommit: null,
    status: 'PENDING_REVIEW',
    changeStats: { files: 1, additions: 12, deletions: 3 },
    ...partial,
  }
}

describe('latestDiffByRepoBranch', () => {
  it('keeps the newest Diff for the same repository and source branch', () => {
    const map = latestDiffByRepoBranch([
      diff({ id: 'old', sourceBranch: 'feat/a', createdAt: '2026-08-10T00:00:00Z', changeStats: { files: 1, additions: 1, deletions: 0 } }),
      diff({ id: 'new', sourceBranch: 'feat/a', createdAt: '2026-08-12T00:00:00Z', changeStats: { files: 2, additions: 20, deletions: 4 } }),
    ])
    expect(map.get('bound-1\0feat/a')?.id).toBe('new')
    expect(map.get('bound-1\0feat/a')?.changeStats.additions).toBe(20)
  })
})

describe('syncBranchesWithDiffs', () => {
  it('overwrites demo +/- with Diff changeStats and zeros unmatched rows', () => {
    const rows = syncBranchesWithDiffs(
      [
        branch({ id: 'b1', name: 'feat/a', diffAdditions: 230, diffDeletions: 12 }),
        branch({ id: 'b2', name: 'main', diffAdditions: 5, diffDeletions: 1 }),
      ],
      [diff({ id: 'd1', sourceBranch: 'feat/a', createdAt: '2026-08-12T00:00:00Z', changeStats: { files: 2, additions: 12, deletions: 3 } })],
      'bound-1',
    )
    expect(rows.find((row) => row.name === 'feat/a')).toMatchObject({ diffAdditions: 12, diffDeletions: 3 })
    expect(rows.find((row) => row.name === 'main')).toMatchObject({ diffAdditions: 0, diffDeletions: 0 })
  })

  it('appends a branch row when Agent Diff has a sourceBranch not in the demo list', () => {
    const rows = syncBranchesWithDiffs(
      [branch({ id: 'b1', name: 'main' })],
      [diff({ id: 'd-new', sourceBranch: 'feat/agent-login', createdAt: '2026-08-12T00:00:00Z', changeStats: { files: 3, additions: 40, deletions: 2 } })],
      'bound-1',
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.name === 'feat/agent-login')).toMatchObject({
      diffAdditions: 40,
      diffDeletions: 2,
      projectRepositoryId: 'bound-1',
    })
  })
})
