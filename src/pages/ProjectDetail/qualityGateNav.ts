import { PATHS } from '@/routes/paths'
import type { MergeRequestCheck, MergeRequestCheckName, MergeRequestSummary } from '@/types/task-model'

export type TestsetRunTab = 'overview' | 'cases' | 'conflicts' | 'report'

export function isTestsetRunTab(value: string | null | undefined): value is TestsetRunTab {
  return value === 'overview' || value === 'cases' || value === 'conflicts' || value === 'report'
}

/** 拼 Testset 页 URL，带上运行 id 和要打开的 Tab */
export function projectTestsetRunPath(
  projectId: string,
  query: {
    testRunId?: string | null
    dryRunId?: string | null
    repositoryId?: string | null
    testsetId?: string | null
    taskId?: string | null
    runTab?: TestsetRunTab
  },
): string {
  const params = new URLSearchParams()
  if (query.repositoryId) params.set('repositoryId', query.repositoryId)
  if (query.testsetId) params.set('testsetId', query.testsetId)
  if (query.taskId) params.set('taskId', query.taskId)
  if (query.testRunId) params.set('testRunId', query.testRunId)
  if (query.dryRunId) params.set('dryRunId', query.dryRunId)
  if (query.runTab && query.runTab !== 'overview') params.set('runTab', query.runTab)
  const qs = params.toString()
  return qs ? `${PATHS.projectTestset(projectId)}?${qs}` : PATHS.projectTestset(projectId)
}

/**
 * 门禁节点跳转：Testset / Dry-run 进 Testset 页对应运行。
 * AI Review、CQ+1 本轮没有独立页，返回 null。
 */
export function qualityGateNodeHref(
  projectId: string,
  name: MergeRequestCheckName,
  mr: Pick<MergeRequestSummary, 'repositoryId' | 'taskId'>,
  check: MergeRequestCheck | undefined,
  runTab: TestsetRunTab = 'overview',
): string | null {
  if (name === 'TESTSET') {
    return projectTestsetRunPath(projectId, {
      testRunId: check?.testRunId,
      repositoryId: mr.repositoryId,
      testsetId: check?.testsetId,
      taskId: mr.taskId,
      runTab,
    })
  }
  if (name === 'DRY_RUN') {
    return projectTestsetRunPath(projectId, {
      dryRunId: check?.dryRunId,
      repositoryId: mr.repositoryId,
      taskId: mr.taskId,
      runTab,
    })
  }
  return null
}
