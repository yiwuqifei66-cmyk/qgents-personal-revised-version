import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api'
import { useTaskNoCodeChangeStore } from '@/store/taskNoCodeChangeStore'
import type { DiffListItem, DiffReviewBatch, Task, TaskModelPage, TaskRunDetail, TaskRunSummary, TaskStep } from '@/types/task-model'

const useTaskMock = vi.hoisted(() => vi.fn())
const useTaskDiagnosticsMock = vi.hoisted(() => vi.fn())
const useTaskStepsMock = vi.hoisted(() => vi.fn())
const useTaskRunsMock = vi.hoisted(() => vi.fn())
const useCancelTaskMock = vi.hoisted(() => vi.fn())
const useDiffsMock = vi.hoisted(() => vi.fn())
const useTaskArtifactsMock = vi.hoisted(() => vi.fn())
const useTaskDiffReviewMock = vi.hoisted(() => vi.fn())
const useConfirmTaskDiffReviewMock = vi.hoisted(() => vi.fn())
const useRejectTaskDiffReviewMock = vi.hoisted(() => vi.fn())
const useRetryTaskDiffReviewDeliveryMock = vi.hoisted(() => vi.fn())
const useTaskRunMock = vi.hoisted(() => vi.fn())
const useInfiniteTaskRunLogsMock = vi.hoisted(() => vi.fn())
const useTaskRunDiagnosticsMock = vi.hoisted(() => vi.fn())
const useTaskRunExecutionContextMock = vi.hoisted(() => vi.fn())
const useTaskRunInputRequestsMock = vi.hoisted(() => vi.fn())
const useRetryTaskRunModelMock = vi.hoisted(() => vi.fn())
const useCancelTaskRunModelMock = vi.hoisted(() => vi.fn())
const useReplyTaskRunInputRequestMock = vi.hoisted(() => vi.fn())
const useApproveTaskRunInputRequestMock = vi.hoisted(() => vi.fn())
const useRejectTaskRunInputRequestMock = vi.hoisted(() => vi.fn())
const useWorkspaceDiffPreviewMock = vi.hoisted(() => vi.fn())
const useWorkspaceDiffPreviewFilesMock = vi.hoisted(() => vi.fn())
const useWorkspaceDiffPreviewFilePatchMock = vi.hoisted(() => vi.fn())

const usePreflightMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/task-model', () => ({
  useTask: useTaskMock,
  useTaskDiagnostics: useTaskDiagnosticsMock,
  useTaskSteps: useTaskStepsMock,
  useTaskRuns: useTaskRunsMock,
  useCancelTask: useCancelTaskMock,
  useDiffs: useDiffsMock,
  useTaskArtifacts: useTaskArtifactsMock,
  useTaskDiffReview: useTaskDiffReviewMock,
  useConfirmTaskDiffReview: useConfirmTaskDiffReviewMock,
  useRejectTaskDiffReview: useRejectTaskDiffReviewMock,
  useRetryTaskDiffReviewDelivery: useRetryTaskDiffReviewDeliveryMock,
  useTaskRun: useTaskRunMock,
  useInfiniteTaskRunLogs: useInfiniteTaskRunLogsMock,
  useTaskRunDiagnostics: useTaskRunDiagnosticsMock,
  useTaskRunExecutionContext: useTaskRunExecutionContextMock,
  useTaskRunInputRequests: useTaskRunInputRequestsMock,
  useRetryTaskRunModel: useRetryTaskRunModelMock,
  useCancelTaskRunModel: useCancelTaskRunModelMock,
  useReplyTaskRunInputRequest: useReplyTaskRunInputRequestMock,
  useApproveTaskRunInputRequest: useApproveTaskRunInputRequestMock,
  useRejectTaskRunInputRequest: useRejectTaskRunInputRequestMock,
}))

vi.mock('@/hooks/qualityGate', () => ({
  usePreflight: usePreflightMock,
}))
vi.mock('@/hooks/workspaceDiffPreview', () => ({
  useWorkspaceDiffPreview: useWorkspaceDiffPreviewMock,
  useWorkspaceDiffPreviewFiles: useWorkspaceDiffPreviewFilesMock,
  useWorkspaceDiffPreviewFilePatch: useWorkspaceDiffPreviewFilePatchMock,
}))
vi.mock('../PreflightPanel', () => ({
  PreflightPanel: () => <div data-testid="preflight-panel-content" />,
}))

