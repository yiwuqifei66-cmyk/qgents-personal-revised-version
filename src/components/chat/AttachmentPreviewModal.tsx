import { useEffect, useState } from 'react'
import { Button, Empty, Modal, Spin, Typography } from 'antd'
import {
  FilePdfOutlined,
  FileTextOutlined,
  CodeOutlined,
  FileOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { attachmentApi, resolvePreviewUrl } from '@/api/attachment'
import { AuthedImage } from '@/components/AuthedImage'
import type { AttachmentPreview, AttachmentPreviewType } from '@/api/attachment'

const { Text } = Typography

/** 附件预览类型 → 图标 + 标签（增量契约 §2.1） */
export function attachmentTypeMeta(type: AttachmentPreviewType | undefined): {
  icon: React.ReactNode
  label: string
} {
  switch (type) {
    case 'IMAGE':
      return { icon: <FileOutlined />, label: '图片' }
    case 'PDF':
      return { icon: <FilePdfOutlined style={{ color: '#ef4444' }} />, label: 'PDF' }
    case 'CODE':
      return { icon: <CodeOutlined style={{ color: '#3b82f6' }} />, label: '代码' }
    case 'TEXT':
      return { icon: <FileTextOutlined style={{ color: '#64748b' }} />, label: '文本' }
    default:
      return { icon: <FileOutlined />, label: '文件' }
  }
}

interface AttachmentPreviewModalProps {
  open: boolean
  projectId: string
  /** 附件 ID（发送侧 §6 content.attachmentId，或旧消息从 url 解析） */
  attachmentId: string
  /** 展示用文件名（消息 content.name，可能缺失） */
  fileName?: string
  /** 消息里 §7 已回填的 previewUrl（相对路径）——有则零请求直接预览 */
  embeddedPreviewUrl?: string
  onClose: () => void
}

/**
 * 附件内联预览弹窗（增量契约 §4/§5/§7）。
 * - IMAGE：页内放大展示（AuthedImage 处理鉴权）
 * - PDF：iframe 内联预览（previewUrl 带短期 token，后端支持 Range 分页）
 * - TEXT/CODE：拉 ?raw=1 原文，页内 <pre> 展示（支持复制）
 * - UNSUPPORTED / 无 previewUrl：显示下载按钮（downloadUrl 优先）
 */
export function AttachmentPreviewModal({
  open,
  projectId,
  attachmentId,
  fileName,
  embeddedPreviewUrl,
  onClose,
}: AttachmentPreviewModalProps) {
  const [rawText, setRawText] = useState<string | null>(null)
  const [rawLoading, setRawLoading] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  // 优先用 §7 回填的 previewUrl；没有则调 §4 preview-url 签发（TanStack Query 缓存，同附件只签一次）
  const previewQuery = useQuery({
    queryKey: ['attachments', projectId, attachmentId, 'preview'],
    queryFn: () => attachmentApi.previewUrl(projectId, attachmentId),
    enabled: Boolean(open && projectId && attachmentId && !embeddedPreviewUrl),
    staleTime: 5 * 60 * 1000,
  })
  const preview: AttachmentPreview | null = previewQuery.data ?? null

  const previewUrl = embeddedPreviewUrl
    ? resolvePreviewUrl(embeddedPreviewUrl)
    : preview?.previewUrl
      ? resolvePreviewUrl(preview.previewUrl)
      : null
  const previewType = preview?.previewType
  const downloadUrl = preview?.downloadUrl ?? null
  const previewable = preview?.previewable ?? Boolean(embeddedPreviewUrl)

  useEffect(() => {
    setImageFailed(false)
  }, [previewUrl, open])

  // TEXT/CODE：拉 ?raw=1 原文在页内展示（契约 §5.1 / §8）
  useEffect(() => {
    if (!open || !previewUrl || (previewType !== 'TEXT' && previewType !== 'CODE')) {
      setRawText(null)
      return
    }
    let cancelled = false
    setRawLoading(true)
    const rawUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}raw=1`
    fetch(rawUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((text) => {
        if (!cancelled) setRawText(text)
      })
      .catch(() => {
        if (!cancelled) setRawText(null)
      })
      .finally(() => {
        if (!cancelled) setRawLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, previewUrl, previewType])

  const title = fileName ?? (preview?.fileName ?? '附件预览')
  const { icon } = attachmentTypeMeta(previewType)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={previewType === 'IMAGE' ? 720 : 860}
      destroyOnHidden
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {icon} {title}
        </span>
      }
    >
      {previewType === 'IMAGE' && previewUrl && !imageFailed ? (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          {/* previewUrl 带短期 token，直接 <img> 可加载（契约 §2.2 Query 通道） */}
          <AuthedImage
            src={previewUrl}
            alt={title}
            onError={() => setImageFailed(true)}
            fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect width='100%25' height='100%25' fill='%231c2128'/%3E%3C/svg%3E"
            style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8, objectFit: 'contain' }}
          />
        </div>
      ) : previewType === 'IMAGE' && imageFailed ? (
        <Empty description="图片加载失败，请重新打开预览或下载原文件">
          {downloadUrl ? <Button type="primary" icon={<DownloadOutlined />} href={downloadUrl} target="_blank" rel="noreferrer">下载文件</Button> : null}
        </Empty>
      ) : previewType === 'PDF' && previewUrl ? (
        <iframe
          src={previewUrl}
          title={title}
          style={{ width: '100%', height: '70vh', border: '1px solid #e5e7eb', borderRadius: 8 }}
        />
      ) : (previewType === 'TEXT' || previewType === 'CODE') && previewUrl ? (
        <div style={{ position: 'relative' }}>
          {rawLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : rawText != null ? (
            <pre
              style={{
                margin: 0,
                maxHeight: '65vh',
                overflow: 'auto',
                padding: 16,
                background: '#0f172a',
                color: '#e2e8f0',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {rawText}
            </pre>
          ) : (
            <Empty description="无法加载文本内容" />
          )}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            {rawText != null ? (
              <Button
                size="small"
                onClick={() => void navigator.clipboard?.writeText(rawText)}
              >
                复制内容
              </Button>
            ) : null}
          </div>
        </div>
      ) : previewQuery.isError ? (
        // 预览接口失败（后端未实现 / 报错）→ 明确提示加载失败，不要伪装成「不支持预览」
        <Empty description="预览信息加载失败">
          {downloadUrl ? (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
            >
              下载文件
            </Button>
          ) : null}
        </Empty>
      ) : previewUrl && previewable ? (
        // 已知类型但当前预览分支未覆盖（如 UNSUPPORTED 但给了 previewUrl）→ 新标签打开
        <Empty description="该文件类型不支持页内预览">
          {previewUrl ? (
            <Button type="primary" href={previewUrl} target="_blank" rel="noreferrer">
              打开预览
            </Button>
          ) : null}
        </Empty>
      ) : (
        <Empty description={previewQuery.isLoading ? '正在获取预览信息…' : '该文件不支持内联预览，请下载查看'}>
          {!previewQuery.isLoading && downloadUrl ? (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
            >
              下载文件
            </Button>
          ) : null}
        </Empty>
      )}
      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
        提示：预览链接含短期凭证，请勿分享链接；过期后关闭重开会重新签发
      </Text>
    </Modal>
  )
}
