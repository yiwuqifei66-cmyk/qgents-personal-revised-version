import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { githubApi } from '@/api/github'
import type { DiffComment, DiffDetail, DiffFile } from '@/types/task-model'
import { projectApi } from '@/api/project'
import DiffReviewPage from './DiffReviewPage'

const useDiffMock = vi.hoisted(() => vi.fn())
const useDiffFilesMock = vi.hoisted(() => vi.fn())
const useDiffCommentsMock = vi.hoisted(() => vi.fn())
const useAddDiffCommentMock = vi.hoisted(() => vi.fn())
const useTaskMock = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'demo@qgents.dev', displayName: '陈同学' },
}))

vi.mock('@/hooks/task-model', () => ({
  useDiff: useDiffMock,
  useDiffFiles: useDiffFilesMock,
  useDiffComments: useDiffCommentsMock,
  useAddDiffComment: useAddDiffCommentMock,
  useTask: useTaskMock,
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}))

vi.mock('@/api/project', () => ({
  projectApi: {
    getById: vi.fn(),
    listMembers: vi.fn(),
  },
}))

vi.mock('@/api/github', () => ({
  githubApi: {
    listProjectRepositories: vi.fn(),
  },
}))

const diff: DiffDetail = {
  id: 'diff-1',
  projectId: 'project-1',
  taskId: 'task-1',
  taskRunId: 'run-1',
  taskStepId: 'step-1',
  requirementGroupId: 'group-1',
  workspaceId: 'workspace-1',
  repositoryId: 'bound-demo-auth-service',
  baseCommit: 'base-1',
  sourceBranch: 'feat/login-api',
  headCommit: 'a1b2c3d',
  status: 'PENDING_REVIEW',
  changeStats: { files: 1, additions: 2, deletions: 1 },
  createdAt: '2026-08-12T08:00:00Z',
  workingTreeHash: null,
  snapshotKey: null,
  reviewedBy: null,
  reviewReason: null,
  reviewedAt: null,
  updatedAt: '2026-08-12T08:01:00Z',
}

const file: DiffFile = {
  id: 'file-1',
  sequence: 1,
  path: 'src/auth/AuthController.ts',
  changeType: 'MODIFIED',
  status: 'MODIFIED',
  additions: 2,
  deletions: 1,
  binary: false,
  hunks: [
    {
      id: 'hunk-login',
      header: '@@ -17,3 +17,4 @@',
      lines: [
        { kind: 'DEL', oldLine: 20, newLine: null, text: '    return this.authService.loginByPhone(dto)' },
        { kind: 'ADD', oldLine: null, newLine: 20, text: '    return this.authService.loginByEmail(dto)' },
      ],
    },
  ],
}

const comment: DiffComment = {
  id: 'comment-1',
  diffId: 'diff-1',
  path: 'src/auth/AuthController.ts',
  side: 'RIGHT',
  line: 20,
  hunkId: 'hunk-login',
  body: '密码有做哈希吗？',
  authorUserId: 'user-002',
  authorName: null,
  authorAvatarUrl: 'https://cdn.example.com/avatars/user-002.png',
  createdAt: '2026-05-16T11:20:00Z',
}

function idleMutation() {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
}

