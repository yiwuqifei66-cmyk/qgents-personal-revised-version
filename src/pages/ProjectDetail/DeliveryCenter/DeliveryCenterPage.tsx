import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteDeliveryItems, useDeliveryActionMutation, useDeliverySummary } from '@/hooks/delivery-center'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Alert, App, Button, Card, Empty, Form, Input, Result, Select, Skeleton, Tag, Typography, Modal } from 'antd'
import {
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  CloudUploadOutlined,
  CloseOutlined,
  DownOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InboxOutlined,
  ReloadOutlined,
  RollbackOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  TagsOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, groupApi, githubApi, projectApi } from '@/api'
import { PATHS } from '@/routes/paths'
import type {
  AgentDeliveryItem,
  CodeDeliveryItem,
  DeliveryAction,
  DeliveryDisplayStatus,
  DeliveryItem,
  DeliveryResourceType,
  MemoryDeliveryItem,
  SkillDeliveryItem,
} from '@/types/delivery-center'
import type { DiffReviewBatch } from '@/types/task-model'
import styles from './DeliveryCenterPage.module.scss'

const { Text, Title } = Typography

const STATUS_LABELS: Record<DeliveryDisplayStatus, string> = {
  DRAFT: '草稿中',
  PENDING_REVIEW: '待审核',
  PROCESSING: '处理中',
  ACCEPTED: '已接受',
  REJECTED: '已拒绝',
  DELIVERED: '已交付',
  FAILED: '交付失败',
  ARCHIVED: '已归档',
}

const STATUS_COLORS: Record<DeliveryDisplayStatus, string> = {
  DRAFT: 'default',
  PENDING_REVIEW: 'purple',
  PROCESSING: 'orange',
  ACCEPTED: 'green',
  REJECTED: 'red',
  DELIVERED: 'green',
  FAILED: 'red',
  ARCHIVED: 'default',
}

const TYPE_LABELS: Record<DeliveryResourceType, string> = { CODE: 'CODE', MEMORY: 'MEMORY', SKILL: 'SKILL', AGENT: 'AGENT' }
const TYPE_COLORS: Record<DeliveryResourceType, string> = { CODE: '#0d9b8a', MEMORY: '#7c55d9', SKILL: '#e79216', AGENT: '#2b6df0' }
const PAGE_SIZE = 5
// 搜索关键词防抖窗口：避免每次按键 / IME 过程就触发 URL 同步和重新查询造成页面抖动。
const KEYWORD_DEBOUNCE_MS = 300

/** 交付动作成功提示文案 */
const ACTION_SUCCESS_TEXT: Record<DeliveryAction, string> = {
  submitReview: '已提交审核，等待 Admin 批准',
  approve: '已批准并共享',
  reject: '已拒绝该交付',
  archive: '已归档',
  confirm: '已确认交付，正在同步目标分支并执行仓库交付',
  retryDelivery: '已重新发起交付，正在同步目标分支并重试',
}

// 确认/重试交付会先读取 GitHub 目标分支并同步到 Worker；这些错误需要给出明确的恢复动作。
const TARGET_BRANCH_SYNC_ERROR_CODES = new Set([
  'GITHUB_REPOSITORY_UNAVAILABLE',
  'GITHUB_INSTALLATION_UNAVAILABLE',
  'GITHUB_BRANCH_SHA_INVALID',
  'GIT_BASE_REF_NOT_SYNCED',
  'GIT_REMOTE_NETWORK_FAILED',
  'GIT_REMOTE_RATE_LIMITED',
  'GIT_REMOTE_SHA_MISMATCH',
  'SANDBOX_WORKER_UNAVAILABLE',
  'SANDBOX_WORKER_ERROR',
  'GIT_COMMAND_TIMEOUT',
])

function formatDate(value: string | null): string {
  if (!value) return '暂无'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function display(value: string | null | undefined): string {
  return value?.trim() ? value : '暂无'
}

function readType(value: string | null): DeliveryResourceType | undefined {
  return value === 'CODE' || value === 'MEMORY' || value === 'SKILL' || value === 'AGENT' ? value : undefined
}

function readStatus(value: string | null): DeliveryDisplayStatus | undefined {
  return value && value in STATUS_LABELS ? value as DeliveryDisplayStatus : undefined
}

function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return '操作失败，请稍后重试'
  const code = apiErrorCode(error)
  if (code && TARGET_BRANCH_SYNC_ERROR_CODES.has(code)) {
    return '无法同步目标分支，请检查 GitHub 连接后重试'
  }
  if (error.status === 403) return '无权限执行此操作'
  if (error.status === 404) return '关联资源不存在或不可见'
  if (error.status === 409) return code === 'DIFF_REVIEW_SUPERSEDED' ? '该 Diff 已被后续修改取代，已刷新最新数据' : '资源状态已变化，已刷新最新数据'
  if (error.status === 422) return '参数无效或当前状态不可操作'
  return error.message || '操作失败，请稍后重试'
}

function apiErrorCode(error: ApiError): string | null {
  if (!error.body || typeof error.body !== 'object' || !('error' in error.body)) return null
  const bodyError = (error.body as { error?: { code?: unknown } }).error
  return typeof bodyError?.code === 'string' ? bodyError.code : null
}

