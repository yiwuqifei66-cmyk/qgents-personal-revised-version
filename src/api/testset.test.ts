import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTestsetEnabled, mapDryRunReport, mapTestRun, mapTestset, testsetApi } from './testset'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('testset API mapping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: {}, requestId: 'req' }))
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-key' })
  })

  it('treats status ENABLED as enabled and does not require an enabled boolean', () => {
    const testset = mapTestset({
      id: 'ts-1',
      projectId: 'p-1',
      name: '后端单元测试',
      repositoryId: 'bound-1',
      scopeTags: ['backend'],
      command: './mvnw test',
      timeoutSeconds: 900,
      passRule: { type: 'EXIT_CODE', expected: 0 },
      acceptanceNotes: 'cover login',
      status: 'ENABLED',
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    })
    expect(testset.status).toBe('ENABLED')
    expect(isTestsetEnabled(testset)).toBe(true)
    expect('enabled' in testset).toBe(false)
  })

  it('maps missing scopeTags to an empty array and flattens definition when present', () => {
    expect(mapTestset({ id: 'ts-4', name: 'x', command: './mvnw test' }).scopeTags).toEqual([])
    expect(
      mapTestset({
        id: 'ts-5',
        name: 'from-definition',
        definition: { command: './gradlew test', timeoutSeconds: 30, passRule: { type: 'EXIT_CODE', expected: 0 } },
      }).command,
    ).toBe('./gradlew test')
  })

  it('falls back to status when backend only sends enabled boolean', () => {
    expect(mapTestset({ id: 'ts-2', name: 'x', enabled: false }).status).toBe('DISABLED')
    expect(isTestsetEnabled(mapTestset({ id: 'ts-3', name: 'y', enabled: true }))).toBe(true)
  })

  it('lists testsets with repositoryId and status query params, not enabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'ts-1', name: '登录接口测试', status: 'ENABLED', repositoryId: 'bound-1' }],
      }),
    )
    const list = await testsetApi.list('project-1', { repositoryId: 'bound-1', status: 'ENABLED' })
    expect(list[0]?.status).toBe('ENABLED')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/projects/project-1/testsets?repositoryId=bound-1&status=ENABLED',
      expect.objectContaining({ body: undefined }),
    )
  })

  it('creates a testset with the documented request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'ts-new', status: 'DISABLED' } }))
    await testsetApi.create('project-1', {
      name: '后端单元测试',
      repositoryId: 'bound-1',
      scopeTags: ['backend', 'unit'],
      command: './mvnw test',
      timeoutSeconds: 900,
      passRule: { type: 'EXIT_CODE', expected: 0 },
      acceptanceNotes: '登录成功、错误密码和不存在用户均需覆盖。',
    })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/projects/project-1/testsets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: '后端单元测试',
          repositoryId: 'bound-1',
          scopeTags: ['backend', 'unit'],
          command: './mvnw test',
          timeoutSeconds: 900,
          passRule: { type: 'EXIT_CODE', expected: 0 },
          acceptanceNotes: '登录成功、错误密码和不存在用户均需覆盖。',
        }),
      }),
    )
  })

  it('posts enable/disable and creates test-runs / dry-runs on documented paths', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'ts-1', status: 'ENABLED' } }))
    await testsetApi.enable('project-1', 'ts-1')
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/project-1/testsets/ts-1/enable',
      expect.objectContaining({ method: 'POST' }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'run-1', status: 'PASSED' } }))
    await testsetApi.createTestRun('project-1', {
      repositoryId: 'bound-1',
      testsetIds: ['ts-1'],
      ref: 'feat/login-api',
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/project-1/test-runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repositoryId: 'bound-1',
          testsetIds: ['ts-1'],
          ref: 'feat/login-api',
        }),
      }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'dry-1', status: 'PASSED', conflicts: [] } }))
    await testsetApi.createDryRun('project-1', {
      repositoryId: 'bound-1',
      sourceRef: 'feat/login-api',
      targetBranch: 'main',
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/project-1/dry-runs',
      expect.objectContaining({ method: 'POST' }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'dry-1', conflicts: [{ path: 'a.ts', message: 'conflict' }] } }))
    const report = await testsetApi.getDryRunReport('project-1', 'dry-1')
    expect(report.conflicts).toEqual([{ path: 'a.ts', message: 'conflict' }])
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/projects/project-1/dry-runs/dry-1/report',
      expect.objectContaining({ body: undefined }),
    )
  })

  it('maps structured test-run summary.results', () => {
    const run = mapTestRun({
      id: 'r1',
      status: 'FAILED',
      testsetIds: ['ts-1'],
      summary: {
        status: 'FAILED',
        resolvedHeadCommit: 'fc3a50234ba70b5121dc328decebe97dec915a83',
        results: [
          {
            testsetId: 'ts-1',
            status: 'FAILED',
            exitCode: 254,
            durationMs: 279,
            failureCode: 'UNEXPECTED_EXIT_CODE',
          },
        ],
      },
    })
    expect(run.executionSummary).toEqual({
      status: 'FAILED',
      resolvedHeadCommit: 'fc3a50234ba70b5121dc328decebe97dec915a83',
      results: [
        {
          testsetId: 'ts-1',
          status: 'FAILED',
          exitCode: 254,
          durationMs: 279,
          failureCode: 'UNEXPECTED_EXIT_CODE',
        },
      ],
    })
  })

  it('maps nested dry-run report with merge conflict skipping tests', () => {
    const report = mapDryRunReport({
      id: 'dry-1',
      status: 'FAILED',
      sourceRef: 'feat/a',
      targetBranch: 'main',
      report: {
        targetCommit: 'bbbb',
        mergeable: false,
        conflicts: [{ path: 'a.ts', message: 'both edited' }],
        tests: { status: 'SKIPPED', reason: 'MERGE_CONFLICT' },
        failureCode: null,
      },
    })
    expect(report.report?.mergeable).toBe(false)
    expect(report.conflicts).toEqual([{ path: 'a.ts', message: 'both edited' }])
    expect(report.report?.tests).toEqual({
      status: 'SKIPPED',
      results: [],
      reason: 'MERGE_CONFLICT',
    })
  })

  it('maps optional sandboxId from sandboxId or sandbox.id', () => {
    expect(mapTestRun({ id: 'r1', sandboxId: 'sbx-1' }).sandboxId).toBe('sbx-1')
    expect(mapTestRun({ id: 'r2', sandbox: { id: 'sbx-2' } }).sandboxId).toBe('sbx-2')
    expect(mapTestRun({ id: 'r3' }).sandboxId).toBeNull()
    expect(mapDryRunReport({ id: 'd1', sandboxId: 'sbx-3', testsetIds: ['ts-1'] }).sandboxId).toBe('sbx-3')
    expect(mapDryRunReport({ id: 'd1', sandboxId: 'sbx-3', testsetIds: ['ts-1'] }).testsetIds).toEqual(['ts-1'])
  })

  it('maps case details and pdfUrl from optional backend fields', () => {
    const run = mapTestRun({
      id: 'r1',
      cases: [
        {
          id: 'c1',
          name: 'login ok',
          testsetId: 'ts-1',
          suite: 'LoginApiTest',
          status: 'FAILED',
          durationMs: 1200,
          message: 'assert failed',
          filePath: 'LoginApiTest.java',
        },
      ],
      pdfUrl: 'https://files.example/run.pdf',
    })
    expect(run.cases).toEqual([
      {
        id: 'c1',
        name: 'login ok',
        testsetId: 'ts-1',
        suite: 'LoginApiTest',
        status: 'FAILED',
        durationMs: 1200,
        message: 'assert failed',
        filePath: 'LoginApiTest.java',
      },
    ])
    expect(run.pdfUrl).toBe('https://files.example/run.pdf')
    expect(mapTestRun({ id: 'r2', artifacts: [{ name: 'report.pdf', url: '/a.pdf' }] }).pdfUrl).toBe('/a.pdf')
  })

  it('maps headCommit to sourceRef per API doc, falling back to legacy sourceRef', () => {
    // 优先使用 headCommit（API 文档字段）
    const fromHeadCommit = mapDryRunReport({
      id: 'dry-1',
      headCommit: 'abc123def456',
      sourceRef: 'legacy-sha',
    })
    expect(fromHeadCommit.sourceRef).toBe('abc123def456')

    // 无 headCommit 时回退到 legacy sourceRef
    const fallback = mapDryRunReport({
      id: 'dry-2',
      sourceRef: 'legacy-sha',
    })
    expect(fallback.sourceRef).toBe('legacy-sha')

    // 两者都无时为 null
    const empty = mapDryRunReport({ id: 'dry-3' })
    expect(empty.sourceRef).toBe('')
  })

  it('maps createdAt/updatedAt to startedAt/finishedAt with legacy fallback', () => {
    // API 文档字段
    const fromDoc = mapDryRunReport({
      id: 'dry-1',
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-15T10:05:00Z',
    })
    expect(fromDoc.startedAt).toBe('2026-08-15T10:00:00Z')
    expect(fromDoc.finishedAt).toBe('2026-08-15T10:05:00Z')

    // legacy 字段兜底
    const fromLegacy = mapDryRunReport({
      id: 'dry-2',
      startedAt: '2026-08-15T11:00:00Z',
      finishedAt: '2026-08-15T11:10:00Z',
    })
    expect(fromLegacy.startedAt).toBe('2026-08-15T11:00:00Z')
    expect(fromLegacy.finishedAt).toBe('2026-08-15T11:10:00Z')
  })

  it('computes durationSeconds from timestamps when not directly provided', () => {
    // 直接提供 durationSeconds 时优先使用
    const direct = mapDryRunReport({
      id: 'dry-1',
      durationSeconds: 42,
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-15T10:05:00Z',
    })
    expect(direct.durationSeconds).toBe(42)

    // 未提供 durationSeconds 时从时间戳计算（5 分钟 = 300 秒）
    const computed = mapDryRunReport({
      id: 'dry-2',
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-15T10:05:00Z',
    })
    expect(computed.durationSeconds).toBe(300)

    // 无时间戳时为 null
    const noTime = mapDryRunReport({ id: 'dry-3' })
    expect(noTime.durationSeconds).toBeNull()
  })

  it('maps createdBy with creator fallback for both DryRun and TestRun', () => {
    // DryRun: createdBy 优先
    const dry1 = mapDryRunReport({ id: 'd1', createdBy: 'alice', creator: 'bob' })
    expect(dry1.createdBy).toBe('alice')
    // DryRun: creator 兜底
    const dry2 = mapDryRunReport({ id: 'd2', creator: 'bob' })
    expect(dry2.createdBy).toBe('bob')
    // DryRun: 都无时为 null
    const dry3 = mapDryRunReport({ id: 'd3' })
    expect(dry3.createdBy).toBeNull()

    // TestRun: 同样逻辑
    const run1 = mapTestRun({ id: 'r1', createdBy: 'charlie', creator: 'dave' })
    expect(run1.createdBy).toBe('charlie')
    const run2 = mapTestRun({ id: 'r2', creator: 'dave' })
    expect(run2.createdBy).toBe('dave')
    const run3 = mapTestRun({ id: 'r3' })
    expect(run3.createdBy).toBeNull()
  })

  it('maps TestRun time fields with updatedAt fallback', () => {
    // TestRun: updatedAt → finishedAt 兜底；startedAt 不回落 createdAt（创建时间≠开始时间，
    // QUEUED 未开始时 startedAt 应为空，避免把未开始的运行显示成有时长）
    const fromUpdated = mapTestRun({
      id: 'r1',
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-15T10:05:00Z',
    })
    expect(fromUpdated.startedAt).toBeNull()
    expect(fromUpdated.finishedAt).toBe('2026-08-15T10:05:00Z')

    // TestRun: legacy startedAt/finishedAt 优先
    const fromLegacy = mapTestRun({
      id: 'r2',
      startedAt: '2026-08-15T11:00:00Z',
      finishedAt: '2026-08-15T11:10:00Z',
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-15T10:05:00Z',
    })
    expect(fromLegacy.startedAt).toBe('2026-08-15T11:00:00Z')
    expect(fromLegacy.finishedAt).toBe('2026-08-15T11:10:00Z')
  })
})
