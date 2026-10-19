import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testsetHandlers, resetTestsetStores } from './handlers'

const server = setupServer(...testsetHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  resetTestsetStores()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('testset mock handlers', () => {
  it('lists one ENABLED testset without an enabled boolean', async () => {
    const response = await fetch('/api/projects/demo-project/testsets')
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      data: Array<{ status: string; enabled?: boolean; scopeTags?: string[] }>
    }
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0]?.status).toBe('ENABLED')
    expect(payload.data[0]?.enabled).toBeUndefined()
    expect(payload.data[0]?.scopeTags).toEqual(['api'])
  })

  it('creates a test-run and returns it by id', async () => {
    const list = await fetch('/api/projects/demo-project/testsets').then((res) => res.json()) as {
      data: Array<{ id: string; repositoryId: string }>
    }
    const testset = list.data[0]
    const created = await fetch('/api/projects/demo-project/test-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repositoryId: testset?.repositoryId,
        testsetIds: [testset?.id],
        ref: 'feat/login-api',
      }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { data: { id: string; status: string } }
    const detail = await fetch(`/api/projects/demo-project/test-runs/${body.data.id}`)
    expect(detail.status).toBe(200)
  })

  it('creates a dry-run and serves its report', async () => {
    const created = await fetch('/api/projects/demo-project/dry-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repositoryId: 'bound-demo-auth-service',
        sourceRef: 'feat/login-api',
        targetBranch: 'main',
      }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { data: { id: string } }
    const report = await fetch(`/api/projects/demo-project/dry-runs/${body.data.id}/report`)
    expect(report.status).toBe(200)
    const payload = (await report.json()) as {
      data: { id: string; status: string; createdAt: string; report?: { mergeable?: boolean } }
    }
    expect(payload.data.id).toBe(body.data.id)
    expect(payload.data.status).toBeTruthy()
    expect(payload.data.createdAt).toBeTruthy()
    expect(payload.data.report?.mergeable).toBe(true)
  })
})
