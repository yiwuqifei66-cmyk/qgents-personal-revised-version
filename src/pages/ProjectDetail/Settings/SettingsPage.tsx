// src/pages/ProjectDetail/sections/SettingsPage.tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Typography, Input, Spin, Tag, message, Avatar, Upload } from 'antd'
import { GithubOutlined, SaveOutlined, LockOutlined, UploadOutlined, CameraOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectApi } from '@/api'
import { githubApi } from '@/api/github'
import { useProjectAvatarUpload } from '@/hooks/useProjectAvatarUpload'
import { queryKeys } from '@/query/queryKeys'
import { PATHS } from '@/routes/paths'
import type { Project } from '@/types/project'
import './SettingsPage.scss'

const { Title, Text } = Typography
const { TextArea } = Input

/**
 * 项目设置页 —— 配置项目级别规则与权限
 *
 * 权限控制：
 * - PROJECT_ADMIN：可编辑所有配置
 * - PROJECT_MEMBER / TEAM_OWNER：只读
 *
 * 页面：基本信息 + 仓库 合成一页（需求群规则 / 任务执行已移除）
 */
export function SettingsPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()

  const { data: project, isLoading } = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => projectApi.getById(projectId),
    enabled: !!projectId,
  })

  const isEditable = project?.role === 'PROJECT_ADMIN'

  if (isLoading) {
    return (
      <div className="settings-page">
        <div className="settings-page__loading">
          <Spin size="large" />
        </div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <div className="settings-page__header-left">
          <Title level={3} className="settings-page__title">项目设置</Title>
          <Text type="secondary" className="settings-page__desc">
            配置项目级别、流程与权限，保障协同与交付质量
          </Text>
        </div>
      </div>

      {/* 基本信息 + 仓库 左右两栏（需求群规则 / 任务执行已移除） */}
      <div className="settings-page__body">
        <div className="settings-page__col">
          <Title level={4} className="settings-page__section-title settings-page__col-title">基本信息</Title>
          <div className="settings-page__col-body">
            <BasicInfoTab projectId={projectId} project={project} isEditable={isEditable} />
          </div>
        </div>
        <div className="settings-page__col">
          <Title level={4} className="settings-page__section-title settings-page__col-title">仓库</Title>
          <div className="settings-page__col-body">
            <RepositoriesTab
              projectId={projectId}
              teamId={project?.teamId ?? ''}
              isEditable={isEditable}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Tab 1：基本信息
// ============================================================

function BasicInfoTab({
  projectId,
  project,
  isEditable,
}: {
  projectId: string
  project?: Project
  isEditable: boolean
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // 项目头像（v2.0.6：从群聊设置栏迁入项目设置-基本信息）
  const { uploading: avatarUploading, uploadAvatar } = useProjectAvatarUpload(project?.teamId)

  // project 异步加载完成后同步到本地 state，避免初始空串不更新
  useEffect(() => {
    setName(project?.name || '')
    setDescription(project?.description || '')
  }, [project])

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      projectApi.update(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      message.success('基本信息已更新')
    },
    onError: () => {
      message.error('更新失败，请重试')
    },
  })

  const handleSave = () => {
    if (!name.trim()) {
      message.warning('项目名称不能为空')
      return
    }
    updateMutation.mutate({ name: name.trim(), description: description.trim() })
  }

  return (
    <div className="settings-tab">
      <div className="settings-tab__content">
        {/* 项目头像（v2.0.6：从群聊设置栏迁入项目设置-基本信息；主群会话头像跟随项目头像） */}
        <div className="settings-tab__field">
          <label className="settings-tab__label">项目头像</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar size={64} src={project?.avatarUrl} icon={<CameraOutlined />} style={{ flexShrink: 0 }} />
            {isEditable ? (
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                  void uploadAvatar(projectId, file)
                  return false
                }}
              >
                <Button icon={<UploadOutlined />} loading={avatarUploading}>
                  {project?.avatarUrl ? '更换头像' : '上传头像'}
                </Button>
              </Upload>
            ) : (
              <Text type="secondary">仅项目管理员可修改</Text>
            )}
          </div>
        </div>

        <div className="settings-tab__field">
          <label className="settings-tab__label">项目名称</label>
          {isEditable ? (
            <Input
              className="settings-tab__input"
              placeholder="请输入项目名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          ) : (
            <div className="settings-tab__readonly">
              <span>{project?.name || '—'}</span>
              <LockOutlined />
            </div>
          )}
        </div>

        <div className="settings-tab__field">
          <label className="settings-tab__label">项目描述</label>
          {isEditable ? (
            <TextArea
              className="settings-tab__textarea"
              placeholder="请输入项目描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          ) : (
            <div className="settings-tab__readonly">
              <span>{project?.description || '暂无描述'}</span>
              <LockOutlined />
            </div>
          )}
        </div>

        <div className="settings-tab__field settings-tab__field--readonly">
          <label className="settings-tab__label">项目 ID</label>
          <span className="settings-tab__text">{project?.id || '—'}</span>
        </div>

        <div className="settings-tab__field settings-tab__field--readonly">
          <label className="settings-tab__label">创建时间</label>
          <span className="settings-tab__text">
            {project?.createdAt ? new Date(project.createdAt).toLocaleString() : '—'}
          </span>
        </div>

        <div className="settings-tab__field settings-tab__field--readonly">
          <label className="settings-tab__label">我的角色</label>
          <span className="settings-tab__text">
            {project?.role === 'PROJECT_ADMIN' ? 'Project Admin' : 'Project Member'}
          </span>
        </div>

        {isEditable && (
          <div className="settings-tab__footer">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={updateMutation.isPending}
              onClick={handleSave}
            >
              保存基本信息
            </Button>
          </div>
        )}


      </div>
    </div>
  )
}

