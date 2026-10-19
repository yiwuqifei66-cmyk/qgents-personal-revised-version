import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergeRequestSummary } from '@/types/task-model'
import { MergeRequestTab } from './MergeRequestTab'

const useMergeRequestsMock = vi.hoisted(() => vi.fn())
const useMergeMergeRequestMock = vi.hoisted(() => vi.fn())
const useRequestMergeRequestPreflightMock = vi.hoisted(() => vi.fn())
const useRetryMergeRequestPreflightMock = vi.hoisted(() => vi.fn())
const useSyncMergeRequestMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/task-model', () => ({
  useMergeRequests: useMergeRequestsMock,
  useMergeMergeRequest: useMergeMergeRequestMock,
  useRequestMergeRequestPreflight: useRequestMergeRequestPreflightMock,
  useRetryMergeRequestPreflight: useRetryMergeRequestPreflightMock,
  useSyncMergeRequest: useSyncMergeRequestMock,
}))

const items: MergeRequestSummary[] = [
  {
    id: 'mr-1',
    repositoryId: 'bound-demo-auth-service',
    groupIds: ['group-1'],
    provider: 'GITHUB',
    number: 42,
    title: '实现邮箱登录',
    sourceBranch: 'feat/login-api',
    targetBranch: 'main',
    status: 'OPEN',
    headCommit: 'abc123456789',
    webUrl: 'https://github.com/mock/demo/pull/42',
    qualityGate: { status: 'PENDING', requiredChecks: ['TESTSET'] },
    createMode: 'UNKNOWN',
  },
  {
    id: 'mr-2',
    repositoryId: 'bound-demo-web-console',
    groupIds: ['group-1'],
    provider: 'GITHUB',
    number: 18,
    title: '登录页接入',
    sourceBranch: 'feat/login-api',
    targetBranch: 'main',
    status: 'MERGED',
    headCommit: 'def456789012',
    webUrl: null,
    qualityGate: { status: 'PASSED', requiredChecks: ['TESTSET'] },
    createMode: 'UNKNOWN',
  },
]

function renderTab(path = '/code?tab=mr') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MergeRequestTab
        projectId="demo-project"
        repositories={[
          {
            id: 'bound-demo-auth-service',
            repositoryId: 'repo-2',
            installationId: 'install-1',
            providerRepositoryId: 1,
            fullName: 'mock/auth-service',
            githubUrl: 'https://github.com/mock/auth-service',
            displayName: 'auth-service',
            defaultBranch: 'main',
            authorizationStatus: 'AUTHORIZED',
            metadataSyncedAt: '2026-08-15T00:00:00Z',
            boundAt: '2026-08-15T00:00:00Z',
          },
          {
            id: 'bound-demo-web-console',
            repositoryId: 'repo-3',
            installationId: 'install-1',
            providerRepositoryId: 2,
            fullName: 'mock/web-console',
            githubUrl: 'https://github.com/mock/web-console',
            displayName: 'web-console',
            defaultBranch: 'main',
            authorizationStatus: 'AUTHORIZED',
            metadataSyncedAt: '2026-08-15T00:00:00Z',
            boundAt: '2026-08-15T00:00:00Z',
          },
        ]}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useMergeMergeRequestMock.mockReturnValue({ mutateAsync: vi.fn() })
  useRequestMergeRequestPreflightMock.mockReturnValue({ mutateAsync: vi.fn() })
  useRetryMergeRequestPreflightMock.mockReturnValue({ mutateAsync: vi.fn() })
  useSyncMergeRequestMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(items[0]) })
  useMergeRequestsMock.mockReturnValue({
    data: { data: items, page: { nextCursor: null, hasMore: false }, requestId: 'r1' },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
})

describe('MergeRequestTab', () => {
  it('loads merge requests through the documented list hook', () => {
    renderTab()
    expect(useMergeRequestsMock).toHaveBeenCalledWith('demo-project', {
      repositoryId: undefined,
      status: undefined,
      limit: 50,
    })
    expect(screen.getByText('实现邮箱登录')).toBeInTheDocument()
    expect(screen.getByText('auth-service')).toBeInTheDocument()
    // GitHub 外链只对真实 MR 且门禁已通过的记录开放；OPEN 且门禁仍为 PENDING 的记录不应显示入口。
    const githubButtons = screen.getAllByRole('button', { name: '查看 GitHub MR' })
    expect(githubButtons).toHaveLength(1)
    const mergedRow = screen.getByRole('row', { name: /#18 登录页接入/ })
    expect(within(mergedRow).getByRole('button', { name: '查看 GitHub MR' })).toBeInTheDocument()
    const openRow = screen.getByRole('row', { name: /#42 实现邮箱登录/ })
    expect(within(openRow).queryByRole('button', { name: '查看 GitHub MR' })).not.toBeInTheDocument()
  })

  it('forwards repository and status filters from the query string', () => {
    renderTab('/code?tab=mr&repositoryId=bound-demo-auth-service&status=OPEN')
    expect(useMergeRequestsMock).toHaveBeenCalledWith('demo-project', {
      repositoryId: 'bound-demo-auth-service',
      status: 'OPEN',
      limit: 50,
    })
  })
})
