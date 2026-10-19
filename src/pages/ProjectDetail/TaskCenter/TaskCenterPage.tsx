import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Alert, Button, ConfigProvider, Empty, Pagination, Result, Segmented, Spin, theme, Typography, type ThemeConfig } from 'antd'
import { AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useInfiniteTasks } from '@/hooks/task-model'
import type { TaskListItem } from '@/types/task-model'
import { PATHS } from '@/routes/paths'
import { TaskFilters } from './TaskFilters'
import { TaskList } from './TaskList'
import { TASK_CENTER_STATUS_OPTIONS, type TaskCenterStatusFilter, type TaskCenterView } from './taskCenterConfig'
import { taskRepositories } from './taskDisplay'
import styles from './TaskCenterPage.module.scss'

const { Title, Text } = Typography
const PAGE_SIZE = 20
const MIN_TASK_CARD_GAP = 16
// 搜索关键词防抖窗口：避免每次按键 / IME 过程就触发 URL 同步和重新查询造成列表抖动。
const KEYWORD_DEBOUNCE_MS = 300
const SEARCH_PARAMS = new Set(['status', 'groupId', 'createdBy', 'repositoryId', 'view', 'keyword', 'scope'])

const taskCenterTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: { colorPrimary: '#0d9b9b', colorBgBase: '#ffffff', colorBgContainer: '#ffffff', colorBgElevated: '#ffffff', colorText: '#12213d', colorTextSecondary: '#6d7d95', colorBorder: '#e4eaf2', colorFillAlter: '#f7f9fc', borderRadius: 8 },
}

