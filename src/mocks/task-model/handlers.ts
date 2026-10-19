import { http, HttpResponse, type HttpHandler, type PathParams } from 'msw'
import type {
  DiffComment,
  DiffRejectInput,
  Task,
  TaskCreateInput,
  TaskStepCreateInput,
  TaskRunDetail,
  TaskRunSummary,
  TaskStep,
  TaskArtifact,
  PreflightStatus,
} from '@/types/task-model'
import {
  InvalidTaskModelTransitionError,
  transitionDiff,
  transitionInputRequest,
  transitionTaskCancel,
  transitionTaskRunCancel,
  transitionTaskRunRetry,
} from './stateTransitions'
import {
  createTaskModelScenario,
  createTaskModelScenarioByName,
  taskModelScenarioNames,
  type TaskModelScenario,
} from './fixtures'
import { findDiff, findInputRequest, findTask, findTaskRun, findTaskStep, type TaskModelStore } from './store'

const stores = new Map<string, TaskModelStore>()
const diffReviewIdempotency = new Map<string, { fingerprint: string; batch: import('@/types/task-model').DiffReviewBatch }>()
const cqHistories = new Map<string, CqRecord[]>()
const cqIdempotency = new Map<string, { fingerprint: string; item: import('@/types/task-model').MergeRequestSummary }>()
const requestId = 'task-model-mock-request'

interface CqRecord {
  id: string
  status: 'PASSED' | 'FAILED'
  commitSha: string | null
  reviewedByUserId: string
  reviewedByName: string
  reason: string
  completedAt: string
}

export function resetTaskModelStore(): void {
  stores.clear()
  diffReviewIdempotency.clear()
  cqHistories.clear()
  cqIdempotency.clear()
}

function pathParam(params: PathParams, name: string): string {
  const value = params[name]
  return typeof value === 'string' ? value : ''
}

function getStore(projectId: string, request: Request): TaskModelStore {
  const scenarioValue = new URL(request.url).searchParams.get('scenario')
  const scenario = taskModelScenarioNames.includes(scenarioValue as TaskModelScenario)
    ? (scenarioValue as TaskModelScenario)
    : undefined
  if (scenario) {
    const store = createTaskModelScenarioByName(projectId, scenario)
    stores.set(projectId, store)
    return store
  }
  return getDefaultStore(projectId)
}

function getDefaultStore(projectId: string): TaskModelStore {
  const existing = stores.get(projectId)
  if (existing) return existing
  const store = createTaskModelScenario(projectId)
  stores.set(projectId, store)
  return store
}

function response<T>(data: T, status = 200): HttpResponse<Record<string, unknown>> {
  return HttpResponse.json({ data, requestId }, { status }) as HttpResponse<Record<string, unknown>>
}

function page<T>(items: T[], request: Request): HttpResponse<Record<string, unknown>> {
  const search = new URL(request.url).searchParams
  const rawLimit = Number(search.get('limit') ?? '30')
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30
  const rawCursor = Number(search.get('cursor') ?? '0')
  const start = Number.isInteger(rawCursor) && rawCursor >= 0 ? rawCursor : 0
  const data = items.slice(start, start + limit)
  const nextStart = start + data.length
  return HttpResponse.json({
    data,
    page: { nextCursor: nextStart < items.length ? String(nextStart) : null, hasMore: nextStart < items.length },
    requestId,
  }) as HttpResponse<Record<string, unknown>>
}

function errorResponse(status: number, code: string, message: string, field?: string): HttpResponse<Record<string, unknown>> {
  return HttpResponse.json({
    error: { code, message, details: field ? [{ field, reason: 'invalid' }] : [] },
    requestId,
  }, { status }) as HttpResponse<Record<string, unknown>>
}

function transitionError(error: unknown): HttpResponse<Record<string, unknown>> {
  if (error instanceof InvalidTaskModelTransitionError) {
    return errorResponse(error.status, error.code, error.message)
  }
  return errorResponse(500, 'MOCK_UNEXPECTED_ERROR', 'Unexpected mock error')
}

function guardProject(projectId: string): HttpResponse<Record<string, unknown>> | null {
  return projectId === 'forbidden'
    ? errorResponse(403, 'PROJECT_ACCESS_DENIED', 'Project access is forbidden')
    : null
}

function missing(resource: string): HttpResponse<Record<string, unknown>> {
  return errorResponse(404, 'MOCK_NOT_FOUND', `${resource} was not found`)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item))
}

