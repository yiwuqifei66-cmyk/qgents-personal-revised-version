import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { testsetApi } from '@/api/testset'
import { queryClient, queryKeys } from '@/query'
import type {
  CreateDryRunPayload,
  CreateTestRunPayload,
  CreateTestsetPayload,
  DryRunReport,
  TestRun,
  Testset,
  TestsetListFilters,
  UpdateTestsetPayload,
} from '@/types/testset'
import { useProjectTaskDomainEvents } from '@/realtime/useProjectTaskDomainEvents'

/**
 * 查询项目 Testset 列表（仓库 + 启用状态过滤走后端 query）。
 */
export function useTestsets(
  projectId: string,
  filters: TestsetListFilters = {},
): UseQueryResult<Testset[]> {
  return useQuery({
    queryKey: queryKeys.testsets.list(projectId, filters),
    queryFn: () => testsetApi.list(projectId, filters),
    enabled: Boolean(projectId),
  })
}

/**
 * 查询单条 Testset 详情（编辑表单回填）。
 */
export function useTestset(projectId: string, testsetId: string | undefined): UseQueryResult<Testset> {
  return useQuery({
    queryKey: queryKeys.testsets.detail(projectId, testsetId ?? ''),
    queryFn: () => testsetApi.getById(projectId, testsetId ?? ''),
    enabled: Boolean(projectId && testsetId),
  })
}

/**
 * 查询受控测试运行状态与用例摘要。
 */
export function useTestRun(projectId: string, testRunId: string | undefined): UseQueryResult<TestRun> {
  const eventStatus = useProjectTaskDomainEvents(projectId)
  return useQuery({
    queryKey: queryKeys.testRuns.detail(projectId, testRunId ?? ''),
    queryFn: () => testsetApi.getTestRun(projectId, testRunId ?? ''),
    enabled: Boolean(projectId && testRunId),
    refetchInterval: (query) => {
      if (eventStatus === 'connected') return false
      const status = query.state.data?.status
      return status === 'QUEUED' || status === 'RUNNING' ? 4000 : false
    },
  })
}

/**
 * 查询 Dry-run 报告（冲突 + 测试摘要）。
 */
export function useDryRunReport(
  projectId: string,
  dryRunId: string | undefined,
): UseQueryResult<DryRunReport> {
  const eventStatus = useProjectTaskDomainEvents(projectId)
  return useQuery({
    queryKey: queryKeys.dryRuns.report(projectId, dryRunId ?? ''),
    queryFn: () => testsetApi.getDryRunReport(projectId, dryRunId ?? ''),
    enabled: Boolean(projectId && dryRunId),
    refetchInterval: (query) => {
      if (eventStatus === 'connected') return false
      const status = query.state.data?.status
      return status === 'QUEUED' || status === 'RUNNING' ? 4000 : false
    },
  })
}

/** mutation 成功后刷新该项目全部 Testset 查询 */
function invalidateTestsets(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.testsets.all(projectId) })
}

/** 创建 Testset */
export function useCreateTestset(projectId: string): UseMutationResult<Testset, Error, CreateTestsetPayload> {
  return useMutation({
    mutationFn: (payload: CreateTestsetPayload) => testsetApi.create(projectId, payload),
    onSuccess: () => invalidateTestsets(projectId),
  })
}

/** 修改 Testset 配置 */
export function useUpdateTestset(
  projectId: string,
): UseMutationResult<Testset, Error, { testsetId: string; payload: UpdateTestsetPayload }> {
  return useMutation({
    mutationFn: ({ testsetId, payload }) => testsetApi.update(projectId, testsetId, payload),
    onSuccess: () => invalidateTestsets(projectId),
  })
}

/** 启用 Testset */
export function useEnableTestset(projectId: string): UseMutationResult<Testset | undefined, Error, string> {
  return useMutation({
    mutationFn: (testsetId: string) => testsetApi.enable(projectId, testsetId),
    onSuccess: () => invalidateTestsets(projectId),
  })
}

/** 停用 Testset */
export function useDisableTestset(projectId: string): UseMutationResult<Testset | undefined, Error, string> {
  return useMutation({
    mutationFn: (testsetId: string) => testsetApi.disable(projectId, testsetId),
    onSuccess: () => invalidateTestsets(projectId),
  })
}

/** 删除未被门禁引用的 Testset */
export function useDeleteTestset(projectId: string): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: (testsetId: string) => testsetApi.remove(projectId, testsetId),
    onSuccess: () => invalidateTestsets(projectId),
  })
}

/** 发起受控测试运行 */
export function useCreateTestRun(projectId: string): UseMutationResult<TestRun, Error, CreateTestRunPayload> {
  return useMutation({
    mutationFn: (payload: CreateTestRunPayload) => testsetApi.createTestRun(projectId, payload),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.testRuns.all(projectId) })
      queryClient.setQueryData(queryKeys.testRuns.detail(projectId, run.id), run)
    },
  })
}

/** 发起 Dry-run */
export function useCreateDryRun(projectId: string): UseMutationResult<DryRunReport, Error, CreateDryRunPayload> {
  return useMutation({
    mutationFn: (payload: CreateDryRunPayload) => testsetApi.createDryRun(projectId, payload),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dryRuns.all(projectId) })
      if (report.id) {
        queryClient.setQueryData(queryKeys.dryRuns.report(projectId, report.id), report)
      }
    },
  })
}

/** 查询项目 Test Run 列表 */
export function useTestRuns(
  projectId: string,
  filters: { status?: string; limit?: number } = {},
): UseQueryResult<TestRun[]> {
  return useQuery({
    queryKey: queryKeys.testRuns.all(projectId),
    queryFn: () => testsetApi.listTestRuns(projectId, filters),
    enabled: Boolean(projectId),
  })
}

/** 查询项目 Dry Run 列表 */
export function useDryRuns(
  projectId: string,
  filters: { status?: string; limit?: number } = {},
): UseQueryResult<DryRunReport[]> {
  return useQuery({
    queryKey: queryKeys.dryRuns.all(projectId),
    queryFn: () => testsetApi.listDryRuns(projectId, filters),
    enabled: Boolean(projectId),
  })
}
