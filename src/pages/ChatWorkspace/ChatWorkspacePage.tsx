import { useEffect, useMemo, useState } from 'react'
import { Layout, Input, List, Avatar, Typography, Space, theme, Empty, Badge, Spin } from 'antd'
import { SearchOutlined, TeamOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { groupApi, projectApi, teamApi } from '@/api'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { latestMessageText } from '@/utils/messageSummary'
import { useAppUiStore, useCurrentTeamId } from '@/store/appUiStore'
import type { Group } from '@/types'

const { Text } = Typography

interface MainGroupSession {
  projectId: string
  groupId: string
  groupTitle: string
  latestMessage?: Group['latestMessage']
  latestActivityAt?: string
  unreadCount?: number
  mentionedUnread?: number
}

/**
 * 项目群聊工作台 —— 左边聚合「**当前团队**的所有项目主群」，右边内嵌聊天面板。
 * 数据：GET /chat/main-groups 主群聚合（含全部可见项目）+ GET /teams/{id}/projects 按团队过滤；
 * 数据加载完成后自动选中第一个主群，避免刚进入时的空态闪烁。
 *
 * 团队上下文挂在路由层（/app/chat?teamId=xxx）：刷新页面后仍停留在上次团队，
 * 不再退化为「第一个团队」导致串到别的团队的项目主群（v2.0.6）。
 */
export default function ChatWorkspacePage() {
  const { token } = theme.useToken()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeTeamId = searchParams.get('teamId')
  const currentTeamId = useCurrentTeamId()
  const setCurrentTeam = useAppUiStore((s) => s.setCurrentTeam)
  const [selected, setSelected] = useState<MainGroupSession | null>(null)
  const [keyword, setKeyword] = useState('')

  // 当前团队兜底：从未进入团队/项目页时取第一个团队
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', 'mine'],
    queryFn: teamApi.listMine,
  })
  const effectiveTeamId = routeTeamId ?? currentTeamId ?? teams[0]?.id ?? ''

  // 团队确定后写入全局上下文 + 同步回 URL（刷新不丢团队；replace 不产生历史记录）
  useEffect(() => {
    if (!effectiveTeamId) return
    if (currentTeamId !== effectiveTeamId) setCurrentTeam(effectiveTeamId)
    if (searchParams.get('teamId') !== effectiveTeamId) {
      setSearchParams({ teamId: effectiveTeamId }, { replace: true })
    }
  }, [effectiveTeamId, currentTeamId, setCurrentTeam, searchParams, setSearchParams])

  // 当前团队的项目 id 集合：主群聚合按团队过滤（聚合接口不返回 teamId）
  const { data: teamProjects = [], isLoading: teamProjectsLoading } = useQuery({
    queryKey: ['teams', effectiveTeamId, 'projects'],
    queryFn: () => projectApi.listByTeam(effectiveTeamId),
    enabled: !!effectiveTeamId,
  })
  const teamProjectIds = useMemo(() => new Set(teamProjects.map((p) => p.id)), [teamProjects])
  // 项目头像映射：主群会话头像 = 项目头像（v2.0.6）
  const projectAvatarById = useMemo(
    () => new Map(teamProjects.map((p) => [p.id, p.avatarUrl]).filter(([, url]) => !!url) as [string, string][]),
    [teamProjects],
  )

  // 主群聚合：按最近活跃倒序；含 latestMessage / memberCount / unreadCount / mentionedUnread
  const { data: mainGroups = [], isLoading: mainGroupsLoading } = useQuery({
    queryKey: ['chat', 'main-groups'],
    queryFn: groupApi.listMainGroups,
  })

  const loading = mainGroupsLoading || teamProjectsLoading || teamsLoading

  const sessions = useMemo<MainGroupSession[]>(() => {
    if (loading) return []
    return mainGroups
      .filter((g) => g.type === 'PROJECT_MAIN' && teamProjectIds.has(g.projectId))
      .map((g) => ({
        projectId: g.projectId,
        groupId: g.id,
        groupTitle: g.title,
        latestMessage: g.latestMessage,
        latestActivityAt: g.latestActivityAt,
        unreadCount: g.unreadCount,
        mentionedUnread: g.mentionedUnread,
      }))
  }, [mainGroups, loading, teamProjectIds])

  // 数据就绪后自动选中第一个主群：修复刚进入时空态闪烁；
  // 切团队后旧选中失效（不在新 sessions 中）时自动切回第一个
  useEffect(() => {
    if (sessions.length === 0) return
    setSelected((prev) => {
      if (prev && sessions.some((s) => s.groupId === prev.groupId)) return prev
      return sessions[0]
    })
  }, [sessions])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.projectId.toLowerCase().includes(q) ||
        s.groupTitle.toLowerCase().includes(q),
    )
  }, [sessions, keyword])

  return (
    <Layout style={{ height: 'calc(100vh - 56px)', background: token.colorBgBase }}>
      <Layout.Sider
        width={280}
        theme="dark"
        style={{
          borderRight: `1px solid ${token.colorBorder}`,
          background: token.colorBgContainer,
          overflow: 'auto',
        }}
      >
        <div style={{ padding: 12 }}>
          <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索项目群聊"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              allowClear
            />
          </Space.Compact>

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            项目主群
          </Text>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <Spin size="small" />
            </div>
          ) : filtered.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目群聊" />
          ) : (
            <List
              dataSource={filtered}
              split={false}
              renderItem={(s) => (
                <List.Item
                  onClick={() => setSelected(s)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    background: selected?.groupId === s.groupId ? 'rgba(34, 197, 94, 0.12)' : undefined,
                    borderRadius: 8,
                    border: 'none',
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        src={projectAvatarById.get(s.projectId)}
                        style={{ background: '#3b82f6', flexShrink: 0 }}
                        icon={<TeamOutlined />}
                        size={36}
                      />
                    }
                    title={
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Text strong ellipsis style={{ maxWidth: 150 }}>
                            {s.groupTitle}
                          </Text>
                          <Space size={4}>
                            {/* 正在查看的群不显示「有人@你」（人在群里，无需侧栏提示；离开时 markRead 清掉） */}
                            {selected?.groupId !== s.groupId &&
                            typeof s.mentionedUnread === 'number' &&
                            s.mentionedUnread > 0 ? (
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
                            <Badge count={selected?.groupId === s.groupId ? 0 : s.unreadCount} overflowCount={99} size="small" />
                          </Space>
                        </Space>
                      </Space>
                    }
                    description={
                      <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                        {s.latestMessage
                          ? `${s.latestMessage.senderName ? `${s.latestMessage.senderName}: ` : ''}${latestMessageText(s.latestMessage)}`
                          : s.groupTitle}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      </Layout.Sider>

      {loading ? (
        <Layout style={{ background: token.colorBgBase }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spin />
          </div>
        </Layout>
      ) : selected ? (
        <ChatPanel key={selected.groupId} projectId={selected.projectId} groupId={selected.groupId} />
      ) : (
        <Layout style={{ background: token.colorBgBase }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Empty description="暂无项目群聊" />
          </div>
        </Layout>
      )}
    </Layout>
  )
}
