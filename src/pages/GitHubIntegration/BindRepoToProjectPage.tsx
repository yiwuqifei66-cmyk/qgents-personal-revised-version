import { Link, useSearchParams } from 'react-router-dom'
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Typography,
  Button,
  Card,
  List,
  Space,
  Empty,
  Spin,
  Alert,
  App,
  theme,
  Checkbox,
  Input,
} from 'antd'
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons'
import { projectApi } from '@/api/project'
import { ApiError } from '@/api'
import { githubApi } from '@/api/github'
import { queryKeys } from '@/query/queryKeys'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import { DarkPage } from '@/components/DarkPage'
import type { Project } from '@/types'
import { isGithubRepoBindable, type ProjectBoundRepository } from '@/types/github'

const { Title, Paragraph, Text } = Typography

/**
 * 绑定授权仓库 → 选择团队项目
 *
 * 路由：/app/integrations/github/bind-repo?teamId=&installationId=&repositoryId=&fullName=
 *
 * 【与后端对接】
 * - GET /teams/{teamId}/projects → 团队项目列表
 * - GET /projects/{projectId}/repositories → 判断该 GitHub repositoryId 是否已绑定
 *   （用返回项的 repositoryId / id 匹配；解除绑定时 DELETE 用绑定记录 id）
 * - POST /projects/{projectId}/repositories → 绑定
 * - DELETE /projects/{projectId}/repositories/{bindingId} → 解除绑定
 *
 * 【多选交互】
 * - 默认：无勾选框、无「绑定到选中项目」；每行显示「绑定到此项目」或「解除绑定」
 * - 按住 Ctrl（Mac 为 ⌘）+ 左键点某一行：进入多选模式，所有行出现勾选框，
 *   隐藏行内绑定/解绑按钮，并显示「绑定到选中项目（N）」
 * - 确认框取消：退出多选并清空勾选
 */
