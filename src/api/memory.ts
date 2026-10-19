import { request } from './client'
import type { CreateMemoryPayload, GenerateMemoryDraftPayload, Memory } from '@/types'

/**
 * 共享 Memory API —— 对齐接口文档 v1.1.8 §9
 */
export const memoryApi = {
  /** 查询 Memory（默认仅 APPROVED，前端按需传状态过滤） */
  list(projectId: string) {
    return request<Memory[]>(`/projects/${projectId}/memories`)
  },
  /** 手动创建草稿 */
  create(projectId: string, payload: CreateMemoryPayload) {
    return request<Memory>(`/projects/${projectId}/memories`, {
      method: 'POST',
      body: payload,
    })
  },
  /** 依据当前群的最近聊天自动生成 AI 草稿（后端自动检索，客户端不再勾选消息） */
  generateDraft(projectId: string, payload: GenerateMemoryDraftPayload) {
    return request<Memory>(`/projects/${projectId}/memories/drafts`, {
      method: 'POST',
      body: payload,
    })
  },
  /** 获取 / 编辑草稿或审核中内容 */
  getById(projectId: string, memoryId: string) {
    return request<Memory>(`/projects/${projectId}/memories/${memoryId}`)
  },
  patch(projectId: string, memoryId: string, payload: Partial<CreateMemoryPayload>) {
    return request<Memory>(`/projects/${projectId}/memories/${memoryId}`, {
      method: 'PATCH',
      body: payload,
    })
  },
  /** 提交审核 */
  submitReview(projectId: string, memoryId: string) {
    return request<Memory>(`/projects/${projectId}/memories/${memoryId}/submit-review`, {
      method: 'POST',
    })
  },
  /** 批准并发布（Project Admin） */
  approve(projectId: string, memoryId: string) {
    return request<Memory>(`/projects/${projectId}/memories/${memoryId}/approve`, {
      method: 'POST',
    })
  },
  /** 拒绝（Project Admin） */
  reject(projectId: string, memoryId: string, reason: string) {
    return request<Memory>(`/projects/${projectId}/memories/${memoryId}/reject`, {
      method: 'POST',
      body: { reason },
    })
  },
  /** 归档（Project Admin） */
  archive(projectId: string, memoryId: string) {
    return request<Memory>(`/projects/${projectId}/memories/${memoryId}/archive`, {
      method: 'POST',
    })
  },
}
