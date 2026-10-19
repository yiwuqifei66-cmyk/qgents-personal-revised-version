import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api'
import { formatApiError } from './formatApiError'

describe('formatApiError', () => {
  it('includes requestId for a server error', () => {
    const error = new ApiError('Internal error', 500, {
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected failure' },
      requestId: 'req-123',
    })

    expect(formatApiError(error)).toContain('req-123')
  })

  it('does not expose requestId for a client error', () => {
    const error = new ApiError('Invalid field', 422, {
      error: { code: 'VALIDATION_FAILED', message: 'Invalid name' },
      requestId: 'req-123',
    })

    expect(formatApiError(error)).not.toContain('req-123')
  })
})
