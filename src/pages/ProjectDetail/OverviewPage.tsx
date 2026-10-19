import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Spin, Tag } from 'antd'
import {
  ArrowRightOutlined,
  DatabaseOutlined,
  CommentOutlined,
  TeamOutlined,
  RocketOutlined,
  MessageOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import { githubApi, groupApi, projectApi, tasksApi } from '@/api'
import { useDeliverySummary } from '@/hooks/delivery-center'
import { PATHS } from '@/routes/paths'
import { queryKeys, taskModelQueryKeys } from '@/query'
import './OverviewPage.css'

/** 项目概览：项目信息、核心统计与项目协作状态 */
export function OverviewPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()

  const { data: project, isLoading } = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => projectApi.getById(projectId),
    enabled: !!projectId,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['groups', projectId],
    queryFn: () => groupApi.listByProject(projectId),
    enabled: !!projectId,
  })
  const activeReqGroups = groups.filter((g) => g.type === 'REQUIREMENT' && !g.isArchived).length
  const activeGroups = groups.filter((g) => g.type === 'REQUIREMENT' && !g.isArchived).slice(0, 4)
  const mainGroup = groups.find((g) => g.type === 'PROJECT_MAIN') ?? null

  const { data: members = [] } = useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => projectApi.listMembers(projectId),
    enabled: !!projectId,
  })

  // 绑定仓库数：GET /projects/{id} 契约不含 repositoryCount（§6），以已绑定仓库列表实取为准
  const { data: repositories = [] } = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: !!projectId,
  })

  const { data: runningTaskPage } = useQuery({
    // 「运行中任务」与任务中心「运行中」筛选同源：status=RUNNING 由服务端过滤，
    // 计数口径一致；不再把 WAITING_DIFF_CONFIRMATION/DELIVERING 等「等待用户/交付中」
    // 状态误算为运行中。queryKey 必须用 taskModelQueryKeys 前缀
    // （['qgents','projects',projectId,'tasks',...]），SSE 事件失效与任务 mutation
    // 都 invalidate 该前缀；孤儿 key 会导致计数永不刷新。
    queryKey: taskModelQueryKeys.tasks.list(projectId, { status: 'RUNNING', limit: 100 }),
    queryFn: () => tasksApi.list(projectId, { status: 'RUNNING', limit: 100 }),
    enabled: !!projectId,
  })
  const runningTasks = runningTaskPage?.data.length ?? 0
  const deliverySummary = useDeliverySummary(projectId)

  if (isLoading) {
    return (
      <div className="ov">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="ov">
        <div className="ov__empty">项目未找到</div>
      </div>
    )
  }

  const isAdmin = project.role === 'PROJECT_ADMIN'

  return (
    <div className="ov">
      <h1 className="ov__page-title">项目概览</h1>
      <div className="ov__stats">
        <StatCard icon={<DatabaseOutlined />} tone="teal" label="绑定仓库" value={repositories.length} />
        <StatCard icon={<CommentOutlined />} tone="green" label="需求群" value={activeReqGroups} />
        <StatCard icon={<TeamOutlined />} tone="blue" label="项目成员" value={members.length} />
        <StatCard icon={<RocketOutlined />} tone="orange" label="运行中任务" value={runningTasks} />
      </div>

      <div className="ov__dashboard-grid">
        <section className="ov-panel ov-panel--groups">
          <div className="ov-panel__header">
            <div>
              <h2 className="ov__section-title">需求群</h2>
              <p className="ov-panel__desc">进入具体群聊，继续推进项目需求</p>
            </div>
            <LinkButton to={PATHS.projectDetail(projectId)} label="查看全部" />
          </div>
          {activeGroups.length > 0 ? (
            <div className="ov-group-list">
              {activeGroups.map((group) => (
                <Link key={group.id} to={PATHS.projectReqChat(projectId, group.id)} className="ov-group-row">
                  <span className="ov-group-row__icon"><MessageOutlined /></span>
                  <span className="ov-group-row__body">
                    <strong>{group.title}</strong>
                    <span>{group.description || '暂无群描述'}</span>
                  </span>
                  <ArrowRightOutlined className="ov-group-row__arrow" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="ov-panel__empty">暂无活跃需求群</div>
          )}
          <Link to={PATHS.projectDetail(projectId)} className="ov-panel__footer-link">
            <PlusText />
          </Link>
        </section>

        <section className="ov-panel ov-panel--delivery">
          <div className="ov-panel__header">
            <div>
              <h2 className="ov__section-title">交付状态（按仓库）</h2>
              <p className="ov-panel__desc">查看各仓库当前交付进度</p>
            </div>
            <LinkButton to={PATHS.projectDiffs(projectId)} label="查看全部" />
          </div>
          {deliverySummary.isLoading ? (
            <div className="ov-panel__empty">正在加载交付状态…</div>
          ) : deliverySummary.isError || !deliverySummary.data ? (
            <div className="ov-panel__empty">交付状态暂时不可用</div>
          ) : deliverySummary.data.repositorySummaries.length > 0 ? (
            <div className="ov-repo-list">
              {deliverySummary.data.repositorySummaries.slice(0, 4).map((repository) => {
                const status = repository.deliveryStatus
                const statusMeta = status === 'FAILED'
                  ? { label: '失败', color: 'red' }
                  : repository.pending > 0
                    ? { label: '处理中', color: 'orange' }
                    : repository.total > 0 && repository.accepted >= repository.total
                      ? { label: '已完成', color: 'green' }
                      : { label: '待开始', color: 'default' }
                return (
                  <div key={repository.repositoryId} className="ov-repo-row">
                    <span className="ov-repo-row__icon"><CodeOutlined /></span>
                    <span className="ov-repo-row__body">
                      <strong>{repository.repositoryName}</strong>
                      <span>{repository.accepted}/{repository.total} 已交付{repository.mergeRequest ? ` · MR #${repository.mergeRequest.number}` : ''}</span>
                    </span>
                    <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                    {status === 'FAILED' ? <span className="ov-repo-row__failure">!</span> : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="ov-panel__empty">暂无仓库交付数据</div>
          )}
        </section>

        <section className="ov-panel ov-main-group">
          <div className="ov-panel__header">
            <div>
              <h2 className="ov__section-title">项目总群</h2>
              <p className="ov-panel__desc">全项目公共协作，不绑定单个需求或仓库</p>
            </div>
            <LinkButton to={mainGroup ? PATHS.projectReqChat(projectId, mainGroup.id) : PATHS.projectDetail(projectId)} label="进入总群" />
          </div>
          <div className="ov-main-group__content">
            <span className="ov-main-group__icon"><MessageOutlined /></span>
            <div className="ov-main-group__copy">
              <strong>{mainGroup?.title ?? '项目总群'}</strong>
              <span>{mainGroup?.description || '项目公共协作区'}</span>
            </div>
          </div>
          <div className="ov-main-group__stats">
            <span><TeamOutlined /><b>{members.length}</b> 成员</span>
            <span><DatabaseOutlined /><b>{repositories.length}</b> 仓库</span>
            <span><RocketOutlined /><b>{runningTasks}</b> 任务进行中</span>
            <span><CommentOutlined /><b>{activeReqGroups}</b> 需求群</span>
          </div>
        </section>

        <section className="ov-panel ov-project-card">
          <div className="ov-panel__header ov-project-card__header">
            <div className="ov-project-card__header-logo" aria-label="项目 Logo">
              <img src="/project-avatar.jpg" alt={`${project.name} Logo`} />
            </div>
            <div className="ov-project-card__header-copy">
              <h2 className="ov__section-title">项目卡片</h2>
              <p className="ov-panel__desc">当前项目基本信息</p>
            </div>
          </div>
          <div className="ov-project-card__content">
            <div className="ov-project-card__avatar" aria-label="项目头像">
              {project.avatarUrl ? <img src={project.avatarUrl} alt={`${project.name} 项目头像`} /> : <DatabaseOutlined />}
            </div>
            <div className="ov-project-card__copy">
              <strong>{project.name}</strong>
              <span>{project.description || '暂无项目简介'}</span>
              <Tag color={isAdmin ? 'cyan' : 'default'}>{isAdmin ? '项目管理员' : '项目成员'}</Tag>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
function LinkButton({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="ov-panel__link">{label}<ArrowRightOutlined /></Link>
}

function PlusText() {
  return <><span>进入需求群聊</span><ArrowRightOutlined /></>
}

function StatCard({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode
  tone: 'teal' | 'green' | 'blue' | 'orange'
  label: string
  value: number
}) {
  return (
    <div className={`ov-stat ov-stat--${tone}`}>
      <div className="ov-stat__icon">{icon}</div>
      <div className="ov-stat__body">
        <div className="ov-stat__value">{value}</div>
        <div className="ov-stat__label">{label}</div>
      </div>
    </div>
  )
}
