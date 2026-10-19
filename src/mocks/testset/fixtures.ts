import type { DryRunReport, TestRun, TestRunExecutionSummary, Testset } from '@/types/testset'

const NOW = '2026-08-15T02:00:00Z'

/** 尽量与现有项目绑定 Mock 对齐，避免卡片仓库名对不上 */
export function mockBoundRepositoryId(projectId: string): string {
  if (projectId === 'demo-project' || projectId === 'proj-001') return 'bound-demo-auth-service'
  return `bound-${projectId}-repository-1`
}

export function createMockTestset(projectId: string, status: Testset['status'] = 'ENABLED'): Testset {
  return {
    id: `testset-${projectId}-login`,
    projectId,
    name: '登录接口测试',
    repositoryId: mockBoundRepositoryId(projectId),
    scopeTags: ['api'],
    command: './mvnw test',
    timeoutSeconds: 900,
    passRule: { type: 'EXIT_CODE', expected: 0 },
    acceptanceNotes: '覆盖登录成功与错误密码。',
    status,
    createdBy: 'user-001',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** 确认项：scopeTags 已回传 */
export function toTestsetResponse(item: Testset): Record<string, unknown> {
  return {
    id: item.id,
    projectId: item.projectId,
    repositoryId: item.repositoryId,
    name: item.name,
    scopeTags: item.scopeTags,
    command: item.command,
    timeoutSeconds: item.timeoutSeconds,
    passRule: item.passRule,
    acceptanceNotes: item.acceptanceNotes,
    status: item.status,
    createdBy: item.createdBy ?? 'user-001',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function defaultExecutionSummary(
  projectId: string,
  status: TestRun['status'] = 'PASSED',
): TestRunExecutionSummary {
  const testsetId = `testset-${projectId}-login`
  return {
    status,
    resolvedHeadCommit: 'a1b2c3d4e5f6789012345678abcdef0123456789',
    results: [
      {
        testsetId,
        status,
        exitCode: status === 'PASSED' ? 0 : 254,
        durationMs: status === 'PASSED' ? 1200 : 279,
        failureCode: status === 'PASSED' ? null : 'UNEXPECTED_EXIT_CODE',
      },
    ],
  }
}

export function createMockTestRun(projectId: string, input: Partial<TestRun> = {}): TestRun {
  const status = input.status ?? 'PASSED'
  const executionSummary = input.executionSummary ?? defaultExecutionSummary(projectId, status)
  return {
    id: input.id ?? `testrun-${projectId}-1`,
    projectId,
    repositoryId: input.repositoryId ?? mockBoundRepositoryId(projectId),
    testsetIds: input.testsetIds ?? [`testset-${projectId}-login`],
    taskId: input.taskId ?? null,
    ref: input.ref ?? 'feat/login-api',
    status,
    executionSummary,
    createdBy: input.createdBy ?? 'user-001',
    createdAt: input.createdAt ?? NOW,
    caseSummary: null,
    cases: [],
    artifacts: [],
    reportUrl: null,
    pdfUrl: null,
    startedAt: null,
    finishedAt: null,
    sandboxId: null,
  }
}

export function toTestRunResponse(run: TestRun): Record<string, unknown> {
  return {
    id: run.id,
    projectId: run.projectId,
    repositoryId: run.repositoryId,
    ref: run.ref,
    testsetIds: run.testsetIds,
    status: run.status,
    summary: run.executionSummary,
    createdBy: run.createdBy,
    createdAt: run.createdAt,
  }
}

export function createMockDryRunReport(projectId: string, input: Partial<DryRunReport> = {}): DryRunReport {
  const status = input.status ?? 'PASSED'
  const executionSummary = defaultExecutionSummary(projectId, status === 'CONFLICT' ? 'FAILED' : status)
  const report =
    input.report ??
    (status === 'CONFLICT'
      ? {
        targetCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        mergeable: false,
        conflicts: [{ path: 'src/Auth.ts', message: '双方都修改了 login' }],
        tests: { status: 'SKIPPED' as const, results: [], reason: 'MERGE_CONFLICT' as const },
        failureCode: null,
      }
      : {
        targetCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        mergeable: true,
        conflicts: [],
        tests: executionSummary,
        failureCode: null,
      })
  return {
    id: input.id ?? `dryrun-${projectId}-1`,
    projectId,
    repositoryId: input.repositoryId ?? mockBoundRepositoryId(projectId),
    sourceRef: input.sourceRef ?? 'feat/login-api',
    targetBranch: input.targetBranch ?? 'main',
    taskId: input.taskId ?? null,
    status: status === 'CONFLICT' ? 'FAILED' : status,
    report,
    conflicts: report.conflicts,
    createdBy: input.createdBy ?? null,
    caseSummary: null,
    cases: [],
    reportUrl: null,
    pdfUrl: null,
    startedAt: null,
    finishedAt: null,
    durationSeconds: null,
    sandboxId: null,
    testsetIds: input.testsetIds ?? [`testset-${projectId}-login`],
    createdAt: input.createdAt ?? NOW,
  }
}

export function toDryRunReportResponse(report: DryRunReport): Record<string, unknown> {
  return {
    id: report.id,
    projectId: report.projectId,
    repositoryId: report.repositoryId,
    sourceRef: report.sourceRef,
    targetBranch: report.targetBranch,
    status: report.status,
    createdBy: report.createdBy,
    createdAt: report.createdAt,
    report: report.report,
  }
}
