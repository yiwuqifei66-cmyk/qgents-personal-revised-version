import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Form, Input, Modal, Select, Spin, Switch, Tag, Typography } from 'antd'
import { githubApi } from '@/api'
import { formatApiError } from '@/utils/formatApiError'
import {
  GITHUB_REPO_DESC_MAX,
  GITHUB_REPO_NAME_MAX,
  GITHUB_REPO_NAME_REGEX,
  PROJECT_REPO_DISPLAY_NAME_MAX,
  type GithubInstallation,
  type ProjectRepositoryCreateNewInput,
  type ProjectRepositoryCreateNewResponse,
} from '@/types/github'

const { Text } = Typography

export interface CreateNewRepositoryModalProps {
  open: boolean
  projectId: string
  installations: GithubInstallation[]
  /** 团队 Installation 是否仍在加载中 */
  installationsLoading?: boolean
  onClose: () => void
  onSuccess: (resp: ProjectRepositoryCreateNewResponse) => void
}

interface FormValues {
  name: string
  description?: string
  isPrivate: boolean
  installationId: string
  displayName?: string
}

/**
 * 项目内"新建仓库并绑定"弹窗（接口文档 v2.0.19 §44）
 *
 * 【权限】TEAM_OWNER；非 Team Owner 调用由后端返回 403，前端只做可见性提示。
 * 【幂等】每次打开弹窗生成一次 UUID 作为 Idempotency-Key，多次提交沿用同一 key，
 *       关闭弹窗时清空；避免连点导致 GitHub 端创建多个仓库。
 * 【异步】后端可能返回 201（READY，已建好）或 202（CREATING，需要轮询/SSE）。
 */
