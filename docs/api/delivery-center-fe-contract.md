# Delivery Center 前端提案契约

> **状态：Frontend Proposed，待后端实现。**
>
> 本文是成员 B 第一阶段的前端聚合读取模型与调用边界提案，不代表后端已经实现或确认。字段名称遵循当前 `qgents-api-current.md` 的 JSON envelope、cursor 分页、RFC 3339 时间和项目级 ID 风格。

## 1. 业务背景

Delivery Center 是项目级统一交付与审核入口，只聚合三类资源：

- `CODE`：来源于 Task、Diff、DiffReview。前端不能手动伪造代码交付；审核后由后端执行 Commit、Push 和 MR 创建。
- `MEMORY`：普通成员创建草稿、提交审核，Project Admin 审批后成为项目公共 Memory。
- `SKILL`：普通成员创建草稿、提交审核，Project Admin 审批后成为项目公共 Skill。

Delivery Center 只提供聚合列表、统计和审批入口，不替代 Skill/Memory 编辑器，也不创建新的资源执行状态。不得恢复旧的 `Deliverable`、`OrchestrationRun`、`WorkPackage`、`TaskDelivery` 模型。前端聚合模型命名为 `DeliveryItem`；它是读取模型，不是旧 Deliverable 执行模型。

## 2. 角色与权限

服务端根据当前 Token、项目成员关系和资源归属派生 capabilities。前端不得从用户角色或本地项目成员列表猜测按钮权限。

| 角色 | Delivery Center 预期能力 |
| --- | --- |
| `PROJECT_MEMBER` | 查看项目可见交付项；创建/编辑 Skill、Memory 草稿并提交审核；不能审批 |
| `PROJECT_ADMIN` | 查看项目可见交付项；审批、拒绝、归档 Skill/Memory；确认/拒绝 DiffReview；重试可重试的代码交付 |
| 其他无项目访问者 | 服务端返回 `403`，前端不构造本地授权替代结果 |

## 3. 状态机

统一列表展示状态 `displayStatus` 为：

`DRAFT`、`PENDING_REVIEW`、`PROCESSING`、`ACCEPTED`、`REJECTED`、`DELIVERED`、`FAILED`、`ARCHIVED`。

`resourceStatus` 同时保留底层资源原始状态，例如 Memory 的 `APPROVED`、Skill 的 `PUBLISHED`、Task DiffReview 的 `PARTIALLY_DELIVERED`。建议映射：

- Memory：`DRAFT -> DRAFT`，`PENDING_REVIEW -> PENDING_REVIEW`，`APPROVED -> ACCEPTED`，`REJECTED -> REJECTED`，`ARCHIVED -> ARCHIVED`。
- Skill：`DRAFT -> DRAFT`，`PENDING_REVIEW -> PENDING_REVIEW`，`PUBLISHED -> DELIVERED`，`REJECTED -> REJECTED`，`ARCHIVED -> ARCHIVED`。
- CODE：DiffReview 待确认映射 `PENDING_REVIEW`；确认后交付中映射 `PROCESSING`；部分失败或失败映射 `FAILED`；成功映射 `DELIVERED`；归档映射 `ARCHIVED`。具体映射由服务端确定并在响应中返回，前端不自行重算。

资源状态仍遵循既有资源状态机：Memory `DRAFT -> PENDING_REVIEW -> APPROVED / REJECTED / ARCHIVED`；Skill `DRAFT -> PENDING_REVIEW -> PUBLISHED / REJECTED / ARCHIVED`；DiffReview `PENDING_CONFIRMATION -> ACCEPTED / REJECTED`，交付可为 `NOT_STARTED / DELIVERING / DELIVERED / PARTIALLY_DELIVERED / FAILED`。

## 4. 接口路径

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/projects/{projectId}/delivery-items` | 聚合交付项列表 |
| `GET` | `/projects/{projectId}/delivery-summary` | 完整数据集统计 |
| `GET` | `/projects/{projectId}/delivery-items/export` | 导出提案；第一阶段不实现下载 UI |

所有路径均通过 `src/api/client.ts` 调用。列表使用 `{ data, page, requestId }` cursor envelope；统计接口按 v1.8.0 实际响应使用直出 `DeliverySummary` 对象，不再要求 `data` 或 `requestId` 外层字段。

> Runtime alignment (observed 2026-08-15): `GET /projects/{projectId}/delivery-summary` 返回摘要对象本身。前端按该实际 shape 消费，并继续对必需字段做运行时校验；缺字段仍显示局部统计错误。`qgents-api-current.md` 中仍记录的 envelope 是后端文档与实现的待同步项，不在前端补造 `requestId`。

## 5. 查询参数

列表正式参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `groupId` | `string` | Requirement Group ID |
| `type` | `CODE \| MEMORY \| SKILL` | 资源类型 |
| `status` | `DeliveryDisplayStatus` | 统一展示状态 |
| `repositoryId` | `string` | Project Repository ID；非 CODE 项由服务端决定是否返回空集 |
| `createdBy` | `string` | 创建者 ID |
| `cursor` | `string` | 下一页游标 |
| `limit` | `number` | 建议默认 30，最大 100，与项目分页约定一致 |

统计参数仅支持 `groupId`、`repositoryId`。统计必须基于完整筛选数据集，不能从当前列表页推导。

## 6. 请求/响应 DTO

### 列表响应

```json
{
  "data": [/* DeliveryItem[]，见下方 union */],
  "page": { "nextCursor": "cursor_...", "hasMore": true },
  "requestId": "req_01J..."
}
```

TypeScript 形式的完整聚合 DTO 位于 `src/types/delivery-center.ts`，核心契约如下：

```ts
type DeliveryItem = CodeDeliveryItem | MemoryDeliveryItem | SkillDeliveryItem

