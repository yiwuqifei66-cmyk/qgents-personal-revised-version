import { http, HttpResponse, type HttpHandler } from 'msw'

/**
 * Workspace 实时 Diff Preview —— Mock handlers。
 *
 * 计划 §3.3：Worker Diff 已能返回工作树 hash、文件数、增删行数和 patch。
 * 这里按计划 §4.5 的契约返回，不携带源码绝对路径、不携带 Token。
 *
 * 支持的 scenario：
 * - 默认（taskId 不带后缀）：空 Preview（revision 0，filesChanged 0）；
 * - `preview-running`（taskId 以 -running 结尾）：返回 revision 2、2 仓库 4 文件；
 * - `preview-worker-down`（taskId 以 -worker-down 结尾）：返回 503 Worker 不可用；
 * - `preview-pending`（taskId 以 -pending 结尾）：返回 404 尚未生成；
 */
interface PreviewMockFile {
  repositoryId: string
  repositoryPath: string
  path: string
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED'
  additions: number
  deletions: number
  binary: boolean
}

interface PreviewMock {
  projectId: string
  taskId: string
  taskRunId: string
  workspaceId: string
  revision: number
  baseCommit: string
  workingTreeHash: string
  filesChanged: number
  additions: number
  deletions: number
  files: PreviewMockFile[]
  patch: string
  createdAt: string
}

function pathParam(value: string | readonly string[] | undefined): string {
  return typeof value === 'string' ? value : value?.[0] ?? ''
}

function buildPreview(projectId: string, taskId: string): PreviewMock {
  const repositoryA = 'repository-auth-service'
  const repositoryB = 'repository-web-console'
  return {
    projectId,
    taskId,
    taskRunId: 'taskrun-running',
    workspaceId: `workspace-${taskId}`,
    revision: 2,
    baseCommit: 'a1b2c3d4e5f6789012345678abcdef0123456789',
    workingTreeHash: 'sha256:mock-working-tree-hash',
    filesChanged: 4,
    additions: 28,
    deletions: 6,
    files: [
      { repositoryId: repositoryA, repositoryPath: 'auth-service', path: 'src/main/java/auth/LoginService.java', changeType: 'MODIFIED', additions: 12, deletions: 3, binary: false },
      { repositoryId: repositoryA, repositoryPath: 'auth-service', path: 'src/main/java/auth/SessionStore.java', changeType: 'ADDED', additions: 6, deletions: 0, binary: false },
      { repositoryId: repositoryB, repositoryPath: 'web-console', path: 'apps/web/app/login/page.tsx', changeType: 'MODIFIED', additions: 8, deletions: 1, binary: false },
      { repositoryId: repositoryB, repositoryPath: 'web-console', path: 'apps/web/public/logo.png', changeType: 'MODIFIED', additions: 0, deletions: 0, binary: true },
    ],
    patch: 'diff --git a/src/main/java/auth/LoginService.java b/src/main/java/auth/LoginService.java\n@@ mock preview patch @@\n',
    createdAt: '2026-08-19T12:00:00Z',
  }
}

function response(data: unknown, requestId: string): HttpResponse<Record<string, unknown>> {
  return HttpResponse.json({ data, requestId }) as HttpResponse<Record<string, unknown>>
}

function errorResponse(status: number, code: string, message: string): HttpResponse<Record<string, unknown>> {
  return HttpResponse.json({ error: { code, message, details: [] }, requestId: 'workspace-diff-preview-mock' }, { status }) as HttpResponse<Record<string, unknown>>
}

function summarisePreview(preview: PreviewMock): Record<string, unknown> {
  const { files: _files, ...rest } = preview
  return rest
}

export const workspaceDiffPreviewHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/tasks/:taskId/workspace-diff-preview', ({ params }) => {
    const projectId = pathParam(params.projectId)
    const taskId = pathParam(params.taskId)
    if (taskId.endsWith('-pending')) return errorResponse(404, 'WORKSPACE_DIFF_PREVIEW_NOT_READY', 'Preview has not been generated yet')
    if (taskId.endsWith('-worker-down')) return errorResponse(503, 'WORKSPACE_DIFF_PREVIEW_WORKER_UNAVAILABLE', 'Worker is not available')
    const preview = buildPreview(projectId, taskId)
    return response(summarisePreview(preview), 'workspace-diff-preview-mock')
  }),

  http.get('*/api/projects/:projectId/tasks/:taskId/workspace-diff-preview/files', ({ params }) => {
    const projectId = pathParam(params.projectId)
    const taskId = pathParam(params.taskId)
    if (taskId.endsWith('-pending') || taskId.endsWith('-worker-down')) return response([], 'workspace-diff-preview-files-mock-empty')
    const preview = buildPreview(projectId, taskId)
    return response(preview.files, 'workspace-diff-preview-files-mock')
  }),

  http.get('*/api/projects/:projectId/tasks/:taskId/workspace-diff-preview/file', ({ params, request }) => {
    const projectId = pathParam(params.projectId)
    const taskId = pathParam(params.taskId)
    const query = new URL(request.url).searchParams
    const repositoryId = query.get('repositoryId') ?? ''
    const path = query.get('path') ?? ''
    if (!repositoryId || !path || path.includes('..')) return errorResponse(400, 'INVALID_REQUEST', 'repositoryId and path are required')
    if (taskId.endsWith('-pending') || taskId.endsWith('-worker-down')) return errorResponse(404, 'WORKSPACE_DIFF_PREVIEW_NOT_FOUND', 'Preview has not been generated yet')
    const preview = buildPreview(projectId, taskId)
    const file = preview.files.find((candidate) => candidate.repositoryId === repositoryId && candidate.path === path)
    if (!file) return errorResponse(404, 'WORKSPACE_DIFF_PREVIEW_NOT_FOUND', 'Preview file was not found')
    return response({
      revision: preview.revision,
      repositoryId: file.repositoryId,
      path: file.path,
      changeType: file.changeType,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
      patch: file.binary ? null : `@@ -1,1 +1,${Math.max(file.additions, 1)} @@\n-${file.path}\n+${file.path}\n`,
    }, 'workspace-diff-preview-file-mock')
  }),
]
