import type { AgentAssignmentSummary, AgentDetail, AgentRole, AgentRuntimeSummary, AgentTaskRunSummary } from '@/types'
import { MOCK_CURRENT_USER } from '../currentUser'

export const supportedAgentRoles: readonly AgentRole[] = ['ORCHESTRATOR', 'PLANNER', 'DEVELOPER', 'TESTER', 'REVIEWER', 'GENERAL']

type AssignmentCapacity = AgentRuntimeSummary['assignmentUsage']

function activeTaskRunStatus(status: AgentTaskRunSummary['status']): boolean {
  return ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED', 'CANCELLING'].includes(status)
}

function createAgentRuntime(agentId: string, assignableCount: AssignmentCapacity): AgentRuntimeSummary {
  const activeRunCount = createAgentTaskRunFixtures().filter((run) => run.projectId === 'demo-project' && run.agentId === agentId && activeTaskRunStatus(run.status)).length
  const requirementGroups = getAgentAssignments(agentId, 'REQUIREMENT_GROUP').length
  const workflows = getAgentAssignments(agentId, 'WORKFLOW').length
  return {
    status: activeRunCount > 0 ? 'RUNNING' : 'IDLE',
    activeRunCount,
    concurrencyLimit: null,
    assignmentUsage: {
      requirementGroups: { assignedCount: requirementGroups, assignableCount: assignableCount.requirementGroups.assignableCount },
      workflows: { assignedCount: workflows, assignableCount: assignableCount.workflows.assignableCount },
    },
    skillAccessScope: 'PROJECT',
    memoryAccessScope: 'PROJECT',
  }
}

export function createAgentFixtures(): AgentDetail[] {
  return [
    { id: 'agent-system-planner', name: 'Planner Agent', avatar: null, role: 'PLANNER', visibility: 'SYSTEM', status: 'ACTIVE', createdBy: null, description: '系统内置的任务规划 Agent。' },
    { id: 'agent-private-backend', name: 'Backend Developer Agent', avatar: null, role: 'DEVELOPER', visibility: 'PRIVATE', status: 'ACTIVE', createdBy: MOCK_CURRENT_USER.id, description: '负责后端接口与数据层实现。', prompt: '仅创建者可见的 Prompt', tools: ['代码执行', '测试运行'], memoryAccess: ['当前项目共享 Memory'] },
    { id: 'agent-team-tester', name: 'Tester Agent', avatar: null, role: 'TESTER', visibility: 'TEAM', status: 'ACTIVE', createdBy: MOCK_CURRENT_USER.id, description: '负责自动化测试与质量检查。', tools: [], memoryAccess: ['当前项目共享 Memory'] },
    // §30 PENDING 状态样例
    { id: 'agent-pending-frontend', name: 'Frontend Developer Agent', avatar: null, role: 'DEVELOPER', visibility: 'PENDING', status: 'ACTIVE', createdBy: MOCK_CURRENT_USER.id, description: '负责前端页面与交互实现。', tools: [], memoryAccess: [], reviewReason: null, reviewedBy: null, reviewedAt: null },
    { id: 'agent-archived-reviewer', name: 'Reviewer Agent', avatar: null, role: 'REVIEWER', visibility: 'PRIVATE', status: 'ARCHIVED', createdBy: MOCK_CURRENT_USER.id, description: '已归档的审查 Agent。' },
    { id: 'agent-other-user', name: 'Other User Agent', avatar: null, role: 'GENERAL', visibility: 'PRIVATE', status: 'ACTIVE', createdBy: 'user-002', description: 'Other user fixture for isolation tests.' },
  ]
}

const assignments: Record<string, AgentAssignmentSummary[]> = {
  'agent-private-backend:REQUIREMENT_GROUP': [
    { type: 'REQUIREMENT_GROUP', resourceId: 'group-demo-project-requirements', resourceName: '登录功能', status: 'ACTIVE' },
    { type: 'REQUIREMENT_GROUP', resourceId: 'group-demo-project-security', resourceName: '权限与安全测试', status: 'ACTIVE' },
  ],
}

