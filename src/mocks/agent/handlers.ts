import { http, HttpResponse, type PathParams } from 'msw'
import type { AgentAssignmentType, AgentDetail, AgentSkillBindingResponse, UpdateAgentPayload } from '@/types'
import { MOCK_CURRENT_USER } from '../currentUser'
import { createAgentFixtures, createAgentTaskRunFixtures, getAgentAssignments, getAgentRuntime, supportedAgentRoles } from './fixtures'

const stores = new Map<string, AgentDetail[]>()
const currentUserId = MOCK_CURRENT_USER.id
const value = (params: PathParams, key: string): string => typeof params[key] === 'string' ? params[key] : ''
const response = <T,>(data: T, status = 200) => HttpResponse.json({ data, requestId: 'mock-agent-request' }, { status })
const error = (status: 403 | 404 | 409 | 422, code: string) => HttpResponse.json({ error: { code, message: code, details: [] }, requestId: 'mock-agent-request' }, { status })
const store = (teamId: string): AgentDetail[] => stores.get(teamId) ?? (() => { const agents = createAgentFixtures(); stores.set(teamId, agents); return agents })()
const projectAgent = (agent: AgentDetail, includePrompt: boolean): AgentDetail => {
  if (includePrompt) return agent
  const { prompt: _prompt, ...safe } = agent
  return safe
}
const body = (request: Request): Promise<Record<string, unknown>> => request.json().then((data: unknown) => data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {})
const nonEmpty = (input: unknown): input is string => typeof input === 'string' && input.trim().length > 0
const page = <T,>(items: T[], request: Request): Response => {
  const search = new URL(request.url).searchParams
  const rawLimit = Number(search.get('limit') ?? '30')
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30
  const rawCursor = Number(search.get('cursor') ?? '0')
  const start = Number.isInteger(rawCursor) && rawCursor >= 0 ? rawCursor : 0
  const data = items.slice(start, start + limit)
  const nextStart = start + data.length
  return HttpResponse.json({ data, page: { nextCursor: nextStart < items.length ? String(nextStart) : null, hasMore: nextStart < items.length }, requestId: 'mock-agent-request' })
}
export const resetAgentStores = (): void => stores.clear()

