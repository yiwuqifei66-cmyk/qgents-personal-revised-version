/**
 * 通知中心 —— 对齐分工安排「通知中心」与接口文档 v1.1.8 §12.1 SSE 事件
 *
 * 说明：接口文档 §1 明确「持久通知中心、离线推送…不在本轮范围」，后端暂无
 * 独立通知接口，本轮由前端 Mock 实现，数据字段对齐 SSE 事件类型。
 */

/** 通知类别（对应分工安排列出的 5 类 + 团队邀请 + 群聊 @ 提及 + 未读数状态） */
export type NotificationKind =
  | 'TASK_COMPLETED' // 任务完成
  | 'TASK_FAILED' // 任务失败
  | 'TASK_AWAITING_CONFIRMATION' // 任务 Diff 待确认（WAITING_DIFF_CONFIRMATION，跳任务详情）
  | 'AGENT_INPUT_REQUIRED' // Agent 需要处理（对应 input-required / approval-required）
  | 'DELIVERABLE_PENDING' // 交付物待验收
  | 'MR_PENDING' // MR 待处理
  | 'INVITED' // 团队邀请（后端实际下发类型，接口文档 §7.1 未列；resourceId 为邀请记录 id）
  | 'MESSAGE_MENTION' // 群聊 @ 提及（groupId 为来源需求群，点击跳转该群）

export interface Notification {
  id: string
  kind: NotificationKind
  /** 一行标题，如「登录功能任务已完成」 */
  title: string
  /** 补充说明，如「Diff 待你验收」 */
  description?: string
  isRead: boolean
  createdAt: string
  /** 所属项目，用于点击跳转 */
  projectId?: string
  /** 来源需求群 */
  groupId?: string
  /** 关联资源 id（taskId / mrId / diffId 等），供跳转定位 */
  resourceId?: string
}
