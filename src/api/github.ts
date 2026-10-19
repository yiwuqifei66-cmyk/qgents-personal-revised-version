import { request } from './client'
import { withQuery } from './requestHelpers'
import type {
  BindProjectRepositoryPayload,
  CreateRemoteBranchPayload,
  GithubAccountType,
  GithubAuthorizationStatus,
  GithubInstallClient,
  GithubInstallation,
  GithubInstallationRedirect,
  GithubInstallationStatus,
  GithubAuthorizedRepository,
  GithubRepoVisibility,
  NewRepositoryStatus,
  ProjectBoundRepository,
  ProjectRepositoryCreateNewInput,
  ProjectRepositoryCreateNewResponse,
  RemoteBranch,
  RemoteBranchListFilters,
  UpdateProjectRepositoryPayload,
  WorkBranch,
  WorkBranchListFilters,
} from '@/types/github'
import type { TaskModelPage } from '@/types/task-model'

/** 接口文档统一成功响应外壳：{ data, requestId } */
interface ApiEnvelope<T> {
  data: T
  requestId?: string
}
//A is B 是 TS 独有的【类型守卫语法】，它的意思：
//如果这个函数返回 true，我向 TS 保证：value 就是 Record<string, unknown> 类型
//类型守卫进行TS类型的收窄
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}//保证传入的是一个对象
// 收窄成对象那种Record<string, unknown>（{ [key:string]: unknown }）

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? value : ''
}//保证把传入对象的值取出来并返回一个字符串

function readNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key]
  return typeof value === 'number' ? value : Number(value) || 0
}

function readBool(raw: Record<string, unknown>, key: string): boolean {
  return raw[key] === true
}

function mapAccountType(value: unknown): GithubAccountType {
  const normalized = String(value).toUpperCase()
  return normalized === 'ORGANIZATION' ? 'ORGANIZATION' : 'USER'
}

function mapInstallationStatus(value: unknown): GithubInstallationStatus {
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'DELETED') return value
  // 已冻结见 docs：不含 EXPIRED；未知值不当成 ACTIVE，避免误开绑定
  return 'SUSPENDED'
}

function mapVisibility(value: unknown): GithubRepoVisibility {
  if (value === 'PUBLIC' || value === 'PRIVATE' || value === 'INTERNAL') return value
  return 'PRIVATE'
}

function mapAuthorizationStatus(value: unknown): GithubAuthorizationStatus {
  return value === 'REVOKED' ? 'REVOKED' : 'AUTHORIZED'
}

function mapInstallation(raw: unknown): GithubInstallation {
  const row = isRecord(raw) ? raw : {}
  return {
    id: readString(row, 'id'),
    providerInstallationId: readNumber(row, 'providerInstallationId'),
    accountLogin: readString(row, 'accountLogin'),
    accountType: mapAccountType(row.accountType),
    installedAt: readString(row, 'installedAt'),
    status: mapInstallationStatus(row.status),
    metadataSyncedAt: readString(row, 'metadataSyncedAt'),
  }
}

function mapAuthorizedRepository(raw: unknown): GithubAuthorizedRepository {
  const row = isRecord(raw) ? raw : {}
  const defaultBranchRaw = row.defaultBranch
  const defaultBranch =
    typeof defaultBranchRaw === 'string' && defaultBranchRaw.trim()
      ? defaultBranchRaw
      : null
  return {
    id: readString(row, 'id'),
    installationId: readString(row, 'installationId'),
    providerRepositoryId: readNumber(row, 'providerRepositoryId'),
    fullName: readString(row, 'fullName'),
    githubUrl: readString(row, 'githubUrl'),
    defaultBranch,
    visibility: mapVisibility(row.visibility),
    archived: readBool(row, 'archived'),
    authorizationStatus: mapAuthorizationStatus(row.authorizationStatus),
    metadataSyncedAt: readString(row, 'metadataSyncedAt'),
  }
}
// 后端接口返回原始 JSON → 前端 TS 类型对象的转换 / 安全映射函数。
function mapProjectBoundRepository(raw: unknown): ProjectBoundRepository {
  const row = isRecord(raw) ? raw : {}//如果返回的是true 那他就是一个对象,那我就直接返回那个raw
  return {
    id: readString(row, 'id'),
    repositoryId: readString(row, 'repositoryId'),
    installationId: readString(row, 'installationId'),
    providerRepositoryId: readNumber(row, 'providerRepositoryId'),
    fullName: readString(row, 'fullName'),
    githubUrl: readString(row, 'githubUrl'),
    displayName: readString(row, 'displayName') || undefined,
    defaultBranch: readString(row, 'defaultBranch'),
    authorizationStatus: mapAuthorizationStatus(row.authorizationStatus),
    metadataSyncedAt: readString(row, 'metadataSyncedAt'),
    boundAt: readString(row, 'boundAt'),
  }
}

