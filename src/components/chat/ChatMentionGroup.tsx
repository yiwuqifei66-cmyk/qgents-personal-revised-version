import { Typography, theme } from 'antd'
import type { MentionType } from '@/types'

const { Text } = Typography
export function ChatMentionGroup({
  label,
  members,
  onPick,
  onClose,
}: {
  label: string
  members: Array<{ id: string; displayName: string; type: MentionType; avatarUrl?: string | null }>
  onPick: (m: { id: string; displayName: string; type: MentionType }) => void
  onClose?: () => void
}) {
  const { token } = theme.useToken()
  return (
    <div style={{ marginBottom: 4 }} role="group" aria-label={label}>
      <Text type="secondary" style={{ fontSize: 11, padding: '4px 8px', display: 'block' }}>
        {label}
      </Text>
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-label={`提及${m.displayName}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose?.()
          }}
          onClick={() => onPick(m)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 8px',
            borderRadius: 6,
            cursor: 'pointer',
            width: '100%',
            border: 0,
            background: 'transparent',
            textAlign: 'left',
            color: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = token.colorFillSecondary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {m.avatarUrl ? (
            <img
              src={m.avatarUrl}
              alt=""
              style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: m.type === 'AGENT' ? '#3b82f6' : '#8b5cf6',
                color: '#fff',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {m.type === 'AGENT' ? '🤖' : (m.displayName.slice(0, 1) || '?')}
            </span>
          )}
          <Text style={{ fontSize: 13 }}>{m.displayName}</Text>
        </button>
      ))}
    </div>
  )
}

