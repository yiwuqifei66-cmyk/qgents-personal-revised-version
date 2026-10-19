# Testset 前端必办清单

> 版本：v2.0.3 对齐版  
> 优先级：题目 > `Qgents/AGENTS.md` 长期约束 > 接口文档  
> 范围：Testset、MR 前 Dry Run / CQ+1 预检、创建 MR 的前端闭环

## 完成标准

必须能走通以下流程，且前端不能用本地状态伪造任何通过结果：

```text
管理员将 Testset 绑定到目标分支
-> Task 产生并推送当前提交
-> Dry Run 在固定 sourceCommit + targetCommit 上执行必选 Testset
-> 独立成员给该 Dry Run CQ+1
-> 预检 PASSED
-> 用户显式创建 MR
```

普通 Test Run 只执行用户显式选择的 Testset；只有 Dry Run 执行目标分支绑定的强制 Testset。

## P0：必须补齐的接口接入

### 1. 分支策略和质量门禁配置页

- [ ] 新增 API：
  - `GET/PUT /projects/{projectId}/repositories/{repositoryId}/branch-policies/{branch}`
  - `GET/PUT /projects/{projectId}/repositories/{repositoryId}/quality-gates/{branch}`
- [ ] 仅 `PROJECT_ADMIN` 可编辑；普通成员可查看或按后端权限显示无权限。
- [ ] 配置目标分支的 `requiredTestsetIds`，候选项仅为同一仓库、已启用的 Testset。
- [ ] 同页展示分支策略：`requirePullRequest`、`minimumHumanApprovals`、`allowDirectPush`。
- [ ] 保存写请求携带 `Idempotency-Key`，成功后刷新分支策略、门禁和 Testset 查询。

验收：管理员可将 `main` 或 `develop` 的一个 Testset 设为强制项；随后该分支的 Dry Run 必然包含该 Testset。

### 2. MR 前预检 API 与数据模型

- [ ] 新增 `PreflightStatus`、`PreflightBlocker`、`PreflightDryRun`、`PreflightCqPlusOne` 类型。
- [ ] 新增查询：
  `GET /projects/{projectId}/tasks/{taskId}/repositories/{repositoryId}/preflight?targetBranch={branch}`。
- [ ] 展示 `sourceCommit`、`targetBranch`、`targetCommit`、总体 `status`、`blockers`、Dry Run 和 CQ+1 详情。
- [ ] 对常见 blocker 提供准确操作文案：
  - `TASK_NOT_READY`
  - `DRY_RUN_MISSING` / `DRY_RUN_QUEUED` / `DRY_RUN_RUNNING` / `DRY_RUN_FAILED`
  - `CQ_PLUS_ONE_MISSING` / `CQ_PLUS_ONE_REJECTED`
  - `PREFLIGHT_CONTEXT_STALE`
- [ ] 不得以按钮是否禁用作为安全保障；服务端 `409 MR_PREFLIGHT_NOT_PASSED` 的 `details[].code` 也必须渲染为操作引导。

### 3. Dry Run 的预检 CQ+1

- [ ] 新增 API：
  - `POST /projects/{projectId}/dry-runs/{dryRunId}/cq-approvals`
  - `POST /projects/{projectId}/dry-runs/{dryRunId}/cq-rejections`
- [ ] 两个写请求均传 `Idempotency-Key`；拒绝必须提交非空 `reason`。
- [ ] 仅当 Dry Run 为 `PASSED` 时展示操作；后端仍是资格与提交一致性的唯一裁决者。
- [ ] 对 `403 PREFLIGHT_CQ_AUTHOR_FORBIDDEN` 明确提示“Task 发起人不可自审”。
- [ ] 对 `409 PREFLIGHT_CONTEXT_STALE`、`PREFLIGHT_TASK_NOT_READY` 刷新预检，不得保留旧通过状态。

验收：非发起人可对当前通过的 Dry Run 审批或拒绝；发起人点击审批得到明确的不可自审提示。

### 4. SSE 与查询失效

- [ ] 在 `PROJECT_TASK_EVENT_TYPES` 与 payload 校验中加入 `preflight.updated`。
- [ ] 收到 `preflight.updated` 后，按 `taskId + repositoryId + targetBranch` 使对应 preflight Query 失效并重新请求。
- [ ] 收到既有 `dry-run.updated` 后，除刷新报告外，也刷新该关联 Task/仓库的预检查询。
- [ ] 保留当前 Dry Run / Test Run 轮询作为 SSE 断线兜底；SSE 只触发重新查询，不承载报告正文。

## P0：必须修正的现有流程

### 5. Diff 详情的“创建 MR”

