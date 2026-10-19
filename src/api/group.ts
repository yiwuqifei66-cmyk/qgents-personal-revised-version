import { request, requestPage } from './client'
import type {
  Group,
  GroupMember,
  MarkReadResult,
  Message,
  SendMessageResult,
  SendMessagePayload,
  CreateGroupPayload,
  TaskTriggerRequest,
} from '@/types'

/** 群聊 API —— 对齐接口文档 v1.1.8 §7 */
export const groupApi = {
  listByProject(projectId: string) {
    return request<Group[]>(`/projects/${projectId}/groups`)
  },
  /** 主群聚合（§五）：一次返回当前用户全部可见项目主群，替代 teams→projects→groups 三层串联查询 */
  listMainGroups() {
    return request<Group[]>('/chat/main-groups')
  },
  /** 标记群已读（§三 进群全读）：后端推进已读游标到群最新消息；写操作由 client 自动带 Idempotency-Key */
  markRead(projectId: string, groupId: string) {
    return request<MarkReadResult>(`/projects/${projectId}/groups/${groupId}/read`, { method: 'POST' })
  },
  create(projectId: string, payload: CreateGroupPayload) {
    return request<Group>(`/projects/${projectId}/groups`, { method: 'POST', body: payload })
  },
  getById(projectId: string, groupId: string) {
    return request<Group>(`/projects/${projectId}/groups/${groupId}`)
  },
  listMembers(projectId: string, groupId: string) {
    return request<GroupMember[]>(`/projects/${projectId}/groups/${groupId}/members`)
  },
  /** POST /projects/{projectId}/groups/{groupId}/members — 邀请项目成员入群（创建者或 Project Admin） */
  addMember(projectId: string, groupId: string, userId: string) {
    return request<GroupMember>(`/projects/${projectId}/groups/${groupId}/members`, {
      method: 'POST',
      body: { userId },
    })
  },
  /** DELETE /projects/{projectId}/groups/{groupId}/members/{userId} — 移出群聊（创建者或 Project Admin；创建者本人不可移出） */
  removeMember(projectId: string, groupId: string, userId: string) {
    return request<void>(`/projects/${projectId}/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    })
  },
  /** POST /projects/{projectId}/groups/{groupId}/archive — 归档需求群（创建者或 Project Admin） */
  archive(projectId: string, groupId: string) {
    return request<void>(`/projects/${projectId}/groups/${groupId}/archive`, { method: 'POST' })
  },
  /**
   * POST /projects/{projectId}/groups/{groupId}/leave — 退出项目（§24.4）。
   * 移除显式项目成员身份，失去项目全部资源访问权。
   * 最后一名 Project Admin → 409 PROJECT_ADMIN_CANNOT_LEAVE；
   * canonical Team Owner → 409 TEAM_OWNER_CANNOT_LEAVE_PROJECT（不删除任何成员关系）。
   */
  leaveProject(projectId: string, groupId: string) {
    return request<void>(`/projects/${projectId}/groups/${groupId}/leave`, { method: 'POST' })
  },
  /** 游标拉取消息 —— 返回 data + page 结构 */
  listMessages(projectId: string, groupId: string, cursor?: string, limit = 30) {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    params.set('limit', String(limit))
    return requestPage<Message>(
      `/projects/${projectId}/groups/${groupId}/messages?${params.toString()}`,
    )
  },

  /**
   * 消息增量拉取（可靠消息同步增量契约 §1）—— SSE/WS 断线恢复后按群内序号补齐缺失消息。
   * afterSequence 必填：只返回 sequence > afterSequence 的消息，按 sequence 升序；
   * hasMore=true 时用本页最后一条 sequence 作为下一次 afterSequence。
   * 游标方向与历史分页接口的 cursor 不同，不能交叉使用。
   */
  listMessagesIncremental(projectId: string, groupId: string, afterSequence: number, limit = 100) {
    const params = new URLSearchParams()
    params.set('afterSequence', String(afterSequence))
    params.set('limit', String(limit))
    return requestPage<Message>(
      `/projects/${projectId}/groups/${groupId}/messages/incremental?${params.toString()}`,
    )
  },
  /** 单条消息定位（通知「@ 提及」跳转用，§群聊@提及补充）：目标消息不在已加载分页时拉取 */
  getMessage(projectId: string, groupId: string, messageId: string) {
    return request<Message>(`/projects/${projectId}/groups/${groupId}/messages/${messageId}`)
  },
  /** PUT /projects/{projectId}/groups/{groupId}/pin — 置顶/取消置顶（当前用户维度，§群聊置顶后端接口需求） */
  setGroupPinned(projectId: string, groupId: string, pinned: boolean) {
    return request<void>(`/projects/${projectId}/groups/${groupId}/pin`, {
      method: 'PUT',
      body: { pinned },
    })
  },
  sendMessage(projectId: string, groupId: string, payload: SendMessagePayload) {
    return request<Message | SendMessageResult>(`/projects/${projectId}/groups/${groupId}/messages`, {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': payload.clientMessageId },
    }).then((response): SendMessageResult => {
      if ('message' in response) return response
      return { message: response, task: null }
    })
  },
  /** 显式触发任务（§7；续作引用时不得传 repositoryIds，否则 409 WORKSPACE_CONTINUATION_REPOSITORIES_FORBIDDEN） */
  async triggerTask(projectId: string, groupId: string, messageId: string, input: TaskTriggerRequest): Promise<void> {
    await request<unknown>(
      `/projects/${projectId}/groups/${groupId}/messages/${messageId}/trigger-task`,
      { method: 'POST', body: input },
    )
  },
}
