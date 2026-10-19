import { Alert, Button, Card, Form, Input, Result, Spin, Tag, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CodeOutlined, ExperimentOutlined, FileTextOutlined, MenuFoldOutlined, MenuUnfoldOutlined, TeamOutlined } from '@ant-design/icons'
import { type ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api'
import { queryClient, taskModelQueryKeys } from '@/query'
import { useCancelTask, useConfirmTaskDiffReview, useDiffs, useRejectTaskDiffReview, useRetryTaskDiffReviewDelivery, useTask, useTaskDiffReview, useTaskRuns, useTaskSteps } from '@/hooks/task-model'
import { usePreflight } from '@/hooks/qualityGate'
import type { DiffReviewBatch, Task, TaskRunSummary, TaskStep } from '@/types/task-model'
import { PATHS } from '@/routes/paths'
import { useTaskCompletedWithoutCode } from '@/store/taskNoCodeChangeStore'
import { TaskModelStatusTag } from '../TaskCenter/TaskModelStatusTag'
import { TaskRunInspectorPanel } from './TaskRunInspectorDrawer'
import { WorkspaceDiffPreviewCard } from './WorkspaceDiffPreviewCard'
import { PreflightPanel } from '../PreflightPanel'
import type { Preflight } from '@/types/qualityGate'
import styles from './TaskDetailPage.module.scss'

const { Text, Title } = Typography

export default function TaskDetailPage() {
  const { projectId = '', taskId = '' } = useParams<{ projectId: string; taskId: string }>()
  const navigate = useNavigate()
  const taskQuery = useTask(projectId, taskId)
  const stepsQuery = useTaskSteps(projectId, taskId, { limit: 100 })
  // 重试入口必须能识别同一步骤的后续运行；读取足够的近期记录，避免旧失败 run 被误判为可重试。
  const taskRunsQuery = useTaskRuns(projectId, taskId, { limit: 100 })
  const diffsQuery = useDiffs(projectId, { taskId, limit: 100 })
  const cancelMutation = useCancelTask(projectId)
  const completedWithoutCode = useTaskCompletedWithoutCode(projectId, taskId)
  // SUCCEEDED 也查 DiffReview：有批次 → 展示交付结果（正常完成）；404 → 无代码变更空态（§5.2，跨会话稳定）
  const reviewEnabled =
    (isDiffReviewTask(taskQuery.data?.status) || taskQuery.data?.status === 'SUCCEEDED') && !completedWithoutCode
  const diffReviewQuery = useTaskDiffReview(projectId, taskId, reviewEnabled)

  // WAITING_PREFLIGHT 时，按仓库逐个查询预检数据
  // 每个仓库一个 usePreflight Hook —— 通过 PreflightRepoCollector 组件封装
  const [preflightResults, setPreflightResults] = useState<Map<string, {
    repositoryId: string
    repositoryName: string
    preflight: Preflight | undefined
    loading: boolean
    error: Error | null
    refetch: () => void
  }>>(new Map())

  const handlePreflightResult = useCallback((
    repoId: string,
    result: {
      repositoryId: string
      repositoryName: string
      preflight: Preflight | undefined
      loading: boolean
      error: Error | null
      refetch: () => void
    },
  ) => {
    setPreflightResults((prev) => {
      const next = new Map(prev)
      next.set(repoId, result)
      return next
    })
  }, [])

  const handlePreflightRemove = useCallback((repoId: string) => {
    setPreflightResults((prev) => {
      const next = new Map(prev)
      next.delete(repoId)
      return next
    })
  }, [])

  // G1：交付中心等入口带 ?diffReviewBatchId 跳转时，定位到「任务产出与交付」卡片
  const [searchParams, setSearchParams] = useSearchParams()
  const [hasClearedRunSelection, setHasClearedRunSelection] = useState(false)
  const [retryRequestedRunId, setRetryRequestedRunId] = useState<string | null>(null)
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null)
  const [runCancelPending, setRunCancelPending] = useState(false)
  const [runInspectorFocusRequest, setRunInspectorFocusRequest] = useState(0)
  const [runInspectorCollapsed, setRunInspectorCollapsed] = useState(false)
  const paramBatchId = searchParams.get('diffReviewBatchId')
  const selectedRunId = searchParams.get('runId')
  useEffect(() => {
    setHasClearedRunSelection(false)
  }, [taskId])
  useEffect(() => {
    if (!paramBatchId) return
    const attentionBatchId = taskQuery.data?.attention?.diffReviewBatchId
    const loadedBatchId = diffReviewQuery.data?.id
    if (attentionBatchId !== paramBatchId && loadedBatchId !== paramBatchId) return
    const target = document.getElementById('output-delivery')
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [paramBatchId, taskQuery.data?.attention?.diffReviewBatchId, diffReviewQuery.data?.id])

  // 必须无条件调用：Rules of Hooks 要求 Hooks 在每次渲染中以相同顺序执行。
  // 这里的回调不依赖任何条件数据，可安全前置。
  const preflightRefetchAll = useCallback(() => {
    setPreflightResults((prev) => {
      const next = new Map(prev)
      for (const [, v] of next) {
        v.refetch()
      }
      return new Map()
    })
  }, [])

  // 必须无条件调用：基于可选的 taskQuery.data 计算，缺失时返回空数组。
  const preflightArray = useMemo(() => {
    const repositories = taskQuery.data?.repositories ?? []
    const result: Array<{
      repositoryId: string
      repositoryName: string
      preflight: Preflight | undefined
      loading: boolean
      error: Error | null
      refetch: () => void
    }> = []
    for (const repo of repositories) {
      const entry = preflightResults.get(repo.repositoryId)
      if (entry) {
        result.push(entry)
      } else {
        result.push({
          repositoryId: repo.repositoryId,
          repositoryName: repo.name || repo.repositoryId,
          preflight: undefined,
          loading: true,
          error: null,
          refetch: () => { },
        })
      }
    }
    return result
  }, [taskQuery.data?.repositories, preflightResults])

  const task = taskQuery.data
  const recentRuns = [...(taskRunsQuery.data?.data ?? [])].sort((left, right) => runUpdatedAt(right) - runUpdatedAt(left))
  const retryEligibleRunIds = useMemo(() => getRetryEligibleRunIds(recentRuns), [recentRuns])
  // retryingRunId 记的是「被重试的源 run id」；真正的新 run 是 retryOfTaskRunId === retryingRunId 的那条。
  // 重试请求已发送但新 TaskRun 尚未返回时进入过渡态，不能继续把旧失败运行当作当前状态。
  const retryReplacementRun = retryingRunId === null
    ? null
    : recentRuns.find((run) => run.retryOfTaskRunId === retryingRunId) ?? null
  const retryPending = retryRequestedRunId !== null
    || (retryingRunId !== null && retryReplacementRun === null)

  useEffect(() => {
    if (!retryingRunId) return

    if (retryReplacementRun) {
      // 重试从右栏的源运行发起时，新运行到达后才接管该详情；用户主动清空或切换到其他历史运行时不抢占选择。
      if (!hasClearedRunSelection && (selectedRunId === null || selectedRunId === retryingRunId)) {
        const next = new URLSearchParams(searchParams)
        next.set('runId', retryReplacementRun.id)
        setSearchParams(next, { replace: true })
      }
      setRetryingRunId(null)
      return
    }

    // 重试可从 FAILED、CANCELLED 或 BLOCKED 运行发起。任务聚合状态可能先更新，
    // 新运行记录稍后才进入列表；在确认新 run 前持续轮询，不能按旧任务状态提前退出。
  }, [hasClearedRunSelection, retryReplacementRun, retryingRunId, searchParams, selectedRunId, setSearchParams])

  // SSE 是主更新通道；活动任务额外每 5 秒刷新一次读取模型，覆盖事件延迟、断线和后端异步建 Run 的窗口。
  // 终态自动停止，且这里只读取服务端状态，不向缓存伪造 RUNNING/DELIVERING。
  // 轮询频率从 3s 放宽到 5s：多任务并发时 3s 轮询（task/steps/runs/diffs 多个接口）会放大
  // 数据库连接峰值，曾触发连接池瞬时耗尽（Hikari Connection is not available）。
  const shouldPollActiveTask = retryPending || isTaskInFlight(task?.status)
  useEffect(() => {
    if (!shouldPollActiveTask) return
    const refresh = () => {
      void taskQuery.refetch?.()
      void stepsQuery.refetch?.()
      void taskRunsQuery.refetch?.()
      void diffsQuery.refetch?.()
      if (reviewEnabled) void diffReviewQuery.refetch?.()
      // 实时预览依赖 SSE workspace.diff-preview.updated 失效；SSE 断线/漏事件时用轮询兜底，
      // 否则 Coding 已写入但事件未到达时预览卡会一直停留在旧数据或「暂不可用」。
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.workspaceDiffPreview.all(projectId, taskId) })
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => window.clearInterval(timer)
  }, [diffReviewQuery.refetch, diffsQuery.refetch, reviewEnabled, shouldPollActiveTask, stepsQuery.refetch, taskQuery.refetch, taskRunsQuery.refetch])

  if (taskQuery.isLoading) return <DetailState loading description="正在加载任务详情" />
  if (taskQuery.isError) return <DetailError error={taskQuery.error} resource="任务详情" />
  if (!task || task.projectId !== projectId || task.id !== taskId) return <DetailState description="任务不存在或不可见" />
  const latestRun = recentRuns[0]
  const currentTask = synchronizeTaskStatus(normalizeTaskForDisplay(task), latestRun)
  const steps = synchronizeStepStatuses(stepsQuery.data?.data ?? [], recentRuns)
  const inspectedRunId = hasClearedRunSelection ? null : selectedRunId ?? latestRun?.id ?? null

  function handleCancel() {
    cancelMutation.mutate(currentTask.id, { onError: (error) => { if (error instanceof ApiError && error.status === 409) void taskQuery.refetch() } })
  }

  function openRun(taskRunId: string, focusInspector = false) {
    setHasClearedRunSelection(false)
    const next = new URLSearchParams(searchParams)
    next.set('runId', taskRunId)
    setSearchParams(next)
    if (focusInspector) setRunInspectorFocusRequest((request) => request + 1)
  }

  function clearRunSelection() {
    setHasClearedRunSelection(true)
    if (!selectedRunId) return
    const next = new URLSearchParams(searchParams)
    next.delete('runId')
    setSearchParams(next)
  }

  // 任务创建人 ID，用于判断 CQ+1 自审
  const taskCreatedByUserId = task.createdByUser?.id ?? null
  return (
    <div className={styles.page}>
      <div className={styles.topBar}><Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(PATHS.projectTasks(projectId))}>返回任务中心</Button></div>
      <div className={`${styles.taskWorkspace}${runInspectorCollapsed ? ` ${styles.taskWorkspaceAsideCollapsed}` : ''}`}>
        <div className={styles.taskWorkspaceMain}>
          <CompactTaskHeader task={currentTask} projectId={projectId} onCancel={handleCancel} cancelPending={cancelMutation.isPending || runCancelPending} completedWithoutCode={completedWithoutCode} />
          {cancelMutation.error ? <CancelError error={cancelMutation.error} onRefresh={() => void taskQuery.refetch()} /> : null}
          {task.status === 'WAITING_PREFLIGHT' ? (
            <>
              {/* 每个仓库独立的 preflight 查询 Hook —— 组件化以确保 Hook 调用顺序稳定 */}
              {(task.repositories ?? []).map((repo) => (
                <PreflightRepoQuery
                  key={repo.repositoryId}
                  projectId={projectId}
                  taskId={taskId}
                  repositoryId={repo.repositoryId}
                  repositoryName={repo.name || repo.repositoryId}
                  targetBranch={repo.baseRef}
                  onResult={handlePreflightResult}
                  onUnmount={handlePreflightRemove}
                />
              ))}
              <section id="preflight-panel" data-testid="preflight-panel">
                <PreflightPanel
                  projectId={projectId}
                  preflights={preflightArray}
                  onRefreshAll={preflightRefetchAll}
                  taskCreatedByUserId={taskCreatedByUserId}
                />
              </section>
            </>
          ) : null}
          <main className={styles.content}>
            <ExecutionFlowRow task={currentTask} query={stepsQuery} steps={steps} retryPending={retryPending} onOpenRun={openRun} />
            <div className={styles.workbenchMain}>
              <RecentExecutionPanel query={taskRunsQuery} taskStatus={task.status} retryPending={retryPending} onOpenRun={openRun} onClearSelection={clearRunSelection} selectedRunId={inspectedRunId} />
              <DeliveryPanel projectId={projectId} taskId={currentTask.id} task={currentTask} retryPending={retryPending} diffsQuery={diffsQuery} diffReviewQuery={diffReviewQuery} reviewEnabled={reviewEnabled} completedWithoutCode={completedWithoutCode} onRefresh={() => { void diffReviewQuery.refetch(); void taskQuery.refetch() }} />
            </div>
          </main>
        </div>
        <aside className={styles.taskWorkspaceAside} aria-label="本次执行侧栏">
          <Button
            type="text"
            size="small"
            className={styles.runInspectorToggle}
            icon={runInspectorCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={runInspectorCollapsed ? '展开本次执行侧栏' : '隐藏本次执行侧栏'}
            title={runInspectorCollapsed ? '展开本次执行侧栏' : '隐藏本次执行侧栏'}
            onClick={() => setRunInspectorCollapsed((collapsed) => !collapsed)}
          />
          {runInspectorCollapsed ? null : <TaskRunInspectorPanel projectId={projectId} task={currentTask} taskId={currentTask.id} taskRunId={inspectedRunId} displayStatus={inspectedRunId === latestRun?.id ? latestRun.status : undefined} retryEligibleRunIds={retryEligibleRunIds} onRunChange={openRun} onRetryRequested={setRetryRequestedRunId} onRetryStarted={(sourceRunId) => { setRetryRequestedRunId(null); setRetryingRunId(sourceRunId) }} onRetryRequestError={() => setRetryRequestedRunId(null)} retryPending={retryPending} taskCancelPending={cancelMutation.isPending} onRunCancelPendingChange={setRunCancelPending} focusRequest={runInspectorFocusRequest} />}
        </aside>
      </div>
    </div>
  )
}