function mapNewRepositoryStatus(value: unknown): NewRepositoryStatus {
  if (value === 'CREATING' || value === 'READY' || value === 'FAILED') return value
  return 'CREATING'
}

/**
 * POST /projects/{projectId}/repositories/new 响应映射
 * 兼容字段：
 * - repositoryId 可能叫 githubRepositoryId（v2.0.19 §44 待联调）
 * - defaultBranch CREATING 阶段可能为 null
 * - failureCode/failureReason 仅 FAILED 时有值，否则 null
 */
function mapNewProjectRepository(raw: unknown): ProjectRepositoryCreateNewResponse {
  const row = isRecord(raw) ? raw : {}
  const defaultBranchRaw = row.defaultBranch
  const defaultBranch =
    typeof defaultBranchRaw === 'string' && defaultBranchRaw.trim()
      ? defaultBranchRaw
      : null
  const repoId = readString(row, 'repositoryId') || readString(row, 'githubRepositoryId')
  return {
    id: readString(row, 'id'),
    repositoryId: repoId,
    installationId: readString(row, 'installationId'),
    fullName: readString(row, 'fullName'),
    githubUrl: readString(row, 'githubUrl'),
    defaultBranch,
    displayName: readString(row, 'displayName') || undefined,
    status: mapNewRepositoryStatus(row.status),
    failureCode: typeof row.failureCode === 'string' ? row.failureCode : null,
    failureReason: typeof row.failureReason === 'string' ? row.failureReason : null,
    createdAt: readString(row, 'createdAt'),
  }
}

/**
 * 后端 RemoteBranchResponse → 前端 RemoteBranch
 *
 * 【真实后端契约（RemoteBranchResponse.java）】
 *  name: string
 *  commitSha: string              ← 前端别名 headCommit
 *  githubDefault: boolean         ← 前端别名 isGithubDefault
 *  projectDefault: boolean        ← 前端别名 isProjectDefault
 *  后端首期无 canCreateTaskFrom / canDelete 字段：按语义补默认值
 */
function mapRemoteBranch(raw: unknown): RemoteBranch {
  const row = isRecord(raw) ? raw : {}
  // 兼容两种写法：后端原生（commitSha/projectDefault/githubDefault）和文档旧字段名（headCommit/isProjectDefault/isGithubDefault）
  const commitSha = readString(row, 'commitSha') || readString(row, 'headCommit')
  const githubDefault = readBool(row, 'githubDefault') || readBool(row, 'isGithubDefault')
  const projectDefault = readBool(row, 'projectDefault') || readBool(row, 'isProjectDefault')
  return {
    name: readString(row, 'name'),
    headCommit: commitSha,
    isProjectDefault: projectDefault,
    isGithubDefault: githubDefault,
    // 只要分支真实存在就可以作为创建任务的基线（首期没有删除/归档保护时，保持 true）
    canCreateTaskFrom: true,
    // 首期不开放删除能力（执行计划 阶段 E），保持 false 让组件禁用删除按钮
    canDelete: false,
  }
}

function asList(data: unknown): unknown[] {
  return Array.isArray(data) ? data : []
}

function idempotencyHeaders(): Record<string, string> {
  return { 'Idempotency-Key': crypto.randomUUID() }//返回一个请求头
}

