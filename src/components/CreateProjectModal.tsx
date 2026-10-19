import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Form, Input, Select, Empty, Radio, Switch, Typography, Upload, Avatar, Button, Space } from 'antd'
import { CameraOutlined, UploadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { projectApi, teamApi, githubApi } from '@/api'
import { authApi } from '@/api/auth'
import { queryKeys } from '@/query/queryKeys'
import { useProjectAvatarUpload } from '@/hooks/useProjectAvatarUpload'
import { useAuth } from '@/context/AuthContext'
import { PATHS } from '@/routes/paths'
import { isGithubRepoBindable } from '@/types/github'
import {
  canUseInstallationForNewRepository,
  newRepositoryCreateErrorMessage,
  newRepositoryInstallationOptionLabel,
  personalRepositorySetupGuide,
  privateRepositoryAuthorizationMessage,
} from '@/utils/githubRepositoryAccess'
import { formatApiError } from '@/utils/formatApiError'
import type { CreateProjectPayload, NewProjectRepositoryInput } from '@/types'

const { Text, Link: TextLink } = Typography

interface CreateProjectFormValues extends Omit<CreateProjectPayload, 'teamId' | 'newRepository'> {
  newRepository?: NewProjectRepositoryInput
}

/**
 * 创建项目弹窗 —— 复用给团队详情页 / 个人中心
 *
 * 表单字段对齐接口文档 v1.1.8 §5.2：
 * - name 必填
 * - description 选填
 * 创建成功后跳转到项目总群（项目详情根路径，由 ProjectDetailLayout 落到总群）
 */
export function CreateProjectModal({
  teamId,
  open,
  onClose,
}: {
  teamId: string
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient=useQueryClient()
  const { user } = useAuth()
  const [form] = Form.useForm<CreateProjectFormValues>()
  const [repositoryMode, setRepositoryMode] = useState<'existing' | 'new'>('existing')
  // 项目头像（v2.0.6：创建时可选；项目创建成功后才直传并回写）
  const { uploading: avatarUploading, uploadAvatar } = useProjectAvatarUpload(teamId)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  // 提交失败文案（403 GITHUB_REPOSITORY_NOT_AUTHORIZED 等），展示在表单顶部，保持弹窗打开便于修正后重试
  const [submitError, setSubmitError] = useState<string | null>(null)
  // 预览 URL 生命周期：弹窗关闭/重选时释放，避免内存泄漏
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    }
  }, [avatarPreview])

  // 团队成员列表（作为「初始成员」多选候选）
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teams', teamId, 'members'],
    queryFn: () => teamApi.listMembers(teamId),
    enabled: !!teamId && open,
  })

  // 团队已授权 GitHub 仓库（创建时必选，用于一并绑定）
  const { data: teamRepos = [], isLoading: reposLoading } = useQuery({
    queryKey: ['teams', teamId, 'github', 'repositories'],
    queryFn: () => githubApi.listTeamRepositories(teamId),
    enabled: !!teamId && open,
  })
  // 安装列表：用于判断仓库对应 installation 是否 ACTIVE
  const { data: installations = [] } = useQuery({
    queryKey: ['teams', teamId, 'github', 'installations'],
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: !!teamId && open,
  })
  const { data: githubOAuth } = useQuery({
    queryKey: queryKeys.githubOAuth,
    queryFn: authApi.getGithubOAuthStatus,
    enabled: !!teamId && open,
    // §49.4：绑定返回后必须重新请求本接口决定是否解除置灰，不依赖本地缓存/回跳参数
    staleTime: 0,
  })
  // 仅列出可绑定的授权仓库（已授权、未归档、默认分支非空、安装 ACTIVE）
  const bindableRepos = teamRepos.filter((r) =>
    isGithubRepoBindable(r, installations.find((i) => i.id === r.installationId)),
  )
  const activeInstallations = installations.filter((installation) => installation.status === 'ACTIVE')
  const newRepositoryInstallations = activeInstallations.filter((installation) =>
    canUseInstallationForNewRepository(installation, githubOAuth),
  )
  const canCreateNewRepository = newRepositoryInstallations.length > 0
  const selectedInstallationId = Form.useWatch(['newRepository', 'installationId'], form) as string | undefined
  const selectedInstallation = activeInstallations.length === 1
    ? activeInstallations[0]
    : activeInstallations.find((installation) => installation.id === selectedInstallationId)
  const newRepositoryIsPrivate = (Form.useWatch(['newRepository', 'isPrivate'], form) as boolean | undefined) ?? true
  const privateRepositoryError = newRepositoryIsPrivate
    ? privateRepositoryAuthorizationMessage(selectedInstallation, githubOAuth)
    : null
  // §49.4：按后端 personalRepositorySetup 展示自动建仓引导（NOT_OWNER 时隐藏入口）
  const setupGuide = personalRepositorySetupGuide(githubOAuth)
  const hideAutoCreate = githubOAuth?.personalRepositorySetup === 'NOT_OWNER'
  useEffect(() => {
    if (hideAutoCreate && repositoryMode === 'new') setRepositoryMode('existing')
  }, [hideAutoCreate, repositoryMode])
  // §49.4：NEED_INSTALLATION 时提供「去安装 GitHub App」跳转（当前团队）
  const installMutation = useMutation({
    mutationFn: () => githubApi.createInstallation(teamId, 'WEB'),
    onSuccess: (result) => {
      if (result.installationUrl) window.location.assign(result.installationUrl)
    },
    onError: (err) => setSubmitError(err instanceof Error ? err.message : '获取安装链接失败'),
  })

  const createProject = useMutation({
    mutationFn: (payload: CreateProjectPayload) => projectApi.create(payload),
    // 跳转/头像上传统一在 onFinish 的 mutateAsync 后处理（头像需要先拿到 project.id）
  })

  // 弹窗打开时重置表单
  useEffect(() => {
    if (open) {
      form.resetFields()
      form.setFieldsValue({ newRepository: { isPrivate: true } })
      setRepositoryMode('existing')
      setAvatarFile(null)
      setAvatarPreview(null)
      setSubmitError(null)
    }
  }, [open, form])

  // 选择头像：仅暂存文件与本地预览，项目创建成功后才直传 OSS 并回写
  function handleAvatarSelect(file: File): boolean {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    return false
  }

  return (
    <Modal
      title="创建项目"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={createProject.isPending}
      okText="创建"
      cancelText="取消"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
          onFinish={async (values) => {
            const newRepository = values.newRepository
            if (repositoryMode === 'new' && !canCreateNewRepository) {
              form.setFields([{ name: ['newRepository', 'name'], errors: ['当前没有可用的自动建仓授权，请先绑定个人 GitHub，或让团队管理员完成组织 GitHub App 授权'] }])
              return
            }
            if (repositoryMode === 'new' && privateRepositoryError) {
              form.setFields([{ name: ['newRepository', 'isPrivate'], errors: [privateRepositoryError] }])
              return
            }
            try {
            // 先创建项目（拿到 project.id），再直传头像回写，最后跳转项目总群
            const project = await createProject.mutateAsync({
              teamId,
              name: values.name,
              description: values.description,
              memberIds: values.memberIds,
              repositoryIds: repositoryMode === 'existing' ? values.repositoryIds : undefined,
              newRepository: repositoryMode === 'new' && newRepository
                ? {
                    name: newRepository.name.trim(),
                    description: newRepository.description?.trim() || undefined,
                    isPrivate: newRepository.isPrivate ?? true,
                    installationId: activeInstallations.length === 1
                      ? undefined
                      : newRepository.installationId,
                    displayName: newRepository.displayName?.trim() || undefined,
                  }
                : undefined,
            })
            if (avatarFile) {
              await uploadAvatar(project.id, avatarFile)
            }
            form.resetFields()
            setAvatarFile(null)
            setAvatarPreview(null)
            onClose()
            queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'projects'] })
            navigate(PATHS.projectDetail(project.id), { replace: true })
          } catch (err) {
            // 保持弹窗打开，展示提交失败原因（§49.7 稳定错误码 → 中文文案），用户可修正后重试
            // 建仓失败可能是 OAuth 刚被撤销/重新绑定，立即刷新状态，避免继续使用旧授权状态提交。
            void queryClient.invalidateQueries({ queryKey: queryKeys.githubOAuth })
            setSubmitError(newRepositoryCreateErrorMessage(err) ?? formatApiError(err))
          }
        }}
      >
        {submitError ? (
          <Text type="danger" style={{ display: 'block', marginBottom: 8 }}>
            {submitError}
          </Text>
        ) : null}
        <Form.Item
          name="name"
          label="项目名称"
          rules={[{ required: true, message: '请输入项目名称' }]}
        >
          <Input placeholder="例如：Qgents Web" maxLength={50} />
        </Form.Item>
        <Form.Item name="description" label="项目简介（可选）">
          <Input.TextArea
            placeholder="描述项目用途与协作方向"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={200}
          />
        </Form.Item>
        {/* 项目头像（v2.0.6）：创建时可选，创建成功后再直传回写；项目主群会话头像跟随项目头像 */}
        <Form.Item label="项目头像（可选）">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar size={48} src={avatarPreview ?? undefined} icon={<CameraOutlined />} style={{ flexShrink: 0 }} />
            <Upload accept="image/*" showUploadList={false} beforeUpload={handleAvatarSelect}>
              <Button icon={<UploadOutlined />} loading={avatarUploading}>
                {avatarFile ? '重新选择' : '选择头像'}
              </Button>
            </Upload>
            {avatarFile ? (
              <Button type="text" onClick={() => { setAvatarFile(null); setAvatarPreview(null) }}>
                移除
              </Button>
            ) : null}
          </div>
        </Form.Item>
        <Form.Item name="memberIds" label="初始成员（可选）">
          <Select
            mode="multiple"
            placeholder="从团队成员中选择，选中即加入项目"
            // 创建者自动成为项目成员，前端过滤自己避免误选
            options={teamMembers
              .filter((m) => m.userId !== user?.id)
              .map((m) => ({
                value: m.userId,
                // label 用 ReactNode：选项显示头像 + 昵称（无头像显示昵称首字）
                label: (
                  <Space size={6}>
                    <Avatar size={20} src={m.avatarUrl} style={{ background: '#3b82f6' }}>
                      {(m.displayName || m.userId).slice(0, 1)}
                    </Avatar>
                    {m.displayName || m.userId}
                  </Space>
                ),
                // ReactNode label 无法直接按文本过滤，用 searchText 兜底
                searchText: m.displayName || m.userId,
              }))}
            filterOption={(input, option) =>
              String((option as { searchText?: string } | undefined)?.searchText ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            allowClear
          />
        </Form.Item>
        <Form.Item label="GitHub 仓库来源">
          <Radio.Group
            value={repositoryMode}
            onChange={(event) => {
              const mode = event.target.value as 'existing' | 'new'
              setRepositoryMode(mode)
              if (mode === 'existing') form.setFieldsValue({ newRepository: { isPrivate: true } })
              else form.setFieldValue('repositoryIds', undefined)
            }}
            options={[
              { value: 'existing', label: '绑定已有仓库' },
              ...(hideAutoCreate
                ? []
                : [{ value: 'new', label: '自动新建仓库', disabled: !canCreateNewRepository }]),
            ]}
          />
          {!canCreateNewRepository ? (
            <Text type="warning" style={{ display: 'block', marginTop: 8 }}>
              {setupGuide
                ? <>
                    {setupGuide.message}
                    {setupGuide.linkToOAuth ? (
                      <>
                        {' '}
                        <TextLink onClick={() => { onClose(); navigate(PATHS.GITHUB_OAUTH) }}>去绑定 GitHub</TextLink>
                      </>
                    ) : null}
                    {githubOAuth?.personalRepositorySetup === 'NEED_INSTALLATION' ? (
                      <>
                        {' '}
                        <TextLink onClick={() => installMutation.mutate()}>去安装 GitHub App</TextLink>
                      </>
                    ) : null}
                  </>
                : activeInstallations.length === 0
                  ? '当前团队没有可用的 GitHub App 安装记录，无法自动创建仓库。'
                  : <>自动建仓当前不可用。个人账号需要先
                      <TextLink onClick={() => { onClose(); navigate(PATHS.GITHUB_OAUTH) }}>绑定个人 GitHub</TextLink>
                      ；组织账号需要团队 GitHub App 授权。</>}
            </Text>
          ) : null}
        </Form.Item>
        {/* GitHub 仓库 —— 创建时可选，一并绑定 */}
        <Form.Item
          name="repositoryIds"
          label="GitHub 仓库"
          hidden={repositoryMode !== 'existing'}
          rules={repositoryMode === 'existing' ? [{ required: true, message: '请至少绑定一个 GitHub 仓库' }] : []}
        >
          <Select
            mode="multiple"
            placeholder="选择要绑定的仓库（可多选）"
            loading={reposLoading}
            notFoundContent={
              bindableRepos.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    activeInstallations.length === 0 ? (
                      <span>
                        暂无已授权的 GitHub 仓库，请先
                        <TextLink onClick={() => { onClose(); navigate(PATHS.githubIntegration(teamId)) }}>去授权</TextLink>
                      </span>
                    ) : (
                      <span>
                        团队 GitHub App 已授权，但当前没有可绑定的仓库。请先在 GitHub 创建仓库，或到 GitHub App 安装设置中为你的账号授权仓库范围。
                      </span>
                    )
                  }
                />
              ) : undefined
            }
            options={bindableRepos.map((r) => ({
              value: r.id,
              label: r.fullName,
            }))}
            optionFilterProp="label"
          />
        </Form.Item>
        {repositoryMode === 'new' ? <>
          <Form.Item name={['newRepository', 'name']} label="新仓库名称" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]*$/, message: '仅支持小写字母、数字、-、_、.' }]}>
            <Input placeholder="例如 qgents-web" maxLength={100} />
          </Form.Item>
          <Form.Item name={['newRepository', 'description']} label="仓库描述（可选）">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={200} />
          </Form.Item>
          <Form.Item name={['newRepository', 'displayName']} label="项目内显示名称（可选）">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name={['newRepository', 'isPrivate']} label="私有仓库" valuePropName="checked">
            <Switch />
          </Form.Item>
          {activeInstallations.length > 1 ? <Form.Item name={['newRepository', 'installationId']} label="GitHub 安装记录" rules={[{ required: true, message: '请选择用于创建仓库的 GitHub 安装记录' }]}>
            <Select options={activeInstallations.map((installation) => ({
              value: installation.id,
              label: newRepositoryInstallationOptionLabel(installation, githubOAuth),
              disabled: !canUseInstallationForNewRepository(installation, githubOAuth),
            }))} />
          </Form.Item> : null}
          {activeInstallations.length === 0 ? <Text type="danger">当前团队没有可用的 GitHub App 安装记录，无法自动创建仓库。</Text> : null}
          {privateRepositoryError ? <Text type="warning" style={{ display: 'block', marginTop: 8 }}>{privateRepositoryError}</Text> : null}
        </> : null}
        <Form.Item noStyle hidden={repositoryMode !== 'existing'}>
          <Text type="secondary" style={{ fontSize: 12, marginTop: -16 }}>
            创建项目需绑定至少一个 GitHub 仓库；若列表为空请先完成团队 GitHub App 授权
          </Text>
        </Form.Item>
      </Form>
    </Modal>
  )
}