- [ ] 将 [DiffReviewPage.tsx](./前端/qgents/src/pages/ProjectDetail/DiffReviewPage.tsx) 的直接创建逻辑改为“查询预检后创建”。
- [ ] DIFF_FIRST：仅在用户确认 Diff 并完成真实 commit/push 后，允许进入预检。
- [ ] MR_FIRST：Task 处于 `WAITING_PREFLIGHT` 后展示预检卡；不得把预检未完成标记为“交付失败”。
- [ ] 一个 Task 多仓库时，逐仓库展示状态与操作；不能用一个仓库通过代表全部通过。
- [ ] 预检 `PASSED` 前不展示可执行的创建 MR 主操作；若后端仍返回 409，刷新预检并显示 blockers。
- [ ] `PREFLIGHT_CONTEXT_STALE` 时引导重新 Dry Run + CQ+1；`MR_SOURCE_HEAD_CHANGED` 时引导刷新 Task/Diff，不自动重试创建 MR。

### 6. MR 详情的质量门禁语义

- [ ] 修正 [MergeRequestDetailPage.tsx](./前端/qgents/src/pages/ProjectDetail/MergeRequestDetail/MergeRequestDetailPage.tsx) 的提示与节点模型。
- [ ] `TESTSET`、创建前 `DRY_RUN`、创建前 `CQ+1` 显示为只读“MR 前预检审计”，不是 MR 创建后 `qualityGate` 的必过节点。
- [ ] MR 创建后的 `qualityGate` 仅使用接口真实返回的 MR 后检查，例如 `AI_REVIEW` 与 MR 审查。
- [ ] 不得硬编码“Testset、AI Review、Dry-run、CQ+1 均需 PASSED 才能合并”。

## P1：体验与可解释性

- [ ] 在发起 Dry Run 前展示该目标分支已绑定的强制 Testset；前端展示仅供说明，实际选择仍以后端为准。
- [ ] Test Run 详情展示后端已提供的脱敏失败摘要、执行提交和每个 Testset 的结果；不得显示原始命令、环境变量、Token、宿主机路径或异常栈。
- [ ] Dry Run 显示冲突、测试摘要、固定的 source/target 提交；冲突与测试失败应区分。
- [ ] “本机最近运行”继续明确标记为 localStorage 缓存，不表述为服务端测试历史。
- [ ] 将 Testset 卡片改为键盘可访问的语义化按钮或链接，避免仅靠 `Card onClick`。

## 不属于本轮必办

以下原型功能没有 v2.0.3 接口契约，也不阻断题目 P1 流程，本轮不实现、不对外承诺：

- CSV / JSON 导入 Testset。
- 用例库、逐用例编辑、全局通过率和统计看板。
- Fixture、环境变量管理、并发度、通过阈值。
- Testset 自身的“MR 阻断开关”。MR 前是否强制测试由目标分支 `requiredTestsetIds` 决定。
- 服务端 Test Run / Dry Run 历史列表（当前契约明确不提供）。

## 联调验收清单

- [ ] 管理员为 `main` 绑定 Testset A；普通成员不能绕过该强制 Testset。
- [ ] 普通 Test Run 仅执行用户选中的 Testset，不被默认分支门禁额外注入。
- [ ] 关联 Task 的 Dry Run 对当前已推送的 sourceCommit 和当前 targetCommit 运行，并展示状态变化。
- [ ] Dry Run 通过、CQ+1 缺失时，预检为 `PENDING`，创建 MR 得到明确 blocker。
- [ ] 非作者给 CQ+1 后，预检变为 `PASSED`，无需手动刷新即可看到状态更新。
- [ ] Task 作者无法给自己的 Dry Run CQ+1。
- [ ] source branch 新推送或 target branch 更新后，旧预检失效，前端不再显示“可创建 MR”。
- [ ] 多仓库 Task 必须全部仓库各自通过预检，才显示“创建全部 MR”。
- [ ] 创建成功后，MR 页面不将 MR 前 Testset/Dry Run/CQ+1 误作 MR 后 `qualityGate`。

## 主要对接文件

- `前端/qgents/src/api/testset.ts`
- `前端/qgents/src/hooks/testset.ts`
- `前端/qgents/src/types/testset.ts`
- `前端/qgents/src/realtime/eventParser.ts`
- `前端/qgents/src/realtime/queryInvalidation.ts`
- `前端/qgents/src/pages/ProjectDetail/Testset/TestsetPage.tsx`
- `前端/qgents/src/pages/ProjectDetail/DiffReviewPage.tsx`
- `前端/qgents/src/pages/ProjectDetail/MergeRequestDetail/MergeRequestDetailPage.tsx`
