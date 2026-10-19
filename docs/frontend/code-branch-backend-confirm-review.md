# 「代码与 Branch」后端确认 · 前端对齐说明

> 权威口径：[`code-branch-backend-confirm.md`](./code-branch-backend-confirm.md)（后端 2026-08-17 确认 + 冻结补充）  
> 本文件记录前端已落地状态与剩余联调注意点。  
> 日期：2026-08-17

---

## 1. 总评

后端确认与初稿一致，且书面修正了 `latestDiff` 语义（历史快照不可因当前 Task 无变更而清空）并要求补 `latestDiff.taskId`。

前端 **Code 页主路径已切到** `GET /projects/{projectId}/work-branches`，不再用演示分支或按分支名反查 Diff。

---

## 2. 已遵守的禁令

| 禁令 | 前端现状 |
| --- | --- |
| 禁止 `repositoryId + sourceBranch` / 仅 `sourceBranch` 反查 Diff | Code 页主路径已移除；仅 `latestDiff.id` 可跳转 |
| 无 `latestDiff` 时禁止空 Diff 壳入口 | Diff 列不可点，显示 `+/-` 为次要信息 |
| 分支 ≠ 单一 Task / 需求群 | 用 `latestTask` + `requirementGroups[]`；筛选走 Group UUID |
| 不做假健康 / 假 protected / 无 SHA 测试态 | 首版不展示这些列 |
| 空列表不用演示数据补齐 | `data: []` → Empty |

---

## 3. 已对接的接口与字段

| 能力 | 实现 |
| --- | --- |
| 仓库卡片 | `GET .../repositories`；`defaultBranch` 仅卡片 |
| 需求群筛选 | `GET .../groups`，`type=REQUIREMENT` |
| 工作分支表 | `GET .../work-branches`（`requirementGroupId` / `limit`） |
| 行 key | `projectRepositoryId + name`（`workBranchRowKey`） |
| Diff 列 | 仅 `latestDiff.id`；`+/-` ← `changeStats`；展示 `taskId`（有则抽屉可见） |
| Open MR | 行内 `openMergeRequest` → MR 详情；MR Tab 仍走列表接口 |
| 最近验证 | `lastVerification`；短 SHA；与 `lastKnownHead` 不一致标「非当前版本」；`null` → `—` |
| SSE invalidate | `diff.created` / `merge-request.updated` / `task.updated` / `diff-review.skipped` → `work-branches` |

可选字段（后端陆续补齐时映射已兼容）：

- `latestDiff.taskId`
- `latestTask.finalDiff`（`{ id } | null`，表达「当前 Task 无最终 Diff」）
- `lastVerification.kind`（后续真实 TestRun / dry-run）

---

## 4. 联调注意

1. 真实后端若尚未部署 `work-branches`，页面会空列表或报错——属接口未上线，不是演示数据回退。
2. `latestDiff` 有历史快照、但 `latestTask.finalDiff === null` 时：Diff 列仍可点进历史 Diff；抽屉应能区分「历史 Diff」与「当前 Task 无变更」（靠 `taskId` / `finalDiff`）。
3. 遗留文件 `branchDiffSync.ts` / `codeBranchDemo.ts` **不得**再挂回 Code 页主路径；仅 Diff 演示/旧测试可能引用。

---

## 5. 相关文件

| 区域 | 路径 |
| --- | --- |
| 后端确认（权威） | `docs/frontend/code-branch-backend-confirm.md` |
| 页面 | `src/pages/ProjectDetail/CodePage.tsx` |
| API / 映射 | `src/api/workBranches.ts` |
| 类型 | `src/types/workBranch.ts` |
| MSW | `src/mocks/workBranches.ts` |
| SSE | `src/realtime/queryInvalidation.ts` |
