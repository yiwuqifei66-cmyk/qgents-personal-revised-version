import type { DiffDetail, ExecutionContext, InputRequest, Task, TaskArtifact, TaskAttention, TaskRunDetail, TaskRunLog, TaskRunStep, TaskStatus, TaskStep, TaskStepRole, DiffReviewBatch } from '@/types/task-model'
import { defaultMockDiffFiles, loginApiDiffComments, loginApiDiffFiles } from './diffFileFixtures'
import { createTaskModelStore, type TaskModelStore } from './store'
const timestamp = '2026-08-12T08:00:00Z'; const laterTimestamp = '2026-08-12T08:01:00Z'
const taskStatuses: readonly TaskStatus[] = ['PLANNING', 'PENDING', 'RUNNING', 'WAITING_DIFF_CONFIRMATION', 'WAITING_PREFLIGHT', 'DIFF_REJECTED', 'DELIVERING', 'DELIVERY_FAILED', 'SUCCEEDED', 'FAILED', 'CANCELLING', 'CANCELLED']
function attention(value: Omit<TaskAttention, 'createdAt'>): TaskAttention { return { ...value, createdAt: laterTimestamp } }
function repo(projectId: string, id: string, status: TaskStatus) { return { repositoryId: `repository-${projectId}`, name: 'Mock repository', fullName: `qgents/${projectId}`, provider: 'GITHUB', defaultBranch: 'main', baseRef: 'main', baseCommit: 'base-commit-1', sourceBranch: `feat/${id}`, headCommit: status === 'SUCCEEDED' ? `head-${id}` : null } }
function task(projectId: string, id: string, status: TaskStatus, index: number): Task { const repositories = [repo(projectId, id, status)]; return { id, displayCode: `T-${index + 1000}`, projectId, title: `Task ${index + 1}`, requirementSummary: `Requirement for ${id}`, status, deliveryMode: 'DIFF_FIRST', deliveryReason: 'Mock 默认采用总 Diff 确认', requirementGroup: { id: `group-${projectId}-requirements`, name: 'Requirements', status: 'ACTIVE' }, createdByUser: { id: 'user-1', displayName: 'Mock User', avatarUrl: null }, repositories, executionSummary: { totalSteps: 0, pendingSteps: 0, runningSteps: 0, waitingSteps: 0, blockedSteps: 0, succeededSteps: 0, failedSteps: 0, currentStage: null, currentStageTitle: null, requiresUserAction: false }, attention: null, statusReason: null, createdAt: timestamp, updatedAt: laterTimestamp, requirement: `Requirement for ${id}`, acceptanceCriteria: [], workspace: { id: `workspace-${id}`, status: 'READY', repositories }, capabilities: { canCancel: status === 'RUNNING', canReplacePendingStepAgent: false, canConfirmDiffReview: false, canRejectDiffReview: false, canRetryDelivery: status === 'DELIVERY_FAILED' }, artifactSummary: { total: 0, byType: {} }, diffReviewSummary: { available: false, diffId: null, reviewStatus: null, deliveryStatus: null, repositoryCount: 0, filesChanged: 0, additions: 0, deletions: 0 }, sourceMessage: null, triggerMessageId: null } }
function step(value: Task, id: string, role: TaskStepRole, dependencies: string[]): TaskStep { const r = value.repositories[0]; return { id, taskId: value.id, sequenceNo: dependencies.length + 1, title: role, description: null, role, agent: null, repository: r ? { repositoryId: r.repositoryId, name: r.name, sourceBranch: r.sourceBranch } : null, dependencies, status: 'PENDING', acceptanceNotes: null, latestRun: null, runCount: 0, startedAt: null, finishedAt: null, createdAt: timestamp, updatedAt: laterTimestamp } }
function runReason(status: TaskRunDetail['status']): TaskRunDetail['statusReason'] { const definitions = { WAITING_INPUT: ['INPUT_REQUIRED', '等待用户输入', '等待用户补充输入', true], WAITING_APPROVAL: ['APPROVAL_REQUIRED', '等待审批', '等待用户审批', false], BLOCKED: ['BLOCKED', '执行阻塞', '执行被阻塞', true], FAILED: ['EXECUTION_FAILED', '执行失败', '执行失败，可重试', true], CANCELLED: ['CANCELLED', '已取消', '运行已取消', false] } as const; const value = definitions[status as keyof typeof definitions]; return value ? { code: value[0], title: value[1], summary: value[2], retryable: value[3], occurredAt: laterTimestamp } : null }
function run(value: Task, s: TaskStep, status: TaskRunDetail['status']): TaskRunDetail { const startedAt = status === 'QUEUED' ? null : timestamp; const statusReason = runReason(status); return { id: `run-${s.id}`, taskId: value.id, taskStepId: s.id, taskStepTitle: s.title, agent: null, role: s.role, status, retryOfTaskRunId: null, statusSummary: statusReason?.summary ?? null, statusReason, startedAt, finishedAt: status === 'SUCCEEDED' ? laterTimestamp : null, durationMs: status === 'SUCCEEDED' ? 60000 : null, artifactSummary: { total: 0, diffCount: 0 }, createdAt: timestamp, updatedAt: laterTimestamp, steps: [] } }
function resources(store: TaskModelStore, r: TaskRunDetail) { const log: TaskRunLog = { id: `log-${r.id}`, sequence: 1, node: r.role, content: `${r.role} started`, timestamp, entryType: 'EXECUTION' }; store.taskRunLogs.set(r.id, [log]); const context: ExecutionContext = { workspaceId: `workspace-${r.taskId}`, sandboxStatus: 'RUNNING', repositoryId: 'repository-mock', baseRef: 'main', headRef: `feat/${r.taskId}`, startedAt: r.startedAt, expiresAt: null }; store.executionContexts.set(r.id, context); const stepValue: TaskRunStep = { node: r.role, status: r.status === 'SUCCEEDED' ? 'PASSED' : 'PENDING', startedAt: r.startedAt, finishedAt: r.finishedAt, durationMs: r.durationMs }; store.taskRunSteps.set(r.id, [stepValue]) }
function input(store: TaskModelStore, r: TaskRunDetail, kind: InputRequest['kind']) { store.inputRequests.set(`input-${r.id}`, { id: `input-${r.id}`, taskRunId: r.id, kind, status: 'PENDING', prompt: kind === 'INPUT' ? 'Choose a base branch' : 'Approve the run', options: kind === 'INPUT' ? [{ value: 'main', label: 'main' }] : undefined, createdAt: timestamp }) }
export function addDiff(store: TaskModelStore, value: Task, s: TaskStep, status: DiffDetail['status'], suffix: string): DiffDetail { const d: DiffDetail = { id: `diff-${value.projectId}-${suffix}`, projectId: value.projectId, taskId: value.id, taskRunId: `run-${s.id}`, taskStepId: s.id, requirementGroupId: value.requirementGroup?.id ?? '', workspaceId: value.workspace?.id ?? '', repositoryId: value.repositories[0]?.repositoryId ?? '', baseCommit: 'base-commit-1', sourceBranch: s.repository?.sourceBranch ?? 'main', headCommit: status === 'PENDING_REVIEW' ? null : `head-${value.id}`, status, changeStats: { files: 2, additions: 10, deletions: 2 }, createdAt: timestamp, workingTreeHash: null, snapshotKey: null, reviewedBy: null, reviewReason: null, reviewedAt: null, updatedAt: laterTimestamp }; store.diffs.set(d.id, d); store.diffFiles.set(d.id, defaultMockDiffFiles()); return d }

