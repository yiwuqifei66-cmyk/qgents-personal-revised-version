import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { githubApi } from '@/api'
import { queryKeys } from '@/query'
import type { WorkBranch, WorkBranchListFilters } from '@/types/github'
import type { TaskModelPage } from '@/types/task-model'

/**
 * 项目工作分支视图（GET /projects/{projectId}/work-branches，接口文档 v2.0.8 §6.2）。
 * SSE 的 task.updated / diff.created / merge-request.updated / test-run.updated
 * 会 invalidate queryKeys.workBranches.all 前缀，本 query 随之自动刷新。
 */
export function useWorkBranches(
  projectId: string,
  filters: WorkBranchListFilters = {},
): UseQueryResult<TaskModelPage<WorkBranch>> {
  const { repositoryId, requirementGroupId, limit = 100 } = filters
  return useQuery({
    queryKey: queryKeys.workBranches.list(projectId, { repositoryId, requirementGroupId }),
    queryFn: () => githubApi.workBranches(projectId, { repositoryId, requirementGroupId, limit }),
    enabled: Boolean(projectId),
  })
}
