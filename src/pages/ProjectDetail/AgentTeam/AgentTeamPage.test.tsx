import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAssignmentSummary, AgentDetail, AgentTaskRunSummary } from '@/types'

const hooks = vi.hoisted(() => ({ useAgents: vi.fn(), useAgent: vi.fn(), useAgentRuntime: vi.fn(), useAgentSkillBindings: vi.fn(), useAgentAssignments: vi.fn(), useAgentTaskRuns: vi.fn(), useCreateAgent: vi.fn(), useUpdateAgent: vi.fn(), usePublishAgent: vi.fn(), useArchiveAgent: vi.fn() }))
const projectGet = vi.hoisted(() => vi.fn())
vi.mock('@/hooks', () => hooks)
vi.mock('@/api', () => ({ projectApi: { getById: projectGet } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-001' } }) }))
import AgentTeamPage from './AgentTeamPage'

const agent: AgentDetail = { id: 'agent-one', name: 'Agent One', avatar: null, role: 'DEVELOPER', visibility: 'PRIVATE', status: 'ACTIVE', createdBy: 'user-001', description: '负责接口实现', prompt: 'private prompt', tools: ['测试运行'], memoryAccess: ['当前项目共享 Memory'] }
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }
const assignment: AgentAssignmentSummary = { type: 'REQUIREMENT_GROUP', resourceId: 'group-one', resourceName: '登录功能', status: 'ACTIVE' }
const run: AgentTaskRunSummary = { id: 'run-one', projectId: 'project-one', taskId: 'task-one', taskStepId: 'step-one', agentId: agent.id, role: 'DEVELOPER', status: 'FAILED', retryOfTaskRunId: null, createdAt: '2026-08-14T08:00:00Z', updatedAt: '2026-08-14T08:03:00Z', taskDisplayCode: 'TASK-1', taskTitle: '实现登录', taskStepTitle: '实现接口', taskStepRole: 'DEVELOPER', requirementGroup: { id: 'group-one', name: '登录功能', status: 'ACTIVE' }, repository: { repositoryId: 'repo-one', name: 'qgents-web', fullName: 'qgents/qgents-web', provider: 'GITHUB', defaultBranch: 'main', baseRef: 'main', baseCommit: 'base', sourceBranch: 'feat/login', headCommit: null } }

function renderPage(url = '/app/projects/project-one/agents?agentId=agent-one') { render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><Routes><Route path="/app/projects/:projectId/agents" element={<AgentTeamPage />} /></Routes></MemoryRouter></QueryClientProvider>) }

beforeEach(() => {
  vi.clearAllMocks()
  projectGet.mockResolvedValue({ teamId: 'team-one' })
  hooks.useAgents.mockReturnValue({ data: { data: [agent] }, isLoading: false, isError: false, refetch: vi.fn() })
  hooks.useAgent.mockReturnValue({ data: agent, isLoading: false, isError: false, refetch: vi.fn() })
  hooks.useAgentRuntime.mockReturnValue({ data: { status: 'RUNNING', activeRunCount: 1, concurrencyLimit: null, assignmentUsage: { requirementGroups: { assignedCount: 1, assignableCount: 2 }, workflows: { assignedCount: 0, assignableCount: 0 } }, skillAccessScope: 'PROJECT', memoryAccessScope: 'PROJECT' }, isLoading: false, isError: false })
  hooks.useAgentSkillBindings.mockReturnValue({ data: { agentId: agent.id, skillIds: ['skill-one'], skills: [{ id: 'skill-one', name: 'TypeScript', visibility: 'PROJECT_SHARED', status: 'PUBLISHED' }], updatedAt: '2026-08-13T00:00:00Z' }, isError: false, isLoading: false })
  hooks.useAgentAssignments.mockReturnValue({ data: { data: [assignment], page: { nextCursor: null, hasMore: false } }, isError: false, isLoading: false })
  hooks.useAgentTaskRuns.mockReturnValue({ data: { data: [run], page: { nextCursor: null, hasMore: false } }, isError: false, isLoading: false })
  hooks.useCreateAgent.mockReturnValue(mutation); hooks.useUpdateAgent.mockReturnValue(mutation); hooks.usePublishAgent.mockReturnValue(mutation); hooks.useArchiveAgent.mockReturnValue(mutation)
})

describe('AgentTeamPage', () => {
  it('uses project teamId and renders the list, selection and overview', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Agent One').length).toBeGreaterThan(0))
    expect(screen.getAllByText('RUNNING').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1/2').length).toBeGreaterThan(0)
    expect(hooks.useAgents).toHaveBeenLastCalledWith('project-one', 'team-one')
    expect(hooks.useAgent).toHaveBeenLastCalledWith('project-one', 'team-one', 'agent-one')
    expect(hooks.useAgentAssignments).toHaveBeenCalledWith('project-one', 'agent-one', { type: 'REQUIREMENT_GROUP' }, false)
    expect(hooks.useAgentTaskRuns).toHaveBeenCalledWith('project-one', 'agent-one', undefined, true)
  })

  it('shows independent assignment and run tabs', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Agent One').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: '分配详情' }))
    expect(screen.getAllByText('登录功能').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '运行记录' }))
    expect(screen.getByText('TASK-1')).toBeInTheDocument()
    expect(screen.getByText('TASK-1')).toBeInTheDocument()
  })

  it('does not expose unpublish or workflow assignment UI', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Agent One').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: '取消发布' })).not.toBeInTheDocument()
    expect(screen.queryByText('Workflow 分配')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '分配详情' }))
    expect(screen.queryByText('已分配 Workflow')).not.toBeInTheDocument()
    expect(hooks.useAgentAssignments).toHaveBeenLastCalledWith('project-one', 'agent-one', { type: 'REQUIREMENT_GROUP' }, true)
  })

  it('keeps assignment errors independent', async () => {
    hooks.useAgentAssignments.mockImplementation((_projectId: string, _agentId: string, filters: { type?: string }) => filters.type === 'REQUIREMENT_GROUP'
      ? { data: undefined, isError: true, isLoading: false }
      : { data: { data: [], page: { nextCursor: null, hasMore: false } }, isError: false, isLoading: false })
    hooks.useAgent.mockReturnValue({ data: { ...agent, tools: [], memoryAccess: [] }, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Agent One').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: '分配详情' }))
    expect(screen.getByText('分配详情加载失败')).toBeInTheDocument()
  })

  it('shows empty and error states without treating them as the same', async () => {
    hooks.useAgents.mockImplementation(() => ({ data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() }))
    renderPage('/app/projects/project-one/agents')
    await waitFor(() => expect(screen.getAllByText('暂无 Agent').length).toBeGreaterThan(0))
  })

  it('replaces an invalid URL Agent with the first valid Agent', async () => {
    renderPage('/app/projects/project-one/agents?agentId=missing-agent')
    await waitFor(() => expect(hooks.useAgent).toHaveBeenLastCalledWith('project-one', 'team-one', 'agent-one'))
  })

  it('reloads a failed list query', async () => {
    const refetch = vi.fn()
    hooks.useAgents.mockImplementation(() => ({ data: undefined, isLoading: false, isError: true, error: { status: 500 }, refetch }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Agent 服务暂时不可用')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the custom Agent entry available', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: '添加 Agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '配置' }))
    expect(screen.getByText(/不新增保存字段/)).toBeInTheDocument()
  })

  it('does not show creator-only actions for a team Agent created by someone else', async () => {
    const shared = { ...agent, id: 'agent-shared', createdBy: 'user-other', visibility: 'TEAM' as const, prompt: undefined }
    hooks.useAgents.mockReturnValue({ data: { data: [shared] }, isLoading: false, isError: false, refetch: vi.fn() })
    hooks.useAgent.mockReturnValue({ data: shared, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage('/app/projects/project-one/agents?agentId=agent-shared')
    await waitFor(() => expect(screen.getAllByText('Agent One').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发布为 TEAM' })).not.toBeInTheDocument()
  })
})
