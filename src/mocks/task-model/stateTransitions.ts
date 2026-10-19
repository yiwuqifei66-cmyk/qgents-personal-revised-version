import type { DiffStatus, InputRequestStatus, TaskRunStatus, TaskStatus } from '@/types/task-model'

export class InvalidTaskModelTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION'
  readonly status = 409

  constructor(resource: string, current: string, action: string) {
    super(`${resource} cannot ${action} from ${current}`)
    this.name = 'InvalidTaskModelTransitionError'
  }
}

export function transitionTaskCancel(status: TaskStatus): TaskStatus {
  if (status === 'PLANNING' || status === 'PENDING') return 'CANCELLED'
  if (status === 'RUNNING') return 'CANCELLING'
  throw new InvalidTaskModelTransitionError('Task', status, 'cancel')
}

export function canRetryTaskRun(status: TaskRunStatus): boolean {
  return status === 'FAILED' || status === 'CANCELLED' || status === 'BLOCKED'
}

export function transitionTaskRunRetry(status: TaskRunStatus): TaskRunStatus {
  if (canRetryTaskRun(status)) return 'QUEUED'
  throw new InvalidTaskModelTransitionError('TaskRun', status, 'retry')
}

export function transitionTaskRunCancel(status: TaskRunStatus): TaskRunStatus {
  if (
    status === 'QUEUED' ||
    status === 'RUNNING' ||
    status === 'WAITING_INPUT' ||
    status === 'WAITING_APPROVAL'
  ) {
    return 'CANCELLING'
  }
  throw new InvalidTaskModelTransitionError('TaskRun', status, 'cancel')
}

export function transitionInputRequest(
  kind: 'INPUT' | 'APPROVAL',
  current: InputRequestStatus,
  action: 'reply' | 'approve' | 'reject',
): InputRequestStatus {
  if (current !== 'PENDING') {
    throw new InvalidTaskModelTransitionError('InputRequest', current, action)
  }
  if (kind === 'INPUT' && action === 'reply') return 'ANSWERED'
  if (kind === 'APPROVAL' && action === 'approve') return 'APPROVED'
  if (kind === 'APPROVAL' && action === 'reject') return 'REJECTED'
  throw new InvalidTaskModelTransitionError('InputRequest', kind, action)
}

export function transitionDiff(status: DiffStatus, action: 'accept' | 'reject'): DiffStatus {
  if (status !== 'PENDING_REVIEW') {
    throw new InvalidTaskModelTransitionError('Diff', status, action)
  }
  return action === 'accept' ? 'ACCEPTED' : 'REJECTED'
}
