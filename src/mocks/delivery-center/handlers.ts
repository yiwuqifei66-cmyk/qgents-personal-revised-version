import { http, HttpResponse } from 'msw'
import type { DeliveryAction, DeliveryDisplayStatus, DeliveryItem, DeliveryRepositorySummary } from '@/types/delivery-center'
import { deliveryCenterStore } from './store'

function param(value: string | readonly string[] | undefined): string {
  return typeof value === 'string' ? value : value?.[0] ?? ''
}

function errorResponse(status: number, code: string, message: string): Response {
  return HttpResponse.json({ error: { code, message }, requestId: `delivery-error-${Date.now()}` }, { status })
}

function requireIdempotency(request: Request): Response | null {
  return request.headers.get('Idempotency-Key')?.trim()
    ? null
    : errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
}

function projectError(projectId: string, searchParams: URLSearchParams): Response | null {
  const scenario = searchParams.get('scenario')
  if (projectId === 'project-delivery-forbidden' || scenario === 'FORBIDDEN') return errorResponse(403, 'PROJECT_ACCESS_DENIED', 'Project access is denied')
  if (projectId === 'project-delivery-missing' || scenario === 'NOT_FOUND') return errorResponse(404, 'PROJECT_NOT_FOUND', 'Project was not found')
  if (scenario === 'CONFLICT') return errorResponse(409, 'DELIVERY_QUERY_CONFLICT', 'Delivery data changed while querying')
  if (scenario === 'UNPROCESSABLE' || (searchParams.has('limit') && Number(searchParams.get('limit')) < 1)) return errorResponse(422, 'INVALID_DELIVERY_FILTER', 'Delivery filter is invalid')
  return null
}

function filterItems(items: DeliveryItem[], searchParams: URLSearchParams): DeliveryItem[] {
  const type = searchParams.get('type')
  const status = searchParams.get('status') as DeliveryDisplayStatus | null
  const groupId = searchParams.get('groupId')
  const repositoryId = searchParams.get('repositoryId')
  const createdBy = searchParams.get('createdBy')
  const keyword = searchParams.get('keyword')?.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (type && item.resourceType !== type) return false
    if (status && item.displayStatus !== status) return false
    if (groupId && item.requirementGroup?.id !== groupId) return false
    if (createdBy && item.creator.id !== createdBy) return false
    if (keyword) {
      const searchable = [item.title, item.summary, item.source.taskDisplayCode, item.source.taskTitle, item.creator.displayName]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLocaleLowerCase()
      if (!searchable.includes(keyword)) return false
    }
    if (repositoryId && (item.resourceType !== 'CODE' || !item.repositories.some((repository) => repository.repositoryId === repositoryId))) return false
    return true
  })
}

function pageItems(items: DeliveryItem[], searchParams: URLSearchParams): { data: DeliveryItem[]; nextCursor: string | null; hasMore: boolean } {
  const limitValue = Number(searchParams.get('limit') ?? '30')
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 30
  const offset = Number(searchParams.get('cursor') ?? '0')
  const start = Number.isFinite(offset) && offset >= 0 ? offset : 0
  const data = items.slice(start, start + limit)
  const hasMore = start + limit < items.length
  return { data, nextCursor: hasMore ? String(start + limit) : null, hasMore }
}

function summarize(items: DeliveryItem[]) {
  const countsByType = { CODE: 0, MEMORY: 0, SKILL: 0, AGENT: 0 }
  const countsByStatus: Record<DeliveryDisplayStatus, number> = {
    DRAFT: 0,
    PENDING_REVIEW: 0,
    PROCESSING: 0,
    ACCEPTED: 0,
    REJECTED: 0,
    DELIVERED: 0,
    FAILED: 0,
    ARCHIVED: 0,
  }
  const repositoryMap = new Map<string, DeliveryRepositorySummary>()
  const groups = new Map<string, { requirementGroupId: string; name: string; total: number; pending: number }>()
  let pendingForCurrentUser = 0
  for (const item of items) {
    countsByType[item.resourceType] += 1
    countsByStatus[item.displayStatus] = (countsByStatus[item.displayStatus] ?? 0) + 1
    if (item.capabilities.canSubmitReview || item.capabilities.canApprove || item.capabilities.canReject || item.capabilities.canRetryDelivery) pendingForCurrentUser += 1
    if (item.requirementGroup) {
      const groupId = item.requirementGroup.id
      const group = groups.get(groupId) ?? { requirementGroupId: groupId, name: item.requirementGroup.name, total: 0, pending: 0 }
      group.total += 1
      if (item.displayStatus === 'PENDING_REVIEW') group.pending += 1
      groups.set(groupId, group)
    }
    if (item.resourceType !== 'CODE') continue
    for (const repository of item.repositories) {
      const current = repositoryMap.get(repository.repositoryId) ?? { repositoryId: repository.repositoryId, repositoryName: repository.name, total: 0, accepted: 0, pending: 0, failed: 0, deliveryStatus: null, mergeRequest: null }
      current.total += 1
      if (item.displayStatus === 'ACCEPTED' || item.displayStatus === 'DELIVERED') current.accepted += 1
      if (item.displayStatus === 'PENDING_REVIEW' || item.displayStatus === 'PROCESSING') current.pending += 1
      if (item.displayStatus === 'FAILED') current.failed += 1
      const repositoryDelivery = item.repositoryDeliveries.find((delivery) => delivery.repositoryId === repository.repositoryId)
      current.deliveryStatus = repositoryDelivery?.deliveryStatus ?? null
      current.mergeRequest = repositoryDelivery?.mergeRequest ?? null
      repositoryMap.set(repository.repositoryId, current)
    }
  }
  return {
    total: items.length,
    countsByType,
    countsByStatus,
    pendingForCurrentUser,
    repositorySummaries: [...repositoryMap.values()],
    requirementGroupSummaries: [...groups.values()],
    updatedAt: '2026-08-14T08:00:00Z',
  }
}

