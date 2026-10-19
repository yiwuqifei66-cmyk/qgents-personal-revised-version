import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_EXPIRED_EVENT, request } from './client'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('API client authentication recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-key' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('refreshes and retries on a documented 401 even without an internal error code', async () => {
    localStorage.setItem('qgents_access_token', 'expired-access-token')
    localStorage.setItem('qgents_refresh_token', 'refresh-token')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(401, { error: { message: 'Token expired' } }))
      .mockResolvedValueOnce(response(200, { data: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' } }))
      .mockResolvedValueOnce(response(200, { data: { id: 'task-1' } }))

    await expect(request<{ id: string }>('/projects/project-1/tasks')).resolves.toEqual({ id: 'task-1' })

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/refresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/projects/project-1/tasks', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer new-access-token' }),
    }))
    expect(localStorage.getItem('qgents_access_token')).toBe('new-access-token')
  })

  it('clears the session only after refresh fails', async () => {
    localStorage.setItem('qgents_access_token', 'expired-access-token')
    localStorage.setItem('qgents_refresh_token', 'refresh-token')
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(401, { error: { message: 'Unauthorized' } }))
      .mockResolvedValueOnce(response(401, { error: { message: 'Refresh token expired' } }))

    await expect(request('/projects/project-1/tasks')).rejects.toMatchObject({ status: 401 })

    expect(localStorage.getItem('qgents_access_token')).toBeNull()
    expect(localStorage.getItem('qgents_refresh_token')).toBeNull()
    expect(onExpired).toHaveBeenCalledTimes(1)
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  })
})
