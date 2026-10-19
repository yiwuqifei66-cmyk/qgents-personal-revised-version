import { lazy, Suspense, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Form, Input, Modal, Select } from 'antd'
import { SearchOutlined, PushpinOutlined } from '@ant-design/icons'
import { PATHS, PROJECT_NAV } from '@/routes/paths'
import { ApiError, groupApi, projectApi, teamApi } from '@/api'
import { useAppUiStore } from '@/store/appUiStore'
import { latestMessageText } from '@/utils/messageSummary'
import { useProjectTaskDomainEvents } from '@/realtime/useProjectTaskDomainEvents'
import { useRealtimeConnectionStatus } from '@/realtime/realtimeClient'
import type { CreateGroupPayload, Group } from '@/types'
import './ProjectDetailLayout.scss'

// 群聊仅在项目总群页面可见；将其移出其他项目子页的首屏模块图。
const ChatPanel = lazy(async () => ({ default: (await import('@/components/chat/ChatPanel')).ChatPanel }))

/** 群聊置顶（本地偏好）localStorage 键，按项目隔离，避免不同项目互相污染。 */
const PINNED_GROUPS_KEY = 'qgents_pinned_groups'

function pinnedGroupsKey(projectId: string): string {
  return `${PINNED_GROUPS_KEY}:${projectId}`
}

