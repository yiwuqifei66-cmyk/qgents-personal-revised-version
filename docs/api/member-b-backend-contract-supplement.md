# Qgents 成员 B 前后端联调契约补充

> **Frontend Proposed / Pending Backend Confirmation**
> 本文是成员 B 联调前的只读审计结果，不是后端已确认的实现说明。

## 1. 文档目的和适用范围

本文逐项核对成员 B 当前前端实现与唯一后端基线，明确哪些接口可以直接联调、哪些字段或接口仍需后端确认，以及 Mock 替换为真实接口时的边界。

审计时间：2026-08-15。

审查对象：

- `TaskCenter`、`TaskDetail`、`TaskRunDetail`、`TaskStep`、`TaskRun`、Logs、ExecutionContext、InputRequest、TaskArtifact；
- Diff 摘要、DiffReview、总 Diff 验收、`repositoryDeliveries`；
- DeliveryCenter 聚合读取与操作路由；
- Workflow 只读展示；
- AgentTeam、Agent 的 Skill 只读摘要/绑定消费；
- 项目级 B 领域 SSE、parser、Query invalidation；
- 对应 Types、API、Hooks、Query Keys、Mock、页面和测试。

本轮不审查：成员 A 的登录、团队、项目、需求群和聊天实现；Skill/Memory 完整编辑器；成员 C 的 files、patch、hunk、comments、测试详情、MR 审查与合并。

## 2. 唯一后端基线

唯一后端基线为：

`docs/api/qgents-api-current.md`

同时对照前端提案：

`docs/api/delivery-center-fe-contract.md`

本审计未读取、未恢复任何旧版后端文档，未修改 `qgents-api-current.md`。

相关基线章节：

- §2：统一 envelope、cursor、错误码和 Idempotency-Key；
- §3：角色和 Task/TaskStep/TaskRun 状态；
- §8/§9：Skill、Memory 正式资源接口；
- §11.1/§11.1.1/§11.3：Agent、Agent-Skill binding、Task/Workspace/TaskStep；
- §12.1/§12.2/§12.3：项目 SSE、TaskRun、Logs、ExecutionContext、InputRequest、Diff；
- §15.3/§15.6：总 Diff Review 和逐仓库交付；
- §16.1–§16.6：Task、TaskStep、TaskRun、Artifact、repositoryDeliveries 增强 DTO。

## 3. 分类标准与数量

以下数量按本文的独立审计 finding 计数，同一个接口在不同维度的问题分别计入对应分类：

| 分类 | 数量 | 含义 |
| --- | ---: | --- |
| `CONFIRMED` | 12 | 后端当前基线已定义，前端调用链和消费字段一致 |
| `BACKEND_MISSING` | 7 | 前端产品或页面已经依赖，后端基线没有正式接口/字段 |
| `FRONTEND_MISMATCH` | 12 | 后端已有定义，但当前前端调用、展示、事件失效或类型没有完全对齐 |
| `MOCK_ONLY` | 12 | 只在 Mock、测试场景或固定 fixture 中存在，不能作为真实契约 |
| `OTHER_MEMBER_DEPENDENCY` | 3 | 依赖其他成员负责的完整业务，不纳入 B 的实现契约 |
| `NEEDS_CONFIRMATION` | 6 | 双方有描述但存在 shape、nullable 或语义歧义 |

## 4. 已确认且前后端一致的接口

| 编号 | 接口/链路 | 审计结论 |
| --- | --- | --- |
| C01 | `GET /projects/{projectId}/tasks` | TaskCenter 使用 `groupId/status/createdBy/repositoryId/cursor/limit`，列表 envelope 与基线一致；`view` 仅为前端 URL 状态，不发给后端。 |
| C02 | `GET /projects/{projectId}/tasks/{taskId}` | TaskDetail 消费 requirement、acceptanceCriteria、workspace、capabilities、artifactSummary、diffReviewSummary、sourceMessage 等增强字段。 |
| C03 | `GET /projects/{projectId}/tasks/{taskId}/steps` | TaskDetail/Workflow 使用正式 TaskStep 字段：sequenceNo、title、role、agent、repository、status、acceptanceNotes、latestRun、runCount、时间字段。分页 envelope 另列为 `NEEDS_CONFIRMATION`。 |
| C04 | TaskRun 列表与详情 | `GET /projects/{projectId}/tasks/{taskId}/task-runs` 和 `GET /projects/{projectId}/task-runs/{taskRunId}` 的 project 作用域、task/taskStep 关联和状态字段一致。 |
| C05 | Logs | `GET /projects/{projectId}/task-runs/{taskRunId}/logs` 使用 cursor/limit，前端只读取 id、sequence、node、content、timestamp，不从正文猜 level。 |
| C06 | ExecutionContext | `GET /projects/{projectId}/task-runs/{taskRunId}/execution-context` 的 workspaceId、sandboxStatus、repositoryId、baseRef、headRef、startedAt、expiresAt 与前端一致，未展示宿主机路径或凭据。 |
| C07 | InputRequest | 查询、reply、approve、reject 的路径、requestId 关联、PENDING 约束和 body 形状一致：reply 为 `{ answer: { value } }`，approve/reject 为 `{ reason }`。 |
| C08 | TaskArtifact | `GET /projects/{projectId}/tasks/{taskId}/artifacts` 返回 Task 级数组，前端按 sequenceNo/类型摘要展示，不把完整 summary 当 Prompt 或环境上下文渲染。 |
| C09 | Diff 摘要 | `GET /projects/{projectId}/diffs` 支持 taskId/cursor/limit，Diff 行展示 repositoryId、branch、commit、changeStats 和关联 ID。 |
| C10 | Task DiffReview | GET/confirm/reject/retry-delivery 的路径、reviewStatus、deliveryStatus、reason 必填、Idempotency-Key 和 409 状态冲突与前端 mutation 一致。 |
| C11 | 项目 SSE 核心链路 | `GET /projects/{projectId}/events`、Bearer、Last-Event-ID、`projectId` 事件 envelope 和基础 Task/TaskRun/Diff/Artifact 事件均已实现。 |
| C12 | Agent 基础读取与 Skill binding 读取 | Agent list/detail、`GET /projects/{projectId}/agent-skill-bindings/{agentId}` 的基本路径和只读消费关系存在；Skill/Memory 完整内容不进入 B 的聚合列表。 |

## 5. 前端已使用但后端尚未定义的内容

### 5.1 `BACKEND_MISSING` 项目清单

| 编号 | 缺失内容 | 当前前端证据 | 阻塞等级 |
| --- | --- | --- | --- |
| B01 | DeliveryCenter 聚合列表接口 | `src/api/deliveryCenter.ts` 调用 `/projects/{projectId}/delivery-items`；当前后端基线全文没有该路径。 | P0 |
| B02 | DeliveryCenter 聚合统计接口 | `useDeliverySummary` 调用 `/projects/{projectId}/delivery-summary`；当前后端基线全文没有该路径。 | P0 |
| B03 | DeliveryCenter export 接口 | 前端提案已定义导出路径，但当前 API/Mock/UI 均未实现，后端基线没有该路径。 | P2 |
| B04 | Agent 分配查询 | `agentApi.assignments` 调用 `/projects/{projectId}/agents/{agentId}/assignments`，AgentTeam 的需求群/Workflow Tab 依赖该接口；后端基线没有该路径。 | P1 |
| B05 | 按 Agent 查询项目 TaskRun | `agentApi.taskRuns` 调用 `/projects/{projectId}/task-runs?agentId=...`，AgentTeam 运行 Tab 和当前运行摘要依赖；后端基线只定义了按 Task 的 TaskRun 列表。 | P1 |
| B06 | Agent runtime/usage/access DTO | AgentTeam 展示 runtime、concurrencyLimit、assignmentUsage、description、skillAccessScope、memoryAccessScope；后端 Agent 卡示例没有这些字段。 | P1 |
| B07 | Attention 到正式 TaskRun 的关联字段 | TaskDetail 通过未在类型中声明的 `attention.taskRunId` cast 后跳转；后端 Task attention 基线只定义 kind/title/summary，没有正式关联 ID。 | P1 |

