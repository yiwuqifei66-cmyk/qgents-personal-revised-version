import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRuntimeSummary } from '@/types'
import { agentHandlers, resetAgentStores } from './handlers'

const server = setupServer(...agentHandlers)
const baseUrl = 'http://localhost/api'
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => resetAgentStores())
const json = async <T,>(response: Response): Promise<T> => response.json() as Promise<T>

describe('Agent team MSW API', () => {
  it('returns system, team and current-user private Agent cards without Prompt', async () => {
    const result = await json<{ data: Array<Record<string, unknown>>; page: { nextCursor: string | null; hasMore: boolean }; requestId: string }>(await fetch(`${baseUrl}/teams/team-a/agents`))
    expect(result.data.map((agent) => agent.id)).toContain('agent-system-planner')
    expect(result.data.map((agent) => agent.id)).toContain('agent-team-tester')
    expect(result.data.map((agent) => agent.id)).toContain('agent-private-backend')
    expect(result.data.map((agent) => agent.id)).not.toContain('agent-other-user')
    expect(result.data[0]).not.toHaveProperty('runtime')
    expect(result.data[0]).not.toHaveProperty('skillAccessScope')
    expect(result.data.every((agent) => agent.prompt === undefined && agent.availability === undefined && agent.permissions === undefined)).toBe(true)
    expect(result.page).toEqual({ nextCursor: null, hasMore: false })
    expect(result.requestId).toBeTruthy()
  })
  it('returns Prompt only to the Agent creator on the detail endpoint', async () => {
    const own = await json<{ data: Record<string, unknown> }>(await fetch(`${baseUrl}/teams/team-a/agents/agent-private-backend?projectId=demo-project`))
    const shared = await json<{ data: Record<string, unknown> }>(await fetch(`${baseUrl}/teams/team-a/agents/agent-team-tester?projectId=demo-project`))
    expect(own.data.prompt).toBeTruthy()
    expect(shared.data.prompt).toBeUndefined()
  })
  it('handles every supplied teamId without relying on a fixed fixture ID', async () => {
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/teams/team-a/agents`),
      fetch(`${baseUrl}/teams/team-b/agents`),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })
  it('creates, publishes, unpublishes and archives using formal status and visibility', async () => {
    const created = await json<{ data: { id: string; visibility: string; status: string } }>(await fetch(`${baseUrl}/teams/team-a/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New', role: 'DEVELOPER', description: '负责 API 开发', prompt: 'private' }) }))
    expect(created.data).toMatchObject({ visibility: 'PRIVATE', status: 'ACTIVE' })
    const published = await json<{ data: { visibility: string } }>(await fetch(`${baseUrl}/teams/team-a/agents/${created.data.id}/publish`, { method: 'POST' })); expect(published.data.visibility).toBe('TEAM')
    const unpublished = await json<{ data: { visibility: string } }>(await fetch(`${baseUrl}/teams/team-a/agents/${created.data.id}/unpublish`, { method: 'POST' })); expect(unpublished.data.visibility).toBe('PRIVATE')
    const archived = await json<{ data: { status: string } }>(await fetch(`${baseUrl}/teams/team-a/agents/${created.data.id}/archive`, { method: 'POST' })); expect(archived.data.status).toBe('ARCHIVED')
  })
  it('returns documented error classes', async () => {
    expect((await fetch(`${baseUrl}/teams/team-a/agents/missing`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/teams/team-a/agents?scenario=FORBIDDEN`)).status).toBe(403)
    expect((await fetch(`${baseUrl}/teams/team-a/agents/agent-private-backend/publish?error=CONFLICT`, { method: 'POST' })).status).toBe(409)
    expect((await fetch(`${baseUrl}/teams/team-a/agents/agent-system-planner/archive`, { method: 'POST' })).status).toBe(422)
  })
  it('keeps assignment counts aligned and paginates project Agent TaskRuns', async () => {
    const assignmentResponse = await fetch(`${baseUrl}/projects/demo-project/agents/agent-private-backend/assignments?type=REQUIREMENT_GROUP&limit=1`)
    await expect(assignmentResponse.json()).resolves.toMatchObject({ data: [{ resourceId: 'group-demo-project-requirements' }], page: { nextCursor: '1', hasMore: true } })
    const assignmentPageTwo = await fetch(`${baseUrl}/projects/demo-project/agents/agent-private-backend/assignments?type=REQUIREMENT_GROUP&cursor=1&limit=1`)
    await expect(assignmentPageTwo.json()).resolves.toMatchObject({ data: [{ resourceId: 'group-demo-project-security' }], page: { nextCursor: null, hasMore: false } })
    const runsResponse = await fetch(`${baseUrl}/projects/demo-project/task-runs?agentId=agent-private-backend&limit=1`)
    const runs = await json<{ data: Array<{ id: string; projectId: string; agentId: string; statusReason: unknown }>; page: { nextCursor: string | null; hasMore: boolean } }>(runsResponse)
    expect(runs.data).toHaveLength(1)
    expect(runs.data[0]).toMatchObject({ projectId: 'demo-project', agentId: 'agent-private-backend' })
    expect(runs.page).toEqual({ nextCursor: '1', hasMore: true })
    const otherProject = await fetch(`${baseUrl}/projects/other-project/agents/agent-private-backend/runtime`)
    const otherProjectData = await json<{ data: { activeRunCount: number; assignmentUsage: { requirementGroups: { assignedCount: number } } } }>(otherProject)
    expect(otherProjectData.data).toMatchObject({ activeRunCount: 0, assignmentUsage: { requirementGroups: { assignedCount: 0 } } })
  })

  it('filters TaskRuns by status and keeps sensitive execution fields out of the summary contract', async () => {
    const response = await fetch(`${baseUrl}/projects/demo-project/task-runs?agentId=agent-private-backend&status=FAILED`)
    const result = await json<{ data: Array<{ status: string }> }>(response)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ status: 'FAILED', taskDisplayCode: 'TASK-002', taskStepRole: 'DEVELOPER' })
    expect(JSON.stringify(result.data)).not.toMatch(/stack|prompt|credential|host|path|log/i)
  })

  it('derives runtime status and active count from the project TaskRun relation', async () => {
    const [runtimeResponse, runsResponse] = await Promise.all([
      fetch(`${baseUrl}/projects/demo-project/agents/agent-private-backend/runtime`),
      fetch(`${baseUrl}/projects/demo-project/task-runs?agentId=agent-private-backend`),
    ])
    const runtime = await json<{ data: AgentRuntimeSummary }>(runtimeResponse)
    const runs = await json<{ data: Array<{ status: string }> }>(runsResponse)
    const active = runs.data.filter((run) => ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED', 'CANCELLING'].includes(run.status)).length
    expect(runtime.data.activeRunCount).toBe(active)
    expect(runtime.data.concurrencyLimit).toBeNull()
    expect(runtime.data.status).toBe(active > 0 ? 'RUNNING' : 'IDLE')
    const tester = await fetch(`${baseUrl}/projects/demo-project/agents/agent-team-tester/runtime`)
    await expect(tester.json()).resolves.toMatchObject({ data: { status: 'IDLE', activeRunCount: 0 } })
    const assignments = await json<{ data: Array<unknown> }>(await fetch(`${baseUrl}/projects/demo-project/agents/agent-private-backend/assignments?type=REQUIREMENT_GROUP`))
    expect(runtime.data.assignmentUsage.requirementGroups.assignedCount).toBe(assignments.data.length)
    const workflows = await json<{ data: Array<unknown> }>(await fetch(`${baseUrl}/projects/demo-project/agents/agent-private-backend/assignments?type=WORKFLOW`))
    expect(runtime.data.assignmentUsage.workflows.assignedCount).toBe(0)
    expect(workflows.data).toEqual([])
  })

  it('returns the formal runtime envelope independently from the Agent card', async () => {
    const response = await fetch(`${baseUrl}/projects/demo-project/agents/agent-private-backend/runtime`)
    const result = await json<{ data: AgentRuntimeSummary; requestId: string }>(response)
    expect(result.data).toMatchObject({ concurrencyLimit: null, skillAccessScope: 'PROJECT', memoryAccessScope: 'PROJECT' })
    expect(result.requestId).toBeTruthy()
  })
})
