import { describe, expect, it } from 'vitest'
import { canPerformInputRequestAction, isInputRequestReadOnly } from './inputRequestActions'

describe('InputRequest action matrix', () => {
  it('allows only reply for pending INPUT requests', () => {
    const request = { kind: 'INPUT' as const, status: 'PENDING' as const }
    expect(canPerformInputRequestAction(request, 'reply')).toBe(true)
    expect(canPerformInputRequestAction(request, 'approve')).toBe(false)
    expect(canPerformInputRequestAction(request, 'reject')).toBe(false)
  })

  it('allows only approve or reject for pending APPROVAL requests', () => {
    const request = { kind: 'APPROVAL' as const, status: 'PENDING' as const }
    expect(canPerformInputRequestAction(request, 'reply')).toBe(false)
    expect(canPerformInputRequestAction(request, 'approve')).toBe(true)
    expect(canPerformInputRequestAction(request, 'reject')).toBe(true)
  })

  it('makes every handled request read-only', () => {
    for (const status of ['ANSWERED', 'APPROVED', 'REJECTED'] as const) {
      expect(isInputRequestReadOnly(status)).toBe(true)
      expect(canPerformInputRequestAction({ kind: 'INPUT', status }, 'reply')).toBe(false)
    }
  })
})