function findItem(projectId: string, resourceId: string): DeliveryItem | undefined {
  return deliveryCenterStore.items.get(projectId)?.find((item) => item.resourceId === resourceId)
}

function actionResponse(item: DeliveryItem, requestId: string): Response {
  return HttpResponse.json({ data: item, requestId })
}

function applyResourceAction(
  projectId: string,
  resourceId: string,
  action: Extract<DeliveryAction, 'submitReview' | 'approve' | 'reject' | 'archive'>,
  reason: string | undefined,
  requestId: string,
  request: Request,
): Response {
  const idempotencyFailure = requireIdempotency(request)
  if (idempotencyFailure) return idempotencyFailure
  const item = findItem(projectId, resourceId)
  if (!item) return errorResponse(404, 'DELIVERY_ITEM_NOT_FOUND', 'Delivery resource was not found')
  if (projectId === 'project-delivery-conflict') return errorResponse(409, 'DELIVERY_STATE_CONFLICT', 'Delivery state has changed')
  if (action === 'reject' && !reason?.trim()) return errorResponse(422, 'REVIEW_REASON_REQUIRED', 'A rejection reason is required')
  const allowed = action === 'submitReview'
    ? item.capabilities.canSubmitReview
    : action === 'approve'
      ? item.capabilities.canApprove
      : action === 'reject'
        ? item.capabilities.canReject
        : item.capabilities.canArchive
  if (!allowed) return errorResponse(403, 'DELIVERY_ACTION_FORBIDDEN', 'The current capability does not allow this action')

  if (action === 'submitReview') {
    item.displayStatus = 'PENDING_REVIEW'
    item.resourceStatus = 'PENDING_REVIEW'
    item.submittedAt = new Date().toISOString()
  } else if (action === 'approve') {
    item.displayStatus = 'ACCEPTED'
    item.resourceStatus = item.resourceType === 'SKILL' ? 'PUBLISHED' : 'APPROVED'
    item.reviewer = { id: 'user-001', displayName: 'Demo Admin', avatarUrl: null }
    item.reviewedAt = new Date().toISOString()
  } else if (action === 'reject') {
    item.displayStatus = 'REJECTED'
    item.resourceStatus = 'REJECTED'
    item.reviewReason = reason?.trim() ?? null
    item.reviewer = { id: 'user-001', displayName: 'Demo Admin', avatarUrl: null }
    item.reviewedAt = new Date().toISOString()
  } else {
    item.displayStatus = 'ARCHIVED'
    item.resourceStatus = 'ARCHIVED'
  }
  item.updatedAt = new Date().toISOString()
  return actionResponse(item, requestId)
}

function applyCodeAction(
  projectId: string,
  taskId: string,
  action: 'confirm' | 'reject' | 'retry-delivery',
  reason: string | undefined,
  requestId: string,
  request: Request,
): Response {
  const idempotencyFailure = requireIdempotency(request)
  if (idempotencyFailure) return idempotencyFailure
  const item = deliveryCenterStore.items.get(projectId)?.find((candidate) => candidate.resourceType === 'CODE' && candidate.openTarget.kind === 'TASK_DIFF_REVIEW' && candidate.openTarget.taskId === taskId)
  if (!item || item.resourceType !== 'CODE') return errorResponse(404, 'DIFF_REVIEW_NOT_FOUND', 'Diff review was not found')
  if (projectId === 'project-delivery-conflict') return errorResponse(409, 'DELIVERY_STATE_CONFLICT', 'Delivery state has changed')
  if (action === 'reject' && !reason?.trim()) return errorResponse(422, 'REVIEW_REASON_REQUIRED', 'A rejection reason is required')
  const allowed = action === 'confirm' ? item.capabilities.canApprove : action === 'reject' ? item.capabilities.canReject : item.capabilities.canRetryDelivery
  if (!allowed) return errorResponse(403, 'DELIVERY_ACTION_FORBIDDEN', 'The current capability does not allow this action')
  if (action === 'confirm') {
    item.reviewStatus = 'ACCEPTED'
    item.deliveryStatus = 'DELIVERING'
    item.displayStatus = 'PROCESSING'
    item.resourceStatus = 'DELIVERING'
  } else if (action === 'reject') {
    item.reviewStatus = 'REJECTED'
    item.deliveryStatus = 'FAILED'
    item.displayStatus = 'REJECTED'
    item.resourceStatus = 'REJECTED'
    item.reviewReason = reason?.trim() ?? null
  } else {
    item.deliveryStatus = 'DELIVERED'
    item.displayStatus = 'DELIVERED'
    item.resourceStatus = 'DELIVERED'
  }
  item.updatedAt = new Date().toISOString()
  return actionResponse(item, requestId)
}

