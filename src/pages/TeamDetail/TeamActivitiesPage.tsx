import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { List, Spin, Typography } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  BranchesOutlined,
  PullRequestOutlined,
  MergeOutlined,
  ExclamationCircleFilled,
} from '@ant-design/icons'
import { teamApi } from '@/api'
import { useTeamEvents } from '@/realtime/useTeamEvents'
import { DarkPage } from '@/components/DarkPage'
import { EmptyState } from '@/components/EmptyState'
import { PATHS } from '@/routes/paths'
import type { Activity, ActivityType } from '@/types'
import type { ReactNode } from 'react'

const { Title, Text } = Typography

/** 动态类型 → 图标 + 颜色（本期后端仅产出 6 类） */
const TYPE_META: Record<ActivityType, { icon: ReactNode; color: string }> = {
  TASK_COMPLETED: { icon: <CheckCircleFilled />, color: '#16a34a' },
  TASK_FAILED: { icon: <CloseCircleFilled />, color: '#ef4444' },
  DIFF_CREATED: { icon: <BranchesOutlined />, color: '#3b82f6' },
  MR_CREATED: { icon: <PullRequestOutlined />, color: '#a855f7' },
  MR_MERGED: { icon: <MergeOutlined />, color: '#22c55e' },
  TEST_RUN_FAILED: { icon: <ExclamationCircleFilled />, color: '#ef4444' },
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

/**
 * 动态 → 跳转目标路由。
 * §19.4：响应未下发 projectId，TASK/DIFF/MR 目标暂无法拼项目路由（后端补齐 projectId 后生效）；
 * PROJECT 目标 id 即项目 id，始终可跳。
 */
function activityTargetPath(activity: Activity): string | null {
  const { type, id } = activity.target
  if (type === 'PROJECT') return PATHS.projectDetail(id)
  const projectId = activity.projectId
  if (!projectId) return null
  if (type === 'TASK') return PATHS.projectTaskDetail(projectId, id)
  if (type === 'DIFF') return PATHS.projectDiff(projectId, id)
  if (type === 'MR') return PATHS.projectCodeMr(projectId, id)
  return null
}

/**
 * 团队动态页 —— 展示团队全部动态。
 * 入口：团队详情右侧「最近动态」面板「查看全部」。
 * 路由：/app/teams/:teamId/activities
 */
export default function TeamActivitiesPage() {
  const { teamId = '' } = useParams<{ teamId: string }>()
  const navigate = useNavigate()

  // activity.created 事件驱动刷新，替代轮询
  useTeamEvents(teamId || undefined)

  const { data: activitiesData, isLoading } = useQuery({
    queryKey: ['teams', teamId, 'activities'],
    queryFn: () => teamApi.activities(teamId),
    enabled: !!teamId,
  })
  const activities = activitiesData?.data ?? []

  return (
    <DarkPage>
      <div style={{ padding: '24px 0 48px' }}>
        <Link
          to={PATHS.teamDetail(teamId)}
          style={{ color: 'var(--qg-text-on-dark-secondary)', fontSize: 13 }}
        >
          ← 返回团队
        </Link>
        <Title level={3} style={{ color: 'var(--qg-text-on-dark)', marginTop: 6, marginBottom: 20 }}>
          团队动态
        </Title>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <Spin size="large" />
          </div>
        ) : activities.length === 0 ? (
          <EmptyState icon="📭" title="暂无团队动态" description="创建项目或产生协作后，这里会显示团队的动态" />
        ) : (
          <List
            dataSource={activities}
            renderItem={(activity: Activity) => {
              const meta = TYPE_META[activity.type] ?? TYPE_META.TASK_COMPLETED
              const to = activityTargetPath(activity)
              return (
                <List.Item
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    cursor: to ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (to) navigate(to)
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <span
                        style={{
                          display: 'inline-flex',
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: `${meta.color}1a`,
                          color: meta.color,
                          fontSize: 18,
                        }}
                      >
                        {meta.icon}
                      </span>
                    }
                    title={<Text style={{ color: 'var(--qg-text-on-dark)' }}>{activity.title}</Text>}
                    description={
                      <span>
                        {activity.summary ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {activity.summary}
                          </Text>
                        ) : null}
                        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                          {activity.actor?.displayName ?? '系统'} · {formatRelativeTime(activity.createdAt)}
                        </Text>
                      </span>
                    }
                  />
                </List.Item>
              )
            }}
          />
        )}
      </div>
    </DarkPage>
  )
}
