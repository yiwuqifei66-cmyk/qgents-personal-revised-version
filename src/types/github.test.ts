import { describe, expect, it } from 'vitest'
import {
  countAuthorizedRepositories,
  formatGithubDateTime,
  githubInstallationConfigureUrl,
  toGithubAppInstallNewUrl,
} from './github'

describe('githubInstallationConfigureUrl', () => {
  it('opens the personal GitHub App configure page', () => {
    expect(
      githubInstallationConfigureUrl({
        accountType: 'USER',
        accountLogin: 'Yjingwen-svg',
        providerInstallationId: 12345678,
      }),
    ).toBe('https://github.com/settings/installations/12345678')
  })

  it('opens the organization GitHub App configure page', () => {
    expect(
      githubInstallationConfigureUrl({
        accountType: 'ORGANIZATION',
        accountLogin: 'qgents-org',
        providerInstallationId: 87654321,
      }),
    ).toBe('https://github.com/organizations/qgents-org/settings/installations/87654321')
  })

  it('returns null when providerInstallationId is missing', () => {
    expect(
      githubInstallationConfigureUrl({
        accountType: 'USER',
        accountLogin: 'demo',
        providerInstallationId: 0,
      }),
    ).toBeNull()
  })
})

describe('toGithubAppInstallNewUrl', () => {
  it('keeps a GitHub App new-install URL and its state', () => {
    expect(
      toGithubAppInstallNewUrl('https://github.com/apps/qgents/installations/new?state=abc'),
    ).toBe('https://github.com/apps/qgents/installations/new?state=abc')
  })

  it('rewrites a configure URL back to the new-install page and keeps state', () => {
    expect(
      toGithubAppInstallNewUrl('https://github.com/settings/installations/12345678?state=abc'),
    ).toBe('https://github.com/apps/qgents/installations/new?state=abc')
    expect(
      toGithubAppInstallNewUrl(
        'https://github.com/organizations/qgents-org/settings/installations/87654321?state=abc',
      ),
    ).toBe('https://github.com/apps/qgents/installations/new?state=abc')
  })

  it('rejects a non-GitHub URL', () => {
    expect(toGithubAppInstallNewUrl('https://example.com/install')).toBeNull()
  })
})

describe('formatGithubDateTime', () => {
  it('formats a UTC timestamp without Z as Beijing wall time', () => {
    expect(formatGithubDateTime('2026-08-16T03:24:56.030514')).toBe(
      '2026年08月16日 11时24分56秒',
    )
  })

  it('formats an explicit Z timestamp as Beijing wall time', () => {
    expect(formatGithubDateTime('2026-08-01T08:00:00Z')).toBe('2026年08月01日 16时00分00秒')
  })

  it('returns a dash when the value is empty', () => {
    expect(formatGithubDateTime('')).toBe('—')
    expect(formatGithubDateTime(null)).toBe('—')
  })
})

describe('countAuthorizedRepositories', () => {
  it('ignores revoked repositories when counting authorized repos', () => {
    expect(
      countAuthorizedRepositories('inst-1', [
        { installationId: 'inst-1', authorizationStatus: 'AUTHORIZED' },
        { installationId: 'inst-1', authorizationStatus: 'REVOKED' },
        { installationId: 'inst-2', authorizationStatus: 'AUTHORIZED' },
      ]),
    ).toBe(1)
  })
})
