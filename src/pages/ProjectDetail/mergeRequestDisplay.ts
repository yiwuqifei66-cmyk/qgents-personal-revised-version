import type { DiffDetail, MergeRequestSummary } from '@/types/task-model'

/** 拼 GitHub PR 链接时用到的绑定仓字段 */
export type GithubRepoLinkSource = {
  githubUrl?: string | null
  fullName?: string | null
}

/**
 * 优先用后端 webUrl；没有时用绑定仓 githubUrl / fullName + PR number 拼。
 * 仓库信息或编号缺失时返回 null，页面改为站内 MR 详情。
 */
export function githubPullRequestUrl(
  webUrl: string | null | undefined,
  number: number,
  repo?: GithubRepoLinkSource | null,
): string | null {
  const official = webUrl?.trim()
  if (official) return official
  if (!Number.isInteger(number) || number <= 0) return null
  const home = repo?.githubUrl?.trim().replace(/\/+$/, '')
  if (home) return `${home}/pull/${number}`
  const fullName = repo?.fullName?.trim()
  if (fullName?.includes('/')) return `https://github.com/${fullName}/pull/${number}`
  return null
}

/**
 * 用现有 GET /merge-requests 对齐「这个 Diff 是否已有 OPEN MR」。
 * 后端暂无 diffId，只能对 repositoryId + sourceBranch，有 taskId 时再收窄。
 */
export function findOpenMergeRequestForDiff(
  items: MergeRequestSummary[],
  review: Pick<DiffDetail, 'repositoryId' | 'sourceBranch' | 'taskId'>,
): MergeRequestSummary | undefined {
  const matches = items.filter((mr) => {
    if (mr.status !== 'OPEN') return false
    if (mr.repositoryId !== review.repositoryId) return false
    if (mr.sourceBranch !== review.sourceBranch) return false
    if (mr.taskId && review.taskId && mr.taskId !== review.taskId) return false
    return true
  })
  const withTask = matches.filter((mr) => mr.taskId === review.taskId)
  const pool = withTask.length > 0 ? withTask : matches
  return pool.reduce<MergeRequestSummary | undefined>((best, mr) => {
    if (!best || mr.number > best.number) return mr
    return best
  }, undefined)
}
