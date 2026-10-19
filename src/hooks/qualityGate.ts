import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { branchPolicyApi, dryRunCqApi, preflightApi, qualityGateApi } from '@/api/qualityGate'
import { queryClient, queryKeys, taskModelQueryKeys } from '@/query'
import type {
  BranchPolicy,
  BranchPolicyUpdateInput,
  DryRunCqInput,
  DryRunCqResult,
  Preflight,
  QualityGateConfig,
  QualityGateUpdateInput,
} from '@/types/qualityGate'
import { useProjectTaskPollingInterval } from '@/realtime/useProjectTaskDomainEvents'

function invalidatePolicyScoped(projectId: string, repositoryId: string, branch: string): void {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.branchPolicies.detail(projectId, repositoryId, branch),
  })
  void queryClient.invalidateQueries({
    queryKey: queryKeys.qualityGates.detail(projectId, repositoryId, branch),
  })
}

/** 查询某条分支的受保护策略 */
export function useBranchPolicy(
  projectId: string,
  repositoryId: string,
  branch: string,
): UseQueryResult<BranchPolicy> {
  return useQuery({
    queryKey: queryKeys.branchPolicies.detail(projectId, repositoryId, branch),
    queryFn: () => branchPolicyApi.get(projectId, repositoryId, branch),
    enabled: Boolean(projectId && repositoryId && branch),
  })
}

/** 查询某条目标分支的质量门禁配置 */
export function useQualityGate(
  projectId: string,
  repositoryId: string,
  branch: string,
): UseQueryResult<QualityGateConfig> {
  return useQuery({
    queryKey: queryKeys.qualityGates.detail(projectId, repositoryId, branch),
    queryFn: () => qualityGateApi.get(projectId, repositoryId, branch),
    enabled: Boolean(projectId && repositoryId && branch),
  })
}

/** 更新分支策略（仅 PROJECT_ADMIN） */
export function useUpdateBranchPolicy(
  projectId: string,
): UseMutationResult<BranchPolicy, Error, { repositoryId: string; branch: string; input: BranchPolicyUpdateInput }> {
  return useMutation({
    mutationFn: ({ repositoryId, branch, input }) =>
      branchPolicyApi.update(projectId, repositoryId, branch, input),
    onSuccess: (_policy, variables) => {
      invalidatePolicyScoped(projectId, variables.repositoryId, variables.branch)
    },
  })
}

/** 更新质量门禁（仅 PROJECT_ADMIN；当前只编辑 requiredTestsetIds） */
export function useUpdateQualityGate(
  projectId: string,
): UseMutationResult<QualityGateConfig, Error, { repositoryId: string; branch: string; input: QualityGateUpdateInput }> {
  return useMutation({
    mutationFn: ({ repositoryId, branch, input }) =>
      qualityGateApi.update(projectId, repositoryId, branch, input),
    onSuccess: (_config, variables) => {
      invalidatePolicyScoped(projectId, variables.repositoryId, variables.branch)
      void queryClient.invalidateQueries({ queryKey: queryKeys.testsets.all(projectId) })
    },
  })
}

/**
 * 查询 MR 前预检。
 * 以 taskId + repositoryId + targetBranch 为唯一键；STALE/FAILED 都不表示可创建 MR。
 *
 * 当任务处于 DELIVERING → WAITING_PREFLIGHT 过渡期间，后端会在 commit/push 完成后
 * 自动创建 Dry Run。5s 轮询兜底（SSE 不可用时），让用户无需手动刷新即可看到状态变化。
 */
export function usePreflight(
  projectId: string,
  taskId: string,
  repositoryId: string,
  targetBranch: string,
): UseQueryResult<Preflight> {
  const pollingInterval = useProjectTaskPollingInterval(projectId, 5_000)
  return useQuery({
    queryKey: queryKeys.preflight.detail(projectId, taskId, repositoryId, targetBranch),
    queryFn: () => preflightApi.get(projectId, taskId, repositoryId, targetBranch),
    enabled: Boolean(projectId && targetBranch),
    // 返回列表页时先复用刚刚查看过的快照；轮询和 SSE 仍会在短时间内校正状态。
    staleTime: 5_000,
    // 任务交付阶段（DELIVERING → WAITING_PREFLIGHT）需要自动刷新，
    // 以便后端完成 commit/push 后前端能及时看到 Dry Run 状态变化。
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

/** 给当前 PASSED 的 Dry Run 盖 CQ+1 */
export function useApproveDryRunCq(projectId: string): UseMutationResult<DryRunCqResult, Error, { dryRunId: string; input: DryRunCqInput }> {
  return useMutation({
    mutationFn: ({ dryRunId, input }) => dryRunCqApi.approve(projectId, dryRunId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dryRuns.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.preflight.all(projectId) })
      // The real MR is created asynchronously after CQ+1. Refresh its list
      // so the old placeholder cannot keep exposing a WAITING_CQ action.
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.mergeRequests.all(projectId) })
    },
  })
}

/** 拒绝 Dry Run CQ */
export function useRejectDryRunCq(projectId: string): UseMutationResult<DryRunCqResult, Error, { dryRunId: string; input: DryRunCqInput }> {
  return useMutation({
    mutationFn: ({ dryRunId, input }) => dryRunCqApi.reject(projectId, dryRunId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dryRuns.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.preflight.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.mergeRequests.all(projectId) })
    },
  })
}
