# 「代码与 Branch」页：前端需要的接口与字段

> 对象：后端  
> 日期：2026-08-16  
> 页面：项目详情 → 代码与 Branch  
> 路由：`/app/projects/{projectId}/code`  
> 依据：`docs/前后端联调.md` v1.1.9、当前 `CodePage.tsx` 实现  
> 说明：下列「需新增」接口尚未出现在冻结文档中。路径名可改，语义和字段请确认后冻结。不要用 §6.1 `branch-policies` 代替分支列表。

---

## 0. 结论（先看这个）


| 页面区块             | 有没有接口        | 说明                                                                            |
| ---------------- | ------------ | ----------------------------------------------------------------------------- |
| 仓库卡片             | **已有**       | `GET /projects/{projectId}/repositories`                                      |
| 需求过滤下拉           | **已有**       | `GET /projects/{projectId}/groups`，选项 `value = group.id`（UUID）                |
| 分支表格每一行          | **没有**       | 文档写明「分支查询不在本轮」。当前是前端演示数据                                                      |
| 点 Diff `+/-` 进详情 | **已有，但对分支名** | `GET /projects/{projectId}/diffs`，用 `repositoryId + sourceBranch` 对上 `diffId` |
| MR Tab           | **已有**       | `GET /projects/{projectId}/merge-requests`                                    |
| 单条 MR 详情         | **已有**       | `GET /projects/{projectId}/merge-requests/{mergeRequestId}`                   |
| 单条 Diff 详情       | **已有**       | 走现有 Diff 详情接口；入口是 `/code/diff/{diffId}`                                       |


**本页真正缺的是：按项目仓库绑定列出工作分支。**

需求过滤的筛选项可以立刻用 Group UUID。分支行上的 `requirementGroupId` 也必须是同一个 Group UUID。不要用前端演示字符串 `'login'` / `'pay'`。

---



## 1. 已有接口（前端会继续用）

统一成功外壳：`{ "data": ..., "requestId": "req_..." }`。  
所有资源 ID 为 UUID。时间为 UTC RFC 3339。

### 1.1 仓库卡片

```http
GET /projects/{projectId}/repositories
```

权限：项目成员。  
主键：绑定记录 `id` = `project_repositories.id`（不是 GitHub 数字 ID）。

前端用到的字段：


| 字段                         | 页面位置                                 |
| -------------------------- | ------------------------------------ |
| `id`                       | 卡片 key；后续拉分支、对 Diff 的 `repositoryId` |
| `displayName` / `fullName` | 卡片标题                                 |
| `githubUrl`                | 右上角 GitHub 链接                        |
| `defaultBranch`            | 默认分支（演示里也会用来占位）                      |




### 1.2 需求过滤下拉

```http
GET /projects/{projectId}/groups
```

权限：项目成员。

前端筛选项：

```ts
groups.filter((g) => g.type === 'REQUIREMENT')
options = { value: g.id, label: g.title }
```


| 字段       | 用途                                       |
| -------- | ---------------------------------------- |
| `id`     | 下拉选中值；筛选分支时用 `requirementGroupId === id` |
| `type`   | 只展示 `REQUIREMENT`，不要项目总群 `PROJECT_MAIN`  |
| `title`  | 下拉显示文案                                   |
| `status` | 建议只展示 `ACTIVE`                           |


`REQUIREMENT` Group 是协作边界，不代表 Git `main`，也不天然生成分支。分支要不要出现在某个需求群下，由分支列表上的 `requirementGroupId` 决定。

### 1.3 Diff 列表（让 `+/-` 能点进去）

```http
GET /projects/{projectId}/diffs
```

前端对不上 `diffId` 时，表格只显示灰色 `+n / -n`，**不能跳转**。

对上规则（按顺序）：

1. `diff.repositoryId === 分支.projectRepositoryId` 且 `diff.sourceBranch === 分支.name`
2. 否则退一步：只比 `sourceBranch === 分支.name`

前端至少需要：


