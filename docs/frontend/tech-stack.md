# Qgents V3 前端技术规范

## 状态与数据

- 后端数据统一使用 TanStack Query 管理；查询资源的 `queryKey` 必须包含资源归属，例如 `projectId`。
- 全局客户端 UI 状态使用 Zustand；当前只放跨页面 UI 状态，不放团队、项目、任务、Agent 等接口资源。
- 组件内部的短生命周期状态使用 React `useState`。
- 需要分享、刷新后保留或可复制的筛选和选中状态使用 URL 参数。
- mutation 成功后使用 `setQueryData` 或 `invalidateQueries` 更新 Query 缓存，不复制列表到 Zustand。

## UI 与请求

- UI 组件统一使用 Ant Design 6 和 `@ant-design/icons`。
- 表单统一使用 Ant Design Form。
- 所有后端请求必须经过 `src/api/client.ts`，业务 API 放在 `src/api` 下。
- 不在组件中直接拼接 HTTP 请求或处理认证头。
- 现有 `AuthContext` 暂时保留，不能用 Zustand 替换。

## Mock 与实时事件

- Mock 统一使用 MSW，并由 `VITE_USE_MOCK=true` 控制开发环境启动。
- 组件不得直接 import Mock fixture；Mock 与真实接口必须走同一套 API 调用链。
- SSE 开发阶段使用 `@microsoft/fetch-event-source`，并通过事件更新 TanStack Query 缓存。

## 禁止项

- 禁止 Axios、Redux、MobX、Tailwind 和第二套 UI 组件库。
- 禁止使用 `any`；接口不确定时使用 `unknown` 并在边界处收窄。
- 不要在 Zustand 中存储后端资源列表。
