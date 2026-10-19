import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventSourceMessage } from '@microsoft/fetch-event-source'
import { EventCursorExpiredError, ProjectEventConnection } from './projectEventConnection'
import { MemoryEventCursorStore } from './eventCursor'
import type { ProjectEventStreamInit } from '@/api/projectEvents'

const message = (id: string): EventSourceMessage => ({
  id,
  event: 'task-run.updated',
  data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskStepId: 'step-1', taskRunId: 'run-1' }),
})

describe('project SSE connection lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps the cursor per project and ignores duplicate event ids', async () => {
    const store = new MemoryEventCursorStore()
    const events: string[] = []
    let stream: ProjectEventStreamInit | undefined
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      stream = init
      await init.onopen(new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    })
    const connection = new ProjectEventConnection('project-1', {
      cursorStore: store,
      connect,
      onEvent: (event) => events.push(event.id ?? ''),
      onCursorExpired: vi.fn(),
    })

    connection.start()
    await Promise.resolve()
    stream?.onmessage(message('evt-1'))
    stream?.onmessage(message('evt-1'))

    expect(events).toEqual(['evt-1'])
    expect(store.get('project-1')).toBe('evt-1')
    connection.stop()
  })

  it('stops the old connection when the project connection is replaced', async () => {
    const firstAbort = vi.fn()
    const secondAbort = vi.fn()
    const streams: ProjectEventStreamInit[] = []
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      streams.push(init)
      await init.onopen(new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    })
    const first = new ProjectEventConnection('project-1', {
      connect,
      onEvent: vi.fn(),
      onCursorExpired: vi.fn(),
    })
    const second = new ProjectEventConnection('project-2', {
      connect,
      onEvent: vi.fn(),
      onCursorExpired: vi.fn(),
    })
    first.start()
    second.start()
    await Promise.resolve()
    const firstSignal = streams[0]?.signal
    const secondSignal = streams[1]?.signal
    firstSignal?.addEventListener('abort', firstAbort)
    secondSignal?.addEventListener('abort', secondAbort)

    first.stop()
    expect(firstSignal?.aborted).toBe(true)
    expect(secondSignal?.aborted).toBe(false)
    expect(firstAbort).toHaveBeenCalledOnce()
    expect(secondAbort).not.toHaveBeenCalled()
    second.stop()
  })

  it('reconnects after a failed stream without a permanent timer', async () => {
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      await init.onerror(new Error('network down'))
      throw new Error('stream failed')
    })
    const connection = new ProjectEventConnection('project-1', {
      connect,
      retryDelaysMs: [10],
      onEvent: vi.fn(),
      onCursorExpired: vi.fn(),
    })

    connection.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(connect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10)
    await Promise.resolve()
    expect(connect).toHaveBeenCalledTimes(2)
    connection.stop()
    vi.advanceTimersByTime(100)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('clears an expired cursor and refreshes the project domain before retrying', async () => {
    const store = new MemoryEventCursorStore()
    store.set('project-1', 'expired')
    const onCursorExpired = vi.fn()
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      try {
        await init.onerror(new EventCursorExpiredError())
      } catch {
        // The connection must stop the library's retry loop for an expired cursor.
      }
      await init.onclose()
    })
    const connection = new ProjectEventConnection('project-1', {
      cursorStore: store,
      connect,
      retryDelaysMs: [10],
      onEvent: vi.fn(),
      onCursorExpired,
    })

    connection.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.get('project-1')).toBeNull()
    expect(onCursorExpired).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(10)
    await Promise.resolve()
    expect(connect).toHaveBeenCalledTimes(2)
    connection.stop()
  })

  it('clears the cursor only for the documented EVENT_CURSOR_EXPIRED response', async () => {
    const store = new MemoryEventCursorStore()
    store.set('project-1', 'expired')
    const onCursorExpired = vi.fn()
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      try {
        await init.onopen(new Response(JSON.stringify({ error: { code: 'EVENT_CURSOR_EXPIRED' } }), { status: 409, headers: { 'content-type': 'application/json' } }))
      } catch (error: unknown) {
        try { await init.onerror(error) } catch { /* cursor expiration is handled before retry */ }
      }
    })
    const connection = new ProjectEventConnection('project-1', { cursorStore: store, connect, retryDelaysMs: [10], onEvent: vi.fn(), onCursorExpired })
    connection.start()
    await vi.waitFor(() => expect(store.get('project-1')).toBeNull())
    expect(onCursorExpired).toHaveBeenCalledOnce()
    connection.stop()
  })

  it.each([401, 403, 409])('does not reconnect after terminal HTTP %s', async (status) => {
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      try {
        await init.onopen(new Response(JSON.stringify({ error: { code: 'OTHER_ERROR' } }), { status, headers: { 'content-type': 'application/json' } }))
      } catch (error: unknown) {
        try { await init.onerror(error) } catch { /* terminal errors stop the connection */ }
      }
    })
    const connection = new ProjectEventConnection('project-1', { connect, retryDelaysMs: [10], onEvent: vi.fn(), onCursorExpired: vi.fn() })
    connection.start()
    await Promise.resolve()
    await Promise.resolve()
    vi.advanceTimersByTime(100)
    expect(connect).toHaveBeenCalledOnce()
    connection.stop()
  })

  it('aborts the active stream on unmount/stop', async () => {
    let signal: AbortSignal | undefined
    const connect = vi.fn(async (init: ProjectEventStreamInit) => {
      signal = init.signal
      await init.onopen(new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    })
    const connection = new ProjectEventConnection('project-1', {
      connect,
      onEvent: vi.fn(),
      onCursorExpired: vi.fn(),
    })

    connection.start()
    await Promise.resolve()
    connection.stop()
    expect(signal?.aborted).toBe(true)
  })
})
