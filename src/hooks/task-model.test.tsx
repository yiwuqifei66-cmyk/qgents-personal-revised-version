import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task, TaskModelPage, TaskRunDetail, TaskRunSummary } from '@/types/task-model'

const taskCreateMock = vi.hoisted(() => vi.fn())
const taskCancelMock = vi.hoisted(() => vi.fn())
const taskRunRetryMock = vi.hoisted(() => vi.fn())
const taskRunCancelMock = vi.hoisted(() => vi.fn())
const diffAcceptMock = vi.hoisted(() => vi.fn())
const taskRunGetMock = vi.hoisted(() => vi.fn())
const mergeRequestCreateMock = vi.hoisted(() => vi.fn())
const mergeRequestMergeMock = vi.hoisted(() => vi.fn())
const mergeRequestApproveCqMock = vi.hoisted(() => vi.fn())
const mergeRequestRejectCqMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/taskModel', () => ({
  diffsApi: { accept: diffAcceptMock },
  tasksApi: { create: taskCreateMock, cancel: taskCancelMock },
  taskRunsApi: { get: taskRunGetMock, retry: taskRunRetryMock, cancel: taskRunCancelMock },
  mergeRequestsApi: {
    create: mergeRequestCreateMock,
    merge: mergeRequestMergeMock,
    approveCq: mergeRequestApproveCqMock,
    rejectCq: mergeRequestRejectCqMock,
  },
}))

import { queryClient, taskModelQueryKeys } from '@/query'
import {
  useAcceptDiff,
  useCancelTask,
  useCreateMergeRequest,
  useCreateTask,
  useMergeMergeRequest,
  useApproveMergeRequestCq,
  useCancelTaskRunModel,
  useRetryTaskRunModel,
  useTaskRun,
} from './task-model'

const task: Task = {
  id: 'task-1', displayCode: 'T-1', projectId: 'project-1', title: 'Implement login', requirementSummary: 'Support login', status: 'RUNNING', deliveryMode: 'DIFF_FIRST', deliveryReason: null, requirementGroup: { id: 'group-1', name: 'Login', status: 'ACTIVE' }, createdByUser: { id: 'user-1', displayName: 'User', avatarUrl: null }, repositories: [], executionSummary: { totalSteps: 0, pendingSteps: 0, runningSteps: 0, waitingSteps: 0, blockedSteps: 0, succeededSteps: 0, failedSteps: 0, currentStage: null, currentStageTitle: null, requiresUserAction: false },   attention: null, statusReason: null, createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z', requirement: 'Support login', acceptanceCriteria: [], workspace: null, capabilities: { canCancel: true, canReplacePendingStepAgent: false, canConfirmDiffReview: false, canRejectDiffReview: false, canRetryDelivery: false }, artifactSummary: { total: 0, byType: {} }, diffReviewSummary: { available: false, reviewStatus: null, deliveryStatus: null, repositoryCount: 0, filesChanged: 0, additions: 0, deletions: 0 }, sourceMessage: null, triggerMessageId: null,
}

const taskRun: TaskRunDetail = {
  id: 'run-2', taskId: 'task-1', taskStepId: 'step-1', taskStepTitle: 'Developer', agent: null, role: 'DEVELOPER', status: 'QUEUED', retryOfTaskRunId: 'run-1', statusSummary: null, statusReason: null, startedAt: null, finishedAt: null, durationMs: null, artifactSummary: { total: 0, diffCount: 0 }, createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z',
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  taskCreateMock.mockReset()
  taskCancelMock.mockReset()
  taskRunRetryMock.mockReset()
  taskRunCancelMock.mockReset()
  diffAcceptMock.mockReset()
  taskRunGetMock.mockReset()
  mergeRequestCreateMock.mockReset()
  mergeRequestMergeMock.mockReset()
  mergeRequestApproveCqMock.mockReset()
  mergeRequestRejectCqMock.mockReset()
  queryClient.clear()
})

