# Qgents Task Workbench 前后端契约补充

**Frontend Proposed / Pending Backend Confirmation**  
适用版本：基于 `docs/api/qgents-api-current.md` v1.9.7；本文件不替代正式接口文档。

## 1. 目的与范围

任务详情调整为用户的主工作台：头部展示需求说明摘要与来源跳转，主区展示任务级流程、最近执行与代码变更/交付确认，右侧常驻展示选中单次运行的诊断信息。任务详情不展示 Task 级验收标准；流程行已直接高亮当前步骤，因此不再重复展示“当前执行”辅助卡。`TaskRun` 仍是唯一的单次执行实体；其诊断不再以抽屉或独立页面打断任务浏览，而是由 `runId` 选中并在右栏更新。

执行模型固定为：`Task -> TaskStep -> TaskRun`。不得恢复 `OrchestrationRun`、`WorkPackage`、`Deliverable`、`TaskDelivery` 或 `Subtask`。

本文件只涉及 Task、TaskStep、TaskRun、日志、InputRequest、ExecutionContext、Artifact、Diff 与 DiffReview；不涉及文件 patch、MR 审查、Skill 或 Memory 完整业务。

## 2. 已有接口可直接消费（CONFIRMED）

| 工作台区域 | 正式接口/字段 | 前端用途 |
|---|---|---|
| 任务抬头 | `GET /projects/{projectId}/tasks/{taskId}`；`title`、`displayCode`、`status`、`requirementGroup`、`executionSummary`、`repositories`、`repositoryIds`、`attention` | 当前状态、阶段、仓库、待处理提示 |
| 任务级流程 | `GET /projects/{projectId}/tasks/{taskId}/steps` cursor envelope；`TaskStep` | 步骤、Agent、仓库、执行说明、最新运行 |
| 最近运行 | `GET /projects/{projectId}/tasks/{taskId}/task-runs` cursor envelope | 最近运行列表与进入单次运行 |
| 单次运行 | `GET /projects/{projectId}/task-runs/{taskRunId}` | 状态原因、内部轨迹、耗时、运行产物数 |
| 日志 | `GET /projects/{projectId}/task-runs/{taskRunId}/logs` cursor envelope | 按需加载的脱敏日志 |
| 待处理输入 | `GET /projects/{projectId}/task-runs/{taskRunId}/input-requests` | INPUT/APPROVAL 操作 |
| 运行环境 | `GET /projects/{projectId}/task-runs/{taskRunId}/execution-context` | Workspace/Sandbox/Ref 只读摘要 |
| 任务产物与交付 | Artifact、Diff、DiffReview 现有接口 | 产物、代码变更、交付确认与 MR 入口 |

所有列表响应必须保持：

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_xxx"
}
```

`data: []` 表示无数据，不能用 `null` 替代；关联对象无法取得时返回 `null`，不能伪造 ID。

## 3. 新工作台所需的最小增强

### W01 — TaskStep 最近运行摘要（BACKEND_MISSING）

当前 TaskStep 的 `latestRun` 只有状态与时间，无法让用户在任务流程中理解“本次运行正在做什么”。建议替换/扩展为以下摘要；本次字段均为只读、可为空。

```ts
interface TaskStepLatestRunSummary {
  id: string
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "WAITING_INPUT" | "WAITING_APPROVAL" | "BLOCKED" | "CANCELLING" | "CANCELLED"
  statusSummary: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
}
```

放入 `GET /projects/{projectId}/tasks/{taskId}/steps` 的每个 `TaskStep.latestRun`：

```json
{
  "id": "step-uuid",
  "latestRun": {
    "id": "run-uuid",
    "status": "RUNNING",
    "statusSummary": "正在生成接口测试",
    "startedAt": "2026-08-18T08:30:00Z",
    "finishedAt": null,
    "durationMs": 42000
  }
}
```

权限：Project Member。HTTP：200/403/404。字段没有摘要时必须返回 `statusSummary: null`，不是省略整个 `latestRun`。

### W02 — 按 TaskStep 筛选运行历史（BACKEND_MISSING）

工作台需要只显示选中步骤的历史尝试，避免前端从任务所有运行中猜测归属。

```text
GET /projects/{projectId}/tasks/{taskId}/task-runs?taskStepId={taskStepId}&cursor={cursor}&limit={limit}
```

参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| taskStepId | UUID | 是 | 必须属于 path 中 taskId，否则 404 `TASK_STEP_NOT_FOUND` |
| cursor | string | 否 | 游标 |
| limit | integer 1–100 | 否 | 默认 20 |

响应沿用 cursor envelope，`data` 项为正式 `TaskRunSummary`。权限：Project Member。错误：400 `INVALID_CURSOR`、403、404、422。

### W03 — 任务级活动流（BACKEND_MISSING）

“最近动态”需要服务端生成用户可读事件，前端不能通过数组顺序、日志文本或 Mock 标题拼装业务进度。

```text
GET /projects/{projectId}/tasks/{taskId}/activity?cursor={cursor}&limit={limit}
```

```ts
type TaskActivityKind =
  | "TASK_CREATED"
  | "PLAN_CREATED"
  | "STEP_STARTED"
  | "STEP_SUCCEEDED"
  | "STEP_FAILED"
  | "INPUT_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "ARTIFACT_CREATED"
  | "DIFF_CREATED"
  | "DIFF_REVIEW_PENDING"
  | "DELIVERY_COMPLETED"
  | "DELIVERY_FAILED"

