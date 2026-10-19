import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Card, Input, Skeleton, Spin, Tag, Tooltip, Typography } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, FileTextOutlined } from '@ant-design/icons'
import { ApiError } from '@/api'
import { useApproveTaskRunInputRequest, useCancelTaskRunModel, useInfiniteTaskRunLogs, useRejectTaskRunInputRequest, useReplyTaskRunInputRequest, useRetryTaskRunModel, useTaskRun, useTaskRunDiagnostics, useTaskRunExecutionContext, useTaskRunInputRequests } from '@/hooks/task-model'
import type { InputRequest, Task, TaskRunDetail } from '@/types/task-model'
import styles from './TaskDetailPage.module.scss'

const { Text, Title } = Typography

interface Props {
  projectId: string
  task: Task
  taskId: string
  taskRunId: string | null
  /** 当前最新运行的汇总状态；与任务头、步骤卡和最近执行列表使用同一快照。 */
  displayStatus?: TaskRunDetail['status']
  /** 父级根据同一 TaskStep 的 retry 链计算；旧失败记录只允许查看，不允许再次重试。 */
  retryEligibleRunIds: ReadonlySet<string>
  onRunChange: (taskRunId: string) => void
  onRetryRequested?: (taskRunId: string) => void
  onRetryStarted?: (taskRunId: string) => void
  onRetryRequestError?: () => void
  /** 任务级重试过渡态：重试已受理、新 run 尚未出现时禁用重试按钮，避免对同一源 run 反复提交。 */
  retryPending?: boolean
  /** 任务级取消与运行级取消共用互斥状态，避免两个入口并发提交。 */
  taskCancelPending?: boolean
  onRunCancelPendingChange?: (pending: boolean) => void
  focusRequest?: number
}

