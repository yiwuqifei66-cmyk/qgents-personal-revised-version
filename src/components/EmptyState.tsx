import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** 图标，可传入 emoji 或 SVG */
  icon?: ReactNode
  /** 主标题 */
  title?: string
  /** 副标题说明 */
  description?: string
  /** 操作按钮区域 */
  action?: ReactNode
}

/**
 * 空状态占位 —— 列表/搜索无结果等场景复用
 */
export function EmptyState({
  icon,
  title = '暂无数据',
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '48px 24px',
        color: '#94a3b8',
        gap: 12,
      }}
    >
      {icon != null && (
        <div style={{ fontSize: 40, opacity: 0.6 }}>{icon}</div>
      )}
      <p style={{ fontSize: 16, fontWeight: 600, color: '#cbd5e1', margin: 0 }}>
        {title}
      </p>
      {description != null && (
        <p style={{ fontSize: 13, margin: 0, textAlign: 'center' }}>
          {description}
        </p>
      )}
      {action != null && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  )
}