interface TaskActivityItem {
  id: string
  taskId: string
  kind: TaskActivityKind
  title: string
  summary: string | null
  occurredAt: string
  taskStepId: string | null
  taskRunId: string | null
  artifactId: string | null
  diffId: string | null
  diffReviewBatchId: string | null
}
```

完整响应示例：

```json
{
  "data": [{
    "id": "activity-uuid",
    "taskId": "task-uuid",
    "kind": "INPUT_REQUIRED",
    "title": "等待补充验收条件",
    "summary": "Planner 需要确认登录失败时的提示语。",
    "occurredAt": "2026-08-18T08:35:00Z",
    "taskStepId": null,
    "taskRunId": "run-uuid",
    "artifactId": null,
    "diffId": null,
    "diffReviewBatchId": null
  }],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_xxx"
}
```

权限：Project Member。错误：403、404 `TASK_NOT_FOUND`。事件字段只用于展示与真实入口；所有关联 ID 均允许 `null`。

### W04 — 日志等级（NEEDS_CONFIRMATION）

如果后端希望提供日志筛选及 WARN/ERROR 视觉优先级，`LogEntryResponse` 增加：

```ts
level: "DEBUG" | "INFO" | "WARN" | "ERROR" | null
```

前端不会从 `content` 文本推断日志级别。首版可返回 `null`，页面按普通日志展示。

### W05 — 单次运行内部轨迹的持久化读取（NEEDS_CONFIRMATION）

当前前端类型存在 `TaskRunDetail.steps?: TaskRunStep[]`，但最新版汇总文档将历史内部步骤指向日志游标。日志不能替代结构化轨迹：前端不能从日志文本猜测节点、状态或耗时。

后端应二选一并在正式文档冻结：

1. 在 `GET /projects/{projectId}/task-runs/{taskRunId}` 返回 `steps`；或
2. 新增：

```text
GET /projects/{projectId}/task-runs/{taskRunId}/steps
```

```ts
interface TaskRunStep {
  node: string
  sequenceNo: number
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "SKIPPED" | "CANCELLED"
  summary: string | null
  errorCode: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
}
```

无内部步骤时返回 `data: []`（或详情中的 `steps: []`），不得返回伪造 Planner/TaskStep。权限：Project Member；错误：403、404 `TASK_RUN_NOT_FOUND`。

## 4. 单次运行侧栏与深链行为

任务页面的“查看本次执行”以 `taskRunId` 选中右侧运行检查面板。刷新、复制链接或 SSE attention 仍应允许：

```text
/app/projects/{projectId}/tasks/{taskId}?runId={taskRunId}
```

旧深链 `/tasks/{taskId}/executions/{taskRunId}` 可以保留并跳转至上述 URL。`taskRunId` 必须通过 `GET /task-runs/{taskRunId}` 校验 `taskId` 与 `projectId` 归属；不匹配返回 404，前端不得猜测或替换 ID。

## 5. 写操作与刷新

继续复用正式资源写接口，不新增“任务工作台专用 mutation”：

| 操作 | 正式接口 | 成功后失效查询 |
|---|---|---|
| 重试/取消运行 | TaskRun retry/cancel | Task、TaskStep、TaskRun 列表/详情、活动流 |
| INPUT 回复 | InputRequest reply | InputRequest、TaskRun、Task、活动流 |
| APPROVAL 批准/拒绝 | InputRequest approve/reject | 同上 |
| Diff 确认/拒绝/重试交付 | DiffReview 现有接口 | Task、Diff、DiffReview、DeliveryCenter、活动流 |

所有写操作遵循正式接口的 `Idempotency-Key` 规则；不用 optimistic update。409 必须刷新对应资源；403/404/409/422 在当前操作区域显示，不让整个工作台消失。

## 6. SSE 与失效关系

事件只能触发 Query invalidate/refetch，不能直接写实体缓存。

| 事件 | 失效资源 |
|---|---|
| `task.updated` | Task detail/list、TaskStep、TaskRun list、活动流 |
| `task-run.updated` / `task-run.step.progress` | TaskRun detail、TaskStep、TaskRun list、活动流 |
| `input-request.created/updated` | InputRequest、TaskRun、Task、活动流 |
| `artifact.created` | TaskArtifact、TaskRun、活动流 |
| `diff.created` / `diff-review.*` / `delivery.*` | Diff、DiffReview、Task、DeliveryCenter、活动流 |

Mock 模式不连接真实 SSE，且必须与真实模式使用相同 API/Query 链路。

## 7. 隐私与脱敏

日志、活动流和状态摘要不得返回 Token、密码、GitHub 安装令牌、私钥、完整 Prompt、环境变量或宿主机绝对路径。ExecutionContext 继续仅允许 workspaceId、sandboxStatus、repositoryId、baseRef、headRef、startedAt、expiresAt。

## 8. 后端确认表

| 编号 | 项目 | 状态（后端填写） | 备注 |
|---|---|---|---|
| W01 | TaskStep.latestRun.statusSummary | 待确认 | |
| W02 | taskStepId 筛选 TaskRun 列表 | 待确认 | |
| W03 | Task Activity API | 待确认 | |
| W04 | LogEntry.level | 待确认 | |
| W05 | TaskRun 内部轨迹持久化读取 | 待确认 | 详情 `steps` 或独立 endpoint |
| W06 | `/tasks/{taskId}?runId=` 深链约定 | 待确认 | 前端路由行为 |
