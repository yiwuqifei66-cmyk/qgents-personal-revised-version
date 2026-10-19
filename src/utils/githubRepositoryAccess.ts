import { ApiError } from '@/api/client'
import type { GithubOAuthStatus } from '@/types/auth'
import type { GithubInstallation } from '@/types/github'

/**
 * 判断某个 GitHub App Installation 是否可以作为项目自动建仓的目标。
 * 组织 Installation 继续走 GitHub App，不需要当前用户的 OAuth；
 * 个人 Installation 以后端 personalRepositorySetup 为准（READY 才可用），字段缺失时退回
 * authorized + 账号一致性判断。建仓能力（公开/私有）不在这里判断，由仓库类型层按能力字段约束。
 */
export function canUseInstallationForNewRepository(
  installation: GithubInstallation,
  oauth: GithubOAuthStatus | undefined,
): boolean {
  if (installation.status !== 'ACTIVE') return false
  if (installation.accountType === 'ORGANIZATION') return true
  // §49.6：无论后端 setup 状态如何，个人 Installation 都必须校验 OAuth 账号与该安装账号一致
  const loginMatches = Boolean(
    oauth?.githubLogin &&
    oauth.githubLogin.toLowerCase() === installation.accountLogin.toLowerCase(),
  )
  // setup 是全局引导状态，缺失时退回 authorized + 账号一致
  if (oauth?.personalRepositorySetup) return oauth.personalRepositorySetup === 'READY' && loginMatches
  return Boolean(oauth?.authorized && loginMatches)
}

/** 个人仓库开通前置状态的引导文案（接口文档 §49.4 状态表） */
export interface PersonalRepositorySetupGuide {
  message: string
  /** 是否展示「去绑定 GitHub」跳转（个人 OAuth 授权页） */
  linkToOAuth?: boolean
}

/**
 * 根据后端 personalRepositorySetup 生成自动建仓引导。
 * READY 或字段缺失返回 null（缺字段时由调用方退回原有逻辑）。
 */
export function personalRepositorySetupGuide(
  oauth: GithubOAuthStatus | undefined,
): PersonalRepositorySetupGuide | null {
  const setup = oauth?.personalRepositorySetup
  switch (setup) {
    case 'NOT_OWNER':
      return { message: '个人建仓需要团队 Owner 权限，请联系团队管理员开启后再使用。' }
    case 'NEED_INSTALLATION':
      return { message: '请先用你的个人 GitHub 账号安装 Qgents GitHub App，再回来绑定 GitHub 授权。' }
    case 'NEED_OAUTH':
      return { message: '请绑定 GitHub（请使用与安装记录一致的账号）。', linkToOAuth: true }
    case 'ACCOUNT_MISMATCH': {
      const login = oauth?.expectedInstallationLogin
      return {
        message: login
          ? `GitHub 账号不一致，请用 ${login} 重新绑定 GitHub（无需重装 App）。`
          : 'GitHub 账号不一致，请使用与安装记录一致的账号重新绑定 GitHub（无需重装 App）。',
        linkToOAuth: true,
      }
    }
    default:
      return null
  }
}

/**
 * 私有个人仓库需要后端能力字段 canCreatePrivatePersonalRepository（按授权 scope 计算）；
 * 组织仓库不走这条 OAuth 约束。前端不得自行解析 scopes。
 */
export function privateRepositoryAuthorizationMessage(
  installation: GithubInstallation | undefined,
  oauth: GithubOAuthStatus | undefined,
): string | null {
  if (!installation || installation.accountType === 'ORGANIZATION') return null
  if (!oauth?.authorized) return '个人账号建仓需要先绑定个人 GitHub 授权。'
  if (!oauth.githubLogin || oauth.githubLogin.toLowerCase() !== installation.accountLogin.toLowerCase()) {
    return `当前授权账号与安装账号 ${installation.accountLogin} 不一致，请用与安装一致的 GitHub 账号重新绑定（无需重装 App）。`
  }
  if (!oauth.canCreatePrivatePersonalRepository) return '当前 GitHub 授权不足以创建私有个人仓库，请切换为公开仓库，或重新授权以获取 repo 范围。'
  return null
}

