import type { ReactNode } from 'react'
import { Button, Input, Typography, Upload } from 'antd'
import { CloseOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import './ChatPanel.css'

const { Text } = Typography

export interface ChatComposerProps {
  draft: string
  sending: boolean
  uploading: boolean
  sendError: string | null
  replyLabel: string
  replyPreview: string
  replyWarning?: string
  replyTo?: unknown
  mentionPanel?: ReactNode
  inputRef: React.RefObject<TextAreaRef | null>
  onDraftChange: (value: string) => void
  onSend: () => void
  onUpload: NonNullable<UploadProps['beforeUpload']>
  onCancelReply: () => void
}

/** 聊天输入区：处理输入、附件、提及候选和回复引用的展示。 */
export function ChatComposer({
  draft,
  sending,
  uploading,
  sendError,
  replyLabel,
  replyPreview,
  replyWarning,
  replyTo,
  mentionPanel,
  inputRef,
  onDraftChange,
  onSend,
  onUpload,
  onCancelReply,
}: ChatComposerProps) {
  return (
    <div className="chat-panel__composer">
      {mentionPanel}
      {replyTo ? <div className="chat-panel__reply-preview">
        <div className="chat-panel__reply-preview-content">
          <Text type="secondary" style={{ fontSize: 12 }}>{replyLabel}：</Text>
          <Text ellipsis style={{ fontSize: 12 }}>{replyPreview}</Text>
          {replyWarning ? <Text type="warning" style={{ fontSize: 12, display: 'block' }}>{replyWarning}</Text> : null}
        </div>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onCancelReply} aria-label="取消回复" />
      </div> : null}
      {sendError ? <Text type="danger" style={{ display: 'block', marginBottom: 8 }}>{sendError}</Text> : null}
      <div className="chat-panel__composer-row">
        <Upload showUploadList={false} multiple={false} beforeUpload={onUpload}>
          <Button className="chat-panel__composer-tool" icon={<PaperClipOutlined />} loading={uploading} aria-label="发送文件" />
        </Upload>
        <Input.TextArea
          ref={inputRef}
          placeholder="输入消息，@ 可提及成员或 Agent，回车发送…"
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          disabled={sending}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          className="chat-panel__composer-input"
        />
        <Button className="chat-panel__composer-send" type="primary" icon={<SendOutlined />} onClick={onSend} loading={sending} disabled={sending || (!draft.trim() && !replyTo)}>
          发送
        </Button>
      </div>
    </div>
  )
}
