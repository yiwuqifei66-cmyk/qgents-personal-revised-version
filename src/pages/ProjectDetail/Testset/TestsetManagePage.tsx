import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Popconfirm,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { LeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, PoweroffOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { githubApi, projectApi } from '@/api'
import {
  useCreateTestset,
  useDeleteTestset,
  useDisableTestset,
  useEnableTestset,
  useTestsets,
  useUpdateTestset,
} from '@/hooks'
import { PATHS } from '@/routes/paths'
import { queryKeys } from '@/query'
import { formatApiError } from '@/utils/formatApiError'
import TestsetCreateModal from './TestsetCreateModal'
import type { Testset, TestsetStatus } from '@/types/testset'
import type { CreateTestsetPayload, UpdateTestsetPayload } from '@/types/testset'
import type { ProjectBoundRepository } from '@/types/github'

const { Title, Text, Paragraph } = Typography

const pageTheme = {
  algorithm: undefined,
  token: {
    colorPrimary: '#0d9b9b',
    colorBgBase: '#ffffff',
    colorText: '#12213d',
    colorTextSecondary: '#6d7d95',
    colorBorder: '#e4eaf2',
    borderRadius: 8,
  },
}

/**
 * 测试集管理页 —— 列表展示 + CRUD
 * 入口：质量门禁和MR页面 → "Testset 管理" 卡片
 */
export default function TestsetManagePage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()

  // 过滤器
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<TestsetStatus | undefined>()
  const [repoFilter, setRepoFilter] = useState<string | undefined>()

  // 弹窗状态
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editingTestset, setEditingTestset] = useState<Testset | null>(null)

  // 项目信息（获取角色）
  const { data: project } = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => projectApi.getById(projectId),
    enabled: Boolean(projectId),
  })
  const isAdmin = project?.role === 'PROJECT_ADMIN'

  // 仓库列表
  const reposQuery = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId),
  })
  const repositories = reposQuery.data ?? []

  // 稳定 filters 引用
  const filters = useMemo(
    () => ({ repositoryId: repoFilter, status: statusFilter }),
    [repoFilter, statusFilter],
  )

  // 测试集列表
  const {
    data: testsets = [],
    isLoading,
    refetch,
    isError,
    error,
  } = useTestsets(projectId, filters)

  // 搜索过滤（前端 keyword 过滤，后端已支持仓库/状态过滤）
  const filteredTestsets = useMemo(() => {
    if (!keyword.trim()) return testsets
    const lower = keyword.toLowerCase()
    return testsets.filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.command.toLowerCase().includes(lower) ||
        t.scopeTags.some((tag) => tag.toLowerCase().includes(lower)),
    )
  }, [testsets, keyword])

  // mutations
  const createMutation = useCreateTestset(projectId)
  const updateMutation = useUpdateTestset(projectId)
  const enableMutation = useEnableTestset(projectId)
  const disableMutation = useDisableTestset(projectId)
  const deleteMutation = useDeleteTestset(projectId)

  const repoMap = useMemo(() => {
    const map = new Map<string, ProjectBoundRepository>()
    for (const r of repositories) map.set(r.id, r)
    return map
  }, [repositories])

  const handleSubmit = useCallback(
    async (payload: CreateTestsetPayload | UpdateTestsetPayload, testsetId?: string) => {
      if (testsetId) {
        await updateMutation.mutateAsync({ testsetId, payload: payload as UpdateTestsetPayload })
        message.success('测试集已更新')
      } else {
        await createMutation.mutateAsync(payload as CreateTestsetPayload)
        message.success('测试集已创建')
      }
    },
    [createMutation, updateMutation, message],
  )

  const handleDelete = useCallback(
    (testset: Testset) => {
      modal.confirm({
        title: `删除测试集 "${testset.name}"？`,
        content: (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            删除后不可恢复。如果此测试集已被质量门禁引用，删除可能失败。
          </Paragraph>
        ),
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteMutation.mutateAsync(testset.id)
            message.success('测试集已删除')
          } catch (err) {
            message.error(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`)
          }
        },
      })
    },
    [deleteMutation, message, modal],
  )

  const handleToggleStatus = useCallback(
    (testset: Testset) => {
      if (testset.status === 'ENABLED') {
        disableMutation.mutate(testset.id)
        message.success(`已停用 "${testset.name}"`)
      } else {
        enableMutation.mutate(testset.id)
        message.success(`已启用 "${testset.name}"`)
      }
    },
    [enableMutation, disableMutation, message],
  )

  const runTestNow = useCallback(
    (testset: Testset) => {
      navigate(`${PATHS.projectQualityGate(projectId)}?testsetId=${encodeURIComponent(testset.id)}`)
    },
    [navigate, projectId],
  )

  function goBack() {
    navigate(PATHS.projectTestset(projectId))
  }

  const columns: ColumnsType<Testset> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        width: 200,
        render: (name: string, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{name}</Text>
            {record.scopeTags.length > 0 ? (
              <Space size={4}>
                {record.scopeTags.map((tag) => (
                  <Tag key={tag} color="blue" style={{ fontSize: 11 }}>
                    {tag}
                  </Tag>
                ))}
              </Space>
            ) : null}
          </Space>
        ),
      },
      {
        title: '仓库',
        key: 'repository',
        width: 180,
        render: (_: unknown, record) => {
          const repo = repoMap.get(record.repositoryId)
          return repo ? <Text code>{repo.displayName || repo.fullName}</Text> : <Text type="secondary">未知</Text>
        },
      },
      {
        title: '命令',
        dataIndex: 'command',
        key: 'command',
        width: 240,
        ellipsis: true,
        render: (cmd: string) => (
          <Tooltip title={cmd}>
            <Text code style={{ fontSize: 12 }}>{cmd}</Text>
          </Tooltip>
        ),
      },
      {
        title: '超时',
        dataIndex: 'timeoutSeconds',
        key: 'timeout',
        width: 90,
        render: (sec: number) => <Text>{sec}s</Text>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (status: TestsetStatus) =>
          status === 'ENABLED' ? (
            <Tag color="success">已启用</Tag>
          ) : (
            <Tag color="default">已停用</Tag>
          ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 260,
        render: (_: unknown, record) => {
          const canEdit = isAdmin
          const canDelete = isAdmin
          const canToggle = isAdmin
          const toggleLoading =
            enableMutation.isPending || disableMutation.isPending

          return (
            <Space size={4}>
              <Button
                size="small"
                type="link"
                icon={<PlayCircleOutlined />}
                onClick={() => runTestNow(record)}
                title="前往质量门禁页使用此测试集"
              >
                运行
              </Button>
              <Button
                size="small"
                type="link"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditingTestset(record)
                  setCreateModalOpen(true)
                }}
                disabled={!canEdit}
              >
                编辑
              </Button>
              <Button
                size="small"
                type="link"
                icon={<PoweroffOutlined />}
                onClick={() => handleToggleStatus(record)}
                disabled={!canToggle || toggleLoading}
                danger={record.status === 'ENABLED'}
              >
                {record.status === 'ENABLED' ? '停用' : '启用'}
              </Button>
              <Popconfirm
                title="删除此测试集？"
                onConfirm={() => handleDelete(record)}
                okText="删除"
                okType="danger"
                cancelText="取消"
                disabled={!canDelete}
              >
                <Button
                  size="small"
                  type="link"
                  icon={<DeleteOutlined />}
                  danger
                  disabled={!canDelete}
                >
                  删除
                </Button>
              </Popconfirm>
            </Space>
          )
        },
      },
    ],
    [isAdmin, repoMap, enableMutation.isPending, disableMutation.isPending, handleToggleStatus, handleDelete, runTestNow],
  )

  return (
    <ConfigProvider theme={pageTheme}>
      <div style={{ padding: 24 }}>
        <button
          type="button"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#0d9b9b',
            padding: 0,
            marginBottom: 12,
            fontSize: 14,
          }}
          onClick={goBack}
        >
          <LeftOutlined /> 返回质量门禁和MR
        </button>
        <Title level={2} style={{ marginTop: 0, marginBottom: 8 }}>
          测试集管理
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          创建、编辑和管理项目的测试集（Testset）。测试集是质量门禁和 Dry Run 的执行单元。
        </Paragraph>

        <Card
          size="small"
          title={
            <Space>
              <span>测试集列表</span>
              <Tag>{filteredTestsets.length} 个</Tag>
            </Space>
          }
          extra={
            <Space>
              <Input.Search
                placeholder="搜索测试集名称/命令/标签"
                allowClear
                style={{ width: 280 }}
                onSearch={setKeyword}
              />
              <Select
                placeholder="仓库"
                allowClear
                style={{ width: 200 }}
                value={repoFilter}
                onChange={setRepoFilter}
                options={repositories.map((r) => ({
                  value: r.id,
                  label: r.displayName || r.fullName,
                }))}
              />
              <Select
                placeholder="状态"
                allowClear
                style={{ width: 120 }}
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'ENABLED', label: '已启用' },
                  { value: 'DISABLED', label: '已停用' },
                ]}
              />
              {isAdmin ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingTestset(null)
                    setCreateModalOpen(true)
                  }}
                >
                  新建测试集
                </Button>
              ) : null}
            </Space>
          }
        >
          {isError ? (
            <Empty
              description={formatApiError(error)}
            >
              <Button type="primary" onClick={() => void refetch()}>重试</Button>
            </Empty>
          ) : isLoading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Text type="secondary">加载中...</Text>
            </div>
          ) : filteredTestsets.length === 0 ? (
            <Empty
              description={
                keyword || repoFilter || statusFilter
                  ? '没有匹配的测试集'
                  : '还没有测试集。点击右上角「新建测试集」创建第一个测试集。'
              }
            >
              {!keyword && !repoFilter && !statusFilter && isAdmin ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingTestset(null)
                    setCreateModalOpen(true)
                  }}
                >
                  新建测试集
                </Button>
              ) : null}
            </Empty>
          ) : (
            <Table
              rowKey="id"
              size="middle"
              pagination={false}
              columns={columns}
              dataSource={filteredTestsets}
              scroll={{ x: 1200 }}
            />
          )}

          {!isAdmin ? (
            <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
              仅项目管理员可创建、编辑、启用/停用和删除测试集。
            </Paragraph>
          ) : null}
        </Card>

        {/* 新建/编辑弹窗 */}
        <TestsetCreateModal
          open={createModalOpen}
          projectId={projectId}
          repositories={repositories}
          editing={editingTestset}
          onClose={() => {
            setCreateModalOpen(false)
            setEditingTestset(null)
          }}
          onSubmit={handleSubmit}
        />
      </div>
    </ConfigProvider>
  )
}