### 5.2 DeliveryCenter 完整聚合接口提案

以下接口为 `Frontend Proposed / Pending Backend Confirmation`，不是已确认后端接口。

#### B01：聚合列表

请求：

```http
GET /api/v1/projects/project-uuid/delivery-items?groupId=group-uuid&type=CODE&status=PROCESSING&repositoryId=project-repository-uuid&createdBy=user-uuid&cursor=cursor-1&limit=30
Authorization: Bearer <accessToken>
```

GET 无 request body。权限为项目成员可见范围；服务端按 Token 和资源归属过滤，不能由客户端传入角色替代授权。

完整响应示例：

```json
{
  "data": [
    {
      "id": "delivery-item-code-uuid",
      "projectId": "project-uuid",
      "resourceType": "CODE",
      "resourceId": "diff-review-batch-uuid",
      "title": "登录接口代码交付",
      "summary": "登录接口最终 Diff 的交付摘要",
      "version": "1.0.0",
      "displayStatus": "PROCESSING",
      "resourceStatus": "DELIVERING",
      "requirementGroup": { "id": "group-uuid", "name": "登录功能" },
      "source": {
        "taskId": "task-uuid",
        "taskDisplayCode": "T-1024",
        "taskTitle": "实现登录接口",
        "taskRunId": "task-run-uuid",
        "taskStepId": "task-step-uuid",
        "messageId": null,
        "artifactId": "artifact-uuid"
      },
      "creator": { "id": "user-uuid", "displayName": "Lin", "avatarUrl": null },
      "submitter": { "id": "user-uuid", "displayName": "Lin", "avatarUrl": null },
      "reviewer": null,
      "reviewReason": null,
      "createdAt": "2026-08-14T10:00:00Z",
      "submittedAt": "2026-08-14T10:20:00Z",
      "reviewedAt": "2026-08-14T10:21:00Z",
      "updatedAt": "2026-08-14T10:22:00Z",
      "capabilities": {
        "canSubmitReview": false,
        "canApprove": false,
        "canReject": false,
        "canArchive": false,
        "canRetryDelivery": false,
        "canOpenResource": true,
        "disabledReasons": {
          "canSubmitReview": "CODE_REVIEW_IS_NOT_A_DRAFT",
          "canApprove": "DIFF_REVIEW_NOT_DECIDABLE",
          "canReject": "DIFF_REVIEW_NOT_DECIDABLE",
          "canArchive": "CODE_ARCHIVE_NOT_SUPPORTED",
          "canRetryDelivery": "DELIVERY_NOT_RETRYABLE",
          "canOpenResource": null
        }
      },
      "repositories": [
        { "repositoryId": "project-repository-uuid", "name": "auth-service", "branch": "feat/login-api" }
      ],
      "diffReviewId": "diff-review-batch-uuid",
      "reviewStatus": "ACCEPTED",
      "deliveryStatus": "DELIVERING",
      "filesChanged": 2,
      "additions": 10,
      "deletions": 2,
      "repositoryDeliveries": [
        {
          "repositoryId": "project-repository-uuid",
          "repositoryName": "auth-service",
          "deliveryStatus": "COMMITTED",
          "failureCode": null,
          "failureReason": null,
          "mergeRequest": null,
          "updatedAt": "2026-08-14T10:22:00Z"
        }
      ],
      "mergeRequest": null
    },
    {
      "id": "delivery-item-memory-uuid",
      "projectId": "project-uuid",
      "resourceType": "MEMORY",
      "resourceId": "memory-uuid",
      "title": "密码存储约定",
      "summary": "密码存储安全约定摘要",
      "version": null,
      "displayStatus": "ACCEPTED",
      "resourceStatus": "APPROVED",
      "requirementGroup": null,
      "source": {
        "taskId": null,
        "taskDisplayCode": null,
        "taskTitle": null,
        "taskRunId": null,
        "taskStepId": null,
        "messageId": "message-uuid",
        "artifactId": null
      },
      "creator": { "id": "user-uuid", "displayName": "Lin", "avatarUrl": null },
      "submitter": { "id": "user-uuid", "displayName": "Lin", "avatarUrl": null },
      "reviewer": { "id": "admin-uuid", "displayName": "Admin", "avatarUrl": null },
      "reviewReason": null,
      "createdAt": "2026-08-14T09:00:00Z",
      "submittedAt": "2026-08-14T09:10:00Z",
      "reviewedAt": "2026-08-14T09:20:00Z",
      "updatedAt": "2026-08-14T09:20:00Z",
      "capabilities": {
        "canSubmitReview": false,
        "canApprove": false,
        "canReject": false,
        "canArchive": false,
        "canRetryDelivery": false,
        "canOpenResource": true,
        "disabledReasons": {
          "canSubmitReview": "MEMORY_NOT_DRAFT",
          "canApprove": "PROJECT_ADMIN_REQUIRED",
          "canReject": "PROJECT_ADMIN_REQUIRED",
          "canArchive": "PROJECT_ADMIN_REQUIRED",
          "canRetryDelivery": "MEMORY_NOT_RETRYABLE",
          "canOpenResource": null
        }
      },
      "category": "ENGINEERING_DECISION",
      "tags": ["auth", "security"],
      "visibility": "PROJECT_SHARED",
      "sources": [{ "groupId": "group-uuid", "messageId": "message-uuid" }],
      "contentExcerpt": "仅返回脱敏的短摘要，不返回完整 Memory 内容。"
    },
    {
      "id": "delivery-item-skill-uuid",
      "projectId": "project-uuid",
      "resourceType": "SKILL",
      "resourceId": "skill-uuid",
      "title": "API 审查规范",
      "summary": "API 审查能力摘要",
      "version": "0.3.0",
      "displayStatus": "DELIVERED",
      "resourceStatus": "PUBLISHED",
      "requirementGroup": { "id": "group-uuid", "name": "登录功能" },
      "source": {
        "taskId": null,
        "taskDisplayCode": null,
        "taskTitle": null,
        "taskRunId": null,
        "taskStepId": null,
        "messageId": null,
        "artifactId": null
      },
      "creator": { "id": "user-uuid", "displayName": "Lin", "avatarUrl": null },
      "submitter": null,
      "reviewer": { "id": "admin-uuid", "displayName": "Admin", "avatarUrl": null },
      "reviewReason": null,
      "createdAt": "2026-08-14T08:00:00Z",
      "submittedAt": "2026-08-14T08:10:00Z",
      "reviewedAt": "2026-08-14T08:20:00Z",
      "updatedAt": "2026-08-14T08:20:00Z",
      "capabilities": {
        "canSubmitReview": false,
        "canApprove": false,
        "canReject": false,
        "canArchive": false,
        "canRetryDelivery": false,
        "canOpenResource": true,
        "disabledReasons": {
          "canSubmitReview": "SKILL_NOT_DRAFT",
          "canApprove": "PROJECT_ADMIN_REQUIRED",
          "canReject": "PROJECT_ADMIN_REQUIRED",
          "canArchive": "PROJECT_ADMIN_REQUIRED",
          "canRetryDelivery": "SKILL_NOT_RETRYABLE",
          "canOpenResource": null
        }
      },
      "tags": ["api", "review"],
      "visibility": "PROJECT_SHARED",
      "capabilitySummary": "可复用的 API 审查能力摘要",
      "contentExcerpt": "仅返回脱敏摘要，不返回 Prompt、凭据或完整 Skill 内容。"
    }
  ],
  "page": { "nextCursor": "cursor-2", "hasMore": true },
  "requestId": "req_delivery_items_01"
}
```

