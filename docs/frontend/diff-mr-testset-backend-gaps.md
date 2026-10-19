# Diff / MR / Testset：后端需补充的接口与数据

> 对象：后端  
> 日期：2026-08-15  
> 依据：`docs/api/qgents-api-current.md`（v1.4.0+）、`docs/前后端联调.md`、`README/Qgents接口文档.md`、前端当前实现  
> 范围：项目详情里这三块页面（不是「代码与 Branch」整张分支表；分支表确认口径见 `docs/frontend/code-branch-backend-confirm.md`）
>
> | 页面 | 路由 |
> | --- | --- |
> | Diff 评审 | `/app/projects/{projectId}/code/diff/{diffId}` |
> | MR 列表 | `/app/projects/{projectId}/code?tab=mr` |
> | MR 详情 | `/app/projects/{projectId}/code/mr/{mergeRequestId}` |
> | Testset（当前运行 + 管理抽屉） | `/app/projects/{projectId}/testset` |
>
> 说明：下面「前端已在用」的字段名，是页面现在按同一条 API 调用链在请求的。路径在文档里有、但**没有响应示例**的，前端只能先按 Mock 形状画。请后端确认或给出等价字段并写进契约，不要让前端继续猜。

---

## 0. 先分清：哪些已经能联调，哪些只是缺 DTO

路径本身大多已经在 §10 / §12.3 / §12.4 / §13。当前卡住联调的，主要不是「完全没有接口」，而是：

1. **有路径、无响应体示例**（files、comments、checks、test-run 详情、dry-run report）
2. **最小示例缺页面必填字段**（MR 的 `title` / `description` / `webUrl`）
3. **两份文档形状不一致**（Testset 创建示例是扁平字段，v1.6.0 列表示例是 `definition` 嵌套）
4. **文档写明本轮不做的列表**（Test Run / Dry Run 历史），但 Testset 页右侧就是历史列表

仓库 ID 一律是 **`project_repositories.id`**（绑定 UUID），不要传 GitHub 数字 ID。

---

## 1. Diff 评审页

入口：代码与 Branch 表格 Diff 列 `+/-`。  
前端：`src/pages/ProjectDetail/DiffReviewPage.tsx`

### 1.1 已经能对上的接口（不要求新做路径）

| 页面位置 | 现有接口 | 备注 |
| --- | --- | --- |
| 标题、状态、SHA、文件数 | `GET /projects/{projectId}/diffs/{diffId}` | 列表项字段 + `headCommit` / `changeStats` 已有示例 |
| 通过 / 请求修改 | `POST .../accept`、`POST .../reject` | 权限：发起人或 Project Admin；`reject` body 已有 `reason` |
| 创建 MR | `POST /projects/{projectId}/merge-requests` | 仅 Diff `ACCEPTED` 且已有远端 `headCommit` |
| 关联任务 / 需求群 | Diff 上的 `taskId`、`requirementGroupId` | 再调 Task / Group |
| 实时刷新 | SSE `diff.created` | payload 需 `projectId` + `taskId` + `diffId` |

### 1.2 路径有、响应体没有：请补示例并冻结

#### A. `GET /projects/{projectId}/diffs/{diffId}/files`

文档只写「游标读取文件、hunk 和二进制文件摘要」，**没有 JSON 示例**。  
中间栏代码对比、左侧文件树完全靠它。请按下面形状冻结（字段名可改，语义不要改）：

```json
{
  "data": [
    {
      "path": "src/auth/AuthController.ts",
      "status": "MODIFIED",
      "additions": 8,
      "deletions": 2,
      "binary": false,
      "hunks": [
        {
          "id": "hunk-login",
          "header": "@@ -17,7 +17,10 @@",
          "lines": [
            { "kind": "CONTEXT", "oldLine": 17, "newLine": 17, "text": "  @Post('login')" },
            { "kind": "DEL", "oldLine": 20, "newLine": null, "text": "    return this.authService.loginByPhone(dto)" },
            { "kind": "ADD", "oldLine": null, "newLine": 20, "text": "    return this.authService.loginByEmail(dto)" }
          ]
        }
      ]
    }
  ],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_01J..."
}
```

请确认并冻结：

| 字段 | 建议枚举 / 规则 |
| --- | --- |
| `status` | `ADDED` \| `MODIFIED` \| `DELETED`（页面画 A / M / D） |
| `kind` | `CONTEXT` \| `ADD` \| `DEL` |
| `binary` | `true` 时 `hunks` 可为空，前端显示「二进制文件」 |
| 分页 | 与其它列表一样：`limit` 默认 20、上限 100；文件很多时要能翻页 |

