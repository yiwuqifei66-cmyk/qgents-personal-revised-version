/**
 * GitHub App 安装跳转 —— 类型（接口文档 §6）
 *
 * ============================================================================
 * 联调对照：README/Qgents接口文档.md →「6. GitHub App 与项目仓库」
 * ============================================================================
 */

/** 安装链接来源端：后端写入 state，callback 据此回跳 Web 或移动端 */
export type GithubInstallClient = 'WEB' | 'MOBILE'

/**
 * POST /teams/{teamId}/integrations/github/installations?client=WEB|MOBILE
 * 成功响应 data 字段（外层还有 { data, requestId } 信封）
 *
 * 文档示例：
 * {
 *   "data": {
 *     "installationUrl": "https://github.com/apps/qgents/installations/new?state=...",
 *     "expiresAt": "2026-08-10T11:00:00Z"
 *   }
 * }
 *
 * TODO[后端联调] 请与后端确认：
 * - installationUrl 是否一定是绝对 URL（含 https://）
 * - expiresAt 时区是否为 UTC（ISO-8601）
 * - state 参数是否由后端签名，前端切勿自行拼接安装链接
 * 已冻结见 docs：以上三项仍按文档执行；字段名以 github-backend-fields-needed.md / 前后端联调.md §6 为准。
 */
export interface GithubInstallationRedirect {
  /** 浏览器应整页跳转的 GitHub App 安装/管理地址 */
  installationUrl: string
  /** 该跳转链接的过期时间（ISO 字符串）；过期后需重新 POST */
  expiresAt: string
}

export type GithubInstallationStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'
export type GithubAccountType = 'USER' | 'ORGANIZATION'
export type GithubRepoVisibility = 'PUBLIC' | 'PRIVATE' | 'INTERNAL'
export type GithubAuthorizationStatus = 'AUTHORIZED' | 'REVOKED'

/**
 * GET /teams/{teamId}/integrations/github/installations 列表项
 * TODO[后端联调] 字段名以 Java DTO 为准，若不一致在此对齐
 * 已冻结见 docs：主键为本地 `id`；`providerInstallationId` 仅展示；status 不含 EXPIRED。
 *
 * accountType：安装时选的是个人账号(User)还是组织(Organization)
 */
export interface GithubInstallation {
  /** github_installations.id，Qgents 本地 UUID；绑定 / sync / 筛选用 */
  id: string//github安装id,Qgents 自己库里的安装记录 ID（本地 UUID）
  /** GitHub Installation 数字 ID，仅展示或排查，禁止写入绑定 body */
  providerInstallationId: number//github安装id,GitHub 那边的 Installation 数字 ID,拼 GitHub 配置页
  accountLogin: string//github账号
  accountType: GithubAccountType//github账号类型
  installedAt: string//github安装时间
  status: GithubInstallationStatus//github安装状态
  metadataSyncedAt: string//github安装元数据同步时间
  /**
   * 可选：后端若直接返回授权仓库数则可展示；没有则前端用 repositories 列表统计
   * 已冻结见 docs：第一版不返回 authorizedRepositoryCount，前端按 installationId 统计。
   */
  authorizedRepoCount?: number
}

/**
 * 团队已授权仓库（GitHub App 勾选范围内、可供绑定到项目的仓库）
 * GET /teams/{teamId}/integrations/github/repositories
 *
 * 文档路径是「团队级」一条列表，没有 /installations/{id}/repositories。
 * 产品上按「某个安装（个人/组织）」查看仓库是合理的：
 * - 联调请后端在每条仓库上带回 installationId，前端再按安装过滤
 * - 若暂时没有该字段，前端只能展示整队全部授权仓库
 *
 * TODO[后端联调] 请确认 Java DTO 是否包含：
 * - defaultBranch（默认分支名，如 main）
 * - syncStatus（SYNCED | NOT_SYNCED | SYNCING | FAILED）
 * 字段名若不同（如 default_branch / sync_status），在映射层对齐即可，页面逻辑不用大改
 * 已冻结见 docs：可见性用 visibility（不要 private 布尔）；元数据时间用 metadataSyncedAt；
 * 项目绑定 DTO 不要代码向 syncStatus / lastSyncedAt / syncError。授权仓用 authorizationStatus。
 */
