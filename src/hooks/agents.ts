import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { agentApi } from '@/api'
import { queryClient, queryKeys } from '@/query'
import type { AgentAssignmentSummary, AgentAssignmentType, AgentAssignmentsFilters, AgentDetail, AgentRuntimeSummary, AgentSkillBindingResponse, AgentSummary, AgentTaskRunSummary, CreateAgentPayload, UpdateAgentPayload } from '@/types'
import type { CursorPage } from '@/types/api'

export function useAgents(projectId: string, teamId?: string, scenario?: string): UseQueryResult<{ data: AgentSummary[] }> {
  const resolvedTeamId = teamId ?? ''
  return useQuery({
    queryKey: queryKeys.agents.list(projectId, resolvedTeamId, scenario),
    queryFn: () => agentApi.list(resolvedTeamId, scenario),
    enabled: Boolean(projectId && resolvedTeamId),
  })
}
export function useAgent(projectId: string, teamId: string, agentId: string | null): UseQueryResult<AgentDetail> {
  return useQuery({ queryKey: queryKeys.agents.detail(projectId, teamId, agentId ?? ''), queryFn: () => agentApi.get(teamId, agentId ?? '', projectId), enabled: Boolean(projectId && teamId && agentId) })
}
export function useAgentSkillBindings(projectId: string, agentId: string | null, enabled = true): UseQueryResult<AgentSkillBindingResponse> {
  return useQuery({ queryKey: queryKeys.agents.skillBindings(projectId, agentId ?? ''), queryFn: () => agentApi.skillBindings(projectId, agentId ?? ''), enabled: Boolean(projectId && agentId && enabled) })
}
export function useAgentAssignments(projectId: string, agentId: string | null, filters: AgentAssignmentsFilters | AgentAssignmentType = {}, enabled = true): UseQueryResult<CursorPage<AgentAssignmentSummary>> {
  const resolvedFilters: AgentAssignmentsFilters = typeof filters === 'string' ? { type: filters } : filters
  return useQuery({ queryKey: queryKeys.agents.assignments(projectId, agentId ?? '', resolvedFilters), queryFn: () => agentApi.assignments(projectId, agentId ?? '', resolvedFilters), enabled: Boolean(projectId && agentId && enabled) })
}
export function useAgentRuntime(projectId: string, agentId: string | null, enabled = true): UseQueryResult<AgentRuntimeSummary> {
  return useQuery({ queryKey: queryKeys.agents.runtime(projectId, agentId ?? ''), queryFn: () => agentApi.runtime(projectId, agentId ?? ''), enabled: Boolean(projectId && agentId && enabled) })
}
export function useAgentTaskRuns(projectId: string, agentId: string | null, status?: AgentTaskRunSummary['status'], enabled = true): UseQueryResult<CursorPage<AgentTaskRunSummary>> {
  const filters = { status, limit: 20 }
  return useQuery({ queryKey: queryKeys.agents.taskRuns(projectId, agentId ?? '', filters), queryFn: () => agentApi.taskRuns(projectId, { agentId: agentId ?? '', ...filters }), enabled: Boolean(projectId && agentId && enabled) })
}
type Variables = { agentId: string }
function invalidate(projectId: string, teamId: string, agentId?: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all(projectId, teamId) })
  if (agentId) void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(projectId, teamId, agentId) })
}
export function useCreateAgent(projectId: string, teamId: string): UseMutationResult<AgentDetail, Error, CreateAgentPayload> {
  return useMutation({ mutationFn: (payload) => agentApi.create(teamId, payload), onSuccess: (agent) => invalidate(projectId, teamId, agent.id) })
}
export function useUpdateAgent(projectId: string, teamId: string): UseMutationResult<AgentDetail, Error, Variables & { payload: UpdateAgentPayload }> {
  return useMutation({ mutationFn: ({ agentId, payload }) => agentApi.update(teamId, agentId, payload), onSuccess: (agent) => invalidate(projectId, teamId, agent.id) })
}
function useAgentAction(projectId: string, teamId: string, execute: (id: string) => Promise<AgentDetail>): UseMutationResult<AgentDetail, Error, Variables> {
  return useMutation({ mutationFn: ({ agentId }) => execute(agentId), onSuccess: (agent) => invalidate(projectId, teamId, agent.id) })
}
export const usePublishAgent = (projectId: string, teamId: string) => useAgentAction(projectId, teamId, (id) => agentApi.publish(teamId, id))
export const useUnpublishAgent = (projectId: string, teamId: string) => useAgentAction(projectId, teamId, (id) => agentApi.unpublish(teamId, id))
export const useArchiveAgent = (projectId: string, teamId: string) => useAgentAction(projectId, teamId, (id) => agentApi.archive(teamId, id))
