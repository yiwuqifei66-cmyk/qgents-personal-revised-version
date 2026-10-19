# 项目内新建仓库并绑定 —— 后端接口契约

> 版本：v2.0.19 §44 新增  
> 前端已就绪，后端需实现以下接口即可联通。  
> 工作区：`web/src` 已完成，后端代码不做改动。

---

## 1. 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects/{projectId}/repositories/new` | 在指定项目内新建一个 GitHub 仓库并自动绑定 |

---

## 2. 请求

### 2.1 Headers

| Header | 必选 | 说明 |
|--------|------|------|
| `Authorization` | ✅ | `Bearer {accessToken}` |
| `Content-Type` | ✅ | `application/json` |
| `Idempotency-Key` | ✅ | `UUID v4`，客户端生成；防止重复提交导致创建多个仓库 |

### 2.2 Path Parameters

| 参数 | 类型 | 说明 |
|------|------|------|
| `projectId` | `string (UUID)` | 项目 ID |

### 2.3 Request Body

```json
{
  "name": "demo-service",
  "description": "仓库简介",
  "private": true,
  "installationId": "gh-install-1001",
  "displayName": "demo"
}
```

| 字段 | 类型 | 必选 | 约束 | 说明 |
|------|------|------|------|------|
| `name` | `string` | ✅ | 1–100 字符；正则 `^[a-zA-Z0-9_.-]+$` | GitHub 仓库名（不含 owner，由 installation 的 accountLogin 拼接前缀） |
| `description` | `string` | ❌ | ≤ 500 字符 | 仓库描述，留空则传 `null` 或省略 |
| `private` | `boolean` | ❌ | 默认 `true` | 是否私有仓库 |
| `installationId` | `string` | ✅ | 有效 ACTIVE Installation 本地 UUID | 归属该安装的账号/组织创建仓库 |
| `displayName` | `string` | ❌ | ≤ 60 字符 | 项目内显示名；缺省 = `name` |

---

## 3. 响应

### 3.1 成功 — 仓库已就绪（201 CREATED）

```json
{
  "data": {
    "id": "bound-proj-001-new-1724137900",
    "repositoryId": "repo-new-1724137900",
    "installationId": "gh-install-1001",
    "fullName": "qgents-lab/demo-service",
    "githubUrl": "https://github.com/qgents-lab/demo-service",
    "defaultBranch": "main",
    "displayName": "demo",
    "status": "READY",
    "failureCode": null,
    "failureReason": null,
    "createdAt": "2026-08-20T12:00:00Z"
  },
  "requestId": "req_new_repo_001"
}
```

### 3.2 成功 — 仓库创建中（202 ACCEPTED）

```json
{
  "data": {
    "id": "bound-proj-001-new-1724137900",
    "repositoryId": "repo-new-1724137900",
    "installationId": "gh-install-1001",
    "fullName": "qgents-lab/demo-service",
    "githubUrl": "https://github.com/qgents-lab/demo-service",
    "defaultBranch": null,
    "displayName": "demo",
    "status": "CREATING",
    "failureCode": null,
    "failureReason": null,
    "createdAt": "2026-08-20T12:00:00Z"
  },
  "requestId": "req_new_repo_001"
}
```

### 3.3 失败响应

所有失败响应使用统一 envelope：

```json
{
  "data": null,
  "error": {
    "code": "错误码",
    "message": "可读描述"
  }
}
```

| HTTP | error.code | 场景 |
|------|------------|------|
| 400 | `INVALID_INPUT` | name 为空或不符合正则 |
| 400 | `INVALID_INPUT` | installationId 无效 |
| 401 | `UNAUTHENTICATED` | 未登录 |
| 403 | `FORBIDDEN` | 用户非 TEAM_OWNER |
| 409 | `PROJECT_REPOSITORY_SOURCE_CONFLICT` | 同时提交了「绑定已有仓库」和「新建仓库」（业务冲突） |
| 422 | `GITHUB_API_ERROR` | GitHub API 返回错误 |
| 422 | `REPOSITORY_NAME_TAKEN` | GitHub 上同名仓库已存在 |
| 500 | `INTERNAL_ERROR` | 未知服务端异常 |

---

## 4. 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 绑定记录本地 UUID（= `project_repositories.id`） |
| `repositoryId` | `string` | 授权仓库本地 UUID（= `github_repositories.id`） |
| `installationId` | `string` | Installation 本地 UUID |
| `fullName` | `string` | GitHub `{owner}/{name}` 格式 |
| `githubUrl` | `string` | 仓库 HTTPS 地址 |
| `defaultBranch` | `string \| null` | READY 时有值；CREATING 时为 `null`（等初始化完成后由 metadata sync 回填） |
| `displayName` | `string \| null` | 项目内显示名；未指定时为 `null`（前端显示时回落 `name`） |
| `status` | `'CREATING' \| 'READY' \| 'FAILED'` | 仓库创建状态机 |
| `failureCode` | `string \| null` | FAILED 时填充错误码 |
| `failureReason` | `string \| null` | FAILED 时填充可读原因 |
| `createdAt` | `string` | ISO-8601 UTC 时间 |