| 字段                                    | 用途                                |
| ------------------------------------- | --------------------------------- |
| `id`                                  | 跳转 `/code/diff/{diffId}`          |
| `repositoryId`                        | 必须是项目绑定 `project_repositories.id` |
| `sourceBranch`                        | 必须和分支列表的 `name` 一致                |
| `changeStats.additions` / `deletions` | 可与分支行上的 +/- 交叉校验                  |




### 1.4 MR Tab

```http
GET /projects/{projectId}/merge-requests?repositoryId=&status=&limit=
```


| 字段                              | 页面列                             |
| ------------------------------- | ------------------------------- |
| `id`                            | 进 MR 详情                         |
| `number`                        | `#42`                           |
| `title`                         | 标题                              |
| `sourceBranch` / `targetBranch` | 分支列                             |
| `repositoryId`                  | 仓库列（绑定 id）                      |
| `status`                        | `OPEN` / `MERGED` / `CLOSED`    |
| `qualityGate.status`            | `PASSED` / `FAILED` / `PENDING` |
| `headCommit`                    | HEAD 短 SHA                      |
| `webUrl`                        | 外链 GitHub                       |


筛选 query：`repositoryId`（绑定 UUID）、`status`。这两个只存在于 `?tab=mr`，切回分支 Tab 会从 URL 清掉。

---



## 2. 需要后端新增：分支列表

文档第 1 节：分支查询不在本轮。没有这条接口，表格只能继续用演示数据，需求过滤也无法对上真实 Group UUID。

建议：

```http
GET /api/v1/projects/{projectId}/repositories/{projectRepositoryId}/branches
```

- `{projectRepositoryId}` = 第 1.1 节绑定记录 `id`
- 权限：项目成员
- 只返回 Qgents 工作分支（Task / Workspace 的 `sourceBranch` + 仓库默认分支），不要扫 GitHub 上全部远程分支
- 建议 query：`requirementGroupId`（与下拉 `group.id` 相同）。不传则返回该仓库全部工作分支

成功响应示例：

```json
{
  "data": [
    {
      "id": "branch-record-uuid",
      "projectRepositoryId": "project-repository-binding-uuid",
      "name": "feat/login-api",
      "protected": false,
      "branchStatus": "HEALTHY",
      "relatedTask": {
        "id": "task-uuid",
        "displayCode": "T-1024",
        "title": "登录接口开发"
      },
      "requirementGroupId": "group-uuid",
      "requirementTitle": "登录功能",
      "workspaceId": "workspace-uuid",
      "workspaceName": "ws-login-api",
      "createdBy": {
        "id": "user-uuid",
        "displayName": "张同学"
      },
      "createdAt": "2026-05-16T10:30:00Z",
      "commitCount": 18,
      "diffAdditions": 230,
      "diffDeletions": 12,
      "mrCount": 1,
      "testStatus": "PASSED",
      "latestCommit": {
        "sha": "a1b2c3d",
        "message": "feat: 邮箱登录接口"
      },
      "artifact": {
        "name": "auth-service-login.zip",
        "published": true
      }
    }
  ],
  "requestId": "req_..."
}
```

默认分支（如 `main`）也请出现在列表里：`protected=true`，`relatedTask` 可为 `null`。

---



## 3. 分支列表项字段 ↔ 页面

前端行模型是 `ProjectBranchRow`。后端可用下面字段名；若改名请给映射。


