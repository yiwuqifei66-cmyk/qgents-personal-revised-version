# CHAT-001：恢复连接后校准已有卡片内容

日期：2026-10-19（Asia/Shanghai）。范围依据：[群聊任务与进度](chat-optimization-taskboard.md) 中 CHAT-001。网页手动验收由用户负责，本轮未操作浏览器。

## 1. 复核与契约对照

问题仍可复现。修改前的两个组件回归分别通过回前台和重连入口触发：后端只更新原 TASK_STATUS 的正文、状态和步骤，ID/sequence 不变，增量接口成功返回空列表。原实现提前返回，继续显示旧内容。红灯报告保存为 `chat-panel-red.json`。

契约以 `docs/api/docs/api/qgents-api-current.md` **v2.0.23** 为准：

- §23.1/23.2/23.5：TASK_STATUS、DIFF 在原消息上更新 content，ID、sequence、createdAt 不变；普通消息不进入该卡片更新逻辑。
- §29.1：incremental 严格返回 sequence 大于 afterSequence 的消息，不能用空增量证明原卡片内容未变。
- §7：已有单消息 GET 可返回完整 MessageResponse，无需新增接口。

按用户授权，只读对照了后端 `C:/Users/yiwu/Desktop/qg/末期项目/仓库/后端仓库/Qgents`：

- `src/main/java/qg/qgent/mapper/MessageMapper.java:34`：增量 SQL 使用 sequence_no > afterSequence。
- `src/main/java/qg/qgent/service/MessageService.java:326`：TASK_STATUS / DIFF 更新入口；362 行起更新原 content 并发布 message.updated。
- 同文件 591 行起：按 ID 查询并验证群归属；718 行起读取当前完整 content JSON。
- 同文件 525 行起及 815 行起：历史按序号倒序分页，游标编码序号，内容更新不移动边界。

**后端仓库没有任何本轮写入，也未执行其构建、测试、安装、格式化或提交。**

## 2. 最小实现及必要依赖

业务修改集中在 `src/components/chat/ChatPanel.tsx`：

1. 恢复时继续用增量补新消息，并按 hasMore / nextCursor 拉完全部增量页。
2. 无论增量是否为空，都按本次恢复前已缓存的 TASK_STATUS / DIFF ID 重读内容；遍历所有缓存页、ID 去重，每批最多 4 个请求，包含 SYSTEM 身份的降级卡片。
3. 所有卡片读取成功后，按 ID 更新原分页中的消息，保留 pages/pageParams。读取期间已被其他实时查询替换的对象不被旧响应覆盖。只有相应读取真正成功才解除校准失败状态。
4. 增量不可用时，以独立 Query 管理历史回退：limit=100，从最新向旧逐页读取，直到接回恢复前最大序号或历史结束。完整返回前不提交部分新消息、不清错；避免只取最新一页导致中间消息遗漏。
5. 回退仅追加 sequence 大于恢复边界的新消息；边界以内只更新缓存已有 ID，不将未加载旧历史注入最新页，因此原历史 cursor 可以继续翻页。
6. 回退提交前等待进行中的历史分页，使用 functional setQueryData 合并最新缓存，不替换旧阅读窗口。卡片变高或回退合并前采样当前可见消息，在 layout effect 恢复相对偏移；采样时点允许用户在请求期间继续滚动。
7. 首屏补查按进入会话执行一次，cleanup 支持 StrictMode 重放，防止每次卡片写缓存都重复触发增量请求并误报失败。群列表失效使用 exact，避免意外再次重拉全部消息覆盖刚校准的窗口。

没有改 API/client、后端、UI 库、已读业务规则或其他页面。没有实施 CHAT-002/003/008 的整体方案。读取错误继续沿用 CHAT-004 的提示及重试；本次仅补正确恢复所必需的窗口、游标和请求生命周期处理。

## 3. 自动验证

测试继续使用真实 ChatPanel、TanStack Query、groupApi/client，MSW 在 HTTP 边界模拟服务端；认证和无关重组件使用替身，卡片替身显式读取真实 content 字段验证正文、状态和步骤。

本轮覆盖的行为：

- 回前台与重连：空增量也更新原卡片，ID/sequence 保持。
- 原历史页中的卡片在大量新增消息之后仍保留并更新，草稿与消息节点不被移除。
- SYSTEM 降级的 TASK_STATUS 与 DIFF 均按 type 校准。
- 卡片 GET 失败保留原内容及同步失败提示，正确重试后恢复。
- 旧群请求晚到成功/失败不影响新群反馈。
- 卡片变高及用户请求中继续滚动的锚点模拟。
- 多页增量补齐、增量失败后多页历史回退，完整接回窗口才清错。
- 回退边界、后续历史分页及 StrictMode 缓存挂载。
- CHAT-004 原有 11 项用户行为继续回归。

两条旧回退测试原先断言主 Query 的 error/paused。现在回退由独立子 Query 执行，因此改为验证实际 HTTP 失败、匹配消息 key 前缀的 paused 状态、重试 pending 和原 UI/内容保留；没有删除用户行为验收断言。

最终检查使用 Windows 原生 PowerShell / Node 执行：

