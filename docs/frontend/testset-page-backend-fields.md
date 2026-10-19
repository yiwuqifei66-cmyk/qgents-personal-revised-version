# 测试集结果页 · 后端还需回传的字段

> 面向：后端  
> 页面：项目详情 → Testset → **当前运行（结果总览）**  
> 日期：2026-08-17  
> 依据：`Testset / Test Run / Dry Run 前端确认项` §2 / §3  
> 说明：配方 CRUD、发起运行、结构化 `summary.results` 已联调通。下表是结果页仍显示 `—`、需要后端补齐或确认的部分。

---

## 1. 已经够用（不必再改）

`GET /projects/{projectId}/test-runs/{testRunId}` 当前已能支撑：

| 页面展示 | 字段 |
| --- | --- |
| 状态（失败/通过/…） | `status` |
| 当前仓库 | `repositoryId`（`project_repositories.id`） |
| 当前测试集 | `testsetIds` |
| 执行提交短 SHA | `summary.resolvedHeadCommit` |
| 每个 Testset 的 exitCode / failureCode / 耗时 | `summary.results[]` |

示例（已真实联调过）：

```json
{
  "status": "FAILED",
  "ref": null,
  "summary": {
    "status": "FAILED",
    "resolvedHeadCommit": "b8e43f7066af…",
    "results": [
      {
        "testsetId": "…",
        "status": "FAILED",
        "exitCode": 254,
        "durationMs": 251,
        "failureCode": "UNEXPECTED_EXIT_CODE"
      }
    ]
  }
}
```

---

## 2. 结果页仍为 `—`：请后端补齐

路径不变：`GET /projects/{projectId}/test-runs/{testRunId}`

| 页面标签 | 需要的字段 | 现状 | 前端期望 |
| --- | --- | --- | --- |
| **Task** | `taskId` | POST 可传、SSE 会带，**GET 不回传** | 有则展示并可跳任务详情；无则继续 `—` |
| **ref** | `ref` | Task 模式下常为 `null`（正常） | 按 git ref 发起时应回传；Task 模式可为 `null` |
| **执行提交**（已有短 SHA） | 建议补 `executionSourceRef` 或等价字段 | 仅有 `summary.resolvedHeadCommit` | 标明实际检出的不可变提交（Task 模式下 `ref=null` 时尤其需要） |
| **开始时间** | `startedAt` | 本轮未持久化 | ISO 时间；未开始可为 `null` → 显示 `—` |
| **结束时间** | `finishedAt` | 本轮未持久化 | ISO 时间；未结束为 `null` |
| **运行时长** | 可由起止推算，或另给 `durationSeconds` | 无起止则整次时长为 `—`（表内 `results[].durationMs` 已有） | 有起止即可；不要从前端 SSE 时间瞎算 |
| **Sandbox** | `sandboxId`（可选） | 本轮明确暂缓 | 不给则继续「本轮不提供」 |

建议 GET 最小补齐响应（在现有字段上增加）：

```json
{
  "id": "testrun-uuid",
  "projectId": "project-uuid",
  "repositoryId": "project-repository-binding-uuid",
  "testsetIds": ["testset-uuid"],
  "taskId": "task-uuid",
  "ref": null,
  "executionSourceRef": "b8e43f7066af…",
  "status": "FAILED",
  "summary": {
    "status": "FAILED",
    "resolvedHeadCommit": "b8e43f7066af…",
    "results": [ /* 同现有 */ ]
  },
  "startedAt": "2026-08-17T14:44:00Z",
  "finishedAt": "2026-08-17T14:44:01Z",
  "createdBy": "user-uuid",
  "createdAt": "2026-08-17T14:44:00Z"
}
```

---

## 3. Dry-run 结果页（同页另一类运行）

`GET /projects/{projectId}/dry-runs/{dryRunId}/report` 请继续保证嵌套 `report`（前端已按此展示）：

```ts
report: {
  targetCommit?: string
  mergeable?: boolean
  conflicts?: Array<{ path: string; message?: string }>
  tests?: TestRunSummary | { status: 'NOT_REQUIRED' | 'SKIPPED'; reason?: 'MERGE_CONFLICT' }
  failureCode?: string
} | null
```

- `mergeable=false` → 前端显示**冲突**，不显示成测试失败  
- `tests.status=SKIPPED` + `MERGE_CONFLICT` → 测试未执行，不得当通过  

---

## 4. 本轮仍可不做（前端保持空态）

- `cases[]` / `caseSummary` 逐用例统计  
- `reportUrl` / `pdfUrl` / 产物链接  
- `GET /test-runs`、`GET /dry-runs` 历史列表（右侧继续「本设备最近运行」）  
- 原始命令、日志、异常栈、宿主机路径  
- 脱敏 `failureReason` 短文案（有则展示，无则只显示 `failureCode`）

---

## 5. 请后端直接确认

1. `GET /test-runs/{id}` **何时**回传 `taskId`？  
2. Task 模式下是否增加 `executionSourceRef`（或与 `resolvedHeadCommit` 二选一并写死）？  
3. `startedAt` / `finishedAt` 本轮是否排期持久化？不排则前端继续对这三项显示 `—`。  
4. Dry-run 的 `report` 形状是否按第 3 节冻结？

前端映射已预留 `taskId` / `startedAt` / `finishedAt`；后端补字段后结果页会自动填上，无需再改主流程。