---

## 5. 后端处理流程

```
1. 鉴权 → 校验当前用户角色为 TEAM_OWNER
2. 校验 projectId 属于当前用户团队
3. 校验 installationId 为 ACTIVE 状态
4. 校验仓库名（正则 + 长度）
5. 调用 GitHub API：
   a. POST /repos/{owner}/{name}（创建仓库）
   b. POST /repos/{owner}/{name}/contents/README.md（初始化 README，触发初始 commit）
   c. GET /repos/{owner}/{name}（获取 default_branch）
6. 如果 5b 同步完成 → defaultBranch 已获取 → 返回 201 (READY)
7. 如果 5b 异步进行中 → 返回 202 (CREATING)，由 cron/metadata-sync 回填 defaultBranch
8. 任何步骤失败 → 返回对应 error.code，status = FAILED
```

### 关键注意事项

1. **幂等**：必须校验 `Idempotency-Key` header，同一 key 的重复请求返回上次结果而不重复创建仓库
2. **防冲突**：同一项目同一 installation 下，如果已绑定 `fullName` 相同的仓库，返回 `409 PROJECT_REPOSITORY_SOURCE_CONFLICT`
3. **空仓库**：CREATING 状态下 `defaultBranch = null`，前端会禁止进入下游流程（分支创建、QualityGate、DryRun、Task 等）
4. **异步回填**：CREATING → READY 的状态转换需要后端 cron 或 metadata-sync 机制自动更新 `defaultBranch`
5. **软删除**：新建仓库绑定后解绑，只解除本地关联，**不调用 GitHub 删除仓库**

---

## 6. 前端消费的类型（TS 定义）

```typescript
// src/types/github.ts
export type NewRepositoryStatus = 'CREATING' | 'READY' | 'FAILED'

export interface ProjectRepositoryCreateNewInput {
  name: string
  description?: string
  private?: boolean
  installationId: string
  displayName?: string
}

export interface ProjectRepositoryCreateNewResponse {
  id: string
  repositoryId: string
  installationId: string
  fullName: string
  githubUrl: string
  defaultBranch: string | null
  displayName?: string
  status: NewRepositoryStatus
  failureCode?: string | null
  failureReason?: string | null
  createdAt: string
}

// 常量（前端校验用）
export const GITHUB_REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/
export const GITHUB_REPO_NAME_MAX = 100
export const GITHUB_REPO_DESC_MAX = 500
export const PROJECT_REPO_DISPLAY_NAME_MAX = 60
```

---

## 7. 已完成的前端改动清单

| 文件 | 改动内容 |
|------|----------|
| `web/src/types/github.ts` | 新增 `NewRepositoryStatus`、`ProjectRepositoryCreateNewInput/Response` 类型及校验常量 |
| `web/src/api/github.ts` | 新增 `createNewProjectRepository()` 方法及 `mapNewProjectRepository` 映射 |
| `web/src/pages/ProjectDetail/CreateNewRepositoryModal.tsx` | **新增**：新建仓库弹窗组件，含表单校验/幂等提交/异步状态处理 |
| `web/src/pages/ProjectDetail/CodePage.tsx` | 新增工具栏按钮 + 弹窗挂载 + 安装加载态联动 |
| `web/src/pages/GitHubIntegration/TeamAuthorizedReposPage.tsx` | 空仓库展示「未初始化」标签 + 绑定按钮禁用 |
| `web/src/pages/ProjectDetail/RemoteBranchSection.tsx` | 空分支告警 + 创建分支按钮禁用 |
| `web/src/pages/ProjectDetail/Testset/QualityGateConfigDrawer.tsx` | 移除 `'main'` 回退 + 空基线拦截 |
| `web/src/pages/ProjectDetail/Testset/DryRunCreateModal.tsx` | 提交前校验仓库 defaultBranch |
| `web/src/components/task-domain/TaskTriggerModal.tsx` | 提交前校验基准分支 + 未初始化仓库拦截 |
| `web/src/pages/ProjectDetail/MergeRequestTab.tsx` | 移除 `targetBranch` 回退 `'main'` |
| `web/src/mocks/handlers.ts` | 新增 mock handler（供 `VITE_USE_MOCK=true` 环境验证） |

---

## 8. 本地验证方式

在后端接口完成前，可临时开启 MSW mock 验证前端流程：

```bash
# 临时切换到 mock 模式
# 修改 web/.env.local:
#   VITE_USE_MOCK=true
#   VITE_API_BASE_URL=/api
```

或直接在 `.env.local` 中将注释行互换。Mock handler 已在 `web/src/mocks/handlers.ts#L893-L983` 注册，返回 201 READY 响应。
