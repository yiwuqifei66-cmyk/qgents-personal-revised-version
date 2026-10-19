import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Form, Input, message, Modal, Select, Space, Spin, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { ApiError, groupApi } from '@/api'
import { githubApi } from '@/api/github'
import { useCreateTask } from '@/hooks/task-model'
import { queryKeys } from '@/query/queryKeys'
import { PATHS } from '@/routes/paths'
import type { TaskCreateInput } from '@/types/task-model'
import type { RemoteBranch } from '@/types/github'

export interface TaskTriggerModalProps {
  open: boolean
  projectId: string
  groupId: string
  initialInstruction: string
  onClose: () => void
}
interface TaskTriggerFormValues {
  title: string
  requirement: string
  repositoryIds: string[]
  /** repositoryId → 基线分支名；某仓库未选时不出现（后端用该仓库默认分支兜底） */
  baseRefs: Record<string, string>
}

function errorMessage(error: Error | null): string | null {
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.status === 403) return '暂无权限从该需求群创建任务。'
    if (error.status === 409) return '任务状态或并发请求发生冲突，请刷新后重试。'
    if (error.status === 422) return '任务字段未通过校验，请检查后重试。'
  }
  return '任务创建失败，请稍后重试。'
}

/**
 * 把远程分支列表渲染为 Select 选项，并标注「项目默认 / GitHub 默认」。
 */
function branchOptions(branches: RemoteBranch[]) {
  return branches
    .slice()
    .sort((a, b) => {
      // 项目默认 → GitHub 默认 → 其它字母序
      const rankA = (a.isProjectDefault ? 0 : 2) + (a.isGithubDefault ? 0 : 1)
      const rankB = (b.isProjectDefault ? 0 : 2) + (b.isGithubDefault ? 0 : 1)
      if (rankA !== rankB) return rankA - rankB
      return a.name.localeCompare(b.name)
    })
    .map((branch) => ({
      value: branch.name,
      label: (
        <span>
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{branch.name}</span>
          {branch.isProjectDefault ? (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#1677ff' }}>项目默认</span>
          ) : null}
          {branch.isGithubDefault && !branch.isProjectDefault ? (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#8c8c8c' }}>GitHub 默认</span>
          ) : null}
          {branch.headCommit ? (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#8c8c8c' }}>
              {branch.headCommit.slice(0, 7)}
            </span>
          ) : null}
        </span>
      ),
    }))
}

