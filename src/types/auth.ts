/**
 * 认证相关类型 —— 对齐接口文档 v1.1.4 §4、§4.1
 */

/** 当前登录用户 */
export interface User {
  id: string
  email: string
  displayName: string
  avatarUrl?: string
  /** 展示用首字，如「陈」 */
  avatarChar?: string
}

// ──── 请求体 ────

/** POST /auth/login 请求体 */
export interface LoginPayload {
  email: string
  /** Base64(RSA-PKCS1-v1_5(明文密码)) */
  password: string
  /** 固定值，与前端硬编码的公钥 keyId 一致 */
  passwordKeyId: string
}

/** POST /auth/register 请求体 */
export interface RegisterPayload {
  email: string
  /** Base64(RSA-PKCS1-v1_5(明文密码)) */
  password: string
  /** 固定值，与前端硬编码的公钥 keyId 一致 */
  passwordKeyId: string
  displayName: string
  /** 邮箱验证码（§11.2：必填，长度固定 6 位数字；注册事务内校验一次，失败重试需重新获取） */
  verificationCode: string
}

// ──── 响应体（已解包 data 层）────

/** POST /auth/login 或 /auth/register 成功响应 */
export interface AuthResponse {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresIn: number
  user: User
}

/** POST /auth/refresh 响应 */
export interface RefreshResponse {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresIn: number
}

/** POST /me/avatar/credential 响应（§4 头像直传凭证，流程镜像 §18.1 附件凭证） */
export interface AvatarCredential {
  /** 对象键 avatars/{userId}/{uuid}.{ext}，confirm 时原样回传，客户端不得自造 */
  objectKey: string
  /** 预签名 PUT 地址，直接把文件字节 PUT 到此 */
  uploadUrl: string
  method: 'PUT'
  expiresAt: string
  headers: Record<string, string>
}

/** PATCH /me 请求体（§4 修改昵称和头像） */
export interface UpdateMePayload {
  displayName?: string
  avatarUrl?: string
}

/** POST /me/integrations/github/oauth/start 响应（接口文档 §49.2） */
export interface GithubOAuthStartResponse {
  authorizationUrl: string
  expiresAt: string
}

/**
 * 个人仓库开通前置状态（接口文档 §49.4）。
 * 决定创建项目页「自动建仓」入口的展示与引导：
 * - NOT_OWNER：不是任何团队 Owner，隐藏自动建仓
 * - NEED_INSTALLATION：缺少 USER 类型 GitHub App 安装，先装 App
 * - NEED_OAUTH：已有 USER 安装但未绑定 OAuth
 * - ACCOUNT_MISMATCH：OAuth 账号与 USER 安装账号不一致（配合 expectedInstallationLogin）
 * - READY：账号一致且授权可用，允许自动建仓
 */
export type GithubPersonalRepositorySetup =
  | 'NOT_OWNER'
  | 'NEED_INSTALLATION'
  | 'NEED_OAUTH'
  | 'ACCOUNT_MISMATCH'
  | 'READY'

/** GET /me/integrations/github/oauth 响应（接口文档 §49.4） */
export interface GithubOAuthStatus {
  authorized: boolean
  provider: 'GITHUB' | null
  githubUserId: number | null
  githubLogin: string | null
  scopes: string[]
  authorizedAt: string | null
  lastValidatedAt: string | null
  /** 是否可用个人 OAuth 创建公开仓库（后端按授权 scope 计算；前端不得自行解析 scopes） */
  canCreatePublicPersonalRepository: boolean
  /** 是否可用个人 OAuth 创建私有仓库（后端按授权 scope 计算；前端不得自行解析 scopes） */
  canCreatePrivatePersonalRepository: boolean
  /** 个人仓库开通前置状态；字段缺失时前端退回按 authorized+账号一致性判断 */
  personalRepositorySetup: GithubPersonalRepositorySetup | null
  /** 仅 ACCOUNT_MISMATCH 时有值：应绑定的 GitHub 账号 login；只用于前端引导，不是安全边界 */
  expectedInstallationLogin: string | null
}

/** GET /me 响应（data 层为聚合结构：user + teams + projects） */
export interface MeResponse {
  user: User
  teams: Array<{ id: string; name: string; role: string }>
  projects: Array<{ id: string; teamId: string; name: string; role: string }>
}