/** 自动建仓安装下拉选项文案：区分「需绑定 OAuth」「账号不一致需重新绑定」（§49.4） */
export function newRepositoryInstallationOptionLabel(
  installation: GithubInstallation,
  oauth: GithubOAuthStatus | undefined,
): string {
  if (installation.accountType === 'ORGANIZATION') return `${installation.accountLogin}（组织）`
  if (oauth?.personalRepositorySetup === 'ACCOUNT_MISMATCH') return `${installation.accountLogin}（账号不一致，需重新绑定）`
  if (!canUseInstallationForNewRepository(installation, oauth)) return `${installation.accountLogin}（需绑定个人 GitHub）`
  return `${installation.accountLogin}（个人）`
}

/** 后端在 OAuth 建仓成功但 GitHub App 暂不可见新仓库时返回的 403 错误码（§49 个人 GitHub OAuth） */
export const GITHUB_REPOSITORY_NOT_AUTHORIZED = 'GITHUB_REPOSITORY_NOT_AUTHORIZED'

/**
 * 自动建仓提交后，后端返回 403 GITHUB_REPOSITORY_NOT_AUTHORIZED 时的提示文案。
 * 此时远端仓库已创建但 Qgents（GitHub App）看不到，需要用户到 GitHub App 安装设置里
 * 把个人账号纳入授权仓库范围后重新提交；不得引导用户重新绑定 OAuth。
 */
export function githubRepositoryNotAuthorizedMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  const body = error.body as { error?: { code?: string } } | undefined
  if (body?.error?.code !== GITHUB_REPOSITORY_NOT_AUTHORIZED) return null
  return '自动建仓已在 GitHub 创建仓库，但 Qgents 的 GitHub App 暂时看不到该仓库。请先到 GitHub App 的安装设置中，将你的个人账号加入授权仓库范围后，再重新提交自动建仓；无需重新绑定 GitHub OAuth。'
}

/**
 * 自动建仓提交后的后端错误码 → 中文提示（接口文档 §49.7 稳定错误码）。
 * 未命中的错误返回 null，由调用方回退到后端 message / formatApiError。
 */
export function newRepositoryCreateErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  const body = error.body as { error?: { code?: string } } | undefined
  const code = body?.error?.code
  switch (code) {
    case GITHUB_REPOSITORY_NOT_AUTHORIZED:
      return githubRepositoryNotAuthorizedMessage(error)
    case 'GITHUB_OAUTH_SCOPE_INSUFFICIENT':
      return '当前 GitHub OAuth 授权范围不足，无法创建该类型的个人仓库。请重新授权以获取 repo 范围后重试。'
    case 'GITHUB_PERSONAL_REPOSITORY_CREATE_FORBIDDEN':
      return '当前账号无权创建该个人仓库，请检查账号权限后重试。'
    case 'GITHUB_PERSONAL_REPOSITORY_CREATION_NOT_SUPPORTED':
      return '当前部署未配置个人 GitHub OAuth，无法创建个人仓库。请改用组织仓库，或联系管理员完成配置。'
    case 'GITHUB_OAUTH_TOKEN_INVALID':
      return '个人 GitHub 授权已失效，请重新绑定后重试。'
    case 'GITHUB_OAUTH_REQUIRED':
      return '创建个人 GitHub 仓库前请先绑定个人 GitHub 账号。'
    case 'GITHUB_OAUTH_REVOKED':
      return '个人 GitHub 授权已撤销，请重新绑定后重试。'
    case 'GITHUB_INSTALLATION_REQUIRED':
      return '团队存在多个 GitHub App 安装记录，请指定用于创建仓库的安装记录。'
    case 'GITHUB_INSTALLATION_NOT_ACTIVE':
      return '当前团队没有可用的 GitHub App 安装记录，无法自动创建仓库。'
    case 'GITHUB_REPOSITORY_CREATE_CONFLICT':
      return '仓库名已存在或与 GitHub 参数冲突，请更换仓库名称后重试。'
    default:
      return null
  }
}
