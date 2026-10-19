# GitHub 集成联调：后端最终确认

> 版本：v1.2 日期：2026-08-13 回复对象：前端 依据：前端《GitHub 集成联调：前端正式确认回复》、`Qgents/AGENTS.md`、当前 `develop` 分支代码与《Qgents 接口文档》 状态：本文件所列前端联调契约已冻结；后端当前代码与目标契约的差异由后端补齐，不再要求前端确认新的方案。

## 1. 对前端 8 项结论的确认


| 序号  | 最终结论                                                                                          |
| --- | --------------------------------------------------------------------------------------------- |
| 1   | Installation、GitHub Repository、ProjectRepository 的本地 `id` 与 GitHub provider 数字 ID 分离。         |
| 2   | 绑定请求只使用 Qgents 本地 installation UUID 和 GitHub repository 镜像 UUID。                              |
| 3   | 第一版采用“团队总览 + 选择项目”，不增加团队级项目绑定汇总接口。                                                            |
| 4   | 项目绑定 DTO 不使用代码含义的 `syncStatus`、`lastSyncedAt`、`syncError`；GitHub 元数据时间统一为 `metadataSyncedAt`。 |
| 5   | Installation 状态为 `ACTIVE / SUSPENDED / DELETED`，不使用 `EXPIRED`。                                |
| 6   | callback 成功后跳转到 `/app/integrations/github?teamId={teamId}&installed=1`。                       |
| 7   | 第一版项目绑定以 GitHub 返回的默认分支为基线，前端不提供任意修改默认分支的入口。                                                  |
| 8   | 仓库可见性使用 `PUBLIC / PRIVATE / INTERNAL`，不再返回重复的 `private` 布尔字段。                                 |




## 2. ID 字段最终映射


| 资源                | 字段                       | 实际含义                                     | 前端用途                         |
| ----------------- | ------------------------ | ---------------------------------------- | ---------------------------- |
| Installation      | `id`                     | `github_installations.id`，Qgents 本地 UUID | 绑定请求、同步路径、按安装筛选              |
| Installation      | `providerInstallationId` | GitHub Installation 数字 ID                | 仅展示或排查，不用于业务写入               |
| Repository        | `id`                     | `github_repositories.id`，Qgents 本地 UUID  | 绑定请求中的 `repositoryId`        |
| Repository        | `providerRepositoryId`   | GitHub Repository 数字 ID                  | 仅展示或排查，不用于业务写入               |
| ProjectRepository | `id`                     | `project_repositories.id`，项目仓库绑定 UUID    | PATCH、DELETE 以及 Task 等下游开发链路 |


绑定请求固定映射为：

```json
{
  "installationId": "installation 列表项的本地 id",
  "repositoryId": "授权仓库列表项的本地 id",
  "displayName": "qgents-web"
}
```

不得传 `providerInstallationId` 或 `providerRepositoryId`。

绑定成功后，前端创建 Task 时使用项目绑定响应的 `id`：

```json
{
  "repositoryIds": ["ProjectRepository.id"]
}
```

当前 Task、TaskStep、Workspace、Diff、TestRun、DryRun 和 MR 等开发链路中的 `repositoryId` / `repositoryIds`，真实含义是 `project_repositories.id`，不是 `github_repositories.id`，也不是 GitHub 数字 ID。该语义已由当前 `TaskResponse`、`TaskService` 和 Workspace repository 模型确认。

## 3. 枚举最终值

```text
Installation.status     = ACTIVE | SUSPENDED | DELETED
Installation.accountType = USER | ORGANIZATION
Repository.visibility   = PUBLIC | PRIVATE | INTERNAL
Repository.authorizationStatus = AUTHORIZED | REVOKED
```

说明：

- `EXPIRED` 不属于 Installation 状态；短期 Installation Token 过期不代表 App Installation 过期。
- `archived=true` 表示 GitHub 仓库已归档；`authorizationStatus=REVOKED` 表示 GitHub App 已无权访问，两者不能混用。
- `authorizedRepositoryCount` 第一版不返回。前端可按授权仓库列表的 `installationId` 统计，不阻塞联调。



## 4. Installation 接口



### 4.1 生成安装地址

```http
POST /api/v1/teams/{teamId}/integrations/github/installations
Idempotency-Key: <unique-key>
```

权限：Team Owner。

成功响应：

```json
{
  "data": {
    "installationUrl": "https://github.com/apps/qgents/installations/new?state=...",
    "expiresAt": "2026-08-13T11:00:00Z"
  },
  "requestId": "..."
}
```



### 4.2 查询安装列表

```http
GET /api/v1/teams/{teamId}/integrations/github/installations
```

权限：Team Owner。

列表项目标字段：

```json
{
  "id": "installation-local-uuid",
  "providerInstallationId": 12345678,
  "accountLogin": "Yjingwen-svg",
  "accountType": "ORGANIZATION",
  "status": "ACTIVE",
  "installedAt": "2026-08-01T08:00:00Z",
  "metadataSyncedAt": "2026-08-13T10:00:00Z"
}
```



