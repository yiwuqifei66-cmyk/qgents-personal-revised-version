# Workflow Viewer FE-API

WorkflowViewer 是只读页面，展示指定 Task 的实际执行计划，不读取 workflow template。

## 数据链

页面只消费以下正式资源：

- `GET /projects/{projectId}/tasks`
- `GET /projects/{projectId}/tasks/{taskId}`
- `GET /projects/{projectId}/tasks/{taskId}/steps`
- `GET /projects/{projectId}/tasks/{taskId}/task-runs`
- Agent 摘要使用现有 Agent Query；Agent 详情中的 `skillBindings` 用于展示 Skill。

URL 使用 `/app/projects/{projectId}/workflow?taskId={taskId}`。TaskStep 节点 ID 使用 `TaskStep.id`，TaskRun 通过 `taskStepId` 关联；页面只消费 Task、TaskStep、TaskRun 和 Agent Query。

## 节点组合规则

- 节点完全来自 TaskStep；不补充 Planner、Reviewer、门禁或其他模板节点。
- `dependencies` 用于构造依赖顺序和并行关系。
- 缺失依赖和循环依赖只标记异常节点，不阻断其余节点展示。
- TaskRun 按 `taskStepId` 分组，按更新时间展示最新运行和历史运行。
- Testset 当前展示 `testsetIds`；若后端提供正式名称查询，后续再接入。

## 状态

TaskStep 使用 `PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`、`SKIPPED`；TaskRun 使用 `QUEUED`、`RUNNING`、`SUCCEEDED`、`FAILED`、`WAITING_INPUT`、`WAITING_APPROVAL`、`BLOCKED`、`CANCELLING`、`CANCELLED`。状态映射集中在 `src/pages/ProjectDetail/Workflow/status.ts`。

页面不建立 SSE 连接，实时更新由项目级 SSE 失效 Query 后重新获取正式资源。