| 检查 | 结果 |
| --- | --- |
| ChatPanel 定向测试 | **24/24 通过**：CHAT-001 新增 13 项，CHAT-004 原有 11 项 |
| `npm run lint` | 通过，0 error、28 warning；本轮 ChatPanel 没有 lint 告警 |
| 应用 strict 类型检查 | 通过 |
| `npm run build` | 通过；保留 chunk 体积及插件耗时提示，产物输出到项目外证据目录 |
| `npm run test` 全套 | **436 项：395 通过、41 失败**；全套中的 ChatPanel 仍为 24/24 |
| `git diff --check` | 通过 |

全套失败与本轮开始前 `chat004-2026-10-19/taskboard-check/tests.json`（423 项，383 通过、40 失败）逐项比较：原 40 个失败全部保留，另外出现 `projectEventConnection.test.ts` 的 `reconnects after a failed stream without a permanent timer`，第 94 行预期连接调用 2 次、实际 1 次。该断言也在早先 CHAT-004 的 `full-test-final.json` 中失败过；其测试和实现本轮均未改动，测试直接实例化 SSE 连接类，不依赖 ChatPanel。**这是相对所选基线新增的失败结果，尚未证明由本次修改引入；也不能据此宣布全套通过或该计时问题已解决。** 未为此扩大范围、修复范围外失败或反复重跑全套。

逐条验收对照：

| 要求 | 自动验证及当前结论 | 尚待验证 |
| --- | --- | --- |
| 回前台后，原卡片在空增量下更新正文、步骤和状态 | 两条修改前红灯之一；修复后对应组件用例通过，ID/sequence 不变 | 真实后端与网页操作 |
| 重连后，同一原卡片正确更新 | 另一条修改前红灯；修复后对应组件用例通过 | 真实事件传输与网页操作 |
| 校准覆盖已加载旧页及 SYSTEM 降级卡片 | 多页旧窗口、TASK_STATUS、DIFF 用例通过 | 实际卡片布局 |
| 阅读历史时保留消息、草稿和位置 | DOM/草稿保留、卡片增高 90px 和请求中滚动的几何模拟通过 | 浏览器实际阅读位置、图片异步变化及不同设备 |
| 请求失败沿 CHAT-004 提示并可正确重试 | 单卡 GET 503 后旧内容/同步失败提示保留，重试成功后清错；原 11 项全通过 | 用户本地故障开关验收 |
| 必要依赖不遗漏消息、不污染历史边界或新群 | 250 条多页增量/历史回退、边界继续翻页无重复、旧群迟到响应、StrictMode 用例通过 | 真实网络并发场景 |

没有发现已证实的本次新增业务回归。jsdom 的几何模拟只验证补偿逻辑，不能当作本轮浏览器像素验收。原 CHAT-004 三项任务卡及三项补充验收的用户行为断言继续保留，具体说明见其独立实现记录。

## 4. 用户本地验收

沿用 <http://127.0.0.1:5194/>，保留原 CHAT-004 控件。服务不因本轮交付而关闭。若已打开页面，请手动刷新以加载新增样本。

1. 点“加载/重置 CHAT-001 旧卡片”，确认旧正文、摘要、PLANNING 状态及 1 个步骤。
2. 点“服务端静默更新卡片”。该操作只更新本地 Mock 服务端 content，不发事件、不改前端缓存，不增加消息 ID 或 sequence。
3. 点“触发重连校准”，或切换浏览器标签页后返回。应显示新正文、新摘要、WAITING_DIFF_CONFIRMATION 状态及 2 个步骤，仍是同一消息。
4. 再重置旧卡，输入草稿并上翻。开启“单卡 GET 故障”，静默更新后触发校准：旧卡和草稿应保留，显示同步失败。
5. 关闭单卡故障，点聊天区“重试同步”：卡片更新，成功后才清除提示，阅读位置和草稿保持。
6. 同时确认原 CHAT-004 的首载/分页/后台失败入口仍可操作。

固定样本为 `task-card-001 / sequence=42`，增量返回空列表。完整控件说明和启动脚本见项目外 `chat004-2026-10-19/browser/README.md`。

实现阶段 Codex 没有实际后端端到端联调、浏览器 UI 操作或像素验证。2026-10-19 用户确认本地验收成功；不将这一结论扩大为真实后端端到端、图片异步变化或不同设备均已验证。

## 5. 进度与证据

当前状态：**已完成，用户验收通过**。2026-10-19 用户确认本项及 CHAT-004 均验收成功，并明确授权提交、推送到新绑定的前端仓库 `https://github.com/yiwuqifei66-cmyk/lt1`。保留上述范围外失败及未验证限制；未自动启动下一张任务卡，下一候选为 CHAT-002 的现状复核。

证据目录：

```text
C:/Users/yiwu/.codex/visualizations/2026/10/15/01a13fc7-5509-7081-a57d-9a2df248d593/chat001-2026-10-19/
```

- `ChatPanel.before.tsx`、`red-source-sha256.json`：本轮修改前实现快照及指纹，保留已有 CHAT-004 修改。
- `chat-panel-red.json/.log`：两个入口的修改前失败证据。
- `chat-panel-targeted.json/.log`：聊天定向回归结果。
- `lint.log`、`build.log`、`build-snapshot/`：lint 与构建结果及构建产物。
- `full-test-final.json/.log`：本轮唯一一次最终全套结果。
- `full-test-final-comparison.json`：与 taskboard-check 基线逐项比较，以及定向测试和 strict 检查结果。

手动样本仍在项目外原 `chat004-2026-10-19/browser/` 目录，仅供本地验证，不进入产品页面流程。