describe('new task model hooks', () => {
  it('writes a created Task and invalidates the project Task list', async () => {
    taskCreateMock.mockResolvedValue(task)
    const list = queryClient.getQueryCache().build(queryClient, {
      queryKey: taskModelQueryKeys.tasks.list('project-1', {}),
      queryFn: async () => ({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req' }),
    })
    list.setData({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req' })

    const { result } = renderHook(() => useCreateTask('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({
        requirementGroupId: 'group-1',
        title: 'Implement login',
        requirement: 'Support login',
        repositoryIds: ['repo-1'],
        baseRef: 'main',
      })
    })

    expect(queryClient.getQueryData(taskModelQueryKeys.tasks.detail('project-1', 'task-1'))).toEqual(task)
    expect(queryClient.getQueryState(taskModelQueryKeys.tasks.list('project-1', {}))?.isInvalidated).toBe(true)
  })

  it('invalidates Task and TaskRun queries when cancelling a Task', async () => {
    taskCancelMock.mockResolvedValue({ ...task, status: 'CANCELLED' })
    const taskList = queryClient.getQueryCache().build(queryClient, {
      queryKey: taskModelQueryKeys.tasks.list('project-1', {}),
      queryFn: async () => ({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req' }),
    })
    taskList.setData({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req' })
    const { result } = renderHook(() => useCancelTask('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => { await result.current.mutateAsync('task-1') })
    expect(queryClient.getQueryState(taskModelQueryKeys.tasks.list('project-1', {}))?.isInvalidated).toBe(true)
  })

  it('stores a server-created retry run and refreshes every Task view affected by the asynchronous retry', async () => {
    taskRunRetryMock.mockResolvedValue(taskRun)
    const seed = (queryKey: readonly unknown[]) => {
      const query = queryClient.getQueryCache().build(queryClient, { queryKey, queryFn: async () => null })
      query.setData(null)
    }
    seed(taskModelQueryKeys.tasks.list('project-1', {}))
    seed(taskModelQueryKeys.taskSteps.list('project-1', 'task-1', {}))
    const taskRunsListKey = taskModelQueryKeys.taskRuns.list('project-1', 'task-1', {})
    const taskRunsList = queryClient.getQueryCache().build<TaskModelPage<TaskRunSummary>>(queryClient, {
      queryKey: taskRunsListKey,
      queryFn: async () => ({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req-runs' }),
    })
    taskRunsList.setData({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req-runs' })
    seed(taskModelQueryKeys.taskArtifacts.all('project-1', 'task-1'))
    seed(taskModelQueryKeys.diffs.list('project-1', {}))
    seed(taskModelQueryKeys.taskDiffReview.detail('project-1', 'task-1'))
    seed(taskModelQueryKeys.workspaceDiffPreview.detail('project-1', 'task-1'))
    const { result } = renderHook(() => useRetryTaskRunModel('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => { await result.current.mutateAsync('run-1') })
    expect(queryClient.getQueryData(taskModelQueryKeys.taskRuns.detail('project-1', 'run-2'))).toEqual(taskRun)
    expect(queryClient.getQueryData<TaskModelPage<TaskRunSummary>>(taskRunsListKey)?.data).toEqual([taskRun])
    expect(queryClient.getQueryState(taskModelQueryKeys.tasks.list('project-1', {}))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.taskSteps.list('project-1', 'task-1', {}))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.taskRuns.list('project-1', 'task-1', {}))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.taskArtifacts.all('project-1', 'task-1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.diffs.list('project-1', {}))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.taskDiffReview.detail('project-1', 'task-1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.workspaceDiffPreview.detail('project-1', 'task-1'))?.isInvalidated).toBe(true)
  })

  it('refreshes Task and TaskStep projections after cancelling a TaskRun', async () => {
    const cancelledRun: TaskRunDetail = { ...taskRun, id: 'run-1', status: 'CANCELLED', retryOfTaskRunId: null }
    taskRunCancelMock.mockResolvedValue(cancelledRun)
    const seed = (queryKey: readonly unknown[]) => {
      const query = queryClient.getQueryCache().build(queryClient, { queryKey, queryFn: async () => null })
      query.setData(null)
    }
    seed(taskModelQueryKeys.tasks.list('project-1', {}))
    seed(taskModelQueryKeys.tasks.detail('project-1', 'task-1'))
    seed(taskModelQueryKeys.taskSteps.list('project-1', 'task-1', {}))
    seed(taskModelQueryKeys.taskRuns.list('project-1', 'task-1', {}))

    const { result } = renderHook(() => useCancelTaskRunModel('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => { await result.current.mutateAsync('run-1') })

    expect(queryClient.getQueryData(taskModelQueryKeys.taskRuns.detail('project-1', 'run-1'))).toEqual(cancelledRun)
    expect(queryClient.getQueryState(taskModelQueryKeys.tasks.list('project-1', {}))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.tasks.detail('project-1', 'task-1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.taskSteps.list('project-1', 'task-1', {}))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskModelQueryKeys.taskRuns.list('project-1', 'task-1', {}))?.isInvalidated).toBe(true)
  })

  it('stores accepted Diff details and refreshes the Diff list', async () => {
    const diff = {
      id: 'diff-1',
      projectId: 'project-1',
      taskId: 'task-1',
      taskRunId: null,
      taskStepId: null,
      requirementGroupId: 'group-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      baseCommit: 'abc',
      sourceBranch: 'feature/login',
      headCommit: 'abc123',
      status: 'ACCEPTED' as const,
      changeStats: { files: 1, additions: 1, deletions: 0 },
      createdAt: '2026-08-12T00:00:00Z',
      workingTreeHash: null,
      snapshotKey: null,
      reviewedBy: null,
      reviewReason: null,
      reviewedAt: null,
      updatedAt: '2026-08-12T00:00:00Z',
    }
    diffAcceptMock.mockResolvedValue(diff)
    const list = queryClient.getQueryCache().build(queryClient, {
      queryKey: taskModelQueryKeys.diffs.list('project-1', {}),
      queryFn: async () => ({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req' }),
    })
    list.setData({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req' })
    const { result } = renderHook(() => useAcceptDiff('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => { await result.current.mutateAsync('diff-1') })
    expect(queryClient.getQueryData(taskModelQueryKeys.diffs.detail('project-1', 'diff-1'))).toEqual(diff)
    expect(queryClient.getQueryState(taskModelQueryKeys.diffs.list('project-1', {}))?.isInvalidated).toBe(true)
  })

  it('accepts a TaskRun detail without steps', async () => {
    const { steps: _steps, ...detailWithoutSteps } = taskRun
    taskRunGetMock.mockResolvedValue(detailWithoutSteps)
    const { result } = renderHook(() => useTaskRun('project-1', 'run-2'), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.steps).toBeUndefined()
  })

  it('creates a merge request through the documented mutation', async () => {
    const created = {
      id: 'mr-1',
      repositoryId: 'repo-1',
      groupIds: ['group-1'],
      provider: 'GITHUB',
      number: 42,
      sourceBranch: 'feat/login-api',
      targetBranch: 'main',
      status: 'OPEN',
      headCommit: 'abc123',
      webUrl: null,
    }
    mergeRequestCreateMock.mockResolvedValue(created)
    const cached = queryClient.getQueryCache().build(queryClient, {
      queryKey: taskModelQueryKeys.mergeRequests.all('project-1'),
      queryFn: async () => [],
    })
    cached.setData([])
    const { result } = renderHook(() => useCreateMergeRequest('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({
        taskId: 'task-1',
        repositoryId: 'repo-1',
        targetBranch: 'main',
        title: '实现邮箱登录',
      })
    })
    expect(mergeRequestCreateMock).toHaveBeenCalledWith('project-1', {
      taskId: 'task-1',
      repositoryId: 'repo-1',
      targetBranch: 'main',
      title: '实现邮箱登录',
    })
    expect(queryClient.getQueryState(taskModelQueryKeys.mergeRequests.all('project-1'))?.isInvalidated).toBe(true)
  })

  it('writes a merged MR and invalidates the project MR queries', async () => {
    const merged = {
      id: 'mr-1',
      repositoryId: 'repo-1',
      groupIds: ['group-1'],
      provider: 'GITHUB',
      number: 42,
      sourceBranch: 'feat/login-api',
      targetBranch: 'main',
      status: 'MERGED' as const,
      headCommit: 'abc123',
      webUrl: null,
      qualityGate: { status: 'PASSED', requiredChecks: ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'] },
    }
    mergeRequestMergeMock.mockResolvedValue(merged)
    const list = queryClient.getQueryCache().build(queryClient, {
      queryKey: taskModelQueryKeys.mergeRequests.all('project-1'),
      queryFn: async () => [],
    })
    list.setData([])
    const { result } = renderHook(() => useMergeMergeRequest('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ mergeRequestId: 'mr-1' })
    })
    expect(mergeRequestMergeMock).toHaveBeenCalledWith('project-1', 'mr-1')
    expect(queryClient.getQueryData(taskModelQueryKeys.mergeRequests.detail('project-1', 'mr-1'))).toEqual(merged)
    expect(queryClient.getQueryState(taskModelQueryKeys.mergeRequests.all('project-1'))?.isInvalidated).toBe(true)
  })

  it('invalidates MR detail and checks after a CQ+1 stamp', async () => {
    const stamped = {
      id: 'mr-1',
      repositoryId: 'repo-1',
      groupIds: ['group-1'],
      provider: 'GITHUB',
      number: 42,
      sourceBranch: 'feat/login-api',
      targetBranch: 'main',
      status: 'OPEN' as const,
      headCommit: 'abc123',
      webUrl: null,
      qualityGate: { status: 'PENDING', requiredChecks: ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'] },
    }
    mergeRequestApproveCqMock.mockResolvedValue(stamped)
    const list = queryClient.getQueryCache().build(queryClient, {
      queryKey: taskModelQueryKeys.mergeRequests.all('project-1'),
      queryFn: async () => [],
    })
    list.setData([])
    const { result } = renderHook(() => useApproveMergeRequestCq('project-1'), { wrapper: wrapper(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ mergeRequestId: 'mr-1', input: { reason: 'LGTM' } })
    })
    expect(mergeRequestApproveCqMock).toHaveBeenCalledWith('project-1', 'mr-1', { reason: 'LGTM' })
    expect(queryClient.getQueryData(taskModelQueryKeys.mergeRequests.detail('project-1', 'mr-1'))).toEqual(stamped)
    expect(queryClient.getQueryState(taskModelQueryKeys.mergeRequests.all('project-1'))?.isInvalidated).toBe(true)
  })
})
