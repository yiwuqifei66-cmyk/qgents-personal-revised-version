# 「代码与 Branch」页后端确认与联调建议

> 面向：前端  
> 依据：Qgents 题目（优先级最高）与当前后端领域模型  
> 结论日期：2026-08-17  
> 地位：**后端已确认的联调口径**（正式写入官方接口文档前以本文 + 下方「冻结补充」为准）  
> 前端实现：`src/pages/ProjectDetail/CodePage.tsx`、`src/api/workBranches.ts`、`src/types/workBranch.ts`

---

## 1. 结论

“代码与 Branch”页的方向合理，对应题目 P1 的 Branch 管理；但不能把它实现成 GitHub 全量分支管理页，也不能把一个工作分支视为只属于一个 Task、一个需求群或一个 Diff。

首版展示 Qgents 已知的工作分支即可。题目 P0 的群聊、任务、云端 Agent、Sandbox 与 Diff/MR 交付优先于完整的 Branch 运维能力。

---

## 2. 可立即联调

| 页面能力 | 接口 | 联调口径 |
| --- | --- | --- |
| 仓库卡片 | `GET /api/v1/projects/{projectId}/repositories` | 使用绑定记录 `id` 作为 `projectRepositoryId`；`defaultBranch` 只在仓库卡片展示。 |
| 需求群筛选项 | `GET /api/v1/projects/{projectId}/groups` | 仅取 `type=REQUIREMENT`，选项值使用 Group UUID。 |
| Diff 列表/详情 | `GET /api/v1/projects/{projectId}/diffs` 及 Diff 详情接口 | 列表是游标分页；只可按后端明确给出的 `diffId` 跳转。 |
| MR 列表/详情 | `GET /api/v1/projects/{projectId}/merge-requests` 及 MR 详情接口 | `repositoryId` 是项目仓库绑定 UUID；使用返回的 `qualityGate`，不自行从测试状态推导。 |

---

## 3. 请不要按旧草案实现的逻辑

### 3.1 不要通过分支名反查 Diff

不要使用 `repositoryId + sourceBranch` 匹配 Diff；更不要仅用 `sourceBranch` 兜底。

同一 Workspace 的特性分支可以被续接 Task 继续使用，而 Diff 是某个 Task 的不可变快照。按分支名匹配可能跳转到旧任务的 Diff，分支名兜底还有跨仓库误命中的风险。

前端应只使用工作分支行中后端明确给出的 `latestDiff.id` 进入 Diff 详情；无 `latestDiff` 时禁用跳转即可。

### 3.2 不要将分支绑定为单个 Task 或需求群

工作分支可以关联多个历史 Task 和多个需求群。因此：

- `latestTask` 仅用于显示最近相关 Task，不是分支唯一所有者。
- `requirementGroups[]` 表示相关需求群集合，不是唯一的 `requirementGroupId`。
- 按需求群筛选的含义是“该工作分支存在关联 Task 属于此需求群”。

### 3.3 不要展示未经真实计算的 Git 状态

首版不展示 `HEALTHY`、`BEHIND`、`CONFLICT`、`MERGED` 这类“分支健康状态”，也不以历史测试结果表示当前 HEAD 是否通过。

- `CONFLICT` / `BEHIND` 需要基于真实远端引用比较或 Sandbox 预检。
- `MERGED` 是 MR 状态，不是分支状态。
- 默认分支不必然受保护，不能硬编码 `protected=true`。
- 测试结果必须同时携带对应 `commitSha`，才能说明其针对哪个版本。

---

## 4. 后端待新增接口（建议冻结为此口径）

```http
GET /api/v1/projects/{projectId}/work-branches
  ?repositoryId=
  &requirementGroupId=
  &cursor=
  &limit=
```