export function TaskRunInspectorPanel({ projectId, task, taskId, taskRunId, displayStatus, retryEligibleRunIds, onRunChange, onRetryRequested, onRetryStarted, onRetryRequestError, retryPending = false, taskCancelPending = false, onRunCancelPendingChange, focusRequest = 0 }: Props) {
  const panelRef = useRef<HTMLElement>(null)
  const runQuery = useTaskRun(projectId, taskRunId ?? '')
  const logsQuery = useInfiniteTaskRunLogs(projectId, taskRunId ?? '', { limit: 100 })
  const diagnosticsQuery = useTaskRunDiagnostics(projectId, taskRunId ?? '')
  const contextQuery = useTaskRunExecutionContext(projectId, taskRunId ?? '')
  const requestsQuery = useTaskRunInputRequests(projectId, taskRunId ?? '', { limit: 100 })
  const retry = useRetryTaskRunModel(projectId)
  const cancel = useCancelTaskRunModel(projectId)
  const run = runQuery.data
  const [retrySubmitted, setRetrySubmitted] = useState(false)
  const pending = retry.isPending || cancel.isPending || retrySubmitted || retryPending || taskCancelPending
  // 列表摘要与详情请求在自动重试的切换窗口可能先后返回。操作必须等待两者一致，
  // 否则会把上一轮 FAILED 的“重试”错误展示在新一轮 RUNNING 上。
  const statusMismatch = Boolean(run && displayStatus && displayStatus !== run.status)

  useEffect(() => {
    if (focusRequest === 0 || !taskRunId) return
    const panel = panelRef.current
    if (panel && typeof panel.scrollTo === 'function') {
      panel.scrollTo({ top: 0, behavior: 'smooth' })
    }
    void runQuery.refetch()
  }, [focusRequest, runQuery.refetch, taskRunId])

  useEffect(() => {
    if (!statusMismatch) return
    void runQuery.refetch()
  }, [statusMismatch, runQuery.refetch])

  function retryRun() {
    if (!run || !canRetry) return
    // 先展示“请求已提交”，再等待服务端创建新的 TaskRun；不伪造新运行记录或执行状态。
    setRetrySubmitted(true)
    onRetryRequested?.(run.id)
    retry.mutate(run.id, {
      onSuccess: (nextRun) => {
        // §12.2：202 已返回新 TaskRun（retryOfTaskRunId 指向当前源 run）。
        // 立即切换右栏到该真实返回值，避免用户只看到短暂 loading 后仍停在旧失败执行。
        onRetryStarted?.(run.id)
        onRunChange(nextRun.id)
      },
      onError: (error) => {
        onRetryRequestError?.()
        if (error instanceof ApiError && error.status === 409) void runQuery.refetch()
      },
      onSettled: () => setRetrySubmitted(false),
    })
  }

  function cancelRun() {
    if (!run || !canCancel || taskCancelPending) return
    onRunCancelPendingChange?.(true)
    cancel.mutate(run.id, {
      onError: (error) => { if (error instanceof ApiError && error.status === 409) void runQuery.refetch() },
      onSettled: () => onRunCancelPendingChange?.(false),
    })
  }

  // 重试仅面向仍处于执行路径的任务：取消中、已取消或已结束交付的任务不能再启动新的 TaskRun。
  // 只要是当前步骤最新且未被后续运行替代的失败/阻塞运行，即提供重试入口；
  // statusReason.retryable 是诊断信息，不能因后端缺失或误标而把有效入口隐藏。
  const taskAllowsRunRetry = !['CANCELLING', 'CANCELLED', 'SUCCEEDED', 'WAITING_DIFF_CONFIRMATION', 'WAITING_PREFLIGHT', 'DIFF_REJECTED', 'DELIVERING', 'DELIVERY_FAILED'].includes(task.status)
  const runRetryable = run !== undefined && ['FAILED', 'BLOCKED'].includes(run.status)
  const canRetry = !statusMismatch && taskAllowsRunRetry && runRetryable && retryEligibleRunIds.has(run?.id ?? '')
  // 任务已在取消流程中时，不能再单独取消某次运行；避免任务级和运行级写操作互相竞争。
  // 在任务仍有效时，运行状态集与后端 CANCELLABLE_RUNNING 一致。
  const taskAllowsRunCancellation = task.status !== 'CANCELLING' && task.status !== 'CANCELLED'
  const canCancel = !statusMismatch && taskAllowsRunCancellation && Boolean(run && ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED'].includes(run.status))
  return <section ref={panelRef} className={styles.runInspectorPanel} data-testid="run-inspector-panel"><div className={styles.runInspectorPanelHeading}><div><Title level={4}>本次执行</Title></div><div>{canRetry ? <Button size="small" onClick={retryRun} loading={retrySubmitted || retry.isPending} disabled={pending}>重试</Button> : null}{canCancel ? <Button size="small" danger onClick={cancelRun} loading={cancel.isPending} disabled={pending}>取消本次执行</Button> : null}</div></div>{retrySubmitted ? <Alert type="info" showIcon message="重试请求已提交，正在创建新的执行记录" /> : null}{statusMismatch ? <Alert type="info" showIcon message="执行状态正在同步，暂不可操作" /> : null}{!taskRunId ? <InspectorState text="选择一条执行记录查看详情" /> : runQuery.isLoading ? <InspectorState loading /> : runQuery.isError ? <InspectorError error={runQuery.error} resource="执行详情" /> : !run || run.taskId !== taskId ? <InspectorState text="执行记录不存在或不属于当前任务" /> : <RunInspectorContent run={run} displayStatus={displayStatus} task={task} logsQuery={logsQuery} diagnosticsQuery={diagnosticsQuery} contextQuery={contextQuery} requestsQuery={requestsQuery} projectId={projectId} />}<AcceptanceOverview task={task} /></section>
}

function RunInspectorContent({ run, displayStatus, task, logsQuery, diagnosticsQuery, contextQuery, requestsQuery, projectId }: { run: TaskRunDetail; displayStatus: TaskRunDetail['status'] | undefined; task: Task; logsQuery: ReturnType<typeof useInfiniteTaskRunLogs>; diagnosticsQuery: ReturnType<typeof useTaskRunDiagnostics>; contextQuery: ReturnType<typeof useTaskRunExecutionContext>; requestsQuery: ReturnType<typeof useTaskRunInputRequests>; projectId: string }) {
  const title = run.taskStepTitle || roleLabel(run.role)
  const effectiveStatus = displayStatus ?? run.status
  const hasInputRequestSection = requestsQuery.isLoading || requestsQuery.isError || (requestsQuery.data?.data?.length ?? 0) > 0
  return <div className={styles.runInspector}>
    <section className={styles.inspectorSummary}><div className={styles.inspectorTitleBlock}><Text className={styles.inspectorStepLabel}>当前执行步骤</Text><Tooltip title={title}><Title level={4} className={styles.inspectorRunTitle}>{title}</Title></Tooltip></div><Text type="secondary">{run.agent?.name ?? '未分配 Agent'} · {formatDuration(run.durationMs)}</Text><Tag className={styles.inspectorRunStatus} color={statusColor(effectiveStatus)}>{effectiveStatus}</Tag>{run.statusReason ? <Text type="secondary">{run.statusReason.title}：{run.statusReason.summary}</Text> : null}</section>
    <DiagnosticSection query={diagnosticsQuery} />
    <InspectorSection title="内部轨迹" icon={<ClockCircleOutlined />}>{run.steps?.length ? <div className={styles.inspectorTimeline}>{run.steps.map((step, index) => <div className={styles.inspectorTimelineItem} key={`${step.node}-${step.startedAt ?? index}`}><Tag color={statusColor(step.status)}>{index + 1}</Tag><div className={styles.inspectorTimelineContent}><Text strong ellipsis={{ tooltip: step.node }}>{step.node}</Text>{step.errorCode ? <Tooltip title={step.errorCode}><Text type="danger" className={styles.inspectorTimelineError} ellipsis>{step.errorCode}</Text></Tooltip> : null}</div><Text type="secondary">{formatDuration(step.durationMs)}</Text></div>)}</div> : <InternalTracePlaceholder loading={effectiveStatus === 'RUNNING'} />}</InspectorSection>
    {hasInputRequestSection ? <InspectorSection title="待处理请求" icon={<FileTextOutlined />}><DrawerInputRequests projectId={projectId} taskRunId={run.id} query={requestsQuery} /></InspectorSection> : null}
    <InspectorSection title="运行日志" icon={<CodeOutlined />}><RunLogsPanel query={logsQuery} runStatus={effectiveStatus} /></InspectorSection>
    <RunFooter task={task} run={run} contextQuery={contextQuery} />
  </div>
}

function RunFooter({ task, run, contextQuery }: { task: Task; run: TaskRunDetail; contextQuery: ReturnType<typeof useTaskRunExecutionContext> }) {
  const repository = contextQuery.isLoading
    ? '加载中'
    : contextQuery.isError
      ? '加载失败'
      : contextQuery.data?.repositoryId
        ? repositoryLabel(task, contextQuery.data.repositoryId)
        : '暂无仓库信息'

  return <footer className={styles.runInspectorFooter}>
    <Text type="secondary" ellipsis={{ tooltip: `仓库：${repository}` }}>仓库：{repository}</Text>
    <Text type="secondary">产物 {run.artifactSummary?.total ?? 0} · Diff {run.artifactSummary?.diffCount ?? 0}</Text>
  </footer>
}

function DiagnosticSection({ query }: { query: ReturnType<typeof useTaskRunDiagnostics> }) {
  if (query.isLoading) return <InspectorSection title="失败诊断" icon={<CodeOutlined />}><InspectorState loading /></InspectorSection>
  if (query.isError) return <InspectorSection title="失败诊断" icon={<CodeOutlined />}><InspectorError error={query.error} resource="失败诊断" /></InspectorSection>
  const diagnostic = query.data
  if (!diagnostic) return null
  const failure = diagnostic.failure
  const workerExecutions = diagnostic.workerExecutions
  return <InspectorSection title="失败诊断" icon={<CodeOutlined />}><div className={styles.inspectorDiagnostic}>{failure ? <div><Text strong type="danger">{failure.failureCode ?? failure.title}</Text><Text>{failure.summary}</Text></div> : <Text type="secondary">当前运行没有失败归因</Text>}{workerExecutions.length ? <div><Text strong>Worker 工具执行</Text>{workerExecutions.map((execution) => <div className={styles.inspectorDiagnosticItem} key={execution.executionId}><Text>{execution.tool ?? '未知工具'} · {execution.status ?? '未知状态'}</Text>{execution.failureCode ? <Text type="danger">{execution.failureCode}: {execution.failureSummary ?? '无摘要'}</Text> : null}</div>)}</div> : <Text type="secondary">本次运行未调用 Sandbox Worker</Text>}</div></InspectorSection>
}

function AcceptanceOverview({ task }: { task: Task }) {
  const criteria = task.acceptanceCriteria
  if (criteria.length === 0) return null
  const satisfied = criteria.filter((criterion) => criterion.status === 'SATISFIED').length
  return <InspectorSection title={`验收信息 ${satisfied}/${criteria.length}`} icon={<CheckCircleOutlined />}><div className={styles.acceptanceList}>{criteria.map((criterion) => <div key={criterion.id}><Tag color={criterion.status === 'SATISFIED' ? 'green' : criterion.status === 'UNSATISFIED' ? 'red' : criterion.status === 'NOT_APPLICABLE' ? 'default' : 'gold'}>{criterion.status}</Tag><Text ellipsis>{criterion.title}</Text></div>)}</div></InspectorSection>
}

function DrawerInputRequests({ projectId, taskRunId, query }: { projectId: string; taskRunId: string; query: ReturnType<typeof useTaskRunInputRequests> }) {
  if (query.isLoading) return <InspectorState loading />
  if (query.isError) return <InspectorError error={query.error} resource="待处理请求" />
  const requests = query.data?.data ?? []
  return <div className={styles.inspectorRequests}>{requests.map((request) => <DrawerInputRequest key={request.id} projectId={projectId} taskRunId={taskRunId} request={request} />)}</div>
}

function DrawerInputRequest({ projectId, taskRunId, request }: { projectId: string; taskRunId: string; request: InputRequest }) {
  const reply = useReplyTaskRunInputRequest(projectId, taskRunId)
  const approve = useApproveTaskRunInputRequest(projectId, taskRunId)
  const reject = useRejectTaskRunInputRequest(projectId, taskRunId)
  const [answer, setAnswer] = useState('')
  const [reason, setReason] = useState('')
  const pending = reply.isPending || approve.isPending || reject.isPending
  const error = reply.error ?? approve.error ?? reject.error
  const active = request.status === 'PENDING'
  return <Card size="small"><Text strong>{request.kind} <Tag>{request.status}</Tag></Text><Text>{request.prompt}</Text>{active && request.kind === 'INPUT' ? <div className={styles.inspectorForm}><Input.TextArea value={answer} rows={2} placeholder="输入回复" disabled={pending} onChange={(event) => setAnswer(event.target.value)} /><Button type="primary" disabled={pending || !answer.trim()} loading={reply.isPending} onClick={() => reply.mutate({ requestId: request.id, input: { answer: { value: answer.trim() } } })}>回复</Button></div> : active ? <div className={styles.inspectorForm}><Button type="primary" disabled={pending} loading={approve.isPending} onClick={() => approve.mutate({ requestId: request.id, input: { reason: 'approved in task workbench' } })}>批准</Button><Input.TextArea value={reason} rows={2} placeholder="拒绝原因（必填）" disabled={pending} onChange={(event) => setReason(event.target.value)} /><Button danger disabled={pending || !reason.trim()} loading={reject.isPending} onClick={() => reject.mutate({ requestId: request.id, input: { reason: reason.trim() } })}>拒绝</Button></div> : <Text type="secondary">已处理</Text>}{error ? <InspectorError error={error} resource="请求操作" /> : null}</Card>
}

function InspectorSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section className={styles.inspectorSection}><div className={styles.inspectorHeading}>{icon}{title}</div>{children}</section> }
function InternalTracePlaceholder({ loading }: { loading: boolean }) { return <div className={styles.internalTracePlaceholder}>{loading ? <Skeleton active title={false} paragraph={{ rows: 3, width: ['88%', '68%', '76%'] }} /> : <Text type="secondary">暂无内部步骤</Text>}</div> }
function InspectorState({ loading = false, text }: { loading?: boolean; text?: string }) { return <div className={styles.inspectorState}>{loading ? <Spin size="small" /> : null}<Text type="secondary">{text ?? '正在加载'}</Text></div> }
function InspectorError({ error, resource }: { error: Error | null; resource: string }) { const status = error instanceof ApiError ? error.status : undefined; return <Alert type="error" showIcon title={status === 403 ? `暂无权限查看${resource}` : `${resource}加载失败`} /> }
function roleLabel(role: string): string { return ({ ORCHESTRATOR: '编排器', PLANNER: '规划器', DEVELOPER: '开发者', TESTER: '测试器', REVIEWER: '审查者' } as Record<string, string>)[role] ?? role }
function statusColor(status: string): 'default' | 'processing' | 'success' | 'error' | 'warning' { if (status === 'RUNNING') return 'processing'; if (status === 'SUCCEEDED' || status === 'PASSED') return 'success'; if (status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED') return 'error'; if (status === 'WAITING_INPUT' || status === 'WAITING_APPROVAL' || status === 'PENDING') return 'warning'; return 'default' }
function formatDuration(value: number | null): string { if (value === null) return '暂无耗时'; if (value < 1000) return `${value} 毫秒`; if (value < 60000) return `${Math.round(value / 1000)} 秒`; return `${Math.floor(value / 60000)} 分 ${Math.round((value % 60000) / 1000)} 秒` }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(date) }
function repositoryLabel(task: Task, repositoryId: string | null): string { return repositoryId ? task.repositories.find((repository) => repository.repositoryId === repositoryId)?.name ?? repositoryId : '暂无仓库信息' }

function RunLogsPanel({ query, runStatus }: { query: ReturnType<typeof useInfiniteTaskRunLogs>; runStatus: string }) {
  if (query.isLoading) return <InspectorState loading />
  if (query.isError) return <InspectorError error={query.error} resource="日志" />
  const allLogs = (query.data?.pages ?? []).flatMap((page) => page.data)
  const nonTerminalLogs = allLogs.filter((log) => log.entryType !== 'TERMINAL')
  if (nonTerminalLogs.length === 0) return <Text type="secondary">{runStatus === 'SUCCEEDED' ? '任务已成功完成，暂无详细运行日志' : '暂无日志'}</Text>

  return <div className={styles.runLogsPanel}>
    <div className={styles.inspectorLogs}>{nonTerminalLogs.map((log) => <div key={log.id} className={styles.runLogEntry} data-entry-type={log.entryType}><span>{log.sequence}</span><time>{formatDate(log.timestamp)}</time><Text>{log.node}</Text><code>{log.content}</code></div>)}</div>
    {query.hasNextPage ? <Button type="link" size="small" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? '加载更多…' : '加载更多日志'}</Button> : null}
  </div>
}