export function getAgentAssignments(agentId: string, type: AgentAssignmentSummary['type']): AgentAssignmentSummary[] {
  return assignments[`${agentId}:${type}`] ?? []
}

export function getAgentRuntime(projectId: string, agentId: string): AgentRuntimeSummary {
  const capacities: Record<string, AssignmentCapacity> = {
    'agent-system-planner': { requirementGroups: { assignedCount: 0, assignableCount: 0 }, workflows: { assignedCount: 0, assignableCount: 0 } },
    'agent-private-backend': { requirementGroups: { assignedCount: 0, assignableCount: 3 }, workflows: { assignedCount: 0, assignableCount: 0 } },
    'agent-team-tester': { requirementGroups: { assignedCount: 0, assignableCount: 2 }, workflows: { assignedCount: 0, assignableCount: 0 } },
    'agent-archived-reviewer': { requirementGroups: { assignedCount: 0, assignableCount: 1 }, workflows: { assignedCount: 0, assignableCount: 0 } },
    'agent-other-user': { requirementGroups: { assignedCount: 0, assignableCount: 0 }, workflows: { assignedCount: 0, assignableCount: 0 } },
  }
  const capacity = capacities[agentId] ?? capacities['agent-other-user']!
  if (projectId !== 'demo-project') return { ...createAgentRuntime('', { requirementGroups: { assignedCount: 0, assignableCount: 0 }, workflows: { assignedCount: 0, assignableCount: 0 } }), assignmentUsage: { requirementGroups: { assignedCount: 0, assignableCount: 0 }, workflows: { assignedCount: 0, assignableCount: 0 } } }
  return createAgentRuntime(agentId, capacity)
}

export function createAgentTaskRunFixtures(): AgentTaskRunSummary[] {
  return [
    {
      id: 'run-step-task-demo-project-main-developer',
      projectId: 'demo-project',
      taskId: 'task-demo-project-main',
      taskStepId: 'step-task-demo-project-main-developer',
      agentId: 'agent-private-backend',
      role: 'DEVELOPER',
      status: 'WAITING_INPUT',
      retryOfTaskRunId: null,
      createdAt: '2026-08-14T08:01:00Z',
      updatedAt: '2026-08-14T08:02:00Z',
      taskDisplayCode: 'TASK-001',
      taskTitle: '实现邮箱登录',
      taskStepTitle: '实现登录接口',
      taskStepRole: 'DEVELOPER',
      requirementGroup: { id: 'group-demo-project-requirements', name: '登录功能', status: 'ACTIVE' },
      repository: { repositoryId: 'repository-demo-project', name: 'qgents-web', fullName: 'qgents/qgents-web', provider: 'GITHUB', defaultBranch: 'main', baseRef: 'main', baseCommit: 'base-commit', sourceBranch: 'feat/login', headCommit: null },
    },
    {
      id: 'run-demo-project-failed',
      projectId: 'demo-project',
      taskId: 'task-demo-project-pending',
      taskStepId: 'step-task-demo-project-pending-developer',
      agentId: 'agent-private-backend',
      role: 'DEVELOPER',
      status: 'FAILED',
      retryOfTaskRunId: null,
      createdAt: '2026-08-13T09:00:00Z',
      updatedAt: '2026-08-13T09:06:00Z',
      taskDisplayCode: 'TASK-002',
      taskTitle: '补充支付回调',
      taskStepTitle: '实现回调接口',
      taskStepRole: 'DEVELOPER',
      requirementGroup: { id: 'group-demo-project-requirements', name: '支付回调', status: 'ACTIVE' },
      repository: { repositoryId: 'repository-demo-project', name: 'qgents-web', fullName: 'qgents/qgents-web', provider: 'GITHUB', defaultBranch: 'main', baseRef: 'main', baseCommit: 'base-commit', sourceBranch: 'feat/payment', headCommit: null },
    },
  ]
}
