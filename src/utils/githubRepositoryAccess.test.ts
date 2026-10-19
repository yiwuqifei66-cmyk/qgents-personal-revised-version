import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { GithubOAuthStatus } from '@/types/auth'
import type { GithubInstallation } from '@/types/github'
import {
  canUseInstallationForNewRepository,
  githubRepositoryNotAuthorizedMessage,
  newRepositoryCreateErrorMessage,
  newRepositoryInstallationOptionLabel,
  personalRepositorySetupGuide,
  privateRepositoryAuthorizationMessage,
} from './githubRepositoryAccess'

const organizationInstallation: GithubInstallation = {
  id: 'installation-org',
  providerInstallationId: 1,
  accountLogin: 'qgents-org',
  accountType: 'ORGANIZATION',
  installedAt: '2026-08-20T00:00:00Z',
  status: 'ACTIVE',
  metadataSyncedAt: '2026-08-20T00:00:00Z',
}

const personalInstallation: GithubInstallation = {
  ...organizationInstallation,
  id: 'installation-user',
  accountLogin: 'octocat',
  accountType: 'USER',
}

const oauth = (overrides: Partial<GithubOAuthStatus> = {}): GithubOAuthStatus => ({
  authorized: true,
  provider: 'GITHUB',
  githubUserId: 123,
  githubLogin: 'octocat',
  scopes: ['repo'],
  authorizedAt: '2026-08-20T00:00:00Z',
  lastValidatedAt: '2026-08-20T00:00:00Z',
  canCreatePublicPersonalRepository: true,
  canCreatePrivatePersonalRepository: true,
  personalRepositorySetup: 'READY',
  expectedInstallationLogin: null,
  ...overrides,
})

describe('GitHub automatic repository access rules', () => {
  it('allows an active organization installation without personal OAuth', () => {
    expect(canUseInstallationForNewRepository(organizationInstallation, undefined)).toBe(true)
  })

  it('blocks a personal installation until OAuth is authorized for the same account', () => {
    expect(canUseInstallationForNewRepository(personalInstallation, undefined)).toBe(false)
    expect(canUseInstallationForNewRepository(personalInstallation, oauth({ githubLogin: 'other-user' }))).toBe(false)
    expect(canUseInstallationForNewRepository(personalInstallation, oauth())).toBe(true)
  })

  it('blocks private personal repos when the private capability field is missing', () => {
    const publicOnlyOAuth = oauth({ canCreatePrivatePersonalRepository: false })
    expect(privateRepositoryAuthorizationMessage(personalInstallation, publicOnlyOAuth)).toContain('私有')
    expect(privateRepositoryAuthorizationMessage(organizationInstallation, undefined)).toBeNull()
  })
})

describe('new repository create error mapping (§49.7)', () => {
  const apiError = (code: string) =>
    new ApiError('boom', 403, { error: { code, message: 'raw backend message' } })

  it('keeps the GitHub App repo-scope hint for GITHUB_REPOSITORY_NOT_AUTHORIZED', () => {
    const message = newRepositoryCreateErrorMessage(apiError('GITHUB_REPOSITORY_NOT_AUTHORIZED'))
    expect(message).toContain('无需重新绑定 GitHub OAuth')
  })

  it('maps scope / installation / conflict codes to friendly hints', () => {
    expect(newRepositoryCreateErrorMessage(apiError('GITHUB_OAUTH_REQUIRED'))).toContain('先绑定个人 GitHub')
    expect(newRepositoryCreateErrorMessage(apiError('GITHUB_OAUTH_SCOPE_INSUFFICIENT'))).toContain('授权范围不足')
    expect(newRepositoryCreateErrorMessage(apiError('GITHUB_REPOSITORY_CREATE_CONFLICT'))).toContain('仓库名已存在')
    expect(newRepositoryCreateErrorMessage(apiError('GITHUB_INSTALLATION_NOT_ACTIVE'))).toContain('没有可用的')
  })

  it('returns null for unrelated errors', () => {
    expect(newRepositoryCreateErrorMessage(apiError('FORBIDDEN'))).toBeNull()
    expect(newRepositoryCreateErrorMessage(new Error('boom'))).toBeNull()
  })
})