字段规则：

- `resourceType` 是 `CODE | MEMORY | SKILL` discriminator；专属字段不得跨 union 堆成可选字段。
- `requirementGroup`、source 内各关联 ID、submitter、reviewer、reviewReason、时间字段、摘要字段按真实关系 nullable。
- `repositories`、`repositoryDeliveries`、`tags`、`sources` 无关联时返回 `[]`，不返回 `null`。
- `resourceId` 必须定义语义：CODE 应明确是 DiffReviewBatch ID、Diff ID，还是另有聚合资源 ID；不能让前端把 `diffReviewId` 当 `diffId` 使用。
- 列表不得包含完整 Memory/Skill content、Prompt、Token、凭据、环境变量或代码 Patch。

成功状态：`200`。建议错误：`400 INVALID_QUERY_PARAMETER`、`401 UNAUTHENTICATED`、`403 PROJECT_ACCESS_DENIED`、`404 PROJECT_NOT_FOUND`、`429 RATE_LIMITED`、`500 INTERNAL_ERROR`。GET 不使用 Idempotency-Key。

#### B02：完整数据集统计

请求：

```http
GET /api/v1/projects/project-uuid/delivery-summary?groupId=group-uuid&repositoryId=project-repository-uuid
Authorization: Bearer <accessToken>
```

GET 无 request body。统计必须在完整筛选数据集上计算，不能由当前列表页推导。

完整响应示例：

```json
{
  "data": {
    "total": 12,
    "countsByType": { "CODE": 4, "MEMORY": 5, "SKILL": 3 },
    "countsByStatus": { "DRAFT": 2, "PENDING_REVIEW": 2, "PROCESSING": 1, "ACCEPTED": 3, "DELIVERED": 3, "FAILED": 1 },
    "pendingForCurrentUser": 2,
    "repositorySummaries": [
      {
        "repositoryId": "project-repository-uuid",
        "name": "auth-service",
        "total": 4,
        "accepted": 2,
        "pending": 1,
        "failed": 1,
        "deliveryStatus": "PARTIALLY_DELIVERED",
        "mergeRequestSummary": {
          "id": "mr-uuid",
          "number": 128,
          "title": "feat: implement login API",
          "status": "OPEN",
          "webUrl": "https://github.com/example/auth-service/pull/128"
        }
      }
    ],
    "requirementGroupSummary": [
      { "requirementGroupId": "group-uuid", "name": "登录功能", "total": 8, "pending": 2 },
      { "requirementGroupId": null, "name": null, "total": 4, "pending": 0 }
    ],
    "updatedAt": "2026-08-15T08:00:00Z"
  },
  "requestId": "req_delivery_summary_01"
}
```

字段规则：

- `countsByType` 必须始终包含 CODE、MEMORY、SKILL 三个 key，数量可为 0。
- `countsByStatus` 未出现的状态按 0 解释，不应由前端从分页数据补齐总数。
- `pendingForCurrentUser` 必须由服务端按当前用户和 capabilities 语义计算；若右栏需要可点击项目，建议同时返回 `pendingItems[]`，或明确该字段仅为数量。
- `repositorySummaries`、`requirementGroupSummary` 无数据返回 `[]`。

成功状态：`200`。错误和幂等规则同 B01；GET 不使用 Idempotency-Key。

#### B03：导出

请求：

```http
GET /api/v1/projects/project-uuid/delivery-items/export?groupId=group-uuid&type=CODE&status=DELIVERED&repositoryId=project-repository-uuid&createdBy=user-uuid&cursor=cursor-1&limit=100
Authorization: Bearer <accessToken>
```

GET 无 request body。响应建议为：

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="delivery-items-project-uuid.csv"