### 4.3 callback

```http
GET /api/v1/integrations/github/callback?installation_id=...&state=...
```

后端校验 `state`，保存 Installation，并刷新该 Installation 的授权仓库元数据。成功响应固定为：

```http
302 Location: {FRONTEND_URL}/app/integrations/github?teamId={teamId}&installed=1
```

`teamId` 与 `installed=1` 都必须存在。前端按已确认流程展示一次成功提示、重新获取 Installation 与授权仓库列表，并清理一次性 query 参数。

### 4.4 手动刷新授权仓库

```http
POST /api/v1/teams/{teamId}/integrations/github/installations/{installationId}/sync
Idempotency-Key: <unique-key>
```

最终约定：

- `{installationId}` 是 `github_installations.id` 本地 UUID；
- 权限为 Team Owner；
- 只刷新 Installation 与授权仓库元数据，不代表 clone/fetch，也不改变 Workspace 状态；
- 后端以 GitHub API 返回的完整授权集合更新本地镜像；
- 成功返回 `200` 和刷新后的 Installation 对象；
- 成功后前端重新请求 Installation 列表和授权仓库列表。



## 5. 授权仓库接口

```http
GET /api/v1/teams/{teamId}/integrations/github/repositories
```

权限：Team Owner，或该 Team 下任一 Project 的 Project Admin。

列表项目标字段：

```json
{
  "id": "repository-local-uuid",
  "installationId": "installation-local-uuid",
  "providerRepositoryId": 987654321,
  "fullName": "Yjingwen-svg/qgents-web",
  "githubUrl": "https://github.com/Yjingwen-svg/qgents-web",
  "defaultBranch": "main",
  "visibility": "PRIVATE",
  "archived": false,
  "authorizationStatus": "AUTHORIZED",
  "metadataSyncedAt": "2026-08-13T10:00:00Z"
}
```

前端只允许绑定同时满足以下条件的仓库：

- `authorizationStatus=AUTHORIZED`；
- `archived=false`；
- `defaultBranch` 非空；
- 对应 Installation 为 `ACTIVE`。

`defaultBranch` 缺失时不得前端回退为 `main`，应禁用绑定并提示刷新授权仓库信息。

## 6. 项目仓库绑定接口



### 6.1 查询项目绑定

```http
GET /api/v1/projects/{projectId}/repositories
```

权限：项目成员。项目上下文已由路径确定，不返回重复的 `boundProjectId` / `boundProjectName`。

列表项目标字段：

```json
{
  "id": "project-repository-binding-uuid",
  "repositoryId": "repository-local-uuid",
  "installationId": "installation-local-uuid",
  "providerRepositoryId": 987654321,
  "fullName": "Yjingwen-svg/qgents-web",
  "githubUrl": "https://github.com/Yjingwen-svg/qgents-web",
  "defaultBranch": "main",
  "displayName": "qgents-web",
  "authorizationStatus": "AUTHORIZED",
  "metadataSyncedAt": "2026-08-13T10:00:00Z",
  "boundAt": "2026-08-13T10:00:00Z"
}
```

项目绑定 DTO 不返回 `syncStatus`、`lastSyncedAt` 或 `syncError`。其中 `defaultBranch` 是创建 Workspace/Task 时的默认基线，不把 Requirement Group 固定成 Git branch；最终 Task 的 `baseRef` / `sourceBranch` 仍由 Task 或用户决定。

第一版不提供“按授权仓库批量反查已绑定项目”的接口。前端按已确认的“团队总览 + 选择项目”流程使用单项目绑定列表；批量反查只作为后续性能优化，不阻塞本轮联调。

### 6.2 绑定仓库

```http
POST /api/v1/projects/{projectId}/repositories
Idempotency-Key: <unique-key>
```

权限：Project Admin。

第一版请求（`defaultBranch` 为可选兼容字段）：

```json
{
  "installationId": "installation-local-uuid",
  "repositoryId": "repository-local-uuid",
  "defaultBranch": "main",
  "displayName": "qgents-web"
}
```

后端使用授权仓库元数据中的真实 `defaultBranch`，不得信任或覆盖该字段；前端可以省略它，现有客户端暂时发送也不影响契约。授权仓库元数据缺失默认分支时拒绝绑定，不回退为固定的 `main`。

成功返回 `200` 和第 6.1 节的完整 ProjectRepository 对象，必须包含服务端生成的绑定 `id`。

### 6.3 PATCH 路径 ID

```http
PATCH /api/v1/projects/{projectId}/repositories/{projectRepositoryId}
Idempotency-Key: <unique-key>
```

`{projectRepositoryId}` 固定为 `project_repositories.id`，即 ProjectRepository 响应中的 `id`。第一版前端不提供任意修改默认分支的入口，因此该接口不属于第一版前端必调流程；后端保留接口时仍须遵守该路径 ID 与幂等约定。

### 6.4 解除项目绑定