export function TaskTriggerModal({ open, projectId, groupId, initialInstruction, onClose }: TaskTriggerModalProps) {
  const [form] = Form.useForm<TaskTriggerFormValues>()
  const navigate = useNavigate()
  const mutation = useCreateTask(projectId)
  const repositoriesQuery = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId && open),
  })
  // 复用 ChatPanel 的缓存键，避免重复请求；展示需求群时优先用 title（需求群名称），仅在加载或查不到时回落为 groupId。
  const groupsQuery = useQuery({
    queryKey: ['groups', projectId],
    queryFn: () => groupApi.listByProject(projectId),
    enabled: Boolean(projectId && open),
  })
  const { reset: resetMutation } = mutation
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitLockRef = useRef(false)
  const failureMessage = errorMessage(mutation.error)
  const repositories = repositoriesQuery.data ?? []
  const repositoryOptions = repositories.map((repository) => ({
    value: repository.id,
    label: repository.fullName || repository.repositoryId || '暂无',
  }))

  const repositoryIds = Form.useWatch('repositoryIds', form) ?? []

  // 为每个已选中的仓库并行拉取其真实 GitHub 远程分支列表（各仓库独立，支持不同基准分支）。
  const branchQueries = useQueries({
    queries: repositoryIds.map((repositoryId: string) => ({
      queryKey: queryKeys.remoteBranches.list(projectId, repositoryId, {}),
      queryFn: () => githubApi.listRemoteBranches(projectId, repositoryId, {}),
      enabled: Boolean(projectId && repositoryId && open),
    })),
  })
  const repositoryIdsKey = repositoryIds.join(',')
  const branchesByRepository = useMemo(() => {
    const map = new Map<string, RemoteBranch[]>()
    repositoryIds.forEach((repositoryId: string, index: number) => {
      const data = branchQueries[index]?.data
      if (data) map.set(repositoryId, data)
    })
    return map
    // repositoryIdsKey 稳定表达仓库集合，避免 useWatch 每次 render 的新数组引用触发无谓重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryIdsKey, branchQueries])

  // 需求群名称：已加载且命中时显示 title，否则保持只读回退为 groupId，保证抽屉中始终可见。
  const requirementGroupName =
    groupsQuery.data?.find((item) => item.id === groupId)?.title?.trim() || groupId
  const requirementGroupLoading = groupsQuery.isLoading

  // 仓库多选变化时：为新仓库默认选中「项目默认分支」或第一个分支；移除的仓库清理其分支选择。
  function handleRepositoryChange(nextRepositoryIds: string[]): void {
    form.setFieldValue('repositoryIds', nextRepositoryIds)
    const nextBaseRefs: Record<string, string> = { ...(form.getFieldValue('baseRefs') ?? {}) }
    for (const repositoryId of Object.keys(nextBaseRefs)) {
      if (!nextRepositoryIds.includes(repositoryId)) {
        delete nextBaseRefs[repositoryId]
      }
    }
    // 新仓库的默认分支（若未选过），待远程分支拉到后再精确对齐
    for (const repositoryId of nextRepositoryIds) {
      if (nextBaseRefs[repositoryId]) continue
      const repository = repositories.find((item) => item.id === repositoryId)
      if (repository?.defaultBranch) nextBaseRefs[repositoryId] = repository.defaultBranch
    }
    form.setFieldValue('baseRefs', nextBaseRefs)
  }

  // 远程分支列表拉取后：若当前选中的分支不在返回列表里（或仓库刚选），
  // 默认对齐到「项目默认分支」或第一个分支。
  useEffect(() => {
    const currentBaseRefs: Record<string, string> = { ...(form.getFieldValue('baseRefs') ?? {}) }
    let changed = false
    for (const repositoryId of repositoryIds) {
      const branches = branchesByRepository.get(repositoryId)
      if (!branches || branches.length === 0) continue
      const current = currentBaseRefs[repositoryId]
      const names = new Set(branches.map((b) => b.name))
      if (!current || !names.has(current)) {
        const picked =
          branches.find((b) => b.isProjectDefault) ??
          branches.find((b) => b.isGithubDefault) ??
          branches[0]
        if (picked) {
          currentBaseRefs[repositoryId] = picked.name
          changed = true
        }
      }
    }
    if (changed) form.setFieldValue('baseRefs', currentBaseRefs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchesByRepository, form])

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({ title: '', requirement: initialInstruction, repositoryIds: [], baseRefs: {} })
    resetMutation()
    submitLockRef.current = false
    setIsSubmitting(false)
  }, [form, initialInstruction, open, resetMutation])

  async function handleFinish(values: TaskTriggerFormValues) {
    if (submitLockRef.current || repositories.length === 0) return
    const selectedRepos = repositories.filter((r) => values.repositoryIds.includes(r.id))
    const repositoryRefs = selectedRepos.map((repository) => ({
      repositoryId: repository.id,
      baseRef: (values.baseRefs[repository.id] ?? repository.defaultBranch ?? '').trim(),
    }))
    if (repositoryRefs.some((item) => !item.baseRef)) {
      message.error('请为每个已选仓库选择基准分支')
      return
    }
    // 选中仓库中如果存在未初始化仓库，提示并阻止提交
    const uninitializedRepos = selectedRepos.filter((r) => !r.defaultBranch)
    if (uninitializedRepos.length > 0) {
      message.error(
        `仓库 ${uninitializedRepos.map((r) => r.fullName).join(', ')} 尚未初始化，请先在 GitHub 端初始化并设置项目默认基准分支`,
      )
      return
    }
    submitLockRef.current = true
    setIsSubmitting(true)
    const input: TaskCreateInput = {
      requirementGroupId: groupId,
      title: values.title.trim(),
      requirement: values.requirement.trim(),
      repositoryIds: values.repositoryIds,
      repositoryRefs,
    }
    try {
      const task = await mutation.mutateAsync(input)
      onClose()
      message.success('任务已提交至云端，可以安全离开页面')
      navigate(`${PATHS.projectTasks(projectId)}?taskId=${encodeURIComponent(task.id)}`)
    } catch {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  const pending = isSubmitting || mutation.isPending
  const repositoryUnavailable = !repositoriesQuery.isLoading && repositories.length === 0
  const anyBranchLoading = branchQueries.some((q) => q.isLoading)

  return (
    <Modal
      open={open}
      title="创建任务"
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="创建任务"
      cancelText="取消"
      confirmLoading={pending}
      okButtonProps={{ disabled: pending || repositoriesQuery.isLoading || repositoryUnavailable || anyBranchLoading }}
      maskClosable={!pending}
      closable={!pending}
      width={720}
    >
      {failureMessage ? <Alert role="alert" type="error" showIcon message={failureMessage} /> : null}
      {repositoriesQuery.isError ? <Alert role="alert" type="error" showIcon message="项目仓库加载失败，请稍后重试。" /> : null}
      {repositoryUnavailable && !repositoriesQuery.isError ? <Alert type="info" showIcon message="当前项目暂无可用仓库，无法创建任务。" /> : null}
      <Form<TaskTriggerFormValues>
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        disabled={pending || repositoryUnavailable}
      >
        <Form.Item label="需求群">
          <Spin size="small" spinning={requirementGroupLoading}>
            <Input value={requirementGroupName} readOnly />
          </Spin>
        </Form.Item>
        <Form.Item label="任务标题" name="title" rules={[{ required: true, whitespace: true, message: '请输入任务标题' }]}>
          <Input placeholder="请输入任务标题" />
        </Form.Item>
        <Form.Item label="需求说明" name="requirement" rules={[{ required: true, whitespace: true, message: '请输入需求说明' }]}>
          <Input.TextArea rows={5} placeholder="描述希望交付的任务" />
        </Form.Item>
        <Form.Item label="仓库" name="repositoryIds" rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个仓库' }]}>
          <Select mode="multiple" options={repositoryOptions} placeholder="请选择仓库" onChange={handleRepositoryChange} />
        </Form.Item>
        <Form.Item label="基准分支（每个仓库独立选择）" required>
          {repositoryIds.length === 0 ? (
            <Alert type="info" showIcon message="请先选择仓库，将展示每个仓库各自的远程分支" />
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {repositoryIds.map((repositoryId: string, index: number) => {
                const repository = repositories.find((item) => item.id === repositoryId)
                const branchQuery = branchQueries[index]
                const options = branchOptions(branchesByRepository.get(repositoryId) ?? [])
                return (
                  <div key={repositoryId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Tag style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {repository?.fullName || repositoryId}
                    </Tag>
                    <Form.Item
                      name={['baseRefs', repositoryId]}
                      noStyle
                      rules={[{ required: false }]}
                    >
                      <Select
                        style={{ flex: 1 }}
                        showSearch
                        optionFilterProp="value"
                        allowClear
                        placeholder={
                          branchQuery?.isLoading
                            ? '加载远程分支中…'
                            : '不选择则用该仓库默认分支'
                        }
                        loading={branchQuery?.isLoading}
                        options={options}
                        notFoundContent={
                          branchQuery?.isError
                            ? '远程分支加载失败，请稍后重试'
                            : branchQuery?.isLoading
                              ? null
                              : '该仓库暂无可用远程分支'
                        }
                      />
                    </Form.Item>
                  </div>
                )
              })}
              {anyBranchLoading ? (
                <Spin size="small" tip="正在加载各仓库远程分支…" />
              ) : (
                <Alert type="info" showIcon message="未选择基准分支的仓库将使用其项目默认分支；多仓库可各自不同。" />
              )}
            </Space>
          )}
        </Form.Item>
      </Form>
    </Modal>
  )
}

