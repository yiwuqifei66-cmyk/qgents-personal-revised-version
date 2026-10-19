export type GroupType = 'PROJECT_MAIN' | 'REQUIREMENT'
export type GroupStatus = 'ACTIVE' | 'ARCHIVED'
export type GroupMemberType = 'USER' | 'AGENT'
export type MessageSenderType = 'USER' | 'AGENT' | 'SYSTEM'
export type MessageContentType =
  | 'TEXT'
  | 'CODE'
  | 'IMAGE'
  | 'FILE'
  | 'DIFF'
  | 'TASK_STATUS'
  | 'SYSTEM'
  | 'QUOTE'

/** 列表分页元信息 —— 对齐接口文档 v1.1.8 §2「列表分页」 */
export interface Page<T> {
  data: T[]
  page: {
    nextCursor: string | null
    hasMore: boolean
  }
}

/** 最新消息摘要（会话列表展示用，对齐分工安排「会话列表」GroupListItem.latestMessage） */
export interface MessageSummary {
  senderName?: string
  text: string
  /** 最新消息类型（§7：TEXT/CODE/IMAGE/FILE/SYSTEM/QUOTE/DIFF/TASK_STATUS），用于无文本类型的摘要占位 */
  type?: MessageContentType
}

export interface Group {
  id: string
  projectId: string
  type: GroupType
  title: string
  description?: string
  status: GroupStatus
  /** 创建者 userId（后端 DTO 补充，用于归档权限判断） */
  createdBy?: string
  memberCount?: number
  latestActivityAt?: string
  latestMessage?: MessageSummary
  unreadCount?: number
  /** 该群被 @ 我的未读消息数（后端计算，≥0）；前端据此显示「有人@我」提示 */
  mentionedUnread?: number
  /** 当前用户对该群是否置顶（后端用户维度偏好，§群聊置顶；缺失时前端用 localStorage 兜底） */
  pinned?: boolean
  isPinned?: boolean
  isArchived?: boolean
}

export interface GroupMember {
  id: string
  displayName: string
  memberType: GroupMemberType
  avatarUrl?: string
  /** 用户邮箱（后端补全后返回；用于成员管理弹窗展示，缺失时前端隐藏） */
  email?: string
}

/** POST .../groups/{groupId}/read 响应（§三 标记已读，进群全读） */
export interface MarkReadResult {
  groupId: string
  lastReadSequenceNo: number
  unreadCount: number
}

/** TEXT 消息内容 */
export interface TextMessageContent {
  text: string
}

/** CODE 消息内容 */
export interface CodeMessageContent {
  code: string
  language?: string
}

/** IMAGE 消息内容（增量契约 §6：attachmentId 必填；§7 可选回填 previewUrl 等预览字段） */
export interface ImageMessageContent {
  url: string
  /** 已确认上传（READY）的附件 ID（增量契约 §6.2，必填） */
  attachmentId: string
  width?: number
  height?: number
  /** §7 可选增强：服务端回填的内联预览地址（相对路径带短期 token） */
  previewUrl?: string
  /** §7 可选增强：是否可内联预览 */
  previewable?: boolean
  /** §7 可选增强：预览类型 */
  previewType?: string
}

/** FILE 消息内容（增量契约 §6：attachmentId 必填；§7 可选回填预览字段） */
export interface FileMessageContent {
  url: string
  /** 已确认上传（READY）的附件 ID（增量契约 §6.2，必填） */
  attachmentId: string
  name: string
  size: number
  mimeType: string
  /** §7 可选增强：服务端回填的内联预览地址（相对路径带短期 token） */
  previewUrl?: string
  /** §7 可选增强：是否可内联预览 */
  previewable?: boolean
  /** §7 可选增强：预览类型 */
  previewType?: string
}

/** QUOTE 引用消息内容：text 为通用消息正文；quotedText 为被引用消息的原始内容摘要，replyText 为回复者输入的正文 */
export interface QuoteMessageContent {
  /** 与 TEXT 消息同构的正文，供任务触发、群摘要等通用文本消费者读取。 */
  text?: string
  quotedMessageId: string
  quotedText: string
  quotedSenderName?: string
  replyText?: string
}

/** DIFF 交付卡片内容（v2.0.3 §23.4 富结构：展示码/仓库/分支/文件列表/审核交付状态） */
export interface DiffMessageContent {
  diffId: string
  title?: string
  additions?: number
  deletions?: number
  /** v2.0.3 增量：后端补全后用于富卡片展示 */
  taskId?: string
  reviewBatchId?: string
  /** 展示码，如 D-1024 */
  displayCode?: string
  repositoryName?: string
  sourceBranch?: string
  targetBranch?: string
  /** 变更文件路径列表 */
  files?: string[]
  reviewStatus?: 'PENDING_CONFIRMATION' | 'ACCEPTED' | 'REJECTED'
  reviewReason?: string | null
  deliveryStatus?: string
}

