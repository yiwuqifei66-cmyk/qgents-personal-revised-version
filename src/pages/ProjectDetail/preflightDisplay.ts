import type { PreflightBlockerCode, PreflightCqPlusOneStatus, PreflightStatus } from '@/types/qualityGate'

/**
 * MR 前预检（Preflight）的展示映射。
 * 服务端 409 的 details[].code 与预检 blockers[].code 复用同一套语义，统一在此文案化，
 * 前端不用按钮禁用代替服务端裁决。
 */

export function preflightStatusLabel(status: PreflightStatus): string {
  switch (status) {
    case 'PASSED':
      return '预检通过'
    case 'FAILED':
      return '预检未过'
    case 'STALE':
      return '预检已失效'
    default:
      return '预检进行中'
  }
}

export function preflightStatusColor(status: PreflightStatus): 'default' | 'processing' | 'success' | 'error' | 'warning' {
  switch (status) {
    case 'PASSED':
      return 'success'
    case 'FAILED':
      return 'error'
    case 'STALE':
      return 'warning'
    default:
      return 'processing'
  }
}

// ---------------------------------------------------------------------------
// Dry Run 状态 → 用户友好文案
// ---------------------------------------------------------------------------

/** Dry Run 原始状态 → 用户友好描述 */
export function dryRunStatusDescription(dryRunStatus: string | null | undefined): string {
  if (!dryRunStatus) return '尚未发起 Dry Run'
  switch (dryRunStatus) {
    case 'QUEUED':
      return 'Dry Run 排队中'
    case 'RUNNING':
      return 'Dry Run 自动执行中'
    case 'PASSED':
      return 'Dry Run 已通过'
    case 'FAILED':
      return 'Dry Run 失败'
    case 'CANCELLED':
      return 'Dry Run 已取消'
    default:
      return `Dry Run ${dryRunStatus}`
  }
}

/** Dry Run 状态 → tag 颜色 */
export function dryRunStatusColor(dryRunStatus: string | null | undefined): 'default' | 'processing' | 'success' | 'error' | 'warning' {
  if (!dryRunStatus) return 'default'
  switch (dryRunStatus) {
    case 'PASSED':
      return 'success'
    case 'FAILED':
      return 'error'
    case 'QUEUED':
    case 'RUNNING':
      return 'processing'
    case 'CANCELLED':
      return 'warning'
    default:
      return 'default'
  }
}

// ---------------------------------------------------------------------------
// CQ+1 状态 → 用户友好文案
// ---------------------------------------------------------------------------

export function cqPlusOneStatusDescription(status: PreflightCqPlusOneStatus | null | undefined): string {
  if (!status || status === 'MISSING') return '等待 CQ+1'
  switch (status) {
    case 'APPROVED':
      return 'CQ+1 已通过'
    case 'REJECTED':
      return 'CQ+1 被拒绝'
    default:
      return 'CQ+1 状态未知'
  }
}

export function cqPlusOneStatusColor(status: PreflightCqPlusOneStatus | null | undefined): 'default' | 'success' | 'error' | 'warning' {
  if (!status || status === 'MISSING') return 'warning'
  switch (status) {
    case 'APPROVED':
      return 'success'
    case 'REJECTED':
      return 'error'
    default:
      return 'default'
  }
}

// ---------------------------------------------------------------------------
// 组合文案：按仓库展示的状态行
// ---------------------------------------------------------------------------

/**
 * 根据 preflight 的 dryRun + cqPlusOne + blockers 组合，生成一行用户友好的描述。
 * 用于 TaskDetail 页的「逐仓库预检状态」列表。
 *
 * 优先级：blockers > dryRun 状态 > CQ+1 状态。
 * 当存在 blockers（如 TASK_NOT_READY）时，优先展示阻塞原因，
 * 避免用户看到"Dry Run 尚未发起"却不知道为什么。
 */
