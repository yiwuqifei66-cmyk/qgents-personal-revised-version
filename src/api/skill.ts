import { request } from './client'
import type { CreateSkillPayload, Skill } from '@/types'

/**
 * 共享 Skill API —— 对齐接口文档 v1.3.0 §8
 */
export const skillApi = {
  /** 查询 Skill（支持状态、标签过滤） */
  list(projectId: string) {
    return request<Skill[]>(`/projects/${projectId}/skills`)
  },
  /** 创建 Skill：PRIVATE 与 Project Admin 自建 PROJECT_SHARED 直接 PUBLISHED，普通成员共享 Skill 返回 DRAFT。 */
  create(projectId: string, payload: CreateSkillPayload) {
    return request<Skill>(`/projects/${projectId}/skills`, {
      method: 'POST',
      body: payload,
    })
  },
  /** 获取 / 编辑草稿或审核中内容 */
  getById(projectId: string, skillId: string) {
    return request<Skill>(`/projects/${projectId}/skills/${skillId}`)
  },
  patch(projectId: string, skillId: string, payload: Partial<CreateSkillPayload>) {
    return request<Skill>(`/projects/${projectId}/skills/${skillId}`, {
      method: 'PATCH',
      body: payload,
    })
  },
  /** 提交审核 */
  submitReview(projectId: string, skillId: string) {
    return request<Skill>(`/projects/${projectId}/skills/${skillId}/submit-review`, {
      method: 'POST',
    })
  },
  /** 批准并发布（Project Admin） */
  approve(projectId: string, skillId: string) {
    return request<Skill>(`/projects/${projectId}/skills/${skillId}/approve`, {
      method: 'POST',
    })
  },
  /** 拒绝（Project Admin） */
  reject(projectId: string, skillId: string, reason: string) {
    return request<Skill>(`/projects/${projectId}/skills/${skillId}/reject`, {
      method: 'POST',
      body: { reason },
    })
  },
  /** 归档 / 下线已发布 Skill（Project Admin） */
  archive(projectId: string, skillId: string) {
    return request<Skill>(`/projects/${projectId}/skills/${skillId}/archive`, {
      method: 'POST',
    })
  },
}
