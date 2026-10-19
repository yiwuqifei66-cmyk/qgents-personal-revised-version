import { memo, type ReactNode } from 'react'
import { Button, Spin, Typography, theme } from 'antd'
import { CodeOutlined, FileOutlined, FilePdfOutlined } from '@ant-design/icons'
import { attachmentApi } from '@/api'
import { resolvePreviewUrl } from '@/api/attachment'
import { AuthedImage } from '@/components/AuthedImage'
import { ChatDiffCard } from '@/components/chat/ChatDiffCard'
import { TaskStatusCard } from '@/components/chat/TaskStatusCard'
import { getApiBaseUrl } from '@/api/client'
import type { CodeMessageContent, FileMessageContent, ImageMessageContent, Message, QuoteMessageContent, TaskStatusMessageContent, TextMessageContent } from '@/types'

const { Text } = Typography

function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function normalizeContentUrl(url: string | undefined | null): string {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  return url.startsWith('/') ? `${getApiBaseUrl()}${url}` : url
}

function fileTypeMetaFromMime(mimeType: string | undefined): { icon: ReactNode; label: string } {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime === 'application/pdf') return { icon: <FilePdfOutlined style={{ color: '#ef4444' }} />, label: 'PDF·' }
  if (mime.startsWith('image/')) return { icon: <FileOutlined style={{ color: '#8b5cf6' }} />, label: '图片·' }
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime.includes('yaml') || mime.includes('shell')) return { icon: <CodeOutlined style={{ color: '#3b82f6' }} />, label: '代码·' }
  return { icon: <FileOutlined style={{ color: '#64748b' }} />, label: '' }
}
export const MessageBubble = memo(function MessageBubble({
  message,
  isSelf,
  selfDisplayName,
  projectId,
  onReply,
  onOpenFile,
  onImageLoad,
  taskStatusById,
}: {
  message: Message
  isSelf: boolean
  /** 自己的实时昵称（改昵称后即时更新；来自 ChatPanel 的 user.displayName） */
  selfDisplayName?: string
  projectId: string
  /** 点击「回复」时回调，用于设置回复引用（SYSTEM 消息不提供） */
  onReply?: (m: Message) => void
  /** 打开文件消息（FILE 类型走页内预览/下载，见 AttachmentPreviewModal） */
  onOpenFile?: (m: Message) => void
  /** 图片真正加载完成回调（透传给 AuthedImage，供 ChatPanel 保持贴底） */
  onImageLoad?: () => void
  taskStatusById: ReadonlyMap<string, string>
}) {
  const { token } = theme.useToken()

  // 临时防御（后端修复后可移除）：后端在「引用消息触发任务」链路可能错误插入一条
  // content 序列化的 TEXT 复制消息（形如 "@编排助手 {…quotedMessageId…}"），整条隐藏，
  // 避免在正常 QUOTE 消息旁再显示一串乱码。正常用户文本不会命中该特征。
  if (isMalformedQuoteCopy(message)) return null

  // SYSTEM 消息居中弱化展示
  if (message.senderType === 'SYSTEM') {
    const taskStatus = message.type === 'TASK_STATUS'
      ? taskStatusById.get((message.content as TaskStatusMessageContent).taskId)
      : undefined
    const content = renderContent(message, projectId, onOpenFile, onImageLoad, onReply, false, taskStatus)
    return message.type === 'TASK_STATUS' ? (
      <div style={{ textAlign: 'center' }}>{content}</div>
    ) : (
      <div style={{ textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{content}</Text>
      </div>
    )
  }

  const alignSelf = isSelf ? 'flex-end' : 'flex-start'
  const bubbleBg = isSelf ? token.colorPrimary : token.colorFillSecondary
  const bubbleColor = isSelf ? '#fff' : token.colorText
  const bubbleBorder = isSelf ? 'none' : `1px solid ${token.colorBorder}`
  const isCode = message.type === 'CODE'
  // 图片消息：气泡不设 padding/背景，直接展示图片本体
  const isImage = message.type === 'IMAGE'
  const taskStatus = message.type === 'TASK_STATUS'
    ? taskStatusById.get((message.content as TaskStatusMessageContent).taskId)
    : undefined

  return (
    <div
      className="chat-message-bubble"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: alignSelf,
        // fit-content：气泡宽度 = 内容自然宽度（长文本时铺满外层可用宽度，短文本贴内容）
        // maxWidth 100%：受外层内层 div 的 78% 约束，每行可容纳更多字
        width: 'fit-content',
        maxWidth: '100%',
        alignSelf,
        minWidth: 0,
      }}
    >
      {/* sender 行：不撑满宽度，跟随气泡边缘对齐；nowrap 防止昵称/时间换行。
          对方（气泡靠左）：昵称 时间 回复；己方（气泡靠右）：回复 时间 昵称（昵称贴气泡）
          回复按钮始终渲染占位，用 CSS :hover + visibility 控制显隐，避免按钮出现/消失引发布局抖动 */}
      <div
        style={{
          marginBottom: 2,
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {isSelf ? (
          <>
            {onReply && (
              <Button
                className="chat-message-bubble__reply"
                type="text"
                size="small"
                style={{ fontSize: 11, height: 'auto', padding: '0 4px', minWidth: 0 }}
                onClick={() => onReply(message)}
              >
                回复
              </Button>
            )}
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatClock(message.createdAt)}
            </Text>
            {/* 乐观发送中：显示转圈，后端确认后替换为真实消息 */}
            {message.pending ? <Spin size="small" /> : null}
            {/* 自己消息昵称：用实时 selfDisplayName（改昵称后即时更新），不用后端落库的旧 senderName */}
            <Text type="secondary">
              {message.senderType === 'AGENT' ? 'Agent' : (selfDisplayName ?? message.senderName ?? '我')}
            </Text>
          </>
        ) : (
          <>
            <Text type="secondary">
              {message.senderType === 'AGENT' ? '🤖 ' : ''}
              {message.senderName ?? (message.senderType === 'AGENT' ? 'Agent' : '成员')}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatClock(message.createdAt)}
            </Text>
            {onReply && (
              <Button
                className="chat-message-bubble__reply"
                type="text"
                size="small"
                style={{ fontSize: 11, height: 'auto', padding: '0 4px', minWidth: 0 }}
                onClick={() => onReply(message)}
              >
                回复
              </Button>
            )}
          </>
        )}
      </div>
      <div
        style={{
          padding: isImage ? 0 : '8px 12px',
          borderRadius: 10,
          background: isImage ? 'transparent' : isCode ? (isSelf ? token.colorPrimary : '#1e293b') : bubbleBg,
          color: isCode && !isSelf ? '#e6edf3' : bubbleColor,
          border: isImage ? 'none' : isCode ? 'none' : bubbleBorder,
          whiteSpace: isCode ? 'pre-wrap' : 'normal',
          // 普通文本：overflowWrap 只在内容溢出容器时才断行，wordBreak normal 不拆中文短词，
          // 保证「你好」「收到」等短文本保持一行；超长英文串溢出时可断开，不会撑破聊天区域。
          // CODE 消息保留断行能力（wordBreak break-word），超长代码行可断开。
          overflowWrap: 'break-word',
          wordBreak: isCode ? 'break-word' : 'normal',
          minWidth: 0,
          maxWidth: '100%',
          fontFamily: isCode ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          fontSize: isCode ? 13 : undefined,
          overflow: 'hidden',
        }}
      >
        {renderContent(message, projectId, onOpenFile, onImageLoad, onReply, isSelf, taskStatus)}
      </div>
      {/* QUOTE 引用消息：被引用的原消息挂载在气泡下方（带竖线），类似微信「当前消息 + 引用原消息」 */}
      {message.type === 'QUOTE' ? (
        <QuoteAttachment message={message} />
      ) : null}
    </div>
  )
})

