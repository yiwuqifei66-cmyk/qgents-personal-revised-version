import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Typography,
  Button,
  Card,
  Tag,
  Space,
  Empty,
  Spin,
  Alert,
  Table,
  App,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowLeftOutlined, LinkOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import { githubApi } from '@/api/github'
import { queryKeys } from '@/query/queryKeys'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import { DarkPage } from '@/components/DarkPage'
import {
  formatGithubDateTime,
  githubInstallationConfigureUrl,
  isGithubRepoBindable,
  type GithubAuthorizedRepository,
  type GithubInstallation,
} from '@/types/github'

const { Title, Paragraph, Text } = Typography

// 2.
// export interface GithubAuthorizedRepository {
//   repositoryId: string
//   fullName: string
//   githubUrl: string
//   private: boolean
//   /** 归属哪一次 GitHub App 安装；用于卡片「查看仓库」过滤 */
//   installationId?: string
//   /** 仓库默认分支（联调字段名若为 default_branch，在 api 层映射） */
//   defaultBranch?: string
//   /** 与 Qgents 的同步状态；缺省时前端按未同步展示 */
//   syncStatus?: 'SYNCED' | 'NOT_SYNCED' | 'SYNCING' | 'FAILED'
// }
// 已冻结见 docs：主键为 id；visibility 替代 private；metadataSyncedAt + authorizationStatus 替代 syncStatus。

function visibilityTag(visibility: GithubAuthorizedRepository['visibility']) {
  if (visibility === 'PRIVATE') return <Tag>Private</Tag>
  if (visibility === 'INTERNAL') return <Tag>Internal</Tag>
  return <Tag color="blue">Public</Tag>
}

function authorizationTag(status: GithubAuthorizedRepository['authorizationStatus']) {
  return status === 'AUTHORIZED' ? (
    <Tag color="success">已授权</Tag>
  ) : (
    <Tag color="error">已撤销</Tag>
  )
}

/**
 * 某次 GitHub App 安装下的已授权仓库列表页
 * 路由：/app/integrations/github/installations/:installationId/repositories?teamId=
 * 入口：GitHub 集成页卡片「查看仓库」
 *
 * 列表列：已授权仓库 | 默认分支 | 同步状态 | 操作
 * 数据来自 GET /teams/{teamId}/integrations/github/repositories
 */
export default function GithubInstallationReposPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { installationId = '' } = useParams<{ installationId: string }>()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId') || 'team-xinghe'//拿两个ID,一个是安装记录ID,还有一个是团队ID

  const installationsQuery = useQuery({
    queryKey: queryKeys.githubInstallations(teamId),
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: Boolean(teamId),//安装列表的数组对象
  })

  const reposQuery = useQuery({
    queryKey: queryKeys.githubTeamRepositories(teamId),
    queryFn: () => githubApi.listTeamRepositories(teamId),
    enabled: Boolean(teamId),//仓库列表的数组对象
  })
// 缓存计算结果，不要没事反复循环查找
// 从一堆安装记录当中找到当前所点击的安装记录,主要还是通过路由地址进行校准
  const installation: GithubInstallation | undefined = useMemo(
    () => installationsQuery.data?.find((i) => i.id === installationId),//查找当前地址栏url和安装记录ID是否一致
    [installationsQuery.data, installationId],
  )
  // GitHub App 安装被删除 / 解绑了,仓库记录还保留在 Qgents 系统里，但关联关系失效，installationId 置空
  const repos = useMemo(() => {
    const all = reposQuery.data ?? []
    const scoped = all.filter((r) => r.installationId === installationId)//按照安装id进行筛选
    if (scoped.length === 0 && all.some((r) => !r.installationId)) return all//兜底返回全部
    return scoped
  }, [reposQuery.data, installationId])
