import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Form, Select, App, Typography, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { githubApi } from '@/api'
import { useCreateDryRun, useTasks, useTestsets } from '@/hooks'
import { queryKeys } from '@/query'
import type { DryRunReport, ProjectBoundRepository } from '@/types'
import type { CreateDryRunPayload } from '@/types/testset'
import type { TaskListItem } from '@/types/task-model'

const { Text } = Typography

interface DryRunCreateModalProps {
  open: boolean
  projectId: string
  repositories: ProjectBoundRepository[]
  onClose: () => void
  onCreated?: (report: DryRunReport) => void
}

/**
 * Dry Run 创建表单 —— 手动触发 MR 前合并预演
 * 文档：Dry Run前后端执行计划 §5.1
 * 表单字段：仓库、关联 Task（下拉选择，自动填充源分支）、源引用、目标分支、测试集（多选）
 */
export default function DryRunCreateModal({
  open,
  projectId,
  repositories,
  onClose,
  onCreated,
}: DryRunCreateModalProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<CreateDryRunPayload & { testsetIds: string[] }>()
  const [repoId, setRepoId] = useState<string>('')
  const [selectedTask, setSelectedTask] = useState<TaskListItem | null>(null)

  // 加载项目任务列表
  const { data: taskPage } = useTasks(projectId)

  // 关联 Task 可选状态白名单（与 TestRunCreateModal 保持一致）
  const TASK_SELECTABLE_STATUSES: readonly string[] = [
    'WAITING_DIFF_CONFIRMATION',
    'DIFF_REJECTED',
    'WAITING_PREFLIGHT',
    'DELIVERING',
    'DELIVERY_FAILED',
    'SUCCEEDED',
  ]

  const tasks = useMemo(
    () => (taskPage?.data ?? []).filter((t) => TASK_SELECTABLE_STATUSES.includes(t.status)),
    [taskPage],
  )

  // 加载已启用的测试集（供用户手动选择）
  const { data: allTestsets = [] } = useTestsets(projectId, {})
  const repoTestsets = useMemo(() => {
    if (!repoId) return []
    return allTestsets.filter((t) => t.repositoryId === repoId && t.status === 'ENABLED')
  }, [allTestsets, repoId])

  // 稳定的查询参数引用，避免每次渲染都生成新 queryKey 导致无限重获取
  const branchFilters = useMemo(() => ({ limit: 50 }), [])

  // 加载当前仓库的远程分支列表（作为源引用/目标分支候选）
  const { data: remoteBranches = [] } = useQuery({
    queryKey: queryKeys.remoteBranches.list(projectId, repoId, branchFilters),
    queryFn: () => githubApi.listRemoteBranches(projectId, repoId, branchFilters),
    enabled: Boolean(projectId && repoId),
  })

  const createMutation = useCreateDryRun(projectId)

  const targetBranchOptions = useMemo(() => remoteBranches.map((b) => ({
    value: b.name,
    label: (
      <span>
        {b.name}
        {b.isProjectDefault ? <Tag color="blue" style={{ marginLeft: 4 }}>项目默认</Tag> : null}
        {b.isGithubDefault ? <Tag color="gray" style={{ marginLeft: 4 }}>GitHub 默认</Tag> : null}
      </span>
    ),
  })), [remoteBranches])

  const sourceRefOptions = useMemo(() => remoteBranches.map((b) => ({
    value: b.name,
    label: (
      <span>
        {b.name}
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {b.headCommit ? b.headCommit.slice(0, 7) : ''}
        </Text>
      </span>
    ),
  })), [remoteBranches])

  const taskOptions = useMemo(() => tasks.map((t) => ({
    value: t.id,
    label: (
      <span>
        <Text strong>{t.title}</Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          #{t.displayCode} · {t.status}
        </Text>
      </span>
    ),
  })), [tasks])

  const testsetOptions = useMemo(() => repoTestsets.map((t) => ({
    value: t.id,
    label: (
      <span>
        {t.name}
        <Tag color="blue" style={{ marginLeft: 4 }}>
          {t.scopeTags.length > 0 ? t.scopeTags.join(', ') : '无标签'}
        </Tag>
      </span>
    ),
  })), [repoTestsets])

  // 表单初始化：当仓库变化时，自动选中项目默认分支作为目标
  useEffect(() => {
    if (open && repositories.length > 0 && !repoId) {
      setRepoId(repositories[0].id)
    }
  }, [open, repositories, repoId])

  useEffect(() => {
    if (open && repoId && remoteBranches.length > 0) {
      const defaultBranch = remoteBranches.find((b) => b.isProjectDefault)
      if (defaultBranch) {
        form.setFieldsValue({ targetBranch: defaultBranch.name })
      }
    }
  }, [open, repoId, remoteBranches, form])

  // 仓库变化时清空已选测试集和 Task
  const handleRepoChange = useCallback((value: string) => {
    setRepoId(value)
    form.setFieldsValue({ testsetIds: [], taskId: undefined })
    setSelectedTask(null)
  }, [form])

  // Task 选择变化时，自动填充源分支
  const handleTaskChange = useCallback((taskId: string | undefined) => {
    if (!taskId) {
      setSelectedTask(null)
      form.setFieldsValue({ taskId: undefined, sourceRef: undefined })
      return
    }
    const task = tasks.find((t) => t.id === taskId)
    if (!task) {
      setSelectedTask(null)
      return
    }
    setSelectedTask(task)
    // 根据当前选中的仓库匹配任务中的 sourceBranch
    const matchedRepo = task.repositories.find((r) => r.repositoryId === repoId)
    if (matchedRepo?.sourceBranch) {
      form.setFieldsValue({ sourceRef: matchedRepo.sourceBranch })
    }
  }, [tasks, repoId, form])

  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      // 空仓库约束（§3.4）：仓库未初始化/无远程分支时禁止提交
      const boundRepo = repositories.find((r) => r.id === values.repositoryId)
      if (boundRepo && !boundRepo.defaultBranch) {
        message.error('仓库尚未初始化（defaultBranch 为空），请先初始化仓库并设置项目默认基准分支')
        return
      }
      if (remoteBranches.length === 0) {
        message.error('当前仓库暂无远程分支，无法选择 Dry Run 目标分支；请先初始化仓库')
        return
      }
      const payload: CreateDryRunPayload = {
        repositoryId: values.repositoryId,
        sourceRef: values.sourceRef,
        targetBranch: values.targetBranch,
      }
      if (values.taskId) {
        payload.taskId = values.taskId
      }
      if (values.testsetIds && values.testsetIds.length > 0) {
        payload.testsetIds = values.testsetIds
      }

      createMutation.mutate(payload, {
        onSuccess: (report) => {
          message.success(`Dry Run 已创建（状态: ${report.status}）`)
          onCreated?.(report)
          handleClose()
        },
        onError: (err) => {
          message.error(`创建失败: ${err.message}`)
        },
      })
    } catch {
      // 表单验证失败
    }
  }, [form, createMutation, message, onCreated, repositories, remoteBranches])

  function handleClose() {
    form.resetFields()
    setSelectedTask(null)
    onClose()
  }

  return (
    <Modal
      title="新建 Dry Run"
      open={open}
      onOk={() => void handleOk()}
      onCancel={handleClose}
      confirmLoading={createMutation.isPending}
      destroyOnHidden
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ repositoryId: repoId }}
      >
        <Form.Item
          label="仓库"
          name="repositoryId"
          rules={[{ required: true, message: '请选择仓库' }]}
        >
          <Select
            placeholder="选择仓库"
            showSearch
            optionFilterProp="label"
            onChange={handleRepoChange}
          >
            {repositories.map((r) => (
              <Select.Option key={r.id} value={r.id}>
                {r.displayName || r.fullName}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label="关联 Task（可选）"
          name="taskId"
          extra="选择后将自动填充源分支，也可手动修改"
        >
          <Select
            placeholder="选择项目中的 Task"
            showSearch
            optionFilterProp="label"
            allowClear
            options={taskOptions}
            onChange={handleTaskChange}
            loading={tasks.length === 0}
          />
        </Form.Item>

        <Form.Item
          label="源引用"
          name="sourceRef"
          rules={[{ required: true, message: '请选择源分支或提交引用' }]}
          extra={selectedTask ? `已根据 Task 自动填充，可手动修改` : 'Dry Run 将从此分支/提交合并到目标分支'}
        >
          <Select
            placeholder="选择源分支"
            showSearch
            optionFilterProp="value"
            options={sourceRefOptions}
            loading={Boolean(repoId) && remoteBranches.length === 0}
          />
        </Form.Item>

        <Form.Item
          label="目标分支"
          name="targetBranch"
          rules={[{ required: true, message: '请选择目标分支' }]}
          extra="服务端会自动加载该分支绑定的必选 Testset"
        >
          <Select
            placeholder="选择目标分支"
            showSearch
            optionFilterProp="value"
            options={targetBranchOptions}
            loading={Boolean(repoId) && remoteBranches.length === 0}
          />
        </Form.Item>

        <Form.Item
          label="绑定测试集（可选）"
          name="testsetIds"
          extra={`当前仓库已启用测试集：${repoTestsets.length} 个；可多选，不选则由服务端按门禁自动加载`}
        >
          <Select
            mode="multiple"
            placeholder="选择要运行的测试集（可多选）"
            showSearch
            optionFilterProp="label"
            options={testsetOptions}
            disabled={!repoId || repoTestsets.length === 0}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ⚠️ Dry Run 创建后立即返回 QUEUED 状态，不代表已通过。合并预演和 Testset 执行将在后台完成。
          </Text>
        </Form.Item>
      </Form>
    </Modal>
  )
}