function diffReviewIdempotencyResponse(
  projectId: string,
  taskId: string,
  request: Request,
  fingerprint: string,
): HttpResponse<Record<string, unknown>> | null {
  const key = request.headers.get('Idempotency-Key')
  if (!key) return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  const recordKey = `${projectId}:${taskId}:${key}`
  const existing = diffReviewIdempotency.get(recordKey)
  if (!existing) return null
  if (existing.fingerprint !== fingerprint) return errorResponse(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for another request')
  return response(structuredClone(existing.batch))
}

function rememberDiffReviewIdempotency(projectId: string, taskId: string, request: Request, fingerprint: string, batch: import('@/types/task-model').DiffReviewBatch): void {
  const key = request.headers.get('Idempotency-Key')
  if (!key) return
  diffReviewIdempotency.set(`${projectId}:${taskId}:${key}`, { fingerprint, batch: structuredClone(batch) })
}

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json()
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

function invalidTaskInput(body: Record<string, unknown>): string | null {
  const allowed = new Set(['requirementGroupId', 'title', 'requirement', 'repositoryIds', 'baseRef', 'deliveryMode', 'workspaceId', 'continuationOfTaskId'])
  const unsupported = Object.keys(body).find((key) => !allowed.has(key))
  if (unsupported) return unsupported
  if (!isNonEmptyString(body.requirementGroupId)) return 'requirementGroupId'
  if (!isNonEmptyString(body.title)) return 'title'
  if (!isNonEmptyString(body.requirement)) return 'requirement'
  if (!isStringArray(body.repositoryIds)) return 'repositoryIds'
  if (!isNonEmptyString(body.baseRef)) return 'baseRef'
  if (body.deliveryMode !== undefined && body.deliveryMode !== 'DIFF_FIRST' && body.deliveryMode !== 'MR_FIRST') return 'deliveryMode'
  return null
}

function makeId(projectId: string, resource: string, currentSize: number): string {
  return `${resource}-${projectId}-${currentSize + 1}`
}

function repositoriesForStep(task: Task, repositoryId: string) {
  const repository = task.repositories.find((item) => item.repositoryId === repositoryId)
  return repository ? { repositoryId: repository.repositoryId, name: repository.name, sourceBranch: repository.sourceBranch } : null
}

function taskListItem(task: Task): import('@/types/task-model').TaskListItem {
  const { requirement: _requirement, acceptanceCriteria: _acceptanceCriteria, workspace: _workspace, capabilities: _capabilities, artifactSummary: _artifactSummary, diffReviewSummary: _diffReviewSummary, sourceMessage: _sourceMessage, triggerMessageId: _triggerMessageId, ...item } = task
  return item
}

function createTaskResources(store: TaskModelStore, input: TaskCreateInput, projectId: string): Task {
  const createdAt = new Date().toISOString()
  const id = makeId(projectId, 'task', store.tasks.size)
  const refs = new Map((input.repositoryRefs ?? []).map((item) => [item.repositoryId, item.baseRef]))
  const repositories = input.repositoryIds.map((repository) => {
    const baseRef = refs.get(repository) ?? input.baseRef ?? 'main'
    return { repositoryId: repository, name: 'Mock repository', fullName: `qgents/${repository}`, provider: 'GITHUB', defaultBranch: 'main', baseRef, baseCommit: `base-${baseRef}`, sourceBranch: baseRef, headCommit: null }
  })
  const task: Task = { id, displayCode: `T-${store.tasks.size + 1000}`, projectId, title: input.title, requirementSummary: input.requirement.slice(0, 200), status: 'PLANNING', deliveryMode: input.deliveryMode ?? null, deliveryReason: null, requirementGroup: { id: input.requirementGroupId, name: input.requirementGroupId, status: 'ACTIVE' }, createdByUser: { id: 'mock-user', displayName: 'Mock User', avatarUrl: null }, repositories, executionSummary: { totalSteps: 0, pendingSteps: 0, runningSteps: 0, waitingSteps: 0, blockedSteps: 0, succeededSteps: 0, failedSteps: 0, currentStage: null, currentStageTitle: '规划中', requiresUserAction: false }, attention: null, statusReason: null, createdAt, updatedAt: createdAt, requirement: input.requirement, acceptanceCriteria: [], workspace: { id: input.workspaceId ?? `workspace-${id}`, status: 'READY', repositories }, capabilities: { canCancel: true, canReplacePendingStepAgent: false, canConfirmDiffReview: false, canRejectDiffReview: false, canRetryDelivery: false }, artifactSummary: { total: 0, byType: {} }, diffReviewSummary: { available: false, diffId: null, reviewStatus: null, deliveryStatus: null, repositoryCount: 0, filesChanged: 0, additions: 0, deletions: 0 }, sourceMessage: null, triggerMessageId: null }
  store.tasks.set(task.id, task)
  return task
}

export function findTaskByTriggerMessageId(projectId: string, messageId: string): Task | undefined {
  return [...getDefaultStore(projectId).tasks.values()].find((task) => task.triggerMessageId === messageId)
}

export function createTaskFromMessageIntent(
  projectId: string,
  input: { requirementGroupId: string; title: string; requirement: string; messageId: string; createdAt: string },
): Task {
  const store = getDefaultStore(projectId)
  const id = makeId(projectId, 'task', store.tasks.size)
  const task: Task = {
    id,
    displayCode: `T-${store.tasks.size + 1000}`,
    projectId,
    title: input.title,
    requirementSummary: input.requirement.slice(0, 200),
    status: 'PLANNING',
    deliveryMode: null,
    deliveryReason: null,
    requirementGroup: { id: input.requirementGroupId, name: input.requirementGroupId, status: 'ACTIVE' },
    createdByUser: { id: 'mock-user', displayName: 'Mock User', avatarUrl: null },
    repositories: [],
    executionSummary: { totalSteps: 0, pendingSteps: 0, runningSteps: 0, waitingSteps: 0, blockedSteps: 0, succeededSteps: 0, failedSteps: 0, currentStage: 'PLANNER', currentStageTitle: '等待补充执行环境', requiresUserAction: true },
    attention: { kind: 'INPUT_REQUIRED', title: '需要补充执行信息', summary: '请补充仓库和基线分支后继续规划。', taskRunId: null, inputRequestId: null, diffReviewBatchId: null, repositoryId: null, createdAt: input.createdAt },
    statusReason: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    requirement: input.requirement,
    acceptanceCriteria: [],
    workspace: null,
    capabilities: { canCancel: true, canReplacePendingStepAgent: false, canConfirmDiffReview: false, canRejectDiffReview: false, canRetryDelivery: false },
    artifactSummary: { total: 0, byType: {} },
    diffReviewSummary: { available: false, diffId: null, reviewStatus: null, deliveryStatus: null, repositoryCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
    sourceMessage: { id: input.messageId, sender: { id: 'user-001', displayName: 'Mock User', avatarUrl: null }, textExcerpt: input.requirement.slice(0, 200), createdAt: input.createdAt },
    triggerMessageId: input.messageId,
  }
  store.tasks.set(task.id, task)
  return task
}

function taskRunsForTask(store: TaskModelStore, taskId: string): TaskRunDetail[] {
  return [...store.taskRuns.values()].filter((run) => run.taskId === taskId)
}

function taskStepsForTask(store: TaskModelStore, taskId: string): TaskStep[] {
  return [...store.taskSteps.values()].filter((step) => step.taskId === taskId)
}

function detailForRun(store: TaskModelStore, run: TaskRunDetail): TaskRunDetail {
  const steps = store.taskRunSteps.get(run.id)
  return steps ? { ...run, steps: [...steps] } : (() => {
    const { steps: _steps, ...summary } = run
    return summary
  })()
}

function summaryForRun(run: TaskRunDetail): TaskRunSummary {
  return { id: run.id, taskId: run.taskId, taskStepId: run.taskStepId, taskStepTitle: run.taskStepTitle, agent: run.agent, role: run.role, status: run.status, retryOfTaskRunId: run.retryOfTaskRunId, statusSummary: run.statusSummary, statusReason: run.statusReason, startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs, artifactSummary: run.artifactSummary, createdAt: run.createdAt, updatedAt: run.updatedAt }
}

function cloneRetryResources(store: TaskModelStore, original: TaskRunDetail, retry: TaskRunDetail): void {
  const steps = store.taskRunSteps.get(original.id)
  if (steps) store.taskRunSteps.set(retry.id, steps.map((step) => ({ ...step, status: 'PENDING' })))
  const logs = store.taskRunLogs.get(original.id)
  store.taskRunLogs.set(retry.id, logs?.map((log) => ({ ...log })) ?? [])
  const context = store.executionContexts.get(original.id)
  if (context) store.executionContexts.set(retry.id, { ...context, startedAt: null })
}

const taskCreateListDetailHandlers: HttpHandler[] = [
  http.post('*/api/projects/:projectId/tasks', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const body = await jsonObject(request)
    const invalidField = invalidTaskInput(body)
    if (invalidField) return errorResponse(422, 'VALIDATION_FAILED', `Invalid ${invalidField}`, invalidField)
    return response(createTaskResources(getStore(projectId, request), body as unknown as TaskCreateInput, projectId), 201)
  }),

  http.get('*/api/projects/:projectId/tasks', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const search = new URL(request.url).searchParams
    const groupId = search.get('groupId')
    const status = search.get('status')
    const createdBy = search.get('createdBy')
    const repositoryId = search.get('repositoryId')
    const keyword = search.get('keyword')?.trim().toLocaleLowerCase()
    const tasks = [...store.tasks.values()].filter((task) =>
      (!groupId || task.requirementGroup?.id === groupId) &&
      (!status || task.status === status) &&
      (!createdBy || task.createdByUser?.id === createdBy) &&
      (!repositoryId || task.repositories.some((repository) => repository.repositoryId === repositoryId)) &&
      (!keyword || [task.displayCode, task.title, task.requirementSummary, task.requirementGroup?.name, task.createdByUser?.displayName, ...task.repositories.map((repository) => repository.name)].filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase().includes(keyword)),
    )
    return page(tasks.map(taskListItem), request)
  }),

  http.get('*/api/projects/:projectId/tasks/:taskId', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const task = findTask(getStore(projectId, request), pathParam(params, 'taskId'))
    return task?.projectId === projectId ? response(task) : missing('Task')
  }),
]