interface DeliveryItemBase {
  id: string                 // 聚合交付项 ID
  projectId: string
  resourceId: string
  title: string
  summary: string | null
  version: string | null
  displayStatus: DeliveryDisplayStatus
  resourceStatus: string
  requirementGroup: { id: string; name: string } | null
  source: {
    taskId: string | null
    taskDisplayCode: string | null
    taskTitle: string | null
    taskRunId: string | null
    taskStepId: string | null
    messageId: string | null
    artifactId: string | null
  }
  creator: DeliveryActor
  submitter: DeliveryActor | null
  reviewer: DeliveryActor | null
  reviewReason: string | null
  createdAt: string
  submittedAt: string | null
  reviewedAt: string | null
  updatedAt: string
  capabilities: DeliveryCapabilities
}

interface CodeDeliveryItem extends DeliveryItemBase {
  resourceType: "CODE"
  repositories: { repositoryId: string; name: string }[]
  diffReviewId: string | null
  reviewStatus: "PENDING_CONFIRMATION" | "ACCEPTED" | "REJECTED"
  deliveryStatus: "NOT_STARTED" | "DELIVERING" | "DELIVERED" | "PARTIALLY_DELIVERED" | "FAILED"
  filesChanged: number
  additions: number
  deletions: number
  repositoryDeliveries: CodeRepositoryDelivery[]
  mergeRequest: MergeRequestSummary | null
}

interface MemoryDeliveryItem extends DeliveryItemBase {
  resourceType: "MEMORY"
  category: string
  tags: string[]
  visibility: "PRIVATE" | "PROJECT_SHARED"
  sources: { groupId: string | null; messageId: string }[]
  contentExcerpt: string | null
}

