import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Form, Select, Input, App, Typography, Tag } from 'antd'
import { useTestsets, useCreateTestRun, useTasks } from '@/hooks'
import type { ProjectBoundRepository, Testset } from '@/types'
import type { CreateTestRunPayload, TestRun } from '@/types/testset'

const { Text } = Typography

interface TestRunCreateModalProps {
  open: boolean
  projectId: string
  repositories: ProjectBoundRepository[]
  onClose: () => void
  onCreated?: (run: TestRun) => void
}

/**
 * Test Run 创建表单 —— 用户主动发起诊断测试
 * 文档：接口文档 §12.4
 * 表单字段：仓库、Testset 列表、源引用、关联 Task（可选）
 *
 * 与 Dry Run 的区别：
 * - Test Run 由用户指定 testsetIds
 * - Dry Run 由服务端按目标分支门禁自动加载 Testset
 */
export default function TestRunCreateModal({
  open,
  projectId,
  repositories,
  onClose,
  onCreated,
}: TestRunCreateModalProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<CreateTestRunPayload & { testsetIds: string[] }>()
  const [repoId, setRepoId] = useState<string>('')
  const [selectedTestsets, setSelectedTestsets] = useState<Testset[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>()

  // 稳定的空 filters 引用，避免每次渲染都生成新 queryKey
  const emptyFilters = useMemo(() => ({}), [])

  const { data: allTestsets = [] } = useTestsets(projectId, emptyFilters)

  // 根据仓库 ID 加载任务列表
  const taskFilters = useMemo(() => ({
    repositoryId: repoId || undefined,
    limit: 50,
  }), [repoId])

  const { data: tasksData, isLoading: tasksLoading } = useTasks(
    projectId,
    repoId ? taskFilters : {}
  )
  const taskList = tasksData?.data || []

  // 过滤出当前仓库的 Testset
  const repoTestsets = useMemo(() => {
    if (!repoId) return []
    return allTestsets.filter((t) => t.repositoryId === repoId && t.status === 'ENABLED')
  }, [allTestsets, repoId])

  const createMutation = useCreateTestRun(projectId)

  const testsetOptions = useMemo(() => repoTestsets.map((t) => ({
    value: t.id,
    label: (
      <span>
        {t.name}
        <Tag color="blue" style={{ marginLeft: 4 }}>{t.scopeTags.length > 0 ? t.scopeTags.join(', ') : '无标签'}</Tag>
      </span>
    ),
  })), [repoTestsets])

  // 关联 Task 可选状态白名单（仅这些状态的任务已拥有可用分支）
  const TASK_SELECTABLE_STATUSES: readonly string[] = [
    'WAITING_DIFF_CONFIRMATION',
    'DIFF_REJECTED',
    'WAITING_PREFLIGHT',
    'DELIVERING',
    'DELIVERY_FAILED',
    'SUCCEEDED',
  ]

  const taskStatusColor: Record<string, string> = {
    WAITING_DIFF_CONFIRMATION: 'warning',
    WAITING_PREFLIGHT: 'warning',
    DIFF_REJECTED: 'error',
    DELIVERING: 'processing',
    DELIVERY_FAILED: 'error',
    SUCCEEDED: 'success',
  }

  const selectableTasks = useMemo(
    () => taskList.filter((task) => TASK_SELECTABLE_STATUSES.includes(task.status)),
    [taskList],
  )

  const taskOptions = useMemo(() => selectableTasks.map((task) => ({
    value: task.id,
    label: (
      <span>
        <Text strong>{task.displayCode}</Text>
        <Text type="secondary" style={{ marginLeft: 8 }}>{task.title}</Text>
        <Tag
          color={taskStatusColor[task.status] ?? 'default'}
          style={{ marginLeft: 8 }}
        >
          {task.status}
        </Tag>
      </span>
    ),
  })), [selectableTasks])

  // 表单初始化
  useEffect(() => {
    if (open && repositories.length > 0 && !repoId) {
      setRepoId(repositories[0].id)
    }
  }, [open, repositories, repoId])

  // 切换仓库时清空已选 Task
  useEffect(() => {
    setSelectedTaskId(undefined)
    if (repoId) {
      form.setFieldsValue({ taskId: undefined })
    }
  }, [repoId])

  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      const payload: CreateTestRunPayload = {
        repositoryId: values.repositoryId,
        testsetIds: values.testsetIds,
      }
      // taskId 与 ref 互斥：后端要求二选一
      if (values.taskId) {
        payload.taskId = values.taskId
      } else if (values.ref) {
        payload.ref = values.ref
      } else {
        // 都未填写时，自动使用默认分支（不传 ref，后端会使用默认分支）
      }

      createMutation.mutate(payload, {
        onSuccess: (run) => {
          message.success(`Test Run 已创建（状态: ${run.status}）`)
          onCreated?.(run)
          handleClose()
        },
        onError: (err) => {
          message.error(`创建失败: ${err.message}`)
        },
      })
    } catch {
      // 表单验证失败
    }
  }, [form, createMutation, message, onCreated])

  function handleClose() {
    form.resetFields()
    setSelectedTestsets([])
    setSelectedTaskId(undefined)
    onClose()
  }

  // 获取当前选中任务的分支信息
  const selectedTaskBranch = useMemo(() => {
    if (!selectedTaskId) return null
    const task = selectableTasks.find((t) => t.id === selectedTaskId)
    return task?.repositories?.[0]?.sourceBranch || null
  }, [selectedTaskId, selectableTasks])

  return (
    <Modal
      title="运行测试"
      open={open}
      onOk={() => void handleOk()}
      onCancel={handleClose}
      confirmLoading={createMutation.isPending}
      destroyOnHidden
      width={600}
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
            onChange={(value) => {
              setRepoId(value)
              form.setFieldsValue({ testsetIds: [], taskId: undefined, ref: undefined })
              setSelectedTestsets([])
              setSelectedTaskId(undefined)
            }}
          >
            {repositories.map((r) => (
              <Select.Option key={r.id} value={r.id}>
                {r.displayName || r.fullName}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label="测试集"
          name="testsetIds"
          rules={[{ required: true, message: '请选择至少一个测试集', type: 'array' }]}
          extra={`已启用的测试集：${repoTestsets.length} 个`}
        >
          <Select
            mode="multiple"
            placeholder="选择要运行的测试集"
            showSearch
            optionFilterProp="label"
            options={testsetOptions}
            disabled={!repoId}
            onChange={(values: string[]) => {
              const selected = repoTestsets.filter((t) => values.includes(t.id))
              setSelectedTestsets(selected)
            }}
          />
        </Form.Item>

        {selectedTestsets.length > 0 ? (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f7fa', borderRadius: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              选中 {selectedTestsets.length} 个测试集：
            </Text>
            <div style={{ marginTop: 4 }}>
              {selectedTestsets.map((t) => (
                <Tag key={t.id} color="blue" style={{ marginBottom: 4 }}>
                  {t.name}（超时: {t.timeoutSeconds}s）
                </Tag>
              ))}
            </div>
          </div>
        ) : null}

        <Form.Item
          label="关联 Task（可选）"
          name="taskId"
          extra={
            selectedTaskBranch
              ? `将自动使用任务分支: ${selectedTaskBranch}`
              : '选择后将使用该 Task 的分支进行测试'
          }
        >
          <Select
            placeholder={repoId ? '选择关联的 Task（可选）' : '请先选择仓库'}
            showSearch
            optionFilterProp="label"
            loading={tasksLoading}
            options={taskOptions}
            disabled={!repoId}
            allowClear
            onChange={(value: string | undefined) => {
              setSelectedTaskId(value)
              // 选择 Task 后清空 ref 字段
              if (value) {
                form.setFieldsValue({ ref: undefined })
              }
            }}
            notFoundContent={repoId && !tasksLoading ? '该仓库暂无活跃任务' : undefined}
          />
        </Form.Item>

        {!selectedTaskId && (
          <Form.Item
            label="源引用"
            name="ref"
            extra="分支名或 commit SHA，留空使用项目默认分支"
          >
            <Input placeholder="如: main 或 abc1234" allowClear />
          </Form.Item>
        )}

        <Form.Item style={{ marginBottom: 0 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            💡 Test Run 由用户手动发起。选择 Task 时会自动使用该任务分支；不选择 Task 时可手动指定源引用。
          </Text>
        </Form.Item>
      </Form>
    </Modal>
  )
}
