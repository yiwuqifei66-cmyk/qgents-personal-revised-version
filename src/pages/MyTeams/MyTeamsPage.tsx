import { Link } from 'react-router-dom'
import { Spin } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { PATHS } from '@/routes/paths'
import { teamApi } from '@/api'
import { EmptyState } from '@/components/EmptyState'
import './MyTeamsPage.css'

/**
 * 我的团队列表
 *
 * - 调 GET /teams 获取当前用户的团队列表
 * - 按 myRole 拆成「我创建的」和「我参与的」
 * - 加载中显示 Spin，加载失败显示错误，无团队显示空状态
 */
export default function MyTeamsPage() {
  const {
    data: teams,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['teams', 'mine'],
    queryFn: teamApi.listMine,
  })

  // ──── 加载中 ────
  if (isLoading) {
    return (
      <div className="my-teams">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
          <Spin size="large" />
        </div>
      </div>
    )
  }

  // ──── 加载失败 ────
  if (isError) {
    return (
      <div className="my-teams">
        <EmptyState
          icon="⚠️"
          title="加载失败"
          description="无法获取团队列表，请检查网络后重试"
          action={
            <button className="my-teams__btn my-teams__btn--primary" onClick={() => refetch()}>
              重新加载
            </button>
          }
        />
      </div>
    )
  }

  // ──── 拆分团队 ────
  const ownedTeams = (teams ?? []).filter((t) => t.role === 'TEAM_OWNER')
  const joinedTeams = (teams ?? []).filter((t) => t.role !== 'TEAM_OWNER')

  return (
    <div className="my-teams">
      <div className="my-teams__header">
        <div>
          <h1>我的团队</h1>
          <p>管理你加入的团队，或创建 / 加入新团队</p>
        </div>
        <div className="my-teams__actions">
          <Link to={PATHS.JOIN_TEAM} className="my-teams__btn my-teams__btn--ghost">
            加入团队
          </Link>
          <Link to={PATHS.CREATE_TEAM} className="my-teams__btn my-teams__btn--primary">
            + 创建团队
          </Link>
        </div>
      </div>

      {/* ──── 我创建的 ──── */}
      <section className="my-teams__section">
        <h2>我创建的团队</h2>
        {ownedTeams.length === 0 ? (
          <EmptyState
            icon="🏠"
            title="还没有创建团队"
            description="创建你的第一个团队，邀请成员一起协作"
          />
        ) : (
          <div className="my-teams__grid">
            {ownedTeams.map((t) => (
              <TeamCard key={t.id} team={t} />
            ))}
            <Link to={PATHS.CREATE_TEAM} className="my-teams__card my-teams__card--create">
              <span aria-hidden>+</span>
              新建团队
            </Link>
          </div>
        )}
      </section>

      {/* ──── 我参与的 ──── */}
      <section className="my-teams__section">
        <h2>我参与的团队</h2>
        {joinedTeams.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="还没有加入其他团队"
            description="让朋友邀请你，或输入邀请码加入已有团队"
          />
        ) : (
          <div className="my-teams__grid">
            {joinedTeams.map((t) => (
              <TeamCard key={t.id} team={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** 团队卡片 */
function TeamCard({ team }: { team: { id: string; name: string; role?: string; memberCount?: number; avatarUrl?: string } }) {
  const letter = team.name.slice(0, 1)
  const color = team.role === 'TEAM_OWNER' ? '#3b82f6' : '#8b5cf6'
  const roleLabel = team.role === 'TEAM_OWNER' ? 'Owner' : 'Member'

  return (
    <article className="my-teams__card">
      <div className="my-teams__card-top">
        {team.avatarUrl ? (
          <img className="my-teams__logo my-teams__logo--img" src={team.avatarUrl} alt={team.name} />
        ) : (
          <span className="my-teams__logo" style={{ background: color }}>
            {letter}
          </span>
        )}
        <span className="my-teams__role">{roleLabel}</span>
      </div>
      <h3>{team.name}</h3>
      <p className="my-teams__meta">{team.memberCount ?? '—'} 位成员</p>
      <Link to={PATHS.teamDetail(team.id, team.role === 'TEAM_OWNER')} className="my-teams__detail">
        查看详情
      </Link>
    </article>
  )
}