export default function DeliveryCenterPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [rejectTarget, setRejectTarget] = useState<DeliveryItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [detailTarget, setDetailTarget] = useState<DeliveryItem | null>(null)
  const [localCodeBatches, setLocalCodeBatches] = useState<Record<string, DiffReviewBatch>>({})
  // 搜索关键词草稿：仅在用户主动提交（Enter / blur / 清除）时同步到 URL，
  // 并辅以 300ms 防抖兜底，避免每次按键就触发 URL 变化和重新查询造成页面抖动。
  const keyword = searchParams.get('keyword') ?? ''
  const [pendingKeyword, setPendingKeyword] = useState(keyword)
  const debouncedKeyword = useDebouncedValue(pendingKeyword, KEYWORD_DEBOUNCE_MS)
  // 记录上一次我们主动写入 URL 的 keyword 值，用于区分"外部变化"与"我们刚写入"。
  const lastWrittenKeywordRef = useRef(keyword)

  useEffect(() => {
    // 仅在草稿稳定（debounced 与 pending 一致）后才写 URL，避免外部清空筛选时被草稿反悔覆盖。
    if (debouncedKeyword !== pendingKeyword) return
    const trimmed = debouncedKeyword.trim()
    if (trimmed === keyword) {
      lastWrittenKeywordRef.current = trimmed
      return
    }
    lastWrittenKeywordRef.current = trimmed
    const next = new URLSearchParams(searchParams)
    if (trimmed) next.set('keyword', trimmed); else next.delete('keyword')
    setSearchParams(next, { replace: true })
  }, [debouncedKeyword, pendingKeyword, keyword, searchParams, setSearchParams])

  // 用户主动提交（回车 / 失焦 / 清除）时立即同步 URL，避免等待防抖窗口。
  function commitKeyword(next: string) {
    const trimmed = next.trim()
    if (trimmed === keyword) return
    lastWrittenKeywordRef.current = trimmed
    setPendingKeyword(trimmed)
    const nextParams = new URLSearchParams(searchParams)
    if (trimmed) nextParams.set('keyword', trimmed); else nextParams.delete('keyword')
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    // 仅当 URL 是被外部改动时才把草稿同步过去，避免我们刚写入的 keyword 把正在输入的草稿覆盖掉。
    if (keyword === lastWrittenKeywordRef.current) return
    lastWrittenKeywordRef.current = keyword
    setPendingKeyword(keyword)
  }, [keyword])

  const filters = useMemo(() => ({
    groupId: searchParams.get('groupId') || undefined,
    type: readType(searchParams.get('type')),
    repositoryId: searchParams.get('repositoryId') || undefined,
    status: readStatus(searchParams.get('status')),
    createdBy: searchParams.get('createdBy') || undefined,
    keyword: searchParams.get('keyword') || undefined,
  }), [searchParams])
  // 无筛选直达交付中心时，优先呈现当前用户仍可处理的交付物；
  // 通过 view=all 保留查看完整交付历史的显式入口。
  const showAllItems = searchParams.get('view') === 'all'
  const hasExplicitFilter = Boolean(
    filters.groupId || filters.type || filters.repositoryId || filters.status || filters.createdBy || filters.keyword,
  )
  const onlyActionableItems = !showAllItems && !hasExplicitFilter

  const itemQuery = useInfiniteDeliveryItems(projectId, { ...filters, limit: PAGE_SIZE })
  // 侧栏活动不跟随筛选条件：始终展示该项目最近发生的交付状态变化。
  const recentActivityQuery = useInfiniteDeliveryItems(projectId, { limit: 3 })
  const summaryQuery = useDeliverySummary(projectId, {
    groupId: filters.groupId,
    type: filters.type,
    status: filters.status,
    repositoryId: filters.repositoryId,
    createdBy: filters.createdBy,
    keyword: filters.keyword,
  })
  const actionMutation = useDeliveryActionMutation()
  const [activeAction, setActiveAction] = useState<DeliveryAction | null>(null)
  const [refreshDeliveryUntil, setRefreshDeliveryUntil] = useState<number | null>(null)

  const { data: groups = [] } = useQuery({
    queryKey: ['groups', projectId],
    queryFn: () => groupApi.listByProject(projectId),
    enabled: Boolean(projectId),
  })
  const { data: repositories = [] } = useQuery({
    queryKey: ['qgents', 'projects', projectId, 'repositories'],
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId),
  })
  const { data: project } = useQuery({
    queryKey: ['qgents', 'projects', projectId],
    queryFn: () => projectApi.getById(projectId),
    enabled: Boolean(projectId),
  })
  // §30.3 AGENT 操作需要 teamId 命中 /api/teams/{teamId}/agents/{...}
  const teamId = project?.teamId

  const items = useMemo(() => {
    const seen = new Map<string, DeliveryItem>()
    itemQuery.data?.pages.flatMap((page) => page.data).forEach((item) => seen.set(item.id, item))
    return [...seen.values()]
  }, [itemQuery.data])

  const visibleItems = useMemo(() => {
    const synchronized = items.map((item) => {
      if (item.resourceType !== 'CODE') return item
      const batch = localCodeBatches[item.openTarget.taskId]
      return batch ? synchronizeRejectedCodeItem(item, batch) : item
    })
    return onlyActionableItems
      ? synchronized.filter((item) => hasActionableCapability(item)
        || (item.resourceType === 'CODE' && localCodeBatches[item.openTarget.taskId]?.reviewStatus === 'REJECTED'))
      : synchronized
  }, [items, localCodeBatches, onlyActionableItems])

  const groupedItems = useMemo(() => {
    const grouped = new Map<string, { id: string | null; name: string; items: DeliveryItem[]; latestAt: string }>()
    for (const item of visibleItems) {
      const id = item.requirementGroup?.id ?? null
      const key = id ?? '__unassociated__'
      const group = grouped.get(key) ?? {
        id,
        name: item.requirementGroup?.name ?? '未关联需求群',
        items: [],
        latestAt: item.updatedAt || item.createdAt,
      }
      group.items.push(item)
      if (item.updatedAt > group.latestAt) group.latestAt = item.updatedAt
      grouped.set(key, group)
    }
    return [...grouped.values()].sort((left, right) => right.latestAt.localeCompare(left.latestAt))
  }, [visibleItems])

  function updateFilter(key: 'groupId' | 'type' | 'repositoryId' | 'status' | 'keyword', value: string | undefined) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  function resetFilters() {
    setPendingKeyword('')
    setSearchParams({}, { replace: true })
  }

  function toggleItemScope() {
    const next = new URLSearchParams(searchParams)
    if (onlyActionableItems) next.set('view', 'all')
    else next.delete('view')
    setSearchParams(next, { replace: true })
  }

  function showPendingDeliveries() {
    const next = new URLSearchParams(searchParams)
    next.set('status', 'PENDING_REVIEW')
    next.delete('view')
    setSearchParams(next, { replace: true })
  }

  async function performAction(item: DeliveryItem, action: DeliveryAction, reason?: string) {
    if (actionMutation.isPending) return
    if (action === 'reject' && !reason?.trim()) {
      setActionErrors((current) => ({ ...current, [item.id]: '请填写拒绝原因' }))
      return
    }
    setActiveItemId(item.id)
    setActiveAction(action)
    setActionErrors((current) => ({ ...current, [item.id]: '' }))
    try {
      const response = await actionMutation.mutateAsync({ projectId, teamId, item, action, reason: reason?.trim() })
      if (action === 'reject' && item.resourceType === 'CODE' && isDiffReviewBatch(response)) {
        const rejectedBatch = response as DiffReviewBatch
        setLocalCodeBatches((current) => ({ ...current, [item.openTarget.taskId]: rejectedBatch }))
      }
      setActiveItemId(null)
      setActiveAction(null)
      // 后端可能先受理、再异步更新资源摘要；限时轮询避免 SSE 延迟时页面停在旧状态。
      setRefreshDeliveryUntil(Date.now() + 15_000)
      // 操作成功提示（申请交付等），避免用户误以为无响应后重复提交
      message.success(ACTION_SUCCESS_TEXT[action] ?? '操作成功')
      if (rejectTarget?.id === item.id) {
        setRejectTarget(null)
        setRejectReason('')
      }
    } catch (error) {
      setActionErrors((current) => ({ ...current, [item.id]: errorText(error) }))
      setActiveItemId(null)
      setActiveAction(null)
      // 后端可能已持久化失败状态；失败后立即拉取，避免旧的 PROCESSING 状态留在页面上。
      void Promise.all([
        itemQuery.refetch(),
        summaryQuery.refetch(),
        recentActivityQuery.refetch(),
      ])
    }
  }

  useEffect(() => {
    if (!refreshDeliveryUntil) return
    const refresh = () => {
      void itemQuery.refetch()
      void summaryQuery.refetch()
    }
    refresh()
    const remaining = Math.max(refreshDeliveryUntil - Date.now(), 0)
    const interval = window.setInterval(refresh, 3_000)
    const timeout = window.setTimeout(() => setRefreshDeliveryUntil(null), remaining)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [itemQuery.refetch, refreshDeliveryUntil, summaryQuery.refetch])

  function openReject(item: DeliveryItem) {
    setActionErrors((current) => ({ ...current, [item.id]: '' }))
    setRejectReason('')
    setRejectTarget(item)
  }

  function openResource(item: DeliveryItem) {
    if (!item.capabilities.canOpenResource) return
    // MEMORY/SKILL 在交付中心内直接弹详情窗，避免跳转后无高亮定位（最小改动）
    if (item.openTarget.kind === 'MEMORY' || item.openTarget.kind === 'SKILL') {
      setDetailTarget(item)
      return
    }
    if (item.openTarget.kind === 'AGENT') {
      // §30.3：AGENT 交付项跳到 Agent 团队管理页，定位到具体 Agent
      navigate(`${PATHS.projectAgents(projectId)}?agentId=${encodeURIComponent(item.openTarget.agentId)}`)
      return
    }
    switch (item.openTarget.kind) {
      case 'TASK_DIFF_REVIEW':
        // CODE：直接跳转 Diff 查看页（代表性 diffId），不再经任务中心中转
        if (item.resourceType === 'CODE' && item.diffId) {
          navigate(PATHS.projectDiff(projectId, item.diffId))
          break
        }
        navigate(`${PATHS.projectTaskDetail(projectId, item.openTarget.taskId)}?diffReviewBatchId=${encodeURIComponent(item.openTarget.diffReviewBatchId)}`)
        break
    }
  }

  const total = summaryQuery.data?.total ?? 0
  const hasMainError = itemQuery.isError

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Title level={2} className={styles.title}><InboxOutlined /> 交付中心</Title>
          <Text className={styles.subtitle}>按需求查看与管理所有交付物，支持审阅、验收与回溯</Text>
        </div>
      </header>

      <div className={styles.contentLayout}>
        <section className={styles.mainColumn}>
          <div className={styles.filterBar} aria-label="交付筛选">
            <FilterField label="搜索">
              <Input
                aria-label="搜索"
                allowClear
                value={pendingKeyword}
                placeholder="标题、摘要或来源（回车搜索）"
                onChange={(event) => setPendingKeyword(event.target.value)}
                onPressEnter={(event) => commitKeyword(event.currentTarget.value)}
                onBlur={(event) => commitKeyword(event.currentTarget.value)}
                onClear={() => commitKeyword('')}
              />
            </FilterField>
            <FilterField label="需求群">
              <Select
                aria-label="需求群"
                allowClear
                placeholder="全部需求群"
                value={filters.groupId}
                onChange={(value: string | undefined) => updateFilter('groupId', value)}
                options={groups.filter((group) => group.type === 'REQUIREMENT').map((group) => ({ label: group.title, value: group.id }))}
              />
            </FilterField>
            <FilterField label="交付类型">
              <Select aria-label="交付类型" placeholder="全部类型" value={filters.type} onChange={(value: DeliveryResourceType | undefined) => updateFilter('type', value)} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ label, value }))} />
            </FilterField>
            <FilterField label="仓库">
              <Select
                aria-label="仓库"
                value={filters.repositoryId}
                onChange={(value: string | undefined) => updateFilter('repositoryId', value)}
                placeholder="全部仓库"
                options={repositories.map((repository) => ({ label: repository.displayName ?? repository.fullName, value: repository.repositoryId }))}
              />
            </FilterField>
            <FilterField label="状态">
              <Select aria-label="状态" placeholder="全部状态" value={filters.status} onChange={(value: DeliveryDisplayStatus | undefined) => updateFilter('status', value)} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value }))} />
            </FilterField>
            <Button onClick={toggleItemScope}>{onlyActionableItems ? '查看全部交付物' : '仅看待处理'}</Button>
            <Button className={styles.resetButton} icon={<RollbackOutlined />} onClick={resetFilters}>重置筛选</Button>
          </div>

          <main className={styles.mainContent}>
            {hasMainError ? (
              <Result status={itemQuery.error instanceof ApiError && itemQuery.error.status === 403 ? '403' : itemQuery.error instanceof ApiError && itemQuery.error.status === 404 ? '404' : 'error'} title={errorText(itemQuery.error)} extra={<Button icon={<ReloadOutlined />} onClick={() => void itemQuery.refetch()}>重新加载</Button>} />
            ) : itemQuery.isLoading ? (
              <div className={styles.loadingStack}><Skeleton active /><Skeleton active /><Skeleton active /></div>
            ) : groupedItems.length === 0 ? (
              <Empty className={styles.empty} description={onlyActionableItems ? '当前没有需要你处理的交付物' : '当前没有符合条件的交付物'} />
            ) : (
              <div className={styles.groupList}>
                {groupedItems.map((group) => {
                  const key = group.id ?? '__unassociated__'
                  const collapsed = collapsedGroups.has(key)
                  return (
                    <section className={styles.groupSection} key={key}>
                      <button type="button" className={styles.groupHeader} onClick={() => setCollapsedGroups((current) => {
                        const next = new Set(current)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })} aria-expanded={!collapsed}>
                        <span className={styles.groupHeaderMain}><DownOutlined className={collapsed ? styles.chevronCollapsed : styles.chevron} /> <strong>{group.name}</strong><Text type="secondary">最近更新 {formatDate(group.latestAt)}</Text></span>
                        <span className={styles.groupCount}>{group.items.length} 个交付物</span>
                      </button>
                      {!collapsed && <div className={styles.itemList}>{group.items.map((item) => <DeliveryItemCard key={item.id} item={item} active={activeItemId === item.id} activeAction={activeItemId === item.id ? activeAction : null} error={actionErrors[item.id]} onAction={performAction} onReject={openReject} onOpenResource={openResource} onOpenGroup={(id) => navigate(PATHS.projectReqChat(projectId, id))} />)}</div>}
                    </section>
                  )
                })}
              </div>
            )}
            {!hasMainError && itemQuery.hasNextPage ? <Button className={styles.loadMore} loading={itemQuery.isFetchingNextPage} onClick={() => void itemQuery.fetchNextPage()}>加载更多</Button> : null}
          </main>
        </section>

        <DeliveryOverview summaryQuery={summaryQuery} total={total} recentActivityQuery={recentActivityQuery} onShowPending={showPendingDeliveries} onOpenResource={openResource} />
      </div>

      <Modal
        title="拒绝交付"
        open={Boolean(rejectTarget)}
        okText="确认拒绝"
        cancelText="取消"
        confirmLoading={actionMutation.isPending}
        okButtonProps={{ danger: true, disabled: !rejectReason.trim() }}
        onCancel={() => setRejectTarget(null)}
        onOk={() => {
          if (rejectTarget) void performAction(rejectTarget, 'reject', rejectReason)
        }}
      >
        <Form layout="vertical">
          <Form.Item label="拒绝原因" required validateStatus={rejectTarget && actionErrors[rejectTarget.id] ? 'error' : undefined} help={rejectTarget ? actionErrors[rejectTarget.id] : undefined}>
            <Input.TextArea autoFocus value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="请说明需要修改的内容" maxLength={500} rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      {/* MEMORY/SKILL 详情弹窗：交付中心内直接查看，避免跳转后无高亮定位 */}
      <Modal
        title={detailTarget ? detailTarget.title : ''}
        open={Boolean(detailTarget)}
        footer={null}
        onCancel={() => setDetailTarget(null)}
      >
        {detailTarget ? <DeliveryDetailModal item={detailTarget} /> : null}
      </Modal>
    </div>
  )
}

