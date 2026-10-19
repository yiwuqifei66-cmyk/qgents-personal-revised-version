import type { InputRequest, InputRequestStatus } from '@/types/task-model'

export type InputRequestAction = 'reply' | 'approve' | 'reject'

const pendingActions: Record<InputRequest['kind'], readonly InputRequestAction[]> = {
  INPUT: ['reply'],
  APPROVAL: ['approve', 'reject'],
}

export function canPerformInputRequestAction(
  request: Pick<InputRequest, 'kind' | 'status'>,
  action: InputRequestAction,
): boolean {
  return request.status === 'PENDING' && pendingActions[request.kind].includes(action)
}

export function isInputRequestReadOnly(status: InputRequestStatus): boolean {
  return status !== 'PENDING'
}
