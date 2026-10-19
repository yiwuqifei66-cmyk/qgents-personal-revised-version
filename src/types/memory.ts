/**
 * 共享 Memory —— 对齐接口文档 v1.1.8 §9
 *
 * Memory 是经人工确认后供项目复用的知识，不是原始聊天记录。
 * AI 只能生成草稿，不能直接批准/发布。
 */

/** Memory 状态：DRAFT -> PENDING_REVIEW -> APPROVED / REJECTED / ARCHIVED */
export type MemoryStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ARCHIVED'

/** Memory 来源：MANUAL（手动创建）/ MESSAGE（群消息生成） */
export type MemorySourceType = 'MANUAL' | 'MESSAGE'

/** 来源消息引用（MESSAGE 来源时记录） */
export interface MemorySourceRef {
  groupId: string
  messageId: string
}

/** 创建者 / 审核者摘要（展示用） */
export interface MemoryActor {
  id: string
  displayName: string
}

export interface Memory {
  id: string
  projectId: string
  title: string
  content: string
  category: string
  tags: string[]
  status: MemoryStatus
  source: MemorySourceType
  /** 来源消息（MESSAGE 来源时非空） */
  sources: MemorySourceRef[]
  creator: MemoryActor
  reviewer: MemoryActor | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 手动创建草稿请求体（POST /memories） */
export interface CreateMemoryPayload {
  title: string
  content: string
  category: string
  tags: string[]
}

/** 依据最近群聊自动生成草稿请求体（POST /memories/drafts） */
export interface GenerateMemoryDraftPayload {
  /** 取最近聊天的需求群 ID（前端当前打开的群） */
  groupId: string
  /** 沉淀指令（可空） */
  instruction?: string
}
