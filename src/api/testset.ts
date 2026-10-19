import { request } from './client'
import { withQuery } from './requestHelpers'
import type {
  CreateDryRunPayload,
  CreateTestRunPayload,
  CreateTestsetPayload,
  DryRunConflict,
  DryRunReport,
  DryRunReportBody,
  DryRunStatus,
  DryRunTestsPayload,
  TestCaseDetail,
  TestCaseStatus,
  TestCaseSummary,
  TestRun,
  TestRunArtifactRef,
  TestRunExecutionSummary,
  TestRunResultItem,
  TestRunStatus,
  Testset,
  TestsetListFilters,
  TestsetPassRule,
  TestsetStatus,
  UpdateTestsetPayload,
} from '@/types/testset'

/** 接口文档统一成功响应外壳：{ data, requestId } */
interface ApiEnvelope<T> {
  data: T
  requestId?: string
}

/**
 * 判断 Testset 是否启用。
 * 决策 2 选项 1：只用 status === 'ENABLED'，不读 enabled 布尔。
 */
export function isTestsetEnabled(testset: Pick<Testset, 'status'>): boolean {
  return testset.status === 'ENABLED'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? value : ''
}

function readNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function asList(data: unknown): unknown[] {
  return Array.isArray(data) ? data : []
}

/**
 * 把后端 Testset JSON 收成前端类型。
 * 若后端误带 enabled 布尔、漏 status，只在映射层补 status，页面仍然只认 status。
 */
export function mapTestset(raw: unknown): Testset {
  const row = isRecord(raw) ? raw : {}
  const definition = isRecord(row.definition) ? row.definition : {}
  const statusRaw = row.status
  const status: TestsetStatus =
    statusRaw === 'ENABLED' || statusRaw === 'DISABLED'
      ? statusRaw
      : row.enabled === false
        ? 'DISABLED'
        : 'ENABLED'
  const createdBy = readString(row, 'createdBy')

  return {
    id: readString(row, 'id'),
    projectId: readString(row, 'projectId'),
    name: readString(row, 'name'),
    repositoryId: readString(row, 'repositoryId'),
    /** 创建请求有 scopeTags；确认项：当前已回传 */
    scopeTags: readStringArray(row.scopeTags),
    command: readString(row, 'command') || readString(definition, 'command'),
    timeoutSeconds: readNumber(row, 'timeoutSeconds') || readNumber(definition, 'timeoutSeconds') || 900,
    passRule: mapPassRule(row.passRule ?? definition.passRule),
    acceptanceNotes: readString(row, 'acceptanceNotes') || readString(definition, 'acceptanceNotes'),
    status,
    createdBy: createdBy || undefined,
    createdAt: readString(row, 'createdAt'),
    updatedAt: readString(row, 'updatedAt'),
  }
}

/** 解析 passRule；缺省按文档示例 EXIT_CODE / 0 */
function mapPassRule(raw: unknown): TestsetPassRule {
  const row = isRecord(raw) ? raw : {}
  return {
    type: 'EXIT_CODE',
    expected: typeof row.expected === 'number' ? row.expected : 0,
  }
}

function mapTestRunStatus(value: unknown): TestRunStatus {
  if (value === 'QUEUED' || value === 'RUNNING' || value === 'FAILED' || value === 'CANCELLED') {
    return value
  }
  if (value === 'SUCCEEDED' || value === 'PASSED') return 'PASSED'
  return 'QUEUED'
}

function mapDryRunStatus(value: unknown): DryRunStatus {
  if (
    value === 'QUEUED' ||
    value === 'RUNNING' ||
    value === 'FAILED' ||
    value === 'CONFLICT' ||
    value === 'CANCELLED'
  ) {
    return value
  }
  if (value === 'SUCCEEDED' || value === 'PASSED') return 'PASSED'
  return 'QUEUED'
}

function mapCaseSummary(raw: unknown): TestCaseSummary | null {
  if (!isRecord(raw)) return null
  const passed = readNumber(raw, 'passed')
  const failed = readNumber(raw, 'failed')
  const blocked = readNumber(raw, 'blocked')
  const skipped = readNumber(raw, 'skipped')
  const total = readNumber(raw, 'total') || passed + failed + blocked + skipped
  return { passed, failed, blocked, skipped, total }
}

function mapArtifacts(raw: unknown): TestRunArtifactRef[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!isRecord(item)) return []
    const name = readString(item, 'name')
    const url = readString(item, 'url')
    const contentType = readString(item, 'contentType') || null
    return name && url ? [{ name, url, contentType }] : []
  })
}

function mapCaseStatus(value: unknown): TestCaseStatus {
  if (value === 'PASSED' || value === 'FAILED' || value === 'BLOCKED' || value === 'SKIPPED') {
    return value
  }
  if (value === 'SUCCEEDED') return 'PASSED'
  return 'SKIPPED'
}