// ============================================================
// Tab 2：仓库 —— GET /projects/{projectId}/repositories
// ============================================================

function RepositoriesTab({
  projectId,
  teamId,
  isEditable,
}: {
  projectId: string
  teamId: string
  isEditable: boolean
}) {
  const navigate = useNavigate()
  const { data: repositories = [], isLoading, isError } = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId),
  })

  /** 查询团队已安装的 GitHub App，用于直接跳转到「查看仓库」页 */
  const installationsQuery = useQuery({
    queryKey: queryKeys.githubInstallations(teamId),
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: Boolean(teamId),
  })
  const installations = installationsQuery.data ?? []
  // 过滤掉已删除的安装，只统计活跃的
  const activeInstallations = installations.filter((i) => i.status !== 'DELETED')

  function handleBindClick() {
    if (!teamId) {
      message.warning('缺少团队信息，无法跳转绑定页')
      return
    }
    // 等待 installations 加载完成后再跳转
    if (installationsQuery.isLoading) {
      message.info('正在加载安装信息，请稍候')
      return
    }
    // 如果只有一个活跃的 GitHub App 安装，直接跳转到「查看仓库」页
    if (activeInstallations.length === 1) {
      navigate(PATHS.githubInstallationRepos(teamId, activeInstallations[0].id))
      return
    }
    // 多个或零个活跃安装 → 跳到 GitHub 集成页，让用户选择安装或先安装
    navigate(PATHS.githubIntegration(teamId))
  }

  return (
    <div className="settings-tab">
      <div className="settings-tab__content">
        <div className="settings-tab__section-header">
          <Text strong>已绑定仓库</Text>
          {isEditable && (
            <Button type="primary" size="small" onClick={handleBindClick}>
              + 绑定仓库
            </Button>
          )}
        </div>

        <div className="settings-tab__repo-list">
          {isLoading ? (
            <div className="settings-tab__repo-placeholder">
              <Spin />
            </div>
          ) : isError ? (
            <div className="settings-tab__repo-placeholder">
              <Text type="danger">仓库列表加载失败，请稍后重试</Text>
            </div>
          ) : repositories.length === 0 ? (
            <div className="settings-tab__repo-placeholder">
              <Text type="secondary">暂无已绑定仓库</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {isEditable ? '点击「绑定仓库」从 GitHub 授权仓库中添加' : '请联系项目管理员绑定仓库'}
              </Text>
            </div>
          ) : (
            repositories.map((repo) => (
              <div key={repo.id} className="settings-tab__repo-item">
                <div className="settings-tab__repo-item-main">
                  <GithubOutlined className="settings-tab__repo-item-icon" />
                  <div className="settings-tab__repo-item-text">
                    <Text strong className="settings-tab__repo-item-title">
                      {repo.displayName || repo.fullName.split('/').pop() || repo.fullName}
                    </Text>
                    <Text type="secondary" className="settings-tab__repo-item-fullname">
                      {repo.fullName}
                    </Text>
                  </div>
                  <Tag color={repo.authorizationStatus === 'AUTHORIZED' ? 'success' : 'warning'}>
                    {repo.authorizationStatus === 'AUTHORIZED' ? '已授权' : '已撤销'}
                  </Tag>
                </div>
                <div className="settings-tab__repo-item-meta">
                  <Text type="secondary">默认分支：{repo.defaultBranch || '—'}</Text>
                  <Text type="secondary">
                    绑定于 {repo.boundAt ? new Date(repo.boundAt).toLocaleString() : '—'}
                  </Text>
                </div>
              </div>
            ))
          )}
        </div>

        {!isEditable && (
          <div className="settings-tab__readonly-hint">
            <LockOutlined />
            <Text type="secondary" style={{ fontSize: 13 }}>
              只读模式，仓库管理需 Project Admin 权限
            </Text>
          </div>
        )}
      </div>
    </div>
  )
}
