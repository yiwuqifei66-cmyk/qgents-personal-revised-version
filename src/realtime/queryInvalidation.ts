import type { QueryKey } from '@tanstack/react-query'
import { deliveryCenterKeys, queryClient, queryKeys, taskModelQueryKeys } from '@/query'
import type { ProjectTaskEvent, ProjectTaskEventPayload } from './eventParser'

export const TASK_MODEL_QUERY_ROOTS = (projectId: string): readonly QueryKey[] => [
  taskModelQueryKeys.tasks.all(projectId),
  taskModelQueryKeys.taskRuns.root(projectId),
  taskModelQueryKeys.diffs.all(projectId),
  taskModelQueryKeys.taskArtifacts.root(projectId),
  taskModelQueryKeys.taskDiffReview.root(projectId),
  deliveryCenterKeys.all(projectId),
  taskModelQueryKeys.mergeRequests.all(projectId),
  queryKeys.workBranches.all(projectId),
]

function stringId(payload: ProjectTaskEventPayload, name: string): string | null {
  const value = payload[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function addKey(keys: QueryKey[], key: QueryKey | null): void {
  if (!key) return
  if (!keys.some((candidate) => JSON.stringify(candidate) === JSON.stringify(key))) keys.push(key)
}

export function queryKeysForProjectTaskEvent(
  projectId: string,
  event: ProjectTaskEvent,
): readonly QueryKey[] {
  if (event.payload.projectId !== projectId) return []

  const payload = event.payload
  const taskId = stringId(payload, 'taskId')
  const taskStepId = stringId(payload, 'taskStepId')
  const taskRunId = stringId(payload, 'taskRunId')
  const agentId = stringId(payload, 'agentId')
  const diffId = stringId(payload, 'diffId')
  const artifactId = stringId(payload, 'artifactId')
  const resourceType = stringId(payload, 'resourceType')
  const resourceId = stringId(payload, 'resourceId')
  const groupId = stringId(payload, 'groupId')
  const messageId = stringId(payload, 'messageId')
  const keys: QueryKey[] = []

  const addDeliveryQueries = (): void => {
    addKey(keys, deliveryCenterKeys.all(projectId))
    if (resourceType === 'MEMORY') addKey(keys, ['memories', projectId])
    if (resourceType === 'SKILL') addKey(keys, ['skills', projectId])
  }
  const addAgentQueries = (): void => {
    if (!agentId) return
    addKey(keys, queryKeys.agents.runtime(projectId, agentId))
    addKey(keys, ['qgents', 'projects', projectId, 'task-runs', 'agent', agentId])
  }

  switch (event.type) {
    case 'message.created':
    case 'message.updated':
      if (!groupId || !messageId) return []
      addKey(keys, ['groups', projectId])
      addKey(keys, ['groups', projectId, groupId, 'messages'])
      break
    case 'group.created':
    case 'group.updated':
    case 'group.archived':
      if (!groupId) return []
      addKey(keys, ['groups', projectId])
      break
    case 'group.member.updated':
      if (!groupId) return []
      addKey(keys, ['groups', projectId])
      addKey(keys, ['groups', projectId, groupId, 'members'])
      break
    case 'task.updated':
      if (!taskId) return []
      addKey(keys, taskModelQueryKeys.tasks.all(projectId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      // §6.2：task.updated 影响工作分支的 latestTask
      addKey(keys, queryKeys.workBranches.all(projectId))
      break
    case 'task-step.updated':
      if (!taskId || !taskStepId) return []
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.taskSteps.all(projectId, taskId))
      addKey(keys, taskModelQueryKeys.taskRuns.all(projectId, taskId))
      break
    case 'task-run.created':
    case 'task-run.updated':
      if (!taskId || !taskRunId) return []
      addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
      addKey(keys, taskModelQueryKeys.taskRuns.all(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      // TaskRun 终态可能先于 task.updated 到达。同步失效列表和步骤，避免右侧运行已失败而
      // 任务标题/最近执行仍展示旧状态；数据仍完全由后端读取模型决定。
      addKey(keys, taskModelQueryKeys.tasks.all(projectId))
      addKey(keys, taskModelQueryKeys.taskSteps.all(projectId, taskId))
      addAgentQueries()
      break
    case 'task-run.step.progress': {
      // 兼容两种 ID 命名（与 eventParser 一致），taskRunId 决定 logs 缓存归属。
      const stepRefId = stringId(payload, 'taskStepId') ?? stringId(payload, 'stepId')
      if (!taskRunId || !stepRefId) return []
      addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
      // 进度事件携带 worker stdout/stderr 增量，必须让 logs 分页缓存失效以便重新拉取。
      addKey(keys, taskModelQueryKeys.taskRuns.logs(projectId, taskRunId))
      break
    }
    case 'workspace.diff-preview.updated':
      if (!taskId || !taskRunId) return []
      addKey(keys, taskModelQueryKeys.workspaceDiffPreview.all(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
      break
    case 'input-required':
    case 'approval-required':
      if (!taskId || !taskRunId || !stringId(payload, 'inputRequestId')) return []
      addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
      addKey(keys, taskModelQueryKeys.taskRuns.inputRequests.all(projectId, taskRunId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      break
    case 'diff.created':
      if (!taskId || !diffId) return []
      addKey(keys, taskModelQueryKeys.diffs.all(projectId))
      addKey(keys, taskModelQueryKeys.diffs.detail(projectId, diffId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.taskDiffReview.detail(projectId, taskId))
      addKey(keys, deliveryCenterKeys.all(projectId))
      if (taskRunId) {
        addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
        addKey(keys, taskModelQueryKeys.taskRuns.list(projectId, taskId))
      }
      // §6.2：diff.created 影响工作分支的 latestDiff
      addKey(keys, queryKeys.workBranches.all(projectId))
      break
    case 'task.artifact.created':
      if (!taskId || !artifactId) return []
      addKey(keys, taskModelQueryKeys.taskArtifacts.all(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      if (taskRunId) addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
      break
    case 'task-run.artifact.created':
      if (!taskId || !taskRunId || !artifactId) return []
      addKey(keys, taskModelQueryKeys.taskArtifacts.all(projectId, taskId))
      addKey(keys, taskModelQueryKeys.taskRuns.detail(projectId, taskRunId))
      break
    case 'diff-review.created':
    case 'task.awaiting-diff-confirmation':
    case 'diff-review.confirmed':
    case 'diff-review.rejected':
    case 'diff-review.superseded':
    case 'task.diff-review.failed':
      if (!taskId) return []
      addKey(keys, taskModelQueryKeys.tasks.all(projectId))
      addKey(keys, taskModelQueryKeys.taskDiffReview.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      if (event.type === 'diff-review.superseded') {
        addKey(keys, taskModelQueryKeys.diffs.all(projectId))
        addKey(keys, queryKeys.workBranches.all(projectId))
      }
      addDeliveryQueries()
      break
    case 'diff-review.skipped':
      if (!taskId) return []
      addKey(keys, taskModelQueryKeys.tasks.all(projectId))
      addKey(keys, taskModelQueryKeys.taskDiffReview.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      addKey(keys, queryKeys.workBranches.all(projectId))
      addDeliveryQueries()
      break
    case 'delivery.repository.updated':
      if (!taskId || !diffId) return []
      addKey(keys, taskModelQueryKeys.tasks.all(projectId))
      addKey(keys, taskModelQueryKeys.taskDiffReview.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.diffs.detail(projectId, diffId))
      addDeliveryQueries()
      addKey(keys, taskModelQueryKeys.mergeRequests.all(projectId))
      break
    case 'delivery.completed':
    case 'delivery.failed':
    case 'delivery.started':
      if (!taskId) return []
      addKey(keys, taskModelQueryKeys.tasks.all(projectId))
      addKey(keys, taskModelQueryKeys.taskDiffReview.detail(projectId, taskId))
      addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      addDeliveryQueries()
      break
    case 'merge-request.updated':
      if (!stringId(payload, 'mergeRequestId')) return []
      addKey(keys, deliveryCenterKeys.all(projectId))
      addKey(keys, taskModelQueryKeys.mergeRequests.all(projectId))
      // §6.2：merge-request.updated 影响工作分支的 openMergeRequest
      addKey(keys, queryKeys.workBranches.all(projectId))
      if (taskId) {
        addKey(keys, taskModelQueryKeys.tasks.all(projectId))
        addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
        addKey(keys, taskModelQueryKeys.taskDiffReview.detail(projectId, taskId))
      }
      break
    case 'memory.submit-review':
    case 'memory.approved':
    case 'memory.rejected':
    case 'memory.archived':
    case 'skill.submit-review':
    case 'skill.published':
    case 'skill.rejected':
    case 'skill.archived':
      if (!resourceId || !resourceType) return []
      addDeliveryQueries()
      if (taskId) {
        addKey(keys, taskModelQueryKeys.tasks.all(projectId))
        addKey(keys, taskModelQueryKeys.tasks.detail(projectId, taskId))
      }
      break
    case 'test-run.updated': {
      const testRunId = stringId(payload, 'testRunId')
      if (!testRunId) return []
      addKey(keys, queryKeys.testRuns.all(projectId))
      addKey(keys, queryKeys.testRuns.detail(projectId, testRunId))
      // §6.2：test-run.updated 影响工作分支的 lastVerification
      addKey(keys, queryKeys.workBranches.all(projectId))
      break
    }
    case 'dry-run.updated': {
      const dryRunId = stringId(payload, 'dryRunId')
      if (!dryRunId) return []
      addKey(keys, queryKeys.dryRuns.all(projectId))
      addKey(keys, queryKeys.dryRuns.report(projectId, dryRunId))
      // Dry Run 状态变化可能带动预检结论变化：仅当 payload 带 taskId 时才能定位到关联预检
      const repositoryId = stringId(payload, 'repositoryId')
      const targetBranch = stringId(payload, 'targetBranch')
      if (taskId && repositoryId && targetBranch) {
        addKey(keys, queryKeys.preflight.detail(projectId, taskId, repositoryId, targetBranch))
      } else if (taskId) {
        addKey(keys, queryKeys.preflight.all(projectId, taskId))
      }
      break
    }
    case 'preflight.updated': {
      const repositoryId = stringId(payload, 'repositoryId')
      const targetBranch = stringId(payload, 'targetBranch')
      if (!taskId || !repositoryId || !targetBranch) return []
      addKey(keys, queryKeys.preflight.detail(projectId, taskId, repositoryId, targetBranch))
      break
    }
  }

  return keys
}

export function invalidateProjectTaskEvent(projectId: string, event: ProjectTaskEvent): void {
  if (event.type === 'message.created' || event.type === 'message.updated' || event.type === 'task.updated') {
    const groupId = typeof event.payload.groupId === 'string'
      ? event.payload.groupId
      : typeof event.payload.requirementGroupId === 'string' ? event.payload.requirementGroupId : null
    const sequence = typeof event.payload.sequence === 'number' ? event.payload.sequence : null
    if (groupId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qgents:message-event', {
        detail: { projectId, groupId, sequence, eventType: event.type },
      }))
    }
  }
  for (const queryKey of queryKeysForProjectTaskEvent(projectId, event)) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

export function invalidateProjectTaskModel(projectId: string): void {
  for (const queryKey of TASK_MODEL_QUERY_ROOTS(projectId)) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
