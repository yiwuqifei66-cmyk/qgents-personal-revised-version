# Agent FE-API

本文件记录 Agent 页面使用的前端补充约定。正式后端契约以 `docs/api/qgents-api-current.md` 为准。

## Agent 展示

Agent 列表和详情可以使用正式 Agent 接口返回的展示字段。列表不得包含私有 prompt、config 或凭据；详情是否展示私有字段由服务端返回的权限字段决定。

## 项目 Skill 绑定（已确认）

正式接口：

- `GET /projects/{projectId}/agent-skill-bindings/{agentId}`
- `PUT /projects/{projectId}/agent-skill-bindings/{agentId}`

PUT 请求体为 `{ skillIds: string[] }`。空数组表示清空绑定；该 PUT 不生成 `Idempotency-Key`。响应字段为 `agentId`、`skillIds`、`skills`、`updatedAt`。

前端处理正式的 403、404、409、422 错误码，不依赖临时绑定响应或其他任务领域实体。
