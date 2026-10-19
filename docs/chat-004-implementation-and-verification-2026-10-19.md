# CHAT-004 实现与验收记录

日期：2026-10-19（Asia/Shanghai）。依据：原任务卡及用户批准的补充验收，延续 [10 月 18 日调查方案](chat-004-investigation-and-plan-2026-10-18.md)。

## 1. 结果与范围

CHAT-004 已完成实现。原任务卡三项及补充三项均有自动回归与本地浏览器证据；浏览器使用真实聊天组件及 API 调用链，在 HTTP 边界注入故障，不能等同于真实后端端到端联调。

**用户验收：2026-10-19 已通过。** 用户确认 CHAT-004、CHAT-001 两项修改均验收成功，并授权提交、推送到新绑定的前端仓库 `https://github.com/yiwuqifei66-cmyk/lt1`。原自动检查失败与真实后端等未验证限制继续保留。

本次业务差异仅为：

- `src/components/chat/ChatPanel.tsx`：分类反馈、对应重试、同步失败保留、分页阅读锚点及必要并发处理。
- `src/components/chat/ChatPanel.css`：固定尺寸的同步/历史提示槽，消息视口允许在 Flex 布局中正确收缩。
- `src/components/chat/ChatPanel.test.tsx`：新增 11 项回归。
- 本文件：交付与本地验收记录。

沿用 React、Ant Design、TanStack Query、现有 groupApi/client 和 HTTP 契约。未增加依赖，未修改全局查询重试、后端接口、未读规则或其他页面；实现交付时未执行提交或推送，用户验收后已另行授权。已有组件拆分等修改保留。调查用文件、构建产物和浏览器 Harness 均保存在项目外。

## 2. 实现说明

### 错误分类及对应重试

| 状态 | 当前呈现 | 重试路径 |
| --- | --- | --- |
| 无缓存首载失败 | “消息加载失败”及“重试加载消息”，不显示空群 | 当前消息 Query 的 refetch |
| 已缓存历史分页失败 | 消息节点继续挂载，历史入口显示失败和“重试加载历史” | fetchNextPage，继续原历史 cursor |
| 已缓存后台 Query 重取失败 | 保留内容，提示同步未成功，提供“重试同步” | 共享查询配置的 fetchInfiniteQuery，重新查询最新页及已加载分页 |
| 直接增量同步失败 | 保留内容，独立记录失败及执行状态 | 既有增量入口，使用当前缓存的 max(sequence) |
| 回前台/重连校准失败 | 沿用增量后整页回退；失败未恢复前保留同步提示 | 既有 reconcile 路径及其回退 |
| 成功加载过的空群后台失败 | 保留成功空群呈现并附同步提示 | 后台重试，不转为无缓存首载错误 |

缓存是否存在依据 `page !== undefined`，不依据消息条数。

直接增量的 `setQueryData` 会使 Query 状态恢复为 success，但不能证明历史分页或整页同步已经恢复。因此，本地 UI 失败状态通过精确消息 QueryCache 事件分别保留：只有对应读取的实际成功清错，忽略手动写缓存的 success。

直接增量成功返回空结果也清除该增量失败；切群后的旧请求不更新当前群的反馈。新增反馈不借用发送错误，不清理草稿。

### 阅读位置及必要并发处理

- 已有缓存失败时保持消息视口、内容容器及消息行节点挂载。
- 同步提示槽固定 64px，历史提示槽固定 40px，错误/重试/成功切换不挤动消息。
- 分页前记录首个可见消息及其相对视口偏移；成功前插历史后在 layout effect 中恢复同一消息锚点。失败时不以错误空态重算位置。
- 历史失败后停止仅靠触顶滚动自动重试，提供显式入口；进行中的重复请求受保护。
- 若后台重查与历史分页并发，先等待当前历史请求结束，再明确发起整页查询，避免把历史成功当成后台同步成功。
- 后台回退使用实际查询 Promise。离线暂停、恢复在线但 HTTP 尚未完成，都不提前清除失败提示。

上述并发处理属于正确重试和清错所需依赖，没有重构实时传输架构。

## 3. 逐项验收

“通过”仅限下表证据覆盖的本地前端范围。A1—A3 为原任务卡，B1—B3 为用户补充。