export interface GithubAuthorizedRepository {
  /** github_repositories.id，Qgents 本地 UUID；绑定 body.repositoryId */
  id: string
  /** 归属哪一次 GitHub App 安装（本地 installation.id）；用于卡片「查看仓库」过滤 */
  installationId: string
  /** GitHub Repository 数字 ID，仅展示或排查，禁止写入绑定 body */
  providerRepositoryId: number
  fullName: string
  githubUrl: string
  /** 仓库默认分支；缺失时不得前端回退为 main，应禁用绑定并提示刷新 */
  defaultBranch?: string | null
  visibility: GithubRepoVisibility
  archived: boolean
  authorizationStatus: GithubAuthorizationStatus
  metadataSyncedAt: string
}

/** 项目已绑定仓库（GET/POST /projects/{projectId}/repositories） */
export interface ProjectBoundRepository {
  /** project_repositories.id；PATCH / DELETE / Task.repositoryIds 用此 id */
  id: string
  /** github_repositories.id（授权仓本地 UUID），不是 GitHub 数字 ID */
  repositoryId: string
  installationId: string
  providerRepositoryId: number
  fullName: string
  githubUrl: string
  displayName?: string
  defaultBranch: string
  authorizationStatus: GithubAuthorizationStatus
  metadataSyncedAt: string
  boundAt: string
}

/**
 * GET /projects/{projectId}/work-branches 行（接口文档 v2.0.8 §6.2）
 * 行的逻辑唯一键是 projectRepositoryId + name；后端不虚构“分支记录 UUID”。
 * latestTask / latestDiff / openMergeRequest / lastVerification 均可为 null，
 * 前端显示空状态，不得补演示数据。
 * 本接口不返回 GitHub 保护状态、冲突/落后状态、提交总数、构建产物或 MR 总数。
 */
export interface WorkBranch {
  /** project_repositories.id（绑定记录 UUID） */
  projectRepositoryId: string
  name: string
  workspaceId: string
  lastKnownHead: string
  /** 最近关联任务，不是分支唯一所有者 */
  latestTask: {
    id: string
    displayCode: string
    title: string
    updatedAt: string
  } | null
  /** 关联 Task 的需求群集合；工作分支不天然归属单个需求群 */
  requirementGroups: Array<{ id: string; title: string }>
  /** 该工作分支历史上最近的真实 Diff 快照 */
  latestDiff: {
    id: string
    taskId: string
    status: string
    changeStats: { additions: number; deletions: number }
    createdAt: string
  } | null
  /** 同一项目仓库绑定和源分支的 Open MR；不存在时为 null */
  openMergeRequest: {
    id: string
    number: number
    status: string
  } | null
  /** 仅在已完成 TestRun 的 executionSourceRef 与 lastKnownHead 完全一致时返回；否则为 null */
  lastVerification: {
    kind: string
    status: string
    commitSha: string
    completedAt: string
  } | null
}

/** GET /projects/{projectId}/work-branches 查询参数（§6.2） */
export interface WorkBranchListFilters {
  repositoryId?: string
  requirementGroupId?: string
  cursor?: string
  limit?: number
}

/**
 * 远程分支 —— 接口文档 §6 + 分支管理前后端执行计划
 * GET /projects/{projectId}/repositories/{projectRepositoryId}/branches
 *
 * 与 WorkBranch 不同：
 * - RemoteBranch 来自 GitHub 真实远程分支
 * - WorkBranch 来自 Qgents Task/Workspace 工作分支视图
 * - main/develop 可以是 RemoteBranch 但不是 WorkBranch
 *
 * 【字段说明 · 映射自真实后端 RemoteBranchResponse】
 *  name            ← 后端 name
 *  headCommit      ← 后端 commitSha（前端历史别名）
 *  isProjectDefault ← 后端 projectDefault（前端历史别名）
 *  isGithubDefault  ← 后端 githubDefault（前端历史别名）
 *  canCreateTaskFrom / canDelete：后端首期未返回，映射层按语义补默认值
 */