function readPinnedGroups(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(pinnedGroupsKey(projectId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * 项目详情布局：固定左侧导航，右侧为子路由 Outlet
 *
 * 左侧「群聊」列表：项目总群 + 需求群，数据来自 GET /groups
 *   /app/projects/:projectId/req-chat/:groupId
 */
export default function ProjectDetailLayout() {
  const { projectId = '', groupId } = useParams<{
    projectId: string
    groupId?: string
  }>()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const onReqChat = location.pathname.includes('/req-chat')
  const onCode = location.pathname.includes('/code')
  const setCurrentTeam = useAppUiStore((state) => state.setCurrentTeam)
  const setCurrentProject = useAppUiStore((state) => state.setCurrentProject)
  const openProjectDetailNav = useAppUiStore((state) => state.openProjectDetailNav)
  const realtimeStatus = useRealtimeConnectionStatus()
  // WebSocket 是项目实时事件主通道；SSE 只在它不可用时接管。
  useProjectTaskDomainEvents(projectId, realtimeStatus !== 'connected')

  const [createOpen, setCreateOpen] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  // 群聊置顶（前端 localStorage 兜底，后端本轮不返回 isPinned，见接口文档 §置顶不在本轮范围）
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readPinnedGroups(projectId))
  const [form] = Form.useForm<CreateGroupPayload>()

  // 左侧导航栏宽度（可拖拽调整）
  const [sidebarWidth, setSidebarWidth] = useState(264)
  const MIN_SIDEBAR = 200
  const MAX_SIDEBAR = 520

  function startResize(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    function onMove(ev: MouseEvent) {
      const next = startWidth + (ev.clientX - startX)
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, next)))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  // 从后端获取项目名
  const { data: project } = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => projectApi.getById(projectId),
    enabled: !!projectId,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false
      return failureCount < 3
    },
  })
  const projectName = project?.name ?? projectId

  // 群列表（项目总群 + 需求群）
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['groups', projectId],
    queryFn: () => groupApi.listByProject(projectId),
    enabled: !!projectId,
  })
  const mainGroup = groups.find((g) => g.type === 'PROJECT_MAIN') ?? groups[0]
  // 默认进入项目总群时直接复用当前布局渲染，避免先进入空 req-chat 再 Navigate 一次。
  const effectiveGroupId = onReqChat ? groupId ?? mainGroup?.id : groupId

  // 建群选成员的候选池 = 项目成员；项目成员接口可能不返回 displayName，用团队成员接口补全（项目成员 ⊆ 团队成员）
  const { data: projectMembers = [] } = useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => projectApi.listMembers(projectId),
    // 仅新建需求群时才需要候选成员，避免所有项目页首屏多拉一份完整成员列表。
    enabled: Boolean(projectId && createOpen),
  })
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teams', project?.teamId, 'members'],
    queryFn: () => teamApi.listMembers(project?.teamId ?? ''),
    // 项目成员缺少 displayName 时才作为弹窗选项的补全来源。
    enabled: Boolean(project?.teamId && createOpen),
  })
  const teamMemberNameById = new Map(teamMembers.map((tm) => [tm.userId, tm.displayName]))
  const resolveProjectMemberName = (userId: string): string =>
    projectMembers.find((m) => m.userId === userId)?.displayName ||
    teamMemberNameById.get(userId) ||
    userId

  // 需求群拆分：归档 / 活跃；搜索按标题过滤；活跃群置顶优先 + 最近活跃排序
  const requirementGroups = groups.filter((g) => g.type === 'REQUIREMENT')
  const activeRequirement = requirementGroups.filter((g) => !g.isArchived)
  const archivedGroups = requirementGroups.filter((g) => g.isArchived)
  const keyword = groupSearch.trim().toLowerCase()
  const matches = (g: Group) => !keyword || g.title.toLowerCase().includes(keyword)
  const pinnedGroups = activeRequirement.filter((g) => pinnedIds.includes(g.id) && matches(g))
  const normalGroups = activeRequirement
    .filter((g) => !pinnedIds.includes(g.id) && matches(g))
    .sort((a, b) => (b.latestActivityAt ?? '').localeCompare(a.latestActivityAt ?? ''))
  const archivedMatches = archivedGroups.filter(matches)

  // 记录项目及所属团队上下文，供顶部「团队首页」按钮回到正确团队；
  // 同时点亮 Banner 的「项目详情」页签（进入项目详情即出现并选中）
  useEffect(() => {
    if (!projectId) return
    if (project?.teamId) setCurrentTeam(project.teamId)
    setCurrentProject(projectId)
    openProjectDetailNav(projectId)
  }, [projectId, project?.teamId, setCurrentTeam, setCurrentProject, openProjectDetailNav])

  // 创建需求群
  const createGroup = useMutation({
    mutationFn: (payload: CreateGroupPayload) => groupApi.create(projectId, payload),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['groups', projectId] })
      setCreateOpen(false)
      form.resetFields()
      navigate(PATHS.projectReqChat(projectId, group.id), { replace: true })
    },
  })

  // 后端群列表返回 pinned（当前用户置顶偏好）时，以后端为准覆盖本地（跨设备同步）；
  // 后端未实现/未返回该字段时保持 localStorage 兜底（§群聊置顶后端接口需求）。
  useEffect(() => {
    const hasBackendPinnedField = groups.some(
      (g) => typeof g.pinned === 'boolean' || typeof g.isPinned === 'boolean',
    )
    if (!hasBackendPinnedField) return
    const backendPinned = groups
      .filter((g) => g.pinned === true || g.isPinned === true)
      .map((g) => g.id)
    setPinnedIds((prev) => {
      if (prev.length === backendPinned.length && prev.every((id) => backendPinned.includes(id))) {
        return prev
      }
      try {
        localStorage.setItem(pinnedGroupsKey(projectId), JSON.stringify(backendPinned))
      } catch {
        // localStorage 不可用时仅本次会话生效
      }
      return backendPinned
    })
  }, [groups, projectId])

  /** 置顶/取消置顶需求群：乐观更新本地 + 后端持久化（失败回滚，localStorage 兜底） */
  function togglePin(groupId: string) {
    const prev = pinnedIds
    setPinnedIds((current) => {
      const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
      try {
        localStorage.setItem(pinnedGroupsKey(projectId), JSON.stringify(next))
      } catch {
        // localStorage 不可用时仅本次会话生效
      }
      return next
    })
    const willPin = !prev.includes(groupId)
    groupApi.setGroupPinned(projectId, groupId, willPin).catch(() => {
      // 接口未实现/失败：回滚本地，仍以 localStorage 兜底展示
      setPinnedIds(prev)
      try {
        localStorage.setItem(pinnedGroupsKey(projectId), JSON.stringify(prev))
      } catch {
        // ignore
      }
    })
  }

  // 单个群列表项：置顶标记 + 标题 + 未读数 + 最新消息摘要
  function renderBranch(g: Group, pinned = false) {
    const isMain = g.type === 'PROJECT_MAIN'
    return (
      <li key={g.id} className="pd-nav__branch-item">
        <NavLink
          to={PATHS.projectReqChat(projectId, g.id)}
          className={() =>
              `pd-nav__branch${onReqChat && effectiveGroupId === g.id ? ' is-active' : ''}`
          }
        >
          <span className="pd-nav__branch-hash">#</span>
          <span className="pd-nav__branch-text">
            <span className="pd-nav__branch-title-row">
              {pinned && <PushpinOutlined className="pd-nav__branch-pin" />}
              <span className="pd-nav__branch-title">{g.title}</span>
              {isMain && <span className="pd-nav__branch-main-tag">总群</span>}
              {/* 未读 @ 角标：该群有 @ 我的未读消息（后端 mentionedUnread > 0 时显示）。
                  正在查看的群不显示（人在群里，无需侧栏红字提示；离开时 markRead 会清掉） */}
              {(!onReqChat || effectiveGroupId !== g.id) &&
              typeof g.mentionedUnread === 'number' &&
              g.mentionedUnread > 0 ? (
                <span
                  style={{
                    padding: '0 7px',
                    borderRadius: 999,
                    background: 'rgba(239, 68, 68, 0.16)',
                    color: '#f87171',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  有人@你
                </span>
              ) : null}
              {/* 正在查看的群不显示未读红点（游标只在进群时推进，群内新消息红点由前端视觉隐藏） */}
              {!onReqChat || effectiveGroupId !== g.id ? (
                g.unreadCount ? <Badge count={g.unreadCount} overflowCount={99} size="small" /> : null
              ) : null}
            </span>
            {g.latestMessage ? (
              <span className="pd-nav__branch-summary">
                {g.latestMessage.senderName ? `${g.latestMessage.senderName}: ` : ''}
                {latestMessageText(g.latestMessage)}
              </span>
            ) : (
              <span className="pd-nav__branch-ref">
                {isMain ? '项目总群' : '需求群'}
              </span>
            )}
          </span>
        </NavLink>
        {/* 置顶按钮：仅需求群（主群恒在列表最前，无需置顶）；悬停显示 */}
        {!isMain && (
          <button
            type="button"
            className={`pd-nav__branch-pin-btn${pinned ? ' is-pinned' : ''}`}
            title={pinned ? '取消置顶' : '置顶群聊'}
            aria-label={pinned ? '取消置顶' : '置顶群聊'}
            onClick={() => togglePin(g.id)}
          >
            <PushpinOutlined />
          </button>
        )}
      </li>
    )
  }

  // 群聊视图不做响应式压缩：窗口缩小时主内容列保持最小可读宽度（720px），
  // 超出部分由外层 Content 的 overflow:auto 出横向滚动条，而不是挤压布局。
  const mainColumn = onReqChat ? 'minmax(720px, 1fr)' : 'minmax(0, 1fr)'

  return (
    <div
      className="pd"
      style={{
        gridTemplateColumns: `${sidebarWidth}px 6px ${mainColumn}`,
      }}
    >
      <aside className="pd-nav" aria-label="项目导航">
        {/* 当前项目名 —— 位于导航列表上方 */}
        <div className="pd-nav__project">
          <span className="pd-nav__project-label">当前项目</span>
          <strong className="pd-nav__project-name" title={projectName}>
            {projectName}
          </strong>
        </div>

        <nav className="pd-nav__menu">
          {PROJECT_NAV.map((item) => (
            <NavLink
              key={item.path}
              to={item.to(projectId)}
              className={({ isActive }) => {
                // 需求群聊：任意 /req-chat/* 都高亮该导航项
                const active =
                  // item.path === 'req-chat'
                  //   ? onReqChat
                     item.path === 'code'
                      ? onCode
                      : isActive
                return `pd-nav__item${active ? ' is-active' : ''}`
              }}
            >
              <NavIcon id={item.path} />
              <span className="pd-nav__label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* —— 群聊列表 —— */}
        <div className="pd-nav__branches">
          <div className="pd-nav__branches-head">
            <span>群聊</span>
          </div>
          <Input
            className="pd-nav__search"
            placeholder="搜索群聊"
            prefix={<SearchOutlined />}
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            allowClear
            size="small"
          />
          <ul className="pd-nav__branch-list">
            {groupsLoading ? (
              <li className="pd-nav__empty">正在加载群聊…</li>
            ) : (
              <>
                {mainGroup && matches(mainGroup) && renderBranch(mainGroup)}
                {pinnedGroups.map((g) => renderBranch(g, true))}
                {normalGroups.map((g) => renderBranch(g))}
                {archivedMatches.length > 0 && (
                  <li className="pd-nav__branches-subhead">已归档</li>
                )}
                {archivedMatches.map((g) => renderBranch(g))}
                {activeRequirement.length === 0 && !keyword && (
                  <li className="pd-nav__empty">暂无需求群，点击下方新建</li>
                )}
              </>
            )}
          </ul>

          <button
            type="button"
            className="pd-nav__new-branch-chat"
            onClick={() => setCreateOpen(true)}
          >
            + 新建需求群
          </button>
        </div>
      </aside>

      {/* 拖拽手柄：调整左侧导航栏宽度 */}
      <div
        className="pd-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整侧栏宽度"
        onMouseDown={startResize}
      />

      <div className="pd-main">
        {onReqChat && !groupId && mainGroup ? (
          <Suspense fallback={<div aria-busy="true" aria-label="正在加载群聊" />}><ChatPanel key={mainGroup.id} projectId={projectId} groupId={mainGroup.id} /></Suspense>
        ) : (
          <Outlet />
        )}
      </div>

      {/* 新建需求群弹窗 */}
      <Modal
        title="新建需求群"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={createGroup.isPending}
        okText="创建"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createGroup.mutate(values)}
          initialValues={{ type: 'REQUIREMENT' }}
        >
          <Form.Item
            name="title"
            label="需求群名称"
            rules={[{ required: true, message: '请输入需求群名称' }]}
          >
            <Input placeholder="例如：登录功能" maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea
              placeholder="简要说明这个需求群要讨论什么"
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={200}
            />
          </Form.Item>
          <Form.Item name="memberIds" label="初始成员">
            <Select
              mode="multiple"
              allowClear
              placeholder="选择群成员（不选则群内只有创建者）"
              optionFilterProp="label"
              options={projectMembers.map((m) => ({ value: m.userId, label: resolveProjectMemberName(m.userId) }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function NavIcon({ id }: { id: string }) {
  const paths: Record<string, string> = {
    overview: 'M4 10.5L12 4l8 6.5V20H4V10.5z',
    'req-chat':
      'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4.2A2.5 2.5 0 0 1 5 12.5v-6z',
    tasks: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    // 交付中心：包裹图标（与概览的房子区分）
    diffs: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
    agents:
      'M9 8a3 3 0 1 0 0-0.01M17 9a2.5 2.5 0 1 0 0-0.01M3.5 19c.8-3 2.8-4.5 5.5-4.5S14 16 14.5 19M14.5 14.5c1.6-.4 3.2.2 4.5 1.8',
    skills: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z',
    memory: 'M6 5h12v14H6V5zm3 4h6M9 12h6M9 15h4',
    code: 'M9 7L4 12l5 5M15 7l5 5-5 5',
    testset: 'M9 4h6l1 3h4v13H4V7h4l1-3zm3 6v6m0 0l-2-2m2 2l2-2',
    members:
      'M9 8a3 3 0 1 0 0-.01M16.5 9a2.2 2.2 0 1 0 0-.01M4 19c.8-3 2.6-4.5 5-4.5s4.2 1.5 5 4.5M14 14.5c1.4-.3 2.8.3 4 1.7',
    settings:
      'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6',
  }

  return (
    <svg className="pd-nav__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={paths[id] ?? paths.overview}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
