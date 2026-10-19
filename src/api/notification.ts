import { request } from './client'
import type { Notification } from '@/types'

/**
 * 通知中心 API —— 本轮由前端 Mock 实现（接口文档 §1：持久通知中心不在本轮范围）。
 * 路径为 A 自行约定的 mock 路径，后端落地后替换为真实接口。
 */
export const notificationApi = {
  /** 获取当前用户通知列表 */
  list() {
    return request<Notification[]>('/notifications')
  },
  /** 标记单条已读 */
  markRead(id: string) {
    return request<void>(`/notifications/${id}/read`, { method: 'POST' })
  },
  /** 全部已读 */
  markAllRead() {
    return request<void>('/notifications/read-all', { method: 'POST' })
  },
}
