import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api'
import type { TaskListItem, TaskModelPage } from '@/types/task-model'

const useInfiniteTasksMock = vi.hoisted(() => vi.fn())
const useTaskMock = vi.hoisted(() => vi.fn())
const useTaskStepsMock = vi.hoisted(() => vi.fn())
const useTaskRunsMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/task-model', () => ({ useInfiniteTasks: useInfiniteTasksMock, useTask: useTaskMock, useTaskSteps: useTaskStepsMock, useTaskRuns: useTaskRunsMock }))

import TaskCenterPage from './TaskCenterPage'

const task: TaskListItem = {
  id: 'task-1', displayCode: 'T-1', projectId: 'project-test', title: '新任务', requirementSummary: '实现功能', status: 'RUNNING', deliveryMode: 'DIFF_FIRST', deliveryReason: null,
  requirementGroup: { id: 'group-1', name: '登录', status: 'ACTIVE' }, createdByUser: { id: 'creator-1', displayName: 'Creator', avatarUrl: null }, repositories: [],
  executionSummary: { totalSteps: 0, pendingSteps: 0, runningSteps: 1, waitingSteps: 0, blockedSteps: 0, succeededSteps: 0, failedSteps: 0, currentStage: null, currentStageTitle: null, requiresUserAction: false }, attention: null, statusReason: null,
  createdAt: '2026-08-11T08:00:00Z', updatedAt: '2026-08-11T08:30:00Z',
}

function page(data: TaskListItem[]): TaskModelPage<TaskListItem> { return { data, page: { nextCursor: null, hasMore: false }, requestId: 'request-1' } }
function result(overrides: Record<string, unknown> = {}) { return { data: { pages: [page([task])], pageParams: [undefined] }, error: null, isError: false, isFetching: false, isLoading: false, hasNextPage: false, isFetchNextPageError: false, refetch: vi.fn(), fetchNextPage: vi.fn(), ...overrides } }
function renderPage(entry = '/app/projects/project-test/tasks') { return render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/app/projects/:projectId/tasks" element={<><TaskCenterPage /><LocationProbe /></>} /><Route path="/app/projects/:projectId/tasks/:taskId" element={<><output data-testid="detail-route">detail</output><LocationProbe /></>} /></Routes></MemoryRouter>) }
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }

beforeEach(() => {
  useInfiniteTasksMock.mockReset()
  useInfiniteTasksMock.mockReturnValue(result())
  useTaskMock.mockReset()
  useTaskStepsMock.mockReset()
  useTaskRunsMock.mockReset()
})