| 后端字段（建议）                  | 前端字段                  | 页面位置                         | 必填                       |
| ------------------------- | --------------------- | ---------------------------- | ------------------------ |
| `id`                      | `id`                  | 行 key                        | 是，UUID                   |
| `projectRepositoryId`     | `projectRepositoryId` | 对 Diff、归属仓库                  | 是，绑定 UUID                |
| `name`                    | `name`                | Branch 列、抽屉、对 `sourceBranch` | 是                        |
| `protected`               | `protected`           | 蓝色「受保护」                      | 是                        |
| `branchStatus`            | `healthStatus`        | 「状态」列、抽屉                     | 是                        |
| `relatedTask`             | `relatedTask`         | 「关联 Task」列、抽屉                | 可 `null`                 |
| `relatedTask.id`          | （跳转任务详情可用）            | 建议给                          | 有任务时建议给                  |
| `relatedTask.displayCode` | `relatedTask.code`    | 绿色 `T-1024`                  | 有任务时建议给                  |
| `relatedTask.title`       | `relatedTask.title`   | 任务标题                         | 有任务时建议给                  |
| `requirementGroupId`      | `requirementGroupId`  | 需求过滤                         | 工作分支建议给，必须是 Group UUID   |
| `requirementTitle`        | `requirementTitle`    | 抽屉「需求群」                      | 可选，前端也可用 groups 反查 title |
| `workspaceName`           | `workspaceName`       | 抽屉                           | 可选                       |
| `createdBy.displayName`   | `createdBy`           | 抽屉「创建者」                      | 可选                       |
| `createdAt`               | `createdAt`           | 抽屉                           | 可选，RFC 3339              |
| `latestCommit.sha`        | `latestCommitSha`     | 抽屉「最新提交」                     | 可选                       |
| `latestCommit.message`    | `latestCommitMessage` | 抽屉                           | 可选                       |
| `artifact.name`           | `artifactName`        | 抽屉「构建产物」                     | 可选                       |
| `artifact.published`      | `artifactPublished`   | 已发布 / 未发布                    | 可选                       |
| `commitCount`             | `commitCount`         | 「提交」列、抽屉                     | 是，没有则 `0`                |
| `diffAdditions`           | `diffAdditions`       | Diff 列 `+n`                  | 是，没有则 `0`                |
| `diffDeletions`           | `diffDeletions`       | Diff 列 `-n`                  | 是，没有则 `0`                |
| `mrCount`                 | `mrCount`             | MR 列、抽屉                      | 是，没有则 `0`                |
| `testStatus`              | `testStatus`          | Testset 列、抽屉                 | 是；没有则 `PENDING`          |




### 3.1 `branchStatus`（不是受保护，不是 Testset，不是 MR 状态）

含义：相对默认分支 / 交付链路还能不能继续开发。

```text
HEALTHY | BEHIND | CONFLICT | MERGED
```


| 值          | 页面   |
| ---------- | ---- |
| `HEALTHY`  | 正常   |
| `BEHIND`   | 落后基线 |
| `CONFLICT` | 冲突   |
| `MERGED`   | 已合并  |


§6.1 质量门禁不能替代本枚举。

### 3.2 `testStatus`（不是门禁里的 `requiredTestsetIds`）

含义：这条分支最近一次测试结果。

```text
PASSED | RUNNING | FAILED | PENDING
```


| 值         | 页面  |
| --------- | --- |
| `PASSED`  | 通过  |
| `RUNNING` | 运行中 |
| `FAILED`  | 失败  |
| `PENDING` | 未跑  |


---



## 4. 不要用这些接口冒充分支列表


| 接口                                     | 为什么不够                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| `GET/PUT .../branch-policies/{branch}` | 路径里的 `{branch}` 要前端先知道分支名；也没有 `testStatus` / 提交数 / Task |
| `GET/PUT .../quality-gates/{branch}`   | 合入规则，不是分支健康状态，也不是测试结果                                   |
| `GET .../tasks` 或 `GET .../diffs` 自行聚合 | 拼得出部分 `sourceBranch`，拼不出提交数、最新 commit、健康状态、完整工作分支集合     |


---



## 5. 前端联调时的接法（供对照）

1. 下拉：`GET .../groups` → `requirementGroups`，选中值为 Group UUID。
2. 卡片：`GET .../repositories`（已接）。
3. 表格：每个 `repo.id` 调 `GET .../repositories/{id}/branches`；有筛选则带 `requirementGroupId`。
4. 筛选：`branch.requirementGroupId === 选中的 group.id`（若后端已按 query 过滤，前端可不再滤一遍）。
5. Diff 可点：`+/- > 0` 且 `GET .../diffs` 能对上 `diffId`。

当前演示数据里的 `'login'` / `'pay'` / `'dashboard'` **仅供 UI 占位，联调不要兼容这套假 id**。