export function seedCodeBranchDiffs(store: TaskModelStore, projectId: string): void {
  if (projectId !== 'demo-project' && projectId !== 'proj-001') return
  const main = [...store.tasks.values()].find((task) => task.id === `task-${projectId}-main`)
  if (!main) return
  const developer = [...store.taskSteps.values()].find((step) => step.taskId === main.id && step.role === 'DEVELOPER')
  if (!developer) return
  const files = loginApiDiffFiles()
  const entries: Array<{ id: string; repositoryId: string; sourceBranch: string }> = [
    { id: `diff-${projectId}-login-api`, repositoryId: 'bound-demo-auth-service', sourceBranch: 'feat/login-api' },
    { id: `diff-${projectId}-web-login`, repositoryId: 'bound-demo-web-console', sourceBranch: 'feat/login-api' },
    { id: `diff-${projectId}-sdk-login`, repositoryId: 'bound-demo-shared-sdk', sourceBranch: 'feat/login-api' },
    { id: `diff-${projectId}-pay`, repositoryId: 'bound-demo-auth-service', sourceBranch: 'feat/payment-hook' },
    { id: `diff-${projectId}-dash`, repositoryId: 'bound-demo-web-console', sourceBranch: 'feat/dashboard' },
  ]
  for (const entry of entries) {
    const diff: DiffDetail = {
      id: entry.id,
      projectId,
      taskId: main.id,
      taskRunId: `run-${developer.id}`,
      taskStepId: developer.id,
      requirementGroupId: main.requirementGroup?.id ?? '',
      workspaceId: main.workspace?.id ?? '',
      repositoryId: entry.repositoryId,
      baseCommit: 'base-commit-1',
      sourceBranch: entry.sourceBranch,
      headCommit: null,
      status: 'PENDING_REVIEW',
      changeStats: { files: files.length, additions: 54, deletions: 2 },
      createdAt: timestamp,
      workingTreeHash: null,
      snapshotKey: null,
      reviewedBy: null,
      reviewReason: null,
      reviewedAt: null,
      updatedAt: laterTimestamp,
    }
    store.diffs.set(diff.id, diff)
    store.diffFiles.set(diff.id, files)
    store.diffComments.set(diff.id, loginApiDiffComments(diff.id))
  }
}

