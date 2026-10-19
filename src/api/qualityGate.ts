import { ApiError, request } from './client'
import { withQuery } from './requestHelpers'
import type { ApiErrorDetail } from '@/types/api'
import type {
  BranchPolicy,
  BranchPolicyUpdateInput,
  DryRunCqDecision,
  DryRunCqInput,
  DryRunCqResult,
  Preflight,
  PreflightBlocker,
  PreflightCqPlusOne,
  PreflightDryRun,
  QualityGateConfig,
  QualityGateUpdateInput,
} from '@/types/qualityGate'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? value : ''
}

function readBool(raw: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = raw[key]
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

function readNullableString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/** 从 ApiError 里读统一错误码（无则返回空串） */
export function readApiErrorCode(error: unknown): string {
  if (!(error instanceof ApiError)) return ''
  const body = error.body as { error?: { code?: string } } | undefined
  return body?.error?.code ?? ''
}

/** 从 ApiError 里读 details[]（409 等会携带逐条 blocker） */
export function readApiErrorDetails(error: unknown): ApiErrorDetail[] {
  if (!(error instanceof ApiError)) return []
  const body = error.body as { error?: { details?: ApiErrorDetail[] } } | undefined
  return Array.isArray(body?.error?.details) ? body.error.details : []
}

// ---------------------------------------------------------------------------
// 分支策略 / 质量门禁
// ---------------------------------------------------------------------------

function mapBranchPolicy(raw: unknown): BranchPolicy {
  const row = isRecord(raw) ? raw : {}
  return {
    requirePullRequest: readBool(row, 'requirePullRequest', false),
    minimumHumanApprovals: readNumber(row, 'minimumHumanApprovals'),
    allowDirectPush: readBool(row, 'allowDirectPush', false),
  }
}

function mapQualityGateConfig(raw: unknown): QualityGateConfig {
  const row = isRecord(raw) ? raw : {}
  return {
    requirePullRequest: readBool(row, 'requirePullRequest', false),
    requiredChecks: readStringArray(row.requiredChecks),
    requiredTestsetIds: readStringArray(row.requiredTestsetIds),
    minimumHumanApprovals: readNumber(row, 'minimumHumanApprovals'),
    allowDirectPush: readBool(row, 'allowDirectPush', false),
  }
}

// ---------------------------------------------------------------------------
// MR 前预检
// ---------------------------------------------------------------------------

function mapPreflightBlocker(raw: unknown): PreflightBlocker | null {
  // 后端真实契约：blockers 为 List<String>，每项为 blocker code（如 DRY_RUN_MISSING / CQ_PLUS_ONE_MISSING）
  // 兼容旧对象形式 {code, message}，确保未来扩展不被直接丢弃。
  if (typeof raw === 'string' && raw.length > 0) {
    return { code: raw, message: '' }
  }
  if (!isRecord(raw)) return null
  const code = readString(raw, 'code')
  const message = readString(raw, 'message')
  if (!code && !message) return null
  return { code, message }
}

function mapPreflightDryRun(raw: unknown): PreflightDryRun | null {
  if (!isRecord(raw)) return null
  return {
    id: readNullableString(raw, 'id') ?? readNullableString(raw, 'dryRunId'),
    status: readString(raw, 'status'),
    sourceCommit: readNullableString(raw, 'sourceCommit'),
    targetCommit: readNullableString(raw, 'targetCommit'),
    completedAt: readNullableString(raw, 'completedAt'),
  }
}

function mapPreflightCqPlusOne(raw: unknown): PreflightCqPlusOne | null {
  if (!isRecord(raw)) return null
  const statusRaw = readString(raw, 'status')
  const status: PreflightCqPlusOne['status'] =
    statusRaw === 'APPROVED' || statusRaw === 'REJECTED' ? statusRaw : 'MISSING'
  return {
    status,
    reviewerUserId: readNullableString(raw, 'reviewerUserId'),
    reviewerName: readNullableString(raw, 'reviewerName'),
    reason: readNullableString(raw, 'reason'),
    reviewedAt: readNullableString(raw, 'reviewedAt'),
  }
}

export function mapPreflight(raw: unknown): Preflight {
  const row = isRecord(raw) ? raw : {}
  const statusRaw = readString(row, 'status')
  const status: Preflight['status'] =
    statusRaw === 'PASSED' || statusRaw === 'FAILED' || statusRaw === 'STALE' ? statusRaw : 'PENDING'
  const blockersRaw = Array.isArray(row.blockers) ? row.blockers : []
  const blockers = blockersRaw.flatMap((item) => {
    const mapped = mapPreflightBlocker(item)
    return mapped ? [mapped] : []
  })
  return {
    taskId: readString(row, 'taskId'),
    repositoryId: readString(row, 'repositoryId'),
    targetBranch: readString(row, 'targetBranch'),
    sourceCommit: readNullableString(row, 'sourceCommit'),
    targetCommit: readNullableString(row, 'targetCommit'),
    status,
    blockers,
    dryRun: mapPreflightDryRun(row.dryRun),
    cqPlusOne: mapPreflightCqPlusOne(row.cqPlusOne),
  }
}

/**
 * 后端 CQ 审批（approve/reject）真实返回 PreflightGateResponse（预检全量对象），
 * decision 信息在嵌套的 cqPlusOne 里（dryRun.id / reviewedAt / reason 等也在其中）。
 * 这里从预检响应结构中抽出 DryRunCqResult，兼容将来若改为直接返回审查结果。
 */
function mapDryRunCqResult(raw: unknown): DryRunCqResult {
  const row = isRecord(raw) ? raw : {}
  // 优先从 cqPlusOne 嵌套字段取（PreflightGateResponse 结构）
  const nestedCq = isRecord(row.cqPlusOne) ? row.cqPlusOne : null
  const nestedDryRun = isRecord(row.dryRun) ? row.dryRun : null
  const statusRaw = nestedCq
    ? readString(nestedCq, 'status')
    : readString(row, 'decision')
  const decision: DryRunCqDecision = statusRaw === 'REJECTED' ? 'REJECTED' : 'APPROVED'
  const reviewerUserId = nestedCq
    ? readNullableString(nestedCq, 'reviewerUserId')
    : readNullableString(row, 'reviewerUserId')
  const reason = nestedCq
    ? readNullableString(nestedCq, 'reason')
    : readNullableString(row, 'reason')
  const reviewedAt = nestedCq
    ? readNullableString(nestedCq, 'reviewedAt')
    : readNullableString(row, 'reviewedAt')
  const reviewerName = nestedCq
    ? readNullableString(nestedCq, 'reviewerName')
    : readNullableString(row, 'reviewerName')
  const dryRunId = nestedDryRun
    ? readNullableString(nestedDryRun, 'id') ?? readNullableString(nestedDryRun, 'dryRunId')
    : readNullableString(row, 'dryRunId') || readNullableString(row, 'id')
  return {
    dryRunId: dryRunId ?? '',
    decision,
    reviewerUserId,
    reviewerName,
    reason,
    reviewedAt,
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const policyPath = (projectId: string, repositoryId: string, branch: string) =>
  `/projects/${projectId}/repositories/${repositoryId}/branch-policies/${encodeURIComponent(branch)}`

const gatePath = (projectId: string, repositoryId: string, branch: string) =>
  `/projects/${projectId}/repositories/${repositoryId}/quality-gates?branch=${encodeURIComponent(branch)}`

export const branchPolicyApi = {
  get(projectId: string, repositoryId: string, branch: string) {
    return request<unknown>(policyPath(projectId, repositoryId, branch)).then(mapBranchPolicy)
  },

  update(projectId: string, repositoryId: string, branch: string, input: BranchPolicyUpdateInput) {
    return request<unknown>(policyPath(projectId, repositoryId, branch), {
      method: 'PUT',
      body: input,
    }).then(mapBranchPolicy)
  },
}

export const qualityGateApi = {
  get(projectId: string, repositoryId: string, branch: string) {
    return request<unknown>(gatePath(projectId, repositoryId, branch)).then(mapQualityGateConfig)
  },

  update(projectId: string, repositoryId: string, branch: string, input: QualityGateUpdateInput) {
    return request<unknown>(gatePath(projectId, repositoryId, branch), {
      method: 'PUT',
      body: input,
    }).then(mapQualityGateConfig)
  },

  /** 预检 (Preflight)：获取指定 task+repo 的 CQ+1 / DryRun 状态 */
  preflight(
    projectId: string,
    params: { taskId: string; repositoryId: string; targetBranch: string },
  ) {
    return preflightApi.get(projectId, params.taskId, params.repositoryId, params.targetBranch)
  },
}

export const preflightApi = {
  /** GET /projects/{projectId}/tasks/{taskId}/repositories/{repositoryId}/preflight */
  get(projectId: string, taskId: string, repositoryId: string, targetBranch: string) {
    return request<unknown>(
      withQuery(
        `/projects/${projectId}/tasks/${taskId}/repositories/${repositoryId}/preflight`,
        { targetBranch },
      ),
    ).then(mapPreflight)
  },
}

export const dryRunCqApi = {
  approve(projectId: string, dryRunId: string, input: DryRunCqInput) {
    return request<unknown>(`/projects/${projectId}/dry-runs/${dryRunId}/cq-approvals`, {
      method: 'POST',
      body: input,
    }).then(mapDryRunCqResult)
  },

  reject(projectId: string, dryRunId: string, input: DryRunCqInput) {
    return request<unknown>(`/projects/${projectId}/dry-runs/${dryRunId}/cq-rejections`, {
      method: 'POST',
      body: input,
    }).then(mapDryRunCqResult)
  },
}