const taskStepListHandler: HttpHandler = http.get('*/api/projects/:projectId/tasks/:taskId/steps', ({ params, request }) => {
  const projectId = pathParam(params, 'projectId')
  const denied = guardProject(projectId)
  if (denied) return denied
  const store = getStore(projectId, request)
  const task = findTask(store, pathParam(params, 'taskId'))
  return task ? page(taskStepsForTask(store, task.id), request) : missing('Task')
})

const taskStepMutationHandlers: HttpHandler[] = [
  http.post('*/api/projects/:projectId/tasks/:taskId/steps', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const task = findTask(store, pathParam(params, 'taskId'))
    if (!task) return missing('Task')
    const body = await jsonObject(request)
    if (!isNonEmptyString(body.role)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid role', 'role')
    if (body.agentId !== undefined && !isNonEmptyString(body.agentId)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid agentId', 'agentId')
    const input = body as unknown as TaskStepCreateInput
    const repositoryId = input.repositoryId ?? task.repositories[0]?.repositoryId ?? ''
    const step: TaskStep = { id: makeId(task.id, 'step', taskStepsForTask(store, task.id).length), taskId: task.id, sequenceNo: taskStepsForTask(store, task.id).length + 1, title: input.role, description: null, role: input.role, agent: null, repository: repositoriesForStep(task, repositoryId), dependencies: input.dependencies ?? [], status: 'PENDING', acceptanceNotes: input.acceptanceNotes ?? null, latestRun: null, runCount: 0, startedAt: null, finishedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    store.taskSteps.set(step.id, step)
    return response(step, 201)
  }),

  http.post('*/api/projects/:projectId/tasks/:taskId/steps/:stepId/replace-agent', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const step = findTaskStep(store, pathParam(params, 'stepId'))
    if (!step || step.taskId !== pathParam(params, 'taskId')) return missing('TaskStep')
    if (step.status !== 'PENDING') return errorResponse(409, 'INVALID_STATE_TRANSITION', 'TaskStep can only replace agent while PENDING')
    const body = await jsonObject(request)
    if (!isNonEmptyString(body.agentId)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid agentId', 'agentId')
    step.agent = null
    return response(step)
  }),

]

const taskCancelHandler: HttpHandler = http.post('*/api/projects/:projectId/tasks/:taskId/cancel', ({ params, request }) => {
  const projectId = pathParam(params, 'projectId')
  const denied = guardProject(projectId)
  if (denied) return denied
  const store = getStore(projectId, request)
  const task = findTask(store, pathParam(params, 'taskId'))
  if (!task) return missing('Task')
  try {
    task.status = transitionTaskCancel(task.status)
    task.updatedAt = new Date().toISOString()
    return response(task, 202)
  } catch (error: unknown) {
    return transitionError(error)
  }
})

export const taskModelTaskCenterHandlers: HttpHandler[] = [
  ...taskCreateListDetailHandlers,
  taskStepListHandler,
  taskCancelHandler,
]

export const taskModelTaskHandlers: HttpHandler[] = [
  ...taskModelTaskCenterHandlers,
  ...taskStepMutationHandlers,
]

export const taskModelTaskRunHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/tasks/:taskId/task-runs', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const task = findTask(store, pathParam(params, 'taskId'))
    if (!task) return missing('Task')
    const status = new URL(request.url).searchParams.get('status')
    return page(taskRunsForTask(store, task.id).filter((run) => !status || run.status === status).map(summaryForRun), request)
  }),

  http.get('*/api/projects/:projectId/task-runs/:taskRunId', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const run = findTaskRun(getStore(projectId, request), pathParam(params, 'taskRunId'))
    return run?.taskId && findTask(getStore(projectId, request), run.taskId)?.projectId === projectId ? response(detailForRun(getStore(projectId, request), run)) : missing('TaskRun')
  }),

  http.post('*/api/projects/:projectId/task-runs/:taskRunId/retry', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const original = findTaskRun(store, pathParam(params, 'taskRunId'))
    if (!original) return missing('TaskRun')
    let retryStatus: TaskRunDetail['status']
    try {
      retryStatus = transitionTaskRunRetry(original.status)
    } catch (error: unknown) {
      return transitionError(error)
    }
    const now = new Date().toISOString()
    const retry: TaskRunDetail = {
      ...original,
      id: `${original.id}-retry-${store.taskRuns.size + 1}`,
      status: retryStatus,
      retryOfTaskRunId: original.id,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      updatedAt: now,
      createdAt: now,
    }
    delete retry.steps
    store.taskRuns.set(retry.id, retry)
    cloneRetryResources(store, original, retry)
    return response(detailForRun(store, retry), 202)
  }),

  http.post('*/api/projects/:projectId/task-runs/:taskRunId/cancel', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const run = findTaskRun(store, pathParam(params, 'taskRunId'))
    if (!run) return missing('TaskRun')
    try {
      run.status = transitionTaskRunCancel(run.status)
      run.updatedAt = new Date().toISOString()
      return response(detailForRun(store, run), 202)
    } catch (error: unknown) {
      return transitionError(error)
    }
  }),

  http.get('*/api/projects/:projectId/task-runs/:taskRunId/logs', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const run = findTaskRun(store, pathParam(params, 'taskRunId'))
    return run ? page(store.taskRunLogs.get(run.id) ?? [], request) : missing('TaskRun')
  }),

  http.get('*/api/projects/:projectId/task-runs/:taskRunId/execution-context', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const run = findTaskRun(store, pathParam(params, 'taskRunId'))
    const context = run ? store.executionContexts.get(run.id) : undefined
    return context ? response(context) : missing('ExecutionContext')
  }),

  http.get('*/api/projects/:projectId/task-runs/:taskRunId/input-requests', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const run = findTaskRun(store, pathParam(params, 'taskRunId'))
    if (!run) return missing('TaskRun')
    return page([...store.inputRequests.values()].filter((item) => item.taskRunId === run.id), request)
  }),

  ...(['reply', 'approve', 'reject'] as const).map((action) => http.post(
    `*/api/projects/:projectId/task-runs/:taskRunId/input-requests/:requestId/${action}`,
    async ({ params, request }) => {
      const projectId = pathParam(params, 'projectId')
      const denied = guardProject(projectId)
      if (denied) return denied
      const store = getStore(projectId, request)
      const run = findTaskRun(store, pathParam(params, 'taskRunId'))
      const inputRequest = findInputRequest(store, pathParam(params, 'requestId'))
      if (!run || !inputRequest || inputRequest.taskRunId !== run.id) return missing('InputRequest')
      const body = await jsonObject(request)
      if (action === 'reply' && (!body.answer || typeof body.answer !== 'object' || !isNonEmptyString((body.answer as Record<string, unknown>).value))) {
        return errorResponse(422, 'VALIDATION_FAILED', 'A non-empty answer is required', 'answer')
      }
      if (action !== 'reply' && !isNonEmptyString(body.reason)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'A non-empty reason is required', 'reason')
      }
      try {
        inputRequest.status = transitionInputRequest(inputRequest.kind, inputRequest.status, action)
      } catch (error: unknown) {
        return transitionError(error)
      }
      run.status = action === 'reject' ? 'BLOCKED' : 'RUNNING'
      run.updatedAt = new Date().toISOString()
      return response(inputRequest, 202)
    },
  )),

]

