# Testset / Test Run / Dry Run 前端确认项

> 日期：2026-08-17  
> 结论优先级：题目 P1（MR 前真实 Dry Run 与 CQ+1）> 用户体验 > 当前接口文档表述。  
> 前端实现对照：`src/types/testset.ts`、`src/api/testset.ts`、`src/pages/ProjectDetail/Testset/`

## 1. 本次确认结论

前端可以继续实现测试集页面，但 Test Run / Dry Run 不能只作为独立的“运行记录”展示。题目要求的是对待交付代码执行真实门禁：**当前提交的 Dry Run 和 CQ+1 未通过或未完成时，不得进入 MR 交付流程。**

Test Run 是指定 Testset 的独立执行；Dry Run 是“源提交合入目标分支”的真实沙箱预演。两者都不等同于 CQ+1，也不能由 GitHub `mergeable` 代替。

## 2. 前端可立即开发（已按此落地）

### 2.1 Testset 配方页

`Testset` 扁平字段 CRUD / 筛选 / 启停；写请求走全局 `Idempotency-Key`。

### 2.2 Test Run 结果页

- SSE `test-run.updated` → invalidate 后 GET 详情  
- 展示顶层 `status` + `summary.results[]`（exitCode / failureCode / durationMs）  
- 历史：本设备 localStorage，文案「本设备最近运行」

### 2.3 Dry Run 结果页

- SSE `dry-run.updated` → GET report  
- 展示嵌套 `report`：`mergeable` / `conflicts` / `tests`（含 NOT_REQUIRED、SKIPPED+MERGE_CONFLICT）  
- `mergeable=false` 显示冲突，不显示为测试失败

### 2.4 SSE

仅作刷新提示；以查询接口为准（`src/realtime/queryInvalidation.ts` 已接）。

## 3. 本轮空态（后端待补）

`taskId`（GET）、`executionSourceRef`、`failureReason`、`startedAt`/`finishedAt` → 页面显示 `—` / 不展示。

## 4. 完整 P1（MR 前门禁）

**不在本轮测试集页交付范围内。** 测试集页完成 ≠ P1 验收完成。MR 页仍以服务端 `qualityGate` / 409 blocker 为准。

## 5. 本轮暂缓

`cases[]`、产物 URL、服务端历史列表、sandbox 详情、原始日志。
