import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { githubInstallationDisconnectErrorMessage } from '@/hooks/useGithubInstall'

describe('githubInstallationDisconnectErrorMessage', () => {
  it('maps GITHUB_INSTALLATION_IN_USE to the unbind-first toast', () => {
    const error = new ApiError('Installation still in use', 409, {
      error: {
        code: 'GITHUB_INSTALLATION_IN_USE',
        message: 'installation is still referenced by project repositories',
      },
    })
    expect(githubInstallationDisconnectErrorMessage(error)).toBe(
      '请先解绑相关项目仓库后再解除关联',
    )
  })

  it('falls back to the generic formatter for other API errors', () => {
    const error = new ApiError('Forbidden', 403, {
      error: { code: 'TEAM_OWNER_REQUIRED', message: '仅 Team Owner 可操作' },
    })
    expect(githubInstallationDisconnectErrorMessage(error)).toBe(
      '[TEAM_OWNER_REQUIRED] 仅 Team Owner 可操作',
    )
  })
})
