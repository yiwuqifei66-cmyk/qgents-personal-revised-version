import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { ApiError } from '@/api/client'
import { githubApi } from '@/api/github'
import { queryKeys } from '@/query/queryKeys'
import { formatApiError } from '@/utils/formatApiError'
import { toGithubAppInstallNewUrl, type GithubInstallation } from '@/types/github'

function readApiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  const body = error.body as { error?: { code?: string } } | undefined
  return body?.error?.code
}

/** DELETE 解除关联失败时的提示：项目仓库仍绑定时必须先解绑。 */
export function githubInstallationDisconnectErrorMessage(error: unknown): string {
  if (readApiErrorCode(error) === 'GITHUB_INSTALLATION_IN_USE') {
    return '请先解绑相关项目仓库后再解除关联'
  }
  return formatApiError(error)
}

export type GithubAuthStatus = 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'SUSPENDED' | 'DELETED'

export function deriveGithubAuthStatus(
  installations: GithubInstallation[] | undefined,
): GithubAuthStatus {
  if (!installations || installations.length === 0) return 'NOT_AUTHORIZED'
  if (installations.some((i) => i.status === 'ACTIVE')) return 'AUTHORIZED'
  if (installations.some((i) => i.status === 'SUSPENDED')) return 'SUSPENDED'
  return 'DELETED'
}

/**
 * Team Owner：生成 GitHub App 新装 URL 并整页跳转
 * POST /teams/{teamId}/integrations/github/installations
 * 只跳 /apps/{slug}/installations/new，不进 Configure。
 *
 * TODO[后端联调] 排错清单：
 * 1. VITE_USE_MOCK=true？否则需 vite proxy + 后端已启动
 * 2. localStorage 是否有 qgents_access_token（401）
 * 3. 当前用户是否 Team Owner（403）
 * 4. teamId 是否真实存在（404）
 * 5. 响应是否为 HTML（代理未配好时常见 Unexpected token '<'）
 */
export function useGithubInstallRedirect(teamId: string) {
  const { message } = App.useApp()


  // useQuery：读数据（GET，自动发请求、列表、详情）,会直接执行
  // useMutation：写数据（POST/PUT/DELETE，创建、修改、删除），不会自动执行！要手动调用 mutate (),这个是写操作,需要向后端发起请求
  return useMutation({
    mutationFn: async () => {
      console.info('[GitHubInstall] 开始请求安装跳转地址', { teamId })
      if (!teamId.trim()) {
        throw new Error('缺少 teamId，请从「我创建的团队 → 查看详情 → github集成」进入本页')
      }
      const data = await githubApi.createInstallation(teamId)//先从createInstallation获取跳转地址
      console.info('[GitHubInstall] 后端返回', data)
      return data//后端返回信息
    },//后端返回信息就是这两个东西{ installationUrl, expiresAt }
    onSuccess: ({ installationUrl, expiresAt }) => {
      if (!installationUrl || typeof installationUrl !== 'string') {
        message.error('后端未返回 installationUrl，请检查 POST installations 响应')
        console.error('[GitHubInstall] 非法响应：缺少 installationUrl', { expiresAt })
        return
      }
      const expireMs = Date.parse(expiresAt)//把后端返回的过期时间字符串（比如 2026-08-14T13:30:00Z）转成毫秒时间戳。
      if (!Number.isNaN(expireMs) && expireMs < Date.now()) {//判断时间合法并且过期,才进行拦截
        message.warning('安装链接已过期，请再次点击「安装Github App」获取新链接')
        return
      }
      const installNewUrl = toGithubAppInstallNewUrl(installationUrl)
      if (!installNewUrl) {
        message.error('安装地址无效，已拦截。请检查后端返回的 installationUrl')
        console.error('[GitHubInstall] 非法 installationUrl，拒绝跳转', { installationUrl })
        return
      }
      // 没给过期时间也能跳转
      message.loading({
        content: '正在跳转到 GitHub 完成安装…',
        key: 'github-install-redirect',// Ant Design message 的前端标识,同一个 key 再弹一次会覆盖上一条，
        duration: 1.5,
      })
      console.info('即将跳转', installNewUrl)
      window.location.assign(installNewUrl)
    },
    onError: (error) => {
      console.error('[GitHubInstall] 失败', error)
      message.error(formatApiError(error))
    },
  })
}

/** Team Owner：查询团队 GitHub App 安装状态 */
export function useGithubInstallations(teamId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.githubInstallations(teamId),
    queryFn: () => githubApi.listInstallations(teamId),
    enabled: Boolean(teamId) && enabled,
  })
}

/**
 * Team Owner：解除当前团队与该 GitHub Installation 的本地关联
 * DELETE /teams/{teamId}/integrations/github/installations/{installationId}
 *
 * 只删 Qgents 侧团队 ↔ Installation，后端不得调用 GitHub Uninstall。
 * 项目仓库仍绑定时 409 GITHUB_INSTALLATION_IN_USE，需先解绑。
 * 成功 204，响应体没有新列表。前端必须 invalidate 后再 GET。
 * 从 GitHub 完整卸载没有 Qgents API，走 GitHub 管理页，不要复用本 DELETE。
 */
export function useDeleteGithubInstallation(teamId: string) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (installationId: string) => {
      if (!teamId.trim()) {
        throw new Error('缺少 teamId，请从「我创建的团队 → 查看详情 → github集成」进入本页')
      }
      if (!installationId.trim()) {
        throw new Error('缺少 installationId')
      }
      await githubApi.deleteInstallation(teamId, installationId)
    },
    onSuccess: async () => {
      message.success('已解除与当前团队的关联')
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations(teamId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubTeamRepositories(teamId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(teamId) })
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return Array.isArray(key) && key[0] === 'qgents' && key[1] === 'projects' && key[3] === 'repositories'
        },
      })
    },
    onError: (error) => {
      message.error(githubInstallationDisconnectErrorMessage(error))
    },
  })
}

export function githubAuthActionLabel(status: GithubAuthStatus): string {
  switch (status) {
    case 'NOT_AUTHORIZED':
      return '安装 GitHub App'
    case 'AUTHORIZED':
      return '添加/调整授权仓库'
    case 'SUSPENDED':
      return '安装已暂停，请到 GitHub 恢复授权'
    case 'DELETED':
      return '重新授权'
  }
}
