import { fetchEventSource, type EventSourceMessage, type FetchEventSourceInit } from '@microsoft/fetch-event-source'
import { getApiBaseUrl, getStoredToken } from './client'

export interface ProjectEventStreamInit {
  projectId: string
  lastEventId?: string
  signal: AbortSignal
  onopen: NonNullable<FetchEventSourceInit['onopen']>
  onmessage: (event: EventSourceMessage) => void
  onclose: NonNullable<FetchEventSourceInit['onclose']>
  onerror: NonNullable<FetchEventSourceInit['onerror']>
}

export function projectEventsEnabled(): boolean {
  return import.meta.env.VITE_USE_MOCK !== 'true'
}

export function projectEventsUrl(projectId: string): string {
  return `${getApiBaseUrl()}/projects/${encodeURIComponent(projectId)}/events`
}

export function connectProjectEvents(init: ProjectEventStreamInit): Promise<void> {
  const token = getStoredToken()
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (init.lastEventId) {
    headers['Last-Event-ID'] = init.lastEventId
  }

  return fetchEventSource(projectEventsUrl(init.projectId), {
    signal: init.signal,
    headers,
    openWhenHidden: true,
    onopen: init.onopen,
    onmessage: init.onmessage,
    onclose: init.onclose,
    onerror: init.onerror,
  })
}