/** TASK_STATUS 执行计划步骤 */
export interface TaskStatusPlanStep {
  stepId: string
  sequence: number
  title: string
  role?: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'
  message?: string | null
}

/**
 * TASK_STATUS 当前工作区的仓库映射（接口文档 §39）。
 * repositoryId 是项目仓库绑定 ID（project_repositories.id），不是 GitHub 数字仓库 ID。
 * workspacePath 是 Worker 内部工作目录别名（如 repo-1，给 Agent 工具用），
 * 绝不能作为宿主机绝对路径使用。
 * name = GitHub 仓库短名称；fullName = owner/repository 实际仓库名。
 */
export interface TaskStatusRepositoryMapping {
  workspacePath: string
  repositoryId: string
  /** GitHub 仓库短名称（如 testtesttest） */
  name?: string | null
  /** GitHub 实际仓库名，owner/repository（如 Choco-emmm/testtesttest） */
  fullName?: string | null
  /** 平台标识（如 GITHUB） */
  provider?: string | null
  /** 目标/基准分支 */
  baseRef?: string | null
  /** 源分支 */
  sourceBranch?: string | null
}

/** TASK_STATUS 任务状态卡片内容（后端富结构：状态 + 阶段 + 交付模式 + 执行计划步骤） */
export interface TaskStatusMessageContent {
  taskId: string
  status: string
  /** 旧字段：节点/阶段名（兼容旧数据） */
  node?: string
  message?: string
  /** 当前阶段（如 CODING / REVIEWING / DELIVERING） */
  phase?: string
  deliveryMode?: string
  deliveryReason?: string
  currentStepId?: string
  /** 当前 Task Workspace 已挂载的项目仓库；空数组表示尚未挂载仓库。 */
  repositoryMappings?: TaskStatusRepositoryMapping[]
  /** 当前步骤实际涉及的仓库工作区路径；空数组表示当前阶段尚未选定操作仓库，缺失表示旧卡片未提供范围。 */
  currentRepositoryPaths?: string[]
  plan?: {
    summary?: string
    steps?: TaskStatusPlanStep[]
  }
}

/** SYSTEM 系统消息内容 */
export interface SystemMessageContent {
  text: string
}

export interface Message {
  id: string
  groupId: string
  type: MessageContentType
  content: unknown
  senderType: MessageSenderType
  senderId?: string
  /** 发送者显示名（后端联调字段名以 DTO 为准，此处 mock 渲染用） */
  senderName?: string
  sequence?: number
  createdAt: string
  replyToId?: string | null
  /** QUOTE 消息的回复正文（§7 冻结：顶层字段；发送与回显同构）。嵌套引用取 replyText ?? quotedText */
  replyText?: string
  /** @ 提及对象（后端 MessageResponse.mentions 回显；被 @ 用户据此展示「有人@我」） */
  mentions?: Mention[]
  /** 前端乐观发送标志：消息已本地展示、等待后端确认（发送成功后替换为真实消息，不上送后端） */
  pending?: boolean
}

export interface SendMessagePayload {
  type: MessageContentType
  content: unknown
  mentions?: Mention[]
  replyToId?: string | null
  clientMessageId: string
  /** QUOTE 消息的回复正文（§7 冻结：顶层字段，与 content 内旧字段并存提交） */
  replyText?: string
}

/** @ 提及 —— 对象数组，type 区分 USER / AGENT（接口文档 v1.9.3 §7） */
export type MentionType = 'USER' | 'AGENT'
export interface Mention {
  type: MentionType
  id: string
}

export interface MessageTaskSummary {
  id: string
  displayCode: string
  status: string
  missingFields: string[]
}

export interface SendMessageResult {
  message: Message
  task: MessageTaskSummary | null
}

/** 显式触发任务请求体（§7 从消息触发任务）—— 续作引用时不得传 repositoryIds */
export interface TaskTriggerRequest {
  title: string
  requirement?: string
  repositoryIds?: string[]
  /** 公共基线分支名；不传（或 null/空）时各仓库用各自项目默认分支兜底 */
  baseRef?: string | null
  /** 按仓库指定的基线分支映射（repositoryId → 分支名）；多仓库可各自不同基准分支 */
  baseRefs?: Record<string, string> | null
  deliveryMode?: 'DIFF_FIRST' | 'MR_FIRST'
}

export interface CreateGroupPayload {
  title: string
  description?: string
  repositoryIds?: string[]
  type?: 'REQUIREMENT'
  /** 建群时选择的初始成员（项目成员 userId 列表）；不传 = 群内只有创建者 */
  memberIds?: string[]
}