describe('TaskCenterPage', () => {
  it('requests only the Task list with official filters', () => {
    renderPage('/app/projects/project-test/tasks?groupId=group-1&status=RUNNING&createdBy=creator-1')
    expect(useInfiniteTasksMock).toHaveBeenCalledWith('project-test', { groupId: 'group-1', status: 'RUNNING', excludeStatus: undefined, createdBy: 'creator-1', repositoryId: undefined, keyword: undefined, limit: 20 })
    expect(useTaskMock).not.toHaveBeenCalled()
    expect(useTaskStepsMock).not.toHaveBeenCalled()
    expect(useTaskRunsMock).not.toHaveBeenCalled()
    expect(screen.getByText('新任务')).toBeInTheDocument()
  })

  it('opens TaskDetail from a card and preserves filter parameters for return', async () => {
    const user = userEvent.setup()
    renderPage('/app/projects/project-test/tasks?groupId=group-1&status=RUNNING')
    await user.click(screen.getByRole('button', { name: /新任务/ }))
    expect(screen.getByTestId('detail-route')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/app/projects/project-test/tasks/task-1?groupId=group-1&status=RUNNING')
  })

  it('redirects legacy taskId links to TaskDetail and preserves filters', async () => {
    renderPage('/app/projects/project-test/tasks?taskId=task-1&status=RUNNING&groupId=group-1')
    await waitFor(() => expect(screen.getByTestId('detail-route')).toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent('/app/projects/project-test/tasks/task-1?status=RUNNING&groupId=group-1')
  })

  it('shows loading and permission states', () => {
    useInfiniteTasksMock.mockReturnValue(result({ data: undefined, isLoading: true, isFetching: true }))
    const { rerender } = renderPage()
    expect(screen.getByText('正在加载任务')).toBeInTheDocument()
    useInfiniteTasksMock.mockReturnValue(result({ data: undefined, isLoading: false, isError: true, error: new ApiError('forbidden', 403) }))
    rerender(<MemoryRouter initialEntries={['/app/projects/project-test/tasks']}><Routes><Route path="/app/projects/:projectId/tasks" element={<TaskCenterPage />} /></Routes></MemoryRouter>)
    expect(screen.getByText('暂无权限查看任务')).toBeInTheDocument()
  })

  it('uses the server batch size for pagination instead of splitting one batch by viewport size', () => {
    const tasks = Array.from({ length: 20 }, (_, index) => ({ ...task, id: `task-${index + 1}`, title: `Task ${index + 1}` }))
    useInfiniteTasksMock.mockReturnValue(result({ data: { pages: [page(tasks)], pageParams: [undefined] } }))

    const { container } = renderPage()

    expect(screen.getByText('Task 1')).toBeInTheDocument()
    expect(screen.getByText('Task 20')).toBeInTheDocument()
    expect(container.querySelector('.ant-pagination-item-active')).toHaveTextContent('1')
  })

  it('delegates completed-task hiding to the server excludeStatus filter and shows them on demand', async () => {
    const user = userEvent.setup()
    useInfiniteTasksMock.mockReturnValue(result({
      data: { pages: [page([task])], pageParams: [undefined] },
    }))

    renderPage()

    // 默认（无显式筛选）隐藏已完成任务：请求携带 excludeStatus=SUCCEEDED，由服务端过滤保证分页正确。
    expect(screen.getByText('新任务')).toBeInTheDocument()
    expect(useInfiniteTasksMock).toHaveBeenLastCalledWith('project-test', expect.objectContaining({ excludeStatus: 'SUCCEEDED' }))
    // 切换「查看已完成任务」→ scope=all → 不再排除 SUCCEEDED；服务端返回的数据直接展示（不再本地过滤）。
    await user.click(screen.getByRole('button', { name: '查看已完成任务' }))
    expect(useInfiniteTasksMock).toHaveBeenLastCalledWith('project-test', expect.objectContaining({ excludeStatus: undefined }))
    expect(screen.getByTestId('location')).toHaveTextContent('scope=all')
  })

  it('does not show stale failure attention while the task is running a retry', () => {
    const retryingTask: TaskListItem = {
      ...task,
      attention: { kind: 'EXECUTION_FAILED', title: '执行失败', summary: 'Agent 执行超时', taskRunId: 'run-old', inputRequestId: null, diffReviewBatchId: null, repositoryId: null, createdAt: task.updatedAt },
      executionSummary: { ...task.executionSummary, runningSteps: 1, failedSteps: 1 },
    }
    useInfiniteTasksMock.mockReturnValue(result({ data: { pages: [page([retryingTask])], pageParams: [undefined] } }))

    renderPage()

    expect(screen.queryByText('执行失败：Agent 执行超时')).not.toBeInTheDocument()
  })

  it('keeps rendering when a new Task list item lacks derived summaries', () => {
    const incompleteTask = {
      ...task,
      id: 'task-incomplete',
      title: '新创建任务',
      repositories: undefined,
      executionSummary: undefined,
    } as unknown as TaskListItem
    useInfiniteTasksMock.mockReturnValue(result({
      data: { pages: [page([incompleteTask])], pageParams: [undefined] },
    }))

    renderPage()

    expect(screen.getByText('新创建任务')).toBeInTheDocument()
    expect(screen.getAllByText('暂无').length).toBeGreaterThan(0)
  })
})
