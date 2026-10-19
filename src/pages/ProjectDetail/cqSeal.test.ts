import { describe, expect, it } from 'vitest'
import { cqSealAppearance, isCqCommitStale, isMergeRequestAuthor, shortCommitSha } from './cqSeal'

describe('cqSeal', () => {
  it('shortens a commit SHA for the stamp face', () => {
    expect(shortCommitSha('a1b2c3d4e5f67890')).toBe('a1b2c3d')
    expect(shortCommitSha(null)).toBe('—')
  })

  it('treats prefix-matching SHAs as the same commit', () => {
    expect(isCqCommitStale('a1b2c3d', 'a1b2c3d4e5f67890')).toBe(false)
    expect(isCqCommitStale('deadbeef', 'a1b2c3d4e5f67890')).toBe(true)
    expect(isCqCommitStale(null, 'abc')).toBe(false)
  })

  it('locks an empty seal for the task author and cracks a stamp when HEAD moved', () => {
    expect(isMergeRequestAuthor('user-1', 'user-1')).toBe(true)
    expect(isMergeRequestAuthor('user-1', 'user-2')).toBe(false)
    expect(cqSealAppearance({
      status: 'PENDING',
      isAuthor: true,
      stampedSha: null,
      headCommit: 'abc1234',
    })).toBe('locked')
    expect(cqSealAppearance({
      status: 'PASSED',
      isAuthor: false,
      stampedSha: 'abc1234',
      headCommit: 'abc1234fff',
    })).toBe('stamped')
    expect(cqSealAppearance({
      status: 'PASSED',
      isAuthor: false,
      stampedSha: 'oldsha01',
      headCommit: 'newsha02',
    })).toBe('cracked')
    expect(cqSealAppearance({
      status: 'FAILED',
      isAuthor: true,
      stampedSha: 'abc',
      headCommit: 'abc',
    })).toBe('failed')
  })
})
