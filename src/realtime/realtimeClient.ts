import { useSyncExternalStore } from 'react'
import { getApiBaseUrl, getStoredToken, refreshAccessToken } from '@/api/client'
import { projectEventsEnabled } from '@/api/projectEvents'
import { queryClient } from '@/query'
import { invalidateProjectTaskEvent } from './queryInvalidation'
import { PROJECT_TASK_EVENT_TYPES, type ProjectTaskEventType } from './eventParser'
import type { RealtimeFrame } from '@/types'

/**
 * WebSocket 实时通道（/api/v1/ws/realtime）—— 单连接 + 用户级聚合流。
 *
 * - 每个账号只开一条连接；SSE 三端点保留兼容，未移除。
 * - 鉴权：握手 ?token=<accessToken>（浏览器 WS 升级无法带 Authorization 头）。
 * - 连接可用判定：收到 hello 帧（{"type":"hello","userId":...}）。
 * - 断线自动重连（指数退避）；握手阶段失败（token 过期）先 refresh token 再重连。
 * - 核心模型不变：REST 是真相。帧只作刷新信号 → dispatchRealtimeFrame 走
 *   与 SSE 同源的 queryInvalidation，收到后重查 REST 校准。
 */

export const REALTIME_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const
export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

let connectionStatus: RealtimeConnectionStatus = 'idle'
const connectionStatusListeners = new Set<() => void>()

function setConnectionStatus(status: RealtimeConnectionStatus): void {
  if (connectionStatus === status) return
  connectionStatus = status
  for (const listener of connectionStatusListeners) listener()
}

function subscribeConnectionStatus(listener: () => void): () => void {
  connectionStatusListeners.add(listener)
  return () => connectionStatusListeners.delete(listener)
}

/**
 * 全局实时通道状态。WebSocket 已收到 hello 后，页面可关闭重复的 SSE；
 * 断线时再由 SSE 接管，避免长期连接挤占普通 API 请求的浏览器连接槽。
 */
export function useRealtimeConnectionStatus(): RealtimeConnectionStatus {
  return useSyncExternalStore(
    subscribeConnectionStatus,
    () => connectionStatus,
    () => 'idle',
  )
}

