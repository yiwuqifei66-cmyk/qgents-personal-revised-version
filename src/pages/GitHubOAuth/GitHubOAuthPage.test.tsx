import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubOAuthStatus } from '@/types'
import { GitHubOAuthPage } from './GitHubOAuthPage'

const statusMock = vi.hoisted(() => vi.fn())
const startMock = vi.hoisted(() => vi.fn())
const revokeMock = vi.hoisted(() => vi.fn())
const meMock = vi.hoisted(() => vi.fn())
const installMock = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  authApi: {
    getGithubOAuthStatus: statusMock,
    startGithubOAuth: startMock,
    revokeGithubOAuth: revokeMock,
    me: meMock,
  },
  githubApi: {
    createInstallation: installMock,
  },
}))

const unauthorized: GithubOAuthStatus = {
  authorized: false,
  provider: null,
  githubUserId: null,
  githubLogin: null,
  scopes: [],
  authorizedAt: null,
  lastValidatedAt: null,
  canCreatePublicPersonalRepository: false,
  canCreatePrivatePersonalRepository: false,
  personalRepositorySetup: 'NEED_OAUTH',
  expectedInstallationLogin: null,
}

function renderPage(search = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App>
        <MemoryRouter initialEntries={[`/app/settings/integrations/github${search}`]}>
          <Routes>
            <Route path="/app/settings/integrations/github" element={<><GitHubOAuthPage /><QueryProbe /></>} />
          </Routes>
        </MemoryRouter>
      </App>
    </QueryClientProvider>,
  )
}

function QueryProbe() {
  const [params] = useSearchParams()
  return <output data-testid="query-string">{params.toString()}</output>
}

beforeEach(() => {
  statusMock.mockReset()
  startMock.mockReset()
  revokeMock.mockReset()
  meMock.mockReset()
  installMock.mockReset()
  statusMock.mockResolvedValue(unauthorized)
  startMock.mockResolvedValue({ authorizationUrl: 'https://github.com/login/oauth/authorize?state=x', expiresAt: '2026-08-20T15:00:00Z' })
  revokeMock.mockResolvedValue(undefined)
  meMock.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com', displayName: 'A' }, teams: [], projects: [] })
  installMock.mockResolvedValue({ installationUrl: 'https://github.com/apps/qgents/installations/new?state=x', expiresAt: '2026-08-21T02:00:00Z' })
})

describe('GitHubOAuthPage', () => {
  it('starts authorization through the backend and never builds the GitHub URL itself', async () => {
    const user = userEvent.setup()
    startMock.mockRejectedValue(new Error('oauth start failed'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /关联个人 GitHub/ }))

    await waitFor(() => expect(startMock).toHaveBeenCalledWith('WEB'))
  })

  it('shows the real linked account and can revoke it', async () => {
    const user = userEvent.setup()
    statusMock.mockResolvedValue({
      ...unauthorized,
      authorized: true,
      provider: 'GITHUB',
      githubUserId: 123,
      githubLogin: 'octocat',
      scopes: ['public_repo'],
      canCreatePublicPersonalRepository: true,
      canCreatePrivatePersonalRepository: false,
      personalRepositorySetup: 'READY',
      expectedInstallationLogin: null,
    } satisfies GithubOAuthStatus)
    renderPage()

    expect(await screen.findByText('octocat')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /解除个人授权/ }))
    await user.click(await screen.findByRole('button', { name: /确认解除/ }))
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(1))
  })

  it('handles the backend callback result and removes one-shot query parameters', async () => {
    renderPage('?githubOAuth=failed&code=GITHUB_OAUTH_STATE_EXPIRED')

    expect(await screen.findByText('授权链接已过期，请重新发起授权。')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('query-string').textContent).toBe(''))
  })

  it('blocks OAuth and offers to install the App when there is no USER installation', async () => {
    const user = userEvent.setup()
    statusMock.mockResolvedValue({ ...unauthorized, personalRepositorySetup: 'NEED_INSTALLATION' })
    meMock.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', displayName: 'A' },
      teams: [{ id: 'team-owner', name: 'QGGG', role: 'TEAM_OWNER' }],
      projects: [],
    })
    renderPage()

    // 未授权且没有 USER 安装时：不出现绑定按钮，只出现「去安装 GitHub App」
    expect(await screen.findByText(/请先用你的个人 GitHub 账号安装/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /关联个人 GitHub/ })).not.toBeInTheDocument()

    const installButton = screen.getByRole('button', { name: /去安装 GitHub App/ })
    await user.click(installButton)
    await waitFor(() => expect(installMock).toHaveBeenCalledWith('team-owner', 'WEB'))
  })
})
