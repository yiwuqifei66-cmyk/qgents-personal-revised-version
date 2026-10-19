import { Component, type ReactNode } from 'react'
import { Alert, Button, Space } from 'antd'

interface Props {
  /** 变化时自动复位错误态（如切换路由/群聊/项目时），避免边界一直卡在错误态 */
  resetKey?: unknown
  /** 自定义兜底 UI（默认通用错误卡片） */
  fallback?: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 通用错误边界：子树渲染抛错时兜底展示，避免整页黑屏。
 * React 没有 hook 版 ErrorBoundary，需用 class 组件（React 19 同样支持）。
 * 用法：<ErrorBoundary resetKey={groupId}>...</ErrorBoundary>
 *  - 渲染期抛错 → 捕获并显示兜底 UI（不再卸载整棵子树）
 *  - resetKey 变化 → 自动清除错误态恢复渲染
 *  - 「重试」手动复位；「刷新页面」整页重载（error 边界外无法自行恢复时兜底）
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    // 此处可接监控上报；当前先打印便于排查
    console.error('[ErrorBoundary] caught:', error)
  }

  componentDidUpdate(prevProps: Props): void {
    // resetKey 变化时复位错误态（标准 ErrorBoundary reset 模式，条件 setState 安全）
    if (this.props.resetKey !== prevProps.resetKey && this.state.error) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ error: null })
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.handleReset)
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          padding: 24,
        }}
      >
        <Alert
          type="error"
          showIcon
          message="页面渲染出错"
          description={error.message || '发生未知错误，请重试或刷新页面'}
          action={
            <Space direction="vertical" size={8}>
              <Button type="primary" size="small" onClick={this.handleReset}>
                重试
              </Button>
              <Button size="small" onClick={() => window.location.reload()}>
                刷新页面
              </Button>
            </Space>
          }
        />
      </div>
    )
  }
}