/** MEMORY/SKILL 分类中文映射 */
const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  ENGINEERING_DECISION: '工程决策',
  PROCESS: '流程约定',
  GENERAL: '通用',
}

/** MEMORY/SKILL/AGENT 交付详情弹窗内容（CODE 不经过此弹窗）；正文突出、属性收尾 */
function DeliveryDetailModal({ item }: { item: DeliveryItem }) {
  if (item.resourceType === 'CODE') return null
  if (item.resourceType === 'AGENT') return <AgentDetailModal item={item} />
  return <MemoryOrSkillDetailModal item={item} />
}

/** §30.3 AGENT 详情弹窗：角色、状态、描述片段、来源、审核信息 */
function AgentDetailModal({ item }: { item: AgentDeliveryItem }) {
  const sourceText = item.source.taskId
    ? `来源 Task ${display(item.source.taskDisplayCode)}`
    : item.source.messageId
      ? `来源消息 ${item.source.messageId}`
      : '无关联来源'
  return (
    <div className={styles.detailModal}>
      <div className={styles.detailModalRow}>
        <Tag color={TYPE_COLORS[item.resourceType]}>{TYPE_LABELS[item.resourceType]}</Tag>
        <Tag color={STATUS_COLORS[item.displayStatus]}>{STATUS_LABELS[item.displayStatus]}</Tag>
      </div>
      <div className={styles.detailModalBody}>{display(item.descriptionExcerpt)}</div>
      <div className={styles.detailModalMeta}>
        <div><span>角色</span><b>{item.role}</b></div>
        <div><span>可见性</span><b>{item.agentVisibility}</b></div>
        <div><span>资源状态</span><b>{item.resourceStatus}</b></div>
        <div><span>来源</span><b>{sourceText}</b></div>
        <div><span>创建人</span><b>{item.creator?.displayName ?? '未知'}</b></div>
        <div><span>创建时间</span><b>{formatDate(item.createdAt)}</b></div>
        <div><span>提交人</span><b>{item.submitter?.displayName ?? '暂无'}</b></div>
        <div><span>提交时间</span><b>{formatDate(item.submittedAt)}</b></div>
        <div><span>审核人</span><b>{item.reviewer?.displayName ?? '暂无'}</b></div>
        <div><span>更新时间</span><b>{formatDate(item.updatedAt)}</b></div>
      </div>
      {item.reviewReason ? (
        <div className={styles.reviewReason}><WarningOutlined /> {item.reviewReason}</div>
      ) : null}
    </div>
  )
}

