# Qgents Web

Qgents 的 React / TypeScript 前端，提供团队与项目管理、需求群聊、Agent 配置、任务执行跟踪、Diff 审核、测试与质量门禁、MR / GitHub 交付，以及 Skill / Memory 管理。后端服务独立部署。

技术栈：React 19、TypeScript strict、Vite、Ant Design、TanStack Query、Zustand、MSW 和 Vitest。

## 本地开发

本次验证使用 Node.js 24 与 npm 11。在项目根目录执行：

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

开发服务器默认端口为 `5173`。示例环境启用 MSW，本地 Mock 与真实接口共用业务 API 调用链。

连接后端时，在本地 `.env` 中设置 `VITE_USE_MOCK=false`，并为 `VITE_API_BASE_URL` 配置包含 API 路径的完整地址，例如 `https://api.example.com/api/v1`。使用相对地址 `/api` 时，请核对 `vite.config.ts` 的开发代理目标。

`.env`、`.env.local` 等本机环境文件不提交。仓库仅保留不含私密值的 `.env.example` 和 `.env.test`。前端 `VITE_*` 变量会进入浏览器代码，只能存放可公开的配置。

## 检查与构建

```powershell
npm run lint
npm run test -- --run
npm run build
npm run preview
```

测试采用独立 Mock 环境。当前初始快照的 lint 与构建检查通过；测试中仍存在未通过项，主要涉及测试 Mock 和现有页面断言不一致。该快照保存当前开发进度，测试修复仍待后续处理。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/routes`、`src/layouts` | 路由、鉴权守卫和应用布局 |
| `src/pages`、`src/components` | 业务页面和复用组件 |
| `src/api`、`src/types` | API 请求、接口类型和响应映射 |
| `src/hooks`、`src/query` | TanStack Query 数据查询与缓存 |
| `src/store`、`src/context` | UI 状态和认证上下文 |
| `src/realtime` | WebSocket / SSE 事件与缓存同步 |
| `src/mocks`、`src/test` | Mock 接口与测试支持 |
| `public` | 页面静态资源和 MSW Worker |
| `docs`、`README` | 接口契约、技术规范和联调说明 |

测试、Mock、构建配置和 `package-lock.json` 均属于可复现项目所需的内容。依赖目录、构建输出、日志、缓存、个人评审笔记和旧答辩产物由 `.gitignore` 排除。

## 项目文档

- [最新 API 契约 v2.0.23](docs/api/docs/api/qgents-api-current.md)
- [前端技术规范](docs/frontend/tech-stack.md)
- [联调部署指南](README/联调部署指南.md)
- [协作规范](AGENTS.md)

`README/Qgents接口文档.md`（v2.0.13）和外层 `docs/api/qgents-api-current.md`（v1.9.7）保留用于对照；发生冲突时以 v2.0.23 的最新契约为准。
