import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Empty, Form, Input, Result, Space, Spin, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, CodeOutlined, CloseOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, githubApi } from '@/api'
import { useAcceptDiff, useConfirmTaskDiffReview, useDiff, useDiffFiles, useInfiniteDiffs, useRejectDiff, useRejectTaskDiffReview, useRetryTaskDiffReviewDelivery, useTask, useTaskDiffReview } from '@/hooks/task-model'
import { queryKeys } from '@/query/queryKeys'
import type { DiffDetail, DiffFile, DiffLine, DiffReviewBatch, DiffStatus, Task } from '@/types/task-model'
import { PATHS } from '@/routes/paths'
import { highlightDiffCode, syntaxLanguageLabel } from '@/utils/diffSyntaxHighlight'
import styles from './DiffCenterPage.module.scss'

const { Text, Title } = Typography
const PAGE_SIZE = 20

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '暂无' : String(value)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? display(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(status: DiffStatus): string {
  return status === 'PENDING_REVIEW' ? '待验收' : status === 'ACCEPTED' ? '已验收' : status === 'REJECTED' ? '已拒绝' : '已被后续修改取代'
}

function statusColor(status: DiffStatus): string {
  return status === 'PENDING_REVIEW' ? 'gold' : status === 'ACCEPTED' ? 'green' : status === 'REJECTED' ? 'red' : 'default'
}

function taskDeliveryDisplay(batch: DiffReviewBatch | undefined, diff: DiffDetail): { label: string; color: string } {
  if (!batch) return { label: statusLabel(diff.status), color: statusColor(diff.status) }
  if (batch.deliveryStatus === 'DELIVERED') return { label: '已交付', color: 'green' }
  if (batch.deliveryStatus === 'DELIVERING') return { label: '交付中', color: 'blue' }
  if (batch.deliveryStatus === 'FAILED' || batch.deliveryStatus === 'PARTIALLY_DELIVERED') return { label: '交付失败', color: 'red' }
  return { label: statusLabel(diff.status), color: statusColor(diff.status) }
}

export default function DiffCenterPage() {
  const { projectId = '', diffId = '' } = useParams<{ projectId: string; diffId?: string }>()
  const [searchParams] = useSearchParams()
  const taskId = searchParams.get('taskId')?.trim() || undefined
  const navigate = useNavigate()
  const listQuery = useInfiniteDiffs(projectId, { taskId, limit: PAGE_SIZE })
  const selectedQuery = useDiff(projectId, diffId)

  function backToList() {
    navigate(PATHS.projectDiffs(projectId) + (taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''))
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><Title level={2}><CodeOutlined /> 交付中心</Title><Text className={styles.subtitle}>Diff 摘要、验收与关联任务信息</Text></div>
      <Tag color="blue">Diff</Tag>
    </header>
    {taskId ? <Alert className={styles.notice} type="info" showIcon message={`当前仅按 taskId 筛选：${taskId}`} /> : null}
    <main className={styles.mainContent}>
      {diffId ? <Button type="text" icon={<ArrowLeftOutlined />} onClick={backToList}>返回交付中心</Button> : null}
      {diffId ? <section className={styles.selectedDetail}><DiffDetailPanel query={selectedQuery} projectId={projectId} onRefresh={async () => { await selectedQuery.refetch() }} /></section> : null}
      {!listQuery.isLoading && listQuery.hasNextPage ? <Button className={styles.loadMore} loading={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>加载更多</Button> : null}
    </main>
  </div>
}

function DiffDetailPanel({ query, projectId, onRefresh }: { query: ReturnType<typeof useDiff>; projectId: string; onRefresh: () => Promise<void> }) {
  const diff = query.data
  const taskQuery = useTask(projectId, diff?.taskId ?? '')
  // 最终 Diff 已生成时，审核权归 Task 级 DiffReviewBatch；单 Diff 页面只用于查看。
  const batchQuery = useTaskDiffReview(projectId, diff?.taskId ?? '', Boolean(diff?.taskId))
  const repositoriesQuery = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId),
  })
  const [refreshing, setRefreshing] = useState(false)
  async function refreshLatest() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([onRefresh(), taskQuery.refetch(), batchQuery.refetch()])
    } finally {
      setRefreshing(false)
    }
  }
  if (query.isLoading) return <Card><Spin /></Card>
  if (query.isError || !diff || diff.projectId !== projectId) return <Card><Result status={query.isError ? errorStatus(query.error) : '404'} title={query.isError ? errorTitle(query.error, 'Diff 详情') : 'Diff 不存在或不可见'} extra={<Button loading={refreshing} disabled={refreshing} onClick={() => void refreshLatest()}>刷新</Button>} /></Card>
  const deliveryDisplay = taskDeliveryDisplay(batchQuery.data, diff)
  const cardTitle = (
    <span>
      {taskQuery.data?.title?.trim() || display(diff.taskId)}
      <Tag color={deliveryDisplay.color}>{deliveryDisplay.label}</Tag>
    </span>
  )
  return <Card title={cardTitle}>
    <Space direction="vertical" className={styles.detailContent}>
      <DetailFields diff={diff} task={taskQuery.data} repositories={repositoriesQuery.data ?? []} />
      <DiffFilesPanel projectId={projectId} diffId={diff.id} />
      <DiffAcceptance diff={diff} projectId={projectId} task={taskQuery.data} batch={batchQuery.data} onRefresh={refreshLatest} refreshing={refreshing} batchState={batchQuery.isLoading ? 'loading' : batchQuery.data ? 'available' : 'unavailable'} />
      <Text type="secondary">本页面负责 Diff 验收和代码交付，不代表 MR 已创建或已合并。</Text>
    </Space>
  </Card>
}

