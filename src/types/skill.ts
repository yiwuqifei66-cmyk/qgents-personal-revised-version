/**
 * 共享 Skill —— 对齐接口文档 v1.3.0 §8
 *
 * Skill 是项目需求群内可复用的能力片段（规范、提示词、操作指引或工具调用约束）。
 * PRIVATE 创建即发布；PROJECT_SHARED 由 Project Admin 创建时也直接发布，普通成员创建后等待审核。
 * Skill 不是 Memory，不能承载未经确认的客观事实。
 */

/** Skill 状态：DRAFT -> PENDING_REVIEW -> PUBLISHED / REJECTED / ARCHIVED */
export type SkillStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'ARCHIVED'

/** Skill 可见性：PRIVATE（个人可用）/ PROJECT_SHARED（项目共享） */
export type SkillVisibility = 'PRIVATE' | 'PROJECT_SHARED'

/** 创建者 / 审核者摘要（展示用） */
export interface SkillActor {
  id: string
  displayName: string
}

export interface Skill {
  id: string
  projectId: string
  name: string
  content: string
  tags: string[]
  visibility: SkillVisibility
  status: SkillStatus
  creator: SkillActor
  reviewer: SkillActor | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 创建草稿请求体（POST /skills） */
export interface CreateSkillPayload {
  name: string
  content: string
  tags: string[]
  visibility: SkillVisibility
}