/** cases 或 caseDetails；文档尚未写死，缺省为空 */
function mapCases(raw: unknown): TestCaseDetail[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const name = readString(item, 'name') || readString(item, 'title')
    if (!name) return []
    const durationRaw = item.durationMs ?? item.durationMillis
    return [
      {
        id: readString(item, 'id') || `case-${index + 1}`,
        name,
        testsetId: readString(item, 'testsetId') || null,
        suite: readString(item, 'suite') || readString(item, 'className') || null,
        status: mapCaseStatus(item.status),
        durationMs: typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : null,
        message: readString(item, 'message') || readString(item, 'error') || null,
        filePath: readString(item, 'filePath') || readString(item, 'file') || null,
      },
    ]
  })
}

function readPdfUrl(row: Record<string, unknown>, artifacts: TestRunArtifactRef[]): string | null {
  const direct = readString(row, 'pdfUrl') || readString(row, 'reportPdfUrl')
  if (direct) return direct
  const pdfArtifact = artifacts.find(
    (item) =>
      item.contentType === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'),
  )
  return pdfArtifact?.url ?? null
}

/** sandboxId 或 sandbox.id；文档未保证该字段，缺省为 null */
function readSandboxId(row: Record<string, unknown>): string | null {
  const direct = readString(row, 'sandboxId')
  if (direct) return direct
  const sandbox = row.sandbox
  if (!isRecord(sandbox)) return null
  return readString(sandbox, 'id') || null
}

function readNullableNumber(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function mapTestRunResultItem(raw: unknown): TestRunResultItem | null {
  if (!isRecord(raw)) return null
  const testsetId = readString(raw, 'testsetId')
  if (!testsetId) return null
  return {
    testsetId,
    status: mapTestRunStatus(raw.status),
    exitCode: readNullableNumber(raw, 'exitCode'),
    durationMs: readNullableNumber(raw, 'durationMs'),
    failureCode: readString(raw, 'failureCode') || null,
  }
}

/**
 * 解析 Test Run / Dry Run tests 的执行摘要。
 * 对象 summary 为正式路径；纯字符串 summary 本轮忽略（不展示原始文案）。
 */
export function mapTestRunExecutionSummary(raw: unknown): TestRunExecutionSummary | null {
  if (!isRecord(raw)) return null
  // 旧文档曾把 summary 当 string；确认项要求结构化对象
  if (!('results' in raw) && !('resolvedHeadCommit' in raw) && !('status' in raw)) return null
  const resultsRaw = raw.results
  const results = Array.isArray(resultsRaw)
    ? resultsRaw.flatMap((item) => {
      const mapped = mapTestRunResultItem(item)
      return mapped ? [mapped] : []
    })
    : []
  return {
    status: mapTestRunStatus(raw.status),
    resolvedHeadCommit: readString(raw, 'resolvedHeadCommit') || null,
    results,
  }
}

function mapDryRunTests(raw: unknown): DryRunTestsPayload | null {
  if (!isRecord(raw)) return null
  const status = raw.status
  if (status === 'NOT_REQUIRED' || status === 'SKIPPED') {
    const reason = raw.reason === 'MERGE_CONFLICT' ? 'MERGE_CONFLICT' : null
    return { status, results: [], reason }
  }
  return mapTestRunExecutionSummary(raw)
}

function mapDryRunReportBody(raw: unknown): DryRunReportBody | null {
  if (!isRecord(raw)) return null
  return {
    targetCommit: readString(raw, 'targetCommit') || null,
    mergeable: typeof raw.mergeable === 'boolean' ? raw.mergeable : null,
    conflicts: mapConflicts(raw.conflicts),
    tests: mapDryRunTests(raw.tests),
    failureCode: readString(raw, 'failureCode') || null,
  }
}

/** 把 GET test-run 响应收成 TestRun */
export function mapTestRun(raw: unknown): TestRun {
  const row = isRecord(raw) ? raw : {}
  const artifacts = mapArtifacts(row.artifacts)
  const executionSummary = mapTestRunExecutionSummary(row.summary)
  const testsetIds = readStringArray(row.testsetIds)
  const fromResults = executionSummary?.results.map((item) => item.testsetId) ?? []

  const createdAt = readString(row, 'createdAt')
  const updatedAt = readString(row, 'updatedAt')

  // 后端 TestRunResponse 当前不返回 startedAt/finishedAt/updatedAt，
  // 前端用 available 字段做合理兜底，保证终态时能展示时间
  const rawStartedAt = readString(row, 'startedAt')
  const rawFinishedAt = readString(row, 'finishedAt')

  // 优先使用后端显式返回的 startedAt
  let startedAt: string | null = rawStartedAt || null
  // finishedAt 优先使用后端显式返回，其次用 updatedAt（如果存在）
  let finishedAt: string | null = rawFinishedAt || updatedAt || null
  // 注意：不使用 createdAt 兜底 startedAt——创建时间不是开始执行时间（QUEUED 未开始时
  // startedAt 应为空），且历史 updated_at 曾混入本地时区导致「运行时长」误显示 28800s。

  return {
    id: readString(row, 'id'),
    projectId: readString(row, 'projectId'),
    repositoryId: readString(row, 'repositoryId'),
    testsetIds: testsetIds.length > 0 ? testsetIds : fromResults,
    taskId: readString(row, 'taskId') || null,
    ref: readString(row, 'ref') || null,
    status: mapTestRunStatus(row.status),
    executionSummary,
    createdBy: readString(row, 'createdBy') || readString(row, 'creator') || null,
    createdAt,
    caseSummary: mapCaseSummary(row.caseSummary),
    cases: mapCases(row.cases ?? row.caseDetails),
    artifacts,
    reportUrl: readString(row, 'reportUrl') || null,
    pdfUrl: readPdfUrl(row, artifacts),
    startedAt,
    finishedAt,
    sandboxId: readSandboxId(row),
  }
}

function mapConflicts(raw: unknown): DryRunConflict[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ path: item, message: '' }]
    }
    if (!isRecord(item)) return []
    const path = readString(item, 'path') || readString(item, 'file')
    const message = readString(item, 'message') || readString(item, 'reason')
    return path || message ? [{ path, message }] : []
  })
}