import TaskDetailPage from './TaskDetailPage'

const task: Task = {
  id: 'task-1', displayCode: 'T-1', projectId: 'project-test', title: '登录任务', requirementSummary: '实现登录功能', status: 'RUNNING', deliveryMode: 'DIFF_FIRST', deliveryReason: null,
  requirementGroup: { id: 'group-1', name: '登录功能', status: 'ACTIVE' }, createdByUser: { id: 'user-1', displayName: 'User', avatarUrl: null },
  repositories: [{ repositoryId: 'repo-1', name: 'Web 前端', fullName: 'mock/web', provider: 'GITHUB', defaultBranch: 'main', baseRef: 'main', baseCommit: 'base-1', sourceBranch: 'feat/login', headCommit: 'head-1' }],
  executionSummary: { totalSteps: 1, pendingSteps: 0, runningSteps: 1, waitingSteps: 0, blockedSteps: 0, succeededSteps: 0, failedSteps: 0, currentStage: 'DEVELOPER', currentStageTitle: '开发实现', requiresUserAction: false },
  attention: null, statusReason: null, createdAt: '2026-08-11T08:00:00Z', updatedAt: '2026-08-11T08:30:00Z', requirement: '实现登录页面与接口校验，完成后提交可审查的代码变更。', acceptanceCriteria: [], workspace: null,
  capabilities: { canCancel: true, canReplacePendingStepAgent: false, canConfirmDiffReview: false, canRejectDiffReview: false, canRetryDelivery: false }, artifactSummary: { total: 0, byType: {} },
  diffReviewSummary: { available: false, reviewStatus: null, deliveryStatus: null, repositoryCount: 0, filesChanged: 0, additions: 0, deletions: 0 }, sourceMessage: null, triggerMessageId: null,
}
const run: TaskRunDetail = { id: 'run-1', taskId: task.id, taskStepId: 'step-1', taskStepTitle: '开发登录接口', agent: null, role: 'DEVELOPER', status: 'RUNNING', retryOfTaskRunId: null, statusSummary: '正在修改 API', statusReason: null, startedAt: '2026-08-11T08:00:00Z', finishedAt: null, durationMs: 1000, artifactSummary: { total: 0, diffCount: 0 }, createdAt: '2026-08-11T08:00:00Z', updatedAt: '2026-08-11T08:30:00Z', steps: [] }
const step: TaskStep = { id: 'step-1', taskId: task.id, sequenceNo: 1, title: '开发登录接口', description: null, role: 'DEVELOPER', agent: { id: 'agent-1', name: '开发 Agent', role: 'DEVELOPER', avatarUrl: null, status: 'ACTIVE' }, repository: { repositoryId: 'repo-1', name: 'Web 前端', sourceBranch: 'feat/login' }, dependencies: [], status: 'RUNNING', acceptanceNotes: '覆盖登录场景', latestRun: { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs }, runCount: 1, startedAt: run.startedAt, finishedAt: run.finishedAt, createdAt: run.createdAt, updatedAt: run.updatedAt }

function page<T>(data: T[]): TaskModelPage<T> { return { data, page: { nextCursor: null, hasMore: false }, requestId: 'request-1' } }
function renderPage(path = '/app/projects/project-test/tasks/task-1') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/app/projects/:projectId/tasks/:taskId" element={<><TaskDetailPage /><LocationProbe /></>} /></Routes></MemoryRouter>) }
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
const idleMutation = { mutate: vi.fn(), error: null, isPending: false }
const idleQuery = { data: undefined, error: null, isError: false, isLoading: false, refetch: vi.fn() }

