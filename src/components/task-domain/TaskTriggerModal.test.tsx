import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api'

const navigateMock = vi.hoisted(() => vi.fn())
const mutationMock = vi.hoisted(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null }))
const repositoriesMock = vi.hoisted(() => vi.fn())
const remoteBranchesMock = vi.hoisted(() => vi.fn())
const groupsMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/task-model', () => ({ useCreateTask: () => mutationMock }))
vi.mock('@/api/github', () => ({
  githubApi: { listProjectRepositories: repositoriesMock, listRemoteBranches: remoteBranchesMock },
}))
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, groupApi: { listByProject: groupsMock } }
})
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

import { TaskTriggerModal } from './TaskTriggerModal'

const task = { id: 'task-1' }
const repository = {
  id: 'binding-1', installationId: 'installation-1', repositoryId: 'repo-1', fullName: 'org/repo', githubUrl: 'https://github.com/org/repo', defaultBranch: 'main', boundProjectId: 'project-test', boundProjectName: 'Test', syncStatus: 'SYNCED' as const,
}
const remoteBranch = { name: 'main', isProjectDefault: true, isGithubDefault: true, headCommit: 'abc1234' }
const requirementGroup = { id: 'group-test', projectId: 'project-test', type: 'REQUIREMENT' as const, title: '登录功能', status: 'ACTIVE' as const }

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><TaskTriggerModal open projectId="project-test" groupId="group-test" initialInstruction="initial requirement" onClose={onClose} /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  mutationMock.mutateAsync.mockReset(); mutationMock.reset.mockReset(); mutationMock.isPending = false; mutationMock.error = null; navigateMock.mockReset(); repositoriesMock.mockReset(); repositoriesMock.mockResolvedValue([repository]); remoteBranchesMock.mockReset(); remoteBranchesMock.mockResolvedValue([remoteBranch]); groupsMock.mockReset(); groupsMock.mockResolvedValue([requirementGroup])
})

describe('TaskTriggerModal', () => {
  it('submits per-repository baseRef with each repository branch', async () => {
    const user = userEvent.setup(); mutationMock.mutateAsync.mockResolvedValue(task); renderModal()
    await user.type(screen.getByLabelText('任务标题'), ' 新任务')
    await user.click(screen.getByLabelText('仓库'))
    await user.click(await screen.findByText('org/repo'))
    // 默认对齐到项目默认分支 main
    expect(await screen.findByText('main')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    await waitFor(() => expect(mutationMock.mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutationMock.mutateAsync).toHaveBeenCalledWith({
      requirementGroupId: 'group-test',
      title: '新任务',
      requirement: 'initial requirement',
      repositoryIds: ['binding-1'],
      repositoryRefs: [{ repositoryId: 'binding-1', baseRef: 'main' }],
    })
    expect(navigateMock).toHaveBeenCalledWith('/app/projects/project-test/tasks?taskId=task-1')
  })

  it('submits null baseRefs when the user clears the branch selection (default branch fallback)', async () => {
    const user = userEvent.setup(); mutationMock.mutateAsync.mockResolvedValue(task); renderModal()
    await user.type(screen.getByLabelText('任务标题'), '新任务')
    await user.click(screen.getByLabelText('仓库'))
    await user.click(await screen.findByText('org/repo'))
    // 清空该仓库的分支选择（antd Select 的清除按钮）
    await waitFor(() => expect(remoteBranchesMock).toHaveBeenCalled())
    const clearButton = (await screen.findByText('main')).closest('.ant-select')?.querySelector('.ant-select-clear') as HTMLElement
    expect(clearButton).not.toBeNull()
    await user.click(clearButton)
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    await waitFor(() => expect(mutationMock.mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutationMock.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryRefs: [{ repositoryId: 'binding-1', baseRef: 'main' }] }),
    )
  })

  it('does not render legacy start mode controls', () => {
    renderModal()
    expect(screen.queryByText(/AUTO|MANUAL/)).not.toBeInTheDocument()
  })

  it('shows the requirement group title instead of the group UUID', async () => {
    renderModal()
    const input = (await screen.findByDisplayValue('登录功能')) as HTMLInputElement
    expect(input).toHaveAttribute('readonly')
    expect(screen.queryByDisplayValue('group-test')).not.toBeInTheDocument()
  })

  it('falls back to the group UUID when the group title is unavailable', async () => {
    groupsMock.mockResolvedValue([])
    renderModal()
    const input = (await screen.findByDisplayValue('group-test')) as HTMLInputElement
    expect(input).toHaveAttribute('readonly')
  })

  it('disables submission when the project has no repositories', async () => {
    repositoriesMock.mockResolvedValue([]); renderModal()
    expect(await screen.findByText('当前项目暂无可用仓库，无法创建任务。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建任务' })).toBeDisabled()
    expect(mutationMock.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps the edited fields after a failed request', async () => {
    const user = userEvent.setup(); mutationMock.mutateAsync.mockRejectedValue(new ApiError('forbidden', 403)); renderModal()
    const requirement = screen.getByLabelText('需求说明'); await user.clear(requirement); await user.type(requirement, 'edited requirement'); await user.click(screen.getByLabelText('仓库')); await user.click(await screen.findByText('org/repo')); await user.type(screen.getByLabelText('任务标题'), '标题'); await user.click(screen.getByRole('button', { name: '创建任务' }))
    await waitFor(() => expect(mutationMock.mutateAsync).toHaveBeenCalledTimes(1)); expect(requirement).toHaveValue('edited requirement')
  })
})