function MemoryOrSkillDetailModal({ item }: { item: MemoryDeliveryItem | SkillDeliveryItem }) {
  const isMemory = item.resourceType === 'MEMORY'
  const sourceText = isMemory
    ? (item.sources ?? []).length > 0
      ? `来源消息 ${(item.sources ?? []).map((source) => display(source.messageId)).join('、')}`
      : '无关联来源'
    : item.source.taskId
      ? `来源 Task ${display(item.source.taskDisplayCode)}`
      : item.source.messageId
        ? `来源消息 ${item.source.messageId}`
        : '无关联来源'
  return (
    <div className={styles.detailModal}>
      <div className={styles.detailModalRow}>
        <Tag color={TYPE_COLORS[item.resourceType]}>{TYPE_LABELS[item.resourceType]}</Tag>
        <Tag color={STATUS_COLORS[item.displayStatus]}>{STATUS_LABELS[item.displayStatus]}</Tag>
      </div>
      <div className={styles.detailModalBody}>{display(item.contentExcerpt)}</div>
      {(item.tags ?? []).length > 0 ? <Tags tags={item.tags} /> : null}
      <div className={styles.detailModalMeta}>
        <div><span>分类</span><b>{isMemory ? MEMORY_CATEGORY_LABELS[item.category] ?? item.category : '—'}</b></div>
        <div><span>可见性</span><b>{item.visibility}</b></div>
        <div><span>资源状态</span><b>{item.resourceStatus}</b></div>
        <div><span>来源</span><b>{sourceText}</b></div>
        <div><span>创建人</span><b>{item.creator?.displayName ?? '未知'}</b></div>
        <div><span>创建时间</span><b>{formatDate(item.createdAt)}</b></div>
        <div><span>提交人</span><b>{item.submitter?.displayName ?? '暂无'}</b></div>
        <div><span>提交时间</span><b>{formatDate(item.submittedAt)}</b></div>
        <div><span>审核人</span><b>{item.reviewer?.displayName ?? '暂无'}</b></div>
        <div><span>更新时间</span><b>{formatDate(item.updatedAt)}</b></div>
      </div>
      {item.reviewReason ? (
        <div className={styles.reviewReason}><WarningOutlined /> {item.reviewReason}</div>
      ) : null}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.filterField}><span>{label}</span>{children}</label>
}