/** 文件变更区块：文件列表 + 行级红绿 hunks（GET /diffs/{diffId}/files，映射层已适配后端结构） */
function DiffFilesPanel({ projectId, diffId }: { projectId: string; diffId: string }) {
  const filesQuery = useDiffFiles(projectId, diffId, { limit: 100 })
  const files = filesQuery.data?.data ?? []
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const current = files.find((f) => f.path === selectedPath) ?? files.find((f) => f.hunks.length > 0) ?? files[0]

  if (filesQuery.isLoading) return <Card size="small" title="文件变更"><Spin /></Card>
  if (files.length === 0) return null

  return <Card size="small" title="文件变更">
    <div className={styles.fileList}>
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          className={`${styles.fileChip}${current?.id === file.id ? ` ${styles.fileChipActive}` : ''}`}
          onClick={() => setSelectedPath(file.path)}
        >
          <span className={styles.fileStatus}>{fileStatusLabel(file.changeType)}</span>
          <span className={styles.filePath}>{file.path}</span>
          <span className={styles.fileStats}>+{file.additions}/-{file.deletions}</span>
        </button>
      ))}
    </div>
    {current ? (
      current.binary ? (
        <div className={styles.binary}>二进制文件，无法展示行级 Diff</div>
      ) : current.hunks.length === 0 ? (
        <Empty style={{ margin: 24 }} description="该文件暂无行级变更" />
      ) : (
        <section className={styles.codeViewer} aria-label={`${current.path} 代码预览`}>
          <div className={styles.codeViewerMeta}>
            <span>代码预览</span>
            <span className={styles.languageBadge}>{syntaxLanguageLabel(current.path)}</span>
          </div>
          <div className={styles.codeViewport} data-testid="diff-code-viewer" tabIndex={0}>
            {current.hunks.map((hunk) => (
              <div key={hunk.id}>
                <div className={styles.hunkHead}>{hunk.header}</div>
                {hunk.lines.map((line, index) => <DiffLineRow key={`${hunk.id}-${index}`} line={line} path={current.path} />)}
              </div>
            ))}
          </div>
        </section>
      )
    ) : null}
  </Card>
}

/** 行级渲染：CONTEXT 灰、ADD 绿、DEL 红（kind 已由映射层归一） */
function DiffLineRow({ line, path }: { line: DiffLine; path: string }) {
  const sign = line.kind === 'ADD' ? '+' : line.kind === 'DEL' ? '-' : ''
  return (
    <div className={`${styles.lineRow}${line.kind === 'ADD' ? ` ${styles.lineAdd}` : ''}${line.kind === 'DEL' ? ` ${styles.lineDel}` : ''}`}>
      <span className={styles.gutter}>{line.oldLine ?? ''}</span>
      <span className={styles.gutter}>{line.newLine ?? ''}</span>
      <span className={styles.sign}>{sign}</span>
      <span className={styles.code}>{highlightDiffCode(line.text, path)}</span>
    </div>
  )
}

/** DiffFile.changeType → A/M/D 徽标 */
function fileStatusLabel(changeType: DiffFile['changeType']): string {
  return changeType === 'ADDED' ? 'A' : changeType === 'DELETED' ? 'D' : 'M'
}

