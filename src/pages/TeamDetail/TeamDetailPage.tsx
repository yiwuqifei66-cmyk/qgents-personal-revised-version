import { useEffect, useState } from 'react'
import {
  ApartmentOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Button, Space, Spin } from 'antd'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PATHS } from '@/routes/paths'
import { projectApi, teamApi } from '@/api'
import { EmptyState } from '@/components/EmptyState'
import { CreateProjectModal } from '@/components/CreateProjectModal'
import { useAppUiStore } from '@/store/appUiStore'
import { useTeamEvents } from '@/realtime/useTeamEvents'
import type { Project, TeamMember } from '@/types'
import './TeamDetailPage.css'

type TeamDetailView = 'projects' | 'members'

const projectAccentColors = ['#0d9b8a', '#f59e0b', '#6d5dfc', '#2563eb']

function getProjectInitial(projectName: string) {
  return projectName.trim().slice(0, 2).toUpperCase() || 'Q'
}

function getProjectAccent(index: number) {
  return projectAccentColors[index % projectAccentColors.length]
}

function getRoleLabel(role?: string) {
  if (role === 'TEAM_OWNER') return 'Owner'
  if (role === 'PROJECT_ADMIN') return 'Maintainer'
  return 'Developer'
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

function MemberPreview({ member }: { member: TeamMember }) {
  // 后端成员接口暂未返回 displayName/email，缺失时用 userId 兜底，避免渲染崩溃
  const displayName = member.displayName || member.userId
  const email = member.email || '—'
  return (
    <li className="team-detail__member-row">
      {member.avatarUrl ? (
        <img className="team-detail__member-avatar team-detail__member-avatar--img" src={member.avatarUrl} alt={displayName} aria-hidden />
      ) : (
        <span className="team-detail__member-avatar" aria-hidden>
          {displayName.slice(0, 1)}
        </span>
      )}
      <div className="team-detail__member-copy">
        <strong>{displayName}</strong>
        <span>{email}</span>
      </div>
      <span className="team-detail__member-role">{getRoleLabel(member.role)}</span>
    </li>
  )
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
  const repositoryCount = project.repositoryCount ?? 0
  const accent = getProjectAccent(index)

  return (
    <article className="team-detail__project-card">
      {project.avatarUrl ? (
        <img className="team-detail__project-icon team-detail__project-icon--img" src={project.avatarUrl} alt={project.name} />
      ) : (
        <div className="team-detail__project-icon" style={{ background: accent }}>
          {getProjectInitial(project.name)}
        </div>
      )}
      <div className="team-detail__project-body">
        <div className="team-detail__project-heading">
          <h3>{project.name}</h3>
          <span className="team-detail__project-role">{getRoleLabel(project.role)}</span>
        </div>
        <p>{project.description || '暂无项目简介'}</p>
        <div className="team-detail__project-meta">
          {project.memberCount != null && (
            <span>
              <TeamOutlined /> {project.memberCount} 名成员
            </span>
          )}
          <span>
            <BranchesOutlined /> {repositoryCount} 个仓库
          </span>
          {project.status && (
            <span>
              <ClockCircleOutlined /> {project.status === 'ARCHIVED' ? '已归档' : '进行中'}
            </span>
          )}
        </div>
      </div>
      <Link to={PATHS.projectDetail(project.id)} className="team-detail__enter-project">
        进入项目
      </Link>
    </article>
  )
}

export default function TeamDetailPage() {
  const { teamId = '' } = useParams<{ teamId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  // 团队设置是团队详情的路由层子视图（/teams/:teamId/settings）：命中时渲染 Outlet，不跳转新页面
  const onSettings = location.pathname.endsWith('/settings')
  const [activeView, setActiveView] = useState<TeamDetailView>('projects')
  const [createOpen, setCreateOpen] = useState(false)
  const setCurrentTeam = useAppUiStore((state) => state.setCurrentTeam)

  // 从「团队设置」切回首页/通讯录：设置是路由子视图，必须先把 URL 切回团队详情，否则 main 仍渲染设置页
  function goView(view: TeamDetailView) {
    setActiveView(view)
    if (onSettings) navigate(PATHS.teamDetail(teamId))
  }

  // 团队级 SSE：被拉进项目 / 成员变更 / 动态产生时实时刷新
  useTeamEvents(teamId || undefined)

  // 进入团队详情即记录当前团队，供顶部「团队首页」按钮回到此团队
  useEffect(() => {
    if (teamId) setCurrentTeam(teamId)
  }, [teamId, setCurrentTeam])

  const {
    data: team,
    isLoading: teamLoading,
    isError: teamError,
  } = useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => teamApi.getById(teamId),
    enabled: !!teamId,
  })
  const isOwner = team?.role === 'TEAM_OWNER'

  // 团队资料加载后，把角色同步进 store，供 Banner「团队首页」跳转时带 as=owner
  useEffect(() => {
    if (team) setCurrentTeam(team.id, team.role)
  }, [team, setCurrentTeam])

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['teams', teamId, 'members'],
    queryFn: () => teamApi.listMembers(teamId),
    enabled: !!teamId,
  })

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['teams', teamId, 'projects'],
    queryFn: () => projectApi.listByTeam(teamId),
    enabled: !!teamId,
  })

  // 团队最近动态（分页响应取 data；由 useTeamEvents 的 activity.created 事件驱动刷新）
  const { data: activitiesData } = useQuery({
    queryKey: ['teams', teamId, 'activities'],
    queryFn: () => teamApi.activities(teamId),
    enabled: !!teamId,
  })
  const activities = activitiesData?.data ?? []

  const isLoading = teamLoading || membersLoading || projectsLoading
  const ownerCount = members.filter((member) => member.role === 'TEAM_OWNER').length

  if (isLoading) {
    return (
      <div className="team-detail team-detail--centered">
        <Spin size="large" />
      </div>
    )
  }

  if (teamError) {
    return (
      <div className="team-detail team-detail--centered">
        <EmptyState icon="🔎" title="团队未找到" description="该团队不存在，或你暂无访问权限" />
      </div>
    )
  }
  if (!team) {
    // 查不到该团队（接口成功但数据为空，或已被移除权限）→ 回欢迎页
    return <Navigate to={PATHS.WELCOME} replace />
  }

  return (
    <div className="team-detail">
      <aside className="team-detail__sidebar" aria-label="团队导航">
        <div className="team-detail__team-card">
          {team.avatarUrl ? (
            <img
              className="team-detail__team-logo team-detail__team-logo--img"
              src={team.avatarUrl}
              alt={`${team.name} 的团队头像`}
              aria-hidden
            />
          ) : (
            <div className="team-detail__team-logo">{team.name.slice(0, 1)}</div>
          )}
          <div>
            <h2>{team.name}</h2>
            <p>{team.description || '团队项目协作空间'}</p>
          </div>
          <span className="team-detail__team-role">{getRoleLabel(team.role)}</span>
        </div>

        <nav className="team-detail__nav">
          {/* 高亮逻辑：设置是路由子视图，此时首页/通讯录不参与高亮，只有「团队设置」高亮 */}
          <button
            type="button"
            className={`team-detail__nav-item ${!onSettings && activeView === 'projects' ? 'team-detail__nav-item--active' : ''}`}
            onClick={() => goView('projects')}
          >
            <ApartmentOutlined />
            团队首页
          </button>
          <button
            type="button"
            className={`team-detail__nav-item ${!onSettings && activeView === 'members' ? 'team-detail__nav-item--active' : ''}`}
            onClick={() => goView('members')}
          >
            <TeamOutlined />
            团队通讯录
          </button>
          {/* 团队设置：路由层切换（/teams/:teamId/settings），在详情布局内渲染，不跳转新页面 */}
          <NavLink
            to={PATHS.teamSettings(teamId)}
            className={({ isActive }) =>
              `team-detail__nav-item${isActive ? ' team-detail__nav-item--active' : ''}`
            }
          >
            <SettingOutlined />
            团队设置
          </NavLink>
        </nav>
      </aside>

      <main className="team-detail__main">
        {onSettings ? (
          /* 团队设置：路由层子视图（TeamSettingsPage），复用本页侧栏布局 */
          <Outlet />
        ) : (
          <>
            <section className="team-detail__hero">
          <div>
            <Link to={PATHS.MY_TEAMS} className="team-detail__back">
              返回我的团队
            </Link>
            <h1>{team.name}</h1>
            <p>从个人中心切换团队或项目，进入项目总群继续协作。</p>
          </div>
          <Space>
            {isOwner && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateOpen(true)}
              >
                创建项目
              </Button>
            )}
          </Space>
        </section>

        {activeView === 'projects' ? (
          <section className="team-detail__section">
            <div className="team-detail__section-heading">
              <h2>项目</h2>
              <span>{projects.length} 个项目</span>
            </div>

            {projects.length === 0 ? (
              <EmptyState
                icon="📁"
                title="暂无项目"
                description="创建第一个项目后，团队成员就可以进入项目总群开始协作"
              />
            ) : (
              <div className="team-detail__project-list">
                {projects.map((project, index) => (
                  <ProjectCard key={project.id} project={project} index={index} />
                ))}
              </div>
            )}

            <div className="team-detail__notice">
              <CheckCircleFilled />
              <div>
                <strong>项目权限相互隔离：同一成员在不同项目可拥有不同角色。</strong>
                <span>项目的数据、配置、任务、分支组、成员权限等均相互独立，互不影响。</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="team-detail__section">
            <div className="team-detail__section-heading">
              <h2>团队通讯录</h2>
              <span>
                {members.length} 人 · {ownerCount} 位 Owner
              </span>
            </div>

            <div className="team-detail__directory">
              {members.map((member) => (
                <MemberPreview key={member.userId} member={member} />
              ))}
            </div>
          </section>
        )}
          </>
        )}
      </main>

      <aside className="team-detail__aside">
        <section className="team-detail__panel">
          <div className="team-detail__panel-heading">
            <h2>最近动态</h2>
            <Link to={PATHS.teamActivities(teamId)}>查看全部</Link>
          </div>
          {activities.length === 0 ? (
            <p className="team-detail__muted">创建项目后会显示团队动态。</p>
          ) : (
            <ul className="team-detail__activity-list">
              {activities.slice(0, 3).map((activity) => (
                <li key={activity.id} className="team-detail__activity-item">
                  <CheckCircleFilled />
                  <div>
                    <strong>{activity.title}</strong>
                    <span>{activity.summary || activity.actor?.displayName || '系统'}</span>
                  </div>
                  <time>{formatRelativeTime(activity.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
{/* 
        <section className="team-detail__panel">
          <div className="team-detail__panel-heading">
            <h2>待处理的团队邀请</h2>
            <span>0 个</span>
          </div>
          <p className="team-detail__muted">当前接口没有待处理项目邀请列表，这里先保留原型中的信息区位置。</p>
        </section> */}
      </aside>

      <CreateProjectModal
        teamId={teamId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
