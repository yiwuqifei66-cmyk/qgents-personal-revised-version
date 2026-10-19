import { http, HttpResponse, type HttpHandler, type PathParams } from 'msw'
import type { DryRunReport, TestRun, Testset, TestsetStatus } from '@/types/testset'
import type { BranchPolicy, DryRunCqResult, QualityGateConfig } from '@/types/qualityGate'
import { createMockDryRunReport, createMockTestRun, createMockTestset, toDryRunReportResponse, toTestRunResponse, toTestsetResponse } from './fixtures'

interface TestsetStore {
  testsets: Testset[]
  testRuns: Map<string, TestRun>
  dryRuns: Map<string, DryRunReport>
  branchPolicies: Map<string, BranchPolicy>
  qualityGates: Map<string, QualityGateConfig>
}

const stores = new Map<string, TestsetStore>()

function pathParam(params: PathParams, key: string): string {
  const value = params[key]
  return typeof value === 'string' ? value : ''
}

function envelope<T>(data: T, status = 200) {
  return HttpResponse.json({ data, requestId: 'mock-testset-request' }, { status })
}

function error(status: 404 | 409 | 422, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, details: [] }, requestId: 'mock-testset-request' }, { status })
}

function storeFor(projectId: string): TestsetStore {
  const existing = stores.get(projectId)
  if (existing) return existing
  const seededRun = createMockTestRun(projectId)
  const seededDryRun = createMockDryRunReport(projectId)
  const created: TestsetStore = {
    testsets: [createMockTestset(projectId)],
    testRuns: new Map([[seededRun.id, seededRun]]),
    dryRuns: new Map([[seededDryRun.id, seededDryRun]]),
    branchPolicies: new Map(),
    qualityGates: new Map(),
  }
  stores.set(projectId, created)
  return created
}

function policyKey(repositoryId: string, branch: string): string {
  return `${repositoryId}\0${branch}`
}

function defaultPolicy(): BranchPolicy {
  return { requirePullRequest: true, minimumHumanApprovals: 1, allowDirectPush: false }
}

