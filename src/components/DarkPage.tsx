import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { qgDarkPageTheme } from '@/theme/antdTheme'

/**
 * 深色页面容器 —— 用于挂在 MainLayout 深色 navy 背景下的页面
 * （GitHub 集成、已授权仓库、绑定项目等）。
 *
 * 这些页面的内容直接透出 navy 底，需要 antd 深色主题把标题/段落/卡片/表格
 * 的文字统一转成浅色，否则黑字压在深底上看不清。
 */
export function DarkPage({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider theme={qgDarkPageTheme}>
      <div className="qg-dark-page-content" style={{ maxWidth: 960, margin: '0 auto' }}>
        {children}
      </div>
    </ConfigProvider>
  )
}
