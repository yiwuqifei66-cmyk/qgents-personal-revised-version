import type { ReactNode } from 'react'
import { Avatar, Empty, Spin, Typography } from 'antd'
import type { Message } from '@/types'
import './ChatPanel.css'

const { Text } = Typography

export interface ChatMessageListProps {
  messages: Message[]
  userId?: string
  userAvatarUrl?: string | null
  userDisplayName?: string
  isLoading: boolean
  isError: boolean
  hasNextPage?: boolean
  isFetchingNextPage: boolean
  mentionFlashId: string | null
  showMentionBar: boolean
  mentionCount: number
  listRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  onScroll: React.UIEventHandler<HTMLDivElement>
  onMentionJump: () => void
  resolveSenderAvatar: (message: Message) => string | undefined
  renderMessage: (message: Message, isSelf: boolean) => ReactNode
}

/** 可复用的消息滚动视口；ChatPanel 在迁移期间保留既有消息渲染逻辑。 */
export function ChatMessageViewport({
  children,
  listRef,
  onScroll,
}: {
  children: ReactNode
  listRef: React.RefObject<HTMLDivElement | null>
  onScroll: React.UIEventHandler<HTMLDivElement>
}) {
  return <div ref={listRef} className="chat-panel__message-list" onScroll={onScroll} aria-label="对话内容">{children}</div>
}

/** 聊天消息列表：负责加载态、历史分页、消息行布局和 @ 提示，不处理消息内容业务。 */
export function ChatMessageList({
  messages,
  userId,
  userAvatarUrl,
  userDisplayName,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  mentionFlashId,
  showMentionBar,
  mentionCount,
  listRef,
  contentRef,
  onScroll,
  onMentionJump,
  resolveSenderAvatar,
  renderMessage,
}: ChatMessageListProps) {
  return (
    <div ref={listRef} className="chat-panel__message-list" onScroll={onScroll} aria-label="对话内容">
      {isLoading ? (
        <div className="chat-panel__message-state">
          <Spin size="large" />
          <div className="chat-panel__message-state-label"><span aria-hidden>💬</span> 正在加载群聊消息…</div>
        </div>
      ) : isError ? (
        <Empty description="消息加载失败" />
      ) : messages.length === 0 ? (
        <Empty description="还没有消息，来说点什么吧" />
      ) : (
        <div ref={contentRef} className="chat-panel__message-content">
          <div className="chat-panel__history-indicator">
            {isFetchingNextPage ? <Spin size="small" /> : hasNextPage ? (
              <Text type="secondary" style={{ fontSize: 12 }}>向上滚动加载更早消息</Text>
            ) : <Text type="secondary" style={{ fontSize: 12 }}>— 已加载全部历史消息 —</Text>}
          </div>
          {messages.map((message, index) => {
            const isSelf = message.senderType === 'USER' && message.senderId === userId
            const previous = messages[index - 1]
            const grouped = Boolean(previous && previous.senderType !== 'SYSTEM' && message.senderType !== 'SYSTEM' && previous.senderType === message.senderType && previous.senderId === message.senderId && previous.type !== 'TASK_STATUS' && message.type !== 'TASK_STATUS')
            const flashing = mentionFlashId === message.id
            return (
              <div key={message.id} id={`msg-${message.id}`} className={grouped ? 'chat-panel__message-row chat-panel__message-row--grouped' : 'chat-panel__message-row'} style={{ justifyContent: isSelf ? 'flex-end' : 'flex-start', background: flashing ? 'rgba(245, 158, 11, 0.18)' : undefined }}>
                {!isSelf && message.senderType !== 'SYSTEM' ? <Avatar size={32} src={resolveSenderAvatar(message)} style={{ flexShrink: 0, background: '#3b82f6', marginTop: 2 }}>{(message.senderName ?? '?').slice(0, 1)}</Avatar> : null}
                <div className="chat-panel__message-body">{renderMessage(message, isSelf)}</div>
                {isSelf ? <Avatar size={32} src={userAvatarUrl ?? undefined} style={{ flexShrink: 0, background: '#f97316', marginTop: 2 }}>{(userDisplayName ?? '我').slice(0, 1)}</Avatar> : null}
              </div>
            )
          })}
          {showMentionBar ? <button type="button" className="chat-panel__mention-jump" onClick={onMentionJump}><span aria-hidden>↑</span><span>有人@你{mentionCount > 1 ? ` · ${mentionCount} 条` : ''}</span></button> : null}
        </div>
      )}
    </div>
  )
}