export const agentHandlers = [
  http.get('*/api/teams/:teamId/agents', ({ params, request }) => {
    if (new URL(request.url).searchParams.get('scenario') === 'FORBIDDEN') return error(403, 'TEAM_MEMBER_REQUIRED')
    if (new URL(request.url).searchParams.get('scenario') === 'EMPTY') return HttpResponse.json({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'mock-agent-request' })
    const data = store(value(params, 'teamId')).filter((agent) => agent.visibility === 'SYSTEM' || agent.visibility === 'TEAM' || agent.createdBy === currentUserId).map((agent) => projectAgent(agent, false))
    return page(data, request)
  }),
  http.get('*/api/teams/:teamId/agents/:agentId', ({ params }) => { const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId')); const visible = agent && (agent.visibility === 'SYSTEM' || agent.visibility === 'TEAM' || agent.createdBy === currentUserId); return visible && agent ? response(projectAgent(agent, agent.createdBy === currentUserId)) : error(404, 'AGENT_NOT_FOUND') }),
  http.post('*/api/teams/:teamId/agents', async ({ params, request }) => {
    const input = await body(request)
    if (!nonEmpty(input.name) || !nonEmpty(input.description) || !nonEmpty(input.prompt) || !supportedAgentRoles.includes(input.role as AgentDetail['role'])) return error(422, 'VALIDATION_FAILED')
    const agent: AgentDetail = { id: `agent-created-${Date.now()}`, name: input.name.trim(), avatar: typeof input.avatar === 'string' ? input.avatar : null, role: input.role as AgentDetail['role'], visibility: 'PRIVATE', status: 'ACTIVE', createdBy: currentUserId, description: input.description.trim(), prompt: input.prompt, tools: [], memoryAccess: [] }
    store(value(params, 'teamId')).push(agent); return response(agent, 201)
  }),
  http.patch('*/api/teams/:teamId/agents/:agentId', async ({ params, request }) => { const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId') && item.createdBy === currentUserId); if (!agent) return error(404, 'AGENT_NOT_FOUND'); if (agent.visibility === 'SYSTEM') return error(403, 'AGENT_EDIT_FORBIDDEN'); const input = await body(request) as UpdateAgentPayload; if (nonEmpty(input.name)) agent.name = input.name.trim(); if (typeof input.avatar === 'string') agent.avatar = input.avatar || null; if (input.role && supportedAgentRoles.includes(input.role)) agent.role = input.role; if (nonEmpty(input.description)) agent.description = input.description.trim(); if (typeof input.prompt === 'string') agent.prompt = input.prompt; return response(agent) }),
  http.post('*/api/teams/:teamId/agents/:agentId/publish', ({ params, request }) => {
    const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId'))
    if (!agent) return error(404, 'AGENT_NOT_FOUND')
    if (new URL(request.url).searchParams.get('error') === 'CONFLICT') return error(409, 'INVALID_AGENT_STATE')
    if (agent.status !== 'ACTIVE' || agent.visibility !== 'PRIVATE') return error(422, 'AGENT_NOT_PUBLISHABLE')
    if (agent.createdBy !== currentUserId) return error(403, 'AGENT_PUBLISH_FORBIDDEN')
    // §30.1 publish：PRIVATE → PENDING（提交审核）
    agent.visibility = 'PENDING'
    agent.reviewReason = null
    agent.reviewedBy = null
    agent.reviewedAt = null
    return response(agent, 202)
  }),
  // §30.1 approve：Team Owner 触发，PENDING → TEAM，记录 reviewedBy/At
  http.post('*/api/teams/:teamId/agents/:agentId/approve', ({ params }) => {
    const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId'))
    if (!agent) return error(404, 'AGENT_NOT_FOUND')
    if (agent.status !== 'ACTIVE' || agent.visibility !== 'PENDING') return error(422, 'AGENT_NOT_APPROVABLE')
    agent.visibility = 'TEAM'
    agent.reviewReason = null
    agent.reviewedBy = currentUserId
    agent.reviewedAt = new Date().toISOString()
    return response(agent, 202)
  }),
  // §30.1 reject：Team Owner 触发，PENDING → PRIVATE，记录拒绝原因
  http.post('*/api/teams/:teamId/agents/:agentId/reject', async ({ params, request }) => {
    const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId'))
    if (!agent) return error(404, 'AGENT_NOT_FOUND')
    if (agent.status !== 'ACTIVE' || agent.visibility !== 'PENDING') return error(422, 'AGENT_NOT_REJECTABLE')
    let reason: string | null = null
    try {
      const input = await body(request)
      if (typeof input.reason === 'string' && input.reason.trim().length > 0) reason = input.reason.trim()
    } catch { /* empty body is allowed */ }
    agent.visibility = 'PRIVATE'
    agent.reviewReason = reason
    agent.reviewedBy = currentUserId
    agent.reviewedAt = new Date().toISOString()
    return response(agent, 202)
  }),
  // §30.1 unpublish：已废弃，返回 409 AGENT_UNPUBLISH_DISALLOWED
  http.post('*/api/teams/:teamId/agents/:agentId/unpublish', ({ params }) => {
    const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId'))
    if (!agent) return error(404, 'AGENT_NOT_FOUND')
    return error(409, 'AGENT_UNPUBLISH_DISALLOWED')
  }),
  http.post('*/api/teams/:teamId/agents/:agentId/archive', ({ params }) => { const agent = store(value(params, 'teamId')).find((item) => item.id === value(params, 'agentId')); if (!agent) return error(404, 'AGENT_NOT_FOUND'); if (agent.status === 'ARCHIVED' || agent.visibility === 'SYSTEM') return error(422, 'AGENT_NOT_ARCHIVABLE'); agent.status = 'ARCHIVED'; return response(agent, 202) }),
  http.get('*/api/projects/:projectId/agent-skill-bindings/:agentId', ({ params }) => {
    const agent = store('team-owned-001').find((item) => item.id === value(params, 'agentId') && item.createdBy === currentUserId)
    if (!agent) return error(404, 'AGENT_NOT_FOUND')
    const data: AgentSkillBindingResponse = { agentId: agent.id, skillIds: agent.id === 'agent-private-backend' ? ['skill-typescript', 'skill-api'] : [], skills: agent.id === 'agent-private-backend' ? [{ id: 'skill-typescript', name: 'TypeScript', visibility: 'PROJECT_SHARED', status: 'PUBLISHED' }, { id: 'skill-api', name: 'API 设计', visibility: 'PROJECT_SHARED', status: 'PUBLISHED' }] : [], updatedAt: '2026-08-13T00:00:00Z' }
    return response(data)
  }),
  http.get('*/api/projects/:projectId/agents/:agentId/assignments', ({ params, request }) => {
    const requestedType = new URL(request.url).searchParams.get('type')
    if (requestedType && requestedType !== 'REQUIREMENT_GROUP' && requestedType !== 'WORKFLOW') return error(422, 'INVALID_ASSIGNMENT_TYPE')
    const type: AgentAssignmentType | null = requestedType === 'REQUIREMENT_GROUP' || requestedType === 'WORKFLOW' ? requestedType : null
    const agent = store('team-owned-001').find((item) => item.id === value(params, 'agentId') && item.createdBy === currentUserId)
    if (!agent) return error(404, 'AGENT_NOT_FOUND')
    const data = type ? getAgentAssignments(agent.id, type) : [...getAgentAssignments(agent.id, 'REQUIREMENT_GROUP'), ...getAgentAssignments(agent.id, 'WORKFLOW')]
    return page(value(params, 'projectId') === 'demo-project' ? data : [], request)
  }),
  http.get('*/api/projects/:projectId/agents/:agentId/runtime', ({ params }) => {
    const agent = store('team-owned-001').find((item) => item.id === value(params, 'agentId') && item.createdBy === currentUserId)
    return agent ? response(getAgentRuntime(value(params, 'projectId'), agent.id)) : error(404, 'AGENT_NOT_FOUND')
  }),
  http.get('*/api/projects/:projectId/task-runs', ({ params, request }) => {
    const projectId = value(params, 'projectId')
    const search = new URL(request.url).searchParams
    const agentId = search.get('agentId')
    if (!agentId) return error(422, 'AGENT_ID_REQUIRED')
    const currentAgentIds = store('team-owned-001').filter((agent) => agent.createdBy === currentUserId).map((agent) => agent.id)
    const data = createAgentTaskRunFixtures().filter((run) => currentAgentIds.includes(run.agentId) && run.projectId === projectId && run.agentId === agentId).filter((run) => !search.get('status') || run.status === search.get('status')).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    return page(data, request)
  }),
]