interface SkillDeliveryItem extends DeliveryItemBase {
  resourceType: "SKILL"
  tags: string[]
  visibility: "PRIVATE" | "PROJECT_SHARED"
  capabilitySummary: string | null
  contentExcerpt: string | null
}
```

`CodeRepositoryDelivery` 包含 `repositoryId`、`repositoryName`、`deliveryStatus`、`failureCode`、`failureReason`；`MergeRequestSummary` 包含 `id`、`number`、`title`、`status`、`webUrl`。

列表不得返回完整 Memory/Skill 内容、Prompt、凭据或代码 Patch；`summary`、`contentExcerpt`、`capabilitySummary` 都是受长度限制的摘要。

### 统计响应

```json
{
  "total": 0,
  "countsByType": { "CODE": 0, "MEMORY": 0, "SKILL": 0 },
  "countsByStatus": {
    "DRAFT": 0,
    "PENDING_REVIEW": 0,
    "PROCESSING": 0,
    "ACCEPTED": 0,
    "REJECTED": 0,
    "DELIVERED": 0,
    "FAILED": 0,
    "ARCHIVED": 0
  },
  "pendingForCurrentUser": 0,
  "repositorySummaries": [],
  "requirementGroupSummaries": [],
  "updatedAt": "2026-08-15T13:38:15.215Z"
}
```

The backend must update the v1.8.0 delivery-summary documentation and generated API schema to this direct response shape, or restore the documented `{ data, requestId }` envelope consistently. It must not return one shape in production and another shape in the contract. The frontend currently follows the observed direct response and does not synthesize `requestId`, `data`, `pendingItems`, `repositorySummaries`, or `requirementGroupSummaries`.

### Export 提案

`GET /projects/{projectId}/delivery-items/export` 使用与列表完全一致的筛选参数，建议返回 `text/csv; charset=utf-8`（UTF-8 BOM 可选），并设置：

```http
Content-Disposition: attachment; filename="delivery-items-{projectId}.csv"
```

导出列应为列表摘要字段，不包含完整内容、Prompt、凭据或代码 Patch。第一阶段只记录此契约，不实现下载 UI 或 API 调用。

## 7. nullable 规则

- `requirementGroup` 在没有需求群来源时为 `null`，不制造 Group ID。
- `source` 的每个 ID 按真实关系单独 nullable：无 Task 来源时 `taskId`、`taskRunId`、`taskStepId`、`artifactId` 等均可为 `null`；消息来源只填真实 `messageId`。
- `submitter`、`reviewer`、`reviewReason`、`submittedAt`、`reviewedAt`、`mergeRequest`、失败字段和摘要字段在关系不存在时为 `null`。
- `repositories`、`repositoryDeliveries`、`tags`、`sources` 是真实集合，未关联时返回空数组，不用 `null`。

## 8. capability 规则

服务端返回 `capabilities`，包括 `canSubmitReview`、`canApprove`、`canReject`、`canArchive`、`canRetryDelivery`、`canOpenResource`，并返回同名 `disabledReasons` 字典。能力为 `false` 时建议提供可解释原因；前端只展示/使用服务端结果，不根据角色、状态或资源字段重新推导权限。

## 9. 错误码

沿用统一错误 envelope `{ error: { code, message, details? }, requestId? }`：

- `403`：无项目访问权或无审批权限，例如 `PROJECT_ACCESS_DENIED`、`PROJECT_ADMIN_REQUIRED`。
- `404`：项目、聚合项或底层资源不存在/不可见，例如 `PROJECT_NOT_FOUND`、`DELIVERY_ITEM_NOT_FOUND`。
- `409`：资源状态已变化、重复状态转换或并发冲突，例如 `DELIVERY_STATE_CONFLICT`、`IDEMPOTENCY_KEY_REUSED`。
- `422`：筛选参数或业务输入校验失败，例如无效 `limit`、拒绝理由为空、操作不适用。

前端需区分 403/404/409/422。409 后刷新交付列表、统计及关联资源，使用服务端最新响应，不做本地强行覆盖。

## 10. Idempotency-Key

所有 Delivery Center 触发的写操作使用 `Idempotency-Key`。现有 `src/api/client.ts` 会为 `POST/PATCH/PUT/DELETE` 自动生成并在重试时复用；各正式资源 API 也可显式传递该 header。第一阶段未发现现有 Skill、Memory、Task DiffReview 正式接口声明某个操作例外，因此按当前通用写操作约定处理；若后端正式契约声明例外，应以正式契约为准并同步更新本文。

Delivery Center 不新增写路径来保存业务状态：

- `MEMORY` 路由到既有 `submit-review / approve / reject / archive`。
- `SKILL` 路由到既有 `submit-review / approve / reject / archive`。
- `CODE` 路由到 Task DiffReview 的 `confirm / reject / retry-delivery`。

写操作不 optimistic update。成功后刷新 Delivery Center 列表、统计和关联资源；409 后先刷新最新资源，再让页面根据最新 capabilities 决定可用操作。

## 11. Mock 与真实接口替换边界

Mock 文件位于：

- `src/mocks/delivery-center/fixtures.ts`
- `src/mocks/delivery-center/store.ts`
- `src/mocks/delivery-center/handlers.ts`
- `src/mocks/delivery-center/handlers.test.ts`

Mock 只拦截相同 `/api/projects/{projectId}/delivery-items` 和 `/delivery-summary` HTTP 链路；组件和 Query 不直接 import fixture/store。`VITE_USE_MOCK=true` 时由 MSW 响应，关闭后由同一个 `src/api/deliveryCenter.ts` 请求真实后端。

已覆盖：三种类型、草稿、待审、已批准/已发布、已拒绝、代码交付中、代码部分失败、已交付、已归档、当前用户有/无审批能力、无需求群来源、无 Task 来源、多仓库、空列表，以及 403/404/409/422。列表分页和统计分别验证，统计不会从当前页计算。

## 12. 与现有资源接口的关系

- Skill/Memory 的完整编辑、内容读取和正式状态仍由现有 `skillApi`、`memoryApi` 负责；Delivery Center 只返回摘要并复用审批接口。
- Task、TaskRun、Diff、DiffReview 仍由现有 `tasksApi`、`taskRunsApi`、`diffsApi` 负责；CODE 聚合项通过 `source.taskId` 路由到 DiffReview confirm/reject/retry-delivery。
- Delivery Center 不创建 `Deliverable` 等旧模型，不复制业务状态，不替代 Task、Workflow、Agent 或项目其他页面。
- 关联资源刷新由 Query 层负责，使用 `deliveryCenterKeys` 和现有资源 query key 前缀；UI 尚未实现。

## 13. 当前阶段边界

本阶段只完成前端提案契约、Types、API 调用入口、TanStack Query 基础、MSW 基础和文档。尚未实现交付中心 UI、下载 UI、Skill/Memory 完整业务页面，也未修改 Task、TaskRun、Workflow、Agent 或其他成员页面。