/**
 * GitHub App 与项目仓库 —— 接口文档 §6
 *
 * ============================================================================
 * 【安装 GitHub App 全链路 — 前后端如何配合】
 *
 * ① 前端（Team Owner）点击「安装Github App」
 *    → 调用本文件 createInstallation(teamId)
 *    → POST /teams/{teamId}/integrations/github/installations?client=WEB
 *    → client 只允许 WEB | MOBILE，禁止传 returnUrl / 完整域名
 *    → 请求头需带 Authorization: Bearer <token>
 *    → 写操作需带 Idempotency-Key（文档要求）
 *
 * ② 后端生成带 state 的 GitHub 安装 URL，返回：
 *    { data: { installationUrl, expiresAt }, requestId }
 *
 * ③ 前端拿到 installationUrl 后：window.location.assign(installationUrl)
 *    （必须整页跳转，不能只开弹窗；前端不拼 GitHub URL、不持有凭据）
 *
 * ④ 用户在 GitHub 官网完成 App 安装 / 勾选仓库
 *
 * ⑤ GitHub 浏览器回调后端（前端不直接调这个接口）：
 *    GET /integrations/github/callback
 *    后端校验 state、落库 installation 元数据与授权仓库范围
 *
 * ⑥ 后端再 302 回前端：
 *    成功：/app/integrations/github?teamId=xxx&installed=1
 *    归属冲突：...&installed=0&conflict=GITHUB_INSTALLATION_TEAM_CONFLICT&message=...
 *    前端根据参数提示成功或错误，并刷新列表
 *
 * 【权限】createInstallation / listInstallations：Team Owner
 * 【联调开关】
 * - Mock：.env 中 VITE_USE_MOCK=true（MSW 拦截，见 src/mocks/handlers.ts）
 * - 真后端：VITE_USE_MOCK=false，并在 vite.config.ts 打开 /api 代理
 * ============================================================================
 */
