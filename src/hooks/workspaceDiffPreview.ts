import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { taskModelQueryKeys } from '@/query'
import {
  fetchWorkspaceDiffPreview,
  fetchWorkspaceDiffPreviewFilePatch,
  fetchWorkspaceDiffPreviewFiles,
} from '@/api/workspaceDiffPreview'
import type {
  WorkspaceDiffPreviewFile,
  WorkspaceDiffPreviewFilePatch,
  WorkspaceDiffPreviewStatus,
} from '@/types/task-model'

/**
 * 查询 Workspace 实时 Diff Preview 详情。
 * 失败（404/503）会被 api 层降级成 `unavailable`，UI 永远拿到结构化结果。
 */
export function useWorkspaceDiffPreview(
  projectId: string,
  taskId: string,
  options: { revision?: number; enabled?: boolean } = {},
): UseQueryResult<WorkspaceDiffPreviewStatus> {
  return useQuery({
    queryKey: taskModelQueryKeys.workspaceDiffPreview.detail(projectId, taskId, options.revision),
    queryFn: () => fetchWorkspaceDiffPreview(projectId, taskId, options.revision),
    enabled: Boolean(projectId && taskId) && (options.enabled ?? true),
    // Preview 是连续流式数据；避免短时间内重复请求，但也不要 stale 时间过长错过实时刷新。
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
}

/** §48：由用户选择的单个 Preview 文件 patch。不同 revision / 文件使用独立 Query Key，旧响应不会覆盖当前选择。 */
export function useWorkspaceDiffPreviewFilePatch(
  projectId: string,
  taskId: string,
  input: { repositoryId: string; path: string; revision?: number; enabled?: boolean },
): UseQueryResult<WorkspaceDiffPreviewFilePatch> {
  return useQuery({
    queryKey: taskModelQueryKeys.workspaceDiffPreview.file(projectId, taskId, input.repositoryId, input.path, input.revision),
    queryFn: () => fetchWorkspaceDiffPreviewFilePatch(projectId, taskId, input),
    enabled: Boolean(projectId && taskId && input.repositoryId && input.path) && (input.enabled ?? true),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    // Preview revision 写入与单文件 patch 落库可能存在短暂间隔；请求失败时继续读取，
    // 页面只展示加载态，不伪造 patch 或把后端暂态暴露为闪烁错误。
    retry: 1,
    refetchInterval: (query) => query.state.status === 'error' ? 2_000 : false,
  })
}

/**
 * 查询 Workspace 实时 Preview 文件列表（多仓库维度）。失败时返回空数组。
 */
export function useWorkspaceDiffPreviewFiles(
  projectId: string,
  taskId: string,
  options: { revision?: number; enabled?: boolean } = {},
): UseQueryResult<WorkspaceDiffPreviewFile[]> {
  return useQuery({
    queryKey: taskModelQueryKeys.workspaceDiffPreview.files(projectId, taskId, options.revision),
    queryFn: () => fetchWorkspaceDiffPreviewFiles(projectId, taskId, options.revision),
    enabled: Boolean(projectId && taskId) && (options.enabled ?? true),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
}