id,projectId,resourceType,resourceId,title,displayStatus,resourceStatus,requirementGroupId,taskId,taskDisplayCode,repositoryIds,filesChanged,additions,deletions,createdAt,submittedAt,reviewedAt,updatedAt
delivery-item-code-uuid,project-uuid,CODE,diff-review-batch-uuid,登录接口代码交付,DELIVERED,DELIVERED,group-uuid,task-uuid,T-1024,project-repository-uuid,2,10,2,2026-08-14T10:00:00Z,2026-08-14T10:20:00Z,2026-08-14T10:21:00Z,2026-08-14T10:22:00Z
```

导出只允许列表摘要字段；不得导出完整内容、Prompt、凭据或 Patch。建议错误：`400 INVALID_QUERY_PARAMETER`、`401 UNAUTHENTICATED`、`403 PROJECT_ACCESS_DENIED`、`404 PROJECT_NOT_FOUND`、`429 RATE_LIMITED`、`500 INTERNAL_ERROR`。GET 不使用 Idempotency-Key。

### 5.3 Agent 缺失接口和 DTO 补充

#### B04：Agent 分配列表

请求：

```http
GET /api/v1/projects/project-uuid/agents/agent-uuid/assignments?type=REQUIREMENT_GROUP&cursor=cursor-1&limit=20
Authorization: Bearer <accessToken>
```

GET 无 body。权限为项目成员读取当前项目可见 Agent 的分配摘要。

响应：

```json
{
  "data": [
    { "type": "REQUIREMENT_GROUP", "resourceId": "group-uuid", "resourceName": "登录功能", "status": "ACTIVE" },
    { "type": "REQUIREMENT_GROUP", "resourceId": "group-uuid-2", "resourceName": "安全测试", "status": "ACTIVE" }
  ],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_agent_assignments_01"
}
```

`type` 枚举为 `REQUIREMENT_GROUP | WORKFLOW`。建议状态：`403 AGENT_VIEW_FORBIDDEN`、`404 AGENT_NOT_FOUND`、`422 INVALID_ASSIGNMENT_TYPE`。GET 不使用 Idempotency-Key。

#### B05：按 Agent 查询项目 TaskRun

请求：

```http
GET /api/v1/projects/project-uuid/task-runs?agentId=agent-uuid&status=RUNNING&cursor=cursor-1&limit=20
Authorization: Bearer <accessToken>
```

GET 无 body。权限为项目成员读取项目内可见运行摘要。

响应：

```json
{
  "data": [
    {
      "id": "task-run-uuid",
      "projectId": "project-uuid",
      "taskId": "task-uuid",
      "taskStepId": "task-step-uuid",
      "agentId": "agent-uuid",
      "role": "DEVELOPER",
      "status": "RUNNING",
      "retryOfTaskRunId": null,
      "createdAt": "2026-08-15T08:00:00Z",
      "startedAt": "2026-08-15T08:01:00Z",
      "finishedAt": null,
      "durationMs": null,
      "task": { "id": "task-uuid", "displayId": "T-1024", "title": "实现登录接口" },
      "taskStep": { "id": "task-step-uuid", "title": "实现登录接口", "role": "DEVELOPER" },
      "requirementGroup": { "id": "group-uuid", "name": "登录功能" },
      "repository": { "id": "project-repository-uuid", "displayName": "auth-service" },
      "statusReason": null
    }
  ],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_agent_task_runs_01"
}
```

查询参数 `agentId` 必填，`status` 使用正式 TaskRun 状态，cursor/limit 遵循 §2。建议状态：`400 AGENT_ID_REQUIRED`、`403 PROJECT_ACCESS_DENIED`、`404 AGENT_NOT_FOUND`、`422 INVALID_TASK_RUN_FILTER`。GET 不使用 Idempotency-Key。

#### B06：Agent 卡扩展字段

现有 Agent 路径可以复用，但需在 GET list/detail 响应中正式定义以下字段，或提供等价的独立 runtime endpoint：

```json
{
  "id": "agent-uuid",
  "name": "Backend Developer Agent",
  "avatar": null,
  "role": "DEVELOPER",
  "capabilities": ["Python", "SQL", "API"],
  "visibility": "TEAM",
  "status": "ACTIVE",
  "createdBy": "user-uuid",
  "description": "负责后端接口与数据层实现。",
  "runtime": {
    "status": "RUNNING",
    "activeRunCount": 1,
    "concurrencyLimit": 3,
    "assignmentUsage": {
      "requirementGroups": { "assignedCount": 2, "assignableCount": 3 },
      "workflows": { "assignedCount": 1, "assignableCount": 2 }
    }
  },
  "skillAccessScope": "项目共享",
  "memoryAccessScope": "当前项目共享"
}
```

`runtime.status` 枚举为 `IDLE | RUNNING`，`visibility` 仍遵循 `PRIVATE | TEAM | SYSTEM`。私有 Agent 的 prompt、tools、memoryAccess 只能按现有权限返回给创建者或授权管理员，不能进入列表摘要。

## 6. 后端文档存在但前端尚未对齐的内容

| 编号 | 后端定义 | 当前前端问题 | 处理建议 |
| --- | --- | --- | --- |
| F01 | `repositoryDeliveries[].mergeRequest` 是真实 MR 摘要；DiffReview 的 `diffId` 是 Diff ID。 | `DeliveryCenterPage.openResource` 对 CODE 使用 `item.diffReviewId ?? item.resourceId` 进入 Diff 详情路由，可能把 Batch ID 当作 Diff ID。 | 后端聚合提供可打开的真实 `diffId` 或 taskId 入口；前端改为 `/diffs?taskId=...` 或真实 Diff ID。 |
| F02 | SSE §12.1/§15.6 定义 `merge-request.updated`、`diff-review.skipped`。 | `src/realtime/eventParser.ts` 的事件枚举和 required ID 表没有这两个事件。 | 增加 parser、测试和对应 Query invalidation；`diff-review.skipped` 至少刷新 Task/DiffReview。 |
| F03 | delivery 事件应刷新 Task、DiffReview、MR 列表。 | `src/realtime/queryInvalidation.ts` 没有 DeliveryCenter Query Key；真实 SSE 到达后交付中心列表/统计可能保持旧值。 | 增加 `deliveryCenterKeys.all(projectId)`，delivery 事件同时失效列表和统计。 |
| F04 | Task attention 当前基线只定义 kind/title/summary。 | TaskDetail 通过 unknown cast 读取未定义的 `attention.taskRunId`，没有正式关联 ID 时只能页面定位。 | 后端增加 `taskRunId: string | null`，或明确 attention 只能页面定位；不要让前端猜测。 |
| F05 | InputRequest 可返回 `options[]`。 | TaskRunDetail 总是渲染自由文本 TextArea，未展示或约束正式选项。 | 若 options 是产品必需，应定义选项输入组件和服务端值校验；否则声明 B UI 不消费该字段。 |
| F06 | Skill 状态为 `DRAFT/PENDING_REVIEW/PUBLISHED/REJECTED/ARCHIVED`。 | `src/types/skill.ts` 将最终共享状态写为 `APPROVED`，与基线的 `PUBLISHED` 不一致；Delivery union 用 resourceStatus string 暂时绕过。 | 统一正式 Skill 状态，不把 `APPROVED` 与 `PUBLISHED` 当同义状态。 |
| F07 | Agent 路径当前文档未声明 `projectId` query。 | `agentApi.list/get` 在真实请求中附加 `projectId`；`scenario` 只在 Mock 使用。 | 后端确认 projectId 是否为作用域筛选参数；scenario 不得进入真实业务契约。 |
| F08 | Task/TaskRun/Artifact/DiffReview 都定义了 403/404/409/422 的业务语义。 | TaskDetail 的独立查询错误主要只区分 403，部分 404/409/422 只显示通用“加载失败”；TaskRunDetail 的 SectionError 也未展示 error.code。 | 各区域按状态码和 error.code 显示并保留刷新入口，不能把 409 当普通网络错误。 |
| F09 | Delivery summary 的 `pendingForCurrentUser` 是服务端全量统计。 | 右栏“待我处理”数量来自 summary，但可点击项目由当前分页 `items` 再按 capabilities 截取，可能漏掉不在当前页的待处理项。 | 后端返回 `pendingItems[]` 摘要，或前端只展示数量并取消不可靠定位。 |
| F10 | Delivery API 成功 envelope 包含 requestId。 | `deliveryCenterApi.summary` 只返回 `response.data`，summary 类型和 Hook 丢失 requestId。 | 若 requestId 需要链路追踪，保留 `{ data, requestId }`；否则在契约中明确统计 Hook 不消费 requestId。 |
| F11 | TaskRun 详情允许 `steps` 缺失，内部步骤来自 TaskRun 详情而不是 TaskStep。 | 当前实现符合该边界，但测试/Mock 仍普遍返回 `steps: []`，缺少正式内部步骤的非空字段覆盖。 | 增加带 errorCode、时间和耗时的正式 TaskRunStep fixture；不新增 steps 查询。 |
| F12 | DiffReview 的 MR 完整审查和合并属于 MR 模块。 | DeliveryCenter 只展示 MR 摘要是正确边界，但 CODE `canOpenResource` 没有稳定的真实入口语义。 | 在聚合 DTO 中定义 `resourceLink`/`diffId`/`taskId` 的打开优先级。 |

## 7. `NEEDS_CONFIRMATION` 歧义

| 编号 | 歧义 | 需要后端逐项确认 |
| --- | --- | --- |
| N01 | §11.3/§16.3 的 TaskStep 说明写成数组，当前前端 API 和 Mock 使用 `{ data, page, requestId }`。 | `GET /tasks/{taskId}/steps` 是否正式使用 cursor envelope；若是，补充 `page/requestId` 和 cursor/limit。 |
| N02 | §12.2 旧示例的 TaskRun `artifactSummary` 为 `{ diffs: { count, byStatus } }`，§16.4 增强说明为 `{ total, diffCount }`，前端使用后者。 | 详情和列表最终都采用哪一个 shape；是否需要版本兼容字段。 |
| N03 | DiffReview 批次示例的 `requirementGroupId` 有 `null`，DiffListItem 示例为 string；`repositoryDeliveries.diffId` 示例为 string，前端类型允许 null。 | 明确两字段 nullable 条件，尤其是无需求群来源、无 Diff 或跨仓库部分交付。 |
| N04 | Delivery `resourceId` 与 CODE `diffReviewId` 同时存在。 | 明确 `resourceId` 的资源类型语义，不能让前端用 batch ID 请求 `/diffs/{diffId}`。 |
| N05 | Delivery `displayStatus` 将 Memory APPROVED 映射为 ACCEPTED、Skill PUBLISHED 映射为 DELIVERED。 | 后端是否负责派生并保证稳定映射；前端不得根据 resourceStatus 自行重算。 |
| N06 | `pendingForCurrentUser` 是数量，产品右栏又要求展示可点击待处理项。 | 后端是否新增 `pendingItems[]`；若不新增，正式产品只承诺数量。 |

## 8. 数据链检查

### 8.1 Task 执行链

```text
projectId
  -> requirementGroupId
  -> taskId
  -> taskStepId
  -> taskRunId
  -> inputRequestId / artifactId / diffId
  -> diffReviewBatchId
  -> repositoryDelivery / mergeRequest summary
