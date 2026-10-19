import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { githubApi } from '@/api'
import type { MergeRequestSummary } from '@/types/task-model'
import type { WorkBranch } from '@/types/github'
import { CodePage } from './CodePage'

const useMergeRequestsMock = vi.hoisted(() => vi.fn())
const useWorkBranchesMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/task-model', () => ({
  useMergeRequests: useMergeRequestsMock,
}))

vi.mock('@/hooks/workBranch', () => ({
  useWorkBranches: useWorkBranchesMock,
}))

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    githubApi: {
      ...actual.githubApi,
      listProjectRepositories: vi.fn(),
    },
    groupApi: {
      listByProject: vi.fn().mockResolvedValue([
        { id: 'group-login', projectId: 'demo-project', type: 'REQUIREMENT', title: '登录功能' },
      ]),
    },
  }
})

const mergeRequests: MergeRequestSummary[] = [
  {
    id: 'mr-1',
    repositoryId: 'bound-demo-auth-service',
    groupIds: ['group-login'],
    provider: 'github',
    number: 42,
    title: 'feat: add login API',
    sourceBranch: 'feat/login-api',
    targetBranch: 'main',
    status: 'OPEN',
    headCommit: 'abc1234',
    createMode: 'UNKNOWN',
  },
]

const workBranches: WorkBranch[] = [
  {
    projectRepositoryId: 'bound-demo-auth-service',
    name: 'feat/login-api',
    workspaceId: 'ws-1',
    lastKnownHead: 'abc1234',
    latestTask: { id: 'task-1', displayCode: 'T-1024', title: '登录接口开发', updatedAt: '2026-08-17T12:00:00Z' },
    requirementGroups: [{ id: 'group-login', title: '登录功能' }],
    latestDiff: {
      id: 'diff-login',
      taskId: 'task-1',
      status: 'PENDING_REVIEW',
      changeStats: { additions: 12, deletions: 3 },
      createdAt: '2026-08-17T12:05:00Z',
    },
    openMergeRequest: null,
    lastVerification: { kind: 'TEST_RUN', status: 'PASSED', commitSha: 'abc1234', completedAt: '2026-08-17T12:10:00Z' },
  },
  {
    projectRepositoryId: 'bound-demo-auth-service',
    name: 'feat/payment-hook',
    workspaceId: 'ws-2',
    lastKnownHead: 'c4d5e6f',
    latestTask: null,
    requirementGroups: [],
    latestDiff: null,
    openMergeRequest: null,
    lastVerification: null,
  },
]

function renderPage(path = '/app/projects/demo-project/code') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/projects/:projectId/code" element={<CodePage />} />
            <Route path="/app/projects/:projectId/tasks/:taskId" element={<div>task detail</div>} />
            <Route path="/app/projects/:projectId/code/diff/:diffId" element={<div>diff detail</div>} />
            <Route path="/app/projects/:projectId/code/mr/:mergeRequestId" element={<div>mr detail</div>} />
          </Routes>
        </MemoryRouter>
      </App>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  ;(githubApi.listProjectRepositories as ReturnType<typeof vi.fn>).mockResolvedValue([
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
  ])
  useWorkBranchesMock.mockReturnValue({
    data: { data: workBranches, page: { nextCursor: null, hasMore: false }, requestId: 'r1' },
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  useMergeRequestsMock.mockReturnValue({
    data: { data: mergeRequests, page: { nextCursor: null, hasMore: false }, requestId: 'r1' },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
})

describe('CodePage', () => {
  it('shows the branch workspace by default with real work-branch rows', async () => {
    renderPage()
    expect(await screen.findByText('需求过滤')).toBeInTheDocument()
    expect(await screen.findByText('feat/login-api')).toBeInTheDocument()
    expect(screen.getByText('T-1024')).toBeInTheDocument()
    expect(screen.queryByText('实现邮箱登录')).not.toBeInTheDocument()
  })

  it('filters branches by the real requirement group dropdown', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('需求过滤')

    // 选需求群 → useWorkBranches 携带 requirementGroupId
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByTitle('登录功能'))
    await waitFor(() => {
      expect(useWorkBranchesMock).toHaveBeenLastCalledWith(
        'demo-project',
        expect.objectContaining({ requirementGroupId: 'group-login' }),
      )
    })
  })

  it('links the branch Diff column to the latest Diff snapshot', async () => {
    renderPage()
    const diffLink = await screen.findByTitle('查看该分支 Diff')
    expect(diffLink).toHaveTextContent('+12')
    expect(diffLink).toHaveTextContent('-3')
    expect(diffLink).toHaveAttribute(
      'href',
      expect.stringMatching(/\/app\/projects\/demo-project\/code\/diff\/diff-login/),
    )
  })

  it('keeps null-Diff branches showing an empty state instead of demo data', async () => {
    renderPage()
    // feat/payment-hook 无 latestDiff 且 +/- 为 0 → 可进入空 Diff 页
    expect(await screen.findByText('feat/payment-hook')).toBeInTheDocument()
    expect(screen.getByTitle('该分支暂无变更，打开空 Diff')).toBeInTheDocument()
  })
})
