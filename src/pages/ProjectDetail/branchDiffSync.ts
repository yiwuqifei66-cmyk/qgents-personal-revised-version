import type { ProjectBranchRow } from '@/types/codeBranch'
import type { DiffListItem } from '@/types/task-model'

function branchDiffKey(repositoryId: string, sourceBranch: string): string {
  return `${repositoryId}\0${sourceBranch}`
}

/**
 * 每个 (repositoryId, sourceBranch) 只保留最新一条 Diff（按 createdAt）。
 * 代码与 Branch 的 +/- 与跳转 diffId 都应对齐这份最新快照。
 */
export function latestDiffByRepoBranch(diffs: DiffListItem[]): Map<string, DiffListItem> {
  const map = new Map<string, DiffListItem>()
  for (const diff of diffs) {
    const key = branchDiffKey(diff.repositoryId, diff.sourceBranch)
    const prev = map.get(key)
    if (!prev || prev.createdAt < diff.createdAt) {
      map.set(key, diff)
    }
  }
  return map
}

/**
 * 用 GET /projects/{projectId}/diffs 的 changeStats 覆盖分支行 +/-。
 * - 有匹配 Diff：显示该快照的 additions / deletions
 * - 无匹配：显示 0 / 0（不再使用演示数据里的假数字）
 * - Diff 上有、分支表还没有的 sourceBranch：补一行，避免 Agent 产出后列表缺入口
 */
export function syncBranchesWithDiffs(
  branches: ProjectBranchRow[],
  diffs: DiffListItem[],
  projectRepositoryId: string,
): ProjectBranchRow[] {
  const latest = latestDiffByRepoBranch(diffs)

  const synced = branches.map((branch) => {
    const diff = latest.get(branchDiffKey(branch.projectRepositoryId, branch.name))
    if (!diff) {
      return { ...branch, diffAdditions: 0, diffDeletions: 0 }
    }
    return {
      ...branch,
      diffAdditions: diff.changeStats.additions,
      diffDeletions: diff.changeStats.deletions,
      latestCommitSha: diff.headCommit ?? branch.latestCommitSha,
    }
  })

  const knownNames = new Set(synced.map((branch) => branch.name))
  const extras: ProjectBranchRow[] = []
  for (const diff of latest.values()) {
    if (diff.repositoryId !== projectRepositoryId) continue
    if (knownNames.has(diff.sourceBranch)) continue
    extras.push({
      id: `diff-branch-${diff.id}`,
      projectRepositoryId,
      name: diff.sourceBranch,
      protected: false,
      healthStatus: 'HEALTHY',
      relatedTask: null,
      requirementGroupId: diff.requirementGroupId || undefined,
      commitCount: 0,
      diffAdditions: diff.changeStats.additions,
      diffDeletions: diff.changeStats.deletions,
      mrCount: 0,
      testStatus: 'PENDING',
      latestCommitSha: diff.headCommit ?? undefined,
    })
  }

  return [...synced, ...extras]
}
