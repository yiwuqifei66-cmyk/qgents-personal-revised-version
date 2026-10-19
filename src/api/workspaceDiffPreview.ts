import { requestModelData } from './modelClient'
import type { WorkspaceDiffPreview, WorkspaceDiffPreviewFile, WorkspaceDiffPreviewFilePatch, WorkspaceDiffPreviewChangeType, WorkspaceDiffPreviewStatus } from '@/types/task-model'

/**
 * Preview 的可恢复状态：后端可能在写入触发前、Worker 不可用、Preview 被清理时返回。
 * - `unavailable`：预览未就绪（404、503 等可恢复），UI 应展示"实时预览暂不可用"，不视为错误。
 * - `available`：携带完整数据。
 */
export type { WorkspaceDiffPreviewStatus } from '@/types/task-model'

const PREVIEW_PATH = (projectId: string, taskId: string) =>
  `/projects/${projectId}/tasks/${taskId}/workspace-diff-preview`

const PREVIEW_FILES_PATH = (projectId: string, taskId: string) =>
  `${PREVIEW_PATH(projectId, taskId)}/files`

const PREVIEW_FILE_PATH = (projectId: string, taskId: string) =>
  `${PREVIEW_PATH(projectId, taskId)}/file`

const CHANGE_TYPES: readonly WorkspaceDiffPreviewChangeType[] = ['ADDED', 'MODIFIED', 'DELETED', 'RENAMED']

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? value : ''
}

function readNullableString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' ? value : null
}

function readNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readChangeType(raw: Record<string, unknown>): WorkspaceDiffPreviewChangeType {
  const value = raw.changeType
  return CHANGE_TYPES.includes(value as WorkspaceDiffPreviewChangeType)
    ? (value as WorkspaceDiffPreviewChangeType)
    : 'MODIFIED'
}

export function mapWorkspaceDiffPreview(raw: unknown): WorkspaceDiffPreview {
  const row = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {}
  return {
    projectId: readString(row, 'projectId'),
    taskId: readString(row, 'taskId'),
    taskRunId: typeof row.taskRunId === 'string' && row.taskRunId ? row.taskRunId : null,
    workspaceId: readString(row, 'workspaceId'),
    revision: readNumber(row, 'revision'),
    baseCommit: typeof row.baseCommit === 'string' && row.baseCommit ? row.baseCommit : null,
    workingTreeHash: readNullableString(row, 'workingTreeHash'),
    filesChanged: readNumber(row, 'filesChanged'),
    additions: readNumber(row, 'additions'),
    deletions: readNumber(row, 'deletions'),
    patch: readNullableString(row, 'patch'),
    createdAt: readString(row, 'createdAt'),
  }
}

export function mapWorkspaceDiffPreviewFile(raw: unknown): WorkspaceDiffPreviewFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const path = normalizeGitQuotedPath(readString(row, 'path'))
  if (!path) return null
  return {
    repositoryId: readNullableString(row, 'repositoryId'),
    repositoryPath: readNullableString(row, 'repositoryPath'),
    path,
    changeType: readChangeType(row),
    additions: readNumber(row, 'additions'),
    deletions: readNumber(row, 'deletions'),
    binary: row.binary === true,
  }
}

/**
 * Git 在非 ASCII 路径上可能返回 `\\344\\273...` 形式的 UTF-8 八进制转义。
 * Workspace Preview 的单文件接口需要真实仓库相对路径；保留普通路径不变，
 * 仅在完整解码成功时转为 UTF-8，避免把无效输入误改后发送给服务端。
 */
function normalizeGitQuotedPath(path: string): string {
  if (!/\\[0-7]{3}/.test(path)) return path
  const encoded = path.replace(/\\([0-7]{3})/g, (_match, octal: string) => {
    const byte = Number.parseInt(octal, 8)
    return `%${byte.toString(16).padStart(2, '0')}`
  })
  try {
    return decodeURIComponent(encoded)
  } catch {
    return path
  }
}