/**
 * 同一 TaskStep 的重试形成 retryOfTaskRunId 链。旧失败记录仍可查看，
 * 但仅该步骤最新、且尚未被后续运行取代的记录可触发下一次重试。
 */
function synchronizeTaskStatus(task: Task, latestRun: TaskRunSummary | undefined): Task {
  if (!latestRun || !['PLANNING', 'PENDING', 'RUNNING'].includes(task.status)) return task
  if (latestRun.status === 'FAILED' || latestRun.status === 'BLOCKED') return { ...task, status: 'FAILED' }
  if (latestRun.status === 'CANCELLED') return { ...task, status: 'CANCELLED' }
  return task
}

function synchronizeStepStatuses(steps: readonly TaskStep[], runs: readonly TaskRunSummary[]): TaskStep[] {
  const runsById = new Map(runs.map((run) => [run.id, run]))
  return steps.map((step) => {
    const latestRun = step.latestRun ? runsById.get(step.latestRun.id) : undefined
    const status = latestRun ? taskStepStatusFromRun(latestRun.status) : undefined
    return status && status !== step.status ? { ...step, status } : step
  })
}

function taskStepStatusFromRun(status: TaskRunSummary['status']): TaskStep['status'] | undefined {
  if (status === 'FAILED' || status === 'BLOCKED') return 'FAILED'
  if (status === 'CANCELLED') return 'CANCELLED'
  if (status === 'SUCCEEDED') return 'SUCCEEDED'
  if (status === 'RUNNING') return 'RUNNING'
  if (status === 'QUEUED') return 'PENDING'
  return undefined
}

