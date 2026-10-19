/**
 * 分支策略 / 质量门禁 / MR 前预检 / Dry Run CQ+1
 *
 * 口径：《Testset 前端必办清单 v2.0.3》+ README/Qgents接口文档 §6.1、§13。
 * repositoryId 一律使用 project_repositories.id（项目绑定 UUID）。
 * 预检与 Dry Run CQ+1 为「MR 前门禁」，与 MR 创建后的 qualityGate 检查是两套数据，
 * 前端不得混用，也不得用按钮禁用代替服务端裁决。
 */

/** 分支策略（GET/PUT .../branch-policies/{branch}） */
export interface BranchPolicy {
  requirePullRequest: boolean
  minimumHumanApprovals: number
  allowDirectPush: boolean
}

/** 目标分支质量门禁配置（GET/PUT .../quality-gates/{branch}） */
export interface QualityGateConfig {
  requirePullRequest: boolean
  requiredChecks: string[]
  requiredTestsetIds: string[]
  minimumHumanApprovals: number
  allowDirectPush: boolean
}

/** 保存质量门禁的请求体：前端仅允许编辑强制 Testset 列表 */
export interface QualityGateUpdateInput {
  requiredChecks: string[]
  requiredTestsetIds: string[]
}

/** 保存分支策略的请求体 */
export interface BranchPolicyUpdateInput {
  requirePullRequest: boolean
  minimumHumanApprovals: number
  allowDirectPush: boolean
}

// ---------------------------------------------------------------------------
// MR 前预检（Preflight）
// ---------------------------------------------------------------------------

/** 预检总体状态；STALE 表示 source/target 已变化，旧结论不可再用 */
export type PreflightStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'STALE'

/** 已知 blocker code 白名单（服务端 details[].code 也复用同一语义） */
export type PreflightBlockerCode =
  | 'TASK_NOT_READY'
  | 'DRY_RUN_MISSING'
  | 'DRY_RUN_QUEUED'
  | 'DRY_RUN_RUNNING'
  | 'DRY_RUN_FAILED'
  | 'CQ_PLUS_ONE_MISSING'
  | 'CQ_PLUS_ONE_REJECTED'
  | 'PREFLIGHT_CONTEXT_STALE'
  | 'MR_SOURCE_HEAD_CHANGED'

export interface PreflightBlocker {
  /** 后端可能扩展新 code，前端按 string 收，仅对已知 code 给精准文案 */
  code: string
  message: string
}

/** 预检里 Dry Run 的最小事实：只展示固定提交与状态，不承载报告正文 */
export interface PreflightDryRun {
  id: string | null
  status: string
  sourceCommit: string | null
  targetCommit: string | null
  /** Dry Run 完成时间（ISO UTC）；QUEUED/RUNNING 时常为 null */
  completedAt: string | null
}

export type PreflightCqPlusOneStatus = 'MISSING' | 'APPROVED' | 'REJECTED'

export interface PreflightCqPlusOne {
  status: PreflightCqPlusOneStatus
  reviewerUserId: string | null
  reviewerName: string | null
  reason: string | null
  reviewedAt: string | null
}

/** GET /projects/{projectId}/tasks/{taskId}/repositories/{repositoryId}/preflight */
export interface Preflight {
  taskId: string
  repositoryId: string
  targetBranch: string
  sourceCommit: string | null
  targetCommit: string | null
  status: PreflightStatus
  blockers: PreflightBlocker[]
  dryRun: PreflightDryRun | null
  cqPlusOne: PreflightCqPlusOne | null
}

// ---------------------------------------------------------------------------
// Dry Run CQ+1（MR 前的人工审查）
// ---------------------------------------------------------------------------

export interface DryRunCqInput {
  reason?: string
}

export type DryRunCqDecision = 'APPROVED' | 'REJECTED'

/** POST .../dry-runs/{dryRunId}/cq-approvals | cq-rejections 的响应（宽松收） */
export interface DryRunCqResult {
  dryRunId: string
  decision: DryRunCqDecision
  reviewerUserId: string | null
  reviewerName: string | null
  reason: string | null
  reviewedAt: string | null
}