```

审计结果：

- Task、TaskStep、TaskRun、InputRequest、Artifact、Diff、DiffReview 的正式 ID 在 current baseline 和 `src/types/task-model.ts` 中基本一致；
- TaskRun 详情校验 `taskRun.taskId === route taskId`，页面不接受跨 Task 的运行；
- Mock handlers 也按 projectId、taskId、taskRunId、requestId 关联校验；
- `repositoryDeliveries[].diffId` 和 Delivery CODE 的 `resourceId` 仍需确认 nullable/语义；
- 没有发现生产 DTO 使用 `orchestrationRunId`、`workPackageId`、`subtaskId` 或 `deliverableId`；
- `runId`、`stepId` 仅作为页面局部变量或 SSE 的正式 `stepId` payload 使用，不作为旧资源 DTO 字段恢复；
- `src/types/task.ts` 是未被 B 当前 API/页面导入的重复旧型文件，不作为联调契约来源，也未在本轮恢复或修改。

### 8.2 Delivery 聚合链

```text
projectId
  -> deliveryItemId
  -> resourceType
  -> resourceId
  -> CODE / MEMORY / SKILL 专属摘要
  -> submitter / reviewer / capabilities
  -> source.task / source.group / source.message / source.artifact
```

审计结果：

- 前端 union 和页面 discriminator 一致，没有通过“字段是否存在”猜测类型；
- Source ID 按字段分开 nullable，Skill 无 Task/Message 来源时 Mock 使用 null；
- Memory/Skill 聚合类型没有 content、Prompt、凭据和 Patch 字段；
- 正式后端尚未定义该聚合链，因此 resourceId、摘要脱敏长度、capabilities 派生和 source 关系都不能视为已确认；
- CODE 操作底层路由到 Task DiffReview；MEMORY/SKILL 操作底层路由到现有资源接口，不创建重复业务状态。

## 9. Capabilities 权限矩阵

前端只使用服务端 `capabilities`；下表是联调期预期语义，不是客户端授权规则：

| capability | 资源/操作 | 典型允许者 | 服务端必须校验 | disabledReason 示例 |
| --- | --- | --- | --- | --- |
| `canSubmitReview` | Memory/Skill submit-review | 草稿创建者或正式允许的成员 | resourceStatus=DRAFT、资源归属 | `RESOURCE_NOT_DRAFT` |
| `canApprove` | Memory approve、Skill approve、CODE confirm | PROJECT_ADMIN；CODE 还需 DiffReview 可决策 | Token、项目、资源状态 | `PROJECT_ADMIN_REQUIRED` / `DIFF_REVIEW_NOT_DECIDABLE` |
| `canReject` | Memory/Skill reject、CODE reject | PROJECT_ADMIN；CODE 遵循 DiffReview 权限 | reason 非空、状态可决策 | `PROJECT_ADMIN_REQUIRED` |
| `canArchive` | Memory/Skill archive | PROJECT_ADMIN | 资源已发布/批准且可归档 | `RESOURCE_NOT_ARCHIVABLE` |
| `canRetryDelivery` | CODE retry-delivery | Task 发起人或 PROJECT_ADMIN | reviewStatus=ACCEPTED 且部分/失败交付 | `DELIVERY_NOT_RETRYABLE` |
| `canOpenResource` | 打开完整资源/摘要 | 当前用户可见资源 | 资源仍存在且可见 | `RESOURCE_NOT_FOUND` |

服务端返回 false 和 disabledReason，前端不得依据本地角色、displayStatus、resourceStatus 或当前用户名称重新推导允许性。404/403 对不可见资源不得通过客户端拼接 ID 绕过。

## 10. 状态机

### 10.1 Task/TaskStep/TaskRun

```text
Task:
PLANNING -> PENDING -> RUNNING -> WAITING_DIFF_CONFIRMATION -> DELIVERING
  -> SUCCEEDED / DELIVERY_FAILED / FAILED
RUNNING -> CANCELLING -> CANCELLED

TaskStep:
PENDING -> RUNNING -> SUCCEEDED / FAILED / SKIPPED

TaskRun:
QUEUED -> RUNNING -> SUCCEEDED / FAILED
RUNNING -> WAITING_INPUT / WAITING_APPROVAL / BLOCKED
未完成运行 -> CANCELLING -> CANCELLED
```

TaskRun retry 只允许 `FAILED/CANCELLED/BLOCKED`，新运行必须返回 `retryOfTaskRunId`。InputRequest 只有 PENDING 可操作；拒绝 InputRequest 后由服务端决定 BLOCKED 或安全取消，前端不直接改运行状态。

### 10.2 Diff/DiffReview/RepositoryDelivery

```text
Diff: PENDING_REVIEW -> ACCEPTED / REJECTED

DiffReview:
PENDING_CONFIRMATION -> ACCEPTED / REJECTED

Delivery:
NOT_STARTED -> DELIVERING -> DELIVERED
                         -> PARTIALLY_DELIVERED / FAILED

RepositoryDelivery:
NOT_STARTED -> COMMITTED -> MR_CREATED
                         -> FAILED