export function seedMergeRequests(store: TaskModelStore, projectId: string): void {
  if (projectId !== 'demo-project' && projectId !== 'proj-001') return
  const items: Array<{
    id: string
    repositoryId: string
    number: number
    title: string
    sourceBranch: string
    status: 'OPEN' | 'MERGED' | 'CLOSED'
    qualityGateStatus: string
    createMode?: 'MANUAL' | 'SYSTEM'
  }> = [
      {
        id: `mr-${projectId}-login-api`,
        repositoryId: 'bound-demo-auth-service',
        number: 42,
        title: '实现邮箱登录',
        sourceBranch: 'feat/login-api',
        status: 'OPEN',
        qualityGateStatus: 'PENDING',
        createMode: 'MANUAL',
      },
      {
        id: `mr-${projectId}-web-login`,
        repositoryId: 'bound-demo-web-console',
        number: 18,
        title: '登录页接入邮箱登录',
        sourceBranch: 'feat/login-api',
        status: 'OPEN',
        qualityGateStatus: 'PASSED',
        createMode: 'MANUAL',
      },
      {
        id: `mr-${projectId}-pay`,
        repositoryId: 'bound-demo-auth-service',
        number: 7,
        title: '支付回调',
        sourceBranch: 'feat/payment-hook',
        status: 'MERGED',
        qualityGateStatus: 'PASSED',
        createMode: 'SYSTEM',
      },
    ]
  for (const item of items) {
    store.mergeRequests.set(item.id, {
      id: item.id,
      repositoryId: item.repositoryId,
      groupIds: [],
      provider: 'GITHUB',
      number: item.number,
      title: item.title,
      description: null,
      sourceBranch: item.sourceBranch,
      targetBranch: 'main',
      status: item.status,
      headCommit: 'a81f3c2b4d5e6f789012345678901234567890ab',
      webUrl: 'https://github.com/mock/repo/pull/' + item.number,
      taskId: `task-${projectId}-main`,
      qualityGate: {
        status: item.qualityGateStatus,
        requiredChecks: ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'],
      },
      createMode: item.createMode ?? 'UNKNOWN',
    })
    store.mergeRequestCommits.set(item.id, mockMergeRequestCommits(item.id))
  }

  // --- PENDING_CREATE 占位 MR：大任务完成后后端自动插入的"待创建"记录 ---
  const pendingCreateItems: Array<{
    id: string
    repositoryId: string
    title: string
    sourceBranch: string
    targetBranch: string
    qualityGateStatus: string
    createMode: 'MANUAL' | 'SYSTEM'
    headCommit: string | null
  }> = [
      {
        id: `mr-${projectId}-pending-qg-passed`,
        repositoryId: 'bound-demo-auth-service',
        title: '用户中心 - 质量门禁和 CQ+1 都已通过，可以创建',
        sourceBranch: 'feat/user-center',
        targetBranch: 'main',
        qualityGateStatus: 'PASSED',
        createMode: 'SYSTEM',
        headCommit: 'a81f3c2b4d5e6f789012345678901234567890ab',
      },
      {
        id: `mr-${projectId}-pending-qg-pending`,
        repositoryId: 'bound-demo-web-console',
        title: '支付网关 - 质量门禁已通过但 CQ+1 未通过',
        sourceBranch: 'feat/payment-gateway',
        targetBranch: 'main',
        qualityGateStatus: 'PASSED',
        createMode: 'SYSTEM',
        headCommit: 'd2e6f0a1b2c3d4e5f678901234567890abcdef23',
      },
      {
        id: `mr-${projectId}-pending-manual`,
        repositoryId: 'bound-demo-shared-sdk',
        title: 'SDK 公共组件 - 质量门禁未通过，CQ+1 尚未盖章',
        sourceBranch: 'feat/sdk-components',
        targetBranch: 'main',
        qualityGateStatus: 'PENDING',
        createMode: 'MANUAL',
        headCommit: 'b47d9e1c2a3b4c5d6e7f801234567890abcdef01',
      },
    ]
  for (const item of pendingCreateItems) {
    store.mergeRequests.set(item.id, {
      id: item.id,
      repositoryId: item.repositoryId,
      groupIds: [],
      provider: 'GITHUB',
      number: 0, // 占位 MR 在 GitHub 端尚未创建，number 为 0
      title: item.title,
      description: null,
      sourceBranch: item.sourceBranch,
      targetBranch: item.targetBranch,
      status: 'PENDING_CREATE',
      headCommit: item.headCommit,
      webUrl: null, // 占位 MR 没有 GitHub URL
      taskId: `task-${projectId}-main`,
      qualityGate: {
        status: item.qualityGateStatus,
        requiredChecks: ['TESTSET', 'AI_REVIEW', 'DRY_RUN', 'CQ_PLUS_ONE'],
      },
      createMode: item.createMode,
    })
  }
}