export const deliveryCenterHandlers = [
  http.post('/api/projects/:projectId/memories/:memoryId/submit-review', ({ params, request }) => applyResourceAction(param(params.projectId), param(params.memoryId), 'submitReview', undefined, `delivery-memory-submit-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/memories/:memoryId/approve', ({ params, request }) => applyResourceAction(param(params.projectId), param(params.memoryId), 'approve', undefined, `delivery-memory-approve-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/memories/:memoryId/reject', async ({ params, request }) => {
    const body: unknown = await request.json().catch(() => undefined)
    const reason = typeof body === 'object' && body !== null && 'reason' in body && typeof body.reason === 'string' ? body.reason : undefined
    return applyResourceAction(param(params.projectId), param(params.memoryId), 'reject', reason, `delivery-memory-reject-${Date.now()}`, request)
  }),
  http.post('/api/projects/:projectId/memories/:memoryId/archive', ({ params, request }) => applyResourceAction(param(params.projectId), param(params.memoryId), 'archive', undefined, `delivery-memory-archive-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/skills/:skillId/submit-review', ({ params, request }) => applyResourceAction(param(params.projectId), param(params.skillId), 'submitReview', undefined, `delivery-skill-submit-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/skills/:skillId/approve', ({ params, request }) => applyResourceAction(param(params.projectId), param(params.skillId), 'approve', undefined, `delivery-skill-approve-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/skills/:skillId/reject', async ({ params, request }) => {
    const body: unknown = await request.json().catch(() => undefined)
    const reason = typeof body === 'object' && body !== null && 'reason' in body && typeof body.reason === 'string' ? body.reason : undefined
    return applyResourceAction(param(params.projectId), param(params.skillId), 'reject', reason, `delivery-skill-reject-${Date.now()}`, request)
  }),
  http.post('/api/projects/:projectId/skills/:skillId/archive', ({ params, request }) => applyResourceAction(param(params.projectId), param(params.skillId), 'archive', undefined, `delivery-skill-archive-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/tasks/:taskId/diff-review/confirm', ({ params, request }) => applyCodeAction(param(params.projectId), param(params.taskId), 'confirm', undefined, `delivery-code-confirm-${Date.now()}`, request)),
  http.post('/api/projects/:projectId/tasks/:taskId/diff-review/reject', async ({ params, request }) => {
    const body: unknown = await request.json().catch(() => undefined)
    const reason = typeof body === 'object' && body !== null && 'reason' in body && typeof body.reason === 'string' ? body.reason : undefined
    return applyCodeAction(param(params.projectId), param(params.taskId), 'reject', reason, `delivery-code-reject-${Date.now()}`, request)
  }),
  http.post('/api/projects/:projectId/tasks/:taskId/diff-review/retry-delivery', ({ params, request }) => applyCodeAction(param(params.projectId), param(params.taskId), 'retry-delivery', undefined, `delivery-code-retry-${Date.now()}`, request)),
  http.get('/api/projects/:projectId/delivery-items', ({ params, request }) => {
    const projectId = param(params.projectId)
    const searchParams = new URL(request.url).searchParams
    const failure = projectError(projectId, searchParams)
    if (failure) return failure
    const filtered = filterItems(deliveryCenterStore.items.get(projectId) ?? [], searchParams)
    const page = pageItems(filtered, searchParams)
    return HttpResponse.json({ data: page.data, page: { nextCursor: page.nextCursor, hasMore: page.hasMore }, requestId: `delivery-items-${projectId}` })
  }),

  http.get('/api/projects/:projectId/delivery-summary', ({ params, request }) => {
    const projectId = param(params.projectId)
    const searchParams = new URL(request.url).searchParams
    const failure = projectError(projectId, searchParams)
    if (failure) return failure
    const allItems = deliveryCenterStore.items.get(projectId) ?? []
    return HttpResponse.json(summarize(filterItems(allItems, searchParams)))
  }),
]
