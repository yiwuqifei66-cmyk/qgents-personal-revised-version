import { Link, useNavigate, useParams } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Typography,
  Button,
  Card,
  Tag,
  Space,
  Empty,
  Spin,
  Alert,
  App,
  theme,
  Input,
  List,
  Tooltip,
} from 'antd'
import { ArrowLeftOutlined, GithubOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { githubApi } from '@/api/github'
import { projectApi } from '@/api/project'
import { queryKeys } from '@/query/queryKeys'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import { DarkPage } from '@/components/DarkPage'
import {
  formatGithubDateTime,
  isGithubRepoBindable,
  type GithubAuthorizedRepository,
  type GithubInstallation,
} from '@/types/github'

const { Title, Paragraph, Text } = Typography

type Row = GithubAuthorizedRepository & {
  accountLogin?: string
  accountType?: GithubInstallation['accountType']
}

type RepoBindingHit = { projectId: string; bindingId: string }

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
 * 该团队已授权的所有 GitHub 仓库
 * 入口：创建项目 →「绑定github仓库」
 *
 * 数据对接：
 * - GET /teams/{teamId}/integrations/github/repositories
 * - GET /teams/{teamId}/integrations/github/installations
 *   （用 installationId 拼出「授权组织/个人」展示名）
 *
 * 【绑定/解绑对接 — 与「绑定仓库到项目」页对称】
 * - GET /teams/{teamId}/projects → 团队项目列表
 * - GET /projects/{projectId}/repositories → 判断某授权仓库是否已绑到该项目
 * - POST /projects/{projectId}/repositories
 *   body: { installationId, repositoryId, defaultBranch, displayName }
 * - DELETE /projects/{projectId}/repositories/{bindingId}
 *
 * 「已绑定」定义：该 github repositoryId 至少绑到团队内任意一个项目。
 * 「绑定仓库」：把该仓库绑到团队内所有尚未绑定它的项目。
 * 「解除绑定」：从所有已绑定该仓库的项目上 DELETE。
 *
 * 【交互 — 复用绑定项目页逻辑】
 * - 搜索框过滤仓库
 * - 默认无勾选框；Ctrl/⌘+首次左键进入多选
 * - 多选时隐藏行内按钮与「一键绑定所有仓库」，显示「绑定到选中仓库（N）」
 * - 确认弹窗取消 → 退出多选并清空勾选
 *
 * 已冻结见 docs：方案 A 为团队总览 + 选择项目。本页不再把仓库绑到全部项目；
 * 「绑定到项目」跳转 BindRepoToProjectPage。绑定 body 不再传 defaultBranch。
 */
export default function TeamAuthorizedReposPage() {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { teamId = 'team-xinghe' } = useParams<{ teamId: string }>()

  const [keyword, setKeyword] = useState('')

  const installationsQuery = useQuery({
    queryKey: queryKeys.githubInstallations(teamId),
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: Boolean(teamId),
  })

  const reposQuery = useQuery({
    queryKey: queryKeys.githubTeamRepositories(teamId),
    queryFn: () => githubApi.listTeamRepositories(teamId),
    enabled: Boolean(teamId),
  })

  /** 团队项目：绑定目标 */
  const projectsQuery = useQuery({
    queryKey: queryKeys.teamProjects(teamId),
    queryFn: () => projectApi.listByTeam(teamId),
    enabled: Boolean(teamId),
  })

  const projects = projectsQuery.data ?? []

  /**
   * 每个项目的已绑定仓库（用于计算授权仓库是否已绑定）
   * TODO[后端联调] 若提供「按 repositoryId 反查绑定」批量接口，可替换 N 次 GET
   * 已冻结见 docs：第一版不提供批量反查，仅用于总览展示，绑定跳转选项目页。
   */
  const projectRepoQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: queryKeys.projectRepositories(p.id),
      queryFn: () => githubApi.listProjectRepositories(p.id),
      enabled: Boolean(p.id),
    })),
  })

  /** github repositoryId → 已绑定到哪些项目（含 bindingId 供 DELETE） */
  const bindingsByRepoId = useMemo(() => {
    const map = new Map<string, RepoBindingHit[]>()
    projects.forEach((p, index) => {
      const list = projectRepoQueries[index]?.data ?? []
      for (const b of list) {
        const key = b.repositoryId
        const hits = map.get(key) ?? []
        hits.push({ projectId: p.id, bindingId: b.id })
        map.set(key, hits)
      }
    })
    return map
  }, [projects, projectRepoQueries])

  const rows: Row[] = useMemo(() => {
    const installations = installationsQuery.data ?? []
    const byId = new Map(installations.map((i) => [i.id, i]))
    return (reposQuery.data ?? []).map((repo) => {
      const inst = repo.installationId ? byId.get(repo.installationId) : undefined
      return {
        ...repo,
        accountLogin: inst?.accountLogin,
        accountType: inst?.accountType,
      }
    })
  }, [reposQuery.data, installationsQuery.data])

  const installationById = useMemo(() => {
    const map = new Map<string, GithubInstallation>()
    for (const inst of installationsQuery.data ?? []) {
      map.set(inst.id, inst)
    }
    return map
  }, [installationsQuery.data])

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.defaultBranch ?? '').toLowerCase().includes(q) ||
        (r.accountLogin ?? '').toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    )
  }, [rows, keyword])

  const syncMutation = useMutation({
    mutationFn: async () => {
      const targets = (installationsQuery.data ?? []).filter((i) => i.status !== 'DELETED')
      if (targets.length === 0) {
        throw new Error('没有可刷新的 Installation')
      }
      await Promise.all(targets.map((i) => githubApi.syncInstallation(teamId, i.id)))
    },
    onSuccess: async () => {
      message.success('已刷新授权仓库')
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations(teamId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubTeamRepositories(teamId) })
    },
    onError: (error) => {
      message.error(formatApiError(error))
    },
  })

  const goSelectProject = useCallback(
    (repo: Row) => {
      navigate(
        PATHS.bindRepoToProject(teamId, {
          installationId: repo.installationId,
          repositoryId: repo.id,
          fullName: repo.fullName,
        }),
      )
    },
    [navigate, teamId],
  )

  const bindingsLoading = projectRepoQueries.some((q) => q.isLoading)

  return (
    <DarkPage>
      <Link to={PATHS.createProject(teamId)}>
        <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0, marginBottom: 16 }}>
          返回创建项目
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
            该团队已授权的所有github仓库
          </Title>
          <Paragraph type="secondary">
            teamId: <Text code>{teamId}</Text>
            {' · '}
            下列仓库来自团队已安装的 GitHub App（个人或组织授权范围）
            <br />
            绑定请先选择项目，不会一键绑到团队内全部项目。
          </Paragraph>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={syncMutation.isPending}
          disabled={(installationsQuery.data ?? []).length === 0}
          onClick={() => syncMutation.mutate()}
        >
          刷新授权仓库
        </Button>
      </div>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索仓库名、默认分支、授权账号或仓库 id"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <Card>
        {reposQuery.isLoading || installationsQuery.isLoading || projectsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : reposQuery.isError ? (
          <Alert type="error" showIcon message={formatApiError(reposQuery.error)} />
        ) : filteredRows.length === 0 ? (
          <Empty description={keyword ? '没有匹配的仓库' : '该团队暂无已授权仓库'}>
            {!keyword ? (
              <Link to={PATHS.githubIntegration(teamId)}>
                <Button type="primary">去 GitHub 集成安装授权</Button>
              </Link>
            ) : null}
          </Empty>
        ) : (
          <List
            dataSource={filteredRows}
            renderItem={(repo) => {
              const hits = bindingsByRepoId.get(repo.id) ?? []
              const alreadyBound = hits.length > 0
              const installation = installationById.get(repo.installationId)
              const bindable = isGithubRepoBindable(repo, installation)
              const kind =
                repo.accountType === 'ORGANIZATION'
                  ? '组织'
                  : repo.accountType === 'USER'
                    ? '个人'
                    : ''

              // defaultBranch 为空 → 未初始化仓库；按钮 disabled + Tooltip 提示原因
              const isEmptyRepo = !bindable && !repo.defaultBranch

              return (
                <List.Item
                  key={repo.id}
                  style={{
                    borderBottom: `1px solid ${token.colorBorder}`,
                    paddingLeft: 8,
                    paddingRight: 8,
                  }}
                  actions={[
                    isEmptyRepo && !alreadyBound ? (
                      <Tooltip
                        key="bind"
                        title="仓库尚未初始化，请先创建初始提交（在 GitHub 端或通过新建仓库功能）"
                      >
                        <Button type="primary" size="small" disabled>
                          绑定到项目
                        </Button>
                      </Tooltip>
                    ) : (
                      <Button
                        key="bind"
                        type="primary"
                        size="small"
                        disabled={bindingsLoading || (!bindable && !alreadyBound)}
                        title={
                          bindable || alreadyBound
                            ? undefined
                            : '当前仓库不可绑定：需已授权、未归档、默认分支非空，且 Installation 为 ACTIVE。请刷新授权仓库信息。'
                        }
                        onClick={() => goSelectProject(repo)}
                      >
                        {alreadyBound ? '选择项目' : '绑定到项目'}
                      </Button>
                    ),
                  ]}
                >
                  <Space align="start" style={{ width: '100%' }}>
                    <div style={{ flex: 1 }}>
                      <Space wrap>
                        <Text strong>{repo.fullName}</Text>
                        {visibilityTag(repo.visibility)}
                        {repo.archived ? <Tag>已归档</Tag> : null}
                        {authorizationTag(repo.authorizationStatus)}
                        {isEmptyRepo ? <Tag color="default">未初始化</Tag> : null}
                        {alreadyBound ? (
                          <Text type="success" style={{ fontSize: 12 }}>
                            已绑定
                          </Text>
                        ) : null}
                      </Space>
                      <div style={{ marginTop: 6 }}>
                        <Space size="large" wrap>
                          {isEmptyRepo ? (
                            <Text type="warning">
                              默认分支：仓库未初始化
                            </Text>
                          ) : (
                            <Text type="secondary">
                              默认分支：{repo.defaultBranch || '—'}
                            </Text>
                          )}
                          <Text type="secondary">
                            元数据同步：{formatGithubDateTime(repo.metadataSyncedAt)}
                          </Text>
                          <Text type="secondary">
                            <GithubOutlined style={{ marginRight: 4 }} />
                            {repo.accountLogin
                              ? `${repo.accountLogin}${kind ? `（${kind}）` : ''}`
                              : '未知账号'}
                          </Text>
                        </Space>
                      </div>
                    </div>
                  </Space>
                </List.Item>
              )
            }}
          />
        )}
      </Card>
    </DarkPage>
  )
}