#### B. `GET` / `POST /projects/{projectId}/diffs/{diffId}/comments`

文档只规定请求要有 `path`、`side`、`line` 或 `hunkId`、`body`，**没有列表/创建响应示例**。  
评论作者、时间、行号现在前端只能自己猜。

请补：

```json
{
  "id": "comment-uuid",
  "path": "src/auth/AuthController.ts",
  "side": "RIGHT",
  "line": 20,
  "hunkId": "hunk-login",
  "body": "密码有做哈希吗？还是明文比对？",
  "authorName": "李同学",
  "createdAt": "2026-05-16T11:20:00Z"
}
```

`POST` 请求体前端现在发：

```json
{
  "path": "src/auth/AuthController.ts",
  "side": "RIGHT",
  "line": 20,
  "hunkId": "hunk-login",
  "body": "评论正文"
}
```

### 1.3 页面有、接口缺的字段

| 页面位置 | 前端现在怎么做 | 文档现状 | 需要后端 |
| --- | --- | --- | --- |
| 面包屑「目标分支」 | 从 Task.`repositories[].defaultBranch` 猜 | Diff 只有 `sourceBranch`，没有 `targetBranch` | **建议 Diff 详情带 `targetBranch`**，或明确就用仓库默认分支 |
| 仓库展示名 | 只能显示 `repositoryId` | 只有绑定 UUID | 详情带 `repositoryName` / `fullName`，或前端继续用 `GET .../repositories` 自己拼 |
| 评论作者 | `authorName`，没有则显示「成员」 | 未定义 | **新增** `authorName`（或 `author.displayName`） |
| 评论时间 | `createdAt` | 未定义 | **新增** |
| 「标记评论已解决」 | 按钮禁用 | 无 resolve 接口，也无 `resolved` | 本轮不做也可以，但请书面确认；做的话再补 `POST .../comments/{id}/resolve` 和 `resolved` |
| 评论回复串 | 类型里有 `replyToId`，页面未接 | 无 | 本轮不做 |
| 「文件视图」 | 按钮禁用 | 无 raw/blob 接口 | 本轮不做；不要让前端假定有下载地址 |

### 1.4 Diff 列表过滤缺口（MR 详情也依赖）

`GET /diffs` 现在只支持 `taskId` + 游标。  
MR 详情的「变更 / 评论」没有独立文件接口，只能找「同一 `repositoryId` + `sourceBranch`」的 Diff。前端现在拉一页 Diff 再自己滤，不可靠。

请至少做一件：

- **推荐**：MR 详情直接带 `diffId`（见第 3 节）  
- 或者：`GET /diffs` 增加 `repositoryId`、`sourceBranch` 过滤

---

## 2. MR 列表（代码与 Branch → MR Tab）

路由：`/app/projects/{projectId}/code?tab=mr`  
前端：`src/pages/ProjectDetail/MergeRequestTab.tsx`

### 2.1 已经能对上的接口

| 页面位置 | 现有接口 | 备注 |
| --- | --- | --- |
| 表格 | `GET /projects/{projectId}/merge-requests` | 已支持 `repositoryId`、`groupId`、`status`、游标 |
| 仓库名 | `GET /projects/{projectId}/repositories` | 用绑定 `id` 对 `displayName` / `fullName` |
| GitHub 打开 | 列表项 `webUrl` | **最小示例如没有这个字段** |
| 刷新 | SSE `merge-request.updated` | payload 必须有 `projectId` + `mergeRequestId` |

状态前端按文档使用：`OPEN` / `MERGED` / `CLOSED`（文案：进行中 / 已合并 / 已关闭）。

### 2.2 列表项请在最小示例上补这些字段

§13 最小示例是详情，且没有标题。列表每一行都要用：

```json
{
  "id": "mr-uuid",
  "repositoryId": "project-repository-binding-uuid",
  "groupIds": ["group-uuid"],
  "provider": "GITHUB",
  "number": 42,
  "title": "实现邮箱登录",
  "sourceBranch": "feat/login-api",
  "targetBranch": "main",
  "status": "OPEN",
  "headCommit": "a1b2c3d4e5f67890",
  "webUrl": "https://github.com/org/repo/pull/42",
  "qualityGate": {
    "status": "PENDING",
    "requiredChecks": ["TESTSET", "AI_REVIEW", "DRY_RUN", "CQ_PLUS_ONE"]
  }
}
```

