import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Button, Avatar, Space, Typography } from 'antd'
import {
  HomeOutlined,
  MessageOutlined,
  ProjectOutlined,
} from '@ant-design/icons'
import { useState, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { usePersonalCenter } from '@/context/PersonalCenterContext'
import { useAppUiStore, useCurrentTeamId, useCurrentTeamRole } from '@/store/appUiStore'
import { NotificationCenter } from './NotificationCenter'
import { PATHS } from '@/routes/paths'

const { Header } = Layout
const { Text } = Typography

type BannerTab = {
  key: 'teams' | 'chat' | 'project'
  label: string
  icon: ReactNode
}

/**
 * 顶部 Banner（主应用全局）—— Ant Design Layout.Header
 *
 * 「项目详情」页签：仅在点击「进入项目详情」后动态出现；
 * 与「团队首页」「项目群聊」并排完整显示文字（不用 Menu 溢出「…」）。
 * 点「团队首页」时清除项目详情页签；点「项目群聊」保留页签（方便再切回）。
 * 颜色说明：Banner 固定暗色背景，所有文字和图标使用亮色，
 * 不跟随 antd light theme token。
 */
export function Banner() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { openPersonalCenter } = usePersonalCenter()
  const projectDetailNav = useAppUiStore((s) => s.projectDetailNav)
  const clearProjectDetailNav = useAppUiStore((s) => s.clearProjectDetailNav)
  const currentTeamId = useCurrentTeamId()
  const currentTeamRole = useCurrentTeamRole()
  const name = user?.displayName ?? '用户'
  const avatarChar = user?.avatarChar ?? name.slice(0, 1)
  const [hoverTab, setHoverTab] = useState<BannerTab['key'] | null>(null)

  const onProjectDetailRoute = location.pathname.startsWith('/app/projects/')

  let selectedKey: BannerTab['key'] | '' = ''
  if (projectDetailNav && onProjectDetailRoute) {
    selectedKey = 'project'
  } else if (location.pathname.startsWith(PATHS.CHAT)) {
    selectedKey = 'chat'
  } else if (
    location.pathname.startsWith(PATHS.MY_TEAMS) ||
    location.pathname.startsWith('/app/teams') ||
    location.pathname.startsWith(PATHS.GITHUB_INTEGRATION)
  ) {
    selectedKey = 'teams'
  }

  const tabs: BannerTab[] = [
    { key: 'teams', label: '团队首页', icon: <HomeOutlined /> },
    { key: 'chat', label: '项目群聊', icon: <MessageOutlined /> },
  ]
  if (projectDetailNav) {
    tabs.push({ key: 'project', label: '项目详情', icon: <ProjectOutlined /> })
  }

  function goTab(key: BannerTab['key']) {
    if (key === 'teams') {
      clearProjectDetailNav()
      // 「团队首页」：若已进入某个团队则回到该团队详情，否则回到团队列表
      navigate(
        currentTeamId
          ? PATHS.teamDetail(currentTeamId, currentTeamRole === 'TEAM_OWNER')
          : PATHS.MY_TEAMS,
      )
      return
    }
    if (key === 'chat') {
      // 携带当前团队进入项目群聊：刷新后仍停留在该团队（v2.0.6）
      navigate(currentTeamId ? PATHS.chat(currentTeamId) : PATHS.CHAT)
      return
    }
    if (key === 'project' && projectDetailNav) {
      navigate(PATHS.projectDetail(projectDetailNav.projectId))
    }
  }

  const LIGHT = 'var(--qg-text-on-dark)'          // #f3f4f6
  const LIGHT_MUTED = 'var(--qg-text-on-dark-secondary)' // #9aa3b5

  return (
    <Header
      className="qg-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: 56,
        lineHeight: '56px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, minWidth: 0 }}>
        <NavLink
          to={PATHS.MY_TEAMS}
          aria-label="Qgents 首页"
          onClick={() => clearProjectDetailNav()}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        >
          <Avatar
            size={28}
            style={{
              background: '#fff',
              color: 'var(--qg-navy)',
              fontWeight: 700,
              boxShadow: '0 0 0 2px var(--qg-mint)',
            }}
          >
            Q
          </Avatar>
          <Text strong className="qg-banner__brand-text" style={{ color: 'var(--qg-mint)', fontSize: 18 }}>
            gents
          </Text>
        </NavLink>

        <nav
          aria-label="主导航"
          style={{ display: 'flex', alignItems: 'stretch', gap: 4, height: 56, flex: 1, minWidth: 0, overflowX: 'auto' }}
        >
          {tabs.map((tab) => {
            const active = selectedKey === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => goTab(tab.key)}
                onMouseEnter={() => setHoverTab(tab.key)}
                onMouseLeave={() => setHoverTab(null)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: '100%',
                  padding: '0 14px',
                  border: 'none',
                  borderBottom: active
                    ? '2px solid var(--qg-mint)'
                    : '2px solid transparent',
                  background: !active && hoverTab === tab.key ? 'rgba(255,255,255,0.06)' : 'transparent',
                  color: active ? 'var(--qg-mint)' : hoverTab === tab.key ? LIGHT : LIGHT_MUTED,
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      <Space size={4} align="center" style={{ flexShrink: 0 }}>
        <NotificationCenter />

        <Button
          type="text"
          onClick={openPersonalCenter}
          aria-label="打开个人中心"
          style={{ color: LIGHT }}
        >
          <Space size={8}>
            <Text className="qg-banner__user-name" style={{ color: LIGHT }}>{name}</Text>
            <Avatar src={user?.avatarUrl ?? undefined} style={{ background: '#f97316' }}>
              {avatarChar}
            </Avatar>
          </Space>
        </Button>
      </Space>
    </Header>
  )
}
