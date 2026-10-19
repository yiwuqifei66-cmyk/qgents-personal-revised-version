import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Drawer, Badge, Button, Typography, Space, Empty, theme } from 'antd'
import {
  BellOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  InboxOutlined,
  BranchesOutlined,
  UserAddOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationApi } from '@/api'
import { useNotificationEvents } from '@/realtime/useNotificationEvents'
import { useRealtimeConnectionStatus } from '@/realtime/realtimeClient'
import { PATHS } from '@/routes/paths'
import type { Notification, NotificationKind } from '@/types'

const { Text } = Typography

/** 每种通知类型的图标与配色 */
const KIND_META: Record<NotificationKind, { icon: ReactNode; color: string }> = {
  TASK_COMPLETED: { icon: <CheckCircleOutlined />, color: '#22c55e' },
  TASK_FAILED: { icon: <CloseCircleOutlined />, color: '#ef4444' },
  TASK_AWAITING_CONFIRMATION: { icon: <InboxOutlined />, color: '#3b82f6' },
  AGENT_INPUT_REQUIRED: { icon: <QuestionCircleOutlined />, color: '#f59e0b' },
  DELIVERABLE_PENDING: { icon: <InboxOutlined />, color: '#3b82f6' },
  MR_PENDING: { icon: <BranchesOutlined />, color: '#a855f7' },
  INVITED: { icon: <UserAddOutlined />, color: '#3b82f6' },
  MESSAGE_MENTION: { icon: <MessageOutlined />, color: '#f59e0b' },
}

/** 后端可能下发未在枚举中的 kind，兜底展示，避免 meta 为 undefined 导致崩溃 */
const FALLBACK_META: { icon: ReactNode; color: string } = {
  icon: <BellOutlined />,
  color: '#94a3b8',
}

/** 通知 → 跳转目标路由（无对应资源时兜底到项目详情） */
export function notificationTargetPath(n: Notification): string | null {
  if (n.kind === 'INVITED') return PATHS.JOIN_TEAM
  const projectId = n.projectId
  if (!projectId) return null
  switch (n.kind) {
    case 'MESSAGE_MENTION':
      // 群聊 @ 提及：跳转到来源需求群
      return n.groupId ? PATHS.projectReqChat(projectId, n.groupId) : PATHS.projectTasks(projectId)
    case 'TASK_COMPLETED':
    case 'TASK_FAILED':
    case 'TASK_AWAITING_CONFIRMATION':
    case 'AGENT_INPUT_REQUIRED':
      return n.resourceId ? PATHS.projectTaskDetail(projectId, n.resourceId) : PATHS.projectTasks(projectId)
    case 'MR_PENDING':
      return n.resourceId ? PATHS.projectCodeMr(projectId, n.resourceId) : PATHS.projectCode(projectId)
    case 'DELIVERABLE_PENDING':
      // §7.1：diff.created 触发 DELIVERABLE_PENDING，resourceId = diffId → 跳交付中心 Diff 详情
      return n.resourceId ? PATHS.projectDiff(projectId, n.resourceId) : PATHS.projectDiffs(projectId)
    default:
      return PATHS.projectDetail(projectId)
  }
}

/** 相对时间（演示用） */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

/**
 * 通知中心 —— 顶部铃铛 + 右侧抽屉
 * 本轮由前端 Mock 实现（接口文档 §1：持久通知中心不在本轮范围）
 */
export function NotificationCenter() {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const realtimeStatus = useRealtimeConnectionStatus()
  // WebSocket 连通时已覆盖通知事件；仅断开时保留 SSE 兜底，避免重复长连接占满 HTTP/1.1 槽位。
  useNotificationEvents(realtimeStatus !== 'connected')

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationApi.list(),
  })
  const unreadCount = notifications.filter((n) => !n.isRead).length

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      const previous = queryClient.getQueryData<Notification[]>(['notifications'])
      queryClient.setQueryData<Notification[]>(['notifications'], (current = []) =>
        current.map((notification) =>
          notification.id === id ? { ...notification, isRead: true } : notification,
        ),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['notifications'], context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      const previous = queryClient.getQueryData<Notification[]>(['notifications'])
      queryClient.setQueryData<Notification[]>(['notifications'], (current = []) =>
        current.map((notification) => ({ ...notification, isRead: true })),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['notifications'], context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  function handleItemClick(n: Notification) {
    if (!n.isRead) markRead.mutate(n.id)
    setOpen(false)
    const to = notificationTargetPath(n)
    if (!to) return
    if (n.kind === 'MESSAGE_MENTION') {
      // 带被 @ 的消息 id 跳转：ChatPanel 收到后自动滚动高亮到该消息（无 id 时兜底跳到最上面一条被 @ 消息）
      navigate(to, { state: { mentionMessageId: n.resourceId } })
    } else {
      navigate(to)
    }
  }

  return (
    <>
      <Badge count={unreadCount} size="small">
        <Button
          type="text"
          icon={<BellOutlined />}
          aria-label="通知"
          onClick={() => setOpen(true)}
          style={{ color: 'var(--qg-text-on-dark)' }}
        />
      </Badge>

      <Drawer
        title="通知中心"
        placement="right"
        size={380}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          notifications.length > 0 && (
            <Button
              type="text"
              size="small"
              icon={<CheckOutlined />}
              disabled={unreadCount === 0}
              loading={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              全部已读
            </Button>
          )
        }
        styles={{ body: { padding: 0 } }}
      >
        {notifications.length === 0 ? (
          <Empty description="暂无通知" style={{ marginTop: 64 }} />
        ) : (
          notifications.map((n) => {
            const meta = KIND_META[n.kind] ?? FALLBACK_META
            return (
              <div
                key={n.id}
                onClick={() => handleItemClick(n)}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: n.isRead ? 'transparent' : token.colorPrimaryBg,
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <span style={{ color: meta.color, fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
                  {meta.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={6} align="center">
                    {!n.isRead && <Badge status="processing" />}
                    <Text strong={!n.isRead}>{n.title}</Text>
                  </Space>
                  {n.description && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        {n.description}
                      </Text>
                    </div>
                  )}
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatRelativeTime(n.createdAt)}
                    </Text>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </Drawer>
    </>
  )
}
