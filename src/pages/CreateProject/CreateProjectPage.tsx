import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Radio, Select, Switch } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { PATHS } from '@/routes/paths'
import { projectApi, teamApi, githubApi } from '@/api'
import { isGithubRepoBindable } from '@/types/github'
import { authApi } from '@/api/auth'
import { queryKeys } from '@/query/queryKeys'
import {
  canUseInstallationForNewRepository,
  newRepositoryCreateErrorMessage,
  newRepositoryInstallationOptionLabel,
  personalRepositorySetupGuide,
  privateRepositoryAuthorizationMessage,
} from '@/utils/githubRepositoryAccess'
import './CreateProjectPage.css'

/**
 * 创建项目页 —— 对齐接口文档 v1.1.4 §5.2
 *
 * POST /teams/{teamId}/projects
 * 入口：团队详情页 →「创建项目」、个人中心 →「创建项目」
 */
export default function CreateProjectPage() {
  const { teamId = '' } = useParams<{ teamId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [repositoryIds, setRepositoryIds] = useState<string[]>([])
  const [repositoryMode, setRepositoryMode] = useState<'existing' | 'new'>('existing')
  const [newRepository, setNewRepository] = useState({ name: '', description: '', displayName: '', isPrivate: true, installationId: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 团队成员列表（作为「初始成员」多选候选）
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teams', teamId, 'members'],
    queryFn: () => teamApi.listMembers(teamId),
    enabled: !!teamId,
  })

  // 团队已授权 GitHub 仓库（创建时必选，用于一并绑定）
  const { data: teamRepos = [], isLoading: reposLoading } = useQuery({
    queryKey: ['teams', teamId, 'github', 'repositories'],
    queryFn: () => githubApi.listTeamRepositories(teamId),
    enabled: !!teamId,
  })
  const { data: installations = [] } = useQuery({
    queryKey: ['teams', teamId, 'github', 'installations'],
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: !!teamId,
  })
  const { data: githubOAuth } = useQuery({
    queryKey: queryKeys.githubOAuth,
    queryFn: authApi.getGithubOAuthStatus,
    enabled: !!teamId,
    // §49.4：绑定返回后必须重新请求本接口决定是否解除置灰，不依赖本地缓存/回跳参数
    staleTime: 0,
  })
  const bindableRepos = teamRepos.filter((r) =>
    isGithubRepoBindable(r, installations.find((i) => i.id === r.installationId)),
  )
  const activeInstallations = installations.filter((installation) => installation.status === 'ACTIVE')
  const newRepositoryInstallations = activeInstallations.filter((installation) =>
    canUseInstallationForNewRepository(installation, githubOAuth),
  )
  const canCreateNewRepository = newRepositoryInstallations.length > 0
  const selectedInstallation = activeInstallations.length === 1
    ? activeInstallations[0]
    : activeInstallations.find((installation) => installation.id === newRepository.installationId)
  const privateRepositoryError = newRepository.isPrivate
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
      else setError('后端未返回 GitHub App 安装地址')
    },
    onError: (err) => setError(err instanceof Error ? err.message : '获取安装链接失败'),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (repositoryMode === 'existing' && repositoryIds.length === 0) {
      setError('请至少绑定一个 GitHub 仓库')
      return
    }
    if (repositoryMode === 'new' && !/^[a-z0-9][a-z0-9._-]*$/.test(newRepository.name.trim())) {
      setError('新仓库名称仅支持小写字母、数字、-、_、.')
      return
    }
    if (repositoryMode === 'new' && activeInstallations.length === 0) {
      setError('当前团队没有可用的 GitHub App 安装记录，无法自动创建仓库')
      return
    }
    if (repositoryMode === 'new' && !canCreateNewRepository) {
      setError('当前没有可用的自动建仓授权，请先绑定个人 GitHub，或让团队管理员完成组织 GitHub App 授权')
      return
    }
    if (repositoryMode === 'new' && activeInstallations.length > 1 && !newRepository.installationId) {
      setError('请选择用于创建仓库的 GitHub 安装记录')
      return
    }
    if (repositoryMode === 'new' && privateRepositoryError) {
      setError(privateRepositoryError)
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      const project = await projectApi.create({
        teamId,
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds: memberIds.length > 0 ? memberIds : undefined,
        repositoryIds: repositoryMode === 'existing' ? repositoryIds : undefined,
        newRepository: repositoryMode === 'new'
          ? {
              name: newRepository.name.trim(),
              description: newRepository.description.trim() || undefined,
              displayName: newRepository.displayName.trim() || undefined,
              isPrivate: newRepository.isPrivate,
              installationId: activeInstallations.length === 1 ? undefined : newRepository.installationId,
            }
          : undefined,
      })
      // 创建成功后跳转到项目需求群聊
      navigate(PATHS.projectDetail(project.id), { replace: true })
    } catch (err) {
      setError(
        newRepositoryCreateErrorMessage(err) ??
          (err instanceof Error ? err.message : '创建项目失败，请重试'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="create-project">
      <Link to={PATHS.teamDetail(teamId)} className="create-project__back">
        ← 返回团队详情
      </Link>

      <h1>创建项目</h1>
      <p className="create-project__meta">
        所属团队 teamId: <code>{teamId}</code>
      </p>

      <form className="create-project__card" onSubmit={handleSubmit}>
        {error && (
          <div className="create-project__error" role="alert">
            {error}
          </div>
        )}

        <label className="create-project__field">
          <span>项目名称 *</span>
          <input
            placeholder="例如：Qgents Web"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="create-project__field">
          <span>项目简介</span>
          <textarea
            placeholder="描述项目用途与协作方向"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>

        <div className="create-project__field">
          <span>初始成员（可选）</span>
          <Select
            mode="multiple"
            placeholder="从团队成员中选择，选中即加入项目"
            value={memberIds}
            onChange={setMemberIds}
            // 创建者自动成为项目成员，前端过滤自己避免误选
            options={teamMembers
              .filter((m) => m.userId !== user?.id)
              .map((m) => ({
                value: m.userId,
                label: m.displayName || m.userId,
              }))}
            optionFilterProp="label"
            allowClear
          />
          <p className="create-project__hint" style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>
            从团队现有成员中选择，创建后即成为项目初始成员
          </p>
        </div>

        <div className="create-project__field">
          <span>GitHub 仓库来源 *</span>
          <Radio.Group
            value={repositoryMode}
            onChange={(event) => {
              const mode = event.target.value as 'existing' | 'new'
              setRepositoryMode(mode)
              if (mode === 'new') setRepositoryIds([])
            }}
            options={[
              { value: 'existing', label: '绑定已有仓库' },
              ...(hideAutoCreate
                ? []
                : [{ value: 'new', label: '自动新建仓库', disabled: !canCreateNewRepository }]),
            ]}
          />
          {!canCreateNewRepository ? (
            <p className="create-project__hint" style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0' }}>
              {setupGuide
                ? <>
                    {setupGuide.message}
                    {setupGuide.linkToOAuth ? (
                      <>
                        {' '}
                        <Link to={PATHS.GITHUB_OAUTH}>去绑定 GitHub</Link>
                      </>
                    ) : null}
                    {githubOAuth?.personalRepositorySetup === 'NEED_INSTALLATION' ? (
                      <>
                        {' '}
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto' }}
                          loading={installMutation.isPending}
                          onClick={() => installMutation.mutate()}
                        >
                          去安装 GitHub App
                        </Button>
                      </>
                    ) : null}
                  </>
                : activeInstallations.length === 0
                  ? '当前团队没有可用的 GitHub App 安装记录，无法自动创建仓库。'
                  : <>自动建仓当前不可用。个人账号需要先
                      <Link to={PATHS.GITHUB_OAUTH}>绑定个人 GitHub</Link>
                      ；组织账号需要团队 GitHub App 授权。</>}
            </p>
          ) : null}
        </div>
        {/* GitHub 仓库 —— 创建时必选，一并绑定 */}
        {repositoryMode === 'existing' ? (
        <div className="create-project__field">
          <span>GitHub 仓库 *</span>
          <Select
            mode="multiple"
            placeholder={reposLoading ? '加载仓库中…' : '选择要绑定的仓库（可多选）'}
            value={repositoryIds}
            onChange={setRepositoryIds}
            loading={reposLoading}
            options={bindableRepos.map((r) => ({
              value: r.id,
              label: r.fullName,
            }))}
            optionFilterProp="label"
          />
          <p className="create-project__hint" style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>
            创建项目需绑定至少一个 GitHub 仓库；若列表为空，请先
            <Link to={PATHS.githubIntegration(teamId)}>完成团队 GitHub App 授权</Link>
          </p>
        </div>
        ) : (
          <>
            <label className="create-project__field">
              <span>新仓库名称 *</span>
              <input value={newRepository.name} onChange={(event) => setNewRepository((value) => ({ ...value, name: event.target.value }))} placeholder="例如 qgents-web" required />
            </label>
            <label className="create-project__field">
              <span>仓库描述</span>
              <textarea value={newRepository.description} onChange={(event) => setNewRepository((value) => ({ ...value, description: event.target.value }))} rows={3} />
            </label>
            <label className="create-project__field">
              <span>项目内显示名称</span>
              <input value={newRepository.displayName} onChange={(event) => setNewRepository((value) => ({ ...value, displayName: event.target.value }))} />
            </label>
            <div className="create-project__field">
              <span>私有仓库</span>
              <Switch checked={newRepository.isPrivate} onChange={(isPrivate) => setNewRepository((value) => ({ ...value, isPrivate }))} />
            </div>
            {activeInstallations.length > 1 ? <div className="create-project__field">
              <span>GitHub 安装记录 *</span>
              <Select
                value={newRepository.installationId || undefined}
                onChange={(installationId) => setNewRepository((value) => ({ ...value, installationId }))}
                options={activeInstallations.map((installation) => ({
                  value: installation.id,
                  label: newRepositoryInstallationOptionLabel(installation, githubOAuth),
                  disabled: !canUseInstallationForNewRepository(installation, githubOAuth),
                }))}
              />
            </div> : null}
            {activeInstallations.length === 0 ? <p className="create-project__error">当前团队没有可用的 GitHub App 安装记录，无法自动创建仓库。</p> : null}
            {privateRepositoryError ? <p className="create-project__hint" style={{ fontSize: 12, color: '#b45309' }}>{privateRepositoryError}</p> : null}
          </>
        )}

        <div className="create-project__actions">
          <Link
            to={PATHS.teamDetail(teamId)}
            className="create-project__btn create-project__btn--ghost"
          >
            取消
          </Link>
          <button
            type="submit"
            className="create-project__btn create-project__btn--primary"
            disabled={submitting || !name.trim() || (repositoryMode === 'existing' ? repositoryIds.length === 0 : !newRepository.name.trim() || !canCreateNewRepository || (activeInstallations.length > 1 && !newRepository.installationId) || Boolean(privateRepositoryError))}
          >
            {submitting ? '创建中…' : '创建项目'}
          </button>
        </div>
      </form>
    </div>
  )
}