export interface RemoteBranch {
  name: string
  headCommit: string
  isProjectDefault: boolean
  isGithubDefault: boolean
  canCreateTaskFrom: boolean
  canDelete: boolean
}

/** 创建远程分支请求 */
export interface CreateRemoteBranchPayload {
  name: string
  /** 来源分支名或完整 commit SHA；后端会先解析为真实 SHA 再创建 refs/heads */
  fromRef: string
}

/**
 * 远程分支列表筛选参数
 * 注意：后端（GitHubRepositoryController.listRemoteBranches）首期暂不支持 keyword/cursor/limit/includeSha，
 *       传参将被忽略；保留该类型以兼容未来分页扩展，调用方不要依赖过滤行为。
 */
export interface RemoteBranchListFilters {
  keyword?: string
  cursor?: string
  limit?: number
  includeSha?: boolean
}

/**
 * POST /projects/{projectId}/repositories 请求体
 * 已冻结见 docs：只传本地 UUID；defaultBranch 省略，后端以授权仓元数据为准。
 */
export interface BindProjectRepositoryPayload {
  installationId: string
  repositoryId: string
  displayName?: string
}

/**
 * PATCH /projects/{projectId}/repositories/{projectRepositoryId} 请求体
 *
 * 【后端真实契约（UpdateProjectRepositoryRequest.java）】
 * - defaultBranch 加了 @NotBlank，强制必填；如果只想修改 displayName，也必须把当前 defaultBranch
 *   一起带上，否则 400。服务端 service 会先调用 GitHub 校验该分支真实存在。
 * - displayName 可选；但服务端当前 setDisplayName(request.getDisplayName()) 会把 null 写入 DB，
 *   调用方若想保持 displayName 不变，需要把原值带上。
 */
export interface UpdateProjectRepositoryPayload {
  defaultBranch: string
  displayName?: string
}

/** 仅允许绑定：已授权、未归档、默认分支非空、对应 Installation 为 ACTIVE */
export function isGithubRepoBindable(
  repo: GithubAuthorizedRepository,
  installation: GithubInstallation | undefined,
): boolean {
  return (
    repo.authorizationStatus === 'AUTHORIZED' &&
    repo.archived === false &&
    Boolean(repo.defaultBranch && repo.defaultBranch.trim()) &&
    installation?.status === 'ACTIVE'
  )
}

/**
 * GitHub App 已安装配置页（勾选仓库 / 底部也可卸载）。
 * 文档未返回 configure URL，用 providerInstallationId 拼接；绑定请求不得使用该数字 ID。
 */
export function githubInstallationConfigureUrl(
  installation: Pick<GithubInstallation, 'accountType' | 'accountLogin' | 'providerInstallationId'>,
): string | null {
  if (!Number.isInteger(installation.providerInstallationId) || installation.providerInstallationId <= 0) {
    return null
  }
  const id = String(installation.providerInstallationId)
  if (installation.accountType === 'ORGANIZATION') {
    return `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${id}`
  }
  return `https://github.com/settings/installations/${id}`
}

const GITHUB_APP_SLUG = 'qgents'

/**
 * 「安装 GitHub App」只允许跳到 /apps/{slug}/installations/new。
 * 已装过的账号也走 new，由 GitHub 自己提示 already installed。
 * 后端若误回 Configure，这里改回 new，并保留 state 给回调。
 */
