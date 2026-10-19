import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PATHS } from '@/routes/paths'

/**
 * 404 页面 —— 路由未匹配时展示
 */
export default function NotFoundPage() {
  const navigate = useNavigate()
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        gap: 16,
      }}
    >
      <p style={{ fontSize: 80, fontWeight: 700, color: '#0d9b8a', margin: 0 }}>404</p>
      <p style={{ fontSize: 18, margin: 0 }}>页面未找到</p>
      <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>
        你访问的页面不存在或已被移除
      </p>
      <button
        type="button"
        onClick={() => navigate(PATHS.MY_TEAMS, { replace: true })}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          marginTop: 8,
          padding: '8px 24px',
          borderRadius: 8,
          border: 'none',
          background: hover ? '#0aa18e' : '#0d9b8a',
          color: '#fff',
          fontSize: 14,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
      >
        返回团队首页
      </button>
    </div>
  )
}