| 字段 | 页面列 | 文档最小示例 | 需要后端 |
| --- | --- | --- | --- |
| `number` | MR `#42` | 有 | 保持 |
| `title` | 标题 | **无** | **补上**；没有则前端只能拼 `source → target` |
| `sourceBranch` / `targetBranch` | 分支 | 有 | 保持 |
| `status` | 状态 | 有 | 冻结 `OPEN \| MERGED \| CLOSED` |
| `qualityGate.status` | 质量门禁 | 详情有，列表未写 | **列表也要带**。枚举请冻结 `PENDING \| PASSED \| FAILED` |
| `headCommit` | HEAD | 有 | 保持；前端只展示短 SHA |
| `webUrl` | GitHub | **无** | **补上**；构造不出时给 `null`，不要 404 |

点标题或整行进入详情，**不要**在列表上做评论。

---

## 3. MR 详情页

路由：`/app/projects/{projectId}/code/mr/{mergeRequestId}`  
前端：`src/pages/ProjectDetail/MergeRequestDetail/MergeRequestDetailPage.tsx`

当前 Tab：**质量门禁** / **变更** / **评论**。没有「检查」Tab（和门禁进度图重复）。  
本轮**不做**：提交记录、Dry-run 报告卡片、活动时间线、评审与审批、CQ+1 说明。对应的 `reviews` / `cq-approvals` / `cq-rejections` 先不必为这个页面补 UI 字段。

### 3.1 已经能对上的接口

| 页面位置 | 现有接口 | 备注 |
| --- | --- | --- |
| 头：编号、分支、状态、HEAD | `GET .../merge-requests/{id}` | 见上，缺 title/description/webUrl |
| 合并 | `POST .../merge` | 仅 Project Admin；门禁未过返回 `409 QUALITY_GATE_NOT_PASSED` |
| 当前用户是不是 Admin | `GET /projects/{projectId}` 的 `role` | `PROJECT_ADMIN` 才可能看到「合并」 |
| 门禁四项数据 | `GET .../merge-requests/{id}/checks` | **路径有，响应体完全没有示例** |

合并按钮规则（前端已按此实现，请服务端保持一致）：

- **显示**：`role === PROJECT_ADMIN` **且** `status === OPEN` **且** `qualityGate.status === PASSED`
- 成员、门禁未过、已合并 / 已关闭：**不要出现可点的合并**（不要做成禁用按钮给成员看）

### 3.2 详情请补的字段

在 §13 最小示例上增加：

| 字段 | 页面位置 | 需要后端 |
| --- | --- | --- |
| `title` | `MR #42 · 实现邮箱登录` | **补上** |
| `description` | 「MR 描述」卡片 | **补上**；没有描述给 `null` 或 `""` |
| `webUrl` | 右上角 GitHub | 同列表 |
| `qualityGate` | 头上的门禁药丸 + 进度图兜底 | 保持；`requiredChecks` **只允许下面四项** |
| `diffId` | 变更 / 评论 Tab | **强烈建议新增**，见 3.4 |

`requiredChecks` 冻结为（不要再出现「CR 阻塞型评论」）：

```text
TESTSET | AI_REVIEW | DRY_RUN | CQ_PLUS_ONE
```

页面文案：Testset / AI Review / Dry-run / CQ+1。

### 3.3 `GET .../checks` 请给出响应示例

这是质量门禁进度图的数据源。前端目前按这个形状解析，请确认或改名后冻结：

```json
{
  "data": {
    "status": "PENDING",
    "requiredChecks": ["TESTSET", "AI_REVIEW", "DRY_RUN", "CQ_PLUS_ONE"],
    "items": [
      { "name": "TESTSET", "status": "PASSED", "summary": "全部测试用例已通过" },
      { "name": "AI_REVIEW", "status": "PENDING", "summary": "检查中" },
      { "name": "DRY_RUN", "status": "PASSED", "summary": "通过" },
      { "name": "CQ_PLUS_ONE", "status": "PENDING", "summary": "等待评审" }
    ]
  },
  "requestId": "req_01J..."
}
```

| 字段 | 建议 |
| --- | --- |
| 顶层 `status` | 与 `qualityGate.status` 相同：`PENDING \| PASSED \| FAILED` |
| `items[].name` | 只能是上面四项；多返回的项前端会丢掉 |
| `items[].status` | `PENDING \| PASSED \| FAILED` |
| `items[].summary` | 短文案，例如 `32/32 通过`、`等待评审`；没有就给 `null` |