/**
 * 把 GET dry-run report 响应收成 DryRunReport。
 * 对齐 API 文档 §32.1：响应字段为 id / status / headCommit / targetBranch / targetCommit / attemptCount / createdAt / updatedAt / report。
 * 兼容旧字段名（sourceRef / startedAt / finishedAt / durationSeconds / testsetIds / createdBy）。
 */
export function mapDryRunReport(raw: unknown): DryRunReport {
  const row = isRecord(raw) ? raw : {}
  const nested = mapDryRunReportBody(row.report)
  const topConflicts = mapConflicts(row.conflicts)
  const conflicts = nested?.conflicts.length ? nested.conflicts : topConflicts
  const tests = nested?.tests ?? null
  const testsetIdsFromTests =
    tests && Array.isArray(tests.results)
      ? tests.results.map((item) => item.testsetId).filter(Boolean)
      : []

  // 按 API 文档：sourceRef ← headCommit（源提交 SHA），旧字段 sourceRef 作兜底
  const sourceRef = readString(row, 'headCommit') || readString(row, 'sourceRef')

  // 按 API 文档：时间字段为 createdAt / updatedAt，旧字段 startedAt / finishedAt 作兜底
  const createdAt = readString(row, 'createdAt')
  const updatedAt = readString(row, 'updatedAt')
  const startedAt = createdAt || readString(row, 'startedAt') || null
  const finishedAt = updatedAt || readString(row, 'finishedAt') || null

  // durationSeconds：优先用后端直接返回值；否则从时间戳计算
  let durationSeconds: number | null = null
  if (typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds)) {
    durationSeconds = row.durationSeconds
  } else if (startedAt && finishedAt) {
    const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    if (Number.isFinite(ms) && ms > 0) durationSeconds = Math.round(ms / 1000)
  }

  return {
    id: readString(row, 'id') || readString(row, 'dryRunId'),
    projectId: readString(row, 'projectId'),
    repositoryId: readString(row, 'repositoryId'),
    sourceRef,
    targetBranch: readString(row, 'targetBranch'),
    taskId: readString(row, 'taskId') || null,
    status: mapDryRunStatus(row.status),
    report: nested,
    conflicts,
    createdBy: readString(row, 'createdBy') || readString(row, 'creator') || null,
    caseSummary: mapCaseSummary(row.caseSummary) ?? mapCaseSummary(row.testSummary),
    cases: mapCases(row.cases ?? row.caseDetails),
    reportUrl: readString(row, 'reportUrl') || null,
    pdfUrl: readPdfUrl(row, mapArtifacts(row.artifacts)),
    startedAt,
    finishedAt,
    durationSeconds,
    sandboxId: readSandboxId(row),
    testsetIds: readStringArray(row.testsetIds).length
      ? readStringArray(row.testsetIds)
      : testsetIdsFromTests,
    createdAt,
  }
}

function mapTestsetList(data: unknown): Testset[] {
  return asList(data).map(mapTestset)
}

/** enable/disable 可能 204 无 body，也可能返回更新后的对象 */
function mapOptionalTestset(res: ApiEnvelope<unknown> | undefined): Testset | undefined {
  if (!res || !('data' in res) || res.data === undefined) return undefined
  return mapTestset(res.data)
}

/**
 * Testset / 受控测试运行 / Dry-run API
 * 组件只走本文件，不得直接读 Mock fixture。
 */