/**
 * QUOTE 消息 content 解析：后端可能回传对象，也可能是 JSON 字符串（历史/联调兼容），
 * 统一转成 QuoteMessageContent；解析失败返回 null。
 */
function parseQuoteContent(message: Message): QuoteMessageContent | null {
  const raw = message.content
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as QuoteMessageContent
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as QuoteMessageContent
  }
  return null
}

/**
 * 判定「后端错误插入的引用复制消息」：type=TEXT 且文本形如
 * "@某Agent {…含 quotedMessageId 的引用协议 JSON…}"（后端在引用消息触发任务时
 * 把存储后的 QUOTE content 序列化成文本插入，sender 伪装成原用户）。
 * 前端整条隐藏，避免与正常 QUOTE 消息重复显示乱码；后端修复后此特征自然消失。
 */
function isMalformedQuoteCopy(message: Message): boolean {
  if (message.type !== 'TEXT') return false
  const content = message.content as TextMessageContent | null
  const text = typeof content?.text === 'string' ? content.text : ''
  if (!text) return false
  return /^@\S+\s*\{[\s\S]*"quotedMessageId"[\s\S]*\}/.test(text)
}

/** 引用消息的「原消息」挂载条：气泡下方、左侧灰色竖线、灰色小字 */
function QuoteAttachment({ message }: { message: Message }) {
  const content = parseQuoteContent(message)
  if (!content?.quotedText) return null
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        marginTop: 4,
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <div style={{ width: 3, borderRadius: 2, background: '#94a3b8', flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        {content.quotedSenderName ? (
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            {content.quotedSenderName}
          </Text>
        ) : null}
        <div style={{ fontSize: 12, color: '#94a3b8', overflowWrap: 'break-word' }}>{content.quotedText}</div>
      </div>
    </div>
  )
}

/** 按消息类型渲染 content */
function renderContent(
  message: Message,
  projectId: string,
  onOpenFile?: (m: Message) => void,
  onImageLoad?: () => void,
  onReply?: (m: Message) => void,
  isSelf = false,
  taskStatus?: string,
): React.ReactNode {
  switch (message.type) {
    case 'CODE': {
      const c = message.content as CodeMessageContent
      return c.code ?? ''
    }
    case 'IMAGE': {
      const c = message.content as ImageMessageContent
      // 增量契约 §7：content.previewUrl 若由后端回填（带短期 token），直接用；
      // 否则走 §18.5 content 代理（带 Bearer 拉取）。地址优先用 attachmentId 重建，
      // 与存储的 content.url 前缀无关——历史消息 url 可能是 /api/... 或 /projects/...，
      // 直接 normalizeContentUrl 会把已带 /api 的地址拼成 /api/api/... 双前缀 404。
      // 缺 attachmentId 的旧消息才回退 normalizeContentUrl(c.url)。
      const previewUrl = typeof c.previewUrl === 'string' && c.previewUrl ? resolvePreviewUrl(c.previewUrl) : null
      const contentUrl = c.attachmentId
        ? attachmentApi.contentUrl(projectId, c.attachmentId)
        : normalizeContentUrl(c.url)
      const image = (
        <AuthedImage
          src={previewUrl ?? contentUrl}
          width={c.width ?? 260}
          height={c.height}
          style={{ borderRadius: 10, display: 'block', maxWidth: '100%' }}
          fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect width='100%25' height='100%25' fill='%231c2128'/%3E%3C/svg%3E"
          onLoad={onImageLoad}
        />
      )
      // 图片查看走 antd <Image> 内置全屏预览（AuthedImage 默认开启），不再套自定义 AttachmentPreviewModal
      return image
    }
    case 'FILE': {
      const c = message.content as FileMessageContent
      // §7：previewable=true 时提示可内联预览（点击走 previewUrl 打开）
      const previewable = c.previewable === true || Boolean(c.previewUrl)
      // 按 mimeType 粗判文件类型显示图标（§2.1；弹窗内会再按 previewType 精确处理）
      const fileMeta = fileTypeMetaFromMime(c.mimeType)
      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onOpenFile?.(message)
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 24, display: 'inline-flex' }}>{fileMeta.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{c.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatFileSize(c.size)}
              {previewable ? ` · ${fileMeta.label}点击预览` : ''}
            </Text>
          </div>
        </a>
      )
    }
    case 'QUOTE': {
      // 气泡内只显示回复正文；被引用的原消息由 MessageBubble 挂载在气泡下方（带竖线）。
      // §7 冻结：replyText 回显在顶层；content.replyText 兼容旧数据
      const c = parseQuoteContent(message)
      return message.replyText || c?.replyText || ''
    }
    case 'DIFF': {
      // 群聊内 Diff 卡片：固定高度可展开的「文件树 + 行级 diff 视图」；
      // 「查看 Diff」跳转代码提交 diff 详情 /app/projects/:projectId/code/diff/:diffId
      return <ChatDiffCard message={message} projectId={projectId} onReply={onReply} />
    }
    case 'TASK_STATUS': {
      const c = message.content as TaskStatusMessageContent
      return <TaskStatusCard content={c} queriedStatus={taskStatus} projectId={projectId} />
    }
    default: {
      const c = message.content as TextMessageContent
      return renderTextWithAtMentions(c.text ?? '', isSelf)
    }
  }
}

/**
 * TEXT/QUOTE 文本渲染：把形如 {@code @名字} 的 @ 提及高亮显示（编排助手回群的
 * 「@发起者 您创建的任务已开始」提示与用户手动 @ 均受益），其余文本原样输出。
 */
function renderTextWithAtMentions(text: string, isSelf: boolean): ReactNode {
  if (!text) return ''
  const parts = text.split(/(@[^\s@，。；：！？,.!?]+)/g)
  if (parts.length <= 1) return text
  return parts.map((part, index) =>
    part.startsWith('@') ? (
      <span
        key={index}
        style={{
          color: isSelf ? '#fef08a' : '#1677ff',
          background: isSelf ? 'rgba(255, 255, 255, 0.14)' : 'rgba(22, 119, 255, 0.1)',
          borderRadius: 3,
          fontWeight: 700,
          padding: '0 2px',
        }}
      >
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/** 文件大小格式化（字节 → 可读） */
function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}


