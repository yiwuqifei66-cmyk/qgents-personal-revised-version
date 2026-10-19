import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query'
import { githubApi } from '@/api'
import { queryKeys } from '@/query'
import type { CreateRemoteBranchPayload, RemoteBranch, RemoteBranchListFilters } from '@/types/github'

/**
 * 远程分支列表（GET /projects/{projectId}/repositories/{repoId}/branches，分支管理计划 §B）。
 * 返回 RemoteBranch[]，与 WorkBranch 不同的是它来自 GitHub 真实远程。
 */
export function useRemoteBranches(
  projectId: string,
  repositoryId: string,
  filters: RemoteBranchListFilters = {},
): UseQueryResult<RemoteBranch[]> {
  const { keyword, cursor, limit = 100 } = filters
  return useQuery({
    queryKey: queryKeys.remoteBranches.list(projectId, repositoryId, { keyword, cursor, limit }),
    queryFn: () => githubApi.listRemoteBranches(projectId, repositoryId, { keyword, cursor, limit }),
    enabled: Boolean(projectId && repositoryId),
  })
}

/**
 * 创建远程分支（POST /projects/{projectId}/repositories/{repoId}/branches，分支管理计划 §C）。
 * 成功后自动失效该仓库的远程分支列表缓存。
 */
export function useCreateRemoteBranch(
  projectId: string,
  repositoryId: string,
): UseMutationResult<RemoteBranch, Error, CreateRemoteBranchPayload> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateRemoteBranchPayload) =>
      githubApi.createRemoteBranch(projectId, repositoryId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.remoteBranches.all(projectId, repositoryId),
      })
      // 工作分支视图也需要刷新，因为新分支可能影响工作分支列表
      queryClient.invalidateQueries({
        queryKey: queryKeys.workBranches.all(projectId),
      })
    },
  })
}