| 编号 | 验收要求 | 自动测试 | 浏览器验证 | 结论 |
| --- | --- | --- | --- | --- |
| A1 | 历史失败保留消息、草稿、阅读位置，可重试 | 断言消息行及视口节点不变、草稿与模拟滚动位置保留；重试仍使用同一 cursor | 原 30 条消息在失败/重试中保留，恢复后 60 条；同一 msg-m-61 节点不变，偏移始终 68px，delta=0；草稿保留。请求记录确认 cursor=before-61 从 503 到 200 | 通过 |
| A2 | 后台刷新失败保留内容并明确提示同步未成功 | 覆盖 Query 重取、直接增量、校准及回退；成功增量写缓存不能误清 Query 失败 | Query 重取失败、重试、恢复均保留 60 条消息、草稿及原锚点；失败提示可见，实际成功后消失 | 通过 |
| A3 | 无缓存首载失败显示错误与重试，不显示为空群 | 首载 503 后错误与重试可见，空群提示不存在；重试成功显示消息 | 首载错误及重试可见，emptyGroupVisible=false；恢复后 30 条消息，重试期间输入的草稿保留 | 通过 |
| B1 | 成功空群后台失败不误判首载 | 空成功缓存后重取失败及恢复；仍显示空群结果，使用同步重试 | rowsInDOM=0 的成功空群失败后继续显示“还没有消息”；同步提示及重试可见，没有“消息加载失败”；恢复后仍为空群，草稿保留 | 通过 |
| B2 | 直接增量失败有提示，并沿正确路径重试 | HTTP 层注入增量 503；重试仍请求 incremental，afterSequence=当前最大序号；空成功结果正确清错 | Query 状态仍为 success 时也出现同步失败；请求记录为 incremental?afterSequence=90&limit=100，503 后点击重试得到 200，随后清错 | 通过 |
| B3 | 失败与重试前后保留消息区域、草稿和阅读位置 | 保留节点、草稿；切群后旧请求反馈隔离；并发及离线状态不提前清错 | 历史、Query、直接增量共九个观测点的原消息节点相同且 delta=0px；Query/增量前后 scrollTop=4180、视口高度=653；历史成功前插后 scrollTop 从 0 增至 4180，而原消息相对偏移保持 68px | 通过 |

阅读位置用“同一可见消息相对视口的偏移”衡量，不要求历史前插后绝对 scrollTop 不变。

## 4. 自动检查结果及基线差异

命令均使用 Windows 原生 PowerShell 和已有 Node/npm；本轮未使用 WSL、未重装依赖。

| 检查 | 最终结果 |
| --- | --- |
| npm run lint | 退出 0；28 条警告，无本次聊天文件新增警告 |
| npm run build（outDir 指向项目外） | 退出 0；类型检查与 Vite 打包完成，仍有大 chunk 提示 |
| npm run test -- --run --maxWorkers=4 | 55 个文件：44 通过、11 失败；423 项：383 通过、40 失败 |
| ChatPanel.test.tsx | 11/11 通过，包含完整 HTTP 边界及 Query/groupApi/client 链路 |
| npm run dev -- --host 127.0.0.1 --port 5195 --strictPort | Mock 开发模式启动成功，Vite ready 223ms；检查后关闭 |
| git diff --check | 通过，无差异空白错误；Git 提示既有 Windows 行尾转换策略 |

首轮沙箱内部分 Vitest 运行因 Vite 缓存临时文件 rename 的 EPERM 未加载任何测试，不能计为测试通过或业务失败。按会话授权流程在原生 Windows 环境重跑后，才采用上表结果。最早临时目录中的一份日志未持久保存，不作为基线证据；保留的报告均位于下述项目外目录。

与 10 月 18 日的 412 项基线逐条比较，而不是仅比较总失败数：

- 新增 11 项聊天测试全部通过。
- 39 项失败与旧基线相同，涉及 task-model hook、Mock、Code/Diff/MR、DeliveryCenter、Testset。
- 旧基线的 SSE cursor-expired 用例本次通过；另一项 `reconnects after a failed stream without a permanent timer` 本次失败，在 `projectEventConnection.test.ts:94` 期望连接 2 次，实际 1 次。
- SSE 文件单独复核为 9 项中 8 通过、上述 1 项失败。该测试和对应实现没有本次改动，测试不依赖 ChatPanel；尚未调查计时差异根因，不能把它描述成已修复，也不能声称失败集合完全相同。
- 未观察到新增聊天回归；上述相对旧基线新增的 SSE 失败记录仍是未解决的范围外检查差异。全套测试尚未全绿。

## 5. 浏览器证据与限制

浏览器通过临时独立页面渲染真实 ChatPanel、MessageBubble、ChatComposer、ChatMessageViewport、ChatMessageRow，保留生产 Query 重试配置和 groupApi/client，由 MSW 在 HTTP 边界返回分页、增量、503 及恢复响应。

独立替身仅用于认证、Agent 候选、实时连接状态、无关弹窗和任务/Diff 卡片。事件在本地分发，未连接真实后端或真实 WS/SSE 传输。没有向群聊发送消息。