beforeEach(() => {
  useTaskNoCodeChangeStore.getState().clearAllCompletedWithoutCode()
  useTaskMock.mockReturnValue({ data: task, error: null, isError: false, isLoading: false, refetch: vi.fn() })
  useTaskDiagnosticsMock.mockReturnValue({ ...idleQuery, data: { taskId: task.id, status: task.status, stage: 'CODING', failure: null, latestFailedRun: null } })
  useTaskStepsMock.mockReturnValue({ data: page([step]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
  useTaskRunsMock.mockReturnValue({ data: page<TaskRunSummary>([run]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
  useCancelTaskMock.mockReturnValue(idleMutation)
  useDiffsMock.mockReturnValue({ data: page<DiffListItem>([]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
  useTaskArtifactsMock.mockReturnValue({ data: [], error: null, isError: false, isLoading: false })
  useTaskDiffReviewMock.mockReturnValue(idleQuery)
  useConfirmTaskDiffReviewMock.mockReturnValue(idleMutation)
  useRejectTaskDiffReviewMock.mockReturnValue(idleMutation)
  useRetryTaskDiffReviewDeliveryMock.mockReturnValue(idleMutation)
  useTaskRunMock.mockReturnValue({ ...idleQuery, data: run })
  useInfiniteTaskRunLogsMock.mockReturnValue({ data: { pages: [{ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'req-1' }], pageParams: [undefined] }, error: null, isError: false, isLoading: false, isFetching: false, isFetchingNextPage: false, hasNextPage: false, isFetchNextPageError: false, refetch: vi.fn(), fetchNextPage: vi.fn() })
  useTaskRunDiagnosticsMock.mockReturnValue({ ...idleQuery, data: { taskRunId: run.id, taskId: run.taskId, status: run.status, stage: 'CODING', failure: null, workerExecutions: [] } })
  usePreflightMock.mockReturnValue({ data: undefined, error: null, isError: false, isLoading: false, isFetching: false, refetch: vi.fn() })
  useTaskRunExecutionContextMock.mockReturnValue(idleQuery)
  useTaskRunInputRequestsMock.mockReturnValue({ data: page([]), error: null, isError: false, isLoading: false })
  useRetryTaskRunModelMock.mockReturnValue(idleMutation)
  useCancelTaskRunModelMock.mockReturnValue(idleMutation)
  useReplyTaskRunInputRequestMock.mockReturnValue(idleMutation)
  useApproveTaskRunInputRequestMock.mockReturnValue(idleMutation)
  useRejectTaskRunInputRequestMock.mockReturnValue(idleMutation)
  useWorkspaceDiffPreviewMock.mockReturnValue({ data: { kind: 'unavailable', reason: 'NOT_FOUND', message: 'Preview 尚未生成' }, isLoading: false, isError: false, refetch: vi.fn() })
  useWorkspaceDiffPreviewFilesMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  useWorkspaceDiffPreviewFilePatchMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
})

describe('TaskDetailPage workbench', () => {
  it('renders the MR_FIRST preflight panel without a duplicate attention banner', () => {
    useTaskMock.mockReturnValue({
      data: {
        ...task,
        status: 'WAITING_PREFLIGHT',
        deliveryMode: 'MR_FIRST',
        attention: {
          kind: 'PREFLIGHT_REQUIRED',
          title: '等待 MR 前预检',
          summary: '代码已推送；请完成 Dry Run 和独立成员 CQ+1 后创建 MR',
          taskRunId: null,
          inputRequestId: null,
          diffReviewBatchId: 'batch-1',
          repositoryId: null,
          createdAt: task.updatedAt,
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByTestId('preflight-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('task-attention-banner')).not.toBeInTheDocument()
  })

  it('renders recent executions, delivery and the embedded run inspector without legacy rows or Tabs', () => {
    renderPage()
    expect(screen.getByTestId('task-summary')).toBeInTheDocument()
    expect(screen.getByTestId('execution-flow-row')).toBeInTheDocument()
    expect(screen.getByTestId('recent-execution-panel')).toBeInTheDocument()
    expect(screen.getByTestId('delivery-panel')).toBeInTheDocument()
    expect(screen.getByTestId('run-inspector-panel')).toBeInTheDocument()
    expect(within(screen.getByTestId('delivery-panel')).getByTestId('workspace-diff-preview-card')).toBeInTheDocument()
    expect(screen.queryByTestId('mission-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('requirement-context-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('output-delivery-row')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses skeleton cards while the planner is generating task steps', () => {
    useTaskMock.mockReturnValue({ data: { ...task, status: 'PLANNING', executionSummary: { ...task.executionSummary, totalSteps: 0, runningSteps: 0, currentStage: null, currentStageTitle: '规划中' } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskStepsMock.mockReturnValue({ data: page<TaskStep>([]), error: null, isError: false, isLoading: false })
    renderPage()
    expect(screen.queryByText('规划 Agent 正在生成执行方案')).not.toBeInTheDocument()
    expect(screen.queryByTestId('execution-flow-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('current-execution-card')).not.toBeInTheDocument()
    // Three skeleton step cards are rendered
    expect(screen.getAllByTestId('planning-step-card').length).toBe(3)
  })

  it('selects an embedded single-run inspector and preserves the run id in the URL', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: '查看最新运行' }))
    expect(screen.getByTestId('run-inspector-panel')).toBeInTheDocument()
    expect(within(screen.getByTestId('run-inspector-panel')).getByText('开发登录接口')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('runId=run-1')
  })

  it('clears the default latest-run selection from blank recent-execution space and synchronizes the inspector', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(within(screen.getByTestId('run-inspector-panel')).getByText('开发登录接口')).toBeInTheDocument()
    await user.click(screen.getByTestId('recent-execution-blank'))
    expect(within(screen.getByTestId('run-inspector-panel')).getByText('选择一条执行记录查看详情')).toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('runId=')
  })

  it('keeps task-level acceptance information in the right inspector and keeps the source context conditional', () => {
    useTaskMock.mockReturnValue({ data: { ...task, acceptanceCriteria: [{ id: 'criterion-1', title: '登录接口可用', description: null, status: 'SATISFIED' }] }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    const inspector = screen.getByTestId('run-inspector-panel')
    expect(within(inspector).getByText('验收信息 1/1')).toBeInTheDocument()
    expect(within(inspector).getByText('登录接口可用')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看原始讨论' })).not.toBeInTheDocument()
  })

  it('keeps a requirement excerpt in the header information row without the legacy source jump link', () => {
    renderPage()
    expect(screen.getByText('需求说明')).toBeInTheDocument()
    expect(screen.getByText('实现登录页面与接口校验，完成后提交可审查的代码变更。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看完整需求' })).not.toBeInTheDocument()
  })

  it('renders workspace preview in the code-workspace position while the task is running without a formal Diff', () => {
    useWorkspaceDiffPreviewMock.mockReturnValue({ data: { kind: 'available', preview: { projectId: task.projectId, taskId: task.id, taskRunId: run.id, workspaceId: 'workspace-1', revision: 2, baseCommit: 'base-1', workingTreeHash: 'sha256:preview', filesChanged: 2, additions: 8, deletions: 3, patch: 'diff --git a/a.txt b/a.txt', createdAt: run.createdAt } }, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const deliveryPanel = screen.getByTestId('delivery-panel')
    expect(within(deliveryPanel).getByTestId('workspace-diff-preview-summary')).toHaveTextContent('实时预览：2 个文件 · +8 / -3 · revision 2')
    expect(within(screen.getByTestId('recent-execution-panel')).queryByTestId('workspace-diff-preview-card')).not.toBeInTheDocument()
    expect(within(deliveryPanel).queryByTestId('code-delivery-card')).not.toBeInTheDocument()
  })

  it('collapses and restores the run inspector sidebar', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: '隐藏本次执行侧栏' }))
    expect(screen.queryByTestId('run-inspector-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开本次执行侧栏' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '展开本次执行侧栏' }))
    expect(screen.getByTestId('run-inspector-panel')).toBeInTheDocument()
  })

  it('hides Git patch metadata and renders editor-like line numbers with diff markers', async () => {
    const user = userEvent.setup()
    useWorkspaceDiffPreviewMock.mockReturnValue({ data: { kind: 'available', preview: { projectId: task.projectId, taskId: task.id, taskRunId: run.id, workspaceId: 'workspace-1', revision: 2, baseCommit: 'base-1', workingTreeHash: 'sha256:preview', filesChanged: 1, additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old line\n+new line', createdAt: run.createdAt } }, isLoading: false, isError: false, refetch: vi.fn() })
    useWorkspaceDiffPreviewFilesMock.mockReturnValue({ data: [{ repositoryId: null, repositoryPath: 'web', path: 'src/login.ts', changeType: 'MODIFIED', additions: 1, deletions: 1, binary: false }], isLoading: false, isError: false, refetch: vi.fn() })
    useWorkspaceDiffPreviewFilePatchMock.mockReturnValue({ data: { revision: 2, repositoryId: 'repo-1', path: 'src/login.ts', changeType: 'MODIFIED', additions: 1, deletions: 1, binary: false, patch: 'diff --git a/src/login.ts b/src/login.ts\nnew file mode 100644\nindex 123..456 100644\n--- a/src/login.ts\n+++ b/src/login.ts\n@@ -4,2 +4,2 @@\n-old line\n+new line\n context line' }, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    await user.click(screen.getByText('查看实时 Diff'))
    await user.click(screen.getByRole('button', { name: /src\/login\.ts/ }))
    const preview = screen.getByTestId('workspace-diff-preview-patch')
    expect(preview).toHaveTextContent('-old line')
    expect(preview).toHaveTextContent('+new line')
    expect(preview).not.toHaveTextContent('diff --git')
    expect(preview).not.toHaveTextContent('new file mode 100644')
    expect(preview).toHaveTextContent('context line')
    expect(screen.getByTestId('workspace-diff-line-workspaceDiffPreviewPatchDeleted')).toHaveTextContent('-old line')
    expect(screen.getByTestId('workspace-diff-line-workspaceDiffPreviewPatchAdded')).toHaveTextContent('+new line')
    expect(screen.getAllByTestId('workspace-diff-old-line-number').map((element) => element.textContent)).toEqual(['4', '', '5'])
    expect(screen.getAllByTestId('workspace-diff-new-line-number').map((element) => element.textContent)).toEqual(['', '4', '5'])
  })

  it('keeps the workspace preview visible after execution failure for diagnosis', () => {
    useTaskMock.mockReturnValue({ data: { ...task, status: 'FAILED' }, isLoading: false, isError: false, error: null, refetch: vi.fn() })
    renderPage()
    expect(within(screen.getByTestId('delivery-panel')).getByTestId('workspace-diff-preview-card')).toBeInTheDocument()
    expect(screen.queryByTestId('code-delivery-card')).not.toBeInTheDocument()
  })

  it('keeps failure details in the selected run without a duplicate attention banner', async () => {
    const failedRun = { ...run, status: 'FAILED' as const, statusReason: { code: 'EXECUTION_FAILED' as const, failureCode: 'PATCH_FAILED', title: '执行失败', summary: '补丁无法应用', retryable: true, occurredAt: run.updatedAt } }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'FAILED', statusReason: { code: 'STARTUP_FAILED', title: '任务启动失败', summary: '不应重复显示', retryable: true }, attention: { kind: 'EXECUTION_FAILED', title: '执行失败', summary: '补丁无法应用', taskRunId: failedRun.id, inputRequestId: null, diffReviewBatchId: null, repositoryId: null } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskDiagnosticsMock.mockReturnValue({ ...idleQuery, data: { taskId: task.id, status: 'FAILED', stage: 'CODING', failure: failedRun.statusReason, latestFailedRun: { taskRunId: failedRun.id, taskStepId: step.id, taskStepTitle: step.title, status: 'FAILED', startedAt: run.startedAt, finishedAt: run.updatedAt } } })
    const refetchRun = vi.fn()
    useTaskRunMock.mockReturnValue({ ...idleQuery, data: failedRun, refetch: refetchRun })
    useTaskRunDiagnosticsMock.mockReturnValue({ ...idleQuery, data: { taskRunId: failedRun.id, taskId: task.id, status: 'FAILED', stage: 'CODING', failure: failedRun.statusReason, workerExecutions: [] } })
    renderPage()
    expect(screen.queryByTestId('task-attention-banner')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('run-inspector-panel')).getByText('PATCH_FAILED')).toBeInTheDocument()
    expect(within(screen.getByTestId('run-inspector-panel')).getByText('执行失败：补丁无法应用')).toBeInTheDocument()
    expect(refetchRun).toHaveBeenCalledTimes(1)
  })

  it('keeps delivery confirmation actions in the delivery panel', async () => {
    const user = userEvent.setup()
    const batch: DiffReviewBatch = { id: 'batch-1', taskId: task.id, reviewStatus: 'PENDING_CONFIRMATION', confirmationSource: 'USER', deliveryStatus: 'NOT_STARTED', aggregateHash: 'hash', reviewReason: null, diffs: [], repositoryDeliveries: [] }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'WAITING_DIFF_CONFIRMATION', capabilities: { ...task.capabilities, canConfirmDiffReview: true, canRejectDiffReview: true } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskDiffReviewMock.mockReturnValue({ data: batch, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    expect(within(screen.getByTestId('delivery-card')).getByRole('button', { name: '确认交付' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '拒绝交付' }))
    expect(screen.getByPlaceholderText('请填写拒绝原因')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交拒绝' })).toBeDisabled()
  })

  it('uses server capabilities for a multi-repository delivery even when the batch source is not USER', () => {
    const batch: DiffReviewBatch = { id: 'batch-multi', taskId: task.id, reviewStatus: 'PENDING_CONFIRMATION', confirmationSource: 'SYSTEM', deliveryStatus: 'NOT_STARTED', aggregateHash: 'hash', reviewReason: null, diffs: [], repositoryDeliveries: [] }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'WAITING_DIFF_CONFIRMATION', capabilities: { ...task.capabilities, canConfirmDiffReview: true, canRejectDiffReview: true } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskDiffReviewMock.mockReturnValue({ data: batch, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    const panel = screen.getByTestId('delivery-card')
    expect(within(panel).getByRole('button', { name: '确认交付' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '拒绝交付' })).toBeInTheDocument()
  })

  it('renders an explicit refreshable state when delivery fields are incomplete', () => {
    useTaskMock.mockReturnValue({ data: { ...task, status: 'WAITING_DIFF_CONFIRMATION', capabilities: { ...task.capabilities, canConfirmDiffReview: true } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskDiffReviewMock.mockReturnValue({ data: { id: 'batch-incomplete', taskId: task.id } as DiffReviewBatch, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    const panel = screen.getByTestId('delivery-card')
    expect(within(panel).getByText('交付信息不完整，请刷新')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '刷新交付状态' })).toBeInTheDocument()
  })

  it('shows a superseded Diff batch as read-only without confirmation actions', () => {
    const batch: DiffReviewBatch = { id: 'batch-superseded', taskId: task.id, reviewStatus: 'SUPERSEDED', confirmationSource: 'USER', deliveryStatus: 'NOT_STARTED', aggregateHash: 'hash', reviewReason: null, diffs: [], repositoryDeliveries: [] }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'WAITING_DIFF_CONFIRMATION', capabilities: { ...task.capabilities, canConfirmDiffReview: false, canRejectDiffReview: false } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskDiffReviewMock.mockReturnValue({ data: batch, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    const panel = screen.getByTestId('delivery-card')
    expect(within(panel).getByText('已被后续修改取代')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: '确认交付' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: '拒绝交付' })).not.toBeInTheDocument()
  })

  it('guides users back to the requirement group after a delivery rejection', () => {
    const batch: DiffReviewBatch = { id: 'batch-rejected', taskId: task.id, reviewStatus: 'REJECTED', confirmationSource: 'USER', deliveryStatus: 'FAILED', aggregateHash: 'hash', reviewReason: '请补充错误处理', diffs: [], repositoryDeliveries: [] }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'DIFF_REJECTED', capabilities: { ...task.capabilities, canConfirmDiffReview: false, canRejectDiffReview: false } }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskDiffReviewMock.mockReturnValue({ data: batch, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    const panel = screen.getByTestId('delivery-card')
    expect(within(panel).getByText('拒绝原因：请补充错误处理')).toBeInTheDocument()
    expect(within(panel).getByText('请回需求群根据拒绝意见继续修改。')).toBeInTheDocument()
  })

  it('isolates run record errors without hiding delivery or the inspector', () => {
    useTaskRunsMock.mockReturnValue({ data: undefined, error: new Error('runs failed'), isError: true, isLoading: false })
    renderPage()
    expect(screen.getByText('执行记录加载失败')).toBeInTheDocument()
    expect(screen.getByTestId('run-inspector-panel')).toBeInTheDocument()
    expect(within(screen.getByTestId('delivery-panel')).getByTestId('workspace-diff-preview-card')).toBeInTheDocument()
  })

  it('does not offer retry for an old failed run that already has a newer retry', () => {
    const oldFailedRun: TaskRunDetail = {
      ...run,
      id: 'run-old-failed',
      status: 'FAILED',
      updatedAt: '2026-08-11T08:10:00Z',
    }
    const newerRetry: TaskRunSummary = {
      ...oldFailedRun,
      id: 'run-newer-retry',
      retryOfTaskRunId: oldFailedRun.id,
      updatedAt: '2026-08-11T08:20:00Z',
    }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'FAILED' }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunsMock.mockReturnValue({ data: page<TaskRunSummary>([newerRetry, oldFailedRun]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunMock.mockReturnValue({ data: oldFailedRun, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage(`/app/projects/${task.projectId}/tasks/${task.id}?runId=${oldFailedRun.id}`)
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('offers retry for the latest failed run even when the diagnostic marks it non-retryable', () => {
    const failedRun: TaskRunDetail = {
      ...run,
      status: 'FAILED',
      statusReason: { code: 'EXECUTION_FAILED', failureCode: 'WORKER_UNAVAILABLE', title: '执行失败', summary: '执行基础设施暂不可用', retryable: false, occurredAt: run.updatedAt },
    }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'FAILED' }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunsMock.mockReturnValue({ data: page<TaskRunSummary>([failedRun]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunMock.mockReturnValue({ data: failedRun, error: null, isError: false, isLoading: false, refetch: vi.fn() })

    renderPage(`/app/projects/${task.projectId}/tasks/${task.id}?runId=${failedRun.id}`)

    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument()
  })

  it('does not allow retry after the Task has been cancelled', () => {
    const cancelledRun: TaskRunDetail = { ...run, status: 'CANCELLED', statusSummary: '执行已取消' }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'CANCELLED' }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunsMock.mockReturnValue({ data: page<TaskRunSummary>([cancelledRun]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunMock.mockReturnValue({ data: cancelledRun, error: null, isError: false, isLoading: false, refetch: vi.fn() })

    renderPage(`/app/projects/${task.projectId}/tasks/${task.id}?runId=${cancelledRun.id}`)

    expect(screen.getByText('执行已取消')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重\s*试/ })).not.toBeInTheDocument()
  })

  it('does not allow cancelling a queued run after the Task has been cancelled', () => {
    const queuedRun: TaskRunDetail = { ...run, status: 'QUEUED', statusSummary: '等待执行', startedAt: null, finishedAt: null, durationMs: null }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'CANCELLED' }, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunsMock.mockReturnValue({ data: page<TaskRunSummary>([queuedRun]), error: null, isError: false, isLoading: false, refetch: vi.fn() })
    useTaskRunMock.mockReturnValue({ data: queuedRun, error: null, isError: false, isLoading: false, refetch: vi.fn() })

    renderPage(`/app/projects/${task.projectId}/tasks/${task.id}?runId=${queuedRun.id}`)

    expect(screen.queryByRole('button', { name: '取消本次执行' })).not.toBeInTheDocument()
  })

  it('immediately selects the TaskRun returned by retry and exits the transition after the list refreshes', async () => {
    const user = userEvent.setup()
    const sourceRun: TaskRunDetail = { ...run, id: 'run-retry-source', status: 'FAILED', statusReason: { code: 'EXECUTION_FAILED', failureCode: 'PATCH_FAILED', title: '执行失败', summary: '补丁无法应用', retryable: true, occurredAt: '2026-08-11T08:40:00Z' }, updatedAt: '2026-08-11T08:40:00Z' }
    const replacementRun: TaskRunDetail = { ...sourceRun, id: 'run-retry-replacement', status: 'RUNNING', retryOfTaskRunId: sourceRun.id, updatedAt: '2026-08-11T08:41:00Z' }
    let taskData: Task = { ...task, status: 'FAILED' }
    let runData: TaskRunSummary[] = [sourceRun]
    const retryMutate = vi.fn((_taskRunId: string, callbacks?: { onSuccess?: (nextRun: TaskRunDetail) => void; onSettled?: () => void }) => {
      callbacks?.onSuccess?.(replacementRun)
      callbacks?.onSettled?.()
    })

    useTaskMock.mockImplementation(() => ({ data: taskData, error: null, isError: false, isLoading: false, refetch: vi.fn() }))
    useTaskRunsMock.mockImplementation(() => ({ data: page(runData), error: null, isError: false, isLoading: false, refetch: vi.fn() }))
    useTaskRunMock.mockImplementation(() => ({ ...idleQuery, data: sourceRun }))
    useRetryTaskRunModelMock.mockReturnValue({ ...idleMutation, mutate: retryMutate })

    const view = renderPage(`/app/projects/${task.projectId}/tasks/${task.id}?runId=${sourceRun.id}`)
    await user.click(screen.getByRole('button', { name: /重\s*试/ }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`runId=${replacementRun.id}`))

    taskData = { ...taskData, status: 'RUNNING' }
    runData = [replacementRun, sourceRun]
    view.rerender(<MemoryRouter initialEntries={[`/app/projects/${task.projectId}/tasks/${task.id}?runId=${replacementRun.id}`]}><Routes><Route path="/app/projects/:projectId/tasks/:taskId" element={<><TaskDetailPage /><LocationProbe /></>} /></Routes></MemoryRouter>)

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`runId=${replacementRun.id}`))
    expect(screen.queryByText('重试已受理，正在等待服务端返回运行记录')).not.toBeInTheDocument()
  })

  it('restores repository-level code change details in the main delivery area', () => {
    const diff: DiffListItem = { id: 'diff-1', projectId: task.projectId, taskId: task.id, taskRunId: run.id, taskStepId: step.id, requirementGroupId: 'group-1', workspaceId: 'workspace-1', repositoryId: 'repo-1', baseCommit: 'base-1', sourceBranch: 'feat/login', headCommit: 'head-1', status: 'PENDING_REVIEW', changeStats: { files: 2, additions: 12, deletions: 3 }, createdAt: run.createdAt }
    useTaskMock.mockReturnValue({ data: { ...task, status: 'WAITING_DIFF_CONFIRMATION' }, isLoading: false, isError: false, error: null, refetch: vi.fn() })
    useDiffsMock.mockReturnValue({ data: page([diff]), error: null, isError: false, isLoading: false })
    renderPage()
    const card = screen.getByTestId('code-change-card')
    expect(screen.getByTestId('code-delivery-card')).toContainElement(card)
    expect(within(card).getByText('Web 前端')).toBeInTheDocument()
    expect(within(card).getByText('2 files · +12 / -3')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '查看 Diff' })).toBeInTheDocument()
  })

  it('does not crash when an incomplete real response omits optional display fields', () => {
    const incompleteTask = { ...task, requirement: undefined, repositories: undefined, acceptanceCriteria: undefined, executionSummary: undefined, capabilities: undefined, sourceMessage: undefined } as unknown as Task
    useTaskMock.mockReturnValue({ data: incompleteTask, error: null, isError: false, isLoading: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByTestId('task-summary')).toBeInTheDocument()
    expect(screen.getByTestId('recent-execution-panel')).toBeInTheDocument()
    expect(screen.getByTestId('delivery-panel')).toBeInTheDocument()
  })

  it('refreshes the task after a cancellation conflict', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    const mutate = vi.fn((_id: string, options: { onError: (error: Error) => void }) => options.onError(new ApiError('conflict', 409)))
    useTaskMock.mockReturnValue({ data: task, error: null, isError: false, isLoading: false, refetch })
    useCancelTaskMock.mockReturnValue({ mutate, error: new ApiError('conflict', 409), isPending: false })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await user.click(screen.getByRole('button', { name: '取消任务' }))
    expect(refetch).toHaveBeenCalled()
  })

})
