import type { AgentDetail } from '@/types'

export type AgentAction = 'edit' | 'publish' | 'unpublish' | 'archive'

export function canPerformAgentAction(agent: AgentDetail, action: AgentAction): boolean {
  if (action === 'edit') return agent.visibility !== 'SYSTEM' && agent.status === 'ACTIVE'
  if (action === 'publish') return agent.visibility === 'PRIVATE' && agent.status === 'ACTIVE'
  if (action === 'unpublish') return agent.visibility === 'TEAM' && agent.status === 'ACTIVE'
  return agent.visibility !== 'SYSTEM' && agent.status === 'ACTIVE'
}