function DeliveryItemCard({
  item,
  active,
  activeAction,
  error,
  onAction,
  onReject,
  onOpenResource,
  onOpenGroup,
}: {
  item: DeliveryItem
  active: boolean
  activeAction: DeliveryAction | null
  error?: string
  onAction: (item: DeliveryItem, action: DeliveryAction, reason?: string) => Promise<void>
  onReject: (item: DeliveryItem) => void
  onOpenResource: (item: DeliveryItem) => void
  onOpenGroup: (groupId: string) => void
}) {
  return (
    <article id={`delivery-item-${item.id}`} className={styles.itemCard}>
      <div className={styles.itemIcon} style={{ background: TYPE_COLORS[item.resourceType] }}>
        {item.resourceType === 'CODE' ? <CodeOutlined /> : item.resourceType === 'MEMORY' ? <FileTextOutlined /> : item.resourceType === 'AGENT' ? <RobotOutlined /> : <SafetyCertificateOutlined />}
        <small>{TYPE_LABELS[item.resourceType]}</small>
      </div>
      <div className={styles.itemBody}>
        <div className={styles.itemTitleRow}>
          <div>
            <strong>{item.title}</strong>
            {item.source.taskDisplayCode ? <span className={styles.taskCodeTag}>({display(item.source.taskDisplayCode)})</span> : null}
            {item.version ? <Tag className={styles.versionTag}>{item.version}</Tag> : null}
          </div>
          <Tag color={STATUS_COLORS[item.displayStatus]}>{STATUS_LABELS[item.displayStatus]}</Tag>
        </div>
        <div className={styles.itemSummary}>{item.resourceType === 'CODE' ? <CodeDetails item={item} /> : item.resourceType === 'MEMORY' ? <MemoryDetails item={item} /> : item.resourceType === 'AGENT' ? <AgentDetails item={item} /> : <SkillDetails item={item} />}</div>
        <div className={styles.itemFooter}><span><UserOutlined /> {item.creator?.displayName ?? '未知'}</span><span>创建于 {formatDate(item.createdAt)}</span>{item.submittedAt ? <span>提交于 {formatDate(item.submittedAt)}</span> : null}{item.reviewer ? <span>审核者 {item.reviewer.displayName}</span> : null}</div>
        {item.reviewReason ? <div className={styles.reviewReason}><WarningOutlined /> {item.reviewReason}</div> : null}
        <div className={styles.itemActions}>
          {item.resourceType === 'CODE' ? <CodeActions item={item} active={active} onAction={onAction} onReject={onReject} onOpenResource={onOpenResource} onOpenGroup={onOpenGroup} /> : <ResourceActions item={item} active={active} onAction={onAction} onReject={onReject} onOpenResource={onOpenResource} />}
          {activeAction ? <Text type="secondary">{deliveryActionPendingText(activeAction)}</Text> : null}
        </div>
        {error ? <Alert className={styles.itemError} type="error" showIcon message={error} /> : null}
      </div>
    </article>
  )
}