export default function BindRepoToProjectPage() {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()

  const teamId = searchParams.get('teamId') || 'team-xinghe'
  const installationId = searchParams.get('installationId') || ''
  const repositoryId = searchParams.get('repositoryId') || ''
  const fullName = searchParams.get('fullName') || ''

  /** 项目名称/描述搜索 */
  const [keyword, setKeyword] = useState('')
  /**
   * 是否处于 Ctrl 多选模式：
   * false 时绝不渲染勾选框与「绑定到选中项目」
   */
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  /** 多选勾中的项目 id */
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const projectsQuery = useQuery({
    queryKey: queryKeys.teamProjects(teamId),
    queryFn: () => projectApi.listByTeam(teamId),
    enabled: Boolean(teamId),
  })

  const projects = projectsQuery.data ?? []

  const installationsQuery = useQuery({
    queryKey: queryKeys.githubInstallations(teamId),
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: Boolean(teamId),
  })

  const teamReposQuery = useQuery({
    queryKey: queryKeys.githubTeamRepositories(teamId),
    queryFn: () => githubApi.listTeamRepositories(teamId),
    enabled: Boolean(teamId),
  })

  const authorizedRepo = useMemo(
    () => teamReposQuery.data?.find((r) => r.id === repositoryId),
    [teamReposQuery.data, repositoryId],
  )
  const installation = useMemo(
    () => installationsQuery.data?.find((i) => i.id === installationId),
    [installationsQuery.data, installationId],
  )
  const bindable = Boolean(
    authorizedRepo && isGithubRepoBindable(authorizedRepo, installation),
  )

  /**
   * 为每个项目拉取已绑定仓库列表，用于判断当前 github repositoryId 是否已绑定
   * TODO[后端联调] 若后端提供「按 repositoryId 反查已绑定项目」批量接口，可替换此 N 次请求
   * 已冻结见 docs：第一版不提供批量反查；继续按「团队总览 + 选择项目」对单项目 GET 绑定列表。
   */
  const bindingQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: queryKeys.projectRepositories(p.id),
      queryFn: () => githubApi.listProjectRepositories(p.id),
      enabled: Boolean(p.id) && Boolean(repositoryId),
    })),
  })

  /** projectId → 命中当前仓库的绑定记录（有则已绑定） */
  const bindingByProjectId = useMemo(() => {
    const map = new Map<string, ProjectBoundRepository>()
    projects.forEach((p, index) => {
      const list = bindingQueries[index]?.data ?? []
      const hit = list.find(
        (b) => b.repositoryId === repositoryId || b.fullName === fullName,
      )
      if (hit) map.set(p.id, hit)
    })
    return map
  }, [projects, bindingQueries, repositoryId, fullName])

  const filteredProjects = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    )
  }, [projects, keyword])

  const exitMultiSelect = useCallback(() => {
    setMultiSelectMode(false)
    setSelectedIds([])
  }, [])

  const invalidateBindings = useCallback(async () => {
    await Promise.all(
      projects.map((p) =>
        queryClient.invalidateQueries({ queryKey: queryKeys.projectRepositories(p.id) }),
      ),
    )
  }, [projects, queryClient])

  const bindOne = useCallback(
    async (projectId: string) => {
      await githubApi.bindRepository(projectId, {
        installationId,
        repositoryId,
        displayName: fullName.includes('/') ? fullName : fullName.split('/').pop(),
      })
    },
    [installationId, repositoryId, fullName],
  )

  const bindMutation = useMutation({
    mutationFn: async (projectIds: string[]) => {
      const results = await Promise.allSettled(projectIds.map((id) => bindOne(id)))
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        throw new Error(`${failed.length} 个项目绑定失败，其余可能已成功`)
      }
      return projectIds.length
    },
    onSuccess: async (count) => {
      message.success(
        count === 1
          ? `绑定成功：${fullName}`
          : `绑定成功：已将 ${fullName} 绑定到 ${count} 个项目`,
      )
      exitMultiSelect()
      await invalidateBindings()
    },
    onError: (error) => {
      message.error(formatUnbindError(error))
    },
  })

  const unbindMutation = useMutation({
    mutationFn: async ({
      projectId,
      bindingId,
    }: {
      projectId: string
      bindingId: string
    }) => {
      // DELETE 路径参数：优先传绑定记录 id（文档 /projects/{id}/repositories/{repositoryId}）
      await githubApi.unbindRepository(projectId, bindingId)
    },
    onSuccess: async () => {
      message.success('已解除绑定')
      await invalidateBindings()
    },
    onError: (error) => {
      message.error(formatApiError(error))
    },
  })

  function onProjectRowClick(project: Project, e: MouseEvent) {
    const withCtrl = e.ctrlKey || e.metaKey
    if (!withCtrl) {
      // 未按 Ctrl：不进入多选（避免「不按 Ctrl 也能多选」）
      return
    }
    e.preventDefault()

    if (!multiSelectMode) {
      // 第一次 Ctrl+点击：进入多选，勾上当前项，展示所有勾选框
      setMultiSelectMode(true)
      setSelectedIds([project.id])
      return
    }

    // 已在多选模式：切换勾选
    setSelectedIds((prev) =>
      prev.includes(project.id) ? prev.filter((id) => id !== project.id) : [...prev, project.id],
    )
  }

  function confirmBindToProjects(targetIds: string[], countLabel: number) {
    if (targetIds.length === 0) return

    modal.confirm({
      title: '确认绑定',
      content: `确定绑定 ${fullName || '该仓库'} 到这 ${countLabel} 个项目？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => bindMutation.mutateAsync(targetIds),
      onCancel: () => {
        // 取消：清空勾选并退出多选，回到原始状态
        exitMultiSelect()
      },
    })
  }

  function handleBindSelected() {
    confirmBindToProjects(selectedIds, selectedIds.length)
  }

  function handleBindSingle(project: Project) {
    bindMutation.mutate([project.id])
  }

  function handleUnbind(project: Project) {
    const binding = bindingByProjectId.get(project.id)
    if (!binding) return
    modal.confirm({
      title: '确认解除绑定',
      content: `确定解除 ${fullName} 与项目「${project.name}」的绑定？`,
      okText: '解除绑定',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () =>
        unbindMutation.mutateAsync({
          projectId: project.id,
          bindingId: binding.id,
        }),
    })
  }

  const backToRepos = PATHS.githubInstallationRepos(teamId, installationId || 'unknown')
  const bindingsLoading = bindingQueries.some((q) => q.isLoading)

  return (
    <DarkPage>
      <Link to={backToRepos}>
        <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0, marginBottom: 16 }}>
          返回已授权仓库
        </Button>
      </Link>

      <Title level={2} style={{ marginTop: 0, marginBottom: 8 }}>
        请选择你要绑定的项目
      </Title>
      <Paragraph type="secondary">
        仓库：<Text code>{fullName || '（未指定）'}</Text>
        {' · '}
        团队：<Text code>{teamId}</Text>
        <br />
        按住 <Text keyboard>Ctrl</Text>（Mac 为 <Text keyboard>⌘</Text>）再左键点击某一项目，才会进入多选；
        平时可直接「绑定到此项目」/「解除绑定」（成功仅提示，不跳转）。
      </Paragraph>

      {!bindable && installationId && repositoryId && !teamReposQuery.isLoading && !installationsQuery.isLoading ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="当前仓库不可绑定"
          description="需 authorizationStatus=AUTHORIZED、未归档、默认分支非空，且对应 Installation 为 ACTIVE。请返回仓库页刷新授权仓库信息。已绑定项目仍可解除绑定。"
        />
      ) : null}

      {/* 卡片上方：项目搜索 */}
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索项目名称、描述或 projectId"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <Card
        extra={
          <Space wrap>
            {/* 仅多选模式才显示「绑定到选中项目」计数按钮 */}
            {multiSelectMode ? (
              <Button
                disabled={selectedIds.length === 0 || bindMutation.isPending || !bindable}
                onClick={handleBindSelected}
              >
                绑定到选中项目（{selectedIds.length}）
              </Button>
            ) : null}
            {multiSelectMode ? (
              <Button type="link" onClick={exitMultiSelect}>
                退出多选
              </Button>
            ) : null}
          </Space>
        }
      >
        {!installationId || !repositoryId ? (
          <Alert
            type="warning"
            showIcon
            message="缺少 installationId 或 repositoryId，请从「已授权仓库」页的绑定按钮进入"
          />
        ) : projectsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : projectsQuery.isError ? (
          <Alert type="error" showIcon message={formatApiError(projectsQuery.error)} />
        ) : filteredProjects.length === 0 ? (
          <Empty description={keyword ? '没有匹配的项目' : '该团队下暂无项目'}>
            {!keyword ? (
              <Link to={PATHS.createProject(teamId)}>
                <Button type="primary">去创建项目</Button>
              </Link>
            ) : null}
          </Empty>
        ) : (
          <List
            dataSource={filteredProjects}
            renderItem={(project) => {
              const checked = selectedIds.includes(project.id)
              const bound = bindingByProjectId.get(project.id)
              const alreadyBound = Boolean(bound)

              return (
                <List.Item
                  key={project.id}
                  style={{
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: multiSelectMode && checked ? token.colorPrimaryBg : undefined,
                    cursor: 'pointer',
                    paddingLeft: 8,
                    paddingRight: 8,
                  }}
                  onClick={(e) => onProjectRowClick(project, e)}
                  actions={
                    // 多选模式：隐藏行内按钮（与勾选框互斥）
                    multiSelectMode
                      ? []
                      : [
                          alreadyBound ? (
                            <Button
                              key="unbind"
                              danger
                              size="small"
                              loading={unbindMutation.isPending}
                              disabled={bindingsLoading || bindMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleUnbind(project)
                              }}
                            >
                              解除绑定
                            </Button>
                          ) : (
                            <Button
                              key="bind"
                              type="primary"
                              size="small"
                              loading={bindMutation.isPending}
                              disabled={bindingsLoading || unbindMutation.isPending || !bindable}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleBindSingle(project)
                              }}
                            >
                              绑定到此项目
                            </Button>
                          ),
                        ]
                  }
                >
                  <Space align="start">
                    {/* 仅多选模式显示勾选框；平时不渲染，避免误触 */}
                    {multiSelectMode ? (
                      <Checkbox
                        checked={checked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                          setSelectedIds((prev) =>
                            prev.includes(project.id)
                              ? prev.filter((id) => id !== project.id)
                              : [...prev, project.id],
                          )
                        }}
                      />
                    ) : null}
                    <Space orientation="vertical" size={0}>
                      <Space>
                        <Text strong>{project.name}</Text>
                        {!multiSelectMode && alreadyBound ? (
                          <Text type="success" style={{ fontSize: 12 }}>
                            已绑定
                          </Text>
                        ) : null}
                      </Space>
                      {project.description ? (
                        <Text type="secondary">{project.description}</Text>
                      ) : null}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        projectId: {project.id}
                      </Text>
                    </Space>
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

function formatUnbindError(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'error' in error.body) {
    const apiError = (error.body as { error?: { code?: unknown } }).error
    if (apiError?.code === 'PROJECT_REPOSITORY_IN_USE') {
      return '该仓库正被进行中的任务使用，暂时无法解除绑定。'
    }
  }
  return formatApiError(error)
}