export default function TaskCenterPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const status = parseStatus(searchParams.get('status'))
  const groupId = searchParams.get('groupId') ?? undefined
  const createdBy = searchParams.get('createdBy') ?? undefined
  const repositoryId = searchParams.get('repositoryId') ?? undefined
  const search = searchParams.get('keyword') ?? ''
  const showCompletedTasks = searchParams.get('scope') === 'all'
  const legacyTaskId = searchParams.get('taskId')?.trim() || undefined
  const view = searchParams.get('view') === 'table' ? 'table' : 'board'
  // 输入框草稿：仅在用户主动提交（Enter / blur / 清除）时同步到 URL，
  // 这样可以避免每次按键都触发 URL 变化和 React Query 重新查询造成列表抖动。
  const [pendingSearch, setPendingSearch] = useState(search)
  const debouncedSearch = useDebouncedValue(pendingSearch, KEYWORD_DEBOUNCE_MS)
  // 记录上一次我们主动写入 URL 的 keyword 值，用于区分"外部变化"与"我们刚写入"。
  const lastWrittenSearchRef = useRef(search)

  useEffect(() => {
    // 仅在草稿稳定（debounced 与 pending 一致）后才写 URL，避免外部清空筛选时被草稿反悔覆盖。
    if (debouncedSearch !== pendingSearch) return
    const trimmed = debouncedSearch.trim()
    if (trimmed === search) {
      lastWrittenSearchRef.current = trimmed
      return
    }
    lastWrittenSearchRef.current = trimmed
    const next = new URLSearchParams(searchParams)
    if (trimmed) next.set('keyword', trimmed); else next.delete('keyword')
    setSearchParams(next, { replace: true })
  }, [debouncedSearch, pendingSearch, search, searchParams, setSearchParams])

  // 用户主动提交（回车 / 失焦 / 清除）时立即同步 URL，避免等待防抖窗口。
  function commitSearch(next: string) {
    const trimmed = next.trim()
    if (trimmed === search) return
    lastWrittenSearchRef.current = trimmed
    setPendingSearch(trimmed)
    const nextParams = new URLSearchParams(searchParams)
    if (trimmed) nextParams.set('keyword', trimmed); else nextParams.delete('keyword')
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    // 仅当 URL 是被外部改动时才把草稿同步过去，避免我们刚写入的 keyword 把正在输入的草稿覆盖掉。
    if (search === lastWrittenSearchRef.current) return
    lastWrittenSearchRef.current = search
    setPendingSearch(search)
  }, [search])

  // 「隐藏已完成任务」由服务端过滤（excludeStatus=SUCCEEDED）实现，保证游标分页正确；
  // 有显式筛选时始终展示全部（含已完成），与既有行为一致。
  const hasExplicitFilter = status !== 'all' || Boolean(createdBy || groupId || repositoryId || search)
  const hideCompletedTasks = !showCompletedTasks && !hasExplicitFilter
  const query = useInfiniteTasks(projectId, { groupId, status: status === 'all' ? undefined : status, excludeStatus: hideCompletedTasks ? 'SUCCEEDED' : undefined, createdBy, repositoryId, keyword: search || undefined, limit: PAGE_SIZE })
  const cardGap = MIN_TASK_CARD_GAP
  const [currentPage, setCurrentPage] = useState(1)

  const tasks = useMemo(() => {
    const seen = new Map<string, TaskListItem>()
    query.data?.pages.flatMap((page) => page.data).forEach((task) => seen.set(task.id, task))
    return [...seen.values()].sort(compareTasksByLatestActivity)
  }, [query.data])
  const groupOptions = useMemo(() => uniqueOptions(tasks.map((task) => ({ label: task.requirementGroup?.name || '暂无', value: task.requirementGroup?.id ?? '' }))), [tasks])
  const repositoryOptions = useMemo(() => uniqueOptions(tasks.flatMap((task) => taskRepositories(task).map((repository) => ({ label: repository.name, value: repository.repositoryId })))), [tasks])
  const createdByOptions = useMemo(() => uniqueOptions(tasks.flatMap((task) => task.createdByUser ? [{ label: task.createdByUser.displayName, value: task.createdByUser.id }] : [])), [tasks])
  const hasServerItems = query.data?.pages.some((page) => page.data.length > 0) ?? false
  // 已完成任务的隐藏已由服务端 excludeStatus=SUCCEEDED 完成，此处不再本地过滤。
  const displayedTasks = tasks
  const isUnfiltered = !hasExplicitFilter
  // UI 页码与服务端 cursor 批次一一对应；不能按屏幕列数再次切分同一批任务，
  // 否则一批 20 条会被拆成多个不完整视觉页，造成看板中间出现断层。
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const visibleTasks = displayedTasks.slice(pageStart, pageStart + PAGE_SIZE)
  const loadedPageCount = Math.max(1, Math.ceil(displayedTasks.length / PAGE_SIZE))
  const paginationTotal = displayedTasks.length + (query.hasNextPage ? PAGE_SIZE : 0)

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    for (const key of Array.from(next.keys())) {
      if (key === 'taskId') continue
      if (!SEARCH_PARAMS.has(key)) { next.delete(key); changed = true }
    }
    if (legacyTaskId) {
      next.delete('taskId')
      const search = next.toString()
      const from = `${PATHS.projectTasks(projectId)}${search ? `?${search}` : ''}`
      navigate(`${PATHS.projectTaskDetail(projectId, legacyTaskId)}${search ? `?${search}` : ''}`, { replace: true, state: { from } })
      return
    }
    if (changed) setSearchParams(next, { replace: true })
  }, [legacyTaskId, navigate, projectId, searchParams, setSearchParams])

  useEffect(() => {
    setCurrentPage(1)
  }, [groupId, status, createdBy, repositoryId, search, showCompletedTasks])

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  function resetFilters() {
    setPendingSearch('')
    const next = new URLSearchParams(searchParams)
    for (const key of ['status', 'createdBy', 'groupId', 'repositoryId']) next.delete(key)
    next.delete('keyword')
    next.delete('scope')
    setSearchParams(next, { replace: true })
  }

  function toggleCompletedTasks() {
    const next = new URLSearchParams(searchParams)
    if (hideCompletedTasks) next.set('scope', 'all'); else next.delete('scope')
    setSearchParams(next, { replace: true })
  }

  function viewTask(taskId: string) {
    const search = searchParams.toString()
    const from = `${PATHS.projectTasks(projectId)}${search ? `?${search}` : ''}`
    navigate(`${PATHS.projectTaskDetail(projectId, taskId)}${search ? `?${search}` : ''}`, { state: { from } })
  }

  async function changePage(nextPage: number) {
    if (nextPage <= loadedPageCount) {
      setCurrentPage(nextPage)
      return
    }
    if (nextPage === loadedPageCount + 1 && query.hasNextPage && !query.isFetchingNextPage) {
      try {
        await query.fetchNextPage()
        setCurrentPage(nextPage)
      } catch {
        // 下一页加载失败时保留当前页与已加载数据。
      }
    }
  }

  return (
    <ConfigProvider theme={taskCenterTheme}>
      <div className={styles.page}>
        <main className={styles.main} style={{ '--task-card-gap': `${cardGap}px` } as CSSProperties}>
          <header className={styles.header}>
            <Title level={2} className={styles.title}>任务中心</Title>
            {query.isFetching && !query.isLoading ? <Spin size="small" /> : null}
          </header>
          <TaskFilters status={status} groupId={groupId} repositoryId={repositoryId} createdBy={createdBy} search={pendingSearch} groupOptions={groupOptions} repositoryOptions={repositoryOptions} createdByOptions={createdByOptions} onStatusChange={(value) => updateParam('status', value === 'all' ? undefined : value)} onGroupChange={(value) => updateParam('groupId', value)} onRepositoryChange={(value) => updateParam('repositoryId', value)} onCreatedByChange={(value) => updateParam('createdBy', value)} onSearchDraftChange={setPendingSearch} onSearchCommit={commitSearch} onReset={resetFilters} />
          <div className={styles.listHeading}><div className={styles.listTitle}><Text strong>任务列表</Text><Button size="small" onClick={toggleCompletedTasks}>{hideCompletedTasks ? '查看已完成任务' : '隐藏已完成任务'}</Button></div><Segmented<TaskCenterView> aria-label="任务视图" value={view} onChange={(nextView) => updateParam('view', nextView)} options={[{ value: 'board', label: '看板', icon: <AppstoreOutlined /> }, { value: 'table', label: '表格', icon: <UnorderedListOutlined /> }]} /></div>
          <TaskCenterContent query={query} tasks={visibleTasks} hasServerItems={hasServerItems} isUnfiltered={isUnfiltered} hidesCompletedTasks={hideCompletedTasks} view={view} onViewDetails={viewTask} onRetry={() => void query.refetch()} />
          {!query.isLoading && displayedTasks.length > 0 ? <nav className={styles.pagination} aria-label="任务列表分页"><Pagination current={currentPage} pageSize={PAGE_SIZE} total={paginationTotal} showSizeChanger={false} showQuickJumper={{ goButton: '跳转' }} showLessItems disabled={query.isFetchingNextPage} onChange={(page) => void changePage(page)} /></nav> : null}
          {!query.isLoading && query.hasNextPage ? <div className={styles.loadMore}><Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>加载更多</Button></div> : null}
        </main>
      </div>
    </ConfigProvider>
  )
}