function renderPage(path = '/app/projects/project-1/code/diff/diff-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <App>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/projects/:projectId/code/diff/:diffId" element={<DiffReviewPage />} />
            <Route
              path="/app/projects/:projectId/code/mr/:mergeRequestId"
              element={<div>MR detail stub</div>}
            />
          </Routes>
        </MemoryRouter>
      </App>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  authState.user = { id: 'user-1', email: 'demo@qgents.dev', displayName: '陈同学' }
  vi.mocked(projectApi.getById).mockResolvedValue({
    id: 'project-1',
    teamId: 'team-1',
    name: 'Demo',
    role: 'PROJECT_ADMIN',
  })
  vi.mocked(projectApi.listMembers).mockResolvedValue([
    { userId: 'user-002', displayName: '李同学', email: 'li@example.com', role: 'PROJECT_MEMBER' },
  ])
  vi.mocked(githubApi.listProjectRepositories).mockResolvedValue([
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
  useDiffMock.mockReturnValue({
    data: diff,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  useDiffFilesMock.mockReturnValue({
    data: { data: [file], page: { nextCursor: null, hasMore: false }, requestId: 'r1' },
    isLoading: false,
    isError: false,
    error: null,
  })
  useDiffCommentsMock.mockReturnValue({
    data: { data: [comment], page: { nextCursor: null, hasMore: false }, requestId: 'r2' },
    isLoading: false,
    isError: false,
    error: null,
  })
  useAddDiffCommentMock.mockReturnValue(idleMutation())
  useTaskMock.mockReturnValue({
    data: {
      id: 'task-1',
      title: '登录任务',
      createdByUser: { id: 'user-1', displayName: 'Mock User', avatarUrl: null },
      repositories: [{ repositoryId: 'bound-demo-auth-service', defaultBranch: 'main', baseRef: 'main' }],
    },
    isLoading: false,
  })
})

describe('DiffReviewPage', () => {
  it('loads Diff detail, files and comments through the documented hooks', async () => {
    const { container } = renderPage()
    expect(useDiffMock).toHaveBeenCalledWith('project-1', 'diff-1')
    expect(useDiffFilesMock).toHaveBeenCalledWith('project-1', 'diff-1', { limit: 100 })
    expect(useDiffCommentsMock).toHaveBeenCalledWith('project-1', 'diff-1', { limit: 100 })
    expect(await screen.findByRole('heading', { name: 'Diff-登录任务' })).toBeInTheDocument()
    expect(screen.getByText('feat/login-api')).toBeInTheDocument()
    expect(screen.getByText('AuthController.ts')).toBeInTheDocument()
    expect(screen.getByText(/loginByEmail/)).toBeInTheDocument()
    expect(screen.getAllByText('密码有做哈希吗？').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: '历史评论' })).toBeInTheDocument()
    // 评论作者头像：有 avatarUrl 时渲染 <img>，而非名字首字符占位
    const avatarImg = container.querySelector('.diff-review__comment img')
    expect(avatarImg).not.toBeNull()
    expect(avatarImg).toHaveAttribute('src', 'https://cdn.example.com/avatars/user-002.png')
  })

  it('falls back to initial character when comment author has no avatar', async () => {
    useDiffCommentsMock.mockReturnValue({
      data: {
        data: [
          { ...comment, id: 'comment-2', authorAvatarUrl: null, authorName: '李同学' },
        ],
        page: { nextCursor: null, hasMore: false },
        requestId: 'r3',
      },
      isLoading: false,
      isError: false,
      error: null,
    })
    const { container } = renderPage()
    expect(await screen.findByText('密码有做哈希吗？')).toBeInTheDocument()
    // 无头像时回退到名字首字符占位（不渲染 img）
    expect(container.querySelector('.diff-review__comment img')).toBeNull()
  })

  it('opens the file from the file query string', async () => {
    const extra: DiffFile = {
      ...file,
      id: 'file-a',
      path: 'a.ts',
      hunks: [{ id: 'hunk-a', header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'ADD', oldLine: null, newLine: 1, text: 'x' }] }],
    }
    useDiffFilesMock.mockReturnValue({
      data: { data: [file, extra], page: { nextCursor: null, hasMore: false }, requestId: 'r1' },
      isLoading: false,
      isError: false,
      error: null,
    })
    renderPage('/app/projects/project-1/code/diff/diff-1?file=a.ts')
    expect(await screen.findByText('2/2 个文件')).toBeInTheDocument()
  })

  it('does not import demo fixtures when the API returns no Diff', () => {
    useDiffMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Diff 不存在'),
      refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Diff 不存在')).toBeInTheDocument()
    expect(screen.queryByText('loginByPhone')).not.toBeInTheDocument()
  })

  // 9 个依赖已下线功能（accept/reject/create MR/MR 列表/自动跳转新快照）的测试已下线

  it('can submit a comment via the comment composer', async () => {
    const submitMock = vi.fn().mockResolvedValue(undefined)
    const mutateMock = vi.fn((_input, opts) => {
      opts?.onSuccess()
      submitMock()
    })
    useAddDiffCommentMock.mockReturnValue({ mutate: mutateMock, mutateAsync: vi.fn(), isPending: false })

    renderPage()
    const textarea = await screen.findByPlaceholderText('在当前 Diff 发表意见')
    fireEvent.change(textarea, { target: { value: '这段逻辑需要优化一下' } })
    const button = screen.getByRole('button', { name: /发表评论/ })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: '这段逻辑需要优化一下', path: 'src/auth/AuthController.ts' }),
        expect.any(Object),
      )
    })
    await waitFor(() => {
      expect(submitMock).toHaveBeenCalled()
    })
    expect(screen.getByPlaceholderText('在当前 Diff 发表意见')).toHaveValue('')
  })

  it('shows an empty hunk state when files have no structured lines', async () => {
    useDiffFilesMock.mockReturnValue({
      data: {
        data: [{ ...file, hunks: [] }],
        page: { nextCursor: null, hasMore: false },
        requestId: 'r1',
      },
      isLoading: false,
      isError: false,
      error: null,
    })
    renderPage()
    expect(await screen.findByText(/本轮未返回结构化 hunk/)).toBeInTheDocument()
  })

  it('renders an empty shell for zero-change branch entry without calling live Diff APIs', async () => {
    renderPage('/app/projects/project-1/code/diff/empty-branch%3Abr-auth-main')
    expect(await screen.findByText('没有文件')).toBeInTheDocument()
    expect(screen.getByText('该分支当前没有可查看的代码变更')).toBeInTheDocument()
    expect(useDiffMock).toHaveBeenCalledWith('project-1', '')
    expect(useDiffFilesMock).toHaveBeenCalledWith('project-1', '', { limit: 100 })
  })
})
