import { setupServer } from 'msw/node'
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { diffsApi, mergeRequestsApi, taskRunsApi, tasksApi } from '@/api/taskModel'
import type { TaskRunDetail } from '@/types/task-model'
import { resetTaskModelStore, taskModelHandlers } from './handlers'

const server = setupServer(...taskModelHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  server.resetHandlers()
  resetTaskModelStore()
})

describe('independent Task model mock chain', () => {
  it('serves a project repository through the same /api MSW chain used by TaskTriggerModal', async () => {
    const response = await fetch('/api/projects/project-repositories/repositories')
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Array<{ boundProjectId: string; repositoryId: string }> }
    expect(payload.data[0]?.boundProjectId).toBe('project-repositories')
    expect(payload.data[0]?.repositoryId).toBe('repository-project-repositories')
  })

  it('creates a PLANNING Task before the Planner produces actual TaskSteps', async () => {
    const task = await tasksApi.create('project-create', {
      requirementGroupId: 'group-create',
      title: 'Create task',
      requirement: 'Create a complete resource chain',
      repositoryIds: ['repository-create'],
      baseRef: 'main',
    })
    expect((await tasksApi.get('project-create', task.id)).id).toBe(task.id)
    expect(task.status).toBe('PLANNING')
    const steps = await tasksApi.listSteps('project-create', task.id)
    expect(steps.data).toEqual([])
    const runs = await taskRunsApi.list('project-create', task.id)
    expect(runs.data).toEqual([])
    const firstStepPage = await tasksApi.listSteps('project-create', task.id, { limit: 1 })
    expect(firstStepPage.page.hasMore).toBe(false)
    expect(firstStepPage.page.nextCursor).toBeNull()
  })

  it('returns formal Task attention associations without inference fields', async () => {
    const main = await tasksApi.get('project-attention', 'task-project-attention-main')
    expect(main.attention).toMatchObject({ kind: 'INPUT_REQUIRED', taskRunId: 'run-step-task-project-attention-main-developer', inputRequestId: 'input-run-step-task-project-attention-main-developer', diffReviewBatchId: null, repositoryId: null })
    const waiting = await tasksApi.get('project-attention', 'task-project-attention-waiting_diff_confirmation')
    expect(waiting.attention).toMatchObject({ kind: 'DIFF_CONFIRMATION_REQUIRED', diffReviewBatchId: 'review-task-project-attention-waiting_diff_confirmation', repositoryId: 'repository-project-attention' })
  })

  it('keeps a newly-created Task in the planning boundary until the Planner creates resources', async () => {
    const projectId = 'project-e2e'
    const task = await tasksApi.create(projectId, {
      requirementGroupId: 'group-e2e',
      title: 'End-to-end Task',
      requirement: 'Verify the complete Task model chain',
      repositoryIds: ['repository-e2e'],
      baseRef: 'main',
    })
    const fetchedTask = await tasksApi.get(projectId, task.id)
    const listedTasks = await tasksApi.list(projectId)
    const steps = (await tasksApi.listSteps(projectId, task.id)).data
    const runs = (await taskRunsApi.list(projectId, task.id)).data
    expect(fetchedTask.id).toBe(task.id)
    expect(listedTasks.data.some((item) => item.id === task.id)).toBe(true)
    expect(fetchedTask.status).toBe('PLANNING')
    expect(steps).toEqual([])
    expect(runs).toEqual([])
    expect((await diffsApi.list(projectId, { taskId: task.id })).data).toEqual([])

    expect((await tasksApi.cancel(projectId, task.id)).status).toBe('CANCELLED')
    expect((await tasksApi.get(projectId, task.id)).status).toBe('CANCELLED')
  })

  it('seeds Code page diffs so feat/login-api can open Diff review', async () => {
    const diffs = await diffsApi.list('demo-project')
    const login = diffs.data.find(
      (diff) =>
        diff.repositoryId === 'bound-demo-auth-service' && diff.sourceBranch === 'feat/login-api',
    )
    expect(login?.id).toBe('diff-demo-project-login-api')
    const detail = await diffsApi.get('demo-project', login!.id)
    expect(detail.sourceBranch).toBe('feat/login-api')
  })

  it('validates required Task fields and rejects unsupported creation fields', async () => {
    await expect(tasksApi.create('project-validation', {
      requirementGroupId: '',
      title: 'Invalid task',
      requirement: 'Missing group',
      repositoryIds: ['repository-validation'],
      baseRef: 'main',
    })).rejects.toMatchObject({ status: 422 })
    const unsupportedInput = {
      requirementGroupId: 'group-validation',
      title: 'Invalid task',
      requirement: 'Retired workflow fields are forbidden',
      repositoryIds: ['repository-validation'],
      baseRef: 'main',
      unsupportedField: 'unsupported',
    } as Parameters<typeof tasksApi.create>[1]
    await expect(tasksApi.create('project-validation', unsupportedInput)).rejects.toMatchObject({ status: 422 })
  })

  it('supports Task filters and cursor pagination', async () => {
    const first = await tasksApi.list('project-list', { status: 'PLANNING', limit: 1 })
    expect(first.data).toHaveLength(1)
    expect(first.page.hasMore).toBe(false)
    const filtered = await tasksApi.list('project-list', { groupId: 'group-project-list-requirements', createdBy: 'user-1' })
    expect(filtered.data.every((task) => task.requirementGroup?.id === 'group-project-list-requirements' && task.createdByUser?.id === 'user-1')).toBe(true)

    const paged = await tasksApi.list('project-list', { limit: 2 })
    expect(paged.data).toHaveLength(2)
    expect(paged.page.nextCursor).toBe('2')
    const next = await tasksApi.list('project-list', { cursor: paged.page.nextCursor ?? undefined, limit: 2 })
    expect(next.data[0]?.id).not.toBe(paged.data[0]?.id)
  })

  it('applies the Task cancel state matrix', async () => {
    const planning = await tasksApi.get('project-cancel', 'task-project-cancel-planning')
    expect((await tasksApi.cancel('project-cancel', planning.id)).status).toBe('CANCELLED')
    const running = await tasksApi.get('project-cancel', 'task-project-cancel-running')
    expect((await tasksApi.cancel('project-cancel', running.id)).status).toBe('CANCELLING')
    await expect(tasksApi.cancel('project-cancel', 'task-project-cancel-succeeded')).rejects.toMatchObject({ status: 409 })
  })

  it('keeps TaskRun list summaries separate from optional detail steps', async () => {
    const list = await taskRunsApi.list('project-runs', 'task-project-runs-pending')
    expect(list.data[0]).toMatchObject({ taskId: 'task-project-runs-pending', status: 'QUEUED' })
    expect(list.data[0]).toHaveProperty('startedAt')
    const detail = await taskRunsApi.get('project-runs', 'run-project-runs-queued')
    expect(detail).toHaveProperty('steps')
    const detailed = await taskRunsApi.get('project-runs', 'run-project-runs-running')
    expect((detailed as TaskRunDetail).steps).toBeDefined()
    expect(detailed.durationMs).toEqual(null)
  })

  it('creates a new retry run without mutating the failed original', async () => {
    const original = await taskRunsApi.get('project-retry', 'run-project-retry-failed')
    const retry = await taskRunsApi.retry('project-retry', original.id)
    expect(retry.id).not.toBe(original.id)
    expect(retry.retryOfTaskRunId).toBe(original.id)
    expect(retry.status).toBe('QUEUED')
    expect((await taskRunsApi.get('project-retry', original.id)).status).toBe('FAILED')
    await expect(taskRunsApi.retry('project-retry', 'run-project-retry-running')).rejects.toMatchObject({ status: 409 })
  })

  it('uses the TaskRun cancel transition and rejects terminal runs', async () => {
    const queued = await taskRunsApi.cancel('project-run-cancel', 'run-project-run-cancel-queued')
    expect(queued.status).toBe('CANCELLING')
    await expect(taskRunsApi.cancel('project-run-cancel', 'run-project-run-cancel-succeeded')).rejects.toMatchObject({ status: 409 })
  })

  it('handles InputRequest reply, approval, and rejection', async () => {
    const input = await taskRunsApi.inputRequests('project-input', 'run-project-input-waiting_input')
    const answered = await taskRunsApi.replyInputRequest('project-input', 'run-project-input-waiting_input', input.data[0]!.id, { answer: { value: 'main' } })
    expect(answered.status).toBe('ANSWERED')
    const approval = await taskRunsApi.inputRequests('project-input', 'run-project-input-waiting_approval')
    const approved = await taskRunsApi.approveInputRequest('project-input', 'run-project-input-waiting_approval', approval.data[0]!.id, { reason: 'Approved' })
    expect(approved.status).toBe('APPROVED')
    resetTaskModelStore()
    const rejectionInput = await taskRunsApi.inputRequests('project-input', 'run-project-input-waiting_approval')
    const rejected = await taskRunsApi.rejectInputRequest('project-input', 'run-project-input-waiting_approval', rejectionInput.data[0]!.id, { reason: 'Rejected for test coverage' })
    expect(rejected.status).toBe('REJECTED')
    await expect(taskRunsApi.rejectInputRequest('project-input', 'run-project-input-waiting_approval', rejectionInput.data[0]!.id, { reason: 'Duplicate' })).rejects.toMatchObject({ status: 409 })
  })

  it('queries and transitions Diff resources', async () => {
    const list = await diffsApi.list('project-diff', { taskId: 'task-project-diff-main' })
    expect(list.data).toHaveLength(3)
    const pending = list.data.find((diff) => diff.status === 'PENDING_REVIEW')!
    const accepted = await diffsApi.accept('project-diff', pending.id)
    expect(accepted.status).toBe('ACCEPTED')
    await expect(diffsApi.accept('project-diff', pending.id)).rejects.toMatchObject({ status: 409 })
    const rejected = list.data.find((diff) => diff.status === 'REJECTED')!
    await expect(diffsApi.reject('project-diff', rejected.id, { reason: 'Again' })).rejects.toMatchObject({ status: 409 })
  })

  it('serves Task artifacts in sequence order and enforces task Diff review transitions', async () => {
    const projectId = 'project-review'
    const taskId = 'task-project-review-waiting_diff_confirmation'
    const artifacts = await fetch(`/api/projects/${projectId}/tasks/${taskId}/artifacts`).then((response) => response.json()) as { data: Array<{ sequenceNo: number; taskRunId: string | null }> }
    expect(artifacts.data.map((artifact) => artifact.sequenceNo)).toEqual([1, 2, 3])
    expect(artifacts.data[0]?.taskRunId).toBeNull()
    expect(artifacts.data.slice(1).every((artifact) => artifact.taskRunId)).toBe(true)

    const batch = await tasksApi.diffReview(projectId, taskId)
    expect(batch).toMatchObject({ taskId, reviewStatus: 'PENDING_CONFIRMATION', confirmationSource: 'USER', deliveryStatus: 'NOT_STARTED' })
    const diffId = batch.diffs[0]!.id
    await expect(diffsApi.accept(projectId, diffId)).rejects.toMatchObject({ status: 409 })
    const confirmed = await tasksApi.confirmDiffReview(projectId, taskId)
    expect(confirmed).toMatchObject({ reviewStatus: 'ACCEPTED', deliveryStatus: 'DELIVERING' })
    expect((await tasksApi.get(projectId, taskId)).status).toBe('DELIVERING')
    await expect(tasksApi.confirmDiffReview(projectId, taskId)).rejects.toMatchObject({ status: 409 })
  })

  it('supports rejection reason validation and retrying failed delivery', async () => {
    const projectId = 'project-review'
    const rejectedTaskId = 'task-project-review-waiting_diff_confirmation'
    await expect(tasksApi.rejectDiffReview(projectId, rejectedTaskId, { reason: '   ' })).rejects.toMatchObject({ status: 400 })

    const rejected = await tasksApi.rejectDiffReview(projectId, rejectedTaskId, { reason: '  Needs another review  ' })
    expect(rejected.reviewReason).toBe('Needs another review')
    expect((await tasksApi.get(projectId, rejectedTaskId)).status).toBe('FAILED')

    const failedTaskId = 'task-project-review-delivery_failed'
    const failedArtifacts = await tasksApi.artifacts(projectId, failedTaskId)
    expect(failedArtifacts.filter((artifact) => artifact.artifactType !== 'PLAN').every((artifact) => artifact.taskRunId)).toBe(true)
    const failed = await tasksApi.diffReview(projectId, failedTaskId)
    expect(failed).toMatchObject({ reviewStatus: 'ACCEPTED', deliveryStatus: 'FAILED' })
    const retried = await tasksApi.retryDiffReviewDelivery(projectId, failedTaskId)
    expect(retried.deliveryStatus).toBe('DELIVERED')
    expect((await tasksApi.get(projectId, failedTaskId)).status).toBe('SUCCEEDED')
    await expect(tasksApi.retryDiffReviewDelivery(projectId, failedTaskId)).rejects.toMatchObject({ status: 409 })
  })

  it('keeps an in-flight delivery batch readable after Task refresh', async () => {
    const projectId = 'project-review'
    const taskId = 'task-project-review-delivering'
    expect((await tasksApi.get(projectId, taskId)).status).toBe('DELIVERING')
    expect(await tasksApi.diffReview(projectId, taskId)).toMatchObject({ reviewStatus: 'ACCEPTED', confirmationSource: 'SYSTEM', deliveryStatus: 'DELIVERING' })
  })

  it('walks the v1.3 Artifact and DiffReview resources by returned IDs', async () => {
    const projectId = 'project-v13-chain'
    const tasks = (await tasksApi.list(projectId)).data
    const waitingTask = tasks.find((task) => task.status === 'WAITING_DIFF_CONFIRMATION')
    const failedTask = tasks.find((task) => task.status === 'DELIVERY_FAILED')
    expect(waitingTask).toBeDefined()
    expect(failedTask).toBeDefined()
    if (!waitingTask || !failedTask) return

    const artifacts = await tasksApi.artifacts(projectId, waitingTask.id)
    expect(artifacts).toEqual([...artifacts].sort((left, right) => left.sequenceNo - right.sequenceNo))
    const pendingBatch = await tasksApi.diffReview(projectId, waitingTask.id)
    expect(pendingBatch.taskId).toBe(waitingTask.id)
    const confirmedBatch = await tasksApi.confirmDiffReview(projectId, pendingBatch.taskId)
    expect(confirmedBatch.deliveryStatus).toBe('DELIVERING')

    const failedBatch = await tasksApi.diffReview(projectId, failedTask.id)
    expect(failedBatch.reviewStatus).toBe('ACCEPTED')
    expect(failedBatch.deliveryStatus).toBe('FAILED')
    const deliveredBatch = await tasksApi.retryDiffReviewDelivery(projectId, failedBatch.taskId)
    expect(deliveredBatch.deliveryStatus).toBe('DELIVERED')
    expect((await tasksApi.diffReview(projectId, deliveredBatch.taskId)).deliveryStatus).toBe('DELIVERED')
  })

  it('returns the documented no-batch error and requires Idempotency-Key', async () => {
    await expect(tasksApi.diffReview('project-review', 'task-project-review-main')).rejects.toMatchObject({ status: 404 })
    const response = await fetch('/api/projects/project-review/tasks/task-project-review-waiting_diff_confirmation/diff-review/confirm', { method: 'POST' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } })
  })

  it('replays a Diff review mutation for the same key and rejects reuse for another operation', async () => {
    const url = '/api/projects/project-idempotency/tasks/task-project-idempotency-waiting_diff_confirmation/diff-review/confirm'
    const first = await fetch(url, { method: 'POST', headers: { 'Idempotency-Key': 'same-key' } })
    const replay = await fetch(url, { method: 'POST', headers: { 'Idempotency-Key': 'same-key' } })
    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(await first.clone().json())

    const retry = await fetch('/api/projects/project-idempotency/tasks/task-project-idempotency-waiting_diff_confirmation/diff-review/retry-delivery', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'same-key' },
    })
    expect(retry.status).toBe(409)
    expect(await retry.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
  })

  it('isolates resources by project and supports an empty scenario', async () => {
    const projectA = await tasksApi.list('project-a')
    const projectB = await tasksApi.list('project-b')
    expect(projectA.data.every((task) => task.projectId === 'project-a')).toBe(true)
    expect(projectB.data.every((task) => task.projectId === 'project-b')).toBe(true)
    await expect(tasksApi.get('project-b', projectA.data[0]!.id)).rejects.toMatchObject({ status: 404 })

    const emptyResponse = await fetch('/api/projects/project-empty/tasks?scenario=EMPTY')
    const emptyBody = await emptyResponse.json() as { data: unknown[] }
    expect(emptyBody.data).toEqual([])
  })

  it('returns the documented 403, 404, 409, and 422 classes', async () => {
    await expect(tasksApi.list('forbidden')).rejects.toMatchObject({ status: 403 })
    await expect(tasksApi.get('project-errors', 'missing-task')).rejects.toMatchObject({ status: 404 })
    await expect(diffsApi.reject('project-errors', 'diff-project-errors-pending', { reason: '' })).rejects.toMatchObject({ status: 422 })
    await expect(tasksApi.cancel('project-errors', 'task-project-errors-succeeded')).rejects.toMatchObject({ status: 409 })
  })

  it('resets all Task model resources between tests', async () => {
    await tasksApi.create('project-reset', {
      requirementGroupId: 'group-reset',
      title: 'Reset me',
      requirement: 'Temporary data',
      repositoryIds: ['repository-reset'],
      baseRef: 'main',
    })
    resetTaskModelStore()
    const tasks = await tasksApi.list('project-reset', { groupId: 'group-reset' })
    expect(tasks.data).toEqual([])
  })

  it('does not make a newly-created planning Task eligible for an MR', async () => {
    const projectId = 'project-create-mr'
    const task = await tasksApi.create(projectId, {
      requirementGroupId: 'group-create-mr',
      title: '实现邮箱登录',
      requirement: 'Support email login',
      repositoryIds: ['repository-create-mr'],
      baseRef: 'main',
    })
    expect((await diffsApi.list(projectId, { taskId: task.id })).data).toEqual([])
    await expect(mergeRequestsApi.create(projectId, {
      taskId: task.id,
      repositoryId: 'repository-create-mr',
      targetBranch: 'main',
      title: '实现邮箱登录',
    })).rejects.toMatchObject({ status: 409 })
  })

  it('lists merge requests and applies repository and status filters', async () => {
    const listed = await mergeRequestsApi.list('demo-project')
    expect(listed.data.length).toBeGreaterThan(0)
    expect(listed.data.every((item) => item.number > 0 && item.sourceBranch && item.repositoryId)).toBe(true)
    const open = await mergeRequestsApi.list('demo-project', { status: 'OPEN' })
    expect(open.data.length).toBeGreaterThan(0)
    expect(open.data.every((item) => item.status === 'OPEN')).toBe(true)
    const byRepo = await mergeRequestsApi.list('demo-project', { repositoryId: 'bound-demo-auth-service' })
    expect(byRepo.data.every((item) => item.repositoryId === 'bound-demo-auth-service')).toBe(true)
  })

  it('returns MR detail and checks, and rejects merge until the quality gate passes', async () => {
    const listed = await mergeRequestsApi.list('demo-project')
    const pending = listed.data.find((item) => item.qualityGate?.status === 'PENDING')
    const ready = listed.data.find((item) => item.status === 'OPEN' && item.qualityGate?.status === 'PASSED')
    expect(pending).toBeDefined()
    expect(ready).toBeDefined()

    const detail = await mergeRequestsApi.get('demo-project', pending!.id)
    expect(detail.id).toBe(pending!.id)
    const checks = await mergeRequestsApi.checks('demo-project', pending!.id)
    expect(checks.map((item) => item.type)).toEqual(['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'])
    expect(checks.every((item) => item.status === 'PENDING' || item.status === 'PASSED' || item.status === 'FAILED')).toBe(true)

    await expect(mergeRequestsApi.merge('demo-project', pending!.id)).rejects.toMatchObject({ status: 409 })
    const merged = await mergeRequestsApi.merge('demo-project', ready!.id)
    expect(merged.status).toBe('MERGED')
    await expect(mergeRequestsApi.merge('demo-project', ready!.id)).rejects.toMatchObject({ status: 409 })
    await expect(mergeRequestsApi.get('demo-project', 'missing-mr')).rejects.toMatchObject({ status: 404 })
  })

  it('stamps CQ+1 without passing the overall gate while AI Review is still pending', async () => {
    const listed = await mergeRequestsApi.list('demo-project')
    const pending = listed.data.find((item) => item.qualityGate?.status === 'PENDING')
    expect(pending).toBeDefined()

    const missingKey = await fetch(`/api/projects/demo-project/merge-requests/${pending!.id}/cq-approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'LGTM' }),
    })
    expect(missingKey.status).toBe(400)

    await expect(mergeRequestsApi.approveCq('demo-project', pending!.id, { reason: '   ' })).rejects.toMatchObject({
      status: 422,
    })

    const approved = await mergeRequestsApi.approveCq('demo-project', pending!.id, { reason: 'LGTM' })
    expect(approved.qualityGate?.status).toBe('PENDING')
    const checks = await mergeRequestsApi.checks('demo-project', pending!.id)
    const cq = checks.find((item) => item.type === 'CQ_PLUS_ONE')
    expect(cq?.status).toBe('PASSED')
    expect(cq?.reviewedByName).toBe('Mock Reviewer')
    expect(cq?.reviewReason).toBe('LGTM')
    expect(cq?.commitSha).toBe(pending!.headCommit)
    expect(checks.find((item) => item.type === 'AI_REVIEW')?.status).toBe('PENDING')
    await expect(mergeRequestsApi.merge('demo-project', pending!.id)).rejects.toMatchObject({ status: 409 })
  })

  it('rejects CQ and marks the quality gate failed', async () => {
    const listed = await mergeRequestsApi.list('demo-project')
    const pending = listed.data.find((item) => item.qualityGate?.status === 'PENDING')
    expect(pending).toBeDefined()
    const rejected = await mergeRequestsApi.rejectCq('demo-project', pending!.id, { reason: 'needs tests' })
    expect(rejected.qualityGate?.status).toBe('FAILED')
    const checks = await mergeRequestsApi.checks('demo-project', pending!.id)
    expect(checks.find((item) => item.type === 'CQ_PLUS_ONE')?.status).toBe('FAILED')
    expect(checks.find((item) => item.type === 'CQ_PLUS_ONE')?.reviewReason).toBe('needs tests')
  })

  it('returns CQ review history after approvals and rejections', async () => {
    const listed = await mergeRequestsApi.list('demo-project')
    const pending = listed.data.find((item) => item.qualityGate?.status === 'PENDING')
    expect(pending).toBeDefined()
    expect(await mergeRequestsApi.reviews('demo-project', pending!.id)).toEqual([])
    await mergeRequestsApi.approveCq('demo-project', pending!.id, { reason: 'first look' })
    await mergeRequestsApi.rejectCq('demo-project', pending!.id, { reason: 'needs tests' })
    const history = await mergeRequestsApi.reviews('demo-project', pending!.id)
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      decision: 'REJECTED',
      reviewerName: 'Mock Reviewer',
      reason: 'needs tests',
    })
    expect(history[1]).toMatchObject({
      decision: 'APPROVED',
      reviewerName: 'Mock Reviewer',
      reason: 'first look',
    })
  })

  it('lists provisional MR commits with totalCount and limit', async () => {
    const listed = await mergeRequestsApi.list('demo-project')
    const pending = listed.data.find((item) => item.qualityGate?.status === 'PENDING')
    expect(pending).toBeDefined()
    const preview = await mergeRequestsApi.commits('demo-project', pending!.id, 2)
    expect(preview.totalCount).toBe(3)
    expect(preview.items).toHaveLength(2)
    expect(preview.items[0]).toMatchObject({
      sha: expect.stringMatching(/^a81f3c2/),
      message: 'feat(login): 实现登录接口与 JWT 鉴权',
      authorName: '陈同学',
    })
    const all = await mergeRequestsApi.commits('demo-project', pending!.id, 100)
    expect(all.items).toHaveLength(3)
    expect(all.items.map((item) => item.authorName)).toEqual(['陈同学', '李同学', '张同学'])
  })
})