浏览器结构化记录 `browser/browser-results.json` 共 15 个观测点。正常群三条路径的九个点均为同一 msg-m-61、sameDOMNode=true、deltaPx=0；历史成功后消息行 30→60。另有空群及首载各三个点。截图、AX 记录和 HTTP 请求路径记录均保存。

初次测量期间修改过组件 Hook，HMR 导致过一次重挂载，该组数据已弃用。正式证据在代码冻结后整页刷新重测，包含最终并发修复。

尚未验证：真实后端鉴权和事件传输、真实附件/图片异步尺寸变化、多浏览器及不同设备布局。并发回退和离线暂停以自动组件测试验证，没有在浏览器中另做网络离线切换。这些限制不以 jsdom 的模拟 scrollTop 替代真实像素证据。

临时浏览器页已关闭，临时服务 5194/5195 已停止；Harness 文件保留，可按下节复跑。

## 6. 本地可操作验收步骤

在 PowerShell 中执行（使用现有项目依赖，无需安装）：

```powershell
& 'C:\Users\yiwu\.codex\visualizations\2026\10\15\01a13fc7-5509-7081-a57d-9a2df248d593\chat004-2026-10-19\browser\start.ps1'
```

打开 <http://127.0.0.1:5194/>。该页面是本地验收工具，不会调用真实后端。

1. **历史分页**：默认有缓存群，等待加载完成，输入草稿；开启“历史分页故障”，点“滚到顶部并固定锚点”。等重试耗尽后应显示历史失败，消息和草稿仍在，左侧 sameDOMNode=true、deltaPx=0。关闭故障，点聊天区“重试加载历史”；应增加历史消息，原锚点保持。底部请求记录的失败/重试 cursor 应相同。
2. **后台重取**：保持当前位置，开启“Query 重取故障”，点“触发 Query 重取”。应出现同步失败，消息、草稿和锚点保持；关闭故障，点聊天区“重试同步”，成功后提示消失。
3. **直接增量**：开启“直接增量故障”，点“触发直接增量”。即使 Query 状态仍为 success，也应有同步失败提示；关闭故障，点聊天区“重试同步”。底部应新增 incremental 请求，使用 afterSequence，不能改走历史 cursor；空成功结果也应清错。可用“服务端追加消息并触发”进一步检查新消息补齐。
4. **缓存空群**：点“空群”，先确认成功空态，输入草稿；开启“Query 重取故障”并触发。空态继续存在，附同步失败；不得出现首载“消息加载失败”。关闭故障后从聊天区重试，仍为空群且草稿保留。
5. **无缓存首载**：开启“首载故障”，点“首载失败样本”。应显示“消息加载失败”和“重试加载消息”，不显示空群。输入草稿，关闭故障后点聊天区重试；消息恢复，草稿保留。
6. 结束后在启动窗口按 Ctrl+C。复跑自动验收可在项目根目录执行：

```powershell
npm.cmd run test -- --run src/components/chat/ChatPanel.test.tsx
npm.cmd run lint
npm.cmd run test -- --run --maxWorkers=4
npm.cmd run build
```

## 7. 证据位置

项目外证据根目录：

```text
C:/Users/yiwu/.codex/visualizations/2026/10/15/01a13fc7-5509-7081-a57d-9a2df248d593/chat004-2026-10-19/
```

| 文件 | 用途 |
| --- | --- |
| ChatPanel.before.tsx / ChatPanel.before.css / source-before.json | 本轮编辑前快照；不以 HEAD 覆盖已有修改 |
| lint-final.log / build-final.log | 最终静态检查与构建日志 |
| chat-panel-targeted.json | 11 项聊天定向回归结果 |
| full-test-final.json / full-test-final.log | 最终 423 项完整结果 |
| full-test-final-comparison.json | 相对旧基线逐条失败差异；其中 suite 数不等于文件数，文件数以上表为准 |
| sse-check-native.json | 范围外 SSE 差异的隔离复核 |
| browser/browser-results.json | 正式浏览器观测点、草稿、节点身份及像素值 |
| browser/http-normal.ax.txt | HTTP 历史 cursor、Query 重取、增量 afterSequence 的失败与恢复路径 |
| browser/history-failure.png / query-failure.png / empty-failure.png | 错误提示、已有内容和输入区截图 |
| browser/*.ax.txt | 关键浏览器状态记录 |
| browser/README.md / start.ps1 | 本地 Harness 说明及启动入口 |

问题已在约定前端范围内修复；没有自动转入其他 CHAT 项目。真实后端联调和范围外测试失败仍按各自任务处理。
