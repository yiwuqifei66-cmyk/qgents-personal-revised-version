import type { Team, TeamMember, User } from '@/types'

/** 判断某个团队成员是否为当前登录用户 */
export function memberIsCurrentUser(member: TeamMember, user: User | null): boolean {
  if (!user) return false
  if (member.userId && member.userId === user.id) return true
  if (member.email && user.email && member.email.toLowerCase() === user.email.toLowerCase()) {
    return true
  }
  return false
}

/**
 * 判断当前用户是否为团队 Owner。
 * 兼容后端字段不一致：接口 myRole，或「我创建的团队」带入的 as=owner，
 * 或成员列表反查；都对不上时（公网 GET /teams/:id 常不带 myRole）兜底返回 true，
 * 避免 Owner 专属入口误消失。
 */
export function isCurrentUserTeamOwner(
  team: Team | undefined,
  members: TeamMember[],
  user: User | null,
  asOwnerQuery: boolean,
): boolean {
  if (asOwnerQuery) return true
  if (team?.myRole === 'TEAM_OWNER') return true
  const me = members.find((member) => memberIsCurrentUser(member, user))
  if (me) return me.role === 'TEAM_OWNER'
  return !team?.myRole
}