/** 拼接 WS 地址：BASE_URL 为绝对 http(s) 时转 ws(s)；为相对路径（/api）时拼当前 origin */
export function realtimeWsUrl(token: string): string {
  const base = getApiBaseUrl()
  const wsBase = base.startsWith('http')
    ? base.replace(/^http/i, 'ws')
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}`
  return `${wsBase}/ws/realtime?token=${encodeURIComponent(token)}`
}

function isRealtimeFrame(value: unknown): value is RealtimeFrame {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.type === 'string' &&
    (record.scope === 'project' || record.scope === 'team' || record.scope === 'notification') &&
    typeof record.payload === 'object' &&
    record.payload !== null
  )
}

function isProjectTaskEventType(type: string): type is ProjectTaskEventType {
  return (PROJECT_TASK_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * 帧 → 查询失效（与 SSE queryInvalidation 同源）。
 * - scope=project：复用项目事件映射（message.created 额外校准主群聚合，覆盖不挂 SSE 的群聊工作台）
 * - scope=team：刷新团队相关列表
 * - scope=notification：刷新通知中心 + 铃铛
 */
export function dispatchRealtimeFrame(frame: RealtimeFrame): void {
  const { type, scope } = frame
  if (scope === 'notification') {
    // 帧 type 即通知 kind（PROJECT_ADDED/MR_PENDING/…），不按类型过滤：收到即刷新通知中心与铃铛
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    return
  }
  if (scope === 'team') {
    void queryClient.invalidateQueries({ queryKey: ['teams', 'mine'] })
    const teamId = typeof frame.teamId === 'string' && frame.teamId ? frame.teamId : null
    if (teamId) {
      void queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'projects'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'activities'] })
    }
    return
  }
  // scope === 'project'
  const projectId = typeof frame.projectId === 'string' && frame.projectId ? frame.projectId : null
  if (!projectId) return
  if (type === 'message.created') {
    void queryClient.invalidateQueries({ queryKey: ['chat', 'main-groups'] })
  }
  if (isProjectTaskEventType(type)) {
    invalidateProjectTaskEvent(projectId, { id: null, type, payload: { ...frame.payload, projectId } })
  }
}

export class RealtimeClient {
  private ws: WebSocket | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private running = false
  /** 当前这次连接是否成功 open 过（区分「握手失败」与「已连上后断线」） */
  private everOpened = false
  private reconnectListeners = new Set<() => void>()

  start(): void {
    if (this.running) return
    this.running = true
    this.connectNow()
  }

  stop(): void {
    this.running = false
    this.clearRetryTimer()
    this.closeSocket()
    setConnectionStatus('idle')
  }

  /** 断线重连成功后回调（用于重查当前范围关键列表，REST 兜底） */
  addReconnectListener(listener: () => void): () => void {
    this.reconnectListeners.add(listener)
    return () => this.reconnectListeners.delete(listener)
  }

  /** 默认断线恢复：整页级重查关键列表（§六.6，不依赖 WS 续传） */
  private handleReconnected(): void {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['teams', 'mine'] })
    void queryClient.invalidateQueries({ queryKey: ['chat', 'main-groups'] })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qgents:realtime-reconnected'))
    }
    for (const listener of this.reconnectListeners) listener()
  }

  private closeSocket(): void {
    if (!this.ws) return
    const ws = this.ws
    this.ws = null
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    try {
      ws.close()
    } catch {
      // 已关闭的连接忽略
    }
  }

  private connectNow(): void {
    if (!this.running || this.ws) return
    const token = getStoredToken()
    if (!token) {
      setConnectionStatus('disconnected')
      return
    }

    this.everOpened = false
    setConnectionStatus('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(realtimeWsUrl(token))
    } catch {
      setConnectionStatus('disconnected')
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.everOpened = true
      // 连接是否可用以 hello 帧为准
    }
    ws.onmessage = (event) => this.handleMessage(event)
    ws.onerror = () => {
      // 握手失败（HTTP 401 拒绝升级）或传输错误：由 onclose 统一处理重连
    }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      if (!this.running) return
      setConnectionStatus('disconnected')
      if (this.everOpened) {
        // 已建立过连接后断线：直接用当前 token 重连
        this.scheduleReconnect()
      } else {
        // 握手阶段失败（token 缺失/过期）：先尽力刷新 token（写回 localStorage），再重连
        void refreshAccessToken().finally(() => this.scheduleReconnect())
      }
    }
  }

  private handleMessage(event: MessageEvent): void {
    let raw: unknown
    try {
      raw = JSON.parse(String(event.data))
    } catch {
      return // 非 JSON 文本帧（心跳等控制帧）忽略
    }
    if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).type === 'hello') {
      const wasReconnecting = this.retryAttempt > 0
      this.retryAttempt = 0
      setConnectionStatus('connected')
      if (wasReconnecting) this.handleReconnected()
      return
    }
    if (isRealtimeFrame(raw)) {
      dispatchRealtimeFrame(raw)
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.retryTimer) return
    const index = Math.min(this.retryAttempt, REALTIME_RETRY_DELAYS_MS.length - 1)
    const delay = REALTIME_RETRY_DELAYS_MS[index] ?? 1000
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connectNow()
    }, delay)
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}

let sharedClient: RealtimeClient | null = null
let refCount = 0
/** subscribeRealtimeReconnect 在 sharedClient 创建前注册的待挂监听（子组件 effect 先于父组件执行） */
let pendingReconnectListeners = new Set<() => void>()

/**
 * 订阅全局实时通道（每账号一条连接）。返回取消订阅函数。
 * mock 模式（VITE_USE_MOCK=true）下无 WS 端点，直接跳过。
 */
export function subscribeRealtime(): () => void {
  if (!projectEventsEnabled()) return () => {}
  sharedClient ??= new RealtimeClient()
  // 连接就绪后补挂之前排队等待的重连监听
  if (pendingReconnectListeners.size > 0) {
    for (const listener of pendingReconnectListeners) {
      sharedClient.addReconnectListener(listener)
    }
    pendingReconnectListeners.clear()
  }
  refCount += 1
  sharedClient.start()
  return () => {
    refCount -= 1
    if (refCount <= 0 && sharedClient) {
      sharedClient.stop()
      sharedClient = null
    }
  }
}

/**
 * 订阅全局实时通道的「断线重连成功」回调（可靠消息同步 §1/§2）。
 * 与 subscribeRealtime 共用同一条连接，不重复建连；返回退订函数。
 * 连接由 MainLayout 的 subscribeRealtime 持有 refCount，本函数只挂监听。
 * 子组件 effect 先于父组件执行：若连接尚未创建，先排队等 subscribeRealtime 创建后补挂。
 * 典型用途：断线重连后对当前群消息做增量补齐（reconcileMessages），比整页重拉更精准。
 */
export function subscribeRealtimeReconnect(listener: () => void): () => void {
  if (!projectEventsEnabled()) return () => {}
  if (!sharedClient) {
    pendingReconnectListeners.add(listener)
    return () => {
      pendingReconnectListeners.delete(listener)
    }
  }
  return sharedClient.addReconnectListener(listener)
}
