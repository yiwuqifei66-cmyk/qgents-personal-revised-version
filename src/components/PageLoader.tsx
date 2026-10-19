// src/components/PageLoader.tsx
import { Spin } from 'antd'

export function PageLoader() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0b0e14)',
      }}
    >
      <Spin size="large" tip="加载中..." />
    </div>
  )
}