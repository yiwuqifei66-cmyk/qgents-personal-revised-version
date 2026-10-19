import { AppRouter } from '@/routes'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/**
 * Qgents Web 桌面端入口
 * 架构：IM 群聊 + 任务看板；Agent 云端执行；GitHub 存管代码
 * 本仓库当前阶段：路由与页面框架，业务逻辑由各同学后续填充
 */
function App() {
  return (
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  )
}

export default App
