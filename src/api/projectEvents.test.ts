import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectProjectEvents, projectEventsUrl } from './projectEvents'

const fetchEventSourceMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: fetchEventSourceMock,
}))

describe('project event API client', () => {
  beforeEach(() => {
    fetchEventSourceMock.mockClear()
    localStorage.clear()
    localStorage.setItem('qgents_access_token', 'access-token')
  })

  it('uses the project event endpoint without putting the token in the URL', () => {
    expect(projectEventsUrl('project/1')).toBe('/api/projects/project%2F1/events')
  })

  it('sends Bearer authentication and the project-specific Last-Event-ID header', async () => {
    const signal = new AbortController().signal
    await connectProjectEvents({
      projectId: 'project-1',
      lastEventId: 'evt-9',
      signal,
      onopen: vi.fn(),
      onmessage: vi.fn(),
      onclose: vi.fn(),
      onerror: vi.fn(),
    })

    expect(fetchEventSourceMock).toHaveBeenCalledWith('/api/projects/project-1/events', expect.objectContaining({
      signal,
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer access-token',
        'Last-Event-ID': 'evt-9',
      },
    }))
  })
})
