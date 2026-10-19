import type { MergeRequestCheck } from '@/types/task-model'

export type CqSealAppearance = 'empty' | 'locked' | 'stamped' | 'cracked' | 'failed'

export function shortCommitSha(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 7)
}

export function commitsReferToSame(left: string, right: string): boolean {
  const a = left.trim().toLowerCase()
  const b = right.trim().toLowerCase()
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

export function isCqCommitStale(
  stampedSha: string | null | undefined,
  headCommit: string | null | undefined,
): boolean {
  if (!stampedSha || !headCommit) return false
  return !commitsReferToSame(stampedSha, headCommit)
}

export function isMergeRequestAuthor(
  currentUserId: string | undefined,
  taskAuthorUserId: string | undefined,
): boolean {
  return Boolean(currentUserId && taskAuthorUserId && currentUserId === taskAuthorUserId)
}

export function cqSealAppearance(input: {
  status: MergeRequestCheck['status']
  isAuthor: boolean
  stampedSha: string | null | undefined
  headCommit: string | null | undefined
}): CqSealAppearance {
  if (input.status === 'FAILED') return 'failed'
  if (input.status === 'PASSED') {
    return isCqCommitStale(input.stampedSha, input.headCommit) ? 'cracked' : 'stamped'
  }
  return input.isAuthor ? 'locked' : 'empty'
}

export function formatCqTime(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace('T', ' ').replace('Z', '').slice(0, 16)
}

export function findCqCheck(checks: MergeRequestCheck[] | undefined): MergeRequestCheck | undefined {
  return checks?.find((item) => item.type === 'CQ_PLUS_ONE')
}