export default function CreateNewRepositoryModal({
  open,
  projectId,
  installations,
  installationsLoading,
  onClose,
  onSuccess,
}: CreateNewRepositoryModalProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string>('')

  const activeInstallations = useMemo(
    () => installations.filter((it) => it.status === 'ACTIVE'),
    [installations],
  )

  // 单选场景（只有 1 个 ACTIVE Installation）：直接把值写入 initialValues，
  // 比 useEffect + setFieldValue 稳定，不会因组件重建导致写入丢失
  const onlyInstallation = activeInstallations.length === 1 ? activeInstallations[0] : null
  const formInitialValues = useMemo<Partial<FormValues>>(() => ({
    isPrivate: true,
    installationId: onlyInstallation ? onlyInstallation.id : undefined,
  }), [onlyInstallation])

  // 弹窗打开时生成幂等键；关闭时清空并重置表单
  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID())
    } else {
      setIdempotencyKey('')
      form.resetFields()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 多选/加载异步场景的兜底：
  // - 打开弹窗时 activeInstallations 未加载（空数组），加载完成后自动选中第一个
  // - 当前值不在候选列表中（列表变化导致旧值失效）时重新选中第一个
  useEffect(() => {
    if (!open) return
    const firstId = activeInstallations[0]?.id
    if (!firstId) return
    const current = form.getFieldValue('installationId')
    const candidateIds = new Set(activeInstallations.map((it) => it.id))
    if (!current || !candidateIds.has(current)) {
      form.setFieldValue('installationId', firstId)
    }
  }, [open, activeInstallations])

  const showInstallationSelect = activeInstallations.length > 1
  const installReady = !installationsLoading && activeInstallations.length > 0

  async function handleSubmit() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    if (!idempotencyKey) {
      message.error('操作不可重复提交，请重新打开弹窗')
      return
    }
    if (!values.installationId) {
      message.error('请选择 GitHub Installation')
      return
    }

    const input: ProjectRepositoryCreateNewInput = {
      name: values.name.trim(),
      installationId: values.installationId,
      private: values.isPrivate,
    }
    if (values.description && values.description.trim()) {
      input.description = values.description.trim()
    }
    if (values.displayName && values.displayName.trim()) {
      input.displayName = values.displayName.trim()
    }

    setSubmitting(true)
    try {
      const resp = await githubApi.createNewProjectRepository(projectId, input, idempotencyKey)
      if (resp.status === 'FAILED') {
        message.error(resp.failureReason || '仓库创建失败')
        return
      }
      if (resp.status === 'CREATING') {
        message.success('仓库正在创建中，稍后列表会自动刷新')
      } else {
        message.success('仓库创建成功')
      }
      onSuccess(resp)
      onClose()
    } catch (error) {
      // 后端 422 PROJECT_REPOSITORY_SOURCE_CONFLICT / 403 TEAM_OWNER_REQUIRED 等友好提示
      const text = formatApiError(error)
      if (text.includes('PROJECT_REPOSITORY_SOURCE_CONFLICT')) {
        message.error('仓库来源冲突：已绑定仓库和新建仓库不能同时提交')
      } else if (text.includes('TEAM_OWNER')) {
        message.error('无建仓权限：仅团队所有者（TEAM_OWNER）可新建仓库')
      } else {
        message.error(text)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="新建仓库并绑定"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="新建仓库"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
      maskClosable={false}
      okButtonProps={{ disabled: !idempotencyKey || !installReady }}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        preserve={false}
        requiredMark
        initialValues={formInitialValues}
      >
        <Form.Item
          name="name"
          label="仓库名称"
          rules={[
            { required: true, message: '请输入仓库名称' },
            {
              max: GITHUB_REPO_NAME_MAX,
              message: `仓库名最长 ${GITHUB_REPO_NAME_MAX} 个字符`,
            },
            {
              pattern: GITHUB_REPO_NAME_REGEX,
              message: '仓库名只能包含字母、数字、下划线、连字符、点',
            },
          ]}
          tooltip="按 GitHub 仓库名规则：字母/数字/下划线/连字符/点"
        >
          <Input placeholder="如：demo-service" autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="description"
          label="仓库描述"
          rules={[{ max: GITHUB_REPO_DESC_MAX, message: `描述最长 ${GITHUB_REPO_DESC_MAX} 个字符` }]}
        >
          <Input.TextArea rows={3} placeholder="可选，仓库简介" />
        </Form.Item>

        <Form.Item name="isPrivate" label="是否私有" valuePropName="checked">
          <Switch checkedChildren="私有" unCheckedChildren="公开" />
        </Form.Item>

        <Form.Item
          name="installationId"
          label="GitHub Installation"
          rules={showInstallationSelect
            ? [{ required: true, message: '请选择 GitHub Installation' }]
            : []}
          tooltip="团队授权的 GitHub App 安装；新建仓库将归属该 Installation 的账号或组织"
        >
          {installationsLoading ? (
            <div style={{ padding: '4px 0' }}>
              <Spin size="small" />
              <Text type="secondary" style={{ marginLeft: 8 }}>
                正在加载团队 Installation…
              </Text>
            </div>
          ) : activeInstallations.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="团队暂无可用的 ACTIVE GitHub Installation"
              description="请先在团队设置中安装 GitHub App 并授权至少一个仓库范围，才能新建仓库。"
              style={{ marginBottom: 0 }}
            />
          ) : onlyInstallation ? (
            // 只有一个 ACTIVE Installation：直接显示 Tag 文本而不是 disabled Select，
            // 防止 AntD Select disabled + required 校验组合带来的回填/可见性坑
            <Tag
              color="processing"
              style={{ padding: '4px 12px', fontSize: 14, lineHeight: '24px', margin: 0 }}
            >
              {onlyInstallation.accountLogin}
              （{onlyInstallation.accountType === 'ORGANIZATION' ? '组织' : '用户'}）
              <Text type="secondary" style={{ marginLeft: 8 }}>
                · 团队仅一个 Installation，已自动绑定
              </Text>
            </Tag>
          ) : (
            <Select
              placeholder="选择 Installation"
              loading={installationsLoading}
              options={activeInstallations.map((it) => ({
                value: it.id,
                label: `${it.accountLogin}（${it.accountType === 'ORGANIZATION' ? '组织' : '用户'}）`,
              }))}
              notFoundContent="团队暂无可用的 ACTIVE Installation，请先安装 GitHub App"
            />
          )}
        </Form.Item>

        <Form.Item
          name="displayName"
          label="项目内显示名称"
          rules={[{ max: PROJECT_REPO_DISPLAY_NAME_MAX, message: `显示名最长 ${PROJECT_REPO_DISPLAY_NAME_MAX} 个字符` }]}
          tooltip="可选；不填则使用仓库名称"
        >
          <Input placeholder="可选，缺省取仓库名" />
        </Form.Item>

        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          创建后后端会自动初始化 README 提交，真实默认分支（如 main）会显示在仓库列表中。
          如果状态为「创建中」，列表稍后会自动刷新。
        </Text>
      </Form>
    </Modal>
  )
}
