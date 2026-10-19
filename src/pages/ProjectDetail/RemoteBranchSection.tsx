import { useCallback, useMemo, useState } from 'react'
import {
  Collapse,
  Table,
  Button,
  Space,
  Tag,
  Typography,
  Modal,
  Form,
  Select,
  Input,
  App,
  Empty,
  Spin,
  Descriptions,
  Alert,
  Tooltip,
} from 'antd'
import { PlusOutlined, SettingOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useRemoteBranches, useCreateRemoteBranch } from '@/hooks'
import { queryKeys } from '@/query'
import type { ProjectBoundRepository, RemoteBranch } from '@/types/github'

const { Text, Paragraph } = Typography

interface RemoteBranchSectionProps {
  projectId: string
  repo: ProjectBoundRepository
  isProjectAdmin: boolean
  onSetDefaultBranch: (repoId: string, branchName: string) => Promise<void>
}

/**
 * 远程分支管理区 —— 嵌在 CodePage 的仓库卡片中
 * 文档：分支管理前后端执行计划 §8.1 ~ §8.3
 *
 * 功能：
 * - 查看 GitHub 远程分支列表
 * - 创建新分支（从已有分支/提交创建）
 * - 设置项目默认基准分支
 *
 * 与工作分支的区别：
 * - 工作分支 = Task/Workspace 自动产生的 feat/task-* 分支
 * - 远程分支 = GitHub 上真实存在的所有分支（main, develop, feat/* 等）
 */
export default function RemoteBranchSection({
  projectId,
  repo,
  isProjectAdmin,
  onSetDefaultBranch,
}: RemoteBranchSectionProps) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  // 稳定的 filters 引用，避免每次渲染产生新 queryKey 导致无限重获取
  const branchFilters = useMemo(
    () => ({ keyword: keyword || undefined, limit: 100 }),
    [keyword],
  )

  const { data: remoteBranches = [], isLoading, refetch } = useRemoteBranches(
    projectId,
    repo.id,
    branchFilters,
  )

  const handleSetDefault = useCallback((branch: RemoteBranch) => {
    modal.confirm({
      title: '设置项目默认基准分支',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Paragraph>
            确定将 <Text strong>{branch.name}</Text> 设为项目默认基准分支？
          </Paragraph>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            新创建的 Task / Dry Run / MR 将自动使用此分支作为目标分支。
            <br />
            此操作<strong>不会</strong>修改已有 Workspace 的 baseRef，也<strong>不会</strong>修改 GitHub 全局默认分支。
          </Paragraph>
        </div>
      ),
      okText: '确认设置',
      cancelText: '取消',
      onOk: async () => {
        try {
          await onSetDefaultBranch(repo.id, branch.name)
          message.success(`默认分支已设置为 ${branch.name}`)
          // 刷新仓库列表和远程分支
          void queryClient.invalidateQueries({
            queryKey: queryKeys.projectRepositories(projectId),
          })
          void queryClient.invalidateQueries({
            queryKey: queryKeys.remoteBranches.all(projectId, repo.id),
          })
        } catch (err) {
          message.error(`设置失败: ${err instanceof Error ? err.message : '未知错误'}`)
        }
      },
    })
  }, [modal, message, queryClient, projectId, repo.id, onSetDefaultBranch])

  const columns = useMemo(() => [
    {
      title: '分支名',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: RemoteBranch) => (
        <Space>
          <Text code>{name}</Text>
          {record.isProjectDefault ? <Tag color="blue">项目默认</Tag> : null}
          {record.isGithubDefault ? <Tag color="gray">GitHub 默认</Tag> : null}
        </Space>
      ),
    },
    {
      title: '最新提交',
      dataIndex: 'headCommit',
      key: 'headCommit',
      width: 140,
      render: (sha: string) => <Text code>{sha ? sha.slice(0, 7) : '—'}</Text>,
    },
    {
      title: '可操作',
      key: 'canOperate',
      width: 200,
      render: (_: unknown, record: RemoteBranch) => (
        <Space>
          {isProjectAdmin && !record.isProjectDefault ? (
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => void handleSetDefault(record)}
              disabled={!record.canCreateTaskFrom}
            >
              设为项目默认
            </Button>
          ) : null}
          {record.canDelete && isProjectAdmin ? (
            <Button
              size="small"
              danger
              disabled
              title="远程分支删除将在后续版本开放"
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ], [isProjectAdmin, handleSetDefault])

  return (
    <>
      <Collapse
        size="small"
        items={[
          {
            key: 'remote',
            label: (
              <Space>
                <Text strong>远程分支（GitHub）</Text>
                <Tag>{remoteBranches.length} 个分支</Tag>
                {repo.defaultBranch ? (
                  <Tag color="blue">
                    项目默认: {repo.defaultBranch}
                  </Tag>
                ) : null}
              </Space>
            ),
            children: (
              <div>
                {/* 仓库未初始化或无远程分支时显示告警 + 禁用创建操作 */}
                {remoteBranches.length === 0 && !isLoading ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="暂无远程分支 / 仓库未初始化"
                    description={
                      repo.defaultBranch
                        ? 'GitHub 上暂时还没有任何分支。请先在 GitHub 端初始化仓库（例如添加 README 提交），创建分支操作暂不可用。'
                        : '当前仓库尚未初始化（defaultBranch 为空），创建分支操作暂不可用。请先在 GitHub 端初始化或通过新建仓库功能重新创建。'
                    }
                  />
                ) : null}

                <div style={{ marginBottom: 12 }}>
                  <Space>
                    <Input.Search
                      placeholder="搜索分支名"
                      allowClear
                      style={{ width: 240 }}
                      onSearch={(value) => setKeyword(value)}
                    />
                    {isProjectAdmin ? (
                      <Tooltip
                        title={
                          remoteBranches.length === 0
                            ? '暂无远程分支可用作来源，无法创建分支；请先初始化仓库'
                            : undefined
                        }
                      >
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => setCreateModalOpen(true)}
                          disabled={remoteBranches.length === 0}
                        >
                          创建分支
                        </Button>
                      </Tooltip>
                    ) : null}
                    <Button onClick={() => void refetch()} size="small">
                      刷新
                    </Button>
                  </Space>
                </div>

                {isLoading ? (
                  <div style={{ textAlign: 'center', padding: 16 }}>
                    <Spin size="small" />
                  </div>
                ) : remoteBranches.length === 0 ? (
                  <Empty description="暂无远程分支/仓库未初始化" />
                ) : (
                  <Table
                    rowKey="name"
                    size="small"
                    pagination={false}
                    columns={columns}
                    dataSource={remoteBranches}
                    scroll={{ x: 500 }}
                  />
                )}

                {!isProjectAdmin ? (
                  <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                    仅项目管理员可创建分支和设置项目默认基准分支。
                  </Paragraph>
                ) : null}
              </div>
            ),
          },
        ]}
      />

      {/* 创建分支弹窗 */}
      <CreateBranchModal
        open={createModalOpen}
        projectId={projectId}
        repoId={repo.id}
        remoteBranches={remoteBranches}
        onClose={() => setCreateModalOpen(false)}
      />
    </>
  )
}