// 仓库列表更新,安装id发生变化

  const pendingConfigureSyncRef = useRef(false)

  const syncMutation = useMutation({
    mutationFn: () => githubApi.syncInstallation(teamId, installationId),
    onSuccess: async () => {
      message.success('已刷新授权仓库')
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations(teamId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubTeamRepositories(teamId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(teamId) })
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return Array.isArray(key) && key[0] === 'qgents' && key[1] === 'projects' && key[3] === 'repositories'
        },
      })
    },
    onError: (error) => {
      message.error(formatApiError(error))
    },
  })

  useEffect(() => {
    function syncAfterReturningFromGithub() {
      if (document.visibilityState !== 'visible') return
      if (!pendingConfigureSyncRef.current) return
      pendingConfigureSyncRef.current = false
      syncMutation.mutate()
    }
    document.addEventListener('visibilitychange', syncAfterReturningFromGithub)
    window.addEventListener('focus', syncAfterReturningFromGithub)
    return () => {
      document.removeEventListener('visibilitychange', syncAfterReturningFromGithub)
      window.removeEventListener('focus', syncAfterReturningFromGithub)
    }
  }, [syncMutation])

  const configureUrl = installation ? githubInstallationConfigureUrl(installation) : null

  function openGithubConfigure() {
    if (!configureUrl) {
      message.error('缺少 GitHub Installation 数字 ID，无法打开配置页。请先刷新授权仓库。')
      return
    }
    const popup = window.open(configureUrl, '_blank', 'noopener,noreferrer')
    if (!popup) {
      message.error('浏览器拦截了新窗口，请允许弹窗后再试')
      return
    }
    pendingConfigureSyncRef.current = true
    message.info('已打开 GitHub 配置页。调整并保存后回到本页，会自动同步授权仓库。')
  }

  const accountLabel =
    installation?.accountType === 'ORGANIZATION' ? 'GitHub 组织' : 'GitHub 个人账号'

  const columns: ColumnsType<GithubAuthorizedRepository> = [
    {
      title: '已授权仓库',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (_value, repo) => (
        <Space>
          <a href={repo.githubUrl} target="_blank" rel="noopener noreferrer">
            {repo.fullName}
          </a>
          {visibilityTag(repo.visibility)}
          {repo.archived ? <Tag>已归档</Tag> : null}
          <a href={repo.githubUrl} target="_blank" rel="noopener noreferrer">
            <LinkOutlined />
          </a>
        </Space>
      ),
    },
    {
      title: '默认分支',
      dataIndex: 'defaultBranch',
      key: 'defaultBranch',
      width: 140,
      align: 'center',
      render: (branch: string | null | undefined) => branch || '—',
    },
    {
      title: '授权状态',
      dataIndex: 'authorizationStatus',
      key: 'authorizationStatus',
      width: 110,
      render: (status: GithubAuthorizedRepository['authorizationStatus']) =>
        authorizationTag(status),
    },
    {
      title: '元数据同步',
      dataIndex: 'metadataSyncedAt',
      key: 'metadataSyncedAt',
      width: 180,
      render: (at: string | undefined) => formatGithubDateTime(at),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      align: 'right',
      render: (_value, repo) => {
        const bindable = isGithubRepoBindable(repo, installation)
        return (
          <Button
            type="primary"
            size="small"
            disabled={!bindable}
            title={
              bindable
                ? undefined
                : '当前仓库不可绑定：需已授权、未归档、默认分支非空，且 Installation 为 ACTIVE。请刷新授权仓库信息。'
            }
            onClick={() =>
              navigate(
                PATHS.bindRepoToProject(teamId, {
                  installationId: repo.installationId || installationId,
                  repositoryId: repo.id,
                  fullName: repo.fullName,
                }),
              )
            }
          >
            绑定该仓库到项目
          </Button>
        )
      },
    },
  ]

  return (
    <DarkPage>
      <Link to={PATHS.githubIntegration(teamId)}>
        <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0, marginBottom: 16 }}>
          返回 GitHub 集成
        </Button>
      </Link>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 8,
        }}
      >
        <div>
          <Title level={2} style={{ marginTop: 0, marginBottom: 8 }}>
            {installation?.accountLogin ?? installationId} · 已授权仓库
          </Title>
          <Paragraph type="secondary">
            {installation ? accountLabel : '加载安装信息…'}
            {' · '}
            installationId: <Text code>{installationId}</Text>
            {' · '}
            teamId: <Text code>{teamId}</Text>
          </Paragraph>
        </div>
        <Space wrap>
          <Button
            icon={<SettingOutlined />}
            disabled={!configureUrl}
            onClick={openGithubConfigure}
          >
            调整仓库
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={syncMutation.isPending}
            disabled={!installationId}
            onClick={() => syncMutation.mutate()}
          >
            刷新授权仓库
          </Button>
        </Space>
      </div>

      <Card>
        {reposQuery.isLoading || installationsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : reposQuery.isError ? (
          <Alert type="error" showIcon message={formatApiError(reposQuery.error)} />
        ) : repos.length === 0 ? (
          <Empty description="该安装下暂无授权仓库">
            <Paragraph type="secondary">
              可点右上角「调整仓库」，在 GitHub 配置页勾选仓库后回到本页自动同步。
            </Paragraph>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={repos}
            pagination={false}
            size="middle"
          />
        )}
      </Card>
      <Paragraph type="secondary" style={{ marginTop: 16 }}>
        「调整仓库」会打开当前 GitHub App 的配置页（勾选授权仓库）。保存后回到本页会自动同步列表与授权状态；也可手动点「刷新授权仓库」。
      </Paragraph>
    </DarkPage>
  )
}