export function preflightRepoSummary(params: {
  dryRunStatus: string | null | undefined
  cqStatus: PreflightCqPlusOneStatus | null | undefined
  blockers: Array<{ code: string }>
}): { text: string; color: 'default' | 'processing' | 'success' | 'error' | 'warning' } {
  const { dryRunStatus, cqStatus, blockers } = params

  // —— 第一优先级：检查 blockers ——
  // TASK_NOT_READY：任务仍在 DELIVERING，commit/push 尚未完成
  const taskNotReady = blockers.find((b) => b.code === 'TASK_NOT_READY')
  if (taskNotReady) {
    return { text: '任务正在交付中（commit/push 进行中），完成后将自动触发 Dry Run', color: 'processing' }
  }

  // Dry Run 失败
  if (dryRunStatus === 'FAILED') {
    return { text: 'Dry Run 失败，请查看报告修复后重试', color: 'error' }
  }
  // Dry Run 运行中
  if (dryRunStatus === 'QUEUED' || dryRunStatus === 'RUNNING') {
    return { text: 'Dry Run 自动执行中，请等待完成', color: 'processing' }
  }
  // Dry Run 尚未发起但已有其他 blocker（如任务在 WAITING_PREFLIGHT 但 Dry Run 未创建）
  if (!dryRunStatus) {
    const blockerTexts = blockers
      .filter((b) => b.code !== 'TASK_NOT_READY' && b.code !== 'DRY_RUN_MISSING' && b.code !== 'CQ_PLUS_ONE_MISSING')
      .map((b) => preflightBlockerLabel(b.code))
    if (blockerTexts.length > 0) {
      return { text: blockerTexts[0], color: 'warning' }
    }
    return { text: 'Dry Run 尚未发起，等待系统自动触发', color: 'warning' }
  }

  // —— 第二优先级：Dry Run 状态 ——
  if (dryRunStatus === 'PASSED') {
    if (cqStatus === 'APPROVED') {
      // 检查是否还有其他 blockers（如 PREFLIGHT_CONTEXT_STALE）
      const hasStale = blockers.some((b) => b.code === 'PREFLIGHT_CONTEXT_STALE' || b.code === 'MR_SOURCE_HEAD_CHANGED')
      if (hasStale) {
        return { text: 'CQ+1 已通过，但提交上下文已变化，请重新预检', color: 'warning' }
      }
      return { text: 'CQ+1 已通过，系统正在创建 MR', color: 'success' }
    }
    if (cqStatus === 'REJECTED') {
      return { text: 'CQ+1 被拒绝，请按意见修改后重试', color: 'error' }
    }
    // CQ+1 缺失
    return { text: 'Dry Run 已通过，等待 CQ+1 审批', color: 'warning' }
  }

  return { text: '预检状态未知', color: 'default' }
}

const BLOCKER_LABEL: Record<PreflightBlockerCode, string> = {
  TASK_NOT_READY: '任务尚未完成代码提交，请等待 Task 产出并推送当前提交',
  DRY_RUN_MISSING: '尚未发起 Dry Run，请先对当前提交发起 Dry Run',
  DRY_RUN_QUEUED: 'Dry Run 排队中，请等待执行完成',
  DRY_RUN_RUNNING: 'Dry Run 运行中，请等待执行完成',
  DRY_RUN_FAILED: 'Dry Run 未通过，请查看报告修复后重新发起',
  CQ_PLUS_ONE_MISSING: '缺少独立成员的 CQ+1，请由非发起人审批该 Dry Run',
  CQ_PLUS_ONE_REJECTED: 'CQ+1 被拒绝，请按意见修改后重新 Dry Run + CQ+1',
  PREFLIGHT_CONTEXT_STALE: '提交上下文已变化，请重新发起 Dry Run 并重新 CQ+1',
  MR_SOURCE_HEAD_CHANGED: '源分支有新提交，请刷新 Task/Diff 后重新预检',
}

/** 已知 blocker code 给精准文案，未知 code 回退 message / code 本身 */
export function preflightBlockerLabel(code: string, message = ''): string {
  if (code in BLOCKER_LABEL) return BLOCKER_LABEL[code as PreflightBlockerCode]
  return message.trim() || code || '存在未满足的预检条件'
}

/** 判断某 code 是否需要「重新 Dry Run + CQ+1」的重置引导 */
export function requiresRedoDryRun(code: string): boolean {
  return code === 'PREFLIGHT_CONTEXT_STALE' || code === 'MR_SOURCE_HEAD_CHANGED' || code === 'CQ_PLUS_ONE_REJECTED'
}

/** 判断某 code 是否引导刷新 Task/Diff 而非自动重试创建 MR */
export function requiresSourceRefresh(code: string): boolean {
  return code === 'MR_SOURCE_HEAD_CHANGED'
}
