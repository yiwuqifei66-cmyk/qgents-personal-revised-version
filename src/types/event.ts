/**
 * WebSocket 实时通道帧 —— /api/v1/ws/realtime（单连接 + 用户级聚合流）
 *
 * 核心模型不变：REST 是真相。帧只作「刷新界面」信号，收到后重查对应 REST 接口校准。
 * 业务事件语义与 SSE 完全一致（type 对应 SSE eventType），仅多了 scope 信封。
 */

/** 帧 scope：事件归属域（§三） */
export type RealtimeScope = 'project' | 'team' | 'notification'

/** 服务端 → 客户端业务事件帧 */
export interface RealtimeFrame {
  /** 事件类型，对应 SSE eventType（message.created / task.updated / notification.created …） */
  type: string
  scope: RealtimeScope
  /** scope=project 时非空 */
  projectId?: string | null
  /** 关联需求群（可为 null） */
  groupId?: string | null
  /** scope=team 时非空 */
  teamId?: string | null
  /** scope=notification 时非空 */
  recipientUserId?: string | null
  /** 关联资源 id 字符串（可为 null） */
  resourceId?: string | null
  /** 与 SSE data 同源脱敏，不含 Token/私钥/宿主机路径 */
  payload: Record<string, unknown>
  sentAt?: string
}

/** 握手确认帧：{"type":"hello","userId":"<登录用户id>"}，收到后连接才算可用 */
export interface RealtimeHelloFrame {
  type: 'hello'
  userId?: string
}
