import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDetail, AgentSummary } from '@/types'

const agentListMock = vi.hoisted(() => vi.fn())
const agentGetMock = vi.hoisted(() => vi.fn())
const agentAssignmentsMock = vi.hoisted(() => vi.fn())
const agentRuntimeMock = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({ agentApi: { list: agentListMock, get: agentGetMock, assignments: agentAssignmentsMock, runtime: agentRuntimeMock } }))

import { useAgent, useAgentAssignments, useAgents } from './agents'

const agent: AgentSummary = {
  id: 'agent-one',
  name: 'Agent One',
  avatar: null,
  role: 'DEVELOPER',
  description: '负责 TypeScript 开发',
  visibility: 'PRIVATE',
  status: 'ACTIVE',
  createdBy: 'user-one',
}

const detail = (id: string): AgentDetail => ({ ...agent, id, description: id, prompt: `${id} prompt`, tools: [], memoryAccess: [] })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useAgents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not request Agents until the project teamId is ready', () => {
    renderHook(() => useAgents('project-one'), { wrapper })
    expect(agentListMock).not.toHaveBeenCalled()
  })

  it('uses the supplied teamId and preserves the list envelope', async () => {
    agentListMock.mockResolvedValue({ data: [agent], page: { nextCursor: null, hasMore: false } })
    const { result } = renderHook(() => useAgents('project-one', 'team-one'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(agentListMock).toHaveBeenCalledWith('team-one', undefined)
    expect(result.current.data?.data).toEqual([agent])
  })

  it('does not request disabled tab data', () => {
    renderHook(() => useAgentAssignments('project-one', 'agent-one', 'WORKFLOW', false), { wrapper })
    expect(agentAssignmentsMock).not.toHaveBeenCalled()
  })

  it('keeps a late response for the previous Agent from replacing the selected Agent', async () => {
    const first = deferred<AgentDetail>()
    const second = deferred<AgentDetail>()
    agentGetMock.mockImplementation((_teamId: string, id: string) => id === 'agent-a' ? first.promise : second.promise)
    const { result, rerender } = renderHook(({ agentId }: { agentId: string }) => useAgent('project-one', 'team-one', agentId), { initialProps: { agentId: 'agent-a' }, wrapper })
    await waitFor(() => expect(agentGetMock).toHaveBeenCalledWith('team-one', 'agent-a', 'project-one'))
    rerender({ agentId: 'agent-b' })
    await waitFor(() => expect(agentGetMock).toHaveBeenCalledWith('team-one', 'agent-b', 'project-one'))
    second.resolve(detail('agent-b'))
    await waitFor(() => expect(result.current.data?.id).toBe('agent-b'))
    first.resolve(detail('agent-a'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.data?.id).toBe('agent-b')
  })
})