function getRetryEligibleRunIds(runs: readonly TaskRunSummary[]): ReadonlySet<string> {
  const latestByStep = new Map<string, TaskRunSummary>()
  const retriedSourceIds = new Set<string>()

  for (const run of runs) {
    if (run.retryOfTaskRunId) retriedSourceIds.add(run.retryOfTaskRunId)
    const current = latestByStep.get(run.taskStepId)
    if (!current || runUpdatedAt(run) > runUpdatedAt(current)) latestByStep.set(run.taskStepId, run)
  }

  return new Set([...latestByStep.values()]
    .filter((run) => !retriedSourceIds.has(run.id))
    .map((run) => run.id))
}

function runUpdatedAt(run: Pick<TaskRunSummary, 'createdAt' | 'updatedAt'>): number {
  const timestamp = Date.parse(run.updatedAt || run.createdAt)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function CompactTaskHeader({ task, projectId, onCancel, cancelPending, completedWithoutCode }: { task: Task; projectId: string; onCancel: () => void; cancelPending: boolean; completedWithoutCode: boolean }) {
  const navigate = useNavigate()
  return (
    <header className={styles.taskHeader} data-testid="task-summary">
      <div className={styles.headerPrimary}>
        <div className={styles.headerIdentity}>
          <span className={styles.taskCode}>{task.displayCode}</span>
          <div className={styles.headerTitleLine}>
            <Title level={2} className={styles.taskTitle}>{display(task.title)}</Title>
            <TaskModelStatusTag status={task.status} completedWithoutCode={completedWithoutCode} />
          </div>
        </div>
        <div className={styles.headerActions}>
          {task.requirementGroup ? <Button type="link" size="small" onClick={() => navigate(PATHS.projectReqChat(projectId, task.requirementGroup!.id))}>查看完整需求来源信息</Button> : null}
          {task.capabilities.canCancel ? <Button size="small" danger loading={cancelPending} disabled={cancelPending} onClick={onCancel}>取消任务</Button> : null}
        </div>
      </div>
      <div className={styles.headerMeta}>
        <HeaderMeta label="需求群" value={task.requirementGroup?.name} />
        <HeaderMeta label="仓库" value={task.repositories.length > 0 ? `${task.repositories.length} 个` : task.status === 'PLANNING' ? '规划中，待分析' : '暂无'} />
        <HeaderMeta label="更新于" value={formatDate(task.updatedAt)} />
        <RequirementMeta task={task} />
      </div>
    </header>
  )
}

function PlanningSkeletonCard({ index }: { index: number }) {
  const delays = ['0ms', '150ms', '300ms']
  const delay = delays[index % 3]
  return (
    <div
      className={`${styles.planningStepCard} ${styles.planningCardFadeIn}`}
      style={{ animationDelay: delay }}
      data-testid="planning-step-card"
    >
      <div className={styles.planningBrainIcon}>
        <ExperimentOutlined />
      </div>
      <div className={`${styles.skeletonLine} ${styles.skeletonHeadingLine}`} />
      <div className={styles.planningMeta}>
        <div className={`${styles.skeletonLine} ${styles.skeletonMetaLine}`} />
        <div className={`${styles.skeletonLine} ${styles.skeletonMetaLine}`} style={{ width: '75%' }} />
        <div className={`${styles.skeletonLine} ${styles.skeletonMetaLine}`} style={{ width: '85%' }} />
      </div>
      <div className={styles.planningFooter}>
        <div className={`${styles.skeletonLine} ${styles.skeletonFooterLine}`} />
      </div>
    </div>
  )
}

function ExecutionFlowRow({ task, query, steps, retryPending, onOpenRun }: { task: Task; query: ReturnType<typeof useTaskSteps>; steps: TaskStep[]; retryPending: boolean; onOpenRun: (taskRunId: string) => void }) {
  const ordered = steps.slice().sort((left, right) => left.sequenceNo - right.sequenceNo)
  const isPlanning = task.status === 'PLANNING'
  const isWaitingForSteps = retryPending || (ordered.length === 0 && (isPlanning || task.status === 'RUNNING'))
  const flowMeta = retryPending ? '正在重新生成执行步骤' : ordered.length > 0 ? `${ordered.length} 个步骤` : isPlanning ? '规划中' : isWaitingForSteps ? '正在生成执行步骤' : undefined
  return (
    <section className={styles.executionFlowRow} id="execution-flow" data-testid="execution-flow-row">
      <RowHeading
        title="执行流程"
        meta={flowMeta}
      />
      {query.isError ? (
        <SectionError resource="TaskStep" error={query.error} />
      ) : isWaitingForSteps ? (
        <div className={styles.flowScroller}>
          <div className={styles.flowPlanningState}>
            {[0, 1, 2].map((i) => <PlanningSkeletonCard key={i} index={i} />)}
          </div>
        </div>
      ) : query.isLoading ? (
        <InlineState loading />
      ) : ordered.length === 0 ? (
        <div className={styles.flowEmptyState} data-testid="execution-flow-empty">
          <Text type="secondary">暂无执行步骤</Text>
        </div>
      ) : (
        <div className={styles.flowScroller}>
          <div className={styles.flowGrid}>
            {ordered.map((step) => <StepCard key={step.id} step={step} taskStatus={task.status} onRun={onOpenRun} />)}
          </div>
        </div>
      )}
    </section>
  )
}

function StepCard({ step, taskStatus, onRun }: { step: TaskStep; taskStatus: Task['status']; onRun: (runId: string) => void }) {
  const current = step.status === 'RUNNING'
  // 仅任务真实失败终态时，步骤 FAILED 才是终局失败（红色）；任务仍执行中或已成功时，步骤 FAILED
  // 是验证/测试未通过但任务继续推进（裁决/修复）或审查放行的中间事实，弱化为橙色「未通过」。
  // 使用后端原始 task.status，而不是被 run 同步过的 currentTask.status，避免「run 失败」把
  // 仍 RUNNING 的任务误判为终局失败。
  const recoverable = step.status === 'FAILED' && taskStatus !== 'FAILED' && taskStatus !== 'DELIVERY_FAILED'
  return <article className={`${styles.stepCard} ${current ? styles.stepCardCurrent : ''}`}><div className={styles.stepHeading}><span className={styles.stepIcon}>{stepIcon(step.role)}</span><span className={styles.stepNumber}>{step.sequenceNo}.</span><Tooltip title={display(step.title)}><Text strong className={styles.stepTitle}>{display(step.title)}</Text></Tooltip><Tag color={recoverable ? 'warning' : stepStatusColor(step.status)}>{recoverable ? 'FAILED（未通过）' : step.status}</Tag></div><div className={styles.stepDetails}><StepInfo label="Agent" value={display(step.agent?.name)} /><StepInfo label="仓库" value={display(step.repository?.name)} /><StepInfo label="说明" value={display(step.acceptanceNotes)} /><StepInfo label="运行" value={`${step.runCount} 次`} /></div><div className={styles.stepFooter}>{step.latestRun ? <Button type="link" size="small" onClick={() => onRun(step.latestRun!.id)}>查看最新运行</Button> : <Text type="secondary">尚未运行</Text>}{step.latestRun ? <ArrowRightOutlined /> : null}</div></article>
}

function RecentExecutionPanel({ query, taskStatus, retryPending, onOpenRun, onClearSelection, selectedRunId }: { query: ReturnType<typeof useTaskRuns>; taskStatus: Task['status']; retryPending: boolean; onOpenRun: (taskRunId: string) => void; onClearSelection: () => void; selectedRunId: string | null }) {
  const runs = [...(query.data?.data ?? [])].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  return <section className={styles.recentExecutionPanel} data-testid="recent-execution-panel"><div className={styles.panelHeading}><Title level={3}>最近执行</Title></div>{retryPending ? <InlineState loading text="重试已受理，正在等待服务端返回运行记录" /> : null}{query.isLoading ? <InlineState loading /> : query.isError ? <SectionError resource="执行记录" error={query.error} /> : runs.length === 0 ? <PanelPlaceholder description="尚无执行记录" icon={<ExperimentOutlined />} /> : <div className={styles.recentExecutionList} data-testid="recent-execution-blank" onClick={(event) => { if (event.target === event.currentTarget) onClearSelection() }}>{runs.map((run) => <RecentRunItem key={run.id} run={run} taskStatus={taskStatus} selected={run.id === selectedRunId} onOpen={() => onOpenRun(run.id)} />)}</div>}</section>
}

function RecentRunItem({ run, taskStatus, selected, onOpen }: { run: TaskRunSummary; taskStatus: Task['status']; selected: boolean; onOpen: () => void }) {
  // 同 StepCard：任务非失败终态时，单次 run FAILED 是验证/测试未通过的中间事实而非终局失败。
  const recoverable = run.status === 'FAILED' && taskStatus !== 'FAILED' && taskStatus !== 'DELIVERY_FAILED'
  return <button type="button" className={`${styles.recentRunItem} ${selected ? styles.recentRunItemSelected : ''}`} onClick={onOpen}>{run.status === 'RUNNING' ? <Spin size="small" className={styles.runStatusSpinner} /> : <span className={styles.runStatusDot} data-status={run.status} />}<div className={styles.recentRunItemMain}><div className={styles.recentRunItemRow}><Tag color={recoverable ? 'warning' : runStatusColor(run.status)}>{recoverable ? 'FAILED（未通过）' : run.status}</Tag><Text strong className={styles.recentRunItemTitle}>{run.taskStepTitle || roleLabel(run.role)}</Text><Text type="secondary">{formatDate(run.updatedAt)}</Text></div><Text type="secondary" className={styles.recentRunItemStatus}>{run.statusSummary ?? (recoverable ? '本次执行未通过，任务继续推进' : roleLabel(run.role))}</Text></div><Text type="secondary" className={styles.recentRunItemArtifact}>产物 {run.artifactSummary?.total ?? 0} · Diff {run.artifactSummary?.diffCount ?? 0}</Text></button>
}

function StepInfo({ label, value }: { label: string; value: string }) {
  return <Tooltip title={`${label}：${value}`}><Text ellipsis><span className={styles.stepInfoBullet}>·</span> {label}：{value}</Text></Tooltip>
}

function stepStatusColor(status: TaskStep['status']): 'default' | 'processing' | 'success' | 'error' | 'warning' {
  if (status === 'RUNNING') return 'processing'
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED') return 'error'
  if (status === 'PENDING') return 'warning'
  return 'default'
}

function runStatusColor(status: TaskRunSummary['status']): 'default' | 'processing' | 'success' | 'error' | 'warning' {
  if (status === 'RUNNING') return 'processing'
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED') return 'error'
  if (status === 'WAITING_INPUT' || status === 'WAITING_APPROVAL') return 'warning'
  return 'default'
}

function roleLabel(role: TaskStep['role'] | TaskRunSummary['role']): string {
  const labels: Record<TaskStep['role'], string> = { ORCHESTRATOR: '编排器', PLANNER: '规划器', DEVELOPER: '开发者', TESTER: '测试器', REVIEWER: '审查者' }
  return labels[role]
}

function stepIcon(role: TaskStep['role']) {
  if (role === 'PLANNER') return <FileTextOutlined />
  if (role === 'DEVELOPER') return <CodeOutlined />
  if (role === 'TESTER') return <ExperimentOutlined />
  return <TeamOutlined />
}

function DeliveryPanel({ projectId, taskId, task, retryPending, diffsQuery, diffReviewQuery, reviewEnabled, completedWithoutCode, onRefresh }: { projectId: string; taskId: string; task: Task; retryPending: boolean; diffsQuery: ReturnType<typeof useDiffs>; diffReviewQuery: ReturnType<typeof useTaskDiffReview>; reviewEnabled: boolean; completedWithoutCode: boolean; onRefresh: () => void }) {
  const navigate = useNavigate()
  // 工作区预览代表执行现场：运行失败后也保留，便于定位最后一次写入。
  // 只有任务离开执行态、进入正式 Diff/交付路径后，才由下方合并卡接管展示。
  const showWorkspacePreview = !completedWithoutCode && (retryPending || task.status === 'RUNNING' || task.status === 'FAILED')
  const batch = isCompleteDiffReviewBatch(diffReviewQuery.data) && diffReviewQuery.data.taskId === task.id ? diffReviewQuery.data : null
  const generatingDelivery = !showWorkspacePreview && reviewEnabled && diffReviewQuery.isLoading && !batch
  return <section className={styles.deliveryPanel} id="output-delivery" data-testid="delivery-panel"><div className={styles.panelHeading}><Title level={3}>代码工作区</Title>{showWorkspacePreview ? null : <Button type="link" size="small" onClick={() => navigate(`${PATHS.projectDiffs(projectId)}?taskId=${encodeURIComponent(taskId)}`)}>查看全部变更</Button>}</div>{showWorkspacePreview ? <WorkspaceDiffPreviewCard projectId={projectId} taskId={taskId} repositories={task.repositories} /> : generatingDelivery ? <DeliveryGenerationPlaceholder /> : <Card className={styles.codeDeliveryCard} size="small" data-testid="code-delivery-card"><CodeChangeCard projectId={projectId} taskId={taskId} task={task} query={diffsQuery} completedWithoutCode={completedWithoutCode} batch={batch} /><DeliveryCard projectId={projectId} task={task} query={diffReviewQuery} enabled={reviewEnabled} completedWithoutCode={completedWithoutCode} onRefresh={onRefresh} /></Card>}</section>
}

function DeliveryGenerationPlaceholder() {
  return <Card className={`${styles.codeDeliveryCard} ${styles.deliveryGenerationPlaceholder}`} size="small" data-testid="delivery-generation-placeholder"><div className={styles.deliveryGenerationLines} aria-hidden><span /><span /><span /></div><Text type="secondary">正在生成正式 Diff 与交付信息</Text></Card>
}

function PanelPlaceholder({ description, icon }: { description: string; icon: ReactNode }) {
  return <div className={styles.panelEmptyPlaceholder} data-testid="panel-empty-placeholder"><span className={styles.panelEmptyPlaceholderIcon}>{icon}</span><Text type="secondary">{description}</Text></div>
}

function CodeChangeCard({ projectId, taskId, task, query, completedWithoutCode, batch }: { projectId: string; taskId: string; task: Task; query: ReturnType<typeof useDiffs>; completedWithoutCode: boolean; batch: DiffReviewBatch | null }) {
  const navigate = useNavigate()
  const diffs = query.data?.data ?? []
  const repositories = new Map<string, { name: string; files: number; additions: number; deletions: number; diffIds: string[] }>()
  for (const diff of diffs) {
    const repository = task.repositories.find((item) => item.repositoryId === diff.repositoryId)
    const summary = repositories.get(diff.repositoryId) ?? { name: repository?.name ?? '未命名仓库', files: 0, additions: 0, deletions: 0, diffIds: [] }
    summary.files += diff.changeStats.files
    summary.additions += diff.changeStats.additions
    summary.deletions += diff.changeStats.deletions
    summary.diffIds.push(diff.id)
    repositories.set(diff.repositoryId, summary)
  }
  const totals = [...repositories.values()].reduce((sum, repository) => ({ files: sum.files + repository.files, additions: sum.additions + repository.additions, deletions: sum.deletions + repository.deletions }), { files: 0, additions: 0, deletions: 0 })
  const deliveriesByRepository = new Map((batch?.repositoryDeliveries ?? []).map((delivery) => [delivery.repositoryId, delivery]))
  const authorizationLabel = batch ? diffReviewAuthorizationLabel(batch) : null
  return <section className={styles.codeChangeSection} data-testid="code-change-card"><div className={styles.cardHeading}><span><CodeOutlined />代码交付</span>{authorizationLabel ? <Tag>{authorizationLabel}</Tag> : null}</div>{task.deliveryReason ? <Text type="secondary" className={styles.deliveryReason}>{task.deliveryReason}</Text> : null}{query.isLoading ? <InlineState loading /> : query.isError ? <SectionError resource="代码变更" error={query.error} /> : diffs.length === 0 ? <Text type="secondary" className={styles.compactEmpty}>{completedWithoutCode ? '任务已完成，未产生代码变更' : '尚未产生代码变更'}</Text> : <><Text type="secondary">{repositories.size} 个仓库 · {diffs.length} 个 Diff · {totals.files} files · +{totals.additions} / -{totals.deletions}</Text><div className={styles.diffSummaryList}>{[...repositories.entries()].map(([repositoryId, summary]) => { const delivery = deliveriesByRepository.get(repositoryId); return <div key={repositoryId} className={styles.codeDeliveryRepositoryRow}><div className={styles.codeDeliveryRepositoryInfo}><Text ellipsis strong>{summary.name}</Text><Text type="secondary">{summary.files} files · +{summary.additions} / -{summary.deletions}</Text></div>{delivery && delivery.deliveryStatus !== 'NOT_STARTED' ? <Tag color={delivery.deliveryStatus === 'FAILED' ? 'red' : delivery.deliveryStatus === 'MR_CREATED' || delivery.deliveryStatus === 'COMMITTED' ? 'green' : 'orange'}>{delivery.deliveryStatus}</Tag> : null}<div className={styles.codeDeliveryActions}>{summary.diffIds.map((diffId) => <Button key={diffId} type="link" size="small" onClick={() => navigate(PATHS.projectDiff(projectId, diffId), { state: { from: PATHS.projectTaskDetail(projectId, taskId) } })}>查看 Diff</Button>)}{delivery?.mergeRequest?.webUrl ? <a href={delivery.mergeRequest.webUrl} target="_blank" rel="noreferrer">查看 MR</a> : null}</div>{delivery?.failureReason ? <Text type="danger" className={styles.codeDeliveryFailure}>{delivery.failureReason}</Text> : null}</div> })}</div></>}</section>
}

function DeliveryCard({ projectId, task, query, enabled, completedWithoutCode, onRefresh }: { projectId: string; task: Task; query: ReturnType<typeof useTaskDiffReview>; enabled: boolean; completedWithoutCode: boolean; onRefresh: () => void }) {
  if (completedWithoutCode) return <section className={styles.deliverySection} data-testid="delivery-card"><Text type="secondary" className={styles.compactEmpty}>任务已完成，无代码变更，因此未生成 Diff 或 MR</Text></section>
  if (!enabled) return <section className={styles.deliverySection} data-testid="delivery-card"><PanelPlaceholder description={task.status === 'SUCCEEDED' ? '任务已完成' : '等待任务生成正式 Diff'} icon={<CodeOutlined />} /></section>
  if (query.isLoading) return <section className={styles.deliverySection} data-testid="delivery-card"><InlineState loading /></section>
  if (query.isError) return <section className={styles.deliverySection} data-testid="delivery-card"><Text type="secondary" className={styles.compactEmpty}>{diffReviewUnavailableMessage(task, query.error)}</Text><Button type="link" size="small" onClick={onRefresh}>刷新交付状态</Button></section>
  if (!isCompleteDiffReviewBatch(query.data) || query.data.taskId !== task.id) return <section className={styles.deliverySection} data-testid="delivery-card"><Text type="secondary" className={styles.compactEmpty}>{task.capabilities.canConfirmDiffReview || task.capabilities.canRejectDiffReview ? '交付信息不完整，请刷新' : '最终 Diff 尚未生成'}</Text><Button type="link" size="small" onClick={onRefresh}>刷新交付状态</Button></section>
  return <DiffReviewPanel projectId={projectId} task={task} batch={query.data} onRefresh={onRefresh} />
}

function DiffReviewPanel({ projectId, task, batch, onRefresh }: { projectId: string; task: Task; batch: DiffReviewBatch; onRefresh: () => void }) {
  const confirm = useConfirmTaskDiffReview(projectId)
  const reject = useRejectTaskDiffReview(projectId)
  const retry = useRetryTaskDiffReviewDelivery(projectId)
  const [reason, setReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [confirmSubmitted, setConfirmSubmitted] = useState(false)
  const pending = confirm.isPending || reject.isPending || retry.isPending || confirmSubmitted
  const error = confirm.error ?? reject.error ?? retry.error
  const superseded = batch.reviewStatus === 'SUPERSEDED'
  // capabilities 是服务端最终授权来源；批次状态只用于展示，并在 SUPERSEDED 时阻止对旧快照写入。
  const canUserDecide = !superseded && (task.capabilities.canConfirmDiffReview || task.capabilities.canRejectDiffReview)
  const canRetry = !superseded && task.capabilities.canRetryDelivery
  const handleError = (mutationError: Error) => { if (mutationError instanceof ApiError && mutationError.status === 409) onRefresh() }
  return <section className={styles.deliverySection} data-testid="delivery-card">
    {superseded ? <Alert type="info" showIcon title="已被后续修改取代" description="同一工作区已有更新的 Diff；当前批次不可确认或拒绝。" action={<Button size="small" onClick={onRefresh}>刷新最新状态</Button>} /> : null}
    {batch.reviewStatus === 'REJECTED' && batch.reviewReason ? <div><Text type="danger">拒绝原因：{batch.reviewReason}</Text><Text type="secondary">请回需求群根据拒绝意见继续修改。</Text></div> : null}
    {batch.deliveryStatus === 'DELIVERED' ? <Text type="secondary">交付已完成，可从 MR 入口继续查看。</Text> : null}
    {confirmSubmitted ? <Alert type="info" showIcon title="确认请求已提交，正在等待服务端启动交付" /> : null}
    {canUserDecide ? <div className={styles.reviewActions}>
      <div className={styles.reviewActionBar}>
        {task.capabilities.canConfirmDiffReview ? <Button type="primary" loading={confirm.isPending || confirmSubmitted} disabled={pending} onClick={() => { setConfirmSubmitted(true); confirm.mutate(batch.taskId, { onError: handleError, onSettled: () => setConfirmSubmitted(false) }) }}>确认交付</Button> : null}
        {task.capabilities.canRejectDiffReview ? <Button danger type="link" disabled={pending} onClick={() => setShowRejectForm((visible) => !visible)}>{showRejectForm ? '收起拒绝' : '拒绝交付'}</Button> : null}
      </div>
      {showRejectForm ? <Form className={styles.rejectDeliveryForm} onFinish={() => { const trimmed = reason.trim(); if (trimmed) reject.mutate({ taskId: batch.taskId, input: { reason: trimmed } }, { onError: handleError }) }}>
        <Form.Item required><Input.TextArea value={reason} rows={2} maxLength={4000} placeholder="请填写拒绝原因" disabled={pending} onChange={(event) => setReason(event.target.value)} /></Form.Item>
        <div className={styles.rejectDeliveryActions}><Button onClick={() => setShowRejectForm(false)} disabled={pending}>取消</Button><Button danger type="primary" htmlType="submit" loading={reject.isPending} disabled={pending || !reason.trim()}>提交拒绝</Button></div>
      </Form> : null}
    </div> : null}
    {canRetry ? <Button size="small" loading={retry.isPending} disabled={pending} onClick={() => retry.mutate(batch.taskId, { onError: handleError })}>重试交付</Button> : null}
    {error ? <Alert type="error" showIcon title={diffReviewError(error)} action={error instanceof ApiError && error.status === 409 ? <Button size="small" onClick={onRefresh}>刷新</Button> : undefined} /> : null}
  </section>
}

function diffReviewAuthorizationLabel(batch: DiffReviewBatch): string {
  if (batch.reviewStatus === 'SUPERSEDED') return '已被后续修改取代'
  if (batch.reviewStatus === 'REJECTED') return '已拒绝'
  if (batch.deliveryStatus === 'DELIVERING') return '正在交付'
  if (batch.deliveryStatus === 'DELIVERED') return '交付完成'
  if (batch.deliveryStatus === 'PARTIALLY_DELIVERED' || batch.deliveryStatus === 'FAILED') return '交付失败'
  if (batch.reviewStatus === 'PENDING_CONFIRMATION') return batch.confirmationSource === 'USER' ? '等待用户确认' : '等待系统确认'
  if (batch.reviewStatus === 'ACCEPTED') return batch.confirmationSource === 'SYSTEM' ? '自动交付' : '已由用户确认'
  return '交付信息不完整'
}

function normalizeTaskForDisplay(task: Task): Task {
  const capabilities = task.capabilities
  return {
    ...task,
    requirement: typeof task.requirement === 'string' ? task.requirement : task.requirementSummary ?? '',
    acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
    repositories: Array.isArray(task.repositories) && task.repositories.length > 0
      ? task.repositories
      : Array.isArray(task.workspace?.repositories) ? task.workspace.repositories : [],
    executionSummary: task.executionSummary && typeof task.executionSummary === 'object'
      ? task.executionSummary
      : {
        totalSteps: 0,
        pendingSteps: 0,
        runningSteps: 0,
        waitingSteps: 0,
        blockedSteps: 0,
        succeededSteps: 0,
        failedSteps: 0,
        currentStage: null,
        currentStageTitle: null,
        requiresUserAction: false,
      },
    capabilities: {
      canCancel: capabilities?.canCancel === true,
      canReplacePendingStepAgent: capabilities?.canReplacePendingStepAgent === true,
      canConfirmDiffReview: capabilities?.canConfirmDiffReview === true,
      canRejectDiffReview: capabilities?.canRejectDiffReview === true,
      canRetryDelivery: capabilities?.canRetryDelivery === true,
    },
    sourceMessage: task.sourceMessage && task.sourceMessage.sender && typeof task.sourceMessage.sender.displayName === 'string'
      ? task.sourceMessage
      : null,
  }
}

function RowHeading({ title, meta }: { title: string; meta?: string }) { return <div className={styles.rowHeading}><Title level={4}>{title}</Title>{meta ? <Text type="secondary">{meta}</Text> : null}</div> }
function HeaderMeta({ label, value }: { label: string; value: ReactNode }) { return <div className={styles.headerMetaItem}><Text type="secondary">{label}</Text><Text ellipsis strong>{value}</Text></div> }
function RequirementMeta({ task }: { task: Task }) {
  return <div className={styles.headerMetaItem}>
    <Text type="secondary">需求说明</Text>
    <Tooltip title={display(task.requirement)}><Text ellipsis strong>{display(task.requirement)}</Text></Tooltip>
  </div>
}
function InlineState({ loading = false, text }: { loading?: boolean; text?: string }) { return <div className={styles.inlineState}>{loading ? <Spin size="small" /> : null}<Text type="secondary">{text ?? '正在加载'}</Text></div> }
function SectionError({ resource, error }: { resource: string; error: Error | null }) { const status = error instanceof ApiError ? error.status : undefined; return <Alert type="error" showIcon title={status === 403 ? `暂无权限查看${resource}` : `${resource}加载失败`} /> }
function CancelError({ error, onRefresh }: { error: Error; onRefresh: () => void }) { const status = error instanceof ApiError ? error.status : undefined; return <Alert className={styles.executionAlert} type="error" showIcon title={status === 409 ? '任务状态已变化，请刷新详情' : '取消任务失败'} action={status === 409 ? <Button type="link" onClick={onRefresh}>刷新</Button> : undefined} /> }
function DetailState({ description, loading = false }: { description: string; loading?: boolean }) { return <div className={styles.page}><div className={styles.panelState}>{loading ? <Spin /> : <Result status="404" title={description} />}</div></div> }
function DetailError({ error, resource }: { error: Error | null; resource: string }) { const status = error instanceof ApiError ? error.status : undefined; return <div className={styles.page}><Result status={status === 403 ? '403' : status === 404 ? '404' : 'error'} title={status === 403 ? `暂无权限查看${resource}` : status === 404 ? `${resource}不存在或不可见` : `${resource}加载失败`} /></div> }
function isDiffReviewTask(status: Task['status'] | undefined): boolean { return status === 'WAITING_DIFF_CONFIRMATION' || status === 'WAITING_PREFLIGHT' || status === 'DIFF_REJECTED' || status === 'DELIVERING' || status === 'DELIVERY_FAILED' || status === 'SUCCEEDED' }
function isTaskInFlight(status: Task['status'] | undefined): boolean { return Boolean(status && ['PLANNING', 'PENDING', 'RUNNING', 'WAITING_PREFLIGHT', 'DELIVERING', 'CANCELLING'].includes(status)) }
function errorCode(error: Error | null): string | undefined { if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object' || !('error' in error.body)) return undefined; const bodyError = (error.body as { error?: { code?: unknown } }).error; return typeof bodyError?.code === 'string' ? bodyError.code : undefined }
function diffReviewError(error: Error): string { const code = errorCode(error); if (code === 'DIFF_REVIEW_FORBIDDEN') return '暂无 Diff 验收权限'; if (code === 'DIFF_REVIEW_NOT_FOUND') return '最终 Diff 尚未生成'; if (code === 'DIFF_REVIEW_NOT_DECIDABLE') return 'Diff 状态已变化，请刷新后重试'; if (code === 'DIFF_REVIEW_SUPERSEDED') return '该 Diff 已被后续修改取代，已刷新最新状态'; if (code === 'DIFF_DELIVERY_NOT_RETRYABLE') return '当前交付状态不可重试'; return 'Diff 操作失败' }
function diffReviewUnavailableMessage(task: Task, error: Error | null): string { const code = errorCode(error); if (code === 'DIFF_REVIEW_NOT_FOUND') return task.status === 'SUCCEEDED' ? '任务已完成，无代码变更，因此未生成 Diff 或 MR' : '最终 Diff 尚未生成'; if (code === 'DIFF_REVIEW_SUPERSEDED') return 'Diff Review 已被后续修改取代，请查看最新 Diff'; if (code === 'DIFF_REVIEW_FORBIDDEN') return '当前用户暂无验收权限'; return '交付状态暂时无法获取' }
function isCompleteDiffReviewBatch(batch: DiffReviewBatch | undefined): batch is DiffReviewBatch { return Boolean(batch && typeof batch.id === 'string' && typeof batch.taskId === 'string' && typeof batch.reviewStatus === 'string' && typeof batch.confirmationSource === 'string' && typeof batch.deliveryStatus === 'string' && Array.isArray(batch.repositoryDeliveries)) }
function display(value: string | null | undefined): string { return value?.trim() || '暂无' }
function formatDate(value: string | null | undefined): string { if (!value) return '暂无'; const date = new Date(value); return Number.isNaN(date.getTime()) ? display(value) : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date) }
/**
 * 单仓库 preflight 查询组件 —— 封装 usePreflight Hook，将结果通过回调上报给父组件。
 * 父组件通过 Map 聚合所有仓库的 preflight 状态，传给 PreflightPanel 统一渲染。
 * 设计：每个仓库一个独立组件，确保 Hook 调用顺序在渲染间保持稳定。
 */
function PreflightRepoQuery({
  projectId,
  taskId,
  repositoryId,
  repositoryName,
  targetBranch,
  onResult,
  onUnmount,
}: {
  projectId: string
  taskId: string
  repositoryId: string
  repositoryName: string
  targetBranch: string
  onResult: (repoId: string, result: {
    repositoryId: string
    repositoryName: string
    preflight: Preflight | undefined
    loading: boolean
    error: Error | null
    refetch: () => void
  }) => void
  onUnmount: (repoId: string) => void
}) {
  const query = usePreflight(projectId, taskId, repositoryId, targetBranch)

  useEffect(() => {
    onResult(repositoryId, {
      repositoryId,
      repositoryName,
      preflight: query.data,
      loading: query.isLoading,
      error: query.error,
      refetch: () => { void query.refetch() },
    })
    // 注意: 不将 query 对象和 onResult 加入依赖列表
    // query 对象在每次渲染时都有新引用，会导致 useEffect 无限触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryId, repositoryName, query.data, query.isLoading, query.error])

  useEffect(() => {
    return () => { onUnmount(repositoryId) }
  }, [repositoryId, onUnmount])

  return null
}