interface TaskCenterContentProps {
  query: ReturnType<typeof useInfiniteTasks>
  tasks: TaskListItem[]
  view: TaskCenterView
  hasServerItems: boolean
  isUnfiltered: boolean
  hidesCompletedTasks: boolean
  onViewDetails: (taskId: string) => void
  onRetry: () => void
}

function TaskCenterContent({ query, tasks, view, hasServerItems, isUnfiltered, hidesCompletedTasks, onViewDetails, onRetry }: TaskCenterContentProps) {
  if (query.isLoading) return <div className={styles.state} role="status"><Spin description="正在加载任务" /></div>
  if (query.isError && !query.data) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403
    return <Result className={styles.result} status={forbidden ? '403' : 'error'} title={forbidden ? '暂无权限查看任务' : '任务加载失败'} subTitle={forbidden ? '请联系项目管理员开通访问权限。' : '请稍后重试。'} extra={<Button onClick={onRetry}>重新加载</Button>} />
  }
  if (tasks.length === 0) return <div className={styles.state}><Empty className={styles.empty} description={!hasServerItems && isUnfiltered ? '项目暂无任务' : hidesCompletedTasks ? '当前没有需跟进的任务' : '当前筛选暂无匹配任务'} /></div>
  return <>{query.isFetchNextPageError ? <Alert type="error" showIcon title="下一页任务加载失败，当前列表已保留" action={<Button size="small" onClick={onRetry}>重试</Button>} className={styles.pageError} /> : null}<TaskList tasks={tasks} view={view} onViewDetails={onViewDetails} /></>
}

function parseStatus(value: string | null): TaskCenterStatusFilter {
  return TASK_CENTER_STATUS_OPTIONS.some((option) => option.value === value) ? value as TaskCenterStatusFilter : 'all'
}

function uniqueOptions(options: Array<{ label: string; value: string }>) {
  return [...new Map(options.map((option) => [option.value, option])).values()]
}

function compareTasksByLatestActivity(left: TaskListItem, right: TaskListItem) {
  const rightUpdatedAt = timestampOf(right.updatedAt)
  const leftUpdatedAt = timestampOf(left.updatedAt)
  if (rightUpdatedAt !== leftUpdatedAt) return rightUpdatedAt - leftUpdatedAt

  const rightCreatedAt = timestampOf(right.createdAt)
  const leftCreatedAt = timestampOf(left.createdAt)
  if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

  return left.id.localeCompare(right.id)
}

function timestampOf(value: string) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}
