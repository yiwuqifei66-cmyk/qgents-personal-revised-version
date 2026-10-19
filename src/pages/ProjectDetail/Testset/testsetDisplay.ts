import type { DryRunStatus, TestCaseStatus, TestRunStatus, TestsetStatus } from '@/types/testset'

/** 决策 2 选项 1：页面展示启用态只看 status，不读 enabled */
export function isEnabledStatus(status: TestsetStatus): boolean {
  return status === 'ENABLED'
}

/** Testset 启用/停用标签 */
export function testsetStatusLabel(status: TestsetStatus): string {
  return status === 'ENABLED' ? '已启用' : '已停用'
}

/** 测试运行状态文案 */
export function testRunStatusLabel(status: TestRunStatus): string {
  const labels: Record<TestRunStatus, string> = {
    QUEUED: '排队中',
    RUNNING: '运行中',
    PASSED: '通过',
    FAILED: '失败',
    CANCELLED: '已取消',
  }
  return labels[status]
}

/** Dry-run 状态文案 */
export function dryRunStatusLabel(status: DryRunStatus): string {
  const labels: Record<DryRunStatus, string> = {
    QUEUED: '排队中',
    RUNNING: '运行中',
    PASSED: '通过',
    FAILED: '失败',
    CONFLICT: '冲突',
    CANCELLED: '已取消',
  }
  return labels[status]
}

/** Ant Design Tag 颜色 */
export function runStatusColor(
  status: TestRunStatus | DryRunStatus,
): 'default' | 'processing' | 'success' | 'error' | 'warning' {
  if (status === 'RUNNING' || status === 'QUEUED') return 'processing'
  if (status === 'PASSED') return 'success'
  if (status === 'FAILED') return 'error'
  if (status === 'CONFLICT') return 'warning'
  return 'default'
}

/** 单条用例状态文案 */
export function caseStatusLabel(status: TestCaseStatus): string {
  const labels: Record<TestCaseStatus, string> = {
    PASSED: '通过',
    FAILED: '失败',
    BLOCKED: '阻塞',
    SKIPPED: '跳过',
  }
  return labels[status]
}

export function caseStatusColor(
  status: TestCaseStatus,
): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'PASSED') return 'success'
  if (status === 'FAILED') return 'error'
  if (status === 'BLOCKED') return 'warning'
  return 'default'
}

/** 用例耗时：不足 1 秒显示毫秒 */
export function formatDurationMs(durationMs: number | null): string {
  if (durationMs == null || durationMs < 0) return '—'
  if (durationMs < 1000) return `${durationMs} ms`
  return formatDuration(Math.round(durationMs / 1000))
}

/** 把秒数格式成可读时长 */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds < 0) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分 ${rest} 秒`
  if (minutes === 0) return `${rest} 秒`
  return `${minutes} 分 ${rest} 秒`
}

/** 展示用时间：保留到分钟，避免时区换算导致测试抖动 */
export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return value.replace('T', ' ').replace('Z', '').slice(0, 16) || '—'
}

/** 优先用后端 durationSeconds；否则用开始/结束时间推算 */
export function resolveDurationSeconds(
  startedAt: string | null,
  finishedAt: string | null,
  reported: number | null = null,
): number | null {
  if (reported != null && reported >= 0) return reported
  if (!startedAt || !finishedAt) return null
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 1000)
}
