# 质量门禁 & MR Tab：页面切换恢复预检状态 —— 后端配套改动

> 说明：前端已修复"切换页面后 preflightStatusMap 丢失，MANUAL 行不再发起轮询恢复状态"的问题（详见 MergeRequestTab.tsx 的 `initialRecoveryDone` 机制）。本文档列出需要后端同时配套落地的改动，保证语义稳定、前端 fallback 不歧义。

---

## 改动 1：占位 MR（PENDING_CREATE placeholder）的 `qualityGate.status` 从写死 `PENDING` 改为写死 `NOT_STARTED`

### 现状
文件：`Qgents/src/main/java/qg/qgent/service/MergeRequestService.java`
方法：`placeholderMergeRequests(...)`
行号（当前源码约 1954 行）：

```java
row.setQualityGate(new QualityGateResponse("PENDING", List.of()));
```

### 问题
- `PENDING` 在真实预检语境下的语义是「Dry Run 正在跑 / 结果未全出来」。
- 但 placeholder 行对「从未点过"申请MR"的新任务」也写死 `PENDING`，导致前端无法区分：
  - 真·运行中（用户确实点过申请，后端有 PreflightRequest 记录）
  - 假·未启动（用户从未点过申请，后端根本没有 PreflightRequest）

### 期望修改

```diff
-            row.setQualityGate(new QualityGateResponse("PENDING", List.of()));
+            // 占位候选尚未发起预检。真实预检状态通过 GET /projects/:pid/tasks/:tid/preflight
+            // 单独查询，不通过列表接口的"快照"字段表达。前端据此区分：
+            //   NOT_STARTED → 显示"申请MR"按钮
+            //   PENDING/PASSED/FAILED → 说明已真实发起过预检（或已落地 MR 实体的门禁快照）
+            row.setQualityGate(new QualityGateResponse("NOT_STARTED", List.of()));
```

### 影响评估
- 仅影响 `placeholderMergeRequests` 构造的临时响应行。
- 真实 MR（OPEN / MERGED / CLOSED / 落库的 PENDING_CREATE 实体）仍走它们本身持久化的 `quality_gate_status` 或动态 `qualityGate()` 聚合逻辑，**不受影响**。
- **前端为什么之前会把"从未申请"的 MANUAL 任务误显示成"待预检通过"**：在 placeholder 仍写死 PENDING 的前提下，前端如果用 qualityGate.status=PENDING 作为 UI fallback，就会混淆「假·占位 PENDING」和「真·预检 PENDING」。因此当前前端实现显式**不把 PENDING 当 fallback 触发**——只信任后端一定不会写错的 PASSED / FAILED 两个终态。PENDING 的真实进度只以 `GET /projects/:pid/tasks/:tid/preflight` 返回的 `dryRunStatus / cqStatus / mergeRequest` 为准（由首轮回溯+保守轮询维护的本地 preflightStatusMap 承载）。
- 落地 NOT_STARTED 后，前端可以进一步在首轮回溯阶段对 NOT_STARTED 行直接跳过查询（目前是查了发现没记录再回落，两者结果等价，只是改后能省掉一些空查询）。

---

## 改动 2：`getTaskPreflight` 响应中把 Dry Run 失败细分码回填到 `failureCode`（可选增强）

### 背景
前端首轮恢复时，如果预检是 FAILED，需要能显示失败原因（质量门禁失败 vs 预检过期 vs CQ 被拒）。目前：
- `CQ_REJECTED` ← `cqStatus == 'REJECTED'`，前端能明确识别。
- `MR_NO_CHANGES` ← `failureCode == 'MR_NO_CHANGES'`，前端能明确识别。
- `FAILED` 但未区分 Dry Run 失败、Worker 不可用、目标分支未初始化等 → 文案统一"质量门禁失败"，略粗糙。

### 建议（非阻塞）
在 `MrPreflightService.toResponse(...)` 里，当 `dryRunStatus == 'FAILED'` 时把 `DryRunEntity.report.failureCode / message` 原样回填到 `MergeRequestPreflightResponse.failureCode / failureReason`，前端据此展示更精确的失败 tip。

---

## 前端预期的字段语义表（后端确认用）

后端返回的 `MergeRequestSummary.qualityGate.status` 语义对照：

| 值 | 语义 | 前端表现（PENDING_CREATE 占位行） |
| --- | --- | --- |
| `NOT_STARTED` | 从未发起预检（placeholder 默认值） | 显示「申请MR」按钮；首轮回溯发现后端也查不到 PreflightRequest → 保持 IDLE。 |
| `PENDING` | 已发起预检、正在跑 Dry Run / 部分检查尚未完成 | 首轮回溯中显示 Spin「加载中」；之后以 `getTaskPreflight` 返回的 `dryRunStatus / cqStatus / mergeRequest` 为准更新本地 map。 |
| `PASSED` | Dry Run 全通过 | 显示「等待 CQ+1」或「可创建 MR」（MANUAL + CQ 通过）。 |
| `FAILED` | Dry Run 有失败项 | 显示「重新预检」（带失败 tooltip）。 |

真实 MR（OPEN / MERGED / CLOSED）依然沿用 `qualityGate.status == PASSED` 控制 Admin 合并按钮可见的既有逻辑，**不受上述 placeholder 改动影响**。