`qualityGate.status === PASSED` 当且仅当四项都是 `PASSED`。前端不自己算「能不能合」，只认这个总状态。

### 3.4 变更 / 评论：缺「这条 MR 对应哪条 Diff」

文档没有 MR 级 files / comments。前端暂时：

1. `GET /diffs?limit=100`
2. 找 `repositoryId` + `sourceBranch` 相同、优先 `ACCEPTED` 的 Diff
3. 再调该 Diff 的 `files` / `comments`

这在多 Task、多 Diff、或列表被截断时会找错。请补其一：

**推荐（改动最小）**

MR 详情增加：

```json
"diffId": "diff-uuid"
```

没有关联 Diff 时为 `null`，前端显示「没有关联 Diff，无法展示变更/评论」。

**或者** 增加：

```http
GET /projects/{projectId}/merge-requests/{mergeRequestId}/files
GET /projects/{projectId}/merge-requests/{mergeRequestId}/comments
POST /projects/{projectId}/merge-requests/{mergeRequestId}/comments
```

形状与 Diff 的 files / comments 保持一致。若走这条，请说明评论挂在 MR 头还是继续绑 Diff 快照。

评论作者 / 时间要求与第 1.2 节 B 相同。本轮不做评论解决、回复串。

### 3.5 本轮页面明确不用的接口

| 接口 | 原因 |
| --- | --- |
| `GET .../reviews` | 评审与审批区本轮不做 |
| `POST .../cq-approvals`、`cq-rejections` | CQ+1 操作区本轮不做；门禁只读 `checks` |
| `POST .../sync` | 详情暂无「从 GitHub 同步」按钮；SSE `merge-request.updated` 够用 |
| 提交列表、活动时间线 | 原型有，产品本轮不做 |

---

## 4. Testset 页（当前运行 + 管理测试集）

路由：`/app/projects/{projectId}/testset`  
前端：`src/pages/ProjectDetail/Testset/TestsetPage.tsx`、`src/api/testset.ts`

权限前端已按文档做：成员可看、可发起运行；**创建 / 修改 / 启用 / 停用 / 删除** 仅 Project Admin。

### 4.1 已经能对上的路径

| 页面位置 | 现有接口 | 备注 |
| --- | --- | --- |
| 管理抽屉列表 | `GET /projects/{projectId}/testsets` | 前端还会传 `status=ENABLED\|DISABLED` |
| 新建 / 修改 | `POST`、`PATCH .../testsets` | 请求体按 §10 创建示例（扁平字段） |
| 启用 / 停用 / 删除 | `POST .../enable`、`disable`、`DELETE` | README §17.2 写「后续提供」——若还没实现，请按 §10 做完 |
| 运行测试 | `POST /projects/{projectId}/test-runs` | `repositoryId` + `testsetIds` + (`taskId` 或 `ref`) |
| 当前运行结果 | `GET /projects/{projectId}/test-runs/{testRunId}` | **无响应示例** |
| 新建 Dry-run | `POST /projects/{projectId}/dry-runs` | `repositoryId`、`sourceRef`、`targetBranch`，可选 `taskId` |
| Dry-run 报告 | `GET /projects/{projectId}/dry-runs/{dryRunId}/report` | **无响应示例** |

### 4.2 Testset 对象：请统一一种形状

现在有两套：

**§10 创建请求（前端 POST/PATCH 正在发这个）：**

```json
{
  "name": "登录接口测试",
  "repositoryId": "project-repository-binding-uuid",
  "scopeTags": ["api"],
  "command": "./mvnw test",
  "timeoutSeconds": 900,
  "passRule": { "type": "EXIT_CODE", "expected": 0 },
  "acceptanceNotes": "登录成功、错误密码和不存在用户均需覆盖。"
}
```

**README §17.2 列表响应（已实现的另一种）：**

```json
{
  "id": "testset-uuid",
  "name": "后端单元测试",
  "repositoryId": "project-repository-binding-uuid",
  "status": "ENABLED",
  "enabled": true,
  "definition": {
    "command": "./mvnw test",
    "timeoutSeconds": 900,
    "passRule": { "type": "EXIT_CODE", "expected": 0 }
  },
  "createdBy": "user-uuid",
  "createdAt": "2026-08-14T10:00:00Z",
  "updatedAt": "2026-08-14T10:00:00Z"
}
```

管理抽屉卡片需要：名称、`status`、`scopeTags`、`command`、`timeoutSeconds`、`updatedAt`、通过规则。  
请 **列表 / 详情 / 创建响应用同一套字段**。建议：