export const taskModelDiffHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/diffs', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const taskId = new URL(request.url).searchParams.get('taskId')
    return page([...store.diffs.values()].filter((diff) => !taskId || diff.taskId === taskId), request)
  }),

  http.get('*/api/projects/:projectId/diffs/:diffId', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const diff = findDiff(getStore(projectId, request), pathParam(params, 'diffId'))
    return diff?.projectId === projectId ? response(diff) : missing('Diff')
  }),

  http.get('*/api/projects/:projectId/diffs/:diffId/files', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const diff = findDiff(store, pathParam(params, 'diffId'))
    return diff ? page(store.diffFiles.get(diff.id) ?? [], request) : missing('Diff')
  }),

  http.get('*/api/projects/:projectId/diffs/:diffId/comments', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const diff = findDiff(store, pathParam(params, 'diffId'))
    return diff ? page(store.diffComments.get(diff.id) ?? [], request) : missing('Diff')
  }),

  http.post('*/api/projects/:projectId/diffs/:diffId/comments', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const diff = findDiff(store, pathParam(params, 'diffId'))
    if (!diff) return missing('Diff')
    const body = await jsonObject(request)
    if (!isNonEmptyString(body.body)) return errorResponse(422, 'VALIDATION_FAILED', 'Comment body is required', 'body')
    const comment: DiffComment = {
      id: `comment-${diff.id}-${(store.diffComments.get(diff.id) ?? []).length + 1}`,
      diffId: diff.id,
      path: typeof body.path === 'string' ? body.path : null,
      side: typeof body.side === 'string' ? body.side : null,
      line: typeof body.line === 'number' ? body.line : null,
      hunkId: typeof body.hunkId === 'string' ? body.hunkId : null,
      commitSha: diff.headCommit ?? null,
      body: body.body,
      authorUserId: 'user-001',
      authorName: null,
      authorAvatarUrl: 'https://cdn.example.com/avatars/user-001.png',
      createdAt: new Date().toISOString(),
    }
    store.diffComments.set(diff.id, [...(store.diffComments.get(diff.id) ?? []), comment])
    return response(comment, 201)
  }),

  http.post('*/api/projects/:projectId/diffs/:diffId/accept', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const diff = findDiff(store, pathParam(params, 'diffId'))
    if (!diff) return missing('Diff')
    if (store.diffReviews.has(diff.taskId)) return errorResponse(409, 'DIFF_BATCH_REVIEW_REQUIRED', 'Review the task Diff batch instead')
    try {
      diff.status = transitionDiff(diff.status, 'accept')
      diff.reviewedBy = 'mock-reviewer'
      diff.reviewedAt = new Date().toISOString()
      diff.updatedAt = diff.reviewedAt
      if (!diff.headCommit) diff.headCommit = `head-${diff.id}`
      return response(diff)
    } catch (error: unknown) {
      return transitionError(error)
    }
  }),

  http.post('*/api/projects/:projectId/diffs/:diffId/reject', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const diff = findDiff(store, pathParam(params, 'diffId'))
    if (!diff) return missing('Diff')
    if (store.diffReviews.has(diff.taskId)) return errorResponse(409, 'DIFF_BATCH_REVIEW_REQUIRED', 'Review the task Diff batch instead')
    const body = await jsonObject(request) as unknown as DiffRejectInput
    if (!isNonEmptyString(body.reason)) return errorResponse(422, 'VALIDATION_FAILED', 'A rejection reason is required', 'reason')
    try {
      diff.status = transitionDiff(diff.status, 'reject')
      diff.reviewedBy = 'mock-reviewer'
      diff.reviewReason = body.reason
      diff.reviewedAt = new Date().toISOString()
      diff.updatedAt = diff.reviewedAt
      return response(diff, 202)
    } catch (error: unknown) {
      return transitionError(error)
    }
  }),
]

const taskArtifactAndDiffReviewHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/tasks/:taskId/artifacts', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const task = findTask(store, pathParam(params, 'taskId'))
    if (!task || task.projectId !== projectId) return missing('Task')
    return response([...(store.taskArtifacts.get(task.id) ?? [])] satisfies TaskArtifact[])
  }),
  http.get('*/api/projects/:projectId/tasks/:taskId/diff-review', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const task = findTask(store, pathParam(params, 'taskId'))
    const batch = task ? store.diffReviews.get(task.id) : undefined
    return batch ? response(batch) : errorResponse(404, 'DIFF_REVIEW_NOT_FOUND', 'Final Diff has not been generated')
  }),
  http.post('*/api/projects/:projectId/tasks/:taskId/diff-review/confirm', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const taskId = pathParam(params, 'taskId')
    const idempotencyResponse = diffReviewIdempotencyResponse(projectId, taskId, request, 'confirm')
    if (idempotencyResponse) return idempotencyResponse
    const batch = store.diffReviews.get(taskId)
    if (!batch) return errorResponse(404, 'DIFF_REVIEW_NOT_FOUND', 'Final Diff has not been generated')
    if (batch.reviewStatus !== 'PENDING_CONFIRMATION' || batch.confirmationSource !== 'USER') return errorResponse(409, 'DIFF_REVIEW_NOT_DECIDABLE', 'Diff review is not user-decidable')
    batch.reviewStatus = 'ACCEPTED'
    batch.deliveryStatus = 'DELIVERING'
    const task = findTask(store, taskId)
    if (task) task.status = 'DELIVERING'
    rememberDiffReviewIdempotency(projectId, taskId, request, 'confirm', batch)
    return response(batch)
  }),
  http.post('*/api/projects/:projectId/tasks/:taskId/diff-review/reject', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const body = await jsonObject(request)
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason || reason.length > 4000) return errorResponse(400, 'DIFF_REJECT_REASON_REQUIRED', 'A rejection reason is required')
    const store = getStore(projectId, request)
    const taskId = pathParam(params, 'taskId')
    const idempotencyResponse = diffReviewIdempotencyResponse(projectId, taskId, request, `reject:${reason}`)
    if (idempotencyResponse) return idempotencyResponse
    const batch = store.diffReviews.get(taskId)
    if (!batch) return errorResponse(404, 'DIFF_REVIEW_NOT_FOUND', 'Final Diff has not been generated')
    if (batch.reviewStatus !== 'PENDING_CONFIRMATION' || batch.confirmationSource !== 'USER') return errorResponse(409, 'DIFF_REVIEW_NOT_DECIDABLE', 'Diff review is not user-decidable')
    batch.reviewStatus = 'REJECTED'
    batch.reviewReason = reason
    const task = findTask(store, taskId)
    if (task) task.status = 'FAILED'
    rememberDiffReviewIdempotency(projectId, taskId, request, `reject:${reason}`, batch)
    return response(batch)
  }),
  http.post('*/api/projects/:projectId/tasks/:taskId/diff-review/retry-delivery', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const taskId = pathParam(params, 'taskId')
    const idempotencyResponse = diffReviewIdempotencyResponse(projectId, taskId, request, 'retry-delivery')
    if (idempotencyResponse) return idempotencyResponse
    const batch = store.diffReviews.get(taskId)
    if (!batch) return errorResponse(404, 'DIFF_REVIEW_NOT_FOUND', 'Final Diff has not been generated')
    if (batch.reviewStatus !== 'ACCEPTED' || (batch.deliveryStatus !== 'FAILED' && batch.deliveryStatus !== 'PARTIALLY_DELIVERED')) return errorResponse(409, 'DIFF_DELIVERY_NOT_RETRYABLE', 'Diff delivery cannot be retried')
    batch.deliveryStatus = 'DELIVERED'
    const task = findTask(store, taskId)
    if (task) task.status = 'SUCCEEDED'
    rememberDiffReviewIdempotency(projectId, taskId, request, 'retry-delivery', batch)
    return response(batch)
  }),
]

function mergeRequestChecks(
  item: import('@/types/task-model').MergeRequestSummary,
  projectId: string,
): import('@/types/task-model').MergeRequestCheck[] {
  const requiredChecks = item.qualityGate?.requiredChecks ?? ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE']
  const overall = item.qualityGate?.status ?? 'PENDING'
  const history = cqHistories.get(item.id) ?? []
  const cq = history[history.length - 1]
  return requiredChecks.flatMap((type, index) => {
    if (type !== 'TESTSET' && type !== 'AI_REVIEW' && type !== 'DRY_RUN' && type !== 'CQ_PLUS_ONE') return []
    let status: 'PENDING' | 'PASSED' | 'FAILED' = 'PENDING'
    if (overall === 'PASSED') status = 'PASSED'
    else if (overall === 'FAILED') status = type === 'CQ_PLUS_ONE' ? 'FAILED' : 'PASSED'
    else if (type === 'TESTSET' || type === 'DRY_RUN') status = 'PASSED'
    if (type === 'CQ_PLUS_ONE' && cq) status = cq.status
    const completed = type === 'CQ_PLUS_ONE' && cq ? cq.completedAt : status === 'PENDING' ? null : '2026-08-12T08:01:00Z'
    return [{
      id: `check-${item.id}-${index + 1}`,
      type,
      status,
      attemptNo: 1,
      testsetId: type === 'TESTSET' ? `testset-${projectId}-login` : null,
      testRunId: type === 'TESTSET' ? `testrun-${projectId}-1` : null,
      dryRunId: type === 'DRY_RUN' ? `dryrun-${projectId}-1` : null,
      commitSha: type === 'CQ_PLUS_ONE' && cq ? cq.commitSha : item.headCommit,
      source: 'MOCK',
      startedAt: '2026-08-12T08:00:00Z',
      completedAt: completed,
      reviewedByUserId: type === 'CQ_PLUS_ONE' ? cq?.reviewedByUserId ?? null : null,
      reviewedByName: type === 'CQ_PLUS_ONE' ? cq?.reviewedByName ?? null : null,
      reviewReason: type === 'CQ_PLUS_ONE' ? cq?.reason ?? null : null,
    }]
  })
}