export const githubApi = {
  /**
   * 生成 GitHub App 安装跳转地址
   *
   * METHOD: POST
   * PATH:   /teams/{teamId}/integrations/github/installations?client=WEB
   * AUTH:   Team Owner（Bearer Token）
   *
   * @param teamId 当前团队 ID（从团队详情页 URL / 上下文传入）
   * @param client 回跳端标记；Web 固定 WEB，移动端传 MOBILE。后端写入 state。
   * @returns data.installationUrl / data.expiresAt
   *
   * TODO[后端联调] 常见失败码（以文档为准，联调时对照实际返回）：
   * - 401 未登录 / Token 失效
   * - 403 非 Team Owner（TEAM_OWNER 权限不足）
   * - 404 团队不存在
   * - 409 Idempotency-Key 复用但 body 不同
   * - 429 / 500 限流或服务异常
   * 已冻结见 docs：写接口必须带 Idempotency-Key；错误码见 github-backend-fields-needed.md §8。
   */
  createInstallation(teamId: string, client: GithubInstallClient = 'WEB') {
    // 每次点击生成新的幂等键，避免用户连点被当成「相同写操作」
    const idempotencyKey = crypto.randomUUID()//浏览器原生 API，生成一个唯一 UUID

    return request<ApiEnvelope<GithubInstallationRedirect>>(
      `/teams/${teamId}/integrations/github/installations?client=${encodeURIComponent(client)}`,
      {
        method: 'POST',
        unwrapData: false,//自己进行解包
        // 文档：写操作必须支持 Idempotency-Key
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        // body 可为空；若后端要求 {}，联调时在此补 body: {}
      },
    ).then((res) => {
      // 解开信封，页面侧只使用 data
      return res.data
    })
  },

  /**
   * 查询团队已安装的 GitHub App 列表
   * GET /teams/{teamId}/integrations/github/installations
   * 权限：Team Owner
   *
   * 用途：安装回调返回本页后，可用来刷新「是否已安装」状态
   * （当前 UI 已去掉授权状态卡片，此方法仍供联调 / 后续扩展）
   */
  listInstallations(teamId: string) {
    return request<ApiEnvelope<unknown>>(//TS泛型用来约束返回数据类型：
      `/teams/${teamId}/integrations/github/installations`,
      { unwrapData: false },
    ).then((res) => asList(res.data).map(mapInstallation))
  },//数组的 map：遍历数组里每一项，把每一项传给函数 fn，用返回值拼成新数组

  /**
   * DELETE /teams/{teamId}/integrations/github/installations/{installationId}
   * 权限：Team Owner。成功 204。
   * 路径 {installationId} 为本地 UUID。只解除本团队与 Installation 的本地关联，
   * 后端不得调用 GitHub Uninstall。项目仓库仍绑定时 409 GITHUB_INSTALLATION_IN_USE。
   * 前端成功后再 GET 列表。从 GitHub 卸载走 Configure 页，不要复用本接口。
   */
  deleteInstallation(teamId: string, installationId: string) {
    return request<void>(`/teams/${teamId}/integrations/github/installations/${installationId}`, {
      method: 'DELETE',
      headers: idempotencyHeaders(),
    })
  },

  /**
   * POST /teams/{teamId}/integrations/github/installations/{installationId}/sync
   * 已冻结见 docs：{installationId} 为本地 UUID；只刷新元数据，成功后重新 GET 列表。
   */
  syncInstallation(teamId: string, installationId: string) {
    return request<ApiEnvelope<unknown>>(
      `/teams/${teamId}/integrations/github/installations/${installationId}/sync`,
      {
        method: 'POST',
        unwrapData: false,
        headers: idempotencyHeaders(),
      },
    ).then((res) => mapInstallation(res.data))
  },

  /** GET /teams/{teamId}/integrations/github/repositories */
  listTeamRepositories(teamId: string) {
    return request<ApiEnvelope<unknown>>(
      `/teams/${teamId}/integrations/github/repositories`,
      { unwrapData: false },
    ).then((res) => asList(res.data).map(mapAuthorizedRepository))
  }, //只要请求回来的仓库数组
  //拉项目的仓库
  /** GET /projects/{projectId}/repositories */
  listProjectRepositories(projectId: string) {
    return request<ApiEnvelope<unknown>>(
      `/projects/${projectId}/repositories`,
      { unwrapData: false },
    ).then((res) => asList(res.data) as ProjectBoundRepository[])
  },

  /**
   * POST /projects/{projectId}/repositories
   * 已冻结见 docs：body 只传本地 installationId / repositoryId；不传 provider 数字 ID，不传 defaultBranch。
   */
  bindRepository(projectId: string, payload: BindProjectRepositoryPayload) {
    const body: BindProjectRepositoryPayload = {
      installationId: payload.installationId,
      repositoryId: payload.repositoryId,
    }
    if (payload.displayName) body.displayName = payload.displayName

    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/repositories`, {
      method: 'POST',
      unwrapData: false,
      body,
      headers: idempotencyHeaders(),
    }).then((res) => mapProjectBoundRepository(res.data))
  },

  /**
   * PATCH /projects/{projectId}/repositories/{projectRepositoryId}
   * 已冻结见 docs：路径 ID 为绑定记录 id。
   *
   * 【后端真实契约】defaultBranch 是 @NotBlank，调用时必须提供；服务端会先去 GitHub
   * 实时校验该分支存在，再更新绑定记录的 default_branch。displayName 不传就发送
   * null/undefined（后端 Service 实现会 setDisplayName(null)，所以调用方需要保留
   * 原值时要一并带上 displayName）。
   */
  updateProjectRepository(
    projectId: string,
    projectRepositoryId: string,
    payload: UpdateProjectRepositoryPayload,
  ) {
    return request<ApiEnvelope<unknown>>(
      `/projects/${projectId}/repositories/${projectRepositoryId}`,
      {
        method: 'PATCH',
        unwrapData: false,
        body: payload,
        headers: idempotencyHeaders(),
      },
    ).then((res) => mapProjectBoundRepository(res.data))
  },

  /**
   * DELETE /projects/{projectId}/repositories/{projectRepositoryId}
   * 已冻结见 docs：路径 ID 为绑定记录 id；成功 204，随后重新 GET。
   */
  unbindRepository(projectId: string, projectRepositoryId: string) {
    return request<void>(`/projects/${projectId}/repositories/${projectRepositoryId}`, {
      method: 'DELETE',
      headers: idempotencyHeaders(),
    })
  },

  /**
   * POST /projects/{projectId}/repositories/new —— 项目内"新建仓库并绑定"
   * 接口文档 v2.0.19 §44
   *
   * 【权限】TEAM_OWNER（项目管理员不可建仓，只能绑定已有仓库）
   * 【幂等】每次"新建操作"生成一次 UUID 作为 Idempotency-Key，
   *       弹窗打开时生成、多次提交沿用同一 key、关闭时清空，
   *       防止用户连点或网络重试时 GitHub 端创建多个仓库。
   * 【响应】后端可能返回 201（READY，已建好）或 202（CREATING，需轮询/SSE）。
   *
   * @param idempotencyKey 由调用方稳定持有的 UUID；调用方不要每次自己生成新值
   */
  createNewProjectRepository(
    projectId: string,
    input: ProjectRepositoryCreateNewInput,
    idempotencyKey: string,
  ): Promise<ProjectRepositoryCreateNewResponse> {
    const body: ProjectRepositoryCreateNewInput = {
      name: input.name,
      installationId: input.installationId,
    }
    if (input.description !== undefined) body.description = input.description
    if (input.private !== undefined) body.private = input.private
    if (input.displayName !== undefined) body.displayName = input.displayName

    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/repositories/new`, {
      method: 'POST',
      unwrapData: false,
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    }).then((res) => mapNewProjectRepository(res.data))
  },

  /**
   * GET /projects/{projectId}/work-branches — 项目工作分支视图（接口文档 v2.0.8 §6.2）。
   * 支持 repositoryId / requirementGroupId / cursor / limit 过滤；统一游标分页外壳。
   * 前端只消费真实字段，latestTask/latestDiff/openMergeRequest/lastVerification 为 null 时显示空状态。
   */
  workBranches(projectId: string, filters: WorkBranchListFilters = {}) {
    return request<TaskModelPage<WorkBranch>>(
      withQuery(`/projects/${projectId}/work-branches`, filters),
      { unwrapData: false },
    )
  },

  /**
   * GET /projects/{projectId}/repositories/{projectRepositoryId}/branches
   * 查询 GitHub 远程分支列表（接口文档 §6 + 分支管理计划 阶段 B）。
   * 支持 keyword / cursor / limit / includeSha 过滤。
   */
  listRemoteBranches(
    projectId: string,
    projectRepositoryId: string,
    filters: RemoteBranchListFilters = {},
  ) {
    const query: Record<string, string> = {}
    if (filters.keyword) query.keyword = filters.keyword
    if (filters.cursor) query.cursor = filters.cursor
    if (filters.limit) query.limit = String(filters.limit)
    if (filters.includeSha !== undefined) query.includeSha = String(filters.includeSha)
    return request<ApiEnvelope<unknown>>(
      withQuery(`/projects/${projectId}/repositories/${projectRepositoryId}/branches`, query),
      { unwrapData: false },
    ).then((res) => asList(res.data).map(mapRemoteBranch))
  },

  /**
   * POST /projects/{projectId}/repositories/{projectRepositoryId}/branches
   * 从已有分支或提交创建远程分支（分支管理计划 阶段 C）。
   * 需 PROJECT_ADMIN 权限；使用幂等键防重复创建。
   */
  createRemoteBranch(
    projectId: string,
    projectRepositoryId: string,
    payload: CreateRemoteBranchPayload,
  ) {
    return request<ApiEnvelope<unknown>>(
      `/projects/${projectId}/repositories/${projectRepositoryId}/branches`,
      {
        method: 'POST',
        unwrapData: false,
        body: payload,
        headers: idempotencyHeaders(),
      },
    ).then((res) => mapRemoteBranch(res.data))
  },
}