- 权限：项目成员。
- 仅返回 Qgents 可追溯的 Workspace 工作分支；不扫描 GitHub 全量远程分支。
- `repositoryId`、`requirementGroupId` 均为可选过滤条件。
- 使用项目级接口，避免前端按仓库发 N 次请求，保证筛选、排序和游标分页一致。
- 响应外壳：`{ data, page, requestId }`；默认 `limit=20`，最大 `100`。
- query `repositoryId` 与响应 `projectRepositoryId` 均为 `project_repositories.id`。
- 行的逻辑唯一键：`projectRepositoryId + name`（后端不虚构分支记录 UUID；前端可用该组合做 React key）。

响应项建议如下：

```json
{
  "projectRepositoryId": "project-repository-binding-uuid",
  "name": "feat/login-api",
  "workspaceId": "workspace-uuid",
  "lastKnownHead": "a1b2c3d",
  "latestTask": {
    "id": "task-uuid",
    "displayCode": "T-1024",
    "title": "登录接口开发",
    "finalDiff": null
  },
  "requirementGroups": [
    { "id": "group-uuid", "title": "登录功能" }
  ],
  "latestDiff": {
    "id": "diff-uuid",
    "taskId": "task-uuid",
    "status": "PENDING_REVIEW",
    "changeStats": { "additions": 230, "deletions": 12 }
  },
  "openMergeRequest": {
    "id": "merge-request-uuid",
    "number": 42,
    "status": "OPEN"
  },
  "lastVerification": {
    "kind": "TEST_RUN",
    "status": "PASSED",
    "commitSha": "a1b2c3d",
    "completedAt": "2026-08-17T12:00:00Z"
  }
}
```

`latestTask`、`latestDiff`、`openMergeRequest` 与 `lastVerification` 均可为 `null`。前端需要提供空状态，而不是用演示数据补齐。

### 4.1 冻结补充（后端书面确认，相对初稿的修正）

1. **`latestDiff` 语义**：该分支历史上最新的真实 Diff 快照。当前 Task 无变更时不会新造 Diff，但**不得**因此把分支已有历史 Diff 抹成 `null`。
2. **`latestDiff.taskId`**：必补，标明该 Diff 快照所属 Task，避免与行内 `latestTask` 混淆。
3. **「当前 latestTask 没有变更」**：用 `latestTask.finalDiff = null` 表达，而不是清空历史 `latestDiff`。
4. **`lastVerification`**：首版允许为 `null`，前端显示 `—`。后续仅接入真实 TestRun / Sandbox dry-run，必须带 `kind`、`status`、`commitSha`、`completedAt`；不得混用 MR 的 `qualityGate`，也不能用 GitHub `mergeable` 替代。
5. **`openMergeRequest`**：表示该仓库 + 源分支的唯一 Open MR；可直接跳转 MR 详情。MR Tab 仍用现有 MR 列表接口。
6. **SSE**：收到 `diff.created`、`merge-request.updated`、`task.updated`（以及有 `diff-review.skipped` 时）后，前端应 invalidate `work-branches`。

---

## 5. 首版页面建议

1. 仓库卡片继续显示仓库名、GitHub 链接和默认分支。
2. 工作分支表显示分支名、最近 Task、最近 Diff、Open MR、最近验证结果。
3. 仅当 `latestDiff.id` 存在时允许点击增删行数进入 Diff。
4. 验证结果旁显示短 SHA；SHA 与当前 `lastKnownHead` 不一致时标注「非当前版本」。
5. 构建产物、提交总数、MR 总数、GitHub 保护状态和冲突/落后状态不进入首版。
6. 默认分支仅在仓库卡片通过 `defaultBranch` 展示，不在工作分支表中硬插一行。

---

## 6. 后续 P1 增强

在具备受控远端查询和真实 Sandbox 预检后，再增加：

- 基于真实 base/head 的落后与冲突信息；
- GitHub 分支保护规则；
- 针对当前 HEAD 的 dry-run、CQ+1 和 Testset 展示；
- 以 Git 分支为边界的 Agent 群隔离与切换。

上述增强不能以历史测试、GitHub `mergeable` 或前端推断替代真实结果。
