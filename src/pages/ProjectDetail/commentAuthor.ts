import type { DiffComment } from '@/types/task-model'

export const HUNK_UNAVAILABLE_HINT =
  '本轮未返回结构化 hunk。文件树与增减统计仍可用，行级对比待后端解析 patch。'

/**
 * 解析评论作者显示名：优先评论自带的 authorName，其次按 authorUserId 查成员列表。
 */
export function commentAuthorName(
  comment: Pick<DiffComment, 'authorName' | 'authorUserId'>,
  members: Array<{ userId: string; displayName?: string }>,
): string {
  const named = comment.authorName?.trim()
  if (named) return named
  const member = comment.authorUserId
    ? members.find((item) => item.userId === comment.authorUserId)
    : undefined
  return member?.displayName?.trim() || '成员'
}

/**
 * 解析评论作者头像 URL：优先评论自带的 authorAvatarUrl（后端已随评论返回），
 * 缺失时按 authorUserId 查成员列表；均无则返回 undefined（前端回退名字首字符）。
 */
export function commentAuthorAvatar(
  comment: Pick<DiffComment, 'authorAvatarUrl' | 'authorUserId'>,
  members: Array<{ userId: string; avatarUrl?: string | null }>,
): string | undefined {
  const direct = comment.authorAvatarUrl?.trim()
  if (direct) return direct
  const member = comment.authorUserId
    ? members.find((item) => item.userId === comment.authorUserId)
    : undefined
  const fallback = member?.avatarUrl?.trim()
  return fallback || undefined
}
