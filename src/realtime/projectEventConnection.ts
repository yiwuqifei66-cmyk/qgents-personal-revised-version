import { EventStreamContentType, type EventSourceMessage } from '@microsoft/fetch-event-source'
import { connectProjectEvents } from '@/api/projectEvents'
import { refreshAccessToken } from '@/api/client'
import { parseProjectTaskEvent, type ProjectTaskEvent } from './eventParser'
import { browserEventCursorStore, type EventCursorStore } from './eventCursor'

export type ProjectEventConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

export class EventCursorExpiredError extends Error {
  constructor() {
    super('Project event cursor expired')
    this.name = 'EventCursorExpiredError'
  }
}

class TerminalEventStreamError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Project event stream failed: ${status}`)
    this.name = 'TerminalEventStreamError'
    this.status = status
  }
}

export interface ProjectEventConnectionOptions {
  cursorStore?: EventCursorStore
  retryDelaysMs?: readonly number[]
  connect?: typeof connectProjectEvents
  onEvent: (event: ProjectTaskEvent) => void
  onCursorExpired: () => void
  onStatusChange?: (status: ProjectEventConnectionStatus) => void
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const

async function eventErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json()
    if (typeof body !== 'object' || body === null) return null
    const record = body as Record<string, unknown>
    const error = record.error
    if (typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).code === 'string') {
      return (error as Record<string, unknown>).code as string
    }
    return typeof record.code === 'string' ? record.code : null
  } catch {
    return null
  }
}

export class ProjectEventConnection {
  private readonly projectId: string
  private readonly cursorStore: EventCursorStore
  private readonly retryDelaysMs: readonly number[]
  private readonly connect: typeof connectProjectEvents
  private readonly onEvent: (event: ProjectTaskEvent) => void
  private readonly onCursorExpired: () => void
  private readonly onStatusChange?: (status: ProjectEventConnectionStatus) => void
  private readonly seenEventIds = new Set<string>()
  private abortController: AbortController | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private running = false
  private status: ProjectEventConnectionStatus = 'idle'

  constructor(projectId: string, options: ProjectEventConnectionOptions) {
    this.projectId = projectId
    this.cursorStore = options.cursorStore ?? browserEventCursorStore
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
    this.connect = options.connect ?? connectProjectEvents
    this.onEvent = options.onEvent
    this.onCursorExpired = options.onCursorExpired
    this.onStatusChange = options.onStatusChange
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.connectNow()
  }

  stop(): void {
    this.running = false
    this.clearRetryTimer()
    this.abortController?.abort()
    this.abortController = null
    this.setStatus('idle')
  }

  private connectNow(): void {
    if (!this.running || this.abortController) return
    this.setStatus('connecting')
    const controller = new AbortController()
    this.abortController = controller
    const lastEventId = this.cursorStore.get(this.projectId) ?? undefined

    void this.connect({
      projectId: this.projectId,
      lastEventId,
      signal: controller.signal,
      onopen: async (response) => {
        if (!response.ok) {
          const code = response.status === 409 ? await eventErrorCode(response) : null
          if (response.status === 409 && code === 'EVENT_CURSOR_EXPIRED') throw new EventCursorExpiredError()
          if (response.status === 401) {
            // token 过期：刷新后走 onerror 普通重连（下次 connect 重读新 token）；刷新失败才停止
            const newToken = await refreshAccessToken()
            if (newToken) throw new Error('SSE token refreshed')
            throw new TerminalEventStreamError(401)
          }
          if (response.status === 403 || response.status === 409) throw new TerminalEventStreamError(response.status)
          throw new Error(`Project event stream failed: ${response.status}`)
        }
        const contentType = response.headers.get('content-type')
        if (!contentType?.startsWith(EventStreamContentType)) {
          throw new Error(`Expected content-type to be ${EventStreamContentType}`)
        }
        this.retryAttempt = 0
        this.setStatus('connected')
      },
      onmessage: (message) => this.handleMessage(message),
      onclose: () => {
        this.abortController = null
        if (this.running) {
          this.setStatus('disconnected')
          this.scheduleReconnect()
        }
      },
      onerror: (error: unknown) => {
        if (error instanceof EventCursorExpiredError) {
          this.cursorStore.clear(this.projectId)
          this.seenEventIds.clear()
          this.retryAttempt = 0
          this.onCursorExpired()
          throw error
        }
        if (error instanceof TerminalEventStreamError) {
          this.running = false
          this.setStatus('disconnected')
          throw error
        }
        // 其余错误（含 401 后 token 刷新成功的「普通错误」）也必须抛错让 fetchEventSource reject，
        // 交给外层 scheduleReconnect 重新 connectNow()（重新读最新 token）。
        // 若返回数字，fetchEventSource 会复用闭包内旧 headers 内部重连，token 永不更新 → 401 死循环。
        if (this.running) this.setStatus('disconnected')
        throw error
      },
    }).catch(() => {
      if (this.running) {
        this.abortController = null
        this.setStatus('disconnected')
        this.scheduleReconnect()
      }
    })
  }

  private handleMessage(message: EventSourceMessage): void {
    const eventId = message.id.trim()
    if (eventId) {
      if (this.seenEventIds.has(eventId) || this.cursorStore.get(this.projectId) === eventId) return
      this.seenEventIds.add(eventId)
      if (this.seenEventIds.size > 1000) {
        const oldest = this.seenEventIds.values().next().value
        if (oldest) this.seenEventIds.delete(oldest)
      }
      this.cursorStore.set(this.projectId, eventId)
    }
    const event = parseProjectTaskEvent(message)
    if (event) this.onEvent(event)
  }

  private scheduleReconnect(): void {
    if (!this.running || this.retryTimer) return
    const delay = this.nextRetryDelay()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connectNow()
    }, delay)
  }

  private nextRetryDelay(): number {
    const index = Math.min(this.retryAttempt, this.retryDelaysMs.length - 1)
    const base = this.retryDelaysMs[index] ?? 1000
    this.retryAttempt += 1
    // 加 ±20% jitter：后端重启或多用户同时断线时，避免按同一时间表重连形成尖峰
    const jitter = base * 0.2 * (Math.random() * 2 - 1)
    return Math.max(0, Math.round(base + jitter))
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private setStatus(status: ProjectEventConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.onStatusChange?.(status)
  }
}
