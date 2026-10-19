import { memo, type CSSProperties, type ReactNode } from 'react'
import { Avatar } from 'antd'
import type { Message } from '@/types'
import './ChatPanel.css'

export interface ChatMessageRowProps {
  message: Message
  isSelf: boolean
  grouped: boolean
  flashing: boolean
  userAvatarUrl?: string | null
  userDisplayName?: string
  senderAvatarUrl?: string
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  children: ReactNode
}

/** 单条消息行：只负责头像、对齐和行级交互，不关心消息内容类型。 */
export const ChatMessageRow = memo(function ChatMessageRow({
  message,
  isSelf,
  grouped,
  flashing,
  userAvatarUrl,
  userDisplayName,
  senderAvatarUrl,
  onContextMenu,
  children,
}: ChatMessageRowProps) {
  const rowStyle: CSSProperties = {
    justifyContent: isSelf ? 'flex-end' : 'flex-start',
    background: flashing ? 'rgba(245, 158, 11, 0.18)' : undefined,
    borderRadius: 8,
    padding: flashing ? '3px 8px' : undefined,
    margin: flashing ? '-3px -8px' : undefined,
    transition: 'background 0.4s ease',
  }
  return (
    <div
      id={`msg-${message.id}`}
      className={grouped ? 'chat-panel__message-row chat-panel__message-row--grouped' : 'chat-panel__message-row'}
      style={rowStyle}
      onContextMenu={onContextMenu}
    >
      {!isSelf && message.senderType !== 'SYSTEM' ? <Avatar size={32} src={senderAvatarUrl} style={{ flexShrink: 0, background: '#3b82f6', marginTop: 2 }}>{(message.senderName ?? '?').slice(0, 1)}</Avatar> : null}
      <div className="chat-panel__message-body">{children}</div>
      {isSelf ? <Avatar size={32} src={userAvatarUrl ?? undefined} style={{ flexShrink: 0, background: '#f97316', marginTop: 2 }}>{(userDisplayName ?? '我').slice(0, 1)}</Avatar> : null}
    </div>
  )
})
