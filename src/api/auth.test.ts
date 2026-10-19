import { afterEach, describe, expect, it, vi } from 'vitest'
import { authApi, uploadAvatar } from './auth'

afterEach(() => vi.restoreAllMocks())

describe('authApi.updateMe', () => {
  it('patches /me with the profile payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: null,
      requestId: 'request-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await authApi.updateMe({ displayName: '新昵称' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'PATCH', body: '{"displayName":"新昵称"}' }),
    )
  })
})

describe('GitHub OAuth API', () => {
  it('starts personal GitHub authorization with the documented client query', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        authorizationUrl: 'https://github.com/login/oauth/authorize?state=signed',
        expiresAt: '2026-08-20T15:00:00Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await authApi.startGithubOAuth('WEB')

    expect(result.authorizationUrl).toContain('github.com/login/oauth/authorize')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/integrations/github/oauth/start?client=WEB',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
  })

  it('reads status without exposing any token-shaped field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        authorized: true,
        provider: 'GITHUB',
        githubUserId: 123,
        githubLogin: 'octocat',
        scopes: ['public_repo'],
        authorizedAt: null,
        lastValidatedAt: null,
        canCreatePublicPersonalRepository: true,
        canCreatePrivatePersonalRepository: true,
        personalRepositorySetup: 'READY',
        expectedInstallationLogin: null,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await authApi.getGithubOAuthStatus()

    expect(result.githubLogin).toBe('octocat')
    expect(fetchMock).toHaveBeenCalledWith('/api/me/integrations/github/oauth', expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })

  it('revokes personal GitHub authorization through the documented endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    await authApi.revokeGithubOAuth()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/integrations/github/oauth',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('uploadAvatar', () => {
  it('runs credential → OSS PUT → confirm and returns the public avatar URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          objectKey: 'avatars/user-1/abc.png',
          uploadUrl: 'https://oss.example.com/avatars/user-1/abc.png',
          method: 'PUT',
          expiresAt: '2026-08-17T12:00:00Z',
          headers: {},
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { avatarUrl: 'https://cdn.example.com/avatars/user-1/abc.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const file = new File(['fake-image-bytes'], 'avatar.png', { type: 'image/png' })
    const avatarUrl = await uploadAvatar(file)

    expect(avatarUrl).toBe('https://cdn.example.com/avatars/user-1/abc.png')
    // 凭证：POST /me/avatar/credential，body 带 mediaType/sizeBytes
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/me/avatar/credential', expect.objectContaining({
      method: 'POST',
      body: '{"mediaType":"image/png","sizeBytes":16}',
    }))
    // 直传：PUT 到预签名地址，body 为文件字节
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://oss.example.com/avatars/user-1/abc.png', expect.objectContaining({ method: 'PUT' }))
    // 确认：POST /me/avatar/confirm，body 原样回传 objectKey
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/me/avatar/confirm', expect.objectContaining({
      method: 'POST',
      body: '{"objectKey":"avatars/user-1/abc.png"}',
    }))
  })

  it('fails fast when the OSS PUT is rejected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          objectKey: 'avatars/user-1/abc.png',
          uploadUrl: 'https://oss.example.com/avatars/user-1/abc.png',
          method: 'PUT',
          expiresAt: '2026-08-17T12:00:00Z',
          headers: {},
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const file = new File(['x'], 'avatar.png', { type: 'image/png' })
    await expect(uploadAvatar(file)).rejects.toThrow('头像上传失败（403）')
  })
})