```http
DELETE /api/v1/projects/{projectId}/repositories/{projectRepositoryId}
Idempotency-Key: <unique-key>
```

权限：Project Admin。`{projectRepositoryId}` 是 ProjectRepository 响应中的本地 `id`。

第一版前端契约保持 `204 No Content`。成功后前端使项目绑定列表缓存失效并重新 GET；不依赖 DELETE 响应体、绑定状态字段或 `unboundAt`。历史引用如何保存、何时允许解绑等属于后端内部一致性规则，不改变前端使用的路径 ID。

## 7. 幂等范围

以下 GitHub 集成写接口均要求前端发送 `Idempotency-Key`：

- 生成安装链接；
- 删除 Installation；
- 手动刷新授权仓库；
- 绑定项目仓库；
- PATCH 项目仓库（前端实际调用时）；
- 解除项目仓库绑定。

同一次用户操作重试时复用原 key，新操作生成新 key。相同调用者、接口作用域、key 和请求内容回放首次响应；同 key 用于不同请求时返回 `409 IDEMPOTENCY_KEY_REUSED`。callback 为 GitHub 浏览器回调，不要求前端传该请求头。

## 8. 前端需要处理的主要错误

错误响应继续使用统一结构：

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "details": []
  },
  "requestId": "..."
}
```


| HTTP | 错误码                                              | 前端处理                        |
| ---- | ------------------------------------------------ | --------------------------- |
| 400  | `INVALID_GITHUB_INSTALLATION_STATE`              | 提示安装链接无效或过期，允许重新发起安装        |
| 400  | `IDEMPOTENCY_KEY_REQUIRED`                       | 记录请求错误，不自动改用无幂等请求           |
| 403  | `GITHUB_REPOSITORY_ACCESS_DENIED`                | 提示无团队或项目操作权限                |
| 404  | `GITHUB_RESOURCE_NOT_FOUND`                      | 提示资源已不存在并刷新列表               |
| 409  | `GITHUB_INSTALLATION_IN_USE`                     | 提示先解除相关项目仓库绑定               |
| 409  | `GITHUB_INSTALLATION_TEAM_CONFLICT`              | 提示该 Installation 已关联其他 Team |
| 409  | `PROJECT_REPOSITORY_ALREADY_BOUND`               | 提示项目已绑定该仓库并刷新项目绑定列表         |
| 409  | `PROJECT_REPOSITORY_REFERENCED_BY_BRANCH_CONFIG` | 提示需先处理该仓库的分支配置              |
| 409  | `IDEMPOTENCY_KEY_REUSED`                         | 为新的用户操作生成新 key 后重试          |
| 422  | `REPOSITORY_NOT_AUTHORIZED_FOR_PROJECT`          | 刷新授权仓库列表并提示仓库当前不可绑定         |
| 502  | `GITHUB_API_UNAVAILABLE`                         | 提示 GitHub 暂时不可用，保留重试入口      |




## 9. 当前代码与联调目标的关系

截至当前 `develop` 分支，ID 三层关系、项目/团队权限、安装链接、安装与授权仓库查询、项目绑定查询/新增/PATCH/DELETE 等基础接口已经存在，但尚未完全达到本文件的目标响应：

- callback 当前仍返回 `204`，后端需改为本文件约定的 `302`；
- 手动刷新接口尚未实现；
- Installation、Repository、ProjectRepository DTO 尚缺本文件列出的部分展示字段；
- 当前绑定请求仍可能使用前端传入的 `defaultBranch` 覆盖 GitHub 元数据，后端需改为忽略该客户端值并始终以授权仓库元数据为可信来源；
- 当前 PATCH 要求 `defaultBranch`，但第一版前端不会调用该能力；
- 当前幂等过滤器主要覆盖 `/api/v1/projects/**`，团队级 GitHub 写接口与 `204` 响应的可靠回放仍需后端补齐；
- 授权状态、完整元数据同步与相应测试仍需后端补齐。

这些均为后端实施项，不构成新的前端确认问题。前端已具备 `src/api/github.ts`、`src/types/github.ts` 及相关页面，不再沿用“前端仍只有 Mock、尚未建立 GitHub API 层”的旧描述。

## 10. 前端联调执行清单

1. 按第 2 节映射三层 ID，创建 Task 时传 ProjectRepository 的 `id`。
2. 使用冻结枚举，移除 `EXPIRED`、`private` 和项目绑定层代码同步字段。
3. 安装 callback 按固定 query 参数完成一次提示、列表刷新和 URL 清理。
4. 绑定时以后端授权仓库元数据中的真实默认分支为准；缺少真实默认分支时禁用绑定。
5. 手动刷新成功后重新 GET Installation 与授权仓库列表。
6. 解绑按 `204` 处理并重新 GET 项目绑定列表。
7. 所有实际调用的 GitHub 写接口按第 7 节携带 `Idempotency-Key`。

本文件已完整回复前端确认稿中的补充项，不再保留待前端选择或确认的开放问题。