function DetailFields({ diff, task, repositories }: { diff: DiffDetail; task?: Task | undefined; repositories: Array<{ id: string; displayName?: string; fullName: string }> }) {
  const requirementGroupName = task?.requirementGroup?.name ?? display(diff.requirementGroupId)
  // 仓库信息优先从项目绑定仓库列表（diff.repositoryId 即 project_repositories.id）解析；
  // 若绑定列表未拉到或 id 未命中，回退到 task.repositories（同名属性），最后回退原始 ID
  const boundRepo = repositories.find((repo) => repo.id === diff.repositoryId)
  const taskRepo = task?.repositories?.find((r) => r.repositoryId === diff.repositoryId)
  const repositoryName = boundRepo?.displayName || boundRepo?.fullName || taskRepo?.name || display(diff.repositoryId)
  return <div className={styles.detailFields}>
    <span>需求群 <b>{requirementGroupName}</b></span><span>仓库 <b>{repositoryName}</b></span>
    <span>分支 <b>{display(diff.sourceBranch)}</b></span><span>交付时间 <b>{formatDate(diff.updatedAt)}</b></span>
  </div>
}

function DiffAcceptance({ diff, projectId, task, batch, onRefresh, refreshing, batchState }: { diff: DiffDetail; projectId: string; task: Task | undefined; batch: DiffReviewBatch | undefined; onRefresh: () => Promise<void>; refreshing: boolean; batchState: 'loading' | 'available' | 'unavailable' }) {
  const accept = useAcceptDiff(projectId)
  const reject = useRejectDiff(projectId)
  const [reason, setReason] = useState('')
  const pending = accept.isPending || reject.isPending
  const handleMutationError = (error: Error) => {
    if (errorCode(error) === 'DIFF_BATCH_REVIEW_REQUIRED') {
      void onRefresh()
      return
    }
    if (error instanceof ApiError && error.status === 409) void onRefresh()
  }
  if (diff.status === 'SUPERSEDED') return <Alert type="info" showIcon message="已被后续修改取代" description="同一工作区已有更新的 Diff；当前 Diff 不可验收或拒绝。" />
  if (batchState === 'loading') return <Text type="secondary">正在确认最终 Diff 验收状态…</Text>
  if (batchState === 'available' && batch) return <TaskDeliveryPanel projectId={projectId} task={task} batch={batch} onRefresh={onRefresh} refreshing={refreshing} />
  if (diff.status !== 'PENDING_REVIEW') return <Text type="secondary">该 Diff 已处理，只读。</Text>
  return <Form layout="vertical" onFinish={() => { if (reason.trim()) reject.mutate({ diffId: diff.id, input: { reason: reason.trim() } }, { onError: handleMutationError }) }}>
    <Form.Item label="拒绝原因" required><Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请输入拒绝原因" disabled={pending} /></Form.Item>
    <Space wrap><Button aria-label="accept-diff" type="primary" icon={<CheckOutlined />} loading={accept.isPending} disabled={pending} onClick={() => { if (!window.confirm('确认验收此 Diff？')) return; accept.mutate(diff.id, { onError: handleMutationError }) }}>验收 Diff</Button><Button aria-label="reject-diff" danger htmlType="submit" icon={<CloseOutlined />} loading={reject.isPending} disabled={pending || !reason.trim()}>拒绝 Diff</Button></Space>
    {accept.error || reject.error ? <Alert className={styles.mutationError} type="error" showIcon message={mutationError(accept.error ?? reject.error)} action={accept.error instanceof ApiError && accept.error.status === 409 || reject.error instanceof ApiError && reject.error.status === 409 ? <Button size="small" loading={refreshing} disabled={refreshing} onClick={() => void onRefresh()}>刷新状态</Button> : undefined} /> : null}
  </Form>
}