```

确认总 Diff 只表示用户接受快照，不等于所有仓库已创建 MR。前端必须等待返回状态和 SSE，不能将 ACCEPTED 直接展示成全部已交付。

### 10.3 DeliveryCenter 展示状态

`DRAFT | PENDING_REVIEW | PROCESSING | ACCEPTED | REJECTED | DELIVERED | FAILED | ARCHIVED` 只能由服务端返回。Memory 的 APPROVED、Skill 的 PUBLISHED、CODE 的 repository delivery 状态应同时保留在 `resourceStatus`/专属字段中，映射规则需要 N05 确认。

## 11. Cursor 分页

统一分页 envelope：

```json
{
  "data": [],
  "page": { "nextCursor": "cursor-...", "hasMore": true },
  "requestId": "req-..."
}
```

规则：

- 默认 limit 30，最大 100；Task 列表当前后端增强说明为默认 20，需按接口单独确认；
- `hasMore=false` 时 `nextCursor` 应为 null；
- 空列表使用 `data: []`，不是 null，不制造虚假资源 ID；
- `cursor` 由服务端生成，前端只回传 opaque cursor；
- Logs 的 cursor 语义是上页最后一条日志的 sequence，但仍以 `nextCursor` 字符串传递；
- TaskArtifact 当前正式定义为 Task 级数组，不应被前端强行包装为分页；
- TaskStep 的 envelope 是 N01，联调前必须冻结。

## 12. Nullable 和空数组规则

| 字段 | nullable/空数组规则 |
| --- | --- |
| requirementGroup / requirementGroupId | 没有真实需求群关系时 null；不得制造 group ID。 |
| source.taskId/taskRunId/taskStepId/messageId/artifactId | 每个 ID 独立 nullable，只有真实关系才填写。 |
| submitter/reviewer/reviewReason/submittedAt/reviewedAt | 关系或状态尚未发生时 null。 |
| repositories/repositoryDeliveries/tags/sources | 集合无数据时 `[]`，不使用 null。 |
| Task.acceptanceCriteria | 当前基线明确可能为空数组；页面显示紧凑空态。 |
| Task.sourceMessage | 无 trigger message 时 null；页面不渲染来源卡。 |
| TaskRun.steps | 详情可缺失或为空；页面显示“当前执行器未返回内部步骤”，不发起独立 steps 查询。 |
| TaskRun.startedAt/finishedAt/durationMs | 未开始或未结束时 null，durationMs 不用 0 代替。 |
| ExecutionContext.startedAt/expiresAt | 生命周期无对应时间时 null。 |
| mergeRequest/failureReason | 没有真实 MR/失败时 null，不根据状态或数量伪造。 |

## 13. 错误码和页面隔离

通用 envelope：

```json
{
  "error": {
    "code": "DIFF_REVIEW_NOT_DECIDABLE",
    "message": "Diff review is no longer pending",
    "details": [{ "field": "reviewStatus", "reason": "ACCEPTED" }]
  },
  "requestId": "req-..."
}
```

| HTTP | 联调语义 | B 页面处理要求 |
| ---: | --- | --- |
| 400 | 参数格式/必填字段错误 | 当前操作区域显示字段错误；不隐藏其他区域。 |
| 401 | 未认证或 Token 失效 | 由 client/AuthContext 统一处理。 |
| 403 | 项目或操作权限不足 | 显示无权限；不根据本地角色补按钮。 |
| 404 | 资源不存在或不可见 | 当前区域显示不存在；不伪造关联 ID。 |
| 409 | 幂等键复用、状态变化、快照过期 | 刷新最新资源、列表、统计和关联 Query；不 optimistic update。 |
| 422 | 当前状态/参数不可操作 | 当前区域显示业务校验结果；保留其他内容。 |
| 429 | 限流 | 当前查询/操作区域可重试。 |
| 500 | 服务异常 | 当前区域失败，不让整页消失。 |

当前 Mock 额外使用 `MOCK_NOT_FOUND`、`VALIDATION_FAILED`、`INVALID_STATE_TRANSITION` 等开发错误码；这些不应写入正式联调断言，除非后端确认。

## 14. Idempotency-Key

后端基线要求写操作支持 `Idempotency-Key`：同一用户 24 小时内相同 key+相同 body 回放首次结果；相同 key+不同 body 返回 `409 IDEMPOTENCY_KEY_REUSED`。

当前前端：

- `src/api/client.ts` 对 POST/PATCH/PUT/DELETE 自动补 key，并在 401 重试时复用同一 key；
- `writeModelHeaders()` 和 `writeHeaders()` 也会显式生成 key；
- Skill/Memory API 没有显式传 headers，但仍经过 client 自动补 key；
- Agent-Skill binding 的 PUT 在后端基线明确“幂等，无需 Idempotency-Key”，当前 B 页面只读消费，不调用该 PUT；
- 不做 optimistic update，mutation 成功后通过 Query invalidation 获取服务端结果；
- 409 需刷新最新资源，而不是本地修改 status。

Mock 差异：Task DiffReview Mock 校验了缺失、复用和 replay；Task/TaskRun/InputRequest、DeliveryCenter、Agent 写 handler 没有完整校验缺失 key 或 key reuse。因此 Mock 通过不能证明正式幂等契约已覆盖。

## 15. SSE 事件字段与 Query 失效关系

### 15.1 当前已实现的事件字段

基础事件至少含 `projectId`；关联事件使用正式 ID：

| 事件 | 必填定位字段 | 应刷新 |
| --- | --- | --- |
| `task.updated` | taskId | Task list/detail |
| `task-step.updated` | taskId/taskStepId | Task detail、TaskStep list、TaskRun list |
| `task-run.updated` | taskId/taskStepId/taskRunId | TaskRun detail/list、Task detail |
| `task-run.step.progress` | taskId/stepId/taskRunId | TaskRun detail |
| `input-required` / `approval-required` | taskId/taskStepId/taskRunId/inputRequestId/kind/status/prompt | Task、TaskRun、InputRequest |
| `diff.created` | taskId/diffId/repositoryId/status | Diff、Task、DiffReview |
| `task.artifact.created` | taskId/artifactId/sequenceNo/artifactType | Artifact、Task |
| `task-run.artifact.created` | 上述字段 + taskRunId/taskStepId | Artifact、TaskRun |
| `diff-review.created` | taskId/reviewBatchId/reviewStatus/aggregateHash | Task、DiffReview |
| `task.awaiting-diff-confirmation` | taskId/reviewBatchId | Task、DiffReview |
| `diff-review.confirmed/rejected` | taskId/reviewBatchId | Task、DiffReview |
| `delivery.repository.updated` | projectId/taskId/diffId/deliveryStatus | Task、DiffReview、MR 摘要、DeliveryCenter |
| `delivery.completed/failed` | projectId/taskId/reviewBatchId/deliveryStatus | Task、DiffReview、MR 摘要、DeliveryCenter |
| `task.diff-review.failed` | taskId/reviewBatchId/reason | Task、DiffReview、错误提示 |

### 15.2 当前不一致

- 后端基线还定义 `merge-request.updated` 和 `diff-review.skipped`，前端 parser 不接受；
- `queryInvalidation.ts` 没有 DeliveryCenter root key，因此交付事件不会刷新 `deliveryCenterKeys.items/summary`；
- SSE 只负责触发刷新，乱序或恢复后仍应重新请求正式资源；
- `Last-Event-ID` 续传点过期返回 `409 EVENT_CURSOR_EXPIRED`，当前连接层会刷新 Task model root，但也需要确认是否刷新 DeliveryCenter 聚合。

## 16. 隐私和脱敏字段

后端必须保证：

- Logs 不包含 Token、密码、GitHub 安装令牌、私钥、未脱敏环境变量或宿主机绝对路径；
- ExecutionContext 只返回 Workspace/Sandbox 的只读摘要，不返回容器控制入口；
- TaskArtifact.summary、description、resources 必须是脱敏展示摘要；
- DeliveryCenter 不返回 Memory/Skill 完整 content、Prompt、凭据或代码 Patch；
- Agent 私有 Prompt 仅创建者或后端明确授权的管理员可见；Agent 列表不能泄露私有 Prompt；
- MR 只返回 id/number/title/status/webUrl 摘要，完整审查和合并由 MR 模块负责；
- `contentExcerpt`、`summary`、`capabilitySummary` 必须有服务端长度上限并保持纯文本。

## 17. Mock 专项审查

### 17.1 Mock 有、后端文档没有的字段/能力

1. DeliveryItem/DeliverySummary 的全部聚合字段、capabilities、disabledReasons、repositorySummaries、requirementGroupSummary。
2. Delivery CODE/MEMORY/SKILL 专属摘要字段和 `DeliveryMergeRequestSummary`。
3. Agent `runtime`、`assignmentUsage`、`skillAccessScope`、`memoryAccessScope`、`description`、`tools`、`memoryAccess`。
4. Agent assignments 和按 Agent TaskRun 查询响应。
5. Mock 的 `scenario=FORBIDDEN|NOT_FOUND|CONFLICT|UNPROCESSABLE|EMPTY` 查询开关。
6. 固定用户 `Demo Member`、`Project Admin`、`Demo Admin`，固定需求群 `Delivery Center rollout`，固定仓库 `qgents-web/qgents-docs`，固定 MR URL。
7. Task mock 的 `displayCode`、`requirementGroup`、createdByUser、执行状态批量场景和固定 workspace/repository ID。
8. TaskRun mock 直接生成 `steps`、logs、ExecutionContext、InputRequest 关联，并用 `MOCK_NOT_FOUND`、`VALIDATION_FAILED`、`INVALID_STATE_TRANSITION` 等开发错误码。
9. Agent binding fixture 中出现 `TEAM_SHARED` visibility，而 current baseline 示例使用 `PROJECT_SHARED`。
10. Delivery summary 的 `updatedAt` 固定为 fixture 时间，未体现真实数据更新时间。
11. Delivery handler 为 action 生成 `delivery-*-Date.now()` requestId，不能作为后端 requestId 格式断言。
12. Mock delivery 状态可以直接把 CODE retry 设置为 DELIVERED，不模拟逐仓库异步推进和 MR_CREATED 回写。

### 17.2 页面依赖但 Mock 覆盖不足

- TaskArtifact 的 `description`、`resources`、非空 `summary` 没有有效业务样本；页面只能验证空态/摘要路径。
- TaskRunStep 的 errorCode、PASSED/FAILED/SKIPPED/CANCELLED 多状态非完整覆盖。
- ExecutionContext 主要是 RUNNING，异常 sandbox、过期、无 context 的页面隔离需要更多场景。
- Delivery `mergeRequest` 在 task-model Mock repositoryDeliveries 中基本为 null，真实 MR 摘要主要只在 DeliveryCenter fixture 出现。
- DeliveryCenter 的 capabilities fixture 只覆盖布尔组合，handler 没有逐 capability 校验动作适用性。

### 17.3 Mock 状态转换与正式状态机差异

- Delivery resource action 的权限判断使用多个 capability 的合取条件，不能精确模拟单一操作权限；
- Delivery code action 不按 capability 和正式 reviewStatus/deliveryStatus 完整校验；
- Delivery handler 不校验 Idempotency-Key，也没有 key reuse replay；
- Delivery summary 的 `pendingForCurrentUser` 只是统计全部 `PENDING_REVIEW`，不是基于当前用户；
- TaskRun/Task/InputRequest Mock 的主要状态转换与 current baseline 一致，但部分 error.code 仍是 Mock 自定义值；
- TaskRun retry clone 会删除 steps，符合“新运行由执行服务重新提供内部步骤”的方向，但缺少真实异步过程。

### 17.4 固定 ID/标题/数组位置风险

- 页面主体没有直接 import fixture/store，均通过 API/Hook；
- Mock tests 使用固定 ID 进行关联断言是可接受的测试数据，但业务代码不能依赖数组位置；
- DeliveryCenter 当前 `openResource` 把聚合 ID 直接拼入 Diff 详情路由，属于真实代码问题，不应由固定 Mock ID 掩盖；
- TaskCenter/TaskDetail/TaskRunDetail 通过正式 ID 关联，不依赖标题或数组索引；
- `TaskRunStep` UI key 使用 node+时间回退 index，仅用于 React key，不参与业务关联。

## 18. UI 展示字段来源表

| 页面区域 | 展示内容 | 正式 DTO 字段 | Mock 是否覆盖 | 后端是否已定义 | 处理建议 |
| --- | --- | --- | --- | --- | --- |
| TaskCenter 卡片 | displayCode/title/status | `TaskListItem.displayCode/title/status` | 是 | 是 | 保持；不展示 priority。 |
| TaskCenter 卡片 | 需求群、摘要、仓库/分支、创建者、更新时间 | `requirementGroup`、`requirementSummary`、`repositories`、`createdByUser`、`updatedAt` | 是/部分固定 | 是 | 多仓库继续按数组；不要固定第一仓库代表全量语义。 |
| TaskCenter 卡片 | 执行阶段、完成数、attention | `executionSummary`、`attention` | attention 有，多数执行计数固定 0 | 是，但 attentionRunId 未定义 | attention 跳转需补正式关联或只做页面定位。 |
| TaskDetail 任务头 | displayCode/title/status、group/stage/creator/time/repo count | TaskDetail 在 TaskListItem 基础上的字段 | 是 | 是 | 当前布局一致。 |
| TaskDetail attention | kind/title/summary、运行入口 | `attention`；运行入口需要 taskRunId | 无正式 taskRunId | 部分 | 增加 `taskRunId: string | null` 或冻结无 ID 行为。 |
| TaskDetail 执行流程 | sequence/title/status/role/agent/repository/branch/acceptance/latestRun/runCount | `TaskStepListItemResponse` | 字段大多有，agent/latestRun 样本不足 | 是，分页待确认 | 补齐非空 agent/latestRun fixture，确认 envelope。 |
| TaskDetail 需求上下文 | requirement/acceptance/source message | `requirement`、`acceptanceCriteria[]`、`sourceMessage` | 有空态和 source null | 是 | 只展示脱敏 sourceMessage，不读取 discussionSummary。 |
| TaskDetail 执行产物 | type/title/status/description/resources/关联运行 | `TaskArtifact` 增强字段 | description/resources 主要为空 | 是 | 增加真实摘要 fixture；不展示完整 summary。 |
| TaskDetail 代码变更 | Diff 数量、仓库、files/additions/deletions/入口 | `DiffListItem.changeStats`、repositoryId、taskId | 是 | 是 | 真实 Diff ID 入口可用；无 Diff 隐藏大空区。 |
| TaskDetail 交付结果 | reviewStatus/deliveryStatus/repositoryDeliveries/failure/MR/confirm/reject/retry | `DiffReviewBatch`、`repositoryDeliveries`、Task capabilities | 部分有，多数 MR null | 是 | 保持总 Diff 操作；MR 只显示真实摘要。 |
| TaskRunDetail 摘要 | 标题、status、Agent、role、时间、duration、retry parent、ID | `TaskRunDetail` + `TaskStep` | 是 | 基本是；artifactSummary shape 待确认 | 统一 detail DTO 的 artifactSummary。 |
| TaskRunDetail 轨迹 | node/status/时间/duration/errorCode | `TaskRunDetail.steps[]` | 主要空数组，errorCode 覆盖不足 | 是 | 只读 steps，不新增查询。 |
| TaskRunDetail Logs | sequence/timestamp/node/content/cursor | `LogEntryResponse` | 有基础日志 | 是 | 不推断 level，不展示敏感正文。 |
| TaskRunDetail 环境 | workspace/sandbox/repository/ref/时间 | `ExecutionContext` | 有 RUNNING 样本 | 是 | 增加异常状态样本，错误隔离。 |
| TaskRunDetail InputRequest | prompt、reply/approve/reject、只读结果 | `InputRequest`、reply/decision body | INPUT/APPROVAL 和状态转换有 | 是 | options 是否呈现待确认。 |
| TaskRunDetail 运行结果 | statusSummary、artifact total、diffCount、retry parent、task Diff 入口 | `TaskRunSummary.statusSummary/artifactSummary/retryOfTaskRunId` | 有 | shape 有冲突 | 不伪造 diffId，继续使用 taskId Diff 入口。 |
| DeliveryCenter CODE | task/source、repo/branch、Diff stats、review/delivery、repositoryDeliveries、MR | proposed `CodeDeliveryItem` | 是 | 否 | P0 等后端聚合接口；确认 resourceId/link。 |
| DeliveryCenter MEMORY/SKILL | excerpt/category/tags/visibility/status/source/actors | proposed unions + existing Memory/Skill IDs | 是 | 否（聚合未定义） | 只消费摘要和审核状态，不做完整编辑器。 |
| DeliveryCenter 右栏 | 全量总数、类型/状态、仓库、pending、需求群 | proposed `DeliverySummary` | 是 | 否 | 不从当前页计算；pending 项目需新增 locator 或取消点击。 |
| Workflow | Task selector、TaskStep graph、依赖、role、agent、repository、TaskRun history、Skill names | Task/TaskStep/TaskRun、Agent、AgentSkillBinding | 是/部分 | 基础是 | 不扩展执行模型；Skill 只读摘要。 |
| AgentTeam 列表 | identity、role、runtime、usage、Skill/Memory access | AgentSummary 扩展 | 是 | identity 是；runtime/usage/access 未定义 | B04–B06 后端确认前不能声称真实联调完成。 |
| AgentTeam 详情 | assignments、当前 TaskRun、Skill binding、capabilities/tools/memory | Agent assignment/task-run 缺失接口 + binding response | Mock 有 | 部分 | assignments/runs 补正式接口；Prompt 继续权限隔离。 |
| DiffReview 逐仓库 | status、failure、MR summary | `repositoryDeliveries[]` | failure 有，真实 MR 不足 | 是 | 保留摘要，不实现 MR 审查/合并。 |

## 19. Mock 与真实接口替换边界

### 19.1 可以直接替换

- 组件只能通过 `src/api`、Hooks 和 Query 读取数据；当前 B 页面没有直接读取 fixture/store 的生产代码；
- Task/TaskRun/Diff/Artifact/InputRequest 的 `src/mocks/task-model/handlers.ts` 与 API path 基本同链路；
- Agent、DeliveryCenter 也通过同名 API/Hook 进入页面；
- 关闭 `VITE_USE_MOCK` 后，`src/api/client.ts` 使用配置的后端 base URL，不读取 fixture/store；
- SSE 在 Mock 模式关闭，真实模式通过 `fetch-event-source` 连接项目 events。

### 19.2 不能直接替换

- DeliveryCenter 后端尚无 list/summary/export，必须先冻结 B01–B03；
- AgentTeam assignment/task-run/runtime 字段尚无正式契约，不能以 Mock response 直接当真实 response；
- Delivery handler 没有完整 Idempotency-Key 和 capability/state 校验，不能用 Mock 通过替代联调证据；
- fixed project aliases、固定人名、固定 MR URL、固定 requestId 只能用于演示；
- SSE parser/invalidation 当前不覆盖 delivery 聚合和两个已定义事件，真实实时数据会出现陈旧展示。

## 20. 与现有资源接口的关系

### Task / TaskRun / TaskStep

Task 是顶层资源，TaskStep 是 Planner 计划节点，TaskRun 是某 TaskStep 的执行尝试。B 页面不得恢复 orchestrationRun、WorkPackage、Deliverable、TaskDelivery 等旧执行模型。

### Diff / DiffReview

普通单 Diff 可读取摘要；属于最终批次的 Diff 不调用单 Diff accept/reject，必须走 Task 级 DiffReview confirm/reject/retry-delivery。B 只展示摘要和确认结果，不实现 files、patch、comments、MR 审查或合并。

### Skill / Memory

DeliveryCenter 的 Skill/Memory 只消费聚合摘要、来源、审核者、状态和 capabilities。完整内容、Prompt、草稿编辑、发布后的完整业务页面属于其他成员；统一操作必须路由到正式资源接口，不得在 DeliveryCenter 复制状态机。

### Workflow / AgentTeam

Workflow 只读消费 Task/TaskStep/TaskRun 和 Agent Skill binding 摘要。AgentTeam 可消费 Agent 身份卡和 Skill binding；runtime、assignment、按 Agent TaskRun 需要 B04–B06 正式契约。

## 21. 联调顺序

1. 后端先确认 N01–N06 的 shape、nullable、resourceId、状态映射和 pending locator 语义。
2. 后端实现 B01 Delivery list，并使用真实 project/repository/group/source 关联；先完成 403/404/400/429/500。
3. 后端实现 B02 summary，校验完整数据集统计、当前用户 capabilities 和仓库摘要。
4. 后端确认并实现 Skill/Memory/CODE 聚合操作的底层路由、error.code、幂等回放和 409 状态冲突。
5. 后端补齐 B04–B06 AgentTeam 接口/DTO，确认 Agent prompt、tools、Memory scope 的隐私边界。
6. 前端先修正 CODE 资源打开入口、SSE parser 和 DeliveryCenter Query invalidation，再进行实时联调。
7. 用真实数据验证 Task → TaskStep → TaskRun → Artifact/Diff → DiffReview → repositoryDelivery/MR 全链路，并验证跨 project ID 不可见。
8. 最后联调 B03 export；下载 UI 不作为本阶段阻塞。

## 22. P0 阻塞项

| 编号 | 阻塞 | 影响 |
| --- | --- | --- |
| P0-1 | 后端基线没有 `/projects/{projectId}/delivery-items`。 | DeliveryCenter 列表、三类 union、审批入口无法连接真实后端。 |
| P0-2 | 后端基线没有 `/projects/{projectId}/delivery-summary`。 | 右侧全量概览、仓库状态、pending 数量无法得到可信数据。 |
| P0-3 | Delivery 聚合的 resourceId、displayStatus、capabilities、source、MR/逐仓库摘要均未冻结。 | 即使临时补 endpoint，也无法保证 CODE/MEMORY/SKILL 操作和跳转语义一致。 |
| P0-4 | Delivery 事件不刷新 DeliveryCenter，且 parser 漏掉 `merge-request.updated`/`diff-review.skipped`。 | 真实交付状态和 MR 摘要会陈旧，失败/空 Diff 状态不能及时收敛。 |

P1 事项：AgentTeam B04–B06；Task attention 正式 TaskRun 关联；TaskStep pagination；TaskRun artifactSummary shape；Skill `PUBLISHED`/`APPROVED` 状态统一。

## 23. 后端逐项回复表

请后端对每一行填写“确认/修改/拒绝”和版本或接口文档位置：

| 编号 | 后端回复 | 文档/版本位置 | 是否影响前端联调 |
| --- | --- | --- | --- |
| N01 | 待填写：TaskStep 是否 cursor envelope |  | 是 |
| N02 | 待填写：TaskRun artifactSummary 最终 shape |  | 是 |
| N03 | 待填写：DiffReview requirementGroupId/diffId nullable |  | 是 |
| N04 | 待填写：Delivery resourceId 与 diffReviewId/diffId 语义 |  | 是 |
| N05 | 待填写：displayStatus/resourceStatus 映射由谁派生 |  | 是 |
| N06 | 待填写：pendingForCurrentUser 是否增加 pendingItems |  | 是 |
| B01 | 待填写：Delivery list 是否实现、权限、DTO、错误码 |  | P0 |
| B02 | 待填写：Delivery summary 是否实现全量统计 |  | P0 |
| B03 | 待填写：Export 格式、Content-Disposition、字段白名单 |  | 否，本阶段 UI 可后置 |
| B04 | 待填写：Agent assignments endpoint |  | P1 |
| B05 | 待填写：Agent task-runs endpoint |  | P1 |
| B06 | 待填写：Agent runtime/usage/access DTO |  | P1 |
| B07 | 待填写：attention.taskRunId 是否正式返回 |  | P1 |
| F02/F03 | 待填写：SSE 两个事件和 DeliveryCenter invalidation 责任 |  | P0 |
| F06 | 待填写：Skill 最终共享状态使用 PUBLISHED 还是 APPROVED |  | P1 |

## 24. 审计结论

TaskCenter、TaskDetail、TaskRunDetail、TaskStep、TaskRun、Logs、ExecutionContext、InputRequest、Artifact、Diff/DiffReview 的核心读取链路已基本遵循 current baseline，且没有恢复旧执行模型。当前真正阻塞前后端联调的是 DeliveryCenter 聚合契约、AgentTeam 扩展接口/字段以及交付相关 SSE 刷新闭环。

在后端逐项回复表完成、B01/B02 真实接口冻结、resourceId/capabilities/status mapping 明确之前，不能把 DeliveryCenter Mock 视为已完成真实联调。
