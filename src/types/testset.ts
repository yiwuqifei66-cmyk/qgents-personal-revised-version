/**
 * Testset / Test Run / Dry Run
 * 口径：docs/frontend/testset-frontend-confirm.md（2026-08-17 前端确认项）
 *
 * repositoryId 一律使用 project_repositories.id（项目绑定 UUID）。
 * 启用态只用 status === 'ENABLED'，不读 enabled 布尔。
 */

/** Testset 启用状态（后端枚举） */
export type TestsetStatus = 'ENABLED' | 'DISABLED'

/** 测试运行 / summary.results 项状态 */
export type TestRunStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED'

/**
 * Dry-run 顶层状态。
 * 后端确认枚举为 QUEUED|RUNNING|PASSED|FAILED|CANCELLED；
 * CONFLICT 仅作前端展示派生（mergeable=false / MERGE_CONFLICT），不表示测试失败。
 */
export type DryRunStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CONFLICT' | 'CANCELLED'

/** 通过规则：文档创建示例为 EXIT_CODE + expected */
export interface TestsetPassRule {
  type: 'EXIT_CODE'
  expected: number
}

/**
 * GET/POST/PATCH /projects/{projectId}/testsets
 */
export interface Testset {
  id: string
  projectId: string
  name: string
  /** project_repositories.id */
  repositoryId: string
  scopeTags: string[]
  command: string
  timeoutSeconds: number
  passRule: TestsetPassRule
  acceptanceNotes: string
  status: TestsetStatus
  createdBy?: string
  createdAt: string
  updatedAt: string
}
// 创建测试运行的请求
//payloadpayload真正要传输的数据本体
export interface CreateTestsetPayload {
  name: string
  repositoryId: string
  scopeTags: string[]
  command: string
  timeoutSeconds: number
  passRule: TestsetPassRule
  acceptanceNotes: string
}

export type UpdateTestsetPayload = Partial<CreateTestsetPayload>

export interface TestsetListFilters {
  repositoryId?: string
  status?: TestsetStatus
}

export interface CreateTestRunPayload {
  repositoryId: string
  testsetIds: string[]
  taskId?: string
  ref?: string
}

/** 本轮暂缓：逐用例统计；有则展示，无则空态 */
export interface TestCaseSummary {
  passed: number
  failed: number
  blocked: number
  skipped: number
  total: number
}

export type TestCaseStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'

export interface TestCaseDetail {
  id: string
  name: string
  testsetId: string | null
  suite: string | null
  status: TestCaseStatus
  durationMs: number | null
  message: string | null
  filePath: string | null
}

export interface TestRunArtifactRef {
  name: string
  url: string
  contentType: string | null
}

/** GET test-runs 的 summary 对象（确认项 §2.2） */
export interface TestRunResultItem {
  testsetId: string
  status: TestRunStatus
  exitCode: number | null
  durationMs: number | null
  failureCode: string | null
}

export interface TestRunExecutionSummary {
  status: TestRunStatus
  resolvedHeadCommit: string | null
  results: TestRunResultItem[]
}

/** GET /projects/{projectId}/test-runs/{testRunId} */
export interface TestRun {
  id: string
  projectId: string
  repositoryId: string
  testsetIds: string[]
  /** GET 本轮可能不回传；有则展示 */
  taskId: string | null
  ref: string | null
  status: TestRunStatus
  /** 结构化执行摘要；字段均可空 */
  executionSummary: TestRunExecutionSummary | null
  createdBy: string | null
  createdAt: string
  caseSummary: TestCaseSummary | null
  cases: TestCaseDetail[]
  artifacts: TestRunArtifactRef[]
  reportUrl: string | null
  pdfUrl: string | null
  startedAt: string | null
  finishedAt: string | null
  sandboxId: string | null
}

export interface CreateDryRunPayload {
  repositoryId: string
  sourceRef: string
  targetBranch: string
  taskId?: string
  /** 用户手动指定的测试集；若不传则由服务端按目标分支门禁自动加载 */
  testsetIds?: string[]
}

export interface DryRunConflict {
  path: string
  message: string
}

/** Dry-run report.tests：执行摘要，或未跑测试的占位 */
export type DryRunTestsPayload =
  | TestRunExecutionSummary
  | {
    status: 'NOT_REQUIRED' | 'SKIPPED'
    results: TestRunResultItem[]
    reason: 'MERGE_CONFLICT' | null
  }

/** 嵌套 report（确认项 §2.3） */
export interface DryRunReportBody {
  targetCommit: string | null
  mergeable: boolean | null
  conflicts: DryRunConflict[]
  tests: DryRunTestsPayload | null
  failureCode: string | null
}

/** GET /projects/{projectId}/dry-runs/{dryRunId}/report */
export interface DryRunReport {
  id: string
  projectId: string
  repositoryId: string
  sourceRef: string
  targetBranch: string
  taskId: string | null
  status: DryRunStatus
  /** 后端真实报告体；QUEUED/RUNNING 时常为 null */
  report: DryRunReportBody | null
  /** 兼容：从 report.conflicts 抽出，供冲突 Tab */
  conflicts: DryRunConflict[]
  createdBy: string | null
  caseSummary: TestCaseSummary | null
  cases: TestCaseDetail[]
  reportUrl: string | null
  pdfUrl: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  durationSeconds: number | null
  sandboxId: string | null
  testsetIds: string[]
}

/** 本设备会话历史（非权威跨设备列表） */
export type LocalRunKind = 'TEST_RUN' | 'DRY_RUN'

export interface LocalRunHistoryItem {
  kind: LocalRunKind
  id: string
  repositoryId: string
  createdAt: string
  label: string
}

/** 是否为「未执行测试」占位（冲突跳过 / 未配置必选 Testset） */
export function isDryRunTestsSkipped(
  tests: DryRunTestsPayload | null,
): tests is Extract<DryRunTestsPayload, { status: 'NOT_REQUIRED' | 'SKIPPED' }> {
  return Boolean(tests && (tests.status === 'NOT_REQUIRED' || tests.status === 'SKIPPED'))
}

/** 从 Dry Run 报告判断应展示冲突（不是测试失败） */
export function dryRunHasMergeConflict(report: Pick<DryRunReport, 'report' | 'conflicts'>): boolean {
  if (report.report?.mergeable === false) return true
  if (report.conflicts.length > 0) return true
  const tests = report.report?.tests
  return Boolean(tests && isDryRunTestsSkipped(tests) && tests.reason === 'MERGE_CONFLICT')
}
