import { describe, expect, it } from 'vitest'
import { parseProjectTaskEvent, PROJECT_TASK_EVENT_TYPES } from './eventParser'

describe('project SSE event parsing', () => {
  it.each(PROJECT_TASK_EVENT_TYPES)('parses the new event %s', (eventType) => {
    const ids = eventType === 'message.created' || eventType === 'message.updated'
    ? { groupId: 'group-1', messageId: 'message-1' }
    : eventType === 'group.created' || eventType === 'group.updated' || eventType === 'group.archived' || eventType === 'group.member.updated'
      ? { groupId: 'group-1' }
    : eventType === 'merge-request.updated'
    ? { mergeRequestId: 'mr-1', number: 10, status: 'OPEN', webUrl: 'https://example.test/mr/10' }
    : eventType === 'test-run.updated'
      ? { testRunId: 'test-run-1' }
      : eventType === 'dry-run.updated'
        ? { dryRunId: 'dry-run-1' }
        : eventType === 'preflight.updated'
          ? { taskId: 'task-1', repositoryId: 'repo-1', targetBranch: 'main' }
          : eventType === 'workspace.diff-preview.updated'
            ? { taskId: 'task-1', taskRunId: 'run-1', workspaceId: 'workspace-1', previewRevision: 1, filesChanged: 2, additions: 8, deletions: 3, eventVersion: 1 }
    : eventType === 'task-run.step.progress'
      ? { taskId: 'task-1', stepId: 'step-1', taskRunId: 'run-1' }
      : eventType === 'task.updated'
        ? { taskId: 'task-1' }
        : eventType === 'task-step.updated'
          ? { taskId: 'task-1', taskStepId: 'step-1' }
          : eventType === 'task-run.updated'
            ? { taskId: 'task-1', taskStepId: 'step-1', taskRunId: 'run-1' }
            : eventType === 'diff.created'
            ? { taskId: 'task-1', diffId: 'diff-1' }
              : eventType === 'task.artifact.created'
                ? { taskId: 'task-1', artifactId: 'artifact-1', sequenceNo: 1, artifactType: 'PLAN' }
                : eventType === 'task-run.artifact.created'
                  ? { taskId: 'task-1', taskStepId: 'step-1', taskRunId: 'run-1', artifactId: 'artifact-1', sequenceNo: 2, artifactType: 'CODING' }
                  : eventType === 'diff-review.created'
                    ? { taskId: 'task-1', reviewBatchId: 'batch-1', reviewStatus: 'PENDING_CONFIRMATION', aggregateHash: 'hash-1' }
                    : eventType === 'task.awaiting-diff-confirmation' || eventType === 'diff-review.confirmed' || eventType === 'diff-review.rejected'
                      ? { taskId: 'task-1', reviewBatchId: 'batch-1' }
                      : eventType === 'diff-review.superseded'
                        ? { workspaceId: 'workspace-1', taskId: 'task-1', reviewBatchId: 'batch-1', reviewStatus: 'SUPERSEDED' }
                      : eventType === 'delivery.repository.updated'
                        ? { taskId: 'task-1', diffId: 'diff-1', deliveryStatus: 'DELIVERED' }
                        : eventType === 'delivery.started'
                          ? { taskId: 'task-1', reviewBatchId: 'batch-1', deliveryMode: 'MR_FIRST', operationId: 'operation-1', reason: '自动交付' }
                        : eventType === 'delivery.completed' || eventType === 'delivery.failed'
                          ? { taskId: 'task-1', reviewBatchId: 'batch-1', deliveryStatus: 'DELIVERED' }
                          : eventType === 'task.diff-review.failed'
                            ? { taskId: 'task-1', reviewBatchId: 'batch-1', reason: 'delivery failed' }
                          : eventType === 'diff-review.skipped'
                                ? { taskId: 'task-1', reason: 'FINAL_DIFF_EMPTY' }
                                : eventType.startsWith('memory.')
                                  ? { resourceType: 'MEMORY', resourceId: 'memory-1', eventVersion: 1, updatedAt: '2026-08-15T00:00:00Z' }
                                  : eventType.startsWith('skill.')
                                    ? { resourceType: 'SKILL', resourceId: 'skill-1', eventVersion: 1, updatedAt: '2026-08-15T00:00:00Z' }
                                    : { taskId: 'task-1', taskStepId: 'step-1', taskRunId: 'run-1', inputRequestId: 'input-1' }
    const event = parseProjectTaskEvent({
      id: 'evt-new',
      event: eventType,
      data: JSON.stringify({ projectId: 'project-1', ...ids }),
    })
    expect(event?.type).toBe(eventType)
  })

  it('parses supported events and preserves the event id', () => {
    const event = parseProjectTaskEvent({
      id: 'evt-1',
      event: 'task-run.step.progress',
      data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1', stepId: 'step-1', sequence: 2 }),
    })

    expect(event).toEqual({
      id: 'evt-1',
      type: 'task-run.step.progress',
      payload: { projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1', stepId: 'step-1', sequence: 2 },
    })
  })

  it.each([
    'orchestration-run.updated',
    'work-package.updated',
    'task-run.input-required',
    'task-run.approval-required',
    'test-run.updated',
    'dry-run.updated',
    '',
  ])('ignores retired or unrelated event %s', (eventType) => {
    expect(parseProjectTaskEvent({
      id: 'evt-ignored',
      event: eventType,
      data: JSON.stringify({ projectId: 'project-1' }),
    })).toBeNull()
  })

  it('ignores malformed payloads without treating them as domain events', () => {
    expect(parseProjectTaskEvent({ id: 'evt-2', event: 'task.updated', data: '{' })).toBeNull()
    expect(parseProjectTaskEvent({
      id: 'evt-3',
      event: 'task.updated',
      data: JSON.stringify({ taskRunId: 'task-1' }),
    })).toBeNull()
  })

  it('accepts the legacy stepId field name on task-run.step.progress', () => {
    const event = parseProjectTaskEvent({
      id: 'evt-legacy',
      event: 'task-run.step.progress',
      data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1', stepId: 'step-1' }),
    })
    expect(event?.type).toBe('task-run.step.progress')
  })

  it('accepts the documented taskStepId field name on task-run.step.progress', () => {
    const event = parseProjectTaskEvent({
      id: 'evt-doc',
      event: 'task-run.step.progress',
      data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1', taskStepId: 'step-1' }),
    })
    expect(event?.type).toBe('task-run.step.progress')
  })

  it('rejects task-run.step.progress payloads missing both stepId and taskStepId', () => {
    expect(parseProjectTaskEvent({
      id: 'evt-missing',
      event: 'task-run.step.progress',
      data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1' }),
    })).toBeNull()
  })

  it('requires a supported delivery mode for delivery.started', () => {
    expect(parseProjectTaskEvent({ id: 'evt-delivery', event: 'delivery.started', data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', reviewBatchId: 'batch-1', deliveryMode: 'UNKNOWN', operationId: 'operation-1' }) })).toBeNull()
  })

  it('rejects malformed workspace preview events', () => {
    expect(parseProjectTaskEvent({ id: 'evt-preview', event: 'workspace.diff-preview.updated', data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1', workspaceId: 'workspace-1', previewRevision: -1, filesChanged: 2, additions: 8, deletions: 3, eventVersion: 1 }) })).toBeNull()
    expect(parseProjectTaskEvent({ id: 'evt-preview', event: 'workspace.diff-preview.updated', data: JSON.stringify({ projectId: 'project-1', taskId: 'task-1', taskRunId: 'run-1', workspaceId: 'workspace-1', previewRevision: 1, filesChanged: 2, additions: 8, deletions: 3, eventVersion: 2 }) })).toBeNull()
  })
})