export function toGithubAppInstallNewUrl(installationUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(installationUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null

  if (/^\/apps\/[^/]+\/installations\/new(?:\/.*)?$/.test(parsed.pathname)) {
    return parsed.toString()
  }

  const slugMatch = parsed.pathname.match(/^\/apps\/([^/]+)\//)
  const slug = slugMatch?.[1] || GITHUB_APP_SLUG
  const next = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`)
  const state = parsed.searchParams.get('state')
  if (state) next.searchParams.set('state', state)
  return next.toString()
}

/**
 * 把后端 ISO 时间转成「年月日时分秒」。
 * 没有时区的字符串按 UTC 解析（联调常见 2026-08-16T03:24:56.030514），再显示为北京时间。
 */
export function formatGithubDateTime(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return '—'
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  const date = new Date(hasZone ? trimmed : `${trimmed}Z`)
  if (Number.isNaN(date.getTime())) return trimmed

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}年${pick('month')}月${pick('day')}日 ${pick('hour')}时${pick('minute')}分${pick('second')}秒`
}

/** 卡片「N 个仓库已授权」：只统计 AUTHORIZED，已撤销不计入 */
export function countAuthorizedRepositories(
  installationId: string,//这个就是安装记录里的安装ID
  repositories: Array<Pick<GithubAuthorizedRepository, 'installationId' | 'authorizationStatus'>>,//不需要完整的仓库对象，只需要 2 个字段即可运行函数
): number {//github 授权仓库的安装id
  return repositories.filter(
    (repo) => repo.installationId === installationId && repo.authorizationStatus === 'AUTHORIZED',
  ).length
}

// ============================================================================
// 项目内"新建仓库并绑定" —— 接口文档 v2.0.19 §44
// ============================================================================

/** 新建仓库在远端创建时的状态机 */
export type NewRepositoryStatus = 'CREATING' | 'READY' | 'FAILED'

/**
 * POST /projects/{projectId}/repositories/new 请求体
 *
 * 字段约束（前端表单层做校验，后端兜底返回 422）：
 * - name：必填，长度 1-100，GitHub 仓库名规则 /^[a-zA-Z0-9_.-]+$/
 * - description：可选，最长 500 字符
 * - private：默认 true（私有）
 * - installationId：当团队有多个 ACTIVE Installation 时必填；只有一个时也必须传
 * - displayName：可选，缺省取 name
 *
 * 注意：禁止把 defaultBranch / sourceBranch 等任何分支相关字段写入 body，
 *       后端会自动初始化 README，分支由 GitHub 默认规则产生。
 */
export interface ProjectRepositoryCreateNewInput {
  name: string
  description?: string
  /** 是否私有仓库，默认 true */
  private?: boolean
  /** Qgents 本地 Installation.id（不是 GitHub 数字 ID） */
  installationId: string
  /** 项目内显示名，缺省取 name */
  displayName?: string
}

/**
 * POST /projects/{projectId}/repositories/new 成功响应
 *
 * 后端可能返回 202（CREATING，需要轮询/SSE 才能拿到 READY）或 201（READY，已建好）。
 * 前端映射层做兜底，缺字段不崩。
 */
export interface ProjectRepositoryCreateNewResponse {
  /** project_repositories.id（绑定记录 UUID） */
  id: string
  /** github_repositories.id（本地 UUID） */
  repositoryId: string
  installationId: string
  fullName: string
  githubUrl: string
  /** GitHub 默认分支；CREATING 状态下可能为 null（README 初始化尚未完成） */
  defaultBranch: string | null
  displayName?: string
  status: NewRepositoryStatus
  failureCode?: string | null
  failureReason?: string | null
  createdAt: string
}

/** GitHub 仓库名规则：字母数字下划线连字符点，1-100 字符 */
export const GITHUB_REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/

/** 仓库名最大长度 */
export const GITHUB_REPO_NAME_MAX = 100

/** 仓库描述最大长度 */
export const GITHUB_REPO_DESC_MAX = 500

/** 项目内显示名最大长度 */
export const PROJECT_REPO_DISPLAY_NAME_MAX = 60
