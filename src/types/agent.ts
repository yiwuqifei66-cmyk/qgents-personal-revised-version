import type { TaskRepositorySummary, TaskRunStatus, TaskStepRole } from './task-model'

export type AgentRole = 'ORCHESTRATOR' | 'PLANNER' | 'DEVELOPER' | 'TESTER' | 'REVIEWER' | 'GENERAL'
// §30.1 AgentVisibility 加 PENDING
export type AgentVisibility = 'PRIVATE' | 'PENDING' | 'TEAM' | 'SYSTEM'
export type AgentStatus = 'ACTIVE' | 'ARCHIVED'
export type AgentDetailTab = 'overview' | 'assignments' | 'config' | 'runs'
export type AgentRuntimeStatus = 'IDLE' | 'RUNNING'
export type AgentAccessScope = 'PROJECT'

export interface AgentAssignmentUsage {
  assignedCount: number
  assignableCount: number
}

export interface AgentRuntimeSummary {
  status: AgentRuntimeStatus
  activeRunCount: number
  concurrencyLimit: number | null
  assignmentUsage: {
    requirementGroups: AgentAssignmentUsage
    workflows: AgentAssignmentUsage
  }
  skillAccessScope: AgentAccessScope
  memoryAccessScope: AgentAccessScope
}

export interface AgentSummary {
  id: string
  name: string
  avatar: string | null
  role: AgentRole
  description: string | null
  visibility: AgentVisibility
  status: AgentStatus
  createdBy: string | null
  /** §30.1 拒绝发布原因（PENDING 状态被 Team Owner 拒绝后填充） */
  reviewReason?: string | null
  /** §30.1 审核人（Team Owner） */
  reviewedBy?: string | null
  /** §30.1 审核时间 */
  reviewedAt?: string | null
}

export interface AgentDetail extends AgentSummary {
  prompt?: string | null
  tools?: string[]
  memoryAccess?: string[]
  /** Project-specific Skill data is consumed by Workflow; Agent Team does not use it. */
  skillBindings?: AgentSkillBinding[]
}

export interface AgentSkillBinding { skillId: string; name: string; scope: 'PROJECT' | 'TEAM' | 'PRIVATE' }
export interface Agent { id: string; projectId: string; nickname: string; avatarUrl?: string; roleTags: string[]; toolIds?: string[] }
export type AgentAvailability = never
export type AgentPermissions = never
export type AgentPresentation = never
export type AgentRoleTag = string
export interface AgentRunRecord { id: string; title: string; status: string; updatedAt: string }
export interface AgentSkillBindingResponse { agentId: string; skillIds: string[]; skills: Array<{ id: string; name: string; visibility: string; status: string }>; updatedAt: string }
export interface ProjectSkillOption { id: string; name: string; scope: 'PROJECT' | 'TEAM' | 'PRIVATE'; available: boolean }

export type AgentAssignmentType = 'REQUIREMENT_GROUP' | 'WORKFLOW'

export type AgentAssignmentStatus = 'ACTIVE' | 'INACTIVE'

export interface AgentAssignmentSummary {
  type: AgentAssignmentType
  resourceId: string
  resourceName: string
  status: AgentAssignmentStatus
}

export interface AgentAssignmentsFilters {
  type?: AgentAssignmentType
  cursor?: string
  limit?: number
}

export interface AgentTaskRunSummary {
  id: string
  projectId: string
  taskId: string
  taskStepId: string
  agentId: string
  role: TaskStepRole
  status: TaskRunStatus
  retryOfTaskRunId: string | null
  createdAt: string
  updatedAt: string
  taskDisplayCode: string
  taskTitle: string
  taskStepTitle: string
  taskStepRole: TaskStepRole
  requirementGroup: { id: string; name: string; status: string }
  repository: TaskRepositorySummary | null
}

export interface CreateAgentPayload {
  name: string
  avatar?: string
  role: AgentRole
  description: string
  prompt: string
}

export type UpdateAgentPayload = Partial<CreateAgentPayload>
