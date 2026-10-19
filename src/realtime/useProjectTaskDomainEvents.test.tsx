import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectEventStreamInit } from '@/api/projectEvents'
import { useProjectTaskDomainEvents } from './useProjectTaskDomainEvents'

const connectProjectEventsMock = vi.hoisted(() => vi.fn(async (init: ProjectEventStreamInit) => {
  await init.onopen(new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
}))

vi.mock('@/api/projectEvents', () => ({
  connectProjectEvents: connectProjectEventsMock,
  projectEventsEnabled: projectEventsEnabledMock,
}))
const projectEventsEnabledMock = vi.hoisted(() => vi.fn(() => true))

describe('project task event subscription', () => {
  afterEach(() => {
    connectProjectEventsMock.mockClear()
    projectEventsEnabledMock.mockReturnValue(true)
  })

  it('shares one connection and switches projects by aborting the old stream', async () => {
    const streams: ProjectEventStreamInit[] = []
    connectProjectEventsMock.mockImplementation(async (init: ProjectEventStreamInit) => {
      streams.push(init)
      await init.onopen(new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    })
    const first = renderHook(({ projectId }) => useProjectTaskDomainEvents(projectId), {
      initialProps: { projectId: 'project-1' },
    })
    const second = renderHook(({ projectId }) => useProjectTaskDomainEvents(projectId), {
      initialProps: { projectId: 'project-1' },
    })
    await act(async () => undefined)

    expect(connectProjectEventsMock).toHaveBeenCalledOnce()

    second.unmount()
    first.rerender({ projectId: 'project-2' })
    await act(async () => undefined)

    expect(connectProjectEventsMock).toHaveBeenCalledTimes(2)
    expect(streams[0]?.signal.aborted).toBe(true)
    expect(streams[1]?.signal.aborted).toBe(false)

    first.unmount()
    expect(streams[1]?.signal.aborted).toBe(true)
  })

  it('does not create a real stream in Mock mode', () => {
    projectEventsEnabledMock.mockReturnValue(false)
    const hook = renderHook(() => useProjectTaskDomainEvents('project-mock'))
    expect(hook.result.current).toBe('idle')
    expect(connectProjectEventsMock).not.toHaveBeenCalled()
    hook.unmount()
  })
})
