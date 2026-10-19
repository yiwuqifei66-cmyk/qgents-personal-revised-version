import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Alert, App, Button, Card, Descriptions, Empty, Space, Spin, Tag, Typography } from 'antd'
import { GithubOutlined, LinkOutlined, DisconnectOutlined } from '@ant-design/icons'
import { authApi, githubApi } from '@/api'
import { DarkPage } from '@/components/DarkPage'
import { queryKeys } from '@/query/queryKeys'
import { formatApiError } from '@/utils/formatApiError'
import { personalRepositorySetupGuide } from '@/utils/githubRepositoryAccess'

const { Title, Paragraph, Text } = Typography

const callbackErrorMessages: Record<string, string> = {
  GITHUB_OAUTH_STATE_INVALID: '授权链接无效，请重新发起授权。',
  GITHUB_OAUTH_STATE_EXPIRED: '授权链接已过期，请重新发起授权。',
  GITHUB_OAUTH_STATE_REPLAYED: '该授权回调已经处理过，请刷新授权状态。',
  GITHUB_OAUTH_CALLBACK_DENIED: '你取消了 GitHub 授权。',
  GITHUB_OAUTH_CODE_EXCHANGE_FAILED: 'GitHub 授权换取凭证失败，请稍后重试。',
  GITHUB_OAUTH_ACCOUNT_LOOKUP_FAILED: '无法确认 GitHub 账号，请稍后重试。',
  GITHUB_OAUTH_ACCOUNT_MISMATCH: '该 GitHub 账号与团队安装账号不一致，或已被其他 Qgents 用户绑定，请确认后重新发起授权。',
  GITHUB_OAUTH_CALLBACK_CONFLICT: '授权状态冲突，请重新发起授权。',
  GITHUB_OAUTH_NOT_CONFIGURED: '服务端未配置 GitHub OAuth，请联系管理员。',
  GITHUB_OAUTH_REVOKED: '该授权已撤销，请重新发起授权。',
  GITHUB_OAUTH_UPSTREAM_UNAVAILABLE: 'GitHub 服务暂不可用，请稍后重试。',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

/**
 * 当前用户的个人 GitHub OAuth 授权页，对齐接口文档 §49。
 * 它与团队级 GitHub App 集成页分离：OAuth 只关联个人 GitHub，不负责团队仓库授权。
 */
export function GitHubOAuthPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const callbackHandledRef = useRef(false)

  const statusQuery = useQuery({
    queryKey: queryKeys.githubOAuth,
    queryFn: authApi.getGithubOAuthStatus,
  })

  const startMutation = useMutation({
    mutationFn: () => authApi.startGithubOAuth('WEB'),
    onSuccess: (result) => {
      if (!result.authorizationUrl) {
        message.error('后端未返回 GitHub 授权地址')
        return
      }
      window.location.assign(result.authorizationUrl)
    },
    onError: (error) => message.error(formatApiError(error)),
  })

  const revokeMutation = useMutation({
    mutationFn: authApi.revokeGithubOAuth,
    onSuccess: () => {
      message.success('个人 GitHub 授权已解除')
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubOAuth })
    },
    onError: (error) => message.error(formatApiError(error)),
  })

  useEffect(() => {
    const result = searchParams.get('githubOAuth')
    if (!result || callbackHandledRef.current) return

    callbackHandledRef.current = true
    const callbackCode = searchParams.get('code')
    if (result === 'authorized') {
      message.success('个人 GitHub 已关联')
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubOAuth })
    } else if (result === 'failed') {
      message.error(callbackErrorMessages[callbackCode ?? ''] ?? 'GitHub 个人授权未完成，请重试。')
    }

    const next = new URLSearchParams(searchParams)
    next.delete('githubOAuth')
    next.delete('code')
    setSearchParams(next, { replace: true })
  }, [message, queryClient, searchParams, setSearchParams])

  const status = statusQuery.data
  const setupGuide = personalRepositorySetupGuide(status)
  // §49.4：没有 USER 安装 / 非 Owner 时禁止发起授权，避免跳转 GitHub 后被后端回调以失败收场
  const setupBlocked =
    status?.personalRepositorySetup === 'NEED_INSTALLATION' ||
    status?.personalRepositorySetup === 'NOT_OWNER'

  function handleBind() {
    if (setupBlocked) return
    startMutation.mutate()
  }

  // NEED_INSTALLATION 时提供「去安装 GitHub App」跳转：取用户的第一个 Owner 团队生成安装链接
  const { data: me } = useQuery({
    queryKey: ['qgents', 'me'],
    queryFn: () => authApi.me(),
  })
  const ownerTeamId = me?.teams.find((t) => t.role === 'TEAM_OWNER')?.id
  const installMutation = useMutation({
    mutationFn: (teamId: string) => githubApi.createInstallation(teamId, 'WEB'),
    onSuccess: (result) => {
      if (!result.installationUrl) {
        message.error('后端未返回 GitHub App 安装地址')
        return
      }
      window.location.assign(result.installationUrl)
    },
    onError: (error) => message.error(formatApiError(error)),
  })

  function handleInstallApp() {
    if (!ownerTeamId) {
      message.warning('未找到可安装 GitHub App 的团队，请先创建或加入团队')
      return
    }
    installMutation.mutate(ownerTeamId)
  }

  function confirmRevoke() {
    modal.confirm({
      title: '解除个人 GitHub 授权',
      content: '解除后将不能使用个人 GitHub 授权创建仓库；已绑定的团队仓库不会被删除或自动解绑。',
      okText: '确认解除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => revokeMutation.mutateAsync(),
    })
  }

  return (
    <DarkPage>
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 0 48px' }}>
      <Space orientation="vertical" size={20} style={{ width: '100%' }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>个人 GitHub 授权</Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            可选地关联你的个人 GitHub 账号，用于创建个人仓库。团队 GitHub App 授权、仓库同步、Worker 和 MR 流程保持不变。
          </Paragraph>
        </div>

        <Alert
          type="info"
          showIcon
          title="个人授权与团队 GitHub App 是两条独立链路"
          description="关联个人 GitHub 不会替代团队 App 授权。个人仓库创建后，若要在 Qgents 中运行任务，仍需确认仓库已被当前团队的 GitHub App 授权。"
        />

        <Card
          title={<Space><GithubOutlined />个人 GitHub 账号</Space>}
          extra={status?.authorized ? <Tag color="success">已关联</Tag> : <Tag>未关联</Tag>}
        >
          {statusQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          ) : statusQuery.isError ? (
            <Alert
              type="error"
              showIcon
              title={formatApiError(statusQuery.error)}
              action={<Button size="small" onClick={() => void statusQuery.refetch()}>重试</Button>}
            />
          ) : status?.authorized ? (
            <>
              <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                <Descriptions.Item label="GitHub 账号">
                  <Text strong>{status.githubLogin ?? '—'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="GitHub 用户 ID">{status.githubUserId ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="授权范围">
                  {status.scopes.length > 0 ? status.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>) : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="已关联时间">{formatDate(status.authorizedAt)}</Descriptions.Item>
                <Descriptions.Item label="最近校验时间">{formatDate(status.lastValidatedAt)}</Descriptions.Item>
                <Descriptions.Item label="公开仓库建仓">
                  {status.canCreatePublicPersonalRepository ? <Tag color="success">可用</Tag> : <Tag color="warning">不可用</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="私有仓库建仓">
                  {status.canCreatePrivatePersonalRepository ? <Tag color="success">可用</Tag> : <Tag color="warning">不可用</Tag>}
                </Descriptions.Item>
              </Descriptions>
              {!status.canCreatePublicPersonalRepository && !status.canCreatePrivatePersonalRepository ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 16 }}
                  title="当前授权不能创建个人仓库"
                  description="请重新授权并确认 GitHub 授权范围满足后端要求。"
                />
              ) : null}
              {setupGuide ? (
                <Alert type="warning" showIcon style={{ marginTop: 16 }} message={setupGuide.message} />
              ) : null}
              <Button
                danger
                icon={<DisconnectOutlined />}
                loading={revokeMutation.isPending}
                onClick={confirmRevoke}
                style={{ marginTop: 20 }}
              >
                解除个人授权
              </Button>
            </>
          ) : (
            <>
              {setupGuide ? (
                <Alert type="info" showIcon style={{ marginBottom: 16 }} message={setupGuide.message} />
              ) : null}
              <Empty
                image={<GithubOutlined style={{ fontSize: 48, color: '#8c8c8c' }} />}
                styles={{ image: { height: 56 } }}
                description="尚未关联个人 GitHub"
              >
                {status?.personalRepositorySetup === 'NEED_INSTALLATION' ? (
                  <Button
                    type="primary"
                    icon={<GithubOutlined />}
                    loading={installMutation.isPending}
                    onClick={handleInstallApp}
                  >
                    去安装 GitHub App
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<LinkOutlined />}
                    loading={startMutation.isPending}
                    onClick={handleBind}
                    disabled={setupBlocked}
                  >
                    关联个人 GitHub
                  </Button>
                )}
              </Empty>
            </>
          )}
        </Card>

        <Text type="secondary">
          授权凭证仅由后端保存和使用，前端不会获取或保存 GitHub Token。
        </Text>
      </Space>
    </div>
    </DarkPage>
  )
}

export default GitHubOAuthPage