function mockMergeRequestCommits(mergeRequestId: string): import('@/types/task-model').MergeRequestCommit[] {
  const now = Date.now()
  return [
    {
      sha: 'a81f3c2b4d5e6f789012345678901234567890ab',
      message: 'feat(login): 实现登录接口与 JWT 鉴权',
      authorName: '陈同学',
      authorUserId: 'user-chen',
      committedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      sha: 'b47d9e1c2a3b4c5d6e7f801234567890abcdef01',
      message: 'refactor: 优化校验逻辑与异常处理',
      authorName: '李同学',
      authorUserId: 'user-li',
      committedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      sha: 'd2e6f0a1b2c3d4e5f678901234567890abcdef23',
      message: 'test: 补充登录接口测试用例',
      authorName: '张同学',
      authorUserId: 'user-zhang',
      committedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
    },
  ].map((entry, index) => ({
    ...entry,
    // 保证同一次 seed 内不同 MR 的 id 不冲突即可；sha 仍按设计稿
    authorUserId: `${entry.authorUserId}-${mergeRequestId}-${index}`,
  }))
}
function artifacts(store: TaskModelStore, value: Task, r: TaskRunDetail | undefined) { const a: TaskArtifact[] = [{ id: `artifact-${value.id}-plan`, taskId: value.id, taskRunId: null, taskStepId: null, sequenceNo: 1, artifactType: 'PLAN', title: '计划', description: null, status: null, summary: {}, resources: [], createdAt: timestamp }]; if (r) for (const [n, type, title] of [[2, 'CODING', '代码编写'], [3, 'REVIEWING', '代码审查']] as const) a.push({ id: `artifact-${value.id}-${type.toLowerCase()}`, taskId: value.id, taskRunId: r.id, taskStepId: r.taskStepId, sequenceNo: n, artifactType: type, title, description: null, status: r.status === 'SUCCEEDED' ? 'SUCCEEDED' : null, summary: {}, resources: [], createdAt: laterTimestamp }); store.taskArtifacts.set(value.id, a) }
function review(store: TaskModelStore, value: Task, d: DiffDetail, delivery: DiffReviewBatch['deliveryStatus'] = 'NOT_STARTED', status: DiffReviewBatch['reviewStatus'] = 'PENDING_CONFIRMATION', confirmationSource: DiffReviewBatch['confirmationSource'] = 'USER') { store.diffReviews.set(value.id, { id: `review-${value.id}`, taskId: value.id, reviewStatus: status, confirmationSource, deliveryStatus: delivery, aggregateHash: `hash-${value.id}`, reviewReason: null, diffs: [d], repositoryDeliveries: value.repositories.map((repository, index) => ({ repositoryId: repository.repositoryId, repositoryName: repository.name, diffId: d.id, deliveryStatus: delivery === 'FAILED' ? 'FAILED' : delivery === 'PARTIALLY_DELIVERED' && index > 0 ? 'FAILED' : delivery === 'PARTIALLY_DELIVERED' ? 'MR_CREATED' : 'NOT_STARTED', failureCode: delivery === 'FAILED' || delivery === 'PARTIALLY_DELIVERED' && index > 0 ? 'DELIVERY_FAILED' : null, failureReason: delivery === 'FAILED' || delivery === 'PARTIALLY_DELIVERED' && index > 0 ? 'Mock delivery failed' : null, mergeRequest: null, updatedAt: laterTimestamp })) }) }
export function createTaskModelScenario(projectId: string): TaskModelStore {
  const store = createTaskModelStore()
  const statuses = taskStatuses.map((status, index) => {
    const value = task(projectId, `task-${projectId}-${status.toLowerCase()}`, status, index)
    store.tasks.set(value.id, value)
    return value
  })
  const attentionKinds = ['INPUT_REQUIRED', 'APPROVAL_REQUIRED', 'BLOCKED', 'EXECUTION_FAILED', 'DIFF_CONFIRMATION_REQUIRED', 'DELIVERY_FAILED'] as const
  statuses.slice(1, 7).forEach((value, index) => {
    value.attention = attention({ kind: attentionKinds[index], title: attentionKinds[index], summary: `Mock attention for ${value.id}`, taskRunId: null, inputRequestId: null, diffReviewBatchId: null, repositoryId: null })
  })

  const main = task(projectId, `task-${projectId}-main`, 'RUNNING', 20)
  main.attention = attention({ kind: 'INPUT_REQUIRED', title: 'INPUT_REQUIRED', summary: 'Mock input required', taskRunId: `run-step-${main.id}-developer`, inputRequestId: `input-run-step-${main.id}-developer`, diffReviewBatchId: null, repositoryId: null })
  store.tasks.set(main.id, main)
  const planner = step(main, `step-${main.id}-planner`, 'PLANNER', [])
  const developer = step(main, `step-${main.id}-developer`, 'DEVELOPER', [planner.id])
  for (const value of [planner, developer]) store.taskSteps.set(value.id, value)
  const mainRuns = [run(main, planner, 'SUCCEEDED'), run(main, developer, 'WAITING_INPUT')]
  for (const value of mainRuns) {
    store.taskRuns.set(value.id, value)
    resources(store, value)
  }
  artifacts(store, main, mainRuns[0])
  input(store, mainRuns[1]!, 'INPUT')
  for (const suffix of ['pending', 'accepted', 'rejected'] as const) addDiff(store, main, developer, suffix === 'pending' ? 'PENDING_REVIEW' : suffix === 'accepted' ? 'ACCEPTED' : 'REJECTED', suffix)

  const pendingTask = statuses.find((value) => value.status === 'PENDING')!
  const pendingStep = step(pendingTask, `step-${pendingTask.id}-developer`, 'DEVELOPER', [])
  store.taskSteps.set(pendingStep.id, pendingStep)
  for (const status of ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED', 'FAILED', 'SUCCEEDED'] as const) {
    const value = run(pendingTask, pendingStep, status)
    value.id = `run-${projectId}-${status.toLowerCase()}`
    store.taskRuns.set(value.id, value)
    resources(store, value)
    if (status === 'WAITING_INPUT') input(store, value, 'INPUT')
    if (status === 'WAITING_APPROVAL') input(store, value, 'APPROVAL')
  }
  const pendingInput = [...store.inputRequests.values()].find((request) => request.taskRunId === `run-${projectId}-waiting_input`)
  pendingTask.attention = attention({ kind: 'INPUT_REQUIRED', title: 'INPUT_REQUIRED', summary: `Mock attention for ${pendingTask.id}`, taskRunId: `run-${projectId}-waiting_input`, inputRequestId: pendingInput?.id ?? null, diffReviewBatchId: null, repositoryId: null })

  const waiting = statuses.find((value) => value.status === 'WAITING_DIFF_CONFIRMATION')!
  const waitingStep = step(waiting, `step-${waiting.id}-review`, 'REVIEWER', [])
  store.taskSteps.set(waitingStep.id, waitingStep)
  const waitingRun = run(waiting, waitingStep, 'SUCCEEDED')
  store.taskRuns.set(waitingRun.id, waitingRun)
  resources(store, waitingRun)
  artifacts(store, waiting, waitingRun)
  const waitingDiff = addDiff(store, waiting, waitingStep, 'PENDING_REVIEW', 'batch')
  const waitingBatchId = `review-${waiting.id}`
  review(store, waiting, waitingDiff)
  waiting.attention = attention({ kind: 'DIFF_CONFIRMATION_REQUIRED', title: 'DIFF_CONFIRMATION_REQUIRED', summary: `Mock attention for ${waiting.id}`, taskRunId: null, inputRequestId: null, diffReviewBatchId: waitingBatchId, repositoryId: waiting.repositories[0]?.repositoryId ?? null })

  for (const status of ['DELIVERING', 'DELIVERY_FAILED'] as const) {
    const value = statuses.find((candidate) => candidate.status === (status === 'DELIVERY_FAILED' ? 'DELIVERY_FAILED' : 'DELIVERING'))!
    if (status === 'DELIVERING') {
      const secondary = repo(projectId, `${value.id}-secondary`, status)
      value.repositories = [value.repositories[0]!, { ...secondary, repositoryId: `repository-${projectId}-secondary`, name: 'Mock secondary repository', fullName: 'qgents/secondary' }]
      if (value.workspace) value.workspace.repositories = value.repositories
    }
    const valueStep = step(value, `step-${value.id}-delivery`, 'REVIEWER', [])
    store.taskSteps.set(valueStep.id, valueStep)
    const valueRun = run(value, valueStep, 'SUCCEEDED')
    store.taskRuns.set(valueRun.id, valueRun)
    resources(store, valueRun)
    artifacts(store, value, valueRun)
    const valueDiff = addDiff(store, value, valueStep, 'ACCEPTED', status.toLowerCase())
    const batchId = `review-${value.id}`
    value.deliveryMode = 'MR_FIRST'
    value.deliveryReason = 'Mock 选择 MR_FIRST 自动交付'
    review(store, value, valueDiff, status === 'DELIVERY_FAILED' ? 'FAILED' : 'DELIVERING', 'ACCEPTED', 'SYSTEM')
    value.attention = attention({ kind: status === 'DELIVERING' ? 'BLOCKED' : 'DELIVERY_FAILED', title: status === 'DELIVERING' ? 'BLOCKED' : 'DELIVERY_FAILED', summary: `Mock attention for ${value.id}`, taskRunId: null, inputRequestId: null, diffReviewBatchId: batchId, repositoryId: value.repositories[0]?.repositoryId ?? null })
  }

  const partial = task(projectId, `task-${projectId}-partial-delivery`, 'DELIVERY_FAILED', 30)
  partial.repositories = [partial.repositories[0]!, { ...repo(projectId, `${partial.id}-secondary`, partial.status), repositoryId: `repository-${projectId}-secondary`, name: 'Mock secondary repository', fullName: 'qgents/secondary' }]
  if (partial.workspace) partial.workspace.repositories = partial.repositories
  store.tasks.set(partial.id, partial)
  const partialStep = step(partial, `step-${partial.id}-delivery`, 'REVIEWER', [])
  store.taskSteps.set(partialStep.id, partialStep)
  const partialRun = run(partial, partialStep, 'SUCCEEDED')
  store.taskRuns.set(partialRun.id, partialRun)
  resources(store, partialRun)
  artifacts(store, partial, partialRun)
  const partialDiff = addDiff(store, partial, partialStep, 'ACCEPTED', 'partial')
  const partialBatchId = `review-${partial.id}`
  review(store, partial, partialDiff, 'PARTIALLY_DELIVERED', 'ACCEPTED')
  partial.attention = attention({ kind: 'DELIVERY_FAILED', title: 'DELIVERY_FAILED', summary: `Mock attention for ${partial.id}`, taskRunId: null, inputRequestId: null, diffReviewBatchId: partialBatchId, repositoryId: partial.repositories[1]?.repositoryId ?? null })
  seedCodeBranchDiffs(store, projectId)
  seedMergeRequests(store, projectId)
  return store
}
export const taskModelScenarioNames = ['DEFAULT', 'EMPTY'] as const
export type TaskModelScenario = (typeof taskModelScenarioNames)[number]
export function createTaskModelScenarioByName(projectId: string, scenario: TaskModelScenario): TaskModelStore { return scenario === 'EMPTY' ? createTaskModelStore() : createTaskModelScenario(projectId) }