describe('personal repository setup guide (§49.4)', () => {
  const withSetup = (setup: GithubOAuthStatus['personalRepositorySetup'], extra: Partial<GithubOAuthStatus> = {}) =>
    oauth({ personalRepositorySetup: setup, expectedInstallationLogin: null, ...extra })

  it('returns no guide for READY or a missing field', () => {
    expect(personalRepositorySetupGuide(withSetup('READY'))).toBeNull()
    expect(personalRepositorySetupGuide(undefined)).toBeNull()
  })

  it('guides NEED_OAUTH to bind with the OAuth link', () => {
    const guide = personalRepositorySetupGuide(withSetup('NEED_OAUTH'))
    expect(guide?.message).toContain('绑定 GitHub')
    expect(guide?.linkToOAuth).toBe(true)
  })

  it('uses expectedInstallationLogin for ACCOUNT_MISMATCH and does not push a re-install', () => {
    const guide = personalRepositorySetupGuide(withSetup('ACCOUNT_MISMATCH', { expectedInstallationLogin: 'alice' }))
    expect(guide?.message).toContain('alice')
    expect(guide?.message).toContain('无需重装 App')
    expect(guide?.linkToOAuth).toBe(true)
  })

  it('guides NOT_OWNER and NEED_INSTALLATION without an OAuth link', () => {
    const notOwner = personalRepositorySetupGuide(withSetup('NOT_OWNER'))
    expect(notOwner?.message).toContain('Owner')
    expect(notOwner?.linkToOAuth).toBeFalsy()
    const needInstall = personalRepositorySetupGuide(withSetup('NEED_INSTALLATION'))
    expect(needInstall?.message).toContain('安装')
    expect(needInstall?.linkToOAuth).toBeFalsy()
  })
})

describe('new repository installation option label (§49.4)', () => {
  it('distinguishes organization / personal / needs-bind / account-mismatch', () => {
    expect(newRepositoryInstallationOptionLabel(organizationInstallation, undefined)).toContain('组织')
    expect(newRepositoryInstallationOptionLabel(personalInstallation, oauth())).toContain('个人')
    expect(newRepositoryInstallationOptionLabel(personalInstallation, oauth({ personalRepositorySetup: 'NEED_OAUTH' }))).toContain('需绑定')
    expect(newRepositoryInstallationOptionLabel(
      personalInstallation,
      oauth({ personalRepositorySetup: 'ACCOUNT_MISMATCH', expectedInstallationLogin: 'alice' }),
    )).toContain('需重新绑定')
    expect(newRepositoryInstallationOptionLabel(
      personalInstallation,
      oauth({ personalRepositorySetup: 'ACCOUNT_MISMATCH' }),
    )).not.toContain('需绑定个人 GitHub')
  })
})

describe('installation availability respects personalRepositorySetup', () => {
  const withSetup = (setup: GithubOAuthStatus['personalRepositorySetup']) =>
    oauth({ personalRepositorySetup: setup })

  it('blocks a personal installation unless setup is READY, organization is unaffected', () => {
    expect(canUseInstallationForNewRepository(personalInstallation, withSetup('NEED_OAUTH'))).toBe(false)
    expect(canUseInstallationForNewRepository(personalInstallation, withSetup('ACCOUNT_MISMATCH'))).toBe(false)
    expect(canUseInstallationForNewRepository(personalInstallation, withSetup('READY'))).toBe(true)
    expect(canUseInstallationForNewRepository(organizationInstallation, withSetup('NEED_OAUTH'))).toBe(true)
  })
})

describe('GitHub repository not authorized (backend 403) message', () => {
  it('returns the GitHub App repo-scope hint for GITHUB_REPOSITORY_NOT_AUTHORIZED', () => {
    const error = new ApiError('not authorized', 403, {
      error: {
        code: 'GITHUB_REPOSITORY_NOT_AUTHORIZED',
        message: 'Repository created but not visible to the GitHub App',
      },
    })
    const message = githubRepositoryNotAuthorizedMessage(error)
    expect(message).toContain('GitHub App')
    expect(message).toContain('无需重新绑定 GitHub OAuth')
  })

  it('returns null for unrelated errors', () => {
    expect(githubRepositoryNotAuthorizedMessage(new ApiError('boom', 500))).toBeNull()
    expect(githubRepositoryNotAuthorizedMessage(new ApiError('denied', 403, { error: { code: 'FORBIDDEN' } }))).toBeNull()
    expect(githubRepositoryNotAuthorizedMessage(new Error('boom'))).toBeNull()
    expect(githubRepositoryNotAuthorizedMessage(null)).toBeNull()
  })
})