- 主字段跟 §10：顶层 `command`、`timeoutSeconds`、`passRule`、`scopeTags`、`acceptanceNotes`
- `status` 只用 `ENABLED | DISABLED`；页面**不读** `enabled` 布尔（有也不作为依据）
- 若内部必须保留 `definition`，请同时返回顶层扁平字段，或书面冻结「只返回 definition」，前端再改映射
- `GET /testsets` 支持 `repositoryId`（已有）和 `status`（前端已传；没有就只能拉全量再滤）

启用判定：`status === "ENABLED"`。未启用的配方不能拿去跑。

### 4.3 `GET /test-runs/{testRunId}` 请补响应示例

「当前运行 → 结果总览 / 用例详情 / 报告」都靠它。文档只说「状态、用例摘要和产物引用」。

前端正在读（缺省当空 / `null` / `—`）：

```json
{
  "id": "testrun-uuid",
  "projectId": "project-uuid",
  "repositoryId": "project-repository-binding-uuid",
  "testsetIds": ["testset-uuid"],
  "taskId": "task-uuid",
  "ref": "feat/login-api",
  "status": "PASSED",
  "caseSummary": {
    "passed": 32,
    "failed": 0,
    "blocked": 0,
    "skipped": 0,
    "total": 32
  },
  "cases": [
    {
      "id": "case-uuid",
      "name": "错误密码应返回 401",
      "testsetId": "testset-uuid",
      "suite": "LoginApiTest",
      "status": "PASSED",
      "durationMs": 120,
      "message": null,
      "filePath": "src/test/LoginApiTest.java"
    }
  ],
  "artifacts": [
    { "name": "surefire-report.html", "url": "https://...", "contentType": "text/html" }
  ],
  "reportUrl": "https://...",
  "pdfUrl": "https://...",
  "summary": "全部测试用例已通过",
  "startedAt": "2026-08-15T02:00:00Z",
  "finishedAt": "2026-08-15T02:03:12Z",
  "sandboxId": "sbx-7f2a1c4d",
  "createdAt": "2026-08-15T02:00:00Z"
}
```

请确认：

| 项 | 建议 |
| --- | --- |
| `status` | `QUEUED \| RUNNING \| PASSED \| FAILED \| CANCELLED`（不要和 Task 的 `SUCCEEDED` 混用；若只给 `SUCCEEDED`，前端会映射成 `PASSED`） |
| `caseSummary` | **已承诺的最小集**：passed / failed / blocked / skipped / total |
| `cases[]` | **文档没有**。用例详情 Tab 需要：`id`、`name`、`testsetId`、`suite`、`status`、`durationMs`、`message`、`filePath`。本轮做不了请明确说，前端保持空表 |
| `reportUrl` / `pdfUrl` | **文档没有**。报告 Tab 要打开 HTML、下载 PDF |
| `artifacts[]` | 文档提到「产物引用」但无形状；至少 `name` + `url` |
| `sandboxId` | **文档没有**；有则展示，没有显示 `—` |
| `startedAt` / `finishedAt` | 算耗时；未结束时 `finishedAt` 为 `null`，不要用 `0` |

`32/32` 这种数字来自某次 test-run 的 `caseSummary`，**不是**前端写的用例，也不是 Testset 配置。

### 4.4 `GET /dry-runs/{dryRunId}/report` 请补响应示例

```json
{
  "id": "dryrun-uuid",
  "projectId": "project-uuid",
  "repositoryId": "project-repository-binding-uuid",
  "sourceRef": "feat/login-api",
  "targetBranch": "main",
  "taskId": null,
  "status": "PASSED",
  "conflicts": [{ "path": "src/auth/AuthController.ts", "message": "双方都修改了 login 方法" }],
  "caseSummary": { "passed": 32, "failed": 0, "blocked": 0, "skipped": 0, "total": 32 },
  "cases": [],
  "summary": "可合并，测试通过",
  "reportUrl": "https://...",
  "pdfUrl": "https://...",
  "startedAt": "2026-08-15T02:00:00Z",
  "finishedAt": "2026-08-15T02:04:00Z",
  "durationSeconds": 240,
  "sandboxId": "sbx-7f2a1c4d",
  "testsetIds": ["testset-uuid"],
  "createdAt": "2026-08-15T02:00:00Z"
}
```

