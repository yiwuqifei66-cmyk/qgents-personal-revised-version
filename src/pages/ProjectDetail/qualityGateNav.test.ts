import { describe, expect, it } from 'vitest'
import { projectTestsetRunPath, qualityGateNodeHref } from './qualityGateNav'
import type { MergeRequestCheck } from '@/types/task-model'

const mr = { repositoryId: 'bound-1', taskId: 'task-1' }

const testsetCheck: MergeRequestCheck = {
  id: 'ck-1',
  type: 'TESTSET',
  status: 'PASSED',
  testRunId: 'testrun-1',
  testsetId: 'testset-1',
}

const dryRunCheck: MergeRequestCheck = {
  id: 'ck-3',
  type: 'DRY_RUN',
  status: 'PASSED',
  dryRunId: 'dryrun-1',
}

describe('qualityGateNav', () => {
  it('builds a Testset run URL and opens the report tab when asked', () => {
    expect(
      projectTestsetRunPath('project-1', {
        testRunId: 'testrun-1',
        repositoryId: 'bound-1',
        testsetId: 'testset-1',
        taskId: 'task-1',
        runTab: 'report',
      }),
    ).toBe(
      '/app/projects/project-1/testset?repositoryId=bound-1&testsetId=testset-1&taskId=task-1&testRunId=testrun-1&runTab=report',
    )
  })

  it('routes Testset and Dry-run nodes, and leaves AI / CQ on this page', () => {
    expect(qualityGateNodeHref('project-1', 'TESTSET', mr, testsetCheck)).toContain('testRunId=testrun-1')
    expect(qualityGateNodeHref('project-1', 'DRY_RUN', mr, dryRunCheck, 'report')).toContain(
      'dryRunId=dryrun-1',
    )
    expect(qualityGateNodeHref('project-1', 'DRY_RUN', mr, dryRunCheck, 'report')).toContain('runTab=report')
    expect(qualityGateNodeHref('project-1', 'AI_REVIEW', mr, undefined)).toBeNull()
    expect(qualityGateNodeHref('project-1', 'CQ_PLUS_ONE', mr, undefined)).toBeNull()
  })
})
