import { useEffect } from 'react'
import { subscribeRealtime } from './realtimeClient'

/**
 * 挂载全局 WebSocket 实时通道（单连接 + 用户级聚合流）。
 * MainLayout 挂载一次即可；SSE 三端点保留兼容，未移除。
 */
export function useRealtimeEvents(): void {
  useEffect(() => subscribeRealtime(), [])
}
