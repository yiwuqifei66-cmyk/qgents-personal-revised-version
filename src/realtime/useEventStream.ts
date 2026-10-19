import { useEffect, useRef } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getApiBaseUrl, getStoredToken, refreshAccessToken } from '@/api/client'

const CURSOR_PREFIX = 'qgents.events.cursor.'
const RETRY_DELAY_MS = 5000

/** 401 后 refresh token 也失效 —— 彻底停止重连（等普通接口派发 AUTH_EXPIRED 踢回登录页） */
const AUTH_EXPIRED = 'qgents:sse:auth-expired'
/** 401 后 refresh token 成功 —— 需重连（下次 connect 会读到新 access token） */
const AUTH_REFRESHED = 'qgents:sse:token-refreshed'

/**
 * 通用 SSE 连接 hook —— 团队级 / 通知级事件流复用。
 *
 * 与 B 的项目级 ProjectEventConnection 同源（fetchEventSource + Last-Event-ID 续传），
 * 但简化：不做事件去重，收到事件后由 onEvent 直接 invalidate 对应 query。
 * 事件仅用于刷新界面，恢复连接后以查询接口为准（接口文档 §12.1）。
 *
 * 401 自愈：access token 过期时，先尝试用 refresh token 换新 token 再重连；
 * refresh 也失效则停止重连，避免 401 死循环刷屏。
 *
 * 关键点：fetchEventSource 内部会用闭包固定的 headers 自动重连（默认 1000ms），
 * 一旦 token 过期，它永远拿旧 token 重连。因此必须让 onerror 抛错使 Promise reject，
 * 由外层 catch 重新 connect()（每次重新 getStoredToken() 读最新 token）。
 */
export function useEventStream(
  streamKey: string,
  path: string,
  onEvent: (eventType: string, data: Record<string, unknown>) => void,
): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!streamKey || !path) return
    const url = `${getApiBaseUrl()}${path}`
    const cursorKey = `${CURSOR_PREFIX}${streamKey}`

    let stopped = false
    let currentController: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const readCursor = (): string | null => {
      try {
        return localStorage.getItem(cursorKey)
      } catch {
        return null
      }
    }
    const writeCursor = (id: string): void => {
      try {
        localStorage.setItem(cursorKey, id)
      } catch {
        // 存储不可用时静默降级
      }
    }

    function scheduleReconnect(): void {
      if (stopped || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        void connect()
      }, RETRY_DELAY_MS)
    }

    async function connect(): Promise<void> {
      if (stopped) return
      currentController = new AbortController()
      const lastEventId = readCursor()
      // 每次连接都重新读取最新 token（普通接口 401 时会刷新 access token 写回 localStorage）
      const token = getStoredToken()
      try {
        await fetchEventSource(url, {
          signal: currentController.signal,
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
          },
          openWhenHidden: true,
          async onopen(response) {
            if (response.ok) return
            if (response.status === 401) {
              // token 过期：刷新（成功写回 localStorage）；用错误消息区分「重连」与「停止」
              const newToken = await refreshAccessToken()
              throw new Error(newToken ? AUTH_REFRESHED : AUTH_EXPIRED)
            }
            throw new Error(`SSE_HTTP_${response.status}`)
          },
          onerror(err) {
            // 抛错使 fetchEventSource reject，交给外层 catch 重新 connect()（重新读 token）。
            // 若返回数字，fetchEventSource 会复用闭包内旧 headers 内部重连，token 永不更新。
            throw err
          },
          onmessage(msg) {
            const id = msg.id.trim()
            if (id) writeCursor(id)
            const data = msg.data.trim()
            if (!data) return
            try {
              onEventRef.current(msg.event.trim(), JSON.parse(data) as Record<string, unknown>)
            } catch {
              // 无法解析的事件忽略，不打断连接
            }
          },
          onclose() {
            currentController = null
            scheduleReconnect()
          },
        })
      } catch (err) {
        currentController = null
        // refresh token 也失效 → 停止重连（避免刷屏；登录页跳转后组件卸载）
        if (err instanceof Error && err.message === AUTH_EXPIRED) return
        scheduleReconnect()
      }
    }

    void connect()
    return () => {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      currentController?.abort()
    }
  }, [streamKey, path])
}