function defaultGate(): QualityGateConfig {
  return {
    requirePullRequest: true,
    requiredChecks: ['AI_REVIEW'],
    requiredTestsetIds: [],
    minimumHumanApprovals: 1,
    allowDirectPush: false,
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const data: unknown = await request.json().catch(() => ({}))
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 测试之间清空内存 Store */
export function resetTestsetStores(): void {
  stores.clear()
}

export const testsetHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/testsets', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const search = new URL(request.url).searchParams
    const repositoryId = search.get('repositoryId')
    const status = search.get('status')
    const data = storeFor(projectId).testsets.filter((item) => {
      if (repositoryId && item.repositoryId !== repositoryId) return false
      if (status === 'ENABLED' || status === 'DISABLED') return item.status === status
      return true
    })
    return envelope(data.map(toTestsetResponse))
  }),

  http.post('*/api/projects/:projectId/testsets', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const body = await readBody(request)
    const name = asString(body.name).trim()
    const repositoryId = asString(body.repositoryId)
    const command = asString(body.command).trim()
    if (!name || !repositoryId || !command) return error(422, 'VALIDATION_FAILED', 'name、repositoryId、command 必填')
    const now = new Date().toISOString()
    const passRuleRaw = body.passRule
    const expected =
      passRuleRaw && typeof passRuleRaw === 'object' && !Array.isArray(passRuleRaw)
        ? Number((passRuleRaw as { expected?: unknown }).expected) || 0
        : 0
    const item: Testset = {
      id: `testset-${projectId}-${Date.now()}`,
      projectId,
      name,
      repositoryId,
      scopeTags: asStringArray(body.scopeTags),
      command,
      timeoutSeconds: typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : 900,
      passRule: { type: 'EXIT_CODE', expected },
      acceptanceNotes: asString(body.acceptanceNotes),
      status: 'DISABLED',
      createdAt: now,
      updatedAt: now,
    }
    storeFor(projectId).testsets.push(item)
    return envelope(toTestsetResponse(item), 201)
  }),

  http.get('*/api/projects/:projectId/testsets/:testsetId', ({ params }) => {
    const projectId = pathParam(params, 'projectId')
    const item = storeFor(projectId).testsets.find((row) => row.id === pathParam(params, 'testsetId'))
    return item ? envelope(toTestsetResponse(item)) : error(404, 'TESTSET_NOT_FOUND', 'Testset not found')
  }),

  http.patch('*/api/projects/:projectId/testsets/:testsetId', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const item = storeFor(projectId).testsets.find((row) => row.id === pathParam(params, 'testsetId'))
    if (!item) return error(404, 'TESTSET_NOT_FOUND', 'Testset not found')
    const body = await readBody(request)
    if (asString(body.name)) item.name = asString(body.name).trim()
    if (asString(body.repositoryId)) item.repositoryId = asString(body.repositoryId)
    if (asString(body.command)) item.command = asString(body.command).trim()
    if (typeof body.timeoutSeconds === 'number') item.timeoutSeconds = body.timeoutSeconds
    if (Array.isArray(body.scopeTags)) item.scopeTags = asStringArray(body.scopeTags)
    if (typeof body.acceptanceNotes === 'string') item.acceptanceNotes = body.acceptanceNotes
    item.updatedAt = new Date().toISOString()
    return envelope(toTestsetResponse(item))
  }),

  http.post('*/api/projects/:projectId/testsets/:testsetId/enable', ({ params }) => {
    const item = storeFor(pathParam(params, 'projectId')).testsets.find((row) => row.id === pathParam(params, 'testsetId'))
    if (!item) return error(404, 'TESTSET_NOT_FOUND', 'Testset not found')
    item.status = 'ENABLED' satisfies TestsetStatus
    item.updatedAt = new Date().toISOString()
    return envelope(toTestsetResponse(item))
  }),

  http.post('*/api/projects/:projectId/testsets/:testsetId/disable', ({ params }) => {
    const item = storeFor(pathParam(params, 'projectId')).testsets.find((row) => row.id === pathParam(params, 'testsetId'))
    if (!item) return error(404, 'TESTSET_NOT_FOUND', 'Testset not found')
    item.status = 'DISABLED'
    item.updatedAt = new Date().toISOString()
    return envelope(toTestsetResponse(item))
  }),

  http.delete('*/api/projects/:projectId/testsets/:testsetId', ({ params }) => {
    const projectId = pathParam(params, 'projectId')
    const store = storeFor(projectId)
    const index = store.testsets.findIndex((row) => row.id === pathParam(params, 'testsetId'))
    if (index < 0) return error(404, 'TESTSET_NOT_FOUND', 'Testset not found')
    store.testsets.splice(index, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('*/api/projects/:projectId/test-runs', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const body = await readBody(request)
    const repositoryId = asString(body.repositoryId)
    const testsetIds = asStringArray(body.testsetIds)
    const taskId = asString(body.taskId)
    const ref = asString(body.ref)
    if (!repositoryId || testsetIds.length === 0) return error(422, 'VALIDATION_FAILED', 'repositoryId 与 testsetIds 必填')
    if (!taskId && !ref) return error(422, 'VALIDATION_FAILED', '必须提供 taskId 或 ref 之一')
    const enabledIds = new Set(
      storeFor(projectId)
        .testsets.filter((item) => item.repositoryId === repositoryId && item.status === 'ENABLED')
        .map((item) => item.id),
    )
    if (testsetIds.some((id) => !enabledIds.has(id))) {
      return error(422, 'VALIDATION_FAILED', 'testsetIds 必须属于该仓库且为 ENABLED')
    }
    const run = createMockTestRun(projectId, {
      id: `testrun-${projectId}-${Date.now()}`,
      repositoryId,
      testsetIds,
      taskId: taskId || null,
      ref: ref || null,
      status: 'PASSED',
    })
    storeFor(projectId).testRuns.set(run.id, run)
    return envelope(toTestRunResponse(run), 201)
  }),

  http.get('*/api/projects/:projectId/test-runs/:testRunId', ({ params }) => {
    const run = storeFor(pathParam(params, 'projectId')).testRuns.get(pathParam(params, 'testRunId'))
    return run ? envelope(toTestRunResponse(run)) : error(404, 'TEST_RUN_NOT_FOUND', 'Test run not found')
  }),

  http.post('*/api/projects/:projectId/dry-runs', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const body = await readBody(request)
    const repositoryId = asString(body.repositoryId)
    const sourceRef = asString(body.sourceRef)
    const targetBranch = asString(body.targetBranch)
    if (!repositoryId || !sourceRef || !targetBranch) {
      return error(422, 'VALIDATION_FAILED', 'repositoryId、sourceRef、targetBranch 必填')
    }
    const report = createMockDryRunReport(projectId, {
      id: `dryrun-${projectId}-${Date.now()}`,
      repositoryId,
      sourceRef,
      targetBranch,
      taskId: asString(body.taskId) || null,
      status: 'PASSED',
      conflicts: [],
    })
    storeFor(projectId).dryRuns.set(report.id, report)
    return envelope({ id: report.id, status: report.status, createdAt: report.createdAt }, 201)
  }),

  http.get('*/api/projects/:projectId/dry-runs/:dryRunId/report', ({ params }) => {
    const report = storeFor(pathParam(params, 'projectId')).dryRuns.get(pathParam(params, 'dryRunId'))
    return report ? envelope(toDryRunReportResponse(report)) : error(404, 'DRY_RUN_NOT_FOUND', 'Dry run not found')
  }),

  http.get('*/api/projects/:projectId/repositories/:repositoryId/branch-policies/:branch', ({ params }) => {
    const store = storeFor(pathParam(params, 'projectId'))
    const key = policyKey(pathParam(params, 'repositoryId'), pathParam(params, 'branch'))
    return envelope(store.branchPolicies.get(key) ?? defaultPolicy())
  }),

  http.put('*/api/projects/:projectId/repositories/:repositoryId/branch-policies/:branch', async ({ params, request }) => {
    const store = storeFor(pathParam(params, 'projectId'))
    const key = policyKey(pathParam(params, 'repositoryId'), pathParam(params, 'branch'))
    const body = await readBody(request)
    const next: BranchPolicy = {
      requirePullRequest: typeof body.requirePullRequest === 'boolean' ? body.requirePullRequest : defaultPolicy().requirePullRequest,
      minimumHumanApprovals: typeof body.minimumHumanApprovals === 'number' ? body.minimumHumanApprovals : defaultPolicy().minimumHumanApprovals,
      allowDirectPush: typeof body.allowDirectPush === 'boolean' ? body.allowDirectPush : defaultPolicy().allowDirectPush,
    }
    store.branchPolicies.set(key, next)
    return envelope(next)
  }),

  http.get('*/api/projects/:projectId/repositories/:repositoryId/quality-gates/:branch', ({ params }) => {
    const store = storeFor(pathParam(params, 'projectId'))
    const key = policyKey(pathParam(params, 'repositoryId'), pathParam(params, 'branch'))
    return envelope(store.qualityGates.get(key) ?? defaultGate())
  }),

  http.put('*/api/projects/:projectId/repositories/:repositoryId/quality-gates/:branch', async ({ params, request }) => {
    const store = storeFor(pathParam(params, 'projectId'))
    const key = policyKey(pathParam(params, 'repositoryId'), pathParam(params, 'branch'))
    const body = await readBody(request)
    const current = store.qualityGates.get(key) ?? defaultGate()
    const next: QualityGateConfig = {
      ...current,
      requiredTestsetIds: asStringArray(body.requiredTestsetIds),
    }
    store.qualityGates.set(key, next)
    return envelope(next)
  }),

  http.post('*/api/projects/:projectId/dry-runs/:dryRunId/cq-approvals', ({ params }) => {
    const dryRunId = pathParam(params, 'dryRunId')
    const result: DryRunCqResult = {
      dryRunId,
      decision: 'APPROVED',
      reviewerUserId: 'mock-reviewer',
      reviewerName: 'Mock Reviewer',
      reason: '',
      reviewedAt: new Date().toISOString(),
    }
    return envelope(result, 201)
  }),

  http.post('*/api/projects/:projectId/dry-runs/:dryRunId/cq-rejections', async ({ params, request }) => {
    const dryRunId = pathParam(params, 'dryRunId')
    const body = await readBody(request)
    const reason = asString(body.reason).trim()
    if (!reason) return error(422, 'VALIDATION_FAILED', 'reason 必填')
    const result: DryRunCqResult = {
      dryRunId,
      decision: 'REJECTED',
      reviewerUserId: 'mock-reviewer',
      reviewerName: 'Mock Reviewer',
      reason,
      reviewedAt: new Date().toISOString(),
    }
    return envelope(result, 201)
  }),
]
