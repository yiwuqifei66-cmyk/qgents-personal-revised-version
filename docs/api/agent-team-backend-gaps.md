# Agent 团队页面后端缺口

本文记录 Agent 团队页面本轮 Mock 使用、但在 `docs/api/qgents-api-current.md` 中尚未确认的字段和接口。Mock 仅用于跑通页面，不视为正式契约。

## 已有正式字段

- `GET /teams/{teamId}/agents`、`GET /teams/{teamId}/agents/{agentId}` 已有 Agent 的 `id`、`name`、`avatar`、`role`、`capabilities`、`visibility`、生命周期 `status`、`createdBy` 与 Prompt 脱敏规则。
- 页面通过项目资料中的 `teamId` 再请求团队 Agent，不把 `projectId` 当作 `teamId`。
- Task、TaskStep、TaskRun、ExecutionContext 和项目仓库已有正式关联模型；Agent 不需要永久仓库或分支绑定。
- Skill 访问沿用现有 `GET /projects/{projectId}/agent-skill-bindings/{agentId}` 及 Skill 的正式权限规则。

## 可从现有接口关联

- 任务编号、任务标题、TaskStep、需求群、仓库、状态和时间可由项目级 Task/TaskStep/TaskRun/ExecutionContext 关联得到。
- 仓库和分支应从 Task、TaskStep、ExecutionContext 获取，不从 Agent 配置读取。
- TaskRun 详情继续进入现有 `/projects/{projectId}/tasks/{taskId}/executions/{taskRunId}` 路由；列表不携带 Logs、Artifact、Diff 或完整 ExecutionContext。

## 本轮 Mock 临时字段

Agent 列表/详情为还原页面暂时增加：

1. 个人 Agent 返回范围（仅当前登录用户自己的 Agent）；
2. `description: string | null`；
3. `runtime.status: IDLE | RUNNING`；
4. `runtime.activeRunCount`；
5. `runtime.concurrencyLimit`；
6. `runtime.assignmentUsage.requirementGroups.assignedCount/assignableCount`；
7. `runtime.assignmentUsage.workflows.assignedCount/assignableCount`；
8. `skillAccessScope`、`memoryAccessScope` 的列表摘要；
9. 详情中的工具摘要和 Memory 范围摘要；
10. 运行记录需要的 Task/TaskStep/需求群/仓库脱敏摘要。

## 后端必须补充或确认

### 1. Agent 运行态与权限

- Agent 返回是否按当前用户过滤，团队成员是否只能看到自己的 Agent；服务端必须以 Token 和资源关系判断，不能信任客户端传入的 userId。
- 实时 `status` 的正式枚举是否为 `IDLE`、`RUNNING`，以及状态刷新时效和并发一致性。
- `activeRunCount <= concurrencyLimit`、`RUNNING` 时必须大于 0、`IDLE` 时必须为 0 的服务端保证。
- `concurrencyLimit` 的来源、默认值、更新权限和是否允许为 0。

### 2. 项目分配

- 明确需求群和 Workflow 的 `assignedCount/assignableCount` 计算口径，且统计必须只针对当前 `projectId`。
- 新增只读分页接口（Mock 路径）：

  `GET /projects/{projectId}/agents/{agentId}/assignments?type=REQUIREMENT_GROUP|WORKFLOW&cursor&limit`

- `AgentAssignmentSummary` 的正式 `resourceId`、`resourceName`、`status` 字段及状态枚举、权限规则。
- 当前用户自己的 Agent 是否可分配给当前项目需求群和 Workflow；项目成员不能使用他人的 Agent。
- Skill/Memory 的共享资源编辑权限继续由团队角色决定：`TEAM_OWNER` 可编辑，`TEAM_MEMBER` 仅使用。页面不新增 Agent 级 mutation。

### 3. 项目级 Agent TaskRun 查询

- 新增或确认：

  `GET /projects/{projectId}/task-runs?agentId&status&cursor&limit`

- 服务端必须同时按 `projectId`、当前用户可见范围和 `agentId` 过滤；不得返回其他用户 Agent 的记录。
- 返回最小摘要：`id`、`projectId`、`taskId`、`taskStepId`、`agentId`、`role`、`status`、`retryOfTaskRunId`、`createdAt`、`startedAt`、`finishedAt`、`durationMs`，以及 Task、TaskStep、需求群、仓库摘要。
- 默认按 `startedAt ?? createdAt` 倒序；明确 cursor/limit 默认值、最大值、空列表 envelope 和 `nextCursor/hasMore` 规则。
- 失败、阻塞、取消时提供脱敏 `statusReason { code, summary }`；不得包含堆栈、内部推理、Prompt、凭据或宿主机路径。
- `repository` 允许为 `null`；Task/TaskStep/ExecutionContext 关联缺失时的空值规则需确认。

## 明确不需要的字段或能力

- 不需要自定义 Agent 的创建、编辑、Prompt、模型或配置保存契约；现有入口和假数据本轮保留，不扩展其业务。
- 不需要 Agent 永久绑定仓库、基准分支或工作分支。
- 不需要将完整 Logs、Steps、ExecutionContext、Artifact、Diff 放入 Agent 列表或运行记录列表。
- 不需要 Prompt、模型配置、凭据、宿主机路径、内部推理或敏感工具配置。
- 本轮不新增 Agent 分配/解除分配 mutation，不新增 SSE 业务。
