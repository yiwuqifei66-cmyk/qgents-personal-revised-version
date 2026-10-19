import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachmentApi, resolvePreviewUrl } from './attachment'

afterEach(() => vi.restoreAllMocks())

describe('attachmentApi.previewUrl（增量契约 §4）', () => {
  it('requests the preview metadata endpoint with the attachment id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        attachmentId: 'att-1',
        fileName: '登录页设计.png',
        mediaType: 'image/png',
        sizeBytes: 102400,
        previewable: true,
        previewType: 'IMAGE',
        previewUrl: '/api/v1/projects/project-1/attachments/att-1/preview?token=abc',
        downloadUrl: 'https://oss.example.com/x?Expires=1&Signature=s',
        expiresAt: '2026-08-18T12:15:00Z',
      },
      requestId: 'request-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await attachmentApi.previewUrl('project-1', 'att-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/attachments/att-1/preview-url',
      expect.any(Object),
    )
    expect(result).toMatchObject({
      attachmentId: 'att-1',
      previewable: true,
      previewType: 'IMAGE',
    })
  })
})

describe('resolvePreviewUrl（§4.1 相对路径拼 ORIGIN）', () => {
  it('keeps absolute URLs unchanged', () => {
    expect(resolvePreviewUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('prepends origin to relative preview paths', () => {
    expect(resolvePreviewUrl('/api/v1/projects/p/attachments/a/preview?token=x')).toBe(
      `${window.location.origin}/api/v1/projects/p/attachments/a/preview?token=x`,
    )
  })
})