function refreshQualityGate(
  item: import('@/types/task-model').MergeRequestSummary,
  projectId: string,
): void {
  if (!item.qualityGate) return
  const required = (item.qualityGate.requiredChecks ?? ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE']).filter(
    (type) => type === 'TESTSET' || type === 'AI_REVIEW' || type === 'DRY_RUN' || type === 'CQ_PLUS_ONE',
  )
  const checks = mergeRequestChecks(item, projectId)
  const allPassed = required.every((type) => checks.find((check) => check.type === type)?.status === 'PASSED')
  const anyFailed = checks.some((check) => required.includes(check.type) && check.status === 'FAILED')
  item.qualityGate.status = allPassed ? 'PASSED' : anyFailed ? 'FAILED' : 'PENDING'
}

async function writeCqDecision(
  params: PathParams,
  request: Request,
  decision: 'PASSED' | 'FAILED',
): Promise<HttpResponse<Record<string, unknown>>> {
  const projectId = pathParam(params, 'projectId')
  const denied = guardProject(projectId)
  if (denied) return denied
  const key = request.headers.get('Idempotency-Key')
  if (!key) return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  const mergeRequestId = pathParam(params, 'mergeRequestId')
  const body = await jsonObject(request)
  const reason = body.reason
  if (!isNonEmptyString(reason)) return errorResponse(422, 'VALIDATION_FAILED', 'reason is required', 'reason')
  const fingerprint = `${decision}:${reason.trim()}`
  const recordKey = `${projectId}:${mergeRequestId}:${key}`
  const cached = cqIdempotency.get(recordKey)
  if (cached) {
    if (cached.fingerprint !== fingerprint) {
      return errorResponse(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for another request')
    }
    return response(cached.item)
  }
  const store = getStore(projectId, request)
  const item = store.mergeRequests.get(mergeRequestId)
  if (!item) return missing('Merge request')
  if (item.status !== 'OPEN') return errorResponse(409, 'MERGE_REQUEST_NOT_OPEN', 'Only an open MR can receive CQ')
  if (!item.headCommit) return errorResponse(409, 'REMOTE_NOT_VERIFIED', 'Source commit has not been verified on the remote')
  const completedAt = new Date().toISOString()
  const history = cqHistories.get(item.id) ?? []
  history.push({
    id: `cq-${item.id}-${history.length + 1}`,
    status: decision,
    commitSha: item.headCommit,
    reviewedByUserId: 'mock-reviewer',
    reviewedByName: 'Mock Reviewer',
    reason: reason.trim(),
    completedAt,
  })
  cqHistories.set(item.id, history)
  refreshQualityGate(item, projectId)
  const snapshot = structuredClone(item)
  cqIdempotency.set(recordKey, { fingerprint, item: snapshot })
  return response(item)
}

const taskModelMergeRequestHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/merge-requests', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const search = new URL(request.url).searchParams
    const repositoryId = search.get('repositoryId')
    const groupId = search.get('groupId')
    const status = search.get('status')
    const items = [...store.mergeRequests.values()].filter((item) =>
      (!repositoryId || item.repositoryId === repositoryId)
      && (!groupId || item.groupIds.includes(groupId))
      && (!status || item.status === status)
    )
    return page(items, request)
  }),

  http.get('*/api/projects/:projectId/merge-requests/:mergeRequestId/checks', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const item = store.mergeRequests.get(pathParam(params, 'mergeRequestId'))
    return item ? response(mergeRequestChecks(item, projectId)) : missing('Merge request')
  }),

  http.get('*/api/projects/:projectId/merge-requests/:mergeRequestId/reviews', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const item = store.mergeRequests.get(pathParam(params, 'mergeRequestId'))
    if (!item) return missing('Merge request')
    const history = [...(cqHistories.get(item.id) ?? [])].reverse()
    return response({
      items: history.map((entry) => ({
        id: entry.id,
        kind: 'CQ',
        decision: entry.status === 'PASSED' ? 'APPROVED' : 'REJECTED',
        reviewedByName: entry.reviewedByName,
        reviewedByUserId: entry.reviewedByUserId,
        reason: entry.reason,
        createdAt: entry.completedAt,
        commitSha: entry.commitSha,
      })),
    })
  }),

  http.get('*/api/projects/:projectId/merge-requests/:mergeRequestId/commits', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const mergeRequestId = pathParam(params, 'mergeRequestId')
    const item = store.mergeRequests.get(mergeRequestId)
    if (!item) return missing('Merge request')
    const search = new URL(request.url).searchParams
    const rawLimit = Number(search.get('limit') ?? '3')
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 3
    const all = store.mergeRequestCommits.get(mergeRequestId) ?? []
    return response({
      totalCount: all.length,
      items: all.slice(0, limit),
    })
  }),

  http.get('*/api/projects/:projectId/merge-requests/:mergeRequestId', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const item = store.mergeRequests.get(pathParam(params, 'mergeRequestId'))
    return item ? response(item) : missing('Merge request')
  }),

  http.post('*/api/projects/:projectId/merge-requests/:mergeRequestId/cq-approvals', ({ params, request }) => {
    return writeCqDecision(params, request, 'PASSED')
  }),

  http.post('*/api/projects/:projectId/merge-requests/:mergeRequestId/cq-rejections', ({ params, request }) => {
    return writeCqDecision(params, request, 'FAILED')
  }),

  http.post('*/api/projects/:projectId/merge-requests/:mergeRequestId/merge', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const item = store.mergeRequests.get(pathParam(params, 'mergeRequestId'))
    if (!item) return missing('Merge request')
    if (item.status !== 'OPEN') return errorResponse(409, 'MERGE_REQUEST_NOT_OPEN', 'Only an open MR can be merged')
    if (item.qualityGate?.status !== 'PASSED') {
      return errorResponse(409, 'QUALITY_GATE_NOT_PASSED', 'Quality gate has not passed')
    }
    item.status = 'MERGED'
    return response(item)
  }),

  http.post('*/api/projects/:projectId/merge-requests', async ({ params, request }) => {
    // 兼容期：旧接口 POST /merge-requests 已转为「申请预检」，
    // 不再直接创建真实 MR。新调用方请使用 POST /merge-requests/preflight。
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const body = await jsonObject(request)
    const taskId = body.taskId
    const repositoryId = body.repositoryId
    if (!isNonEmptyString(taskId) || !isNonEmptyString(repositoryId)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'taskId and repositoryId are required')
    }
    const task = findTask(store, taskId)
    if (!task) return missing('Task')
    const diff = [...store.diffs.values()].find(
      (item) => item.taskId === taskId && item.repositoryId === repositoryId && item.status === 'ACCEPTED',
    )
    const now = new Date().toISOString()
    const preflightId = `preflight-${projectId}-${repositoryId}-${Date.now().toString(36)}`
    const headCommit = diff?.headCommit ?? 'a1b2c3d4e5f6789012345678abcdef0123456789'
    const targetBranch = diff?.targetBranch ?? 'main'
    return response({
      id: preflightId,
      taskId,
      repositoryId,
      sourceBranch: diff?.sourceBranch ?? 'feat/demo',
      headCommit,
      targetBranch,
      targetCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'DRY_RUN_QUEUED',
      dryRunId: `dryrun-${projectId}-${preflightId}`,
      blockers: ['DRY_RUN_RUNNING'],
      failureCode: null,
      failureReason: null,
      coveredTaskIds: [taskId],
      coveredDiffIds: diff ? [diff.id] : [],
      branchLockStatus: 'UNLOCKED',
      isBranchLevel: true,
      mergeRequest: null,
      createdAt: now,
      updatedAt: now,
    }, 202)
  }),

  // ---------- MR 预检 (Preflight) 新接口 ----------

  http.post('*/api/projects/:projectId/merge-requests/preflight', async ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const body = await jsonObject(request)
    const taskId = body.taskId
    const repositoryId = body.repositoryId
    if (!isNonEmptyString(taskId) || !isNonEmptyString(repositoryId)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'taskId and repositoryId are required')
    }
    const task = findTask(store, taskId)
    if (!task) return missing('Task')
    const diff = [...store.diffs.values()].find(
      (item) => item.taskId === taskId && item.repositoryId === repositoryId && item.status === 'ACCEPTED',
    )
    // 模拟创建预检请求，返回不同状态
    const now = new Date().toISOString()
    const preflightId = `preflight-${projectId}-${repositoryId}-${Date.now().toString(36)}`

    // 根据占位 MR 的 createMode + 仓库决定预检返回值，覆盖两种流程：
    //  1) 自动（SYSTEM）：
    //     - auth-service → DRY_RUN_RUNNING（预检中，模拟 Dry Run 正在跑）
    //     - web-console  → CQ_REJECTED（预检失败）
    //     - shared-sdk   → MR_CREATED（SYSTEM 自动建 PR 成功）
    //  2) 人工（MANUAL）：
    //     - 首次申请 → 返回 WAITING_CQ（Dry Run 通过，等待用户在 CQ+1 页盖章）
    //     - 二次申请（用户已点「创建MR」按钮且 CQ 已通过） → MR_CREATED（真正创建 PR）
    const pendingMr = [...store.mergeRequests.values()].find(
      (item) => item.taskId === taskId && item.repositoryId === repositoryId && item.status === 'PENDING_CREATE',
    )
    const mode = pendingMr?.createMode ?? 'UNKNOWN'
    let preflightStatus: PreflightStatus
    if (mode === 'MANUAL') {
      // MANUAL 模式：用 store 级内存判断是否为「用户再次点击创建MR」的触发
      const dedupKey = `${taskId}::${repositoryId}`
      const seenKey = `preflight-manual-seen::${dedupKey}`
      if ((store as unknown as Record<string, boolean>)[seenKey]) {
        // 第二次调用（前端已经 WAITING_CQ，现在用户点了「创建MR」）→ 创建真实 PR
        preflightStatus = 'MR_CREATED'
      } else {
        // 第一次调用（用户点的是「申请MR」→ 启动预检，自动跑 Dry Run → 进入 WAITING_CQ）
        ; (store as unknown as Record<string, boolean>)[seenKey] = true
        preflightStatus = 'WAITING_CQ'
      }
    } else if (mode === 'SYSTEM') {
      if (repositoryId === 'bound-demo-web-console') preflightStatus = 'CQ_REJECTED'
      else if (repositoryId === 'bound-demo-auth-service') preflightStatus = 'DRY_RUN_RUNNING'
      else preflightStatus = 'MR_CREATED'
    } else {
      // UNKNOWN：保守返回 WAITING_CQ
      preflightStatus = 'WAITING_CQ'
    }
    const headCommit = diff?.headCommit ?? 'a1b2c3d4e5f6789012345678abcdef0123456789'
    const targetBranch = diff?.targetBranch ?? 'main'

    let mergeRequest: import('@/types/task-model').MergeRequestSummary | null = null
    if (preflightStatus === 'MR_CREATED') {
      // 模拟已创建真实 MR，后端在 GitHub 端建好了 PR
      const number = Math.floor(Math.random() * 100) + 10
      mergeRequest = {
        id: `mr-${projectId}-${repositoryId}-created`,
        repositoryId,
        groupIds: [],
        provider: 'GITHUB',
        number,
        title: `${diff?.sourceBranch ?? 'feat'} → ${targetBranch}`,
        description: null,
        sourceBranch: diff?.sourceBranch ?? 'feat/demo',
        targetBranch,
        status: 'OPEN',
        headCommit,
        webUrl: `https://github.com/mock/${projectId}/pull/${number}`,
        taskId,
        qualityGate: { status: 'PASSED', requiredChecks: ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'] },
        createMode: 'SYSTEM',
      }
      // 同步更新占位 MR 为真实 MR，这样刷新后列表直接显示 OPEN 状态
      const pendingExisting = [...store.mergeRequests.values()].find(
        (item) => item.repositoryId === repositoryId && item.status === 'PENDING_CREATE',
      )
      if (pendingExisting) {
        pendingExisting.status = 'OPEN'
        pendingExisting.number = number
        pendingExisting.webUrl = mergeRequest.webUrl
        pendingExisting.createMode = 'SYSTEM'
        pendingExisting.qualityGate = mergeRequest.qualityGate
      }
    }

    const failureMap: Partial<Record<string, { code: string; reason: string }>> = {
      CQ_REJECTED: { code: 'CQ_REJECTED', reason: 'CQ+1 被拒绝：需要补充单元测试覆盖新代码路径' },
    }
    const failure = failureMap[preflightStatus]

    return response({
      id: preflightId,
      taskId,
      repositoryId,
      sourceBranch: diff?.sourceBranch ?? 'feat/demo',
      headCommit,
      targetBranch,
      targetCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: preflightStatus,
      dryRunId: preflightStatus === 'CQ_REJECTED'
        ? null
        : `dryrun-${projectId}-${preflightId}`,
      blockers: preflightStatus === 'DRY_RUN_RUNNING' ? ['DRY_RUN_RUNNING'] : [],
      failureCode: failure?.code ?? null,
      failureReason: failure?.reason ?? null,
      coveredTaskIds: [taskId],
      coveredDiffIds: diff ? [diff.id] : [],
      branchLockStatus: preflightStatus === 'MR_CREATED' ? 'LOCKED' : 'UNLOCKED',
      isBranchLevel: true,
      mergeRequest,
      createdAt: now,
      updatedAt: now,
    }, 202)
  }),

  http.get('*/api/projects/:projectId/merge-requests/preflight/:preflightId', ({ params }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const preflightId = pathParam(params, 'preflightId')
    // 简单返回一个 WAITING_CQ 状态的预检
    return response({
      id: preflightId,
      taskId: 'mock-task-001',
      repositoryId: 'bound-demo-auth-service',
      sourceBranch: 'feat/demo',
      headCommit: 'a1b2c3d4e5f6789012345678abcdef0123456789',
      targetBranch: 'main',
      targetCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'WAITING_CQ',
      dryRunId: `dryrun-${projectId}-${preflightId}`,
      blockers: [],
      failureCode: null,
      failureReason: null,
      coveredTaskIds: ['mock-task-001'],
      coveredDiffIds: [],
      branchLockStatus: 'UNLOCKED',
      isBranchLevel: true,
      mergeRequest: null,
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:05:00Z',
    })
  }),

  http.get('*/api/projects/:projectId/tasks/:taskId/merge-request-preflight', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const taskId = pathParam(params, 'taskId')
    const task = findTask(store, taskId)
    if (!task) return missing('Task')
    // 默认返回空列表（未启动预检）。实际环境中此接口会返回已启动的预检状态。
    // 前端点击「创建」后会通过 POST /merge-requests/preflight 启动预检，
    // 状态变化由前端 preflightStatusMap 跟踪，刷新后再次查询即可恢复。
    return response({
      taskId,
      items: [],
      totalCount: 0,
    })
  }),

  http.get('*/api/projects/:projectId/tasks/:taskId/repositories/:repositoryId/preflight', ({ params, request }) => {
    const projectId = pathParam(params, 'projectId')
    const denied = guardProject(projectId)
    if (denied) return denied
    const store = getStore(projectId, request)
    const taskId = pathParam(params, 'taskId')
    const repositoryId = pathParam(params, 'repositoryId')
    const targetBranch = new URL(request.url).searchParams.get('targetBranch') ?? 'main'
    if (!findTask(store, taskId)) return missing('Task')
    const diff = [...store.diffs.values()].find(
      (item) => item.taskId === taskId && item.repositoryId === repositoryId,
    )
    const sourceCommit = diff?.headCommit ?? 'a1b2c3d4e5f6789012345678abcdef0123456789'
    const targetCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    // 根据仓库 ID 返回不同的 CQ+1 状态：
    // - bound-demo-auth-service (SYSTEM 预检中): CQ+1 APPROVED
    // - bound-demo-web-console (SYSTEM 预检失败): CQ+1 REJECTED
    // - bound-demo-shared-sdk (MANUAL): CQ+1 APPROVED（以便在前端验证：
    //   手动申请MR → 后端返回 WAITING_CQ + CQ APPROVED → 前端派生 READY_CREATE
    //   → 显示「创建MR」按钮 → 点击后才真正创建 PR）
    const cqStatusMap: Record<string, 'APPROVED' | 'REJECTED' | 'PENDING'> = {
      'bound-demo-auth-service': 'APPROVED',
      'bound-demo-web-console': 'REJECTED',
      'bound-demo-shared-sdk': 'APPROVED',
    }
    const cqStatus = cqStatusMap[repositoryId] ?? 'APPROVED'

    return response({
      taskId,
      repositoryId,
      targetBranch,
      sourceCommit,
      targetCommit,
      status: 'PASSED',
      blockers: [],
      dryRun: { id: `dryrun-${projectId}-preflight`, status: 'PASSED', sourceCommit, targetCommit },
      cqPlusOne: {
        status: cqStatus,
        reviewerUserId: cqStatus === 'PENDING' ? null : 'mock-reviewer',
        reviewerName: cqStatus === 'PENDING' ? null : 'Mock Reviewer',
        reason: cqStatus === 'REJECTED' ? '代码质量不达标，需要补充单元测试' : 'looks good',
        reviewedAt: cqStatus === 'PENDING' ? null : '2026-08-15T02:10:00Z',
      },
    })
  }),
]

const taskModelRepositoryHandlers: HttpHandler[] = [
  http.get('*/api/projects/:projectId/repositories', ({ params }) => {
    const projectId = pathParam(params, 'projectId')
    const repository = {
      id: `bound-${projectId}-repository-1`,
      installationId: 'mock-installation-1',
      repositoryId: `repository-${projectId}`,
      providerRepositoryId: 1,
      fullName: `mock/${projectId}`,
      githubUrl: `https://github.com/mock/${projectId}`,
      displayName: projectId,
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED' as const,
      metadataSyncedAt: '2026-08-10T12:00:00Z',
      boundAt: '2026-08-10T12:00:00Z',
      boundProjectId: projectId,
      boundProjectName: projectId,
      syncStatus: 'SYNCED' as const,
      lastSyncedAt: '2026-08-10T12:00:00Z',
    }
    return response([repository])
  }),
]

export const taskModelHandlers: HttpHandler[] = [
  ...taskModelRepositoryHandlers,
  ...taskArtifactAndDiffReviewHandlers,
  ...taskModelTaskHandlers,
  ...taskModelTaskRunHandlers,
  ...taskModelDiffHandlers,
  ...taskModelMergeRequestHandlers,
]
