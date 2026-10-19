import { useEffect, useState, type ComponentProps } from 'react'
import { Image } from 'antd'
import { getStoredToken } from '@/api/client'

type AntImageProps = ComponentProps<typeof Image>

interface AuthedImageProps extends Omit<AntImageProps, 'src'> {
  /** 鉴权下载地址（§18.5 /attachments/{id}/content，需要 Bearer token） */
  src?: string | null
  /** 图片真正加载完成回调（objectURL 就绪、<Image> 渲染出图后触发），与 fetch 完成不同步 */
  onLoad?: () => void
}

/**
 * 带鉴权的图片加载 —— 解决「鉴权下载接口需要 Authorization 头，但 <img> 标签带不了」的矛盾。
 *
 * 用 fetch 带 token 拉取图片为 Blob，转 objectURL 喂给 <img>，规避浏览器对 <img> 请求
 * 不携带 Authorization 头的问题。加载中 / 失败时回退到 fallback。
 */
export function AuthedImage({ src, fallback, onLoad, ...rest }: AuthedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!src) {
      setObjectUrl(null)
      return
    }

    let url: string | null = null
    let cancelled = false
    const controller = new AbortController()
    const token = getStoredToken()

    fetch(src, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null)
      })

    return () => {
      cancelled = true
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])

  // 加载中 / 失败时显示 fallback（与原 Image.fallback 语义一致，且更早生效）
  // onLoad 绑定到 <Image>：objectURL 就绪、图片真正解码渲染后触发（≠ fetch 完成）
  // 保留 antd 内置全屏预览：聊天图片点击直接用 antd 预览放大，不走自定义 AttachmentPreviewModal
  return <Image src={objectUrl ?? fallback} onLoad={onLoad} {...rest} />
}