| 项 | 建议 |
| --- | --- |
| `status` | `QUEUED \| RUNNING \| PASSED \| FAILED \| CONFLICT \| CANCELLED` |
| `conflicts` | 冲突时必填；无冲突给 `[]` |
| `caseSummary` / `cases` | 与 test-run 同一套 |
| POST `/dry-runs` 的立即响应 | 请至少返回 `id`（或完整 report），前端才能接着 GET report |

### 4.5 历史运行记录：文档写明本轮没有列表接口

§1：Test Run / Dry Run **历史列表不在本轮范围**。  
页面右侧「历史运行记录」现在只存在**当前浏览器 localStorage**，刷新换设备就没了，也看不到别人发起的运行。

请后端拍板：

1. **本轮仍不做列表**：前端继续只用本机历史；请在契约里写死，避免联调被当成缺数据  
2. **本轮要做**（推荐，否则这列永远是假的）：

```http
GET /projects/{projectId}/test-runs?repositoryId&cursor&limit
GET /projects/{projectId}/dry-runs?repositoryId&cursor&limit
```

列表项最小字段：`id`、`kind`（或分两个接口）、`repositoryId`、`status`、`createdAt`、展示用 `label`（例如源分支 / task 标题）。点一条再走已有的 GET 详情 / report。

SSE：文档有 `test-run.updated`、`dry-run.updated`。请确认 payload 至少含 `projectId` + `testRunId` / `dryRunId`，前端才能刷新「当前运行」。现在任务域事件解析还没接这两类事件。

---

## 5. 按页面汇总：请后端补什么

### Diff 评审

1. 冻结 `GET .../diffs/{diffId}/files` 的文件 / hunk / line JSON  
2. 冻结 comments 的响应：`id`、`authorName`、`createdAt`、`path`、`side`、`line`、`hunkId`、`body`  
3. （可选）Diff 详情增加 `targetBranch`、仓库展示名  
4. 本轮不做：评论已解决、回复串、文件下载

### MR 列表

1. 列表项补 `title`、`webUrl`、`qualityGate`  
2. 冻结 `status`、`qualityGate.status` 枚举

### MR 详情

1. 详情补 `title`、`description`、`webUrl`  
2. **写出 `GET .../checks` 响应体**（四项门禁 + `summary`）  
3. **`requiredChecks` 只保留 Testset / AI Review / Dry-run / CQ+1**  
4. **补 `diffId`（推荐）**，或给 MR 自己的 files/comments，或让 `GET /diffs` 能按仓库+分支过滤  
5. `POST .../merge` 继续：Admin + 门禁 PASSED，否则 `409 QUALITY_GATE_NOT_PASSED`  
6. 本轮不做：reviews、CQ 读写、提交记录、活动时间线

### Testset

1. **统一 Testset JSON**：扁平 `command` 还是 `definition`；补 `scopeTags`、`acceptanceNotes`；`status` 为准  
2. 按 §10 实现创建 / 修改 / 启停 / 删除（若 §17.2 还没做）  
3. 写出 test-run 详情、dry-run report 的完整响应  
4. 确认 `caseSummary`；决定 `cases[]`、`reportUrl`、`pdfUrl`、`sandboxId` 做不做  
5. 拍板历史列表：本轮不做，或补 `GET /test-runs`、`GET /dry-runs`  
6. 确认 `test-run.updated` / `dry-run.updated` 的 payload id 字段名

---

## 6. 请后端直接回复的问题（避免再猜一轮）

1. `GET .../checks` 能否按第 3.3 节示例冻结？`items[].status` 是否就是 `PENDING | PASSED | FAILED`？  
2. MR 能否直接返回 `diffId`？若不能，变更/评论准备让前端怎么定位 Diff？  
3. Testset 列表最终是 §10 扁平字段，还是 §17.2 的 `definition`？`scopeTags` / `acceptanceNotes` 有没有？  
4. `cases[]`、`reportUrl`、`pdfUrl` 本轮给不给？不给的话用例详情和 PDF 按钮会一直空。  
5. Test Run / Dry Run 历史列表本轮做不做？不做请书面确认页面右侧可以继续只用本机记录。

前端实现位置：

- Diff：`src/pages/ProjectDetail/DiffReviewPage.tsx`、`src/types/task-model.ts`（`DiffFile` / `DiffComment`）  
- MR：`src/pages/ProjectDetail/MergeRequestTab.tsx`、`src/pages/ProjectDetail/MergeRequestDetail/MergeRequestDetailPage.tsx`  
- Testset：`src/pages/ProjectDetail/Testset/TestsetPage.tsx`、`src/types/testset.ts`、`src/api/testset.ts`