/** 创建远程分支弹窗 */
function CreateBranchModal({
  open,
  projectId,
  repoId,
  remoteBranches,
  onClose,
}: {
  open: boolean
  projectId: string
  repoId: string
  remoteBranches: RemoteBranch[]
  onClose: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const createMutation = useCreateRemoteBranch(projectId, repoId)

  // 候选源分支：过滤掉 GitHub 默认分支受保护的情况，这里允许所有分支作为 source
  const sourceOptions = remoteBranches.map((b) => ({
    value: b.name,
    label: (
      <span>
        {b.name}
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {b.headCommit ? b.headCommit.slice(0, 7) : ''}
        </Text>
      </span>
    ),
  }))

  async function handleOk() {
    try {
      const values = await form.validateFields()
      // 双保险：禁止提交空 fromRef（不依赖按钮 disabled）
      if (!values.fromRef || !values.fromRef.trim()) {
        message.error('请选择来源分支或先初始化仓库')
        return
      }
      // 双保险：source 列表为空时也不允许提交
      if (remoteBranches.length === 0) {
        message.error('暂无远程分支可用作来源，无法创建分支；请先初始化仓库')
        return
      }
      createMutation.mutate(
        { name: values.name, fromRef: values.fromRef },
        {
          onSuccess: () => {
            message.success(`分支 ${values.name} 创建成功`)
            handleClose()
          },
          onError: (err) => {
            message.error(`创建失败: ${err.message}`)
          },
        },
      )
    } catch {
      // 验证失败
    }
  }

  function handleClose() {
    form.resetFields()
    onClose()
  }

  return (
    <Modal
      title="创建远程分支"
      open={open}
      onOk={() => void handleOk()}
      onCancel={handleClose}
      confirmLoading={createMutation.isPending}
      destroyOnHidden
      width={480}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{}}
      >
        <Form.Item
          label="分支名"
          name="name"
          rules={[
            { required: true, message: '请输入分支名' },
            {
              validator: (_rule, value: string) => {
                if (!value) return Promise.resolve()
                if (value.startsWith('refs/heads/')) {
                  return Promise.reject('分支名不能包含 refs/heads/ 前缀')
                }
                if (value.includes('..') || value.includes('//')) {
                  return Promise.reject('分支名不能包含 .. 或 //')
                }
                if (value.endsWith('.lock')) {
                  return Promise.reject('分支名不能以 .lock 结尾')
                }
                return Promise.resolve()
              },
            },
          ]}
          extra="将在 GitHub 远程创建此分支"
        >
          <Input placeholder="如：feature/login-api" />
        </Form.Item>

        <Form.Item
          label="来源分支/提交"
          name="fromRef"
          rules={[{ required: true, message: '请选择来源分支' }]}
          extra="新分支将从此分支的最新 commit 创建"
        >
          <Select
            showSearch
            optionFilterProp="value"
            placeholder="选择来源分支"
            options={sourceOptions}
          />
        </Form.Item>

        <Descriptions column={1} size="small" style={{ marginBottom: 12 }}>
          <Descriptions.Item label="提示">
            <Text type="secondary" style={{ fontSize: 12 }}>
              ⚠️ 此操作将在 GitHub 远程创建真实分支，使用幂等键防重复创建。
              <br />
              创建成功后可在远程分支列表中看到新分支，并将其设为项目默认基准分支。
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </Form>
    </Modal>
  )
}