export const testsetApi = {
  /**
   * GET /projects/{projectId}/testsets
   * 支持 repositoryId、status（ENABLED/DISABLED）过滤。
   */
  list(projectId: string, filters: TestsetListFilters = {}) {
    const query: Record<string, string> = {}
    if (filters.repositoryId) query.repositoryId = filters.repositoryId
    if (filters.status) query.status = filters.status
    return request<ApiEnvelope<unknown>>(withQuery(`/projects/${projectId}/testsets`, query), {
      unwrapData: false,
    }).then((res) => mapTestsetList(res.data))
  },

  /** GET /projects/{projectId}/testsets/{testsetId} */
  getById(projectId: string, testsetId: string) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/testsets/${testsetId}`, {
      unwrapData: false,
    }).then((res) => mapTestset(res.data))
  },

  /** POST /projects/{projectId}/testsets —— Project Admin */
  create(projectId: string, payload: CreateTestsetPayload) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/testsets`, {
      method: 'POST',
      unwrapData: false,
      body: payload,
    }).then((res) => mapTestset(res.data))
  },

  /** PATCH /projects/{projectId}/testsets/{testsetId} —— Project Admin */
  update(projectId: string, testsetId: string, payload: UpdateTestsetPayload) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/testsets/${testsetId}`, {
      method: 'PATCH',
      unwrapData: false,
      body: payload,
    }).then((res) => mapTestset(res.data))
  },

  /** POST .../enable —— Project Admin；204 或返回更新后的 Testset 都视为成功 */
  enable(projectId: string, testsetId: string) {
    return request<ApiEnvelope<unknown> | undefined>(
      `/projects/${projectId}/testsets/${testsetId}/enable`,
      { method: 'POST', unwrapData: false },
    ).then(mapOptionalTestset)
  },

  /** POST .../disable —— Project Admin */
  disable(projectId: string, testsetId: string) {
    return request<ApiEnvelope<unknown> | undefined>(
      `/projects/${projectId}/testsets/${testsetId}/disable`,
      { method: 'POST', unwrapData: false },
    ).then(mapOptionalTestset)
  },

  /** DELETE .../{testsetId} —— 删除未被门禁引用的 Testset；约定 204 */
  remove(projectId: string, testsetId: string) {
    return request<void>(`/projects/${projectId}/testsets/${testsetId}`, {
      method: 'DELETE',
    })
  },

  /**
   * POST /projects/{projectId}/test-runs
   * 对指定提交或 Task 发起已启用 Testset 的受控运行。
   */
  createTestRun(projectId: string, payload: CreateTestRunPayload) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/test-runs`, {
      method: 'POST',
      unwrapData: false,
      body: payload,
    }).then((res) => mapTestRun(res.data))
  },

  /** GET /projects/{projectId}/test-runs/{testRunId} */
  getTestRun(projectId: string, testRunId: string) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/test-runs/${testRunId}`, {
      unwrapData: false,
    }).then((res) => mapTestRun(res.data))
  },

  /** GET /projects/{projectId}/test-runs —— 列表 */
  listTestRuns(projectId: string, filters: { status?: string; limit?: number } = {}) {
    const query: Record<string, string> = {}
    if (filters.status) query.status = filters.status
    if (filters.limit) query.limit = String(filters.limit)
    return request<ApiEnvelope<unknown[]>>(withQuery(`/projects/${projectId}/test-runs`, query), {
      unwrapData: false,
    }).then((res) => asList(res.data).map(mapTestRun))
  },

  /**
   * POST /projects/{projectId}/dry-runs
   * 针对源分支和目标分支发起合并前试运行。
   */
  createDryRun(projectId: string, payload: CreateDryRunPayload) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/dry-runs`, {
      method: 'POST',
      unwrapData: false,
      body: payload,
    }).then((res) => mapDryRunReport(res.data))
  },

  /** GET /projects/{projectId}/dry-runs/{dryRunId}/report —— 冲突、测试摘要 */
  getDryRunReport(projectId: string, dryRunId: string) {
    return request<ApiEnvelope<unknown>>(`/projects/${projectId}/dry-runs/${dryRunId}/report`, {
      unwrapData: false,
    }).then((res) => mapDryRunReport(res.data))
  },

  /** GET /projects/{projectId}/dry-runs —— 列表 */
  listDryRuns(projectId: string, filters: { status?: string; limit?: number } = {}) {
    const query: Record<string, string> = {}
    if (filters.status) query.status = filters.status
    if (filters.limit) query.limit = String(filters.limit)
    return request<ApiEnvelope<unknown[]>>(withQuery(`/projects/${projectId}/dry-runs`, query), {
      unwrapData: false,
    }).then((res) => asList(res.data).map(mapDryRunReport))
  },
}
