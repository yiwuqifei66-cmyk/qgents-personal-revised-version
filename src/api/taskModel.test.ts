import { beforeEach, describe, expect, it, vi } from 'vitest'
import { githubApi } from './github'
import { diffsApi, mergeRequestsApi, taskRunsApi, tasksApi } from './taskModel'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('new task model API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: {}, requestId: 'req' }))
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-key' })
  })

  it('preserves the envelope when loading repositories for Task creation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: [{ repositoryId: 'repository-1' }],
      requestId: 'req-repositories',
    }))

    await expect(githubApi.listProjectRepositories('project-1')).resolves.toEqual([
      { repositoryId: 'repository-1' },
    ])
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/projects/project-1/repositories',
      expect.objectContaining({ body: undefined }),
    )
  })

  it('uses the Task create path and request body without legacy fields', async () => {
    const fetchMock = vi.mocked(fetch)
    await tasksApi.create('project-1', {
      requirementGroupId: 'group-1',
      title: 'Implement login',
      requirement: 'Support login',
      repositoryIds: ['repo-1'],
      baseRef: 'main',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/tasks', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-key' }),
      body: JSON.stringify({
        requirementGroupId: 'group-1',
        title: 'Implement login',
        requirement: 'Support login',
        repositoryIds: ['repo-1'],
        baseRef: 'main',
      }),
    }))
  })

  it('uses only the documented Task and Diff list filters', async () => {
    const fetchMock = vi.mocked(fetch)
    await tasksApi.list('project-1', { groupId: 'group-1', status: 'RUNNING', createdBy: 'user-1', cursor: 'c1', limit: 20 })
    await diffsApi.list('project-1', { taskId: 'task-1', cursor: 'c2', limit: 10 })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/projects/project-1/tasks?groupId=group-1&status=RUNNING&createdBy=user-1&cursor=c1&limit=20', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/projects/project-1/diffs?taskId=task-1&cursor=c2&limit=10', expect.any(Object))
  })

  it('preserves the pagination envelope for model list responses', async () => {
    const page = { data: [{ id: 'task-1' }], page: { nextCursor: null, hasMore: false }, requestId: 'req-1' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(page))

    await expect(tasksApi.list('project-1')).resolves.toEqual(page)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/projects/project-1/tasks', expect.objectContaining({
      body: undefined,
    }))
  })

  it('uses the Task-level diagnostics path without requiring a TaskRun id', async () => {
    const fetchMock = vi.mocked(fetch)
    await tasksApi.diagnostics('project-1', 'task-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/tasks/task-1/diagnostics',
      expect.objectContaining({ body: undefined }),
    )
  })

  it('uses TaskRun by-task paths and does not expose a standalone steps endpoint', async () => {
    const fetchMock = vi.mocked(fetch)
    await taskRunsApi.list('project-1', 'task-1', { status: 'FAILED', cursor: 'c1', limit: 20 })
    await taskRunsApi.get('project-1', 'run-1')
    await taskRunsApi.diagnostics('project-1', 'run-1')
    await taskRunsApi.retry('project-1', 'run-1')
    await taskRunsApi.logs('project-1', 'run-1', { cursor: 'c2', limit: 10 })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/projects/project-1/tasks/task-1/task-runs?status=FAILED&cursor=c1&limit=20', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/projects/project-1/task-runs/run-1', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/projects/project-1/task-runs/run-1/diagnostics', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/projects/project-1/task-runs/run-1/retry', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/projects/project-1/task-runs/run-1/logs?cursor=c2&limit=10', expect.any(Object))
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/steps'))).toBe(false)
  })

  it('uses Diff accept and reject paths with idempotent writes', async () => {
    const fetchMock = vi.mocked(fetch)
    await diffsApi.accept('project-1', 'diff-1')
    await diffsApi.reject('project-1', 'diff-1', { reason: 'Please address the failing test' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/projects/project-1/diffs/diff-1/accept', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/projects/project-1/diffs/diff-1/reject', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'Please address the failing test' }),
    }))
  })

  it('requests MR preflight with the documented task context', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.create('project-1', {
      taskId: 'task-1',
      repositoryId: 'repo-1',
      targetBranch: 'main',
      title: '实现邮箱登录',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/merge-requests/preflight', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-key' }),
      body: JSON.stringify({ taskId: 'task-1', repositoryId: 'repo-1' }),
    }))
  })

  it('lists merge requests with the documented filters', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.list('project-1', {
      repositoryId: 'repo-1',
      groupId: 'group-1',
      status: 'OPEN',
      cursor: 'c1',
      limit: 20,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/merge-requests?repositoryId=repo-1&groupId=group-1&status=OPEN&cursor=c1&limit=20',
      expect.objectContaining({ body: undefined }),
    )
  })

  it('loads MR detail, checks and merge through the documented paths', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.get('project-1', 'mr-1')
    await mergeRequestsApi.checks('project-1', 'mr-1')
    await mergeRequestsApi.merge('project-1', 'mr-1')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project-1/merge-requests/mr-1',
      expect.objectContaining({ body: undefined }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-1/merge-requests/mr-1/checks',
      expect.objectContaining({ body: undefined }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/projects/project-1/merge-requests/mr-1/merge', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-key' }),
    }))
  })

  it('syncs an MR from GitHub with an idempotent write', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.sync('project-1', 'mr-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/merge-requests/mr-1/sync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-key' }),
      }),
    )
  })

  it('posts CQ approvals and rejections with Idempotency-Key and reason', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.approveCq('project-1', 'mr-1', { reason: 'LGTM' })
    await mergeRequestsApi.rejectCq('project-1', 'mr-1', { reason: 'needs tests' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project-1/merge-requests/mr-1/cq-approvals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-key' }),
        body: JSON.stringify({ reason: 'LGTM' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-1/merge-requests/mr-1/cq-rejections',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-key' }),
        body: JSON.stringify({ reason: 'needs tests' }),
      }),
    )
  })

  it('loads MR reviews through the documented path', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.reviews('project-1', 'mr-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/merge-requests/mr-1/reviews',
      expect.objectContaining({ body: undefined }),
    )
  })

  it('loads MR commits through the provisional path with limit', async () => {
    const fetchMock = vi.mocked(fetch)
    await mergeRequestsApi.commits('project-1', 'mr-1', 3)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/merge-requests/mr-1/commits?limit=3',
      expect.objectContaining({ body: undefined }),
    )
  })
})
