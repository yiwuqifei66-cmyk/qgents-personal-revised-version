# 群聊 @Agent 快速任务触发契约

**Frontend Proposed / Pending Backend Confirmation**

## 目标

同一个 Task 有两个创建入口：

- **完整创建**：保留 `POST /projects/{projectId}/tasks`，由“发起任务”表单提交完整的需求、仓库和基线分支。
- **快速创建**：在活跃需求群中发送一条 @Agent 消息时，服务端自动创建关联 Task。服务端必须在同一事务中写入消息和 Task，避免“消息已发送、任务未创建”的不一致状态。

本版本将 @Agent 定义为明确的任务发起操作：在 Active Requirement Group 中，只要消息包含一个 Agent mention，服务端就创建 Task。用户若仅想讨论，不应 @Agent。

## 修改接口

### POST /projects/{projectId}/groups/{groupId}/messages

请求仍使用 `Idempotency-Key`；同一个 `clientMessageId` 和同一个幂等键必须返回首次的消息与 Task 结果。

```json
{
  "type": "TEXT",
  "content": { "text": "请实现邮箱密码登录，并补充测试。" },
  "mentions": [
    { "type": "AGENT", "id": "agent-uuid" }
  ],
  "replyToId": null,
  "clientMessageId": "cmsg_01J..."
}
```

`mentions` 在此版本统一为对象数组，禁止继续使用仅含 ID 的 `string[]`：

```ts
type Mention = { type: 'USER' | 'AGENT'; id: string }
```

一个消息首版只允许一个 `type: 'AGENT'` mention；该 Agent 表示调度偏好，不能绕过后端对角色、并发、项目可见性和仓库权限的校验。没有 Agent mention 时完全保持普通消息语义。

成功响应（HTTP 201）：

```json
{
  "data": {
    "message": {
      "id": "message-uuid",
      "groupId": "group-uuid",
      "type": "TEXT",
      "content": { "text": "请实现邮箱密码登录，并补充测试。" },
      "senderType": "USER",
      "senderId": "user-uuid",
      "sequence": 42,
      "createdAt": "2026-08-16T12:00:00Z",
      "replyToId": null
    },
    "task": {
      "id": "task-uuid",
      "displayCode": "T-1024",
      "status": "PLANNING",
      "missingFields": ["repositoryIds", "baseRef"]
    }
  },
  "requestId": "req-uuid"
}
```

存在一个 Agent mention 时 `task` 必须非空；没有 Agent mention 时 `task` 为 `null`。`missingFields` 是空数组表示 Planner 可继续编排；缺少仓库/基线时 Task 仍可处于 `PLANNING`，但后端必须创建关联的 `WAITING_INPUT` TaskRun/InputRequest 来收集信息，前端不得自行虚构状态或补全字段。

### 权限与校验

- 仅同项目、`ACTIVE`、未归档的 `REQUIREMENT` 群可出现 Agent mention 并自动触发任务。
- 项目总群、归档群：`422 TASK_TRIGGER_GROUP_INVALID`。
- `agentId` 缺失、不在 mentions 中、Agent 不可用于项目：`422 TASK_TRIGGER_AGENT_MENTION_REQUIRED` 或 `422 TASK_TRIGGER_AGENT_UNAVAILABLE`。
- 群、项目、Agent 不存在：分别返回 404，错误码必须可区分。
- 无权发送消息或创建任务：403。
- 并发/状态冲突：409，并返回当前资源状态；前端刷新群消息、Task 列表和关联 Task。

## 既有完整创建接口

`POST /projects/{projectId}/tasks` 保持不变，且仅允许 Active Requirement Group：

```json
{
  "requirementGroupId": "group-uuid",
  "title": "实现邮箱密码登录",
  "requirement": "支持邮箱密码登录并完成测试。",
  "repositoryIds": ["project-repository-binding-uuid"],
  "baseRef": "main"
}
```

后端返回的 Task 必须保留 `triggerMessageId`：快速创建时为本次消息 ID；表单创建时为 `null`。

## SSE 与查询刷新

快速创建成功后，服务端发送 `message.created` 与 `task.updated`；如需输入，再发送 `input-required`。SSE 仅用于客户端失效查询，最终状态以 GET 为准。

## 后端实施任务

1. 将消息 `mentions` 正式冻结为 `Mention[]` 并更新 v1.8 文档与 OpenAPI。
2. 实现 Agent mention 自动触发的事务写入、幂等重放及上述 403/404/409/422 错误码。
3. 为快速创建生成 Task、`triggerMessageId`、`sourceMessage`，并在信息不足时创建真实 InputRequest。
4. 保证被 @ Agent 只是调度偏好，不允许绕过 Agent 的项目可见性、状态、并发、角色和仓库授权检查。
5. 补充集成测试：普通消息、@ 不建任务、@ 建任务、项目总群/归档群拒绝、Agent 无效、幂等重放、输入缺失和 SSE 顺序。
