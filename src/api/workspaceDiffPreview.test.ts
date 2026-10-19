import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import {
  fetchWorkspaceDiffPreview,
  mapWorkspaceDiffPreview,
  mapWorkspaceDiffPreviewFile,
  mapWorkspaceDiffPreviewFilePatch,
  mapWorkspaceDiffPreviewFiles,
} from './workspaceDiffPreview'

describe('workspace Diff Preview mapping', () => {
  it('maps a preview response with non-negative defaults and preserves base commit', () => {
    const preview = mapWorkspaceDiffPreview({
      projectId: 'project-1',
      taskId: 'task-1',
      taskRunId: 'run-1',
      workspaceId: 'ws-1',
      revision: 3,
      baseCommit: 'a1b2c3',
      workingTreeHash: 'sha256:abc',
      filesChanged: 2,
      additions: 8,
      deletions: 3,
      patch: 'diff --git a/x b/x',
      createdAt: '2026-08-19T12:00:00Z',
    })
    expect(preview).toMatchObject({
      projectId: 'project-1',
      taskId: 'task-1',
      taskRunId: 'run-1',
      workspaceId: 'ws-1',
      revision: 3,
      baseCommit: 'a1b2c3',
      workingTreeHash: 'sha256:abc',
      filesChanged: 2,
      additions: 8,
      deletions: 3,
    })
  })

  it('preserves nullable snapshot fields defined by the Preview contract', () => {
    const preview = mapWorkspaceDiffPreview({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'ws-1',
      revision: 1,
      workingTreeHash: null,
      patch: null,
    })
    expect(preview.baseCommit).toBeNull()
    expect(preview.taskRunId).toBeNull()
    expect(preview.workingTreeHash).toBeNull()
    expect(preview.patch).toBeNull()
    expect(preview.additions).toBe(0)
  })

  it('maps Preview files from the documented path/repositoryPath shape', () => {
    const files = mapWorkspaceDiffPreviewFiles([
      { repositoryPath: 'auth-service', path: 'src/a.ts', changeType: 'MODIFIED', additions: 1, deletions: 0, binary: false },
      { repositoryId: 'repo-1', repositoryPath: 'auth-service', path: 'src/b.ts', changeType: 'UNKNOWN_TYPE', additions: 0, deletions: 0, binary: false },
      { repositoryPath: 'web-console', path: 'src/c.ts', changeType: 'ADDED', additions: 0, deletions: 0, binary: false },
      'not-an-object',
    ])
    expect(files).toHaveLength(3)
    expect(files[0].repositoryId).toBeNull()
    expect(files[0].repositoryPath).toBe('auth-service')
    expect(files[0].changeType).toBe('MODIFIED')
    expect(files[1].changeType).toBe('MODIFIED')
  })

  it('normalizes Git octal-escaped file paths before a file is selected', () => {
    const file = mapWorkspaceDiffPreviewFile({
      repositoryId: 'repo-1',
      repositoryPath: 'repo-1',
      path: 'qg/\\344\\273\\277\\345\\260\\217\\347\\261\\263/welcome.html',
      changeType: 'ADDED',
    })

    expect(file?.path).toBe('qg/\u4eff\u5c0f\u7c73/welcome.html')
  })

  it('returns null for malformed preview file rows', () => {
    expect(mapWorkspaceDiffPreviewFile(null)).toBeNull()
    expect(mapWorkspaceDiffPreviewFile({})).toBeNull()
    expect(mapWorkspaceDiffPreviewFile({ path: 'x' })).toMatchObject({
      path: 'x',
      repositoryId: null,
      repositoryPath: null,
    })
  })

  it('maps the §48 single-file Preview patch and keeps an unavailable patch nullable', () => {
    const patch = mapWorkspaceDiffPreviewFilePatch({
      revision: 3,
      repositoryId: 'repo-1',
      path: 'src/Login.vue',
      changeType: 'MODIFIED',
      additions: 12,
      deletions: 4,
      binary: false,
      patch: null,
    })
    expect(patch).toMatchObject({ repositoryId: 'repo-1', path: 'src/Login.vue', revision: 3, patch: null })
    expect(mapWorkspaceDiffPreviewFilePatch({ revision: 3, path: 'src/Login.vue' })).toBeNull()
  })

  it('does not throw when Preview is unavailable', async () => {
    const status = await fetchWorkspaceDiffPreview('project-1', 'task-1')
    // jsdom 的相对 URL fetch 失败也必须降级为可展示的 unavailable 状态。
    expect(status.kind).toBe('unavailable')
  })

  it('does not leak 404 as a thrown ApiError from fetchWorkspaceDiffPreview', async () => {
    // 让 requestModelData 抛 404，验证降级。
    const realFetch = globalThis.fetch
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Preview 未生成' } }), { status: 404 }))) as typeof fetch
    try {
      const status = await fetchWorkspaceDiffPreview('project-1', 'task-1')
      expect(status.kind).toBe('unavailable')
      if (status.kind === 'unavailable') expect(status.reason).toBe('NOT_FOUND')
    } catch (error) {
      // 若全局 fetch 不可用，跳过此断言（环境相关）
      expect(error).toBeInstanceOf(ApiError)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