function TaskDeliveryPanel({ projectId, task, batch, onRefresh, refreshing }: { projectId: string; task: Task | undefined; batch: DiffReviewBatch; onRefresh: () => Promise<void>; refreshing: boolean }) {
  const navigate = useNavigate()
  const confirm = useConfirmTaskDiffReview(projectId)
  const reject = useRejectTaskDiffReview(projectId)
  const retry = useRetryTaskDiffReviewDelivery(projectId)
  const [reason, setReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const pending = confirm.isPending || reject.isPending || retry.isPending
  const error = confirm.error ?? reject.error ?? retry.error
  const superseded = batch.reviewStatus === 'SUPERSEDED'
  const awaitingConfirmation = batch.reviewStatus === 'PENDING_CONFIRMATION'
  // 最终 Diff 批次已进入待确认时必须提供任务级确认入口。
  // 旧 Task DTO 可能尚未返回该 capability；权限仍由 confirmDiffReview 接口最终校验。
  const canConfirm = awaitingConfirmation
  // 任务详情 capability 在交付状态切换中可能滞后；待确认批次统一给出两个任务级决策入口，
  // 最终权限和状态判断由对应接口保证，避免前端把有效操作错误隐藏成“死按钮”。
  const canReject = awaitingConfirmation
  const retryableDelivery = batch.reviewStatus === 'ACCEPTED' && (batch.deliveryStatus === 'FAILED' || batch.deliveryStatus === 'PARTIALLY_DELIVERED')
  const canRetry = !superseded && retryableDelivery && task?.capabilities?.canRetryDelivery === true
  const diffs = Array.isArray(batch.diffs) ? batch.diffs : []
  const repositories = Array.isArray(batch.repositoryDeliveries) ? batch.repositoryDeliveries : []
  const statusMessage = taskDeliveryStatusMessage(batch, repositories, task?.deliveryMode ?? null)
  const handleError = (mutationError: Error) => {
    if (mutationError instanceof ApiError && (mutationError.status === 409 || errorCode(mutationError) === 'DIFF_DELIVERY_NOT_RETRYABLE')) void onRefresh()
  }

  return <Card size="small" title="任务级交付">
    <Space direction="vertical" size="small" className={styles.taskDeliveryPanel}>
      <Text type="secondary">最终交付批次：{diffs.length} 个 Diff · {repositories.length} 个仓库。</Text>
      <Alert
        type={statusMessage.type}
        showIcon
        message={statusMessage.message}
        description={statusMessage.description}
        action={statusMessage.refreshable ? (
          <Button size="small" loading={refreshing} disabled={refreshing || pending} onClick={() => void onRefresh()}>刷新最新状态</Button>
        ) : task?.deliveryMode === 'DIFF_FIRST' && batch.deliveryStatus === 'DELIVERED' ? (
          <Button size="small" onClick={() => navigate(`${PATHS.projectTestset(projectId)}?tab=mr`)}>前往 MR 列表</Button>
        ) : undefined}
      />
      {canConfirm || canReject ? <Space wrap>
        {canConfirm ? <Button type="primary" loading={confirm.isPending} disabled={pending} onClick={() => confirm.mutate(batch.taskId, { onError: handleError })}>确认交付</Button> : null}
        {canReject ? <Button danger type="link" disabled={pending} onClick={() => setShowRejectForm((visible) => !visible)}>{showRejectForm ? '收起拒绝' : '拒绝交付'}</Button> : null}
      </Space> : null}
      {showRejectForm ? <Form layout="vertical" onFinish={() => { const trimmed = reason.trim(); if (trimmed) reject.mutate({ taskId: batch.taskId, input: { reason: trimmed } }, { onError: handleError }) }}>
        <Form.Item label="拒绝原因" required><Input.TextArea value={reason} rows={2} maxLength={4000} placeholder="请填写拒绝原因" disabled={pending} onChange={(event) => setReason(event.target.value)} /></Form.Item>
        <Space><Button onClick={() => setShowRejectForm(false)} disabled={pending}>取消</Button><Button danger type="primary" htmlType="submit" loading={reject.isPending} disabled={pending || !reason.trim()}>提交拒绝</Button></Space>
      </Form> : null}
      {canRetry ? <Button size="small" loading={retry.isPending} disabled={pending} onClick={() => retry.mutate(batch.taskId, { onError: handleError })}>重试交付</Button> : null}
      {error ? <Alert type="error" showIcon message={taskDeliveryError(error)} action={error instanceof ApiError && error.status === 409 ? <Button size="small" loading={refreshing} disabled={refreshing || pending} onClick={() => void onRefresh()}>刷新</Button> : undefined} /> : null}
    </Space>
  </Card>
}

function taskDeliveryStatusMessage(
  batch: DiffReviewBatch,
  repositories: DiffReviewBatch['repositoryDeliveries'],
  deliveryMode: Task['deliveryMode'],
): { type: 'info' | 'success' | 'warning' | 'error'; message: string; description: string; refreshable: boolean } {
  if (batch.reviewStatus === 'SUPERSEDED') return { type: 'warning', message: '该交付批次已被后续修改取代', description: '请刷新并查看最新 Diff，当前批次不能确认、拒绝或重试。', refreshable: true }
  if (batch.reviewStatus === 'REJECTED') return { type: 'error', message: '该任务交付已被拒绝', description: batch.reviewReason ? `拒绝原因：${batch.reviewReason}` : '需要生成新的最终 Diff 后再提交交付。', refreshable: false }
  if (batch.reviewStatus === 'PENDING_CONFIRMATION') {
    const description = deliveryMode === 'MR_FIRST'
      ? '确认后将按仓库提交代码，并自动进入 Dry Run 和 CQ+1 流程。'
      : deliveryMode === 'DIFF_FIRST'
        ? '确认后将按仓库提交代码；MR 需要在交付完成后由用户按需发起，不会自动执行 Dry Run 或 CQ+1。'
        : '确认后将按仓库提交代码；后续 MR 流程以任务的交付模式为准。'
    return { type: 'warning', message: '等待确认交付', description, refreshable: false }
  }
  if (batch.deliveryStatus === 'DELIVERED') {
    const description = deliveryMode === 'DIFF_FIRST'
      ? '所有仓库的代码提交已完成。你可以前往 MR 列表按需发起 MR；本流程不会自动执行 Dry Run 或 CQ+1。'
      : deliveryMode === 'MR_FIRST'
        ? '所有仓库的代码提交已完成，系统将继续进行 Dry Run 和 CQ+1；请前往 MR 列表查看后续状态。'
        : '所有仓库的代码提交已完成；如任务需要创建 MR，请前往 MR 列表查看后续状态。'
    return { type: 'success', message: '代码已交付', description, refreshable: false }
  }
  if (batch.deliveryStatus === 'DELIVERING') {
    const description = deliveryMode === 'DIFF_FIRST'
      ? '系统正在为各仓库提交代码。交付完成后可前往 MR 列表按需发起 MR，不会自动执行 Dry Run 或 CQ+1。'
      : deliveryMode === 'MR_FIRST'
        ? '系统正在为各仓库提交代码，完成后会自动进入 Dry Run 和 CQ+1 流程。请等待状态更新，无需重复提交。'
        : '系统正在为各仓库提交代码，请等待处理完成后查看后续 MR 流程。无需重复提交。'
    return { type: 'info', message: '代码交付处理中', description, refreshable: true }
  }
  if (batch.deliveryStatus === 'FAILED' || batch.deliveryStatus === 'PARTIALLY_DELIVERED') {
    const failedRepositories = repositories.filter((repository) => repository.deliveryStatus === 'FAILED').map((repository) => repository.repositoryName)
    const scope = failedRepositories.length > 0 ? `失败仓库：${failedRepositories.join('、')}。` : '部分仓库尚未完成交付。'
    return { type: 'error', message: batch.deliveryStatus === 'FAILED' ? '交付失败' : '部分仓库交付失败', description: `${scope} 修复问题后可重试未成功的仓库。`, refreshable: true }
  }
  return { type: 'info', message: '已验收，等待开始交付', description: '最终 Diff 已验收，正在等待服务端启动交付。', refreshable: true }
}

function errorStatus(error: Error | null): '403' | '404' | 'error' {
  const status = error instanceof ApiError ? error.status : undefined
  return status === 403 ? '403' : status === 404 ? '404' : 'error'
}

function errorTitle(error: Error | null, resource: string): string {
  const status = error instanceof ApiError ? error.status : undefined
  return status === 403 ? `暂无权限查看${resource}` : status === 404 ? `${resource}不存在或不可见` : `${resource}加载失败`
}

function mutationError(error: Error | null): string {
  if (error instanceof ApiError) return errorCode(error) === 'DIFF_REVIEW_SUPERSEDED' ? '该 Diff 已被后续修改取代，已刷新最新状态' : error.status === 409 ? 'Diff 状态已变化，请刷新后重试' : error.status === 422 ? '请求参数不合法' : error.status === 403 ? '暂无权限执行该操作' : error.status === 404 ? 'Diff 不存在或不可见' : '操作失败'
  return '操作失败，请稍后重试'
}

function errorCode(error: Error | null): string | undefined {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object' || !('error' in error.body)) return undefined
  const bodyError = (error.body as { error?: { code?: unknown } }).error
  return typeof bodyError?.code === 'string' ? bodyError.code : undefined
}

function taskDeliveryError(error: Error): string {
  if (!(error instanceof ApiError)) return '交付操作失败，请稍后重试'
  if (error.status === 403) return '暂无任务级交付权限'
  if (error.status === 409) return '交付状态已变化，请刷新后重试'
  return '交付操作失败，请稍后重试'
}