export function mapWorkspaceDiffPreviewFiles(raw: unknown): WorkspaceDiffPreviewFile[] {
  if (!Array.isArray(raw)) return []
  const files: WorkspaceDiffPreviewFile[] = []
  for (const item of raw) {
    const mapped = mapWorkspaceDiffPreviewFile(item)
    if (mapped) files.push(mapped)
  }
  return files
}

export function mapWorkspaceDiffPreviewFilePatch(raw: unknown): WorkspaceDiffPreviewFilePatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const repositoryId = readString(row, 'repositoryId')
  const path = readString(row, 'path')
  const revision = readNumber(row, 'revision')
  if (!repositoryId || !path || !Number.isInteger(revision) || revision < 0) return null
  return {
    revision,
    repositoryId,
    path,
    changeType: readChangeType(row),
    additions: readNumber(row, 'additions'),
    deletions: readNumber(row, 'deletions'),
    binary: row.binary === true,
    patch: readNullableString(row, 'patch'),
  }
}

/**
 * 解析 Preview 详情：后端 404 / 503 表示预览不可用，不视为错误。
 * 其它非 2xx 仍然抛出，由调用方决定是否展示兜底文案。
 */
export async function fetchWorkspaceDiffPreview(
  projectId: string,
  taskId: string,
  revision?: number,
): Promise<WorkspaceDiffPreviewStatus> {
  const query: Record<string, string> = {}
  if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) {
    query.revision = String(revision)
  }
  try {
    const data = await requestModelData<unknown>(appendQuery(PREVIEW_PATH(projectId, taskId), query))
    return { kind: 'available', preview: mapWorkspaceDiffPreview(data) }
  } catch (error) {
    return previewUnavailable(error)
  }
}

export async function fetchWorkspaceDiffPreviewFiles(
  projectId: string,
  taskId: string,
  revision?: number,
): Promise<WorkspaceDiffPreviewFile[]> {
  const query: Record<string, string> = {}
  if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) {
    query.revision = String(revision)
  }
  try {
    const data = await requestModelData<unknown>(appendQuery(PREVIEW_FILES_PATH(projectId, taskId), query))
    return mapWorkspaceDiffPreviewFiles(data)
  } catch {
    // 文件列表是辅助信息；失败时不阻塞 UI 详情，按空数组处理即可。
    return []
  }
}

/** §48：仅在用户选中一个带 repositoryId 的 Preview 文件后读取对应 patch。 */
export async function fetchWorkspaceDiffPreviewFilePatch(
  projectId: string,
  taskId: string,
  input: { repositoryId: string; path: string; revision?: number },
): Promise<WorkspaceDiffPreviewFilePatch> {
  const query: Record<string, string> = {
    repositoryId: input.repositoryId,
    path: input.path,
  }
  if (typeof input.revision === 'number' && Number.isInteger(input.revision) && input.revision >= 0) {
    query.revision = String(input.revision)
  }
  const data = await requestModelData<unknown>(appendQuery(PREVIEW_FILE_PATH(projectId, taskId), query))
  const mapped = mapWorkspaceDiffPreviewFilePatch(data)
  if (!mapped) throw new Error('Workspace Diff Preview 文件响应格式不完整')
  return mapped
}

function previewUnavailable(error: unknown): WorkspaceDiffPreviewStatus {
  const status = readStatus(error)
  const message = readMessage(error)
  if (status === 404) return { kind: 'unavailable', reason: 'NOT_FOUND', message: message || 'Preview 尚未生成' }
  if (status === 503) return { kind: 'unavailable', reason: 'WORKER_UNAVAILABLE', message: message || 'Worker 暂不可用，实时预览暂不可用' }
  return { kind: 'unavailable', reason: 'UNKNOWN', message: message || '实时预览暂不可用' }
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

function readMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

function appendQuery(path: string, query: Record<string, string>): string {
  const keys = Object.keys(query)
  if (keys.length === 0) return path
  const search = new URLSearchParams()
  for (const key of keys) search.set(key, query[key])
  return `${path}?${search.toString()}`
}

export const workspaceDiffPreviewApi = {
  get: fetchWorkspaceDiffPreview,
  files: fetchWorkspaceDiffPreviewFiles,
  file: fetchWorkspaceDiffPreviewFilePatch,
}
