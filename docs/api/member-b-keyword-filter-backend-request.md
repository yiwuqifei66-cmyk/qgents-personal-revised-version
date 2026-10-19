# 成员 B 关键词筛选后端契约变更请求

状态：Frontend Proposed / Pending Backend Confirmation

## 目的

任务中心和 DeliveryCenter 需要支持服务端关键词筛选。前端不会再对当前已加载页做本地假过滤，关键词必须参与后端完整数据集筛选、cursor 分页和交付统计。

## 统一查询参数

新增可选查询参数：

| 参数 | 类型 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `keyword` | `string` | 不筛选 | 去除首尾空白后按不区分大小写的包含匹配；空字符串等同于未传 |

建议长度限制为 1–100 个 Unicode 字符。超出限制返回 `422`，`error.code=INVALID_QUERY_PARAMETER`。不得把关键词拼接进 SQL；必须使用参数化查询。

## 任务中心

### GET `/api/v1/projects/{projectId}/tasks`

前端已支持的完整查询参数：

```text
groupId, status, repositoryId, createdBy, keyword, cursor, limit
```

关键词建议匹配以下任务字段：

- `displayCode`
- `title`
- `requirementSummary` 或正式需求摘要字段
- `requirementGroup.name`
- `createdByUser.displayName`
- 绑定仓库的展示名称和完整名称

筛选后仍必须返回正式 cursor envelope：

```json
{
  "data": [
    {
      "id": "01a00e41-9a10-7b31-b391-5ff05ded34fd",
      "displayCode": "T-12",
      "title": "创建文件夹",
      "requirementSummary": "建立新的文件夹",
      "status": "PLANNING",
      "requirementGroup": { "id": "01a009db-91d1-763a-b672-6f82bae250e1", "name": "登录功能" },
      "repositories": [],
      "createdByUser": { "id": "01a00590-7a8b-79d5-8bd9-2413680fd1fd", "displayName": "成员", "avatarUrl": null },
      "executionSummary": {
        "totalSteps": 0,
        "pendingSteps": 0,
        "runningSteps": 0,
        "waitingSteps": 0,
        "blockedSteps": 0,
        "succeededSteps": 0,
        "failedSteps": 0,
        "currentStage": null,
        "currentStageTitle": null,
        "requiresUserAction": false
      },
      "attention": null,
      "createdAt": "2026-08-17T08:00:00Z",
      "updatedAt": "2026-08-17T08:30:00Z"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_tasks_keyword_001"
}
```

`page.hasMore` 和 `page.nextCursor` 必须基于关键词筛选后的结果集计算。关键词改变后 cursor 必须从第一页开始，不能复用其他关键词的 cursor。

## DeliveryCenter

### GET `/api/v1/projects/{projectId}/delivery-items`

完整查询参数：

```text
groupId, type, status, repositoryId, createdBy, keyword, cursor, limit
```

关键词建议匹配：

- 公共字段 `title`、`summary`、`resourceId`
- `source.taskDisplayCode`、`source.taskTitle`
- `creator.displayName`、`submitter.displayName`
- CODE 的仓库名称
- MEMORY/SKILL 的摘要字段

必须保持 `CODE | MEMORY | SKILL` discriminated union、`openTarget`、`capabilities` 和原有 cursor envelope 不变。空结果返回 `200`、`data: []`，不得返回 `null`。

### GET `/api/v1/projects/{projectId}/delivery-summary`

除了 `cursor`、`limit` 外，接受与列表完全一致的筛选参数：

```text
groupId, type, status, repositoryId, createdBy, keyword
```

统计必须由“完整筛选后的数据集”计算，不得由当前分页的 `delivery-items` 结果计算。响应继续保持：

```json
{
  "total": 1,
  "countsByType": { "CODE": 1, "MEMORY": 0, "SKILL": 0 },
  "countsByStatus": {
    "DRAFT": 0,
    "PENDING_REVIEW": 0,
    "PROCESSING": 1,
    "ACCEPTED": 0,
    "REJECTED": 0,
    "DELIVERED": 0,
    "FAILED": 0,
    "ARCHIVED": 0
  },
  "pendingForCurrentUser": 0,
  "repositorySummaries": [],
  "requirementGroupSummaries": [],
  "updatedAt": "2026-08-17T08:30:00Z"
}
```

## 错误与权限

- `400`：查询参数格式错误，`error.code=INVALID_QUERY_PARAMETER`；
- `401`：认证失效；
- `403`：无项目访问权限；
- `404`：项目不存在；
- `422`：关键词超长或其他业务校验失败，`error.code=INVALID_QUERY_PARAMETER`；
- `500`：服务端异常。

错误响应沿用：

```json
{
  "error": { "code": "INVALID_QUERY_PARAMETER", "message": "keyword must be 100 characters or fewer" },
  "requestId": "req_error_001"
}
```

关键词查询是只读操作，不使用 `Idempotency-Key`。

## 前端接入边界

- 任务中心 URL 使用 `keyword` 参数；
- DeliveryCenter URL 使用 `keyword` 参数；
- 两个页面的 Query Key 都包含 keyword，筛选变化会重新请求第一页；
- DeliveryCenter 列表和 Summary 使用相同 keyword；
- Mock handler 需要按同样的字段范围过滤；
- 后端上线前，真实接口返回未识别该参数时不得静默当作前端本地搜索。

## 后端确认项

请确认以下内容后发布接口文档：

1. 参数名称是否确定为 `keyword`；
2. 关键词匹配字段是否按本文建议字段执行；
3. 是否支持中文 Unicode 不区分大小写匹配；
4. 关键词最大长度和错误码；
5. 两个 DeliveryCenter 接口是否使用完全一致的筛选语义；
6. cursor 是否在筛选条件变化后失效并从第一页重新生成。
