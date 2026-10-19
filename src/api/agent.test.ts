import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentApi } from './agent'

afterEach(() => vi.restoreAllMocks())

describe('agentApi', () => {
  it('unwraps the Agent list envelope exactly once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'agent-one', name: 'Agent One' }],
      page: { nextCursor: null, hasMore: false },
      requestId: 'request-one',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(agentApi.list('team-one')).resolves.toEqual({
      data: [{ id: 'agent-one', name: 'Agent One' }],
      page: { nextCursor: null, hasMore: false },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/teams/team-one/agents', expect.any(Object))
  })

  it('uses the project Agent TaskRun filter through the shared client', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [],
      page: { nextCursor: null, hasMore: false },
      requestId: 'request-two',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(agentApi.taskRuns('project-one', { agentId: 'agent-one', status: 'FAILED', cursor: '1', limit: 10 })).resolves.toMatchObject({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'request-two' })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-one/task-runs?agentId=agent-one&status=FAILED&cursor=1&limit=10', expect.any(Object))
  })

  it('passes project context to the Agent detail endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'agent-one', name: 'Agent One' },
      requestId: 'request-agent-detail',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(agentApi.get('team-one', 'agent-one', 'project-one')).resolves.toMatchObject({ id: 'agent-one' })
    expect(fetchMock).toHaveBeenCalledWith('/api/teams/team-one/agents/agent-one?projectId=project-one', expect.any(Object))
  })

  it('uses optional assignment filters and preserves the cursor envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [],
      page: { nextCursor: null, hasMore: false },
      requestId: 'request-three',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(agentApi.assignments('project-one', 'agent-one', { limit: 20 })).resolves.toMatchObject({ requestId: 'request-three' })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-one/agents/agent-one/assignments?limit=20', expect.any(Object))
  })

  it('reads runtime through the dedicated project endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { status: 'IDLE', activeRunCount: 0, concurrencyLimit: null, assignmentUsage: { requirementGroups: { assignedCount: 0, assignableCount: 0 }, workflows: { assignedCount: 0, assignableCount: 0 } }, skillAccessScope: 'PROJECT', memoryAccessScope: 'PROJECT' },
      requestId: 'request-four',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(agentApi.runtime('project-one', 'agent-one')).resolves.toMatchObject({ status: 'IDLE', concurrencyLimit: null })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-one/agents/agent-one/runtime', expect.any(Object))
  })
})
