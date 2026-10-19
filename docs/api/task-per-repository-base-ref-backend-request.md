# Task 多仓库独立基准分支：后端配合事项

状态：Frontend Implemented / Pending Backend Confirmation

## 背景

发起任务弹窗允许用户一次选择多个项目仓库。当前创建 Task 请求只有一个 `baseRef`，多个仓库只能被迫使用同一个基准分支。

前端已调整为：每个已选仓库单独选择基准分支，默认值来自该仓库的 `defaultBranch`，分支候选来自现有远程分支接口。

## 请求契约

### POST `/api/v1/projects/{projectId}/tasks`

请求体新增 `repositoryRefs`，每项必须与 `repositoryIds` 中的仓库对应：

```json
{
  "requirementGroupId": "group-uuid",
  "title": "实现登录功能",
  "requirement": "完成前后端登录流程和测试",
  "repositoryIds": [
    "project-repository-frontend-uuid",
    "project-repository-backend-uuid"
  ],
  "repositoryRefs": [
    {
      "repositoryId": "project-repository-frontend-uuid",
      "baseRef": "main"
    },
    {
      "repositoryId": "project-repository-backend-uuid",
      "baseRef": "develop"
    }
  ]
}
```

字段规则：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `repositoryIds` | `string[]` | 保留现有字段；至少一个元素；每项必须是当前项目的 `project_repositories.id` |
| `repositoryRefs` | `{ repositoryId: string; baseRef: string }[]` | 新字段；每个已选仓库必须且只能有一项 |
| `repositoryRefs[].baseRef` | `string` | 去除首尾空白后不能为空，必须是该仓库真实存在的远程分支或服务端允许的合法 ref |

## 服务端校验

服务端必须在创建 Workspace 前完成以下校验：

1. 所有 `repositoryRefs[].repositoryId` 都属于当前项目，且当前用户有权访问。
2. `repositoryRefs` 不得包含重复仓库。
3. `repositoryIds` 与 `repositoryRefs` 必须是同一组仓库，不能缺少、增加或重复。
4. 每个 `baseRef` 必须针对对应仓库单独校验，不能只使用第一个仓库校验结果。
5. 仓库未初始化、默认分支为空、远程分支不存在或 GitHub App 无权访问时，拒绝创建并返回明确错误。
6. 继续任务仍遵守原有规则：复用 Workspace 时不能通过本字段偷偷增加或替换仓库；`workspaceId` 与 `continuationOfTaskId` 的约束保持不变。

建议错误码：

| 场景 | HTTP | `error.code` |
| --- | --- | --- |
| 仓库配置缺失或重复 | `422` | `INVALID_REPOSITORY_REFS` |
| 仓库不属于当前项目 | `404` 或 `422` | 沿用项目资源权限错误或 `INVALID_REPOSITORY_REFS` |
| 基准分支不存在 | `422` | `BASE_REF_NOT_FOUND` |
| 仓库未初始化 | `422` | `REPOSITORY_NOT_INITIALIZED` |
| GitHub App 无权访问仓库 | `422` | `REPOSITORY_ACCESS_REVOKED` |

错误响应继续使用统一 envelope：

```json
{
  "error": {
    "code": "BASE_REF_NOT_FOUND",
    "message": "Base ref 'develop' does not exist in repository 'backend-service'.",
    "details": [
      {
        "field": "repositoryRefs[1].baseRef",
        "repositoryId": "project-repository-backend-uuid"
      }
    ]
  },
  "requestId": "req-uuid"
}
```

## Workspace 与响应

`repositoryRefs` 是 Workspace 初始化配置，不是 Task 的单一字段。创建 Workspace 时，每个 worktree 必须使用自己对应的 `baseRef`。

创建成功后的 Task 详情和任务列表仓库摘要继续按仓库返回实际值：

```json
{
  "repositories": [
    {
      "repositoryId": "project-repository-frontend-uuid",
      "defaultBranch": "main",
      "baseRef": "main",
      "sourceBranch": "feat/task-1024-frontend"
    },
    {
      "repositoryId": "project-repository-backend-uuid",
      "defaultBranch": "main",
      "baseRef": "develop",
      "sourceBranch": "feat/task-1024-backend"
    }
  ]
}
```

后续 `execution-context`、Diff、交付和 MR 数据也必须按实际仓库返回对应的 `baseRef`，不能回退成第一个仓库的分支。

## 兼容策略

建议短期兼容旧客户端：

- 只有旧字段 `repositoryIds + baseRef` 时，允许所有仓库沿用同一个 `baseRef`；
- 新客户端传 `repositoryRefs` 时，以 `repositoryRefs` 为准；
- 若新请求同时传 `baseRef`，建议校验其与所有 `repositoryRefs` 是否一致，不一致时返回 `422 INVALID_REPOSITORY_REFS`，避免静默忽略；
- 待前端和后端都完成升级后，再从正式文档中移除旧的单值 `baseRef` 创建语义。

写请求继续要求 `Idempotency-Key`，幂等指纹必须包含 `repositoryRefs`，否则不同分支配置可能错误复用同一创建结果。

## 现有分支接口

前端使用：

```text
GET /api/v1/projects/{projectId}/repositories/{projectRepositoryId}/branches
```

该接口应确保返回对应仓库的真实远程分支，并正确标记项目默认分支。前端不会把一个仓库的分支列表用于其他仓库。

## 验收用例

1. 选择两个仓库，分别提交 `main` 和 `develop`，创建成功后两个 Workspace worktree 的 `baseRef` 分别正确。
2. 第二个仓库没有 `develop` 分支时，创建请求被拒绝，错误字段能定位到对应的 `repositoryRefs` 项。
3. `repositoryRefs` 缺少一个已选仓库时，创建请求被拒绝。
4. `repositoryRefs` 出现不属于项目的仓库 ID 时，创建请求被拒绝。
5. 重复发送相同 `Idempotency-Key` 和相同多仓库分支配置时，返回首次结果，不重复创建 Workspace。
6. 相同 `Idempotency-Key` 但修改任意一个仓库的 `baseRef` 时，返回 `409 IDEMPOTENCY_KEY_REUSED`。
7. 创建后的 Task 列表、详情、Diff、交付信息均不把第一个仓库的 `baseRef` 复制到其他仓库。

## 后端确认项

1. `repositoryRefs` 字段名和结构是否按本文冻结。
2. 是否保留旧 `baseRef` 的兼容期，以及兼容期截止版本。
3. `BASE_REF_NOT_FOUND` 等错误码是否沿用，或提供后端现有等价错误码。
4. 创建 Workspace 和后续执行链路是否已经支持多仓库不同基准分支。
5. 接口文档当前关于“多个仓库共用一个 `baseRef`”的描述需要同步更新。
