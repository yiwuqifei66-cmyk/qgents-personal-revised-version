/**
 * 项目工作分支（GET /projects/{projectId}/work-branches）
 * 口径：docs/frontend/code-branch-backend-confirm.md
 */

export interface WorkBranchLatestTaskFinalDiff {
  id: string
}

export interface WorkBranchLatestTask {
  id: string
  displayCode: string
  title: string
  /**
   * 当前 latestTask 的最终 Diff；无变更时为 null。
   * 与行级 latestDiff（分支历史最新快照）不是同一概念。
   */
  finalDiff?: WorkBranchLatestTaskFinalDiff | null
}

export interface WorkBranchRequirementGroup {
  id: string
  title: string
}

export interface WorkBranchLatestDiff {
  id: string
  /** 该 Diff 快照所属 Task，避免与行内 latestTask 混淆 */
  taskId: string | null
  status: string
  changeStats: { additions: number; deletions: number; files?: number }
}

export interface WorkBranchOpenMergeRequest {
  id: string
  number: number
  status: string
}

export type WorkBranchVerificationStatus = 'PASSED' | 'FAILED' | 'PENDING' | 'RUNNING' | string

/** 后续真实接入时：TEST_RUN | DRY_RUN 等；首版可缺省 */
export type WorkBranchVerificationKind = 'TEST_RUN' | 'DRY_RUN' | string

export interface WorkBranchLastVerification {
  kind: WorkBranchVerificationKind | null
  status: WorkBranchVerificationStatus
  commitSha: string
  completedAt: string
}

/**
 * 单行工作分支。
 * 逻辑唯一键：projectRepositoryId + name（后端不虚构分支记录 UUID）。
 */
export interface WorkBranch {
  /** 若后端提供则优先用作列表 key；否则用 workBranchRowKey */
  id?: string
  /** project_repositories.id */
  projectRepositoryId: string
  name: string
  workspaceId: string | null
  lastKnownHead: string | null
  latestTask: WorkBranchLatestTask | null
  requirementGroups: WorkBranchRequirementGroup[]
  latestDiff: WorkBranchLatestDiff | null
  openMergeRequest: WorkBranchOpenMergeRequest | null
  lastVerification: WorkBranchLastVerification | null
}

export interface WorkBranchListFilters {
  /** 同 project_repositories.id */
  repositoryId?: string
  requirementGroupId?: string
  cursor?: string
  limit?: number
}

export function workBranchRowKey(branch: WorkBranch): string {
  return branch.id ?? `${branch.projectRepositoryId}:${branch.name}`
}