function CodeDetails({ item }: { item: CodeDeliveryItem }) {
  return <><div className={styles.detailLine}><span><CloudUploadOutlined /> {item.repositories.map((repository) => `${repository.name} / ${display(repository.branch)}`).join('、') || '暂无仓库'}</span><span>来源 {display(item.requirementGroup?.name)}</span></div><div className={styles.detailLine}><span>Diff {item.filesChanged} 文件 · <b className={styles.additions}>+{item.additions}</b> <b className={styles.deletions}>-{item.deletions}</b></span><span>Review {codeReviewStatusLabel(item.reviewStatus)} · Delivery {item.deliveryStatus}</span></div>{item.reviewStatus === 'REJECTED' ? <div className={styles.reviewReason}><WarningOutlined /> 已拒绝，请回需求群根据拒绝意见继续修改。</div> : item.reviewStatus === 'SUPERSEDED' ? <div className={styles.reviewReason}><WarningOutlined /> 已被同一工作区的后续修改取代，不可确认或拒绝。</div> : null}{item.repositoryDeliveries.length > 1 ? <div className={styles.repositoryStrip}>{item.repositoryDeliveries.map((delivery) => <span key={delivery.repositoryId}>{delivery.repositoryName}: {delivery.deliveryStatus}</span>)}</div> : null}{item.mergeRequest ? <div className={styles.mrLine}>MR #{item.mergeRequest.number} · {item.mergeRequest.title}</div> : null}</>
}

function deliveryActionPendingText(action: DeliveryAction): string {
  return ({ submitReview: '正在提交交付申请…', approve: '正在提交批准请求…', confirm: '正在同步目标分支并确认交付…', reject: '正在提交拒绝请求…', archive: '正在提交归档请求…', retryDelivery: '正在同步目标分支并重试交付…' } as Record<DeliveryAction, string>)[action]
}

function codeReviewStatusLabel(status: CodeDeliveryItem['reviewStatus']): string {
  return status === 'PENDING_CONFIRMATION' ? '待确认' : status === 'ACCEPTED' ? '已确认' : status === 'REJECTED' ? '已拒绝' : '已被后续修改取代'
}

function MemoryDetails({ item }: { item: MemoryDeliveryItem }) {
  const sourceText = item.requirementGroup?.name ? `来源群 ${item.requirementGroup.name}` : '无关联来源'
  return <><div className={styles.detailLine}><span><FileTextOutlined /> {item.category} · {item.visibility} · {item.resourceStatus}</span><span>{sourceText}</span></div><div className={styles.excerpt}>{display(item.contentExcerpt)}</div><Tags tags={item.tags} /></>
}

function SkillDetails({ item }: { item: SkillDeliveryItem }) {
  return <><div className={styles.detailLine}><span><SafetyCertificateOutlined /> {item.visibility} · {item.resourceStatus}</span><span>{item.source.taskId ? `来源 Task ${display(item.source.taskDisplayCode)}` : item.source.messageId ? `来源消息 ${item.source.messageId}` : '无关联来源'}</span></div><div className={styles.excerpt}>{display(item.capabilitySummary ?? item.contentExcerpt)}</div><Tags tags={item.tags} /></>
}

/** §30.3 AGENT 交付项摘要：角色 + 描述片段 + 内部状态（PENDING/TEAM/ARCHIVED） */
function AgentDetails({ item }: { item: AgentDeliveryItem }) {
  const internalLabel = item.agentVisibility === 'PENDING' ? '待审核' : item.agentVisibility === 'TEAM' ? '已发布' : '已归档'
  return <><div className={styles.detailLine}><span><RobotOutlined /> 角色 {item.role} · 状态 {internalLabel} · {item.resourceStatus}</span><span>{item.source.taskId ? `来源 Task ${display(item.source.taskDisplayCode)}` : item.source.messageId ? `来源消息 ${item.source.messageId}` : '无关联来源'}</span></div><div className={styles.excerpt}>{display(item.descriptionExcerpt ?? item.summary)}</div></>
}

function Tags({ tags }: { tags: string[] }) {
  return <span className={styles.tags}>{(tags ?? []).map((tag) => <Tag key={tag} icon={<TagsOutlined />}>{tag}</Tag>)}</span>
}

function ResourceActions({ item, active, onAction, onReject, onOpenResource }: { item: MemoryDeliveryItem | SkillDeliveryItem | AgentDeliveryItem; active: boolean; onAction: (item: DeliveryItem, action: DeliveryAction) => Promise<void>; onReject: (item: DeliveryItem) => void; onOpenResource: (item: DeliveryItem) => void }) {
  // §30.3：AGENT 不在交付中心暴露「申请交付」入口（canSubmitReview 恒 false）
  // 视图按钮是「查看 Agent」而非「查看详情」
  return <>
    {item.capabilities.canOpenResource ? <Button size="small" icon={item.resourceType === 'AGENT' ? <RobotOutlined /> : <GlobalOutlined />} onClick={() => onOpenResource(item)}>{item.resourceType === 'AGENT' ? '查看 Agent' : '查看详情'}</Button> : null}
    {item.resourceType !== 'AGENT' && item.capabilities.canSubmitReview ? <Button size="small" type="primary" icon={<SendOutlined />} loading={active} disabled={active} onClick={() => void onAction(item, 'submitReview')}>申请交付</Button> : null}
    {item.capabilities.canApprove ? <Button size="small" type="primary" icon={<CheckOutlined />} loading={active} disabled={active} onClick={() => void onAction(item, 'approve')}>{item.resourceType === 'AGENT' ? '批准发布' : '批准并共享'}</Button> : null}
    {item.capabilities.canReject ? <Button size="small" danger icon={<CloseOutlined />} disabled={active} onClick={() => onReject(item)}>{item.resourceType === 'AGENT' ? '拒绝发布' : '拒绝'}</Button> : null}
  </>
}

function hasActionableCapability(item: DeliveryItem): boolean {
  const capabilities = item.capabilities
  return capabilities.canSubmitReview
    || capabilities.canApprove
    || capabilities.canReject
    || capabilities.canRetryDelivery
}

function CodeActions({ item, active, onAction, onReject, onOpenResource, onOpenGroup }: { item: CodeDeliveryItem; active: boolean; onAction: (item: DeliveryItem, action: DeliveryAction) => Promise<void>; onReject: (item: DeliveryItem) => void; onOpenResource: (item: DeliveryItem) => void; onOpenGroup: (groupId: string) => void }) {
  if (item.reviewStatus === 'REJECTED') {
    return item.requirementGroup
      ? <Button size="small" type="link" onClick={() => onOpenGroup(item.requirementGroup!.id)}>回群继续修改</Button>
      : null
  }
  return <>
    {item.capabilities.canOpenResource ? <Button size="small" icon={<CodeOutlined />} onClick={() => onOpenResource(item)}>查看 Diff</Button> : null}
    {item.capabilities.canApprove ? <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={active} disabled={active} onClick={() => void onAction(item, 'confirm')}>确认交付</Button> : null}
    {item.capabilities.canReject ? <Button size="small" danger icon={<CloseOutlined />} disabled={active} onClick={() => onReject(item)}>拒绝</Button> : null}
    {item.capabilities.canRetryDelivery ? <Button size="small" icon={<ReloadOutlined />} loading={active} disabled={active} onClick={() => void onAction(item, 'retryDelivery')}>重试交付</Button> : null}
  </>
}

function isDiffReviewBatch(value: unknown): value is DiffReviewBatch {
  return Boolean(value && typeof value === 'object' && 'reviewStatus' in value && 'taskId' in value)
}

function synchronizeRejectedCodeItem(item: CodeDeliveryItem, batch: DiffReviewBatch): CodeDeliveryItem {
  if (batch.reviewStatus !== 'REJECTED') return item
  return {
    ...item,
    displayStatus: 'REJECTED',
    resourceStatus: batch.deliveryStatus,
    reviewStatus: 'REJECTED',
    deliveryStatus: batch.deliveryStatus as CodeDeliveryItem['deliveryStatus'],
    reviewReason: batch.reviewReason,
    capabilities: {
      ...item.capabilities,
      canApprove: false,
      canReject: false,
      canRetryDelivery: false,
    },
  }
}

function DeliveryOverview({ summaryQuery, total, recentActivityQuery, onShowPending, onOpenResource }: { summaryQuery: ReturnType<typeof useDeliverySummary>; total: number; recentActivityQuery: ReturnType<typeof useInfiniteDeliveryItems>; onShowPending: () => void; onOpenResource: (item: DeliveryItem) => void }) {
  if (summaryQuery.isLoading) return <aside className={styles.sidebar}><Card className={styles.overviewCard}><Skeleton active /></Card><Card className={styles.overviewCard}><Skeleton active /></Card></aside>
  if (summaryQuery.isError || !summaryQuery.data) return <aside className={styles.sidebar}><Card className={styles.overviewCard}><Alert type="error" showIcon message="交付概览加载失败" description={errorText(summaryQuery.error)} action={<Button size="small" onClick={() => void summaryQuery.refetch()}>重试</Button>} /></Card><Card className={styles.overviewCard}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="仓库数据不可用" /></Card></aside>

  const { countsByStatus, repositorySummaries } = summaryQuery.data
  const accepted = (countsByStatus.ACCEPTED ?? 0) + (countsByStatus.DELIVERED ?? 0)
  const processing = countsByStatus.PROCESSING ?? 0
  const failed = countsByStatus.FAILED ?? 0
  const pending = countsByStatus.PENDING_REVIEW ?? 0
  const draft = countsByStatus.DRAFT ?? 0
  const archived = countsByStatus.ARCHIVED ?? 0
  const chartTotal = Math.max(total, 1)
  const acceptedDeg = accepted / chartTotal * 360
  const pendingDeg = acceptedDeg + pending / chartTotal * 360
  const processingDeg = pendingDeg + processing / chartTotal * 360
  return <aside className={styles.sidebar}>
    <Card className={styles.overviewCard} title="交付概览">
      <div className={styles.chartRow}><div className={styles.donut} style={{ background: `conic-gradient(#45bb73 0deg ${acceptedDeg}deg, #a875df ${acceptedDeg}deg ${pendingDeg}deg, #f1a62d ${pendingDeg}deg ${processingDeg}deg, #7b879a ${processingDeg}deg 360deg)` }}><div><strong>{total}</strong><span>总交付物</span></div></div><div className={styles.chartLegend}><Legend color="#45bb73" label="已接受 / 已共享" value={accepted} /><Legend color="#a875df" label="待审核" value={pending} /><Legend color="#f1a62d" label="处理中" value={processing} /><Legend color="#e05252" label="失败" value={failed} /><Legend color="#7b879a" label="草稿 / 归档" value={draft + archived} /></div></div>
    </Card>
    <Card className={styles.overviewCard} title={<span>仓库交付状态 <Text type="secondary">{repositorySummaries.length} 个仓库</Text></span>}>
      {repositorySummaries.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无仓库交付" /> : <div className={styles.repositoryList}>{repositorySummaries.map((repository) => <div className={styles.repositoryRow} key={repository.repositoryId}><div><strong>{repository.repositoryName}</strong><span>{repository.accepted}/{repository.total} 已交付</span></div><div>{repository.deliveryStatus && repository.deliveryStatus !== 'NOT_STARTED' ? <Tag color={repository.failed > 0 ? 'red' : repository.pending > 0 ? 'orange' : 'green'}>{repository.deliveryStatus}</Tag> : null}{repository.mergeRequest ? <small>MR #{repository.mergeRequest.number}</small> : null}</div></div>)}</div>}
    </Card>
    <Card className={styles.overviewCard} title={<span>待处理交付 <Text type="secondary">{summaryQuery.data.pendingForCurrentUser}</Text></span>}>
      <div className={styles.pendingOverview}><span>{summaryQuery.data.pendingForCurrentUser > 0 ? '有交付等待你的确认或审核。' : '当前没有待处理交付。'}</span>{summaryQuery.data.pendingForCurrentUser > 0 ? <Button size="small" type="primary" onClick={onShowPending}>查看待处理</Button> : null}</div>
    </Card>
    <Card className={styles.overviewCard} title="最近活动">
      <RecentDeliveryActivities query={recentActivityQuery} onOpenResource={onOpenResource} />
    </Card>
  </aside>
}

function RecentDeliveryActivities({ query, onOpenResource }: { query: ReturnType<typeof useInfiniteDeliveryItems>; onOpenResource: (item: DeliveryItem) => void }) {
  const activities = useMemo(() => query.data?.pages.flatMap((page) => page.data).slice(0, 3) ?? [], [query.data])
  if (query.isLoading) return <Skeleton active title={false} paragraph={{ rows: 3 }} />
  if (query.isError) return <Button type="link" size="small" onClick={() => void query.refetch()}>重新加载活动</Button>
  if (activities.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无交付动态" />
  return <div className={styles.recentActivityList}>{activities.map((item) => <button type="button" key={item.id} className={styles.recentActivityItem} onClick={() => onOpenResource(item)} disabled={!item.capabilities.canOpenResource}><ClockCircleOutlined /><div><strong>{item.title}</strong><span><Tag color={STATUS_COLORS[item.displayStatus]}>{STATUS_LABELS[item.displayStatus]}</Tag>{formatDate(item.updatedAt)}</span></div></button>)}</div>
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return <div><i style={{ background: color }} /><span>{label}</span><strong>{value}</strong></div>
}
