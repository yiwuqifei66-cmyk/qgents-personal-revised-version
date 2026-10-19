export type TaskStatus =
  | 'PLANNING'
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_DIFF_CONFIRMATION'
  | 'WAITING_PREFLIGHT'
  | 'DIFF_REJECTED'
  | 'DELIVERING'
  | 'DELIVERY_FAILED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLING'
  | 'CANCELLED'

export type TaskStepStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'

export type TaskRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'WAITING_INPUT'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'CANCELLING'
  | 'CANCELLED'

export type TaskRunStepStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'

export type TaskStepRole = 'ORCHESTRATOR' | 'PLANNER' | 'DEVELOPER' | 'TESTER' | 'REVIEWER'

export type InputRequestKind = 'INPUT' | 'APPROVAL'
export type InputRequestStatus = 'PENDING' | 'ANSWERED' | 'APPROVED' | 'REJECTED'
export type SandboxStatus = 'CREATING' | 'READY' | 'RUNNING' | 'STOPPED' | 'EXPIRED' | 'FAILED'

export type DiffStatus = 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED'

export type TaskArtifactType = 'PLAN' | 'CODING' | 'TESTING' | 'REVIEWING'
export type DiffReviewStatus = 'PENDING_CONFIRMATION' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED'
export type DiffReviewDeliveryStatus = 'NOT_STARTED' | 'DELIVERING' | 'DELIVERED' | 'PARTIALLY_DELIVERED' | 'FAILED'
export type TaskDeliveryMode = 'DIFF_FIRST' | 'MR_FIRST'
export type DiffReviewConfirmationSource = 'USER' | 'SYSTEM'

export interface TaskRequirementGroupSummary { id: string; name: string; status: string }
export interface TaskUserSummary { id: string; displayName: string; avatarUrl: string | null }
export interface TaskRepositorySummary { repositoryId: string; name: string; fullName: string; provider: string; defaultBranch: string; baseRef: string; baseCommit: string; sourceBranch: string; headCommit: string | null }
export interface TaskExecutionSummary { totalSteps: number; pendingSteps: number; runningSteps: number; waitingSteps: number; blockedSteps: number; succeededSteps: number; failedSteps: number; currentStage: TaskStepRole | null; currentStageTitle: string | null; requiresUserAction: boolean }
export type TaskAttentionKind = 'INPUT_REQUIRED' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'EXECUTION_FAILED' | 'DIFF_CONFIRMATION_REQUIRED' | 'PREFLIGHT_REQUIRED' | 'DELIVERY_FAILED'
export interface TaskAttention {
  kind: TaskAttentionKind
  title: string
  summary: string | null
  taskRunId: string | null
  inputRequestId: string | null
  diffReviewBatchId: string | null
  repositoryId: string | null
  createdAt: string | null
}

export interface TaskListItem {
  id: string
  displayCode: string
  projectId: string
  title: string
  requirementSummary: string
  status: TaskStatus
  /** null until the server has materialized the plan and selected a delivery mode. */
  deliveryMode: TaskDeliveryMode | null
  /** Server-generated explanation of the selected delivery mode; never client input. */
  deliveryReason: string | null
  requirementGroup: TaskRequirementGroupSummary | null
  createdByUser: TaskUserSummary | null
  /** Bound repository ids; used when a detail response omits repository summaries. */
  repositoryIds?: string[]
  repositories: TaskRepositorySummary[]
  executionSummary: TaskExecutionSummary
  attention: TaskAttention | null
  /** Task 级别的状态原因。仅在任务尚未创建 TaskRun（启动失败等）时出现。 */
  statusReason: TaskStatusReason | null
  createdAt: string
  updatedAt: string
}

export interface TaskAcceptanceCriterion { id: string; title: string; description: string | null; status: 'PENDING' | 'SATISFIED' | 'UNSATISFIED' | 'NOT_APPLICABLE' }
export interface TaskWorkspace { id: string; status: string; repositories: TaskRepositorySummary[] }
export interface TaskCapabilities { canCancel: boolean; canCancelDisabledReason?: string | null; canReplacePendingStepAgent: boolean; canReplacePendingStepAgentDisabledReason?: string | null; canConfirmDiffReview: boolean; canConfirmDiffReviewDisabledReason?: string | null; canRejectDiffReview: boolean; canRejectDiffReviewDisabledReason?: string | null; canRetryDelivery: boolean; canRetryDeliveryDisabledReason?: string | null }
export interface TaskArtifactSummary { total: number; byType: Partial<Record<TaskArtifactType, number>> }
export interface TaskDiffReviewSummary { available: boolean; /** Representative Diff ID only; null when the batch has none. */ diffId?: string | null; reviewStatus: DiffReviewStatus | null; deliveryStatus: DiffReviewDeliveryStatus | null; repositoryCount: number; filesChanged: number; additions: number; deletions: number }
export interface TaskSourceMessage { id: string; sender: TaskUserSummary; textExcerpt: string; createdAt: string }
export interface Task extends TaskListItem { requirement: string; acceptanceCriteria: TaskAcceptanceCriterion[]; workspace: TaskWorkspace | null; capabilities: TaskCapabilities; artifactSummary: TaskArtifactSummary; diffReviewSummary: TaskDiffReviewSummary; sourceMessage: TaskSourceMessage | null; triggerMessageId: string | null }

export interface TaskDiagnostics {
  taskId: string
  status: TaskStatus
  stage: string
  failure: TaskRunStatusReason | null
  latestFailedRun: TaskRunDiagnostics | null
}

export interface TaskArtifact {
  id: string
  taskId: string
  taskRunId: string | null
  taskStepId: string | null
  sequenceNo: number
  artifactType: TaskArtifactType
  title: string
  description: string | null
  status: 'SUCCEEDED' | 'FAILED' | null
  summary: Record<string, unknown>
  resources: Array<{ resourceType: string; resourceId: string; title: string }>
  createdAt: string
}

export interface TaskCreateInput {
  requirementGroupId: string
  title: string
  requirement: string
  repositoryIds: string[]
  /** Per-repository workspace base refs. */
  repositoryRefs?: Array<{ repositoryId: string; baseRef: string }>
  /** Legacy single base ref, retained for older callers during API migration. */
  baseRef?: string | null
  /** Explicit user preference. Omit to let the planner/server decide. */
  deliveryMode?: TaskDeliveryMode
  workspaceId?: string
  continuationOfTaskId?: string
}

export interface TaskListFilters {
  groupId?: string
  status?: TaskStatus
  /** 排除指定状态（逗号分隔多值），服务端 not in 过滤——任务中心「隐藏已完成任务」传 SUCCEEDED。 */
  excludeStatus?: TaskStatus
  createdBy?: string
  repositoryId?: string
  keyword?: string
  cursor?: string
  limit?: number
}

export interface PageFilters {
  cursor?: string
  limit?: number
}

export interface TaskModelPage<T> {
  data: T[]
  page: {
    nextCursor: string | null
    hasMore: boolean
  }
  requestId: string
}

export interface TaskStepAgentSummary { id: string; name: string; role: TaskStepRole; avatarUrl: string | null; status: string }
export interface TaskStepRepositorySummary { repositoryId: string; name: string; sourceBranch: string }
export interface TaskStepLatestRun { id: string; status: TaskRunStatus; startedAt: string | null; finishedAt: string | null; durationMs: number | null }
export interface TaskStep { id: string; taskId: string; sequenceNo: number; title: string; description: string | null; role: TaskStepRole; agent: TaskStepAgentSummary | null; repository: TaskStepRepositorySummary | null; dependencies: string[]; status: TaskStepStatus; acceptanceNotes: string | null; latestRun: TaskStepLatestRun | null; runCount: number; startedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string }

export interface TaskStepCreateInput {
  role: TaskStepRole
  agentId?: string
  repositoryId?: string
  baseRef?: string
  dependencies?: string[]
  testsetIds?: string[]
  acceptanceNotes?: string
}

export interface ReplaceTaskStepAgentInput {
  agentId: string
}

export interface TaskRunAgentSummary { id: string; name: string; role: TaskStepRole; avatarUrl: string | null }
export interface TaskRunStatusReason { code: 'INPUT_REQUIRED' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'EXECUTION_FAILED' | 'STARTUP_FAILED' | 'DELIVERY_FAILED' | 'CANCELLED'; failureCode?: string | null; title: string; summary: string; retryable: boolean; occurredAt: string | null }
export interface TaskRunArtifactSummary { total: number; diffCount: number }
export interface TaskRunSummary { id: string; taskId: string; taskStepId: string; taskStepTitle: string; agent: TaskRunAgentSummary | null; role: TaskStepRole; status: TaskRunStatus; retryOfTaskRunId: string | null; statusSummary: string | null; statusReason: TaskRunStatusReason | null; startedAt: string | null; finishedAt: string | null; durationMs: number | null; artifactSummary: TaskRunArtifactSummary; createdAt: string; updatedAt: string }

export interface TaskRunStep {
  node: string
  status: TaskRunStepStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  errorCode?: string | null
}

export interface TaskRunDetail extends TaskRunSummary { steps?: TaskRunStep[] }

export interface WorkerExecutionDiagnostic {
  executionId: string
  tool: string | null
  status: string | null
  exitCode: number | null
  failureCode: string | null
  failureSummary: string | null
  createdAt: string | null
  finishedAt: string | null
}

export interface TaskRunDiagnostics {
  taskRunId: string
  taskId: string
  status: TaskRunStatus
  stage: string
  failure: TaskRunStatusReason | null
  workerExecutions: WorkerExecutionDiagnostic[]
}

export type TaskRun = TaskRunSummary | TaskRunDetail

export interface TaskRunListFilters {
  status?: TaskRunStatus
  cursor?: string
  limit?: number
}

export interface TaskRunLog {
  id: string
  sequence: number
  node: string
  content: string
  timestamp: string
  /** 日志类型：EXECUTION=Agent/Worker执行日志；SYSTEM=TaskRun生命周期日志；TERMINAL=终态摘要（不展示为普通日志） */
  entryType: 'EXECUTION' | 'SYSTEM' | 'TERMINAL'
}

/**
 * Task 级别的状态原因，仅在任务尚未创建 TaskRun（启动失败等）时出现。
 * 与 TaskRunStatusReason（运行级原因）不同。
 */
export interface TaskStatusReason {
  code: string
  /** 失败原因稳定码（如 GIT_BRANCH_NOT_FOUND）；仅失败时返回，供前端选择可读提示与重试入口 */
  failureCode?: string | null
  title: string
  summary: string
  retryable: boolean
  occurredAt: string
}

export interface ExecutionContext {
  workspaceId: string
  sandboxStatus: SandboxStatus
  /** null for runs that do not operate on a repository. */
  repositoryId: string | null
  baseRef: string
  headRef: string
  startedAt: string | null
  expiresAt: string | null
}

export type WorkspaceDiffPreviewChangeType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED'

/**
 * Coding 过程中的累计工作树预览，不是正式 Diff，也不代表已交付。
 * GET /projects/{projectId}/tasks/{taskId}/workspace-diff-preview
 */
export interface WorkspaceDiffPreview {
  projectId: string
  taskId: string
  taskRunId: string | null
  workspaceId: string
  revision: number
  baseCommit: string | null
  workingTreeHash: string | null
  filesChanged: number
  additions: number
  deletions: number
  patch: string | null
  createdAt: string
}

/** GET .../workspace-diff-preview/files 的 Workspace 相对路径摘要。 */
export interface WorkspaceDiffPreviewFile {
  /** 后端可选扩展字段；v2.0.22 文件接口不保证返回。 */
  repositoryId: string | null
  /** Workspace 内一级相对目录；单仓库或无分隔时可以为空。 */
  repositoryPath: string | null
  path: string
  changeType: WorkspaceDiffPreviewChangeType
  additions: number
  deletions: number
  binary: boolean
}

/** §48：指定 Preview revision 的单文件 patch；不属于正式 Diff。 */
export interface WorkspaceDiffPreviewFilePatch {
  revision: number
  repositoryId: string
  path: string
  changeType: WorkspaceDiffPreviewChangeType
  additions: number
  deletions: number
  binary: boolean
  patch: string | null
}

export type WorkspaceDiffPreviewStatus =
  | { kind: 'available'; preview: WorkspaceDiffPreview }
  | { kind: 'unavailable'; reason: 'NOT_FOUND' | 'WORKER_UNAVAILABLE' | 'UNKNOWN'; message: string }

export interface InputRequestOption {
  value: string
  label: string
}

export interface InputRequest {
  id: string
  taskRunId: string
  kind: InputRequestKind
  status: InputRequestStatus
  prompt: string
  options?: InputRequestOption[]
  createdAt: string
}

export interface InputRequestAnswer {
  answer: { value: string }
}

export interface InputRequestDecision {
  reason: string
}

export interface DiffChangeStats {
  files: number
  additions: number
  deletions: number
}

export interface DiffListItem {
  id: string
  projectId: string
  taskId: string
  taskRunId: string | null
  taskStepId: string | null
  requirementGroupId: string
  workspaceId: string
  repositoryId: string
  baseCommit: string
  sourceBranch: string
  /** 目标分支；旧 Diff 响应可能缺省。 */
  targetBranch?: string | null
  headCommit?: string | null
  status: DiffStatus
  changeStats: DiffChangeStats
  createdAt: string
}

export interface DiffDetail extends DiffListItem {
  workingTreeHash: string | null
  snapshotKey: string | null
  reviewedBy: string | null
  reviewReason: string | null
  reviewedAt: string | null
  updatedAt: string
}

export type DiffFileStatus = 'ADDED' | 'MODIFIED' | 'DELETED'
export type DiffLineKind = 'CONTEXT' | 'ADD' | 'DEL'

export interface DiffLine {
  kind: DiffLineKind
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface DiffHunk {
  id: string
  header: string
  lines: DiffLine[]
}

/** GET /diffs/{diffId}/files：DiffFileResponse。hunks 本轮可能为空。 */
export interface DiffFile {
  id: string
  sequence: number
  path: string
  changeType: DiffFileStatus
  /** 与 changeType 相同，页面继续用 status 画 A/M/D */
  status: DiffFileStatus
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
}

/** §16 群聊 Diff 卡预览（GET /diffs/{diffId}/preview，只允许 Task 级最终 Diff） */
export type DiffPreviewLineType = 'CONTEXT' | 'DELETE' | 'ADD'

/** 预览文件标签（最多 100 项；filesTruncated=true 时未返回的文件不展示） */
export interface DiffPreviewFile {
  fileId: string
  sequence: number
  path: string
  fileName: string
  extension?: string
  changeType: DiffFileStatus
  additions: number
  deletions: number
  binary: boolean
}

/** 预览行：content 不带 unified diff 的 + - 前缀，按 type 渲染 */
export interface DiffPreviewLine {
  type: DiffPreviewLineType
  oldLineNo: number | null
  newLineNo: number | null
  content: string
  contentTruncated: boolean
}

/** §16.1 预览响应 data */
export interface DiffPreview {
  diffId: string
  /** 前端路由 /app/projects/{projectId}/code/diff/{diffId}（“查看详情”跳转目标） */
  detailPath: string
  previewLineLimit: number
  totalFileCount: number
  filesTruncated: boolean
  files: DiffPreviewFile[]
  selectedFileId: string
  totalLineCount: number
  lines: DiffPreviewLine[]
  truncated: boolean
  /** viewDetailsRequired = truncated || filesTruncated || lines[].contentTruncated */
  viewDetailsRequired: boolean
}

export interface DiffComment {
  id: string
  diffId?: string | null
  path: string | null
  side: string | null
  line: number | null
  hunkId: string | null
  commitSha?: string | null
  body: string
  authorUserId?: string | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  createdAt?: string | null
}

export interface DiffListFilters {
  taskId?: string
  cursor?: string
  limit?: number
}

export interface DiffCommentInput {
  path?: string
  side?: string
  line?: number
  hunkId?: string
  body: string
}

export interface DiffRejectInput {
  reason: string
}

/** POST /projects/{projectId}/merge-requests */
export interface MergeRequestCreateInput {
  taskId: string
  repositoryId: string
  targetBranch: string
  title: string
  idempotencyKey?: string
}

/** POST /merge-requests/{id}/cq-approvals 与 cq-rejections */
export interface MergeRequestCqInput {
  reason: string
}

export type MergeRequestStatus = 'OPEN' | 'MERGED' | 'CLOSED' | 'PENDING_CREATE'

export interface MergeRequestListFilters {
  repositoryId?: string
  groupId?: string
  status?: MergeRequestStatus
  cursor?: string
  limit?: number
}

/** GET/POST /projects/{projectId}/merge-requests */
export interface MergeRequestSummary {
  id: string
  repositoryId: string
  groupIds: string[]
  provider: string
  number: number
  title?: string | null
  description?: string | null
  sourceBranch: string
  targetBranch: string
  status: MergeRequestStatus
  /** 合并操作状态；异步合并受理后为 RUNNING，完成后为 COMPLETED/FAILED。 */
  mergeOperationStatus?: 'RUNNING' | 'COMPLETED' | 'FAILED' | null
  /** 异步合并失败时由后端保存的受控错误信息。 */
  mergeOperationFailureCode?: string | null
  mergeOperationFailureReason?: string | null
  headCommit: string | null
  webUrl?: string | null
  taskId?: string | null
  qualityGate?: { status: string; requiredChecks: string[] }
  /**
   * 区分 MR 创建来源：
   *  - MANUAL：用户从流程图「创建 MR」节点或手动触发创建
   *  - SYSTEM：后端 MrFirstAutomationService 自动创建（CQ+1 通过后自动）
   *  - UNKNOWN：后端版本尚未回传该字段，前端不显示来源 Tag（兼容旧响应）
   *
   *  后端 MergeRequestSummaryResponse / Entity 后续会同步新增 createMode 字段。
   */
  createMode: 'MANUAL' | 'SYSTEM' | 'UNKNOWN'
}

export type MergeRequestCheckName = 'TESTSET' | 'AI_REVIEW' | 'DRY_RUN' | 'CQ_PLUS_ONE'

/** GET /merge-requests/{id}/checks 扁平数组项 MergeRequestCheckResponse */
export interface MergeRequestCheck {
  id: string
  type: MergeRequestCheckName
  status: 'PENDING' | 'PASSED' | 'FAILED'
  attemptNo?: number | null
  testsetId?: string | null
  testRunId?: string | null
  dryRunId?: string | null
  commitSha?: string | null
  source?: string | null
  startedAt?: string | null
  completedAt?: string | null
  reviewedByUserId?: string | null
  reviewedByName?: string | null
  reviewReason?: string | null
}

/** GET /merge-requests/{id}/reviews 中人工 CQ 决策（文档无固定样例，前端宽松收） */
export type MergeRequestCqDecision = 'APPROVED' | 'REJECTED'

export interface MergeRequestCqReview {
  id: string
  decision: MergeRequestCqDecision
  reviewerName: string
  reason: string | null
  createdAt: string | null
  commitSha: string | null
}

/**
 * GET /merge-requests/{id}/commits（暂定：官方契约尚未冻结该路径与字段）
 * 列表预览用 totalCount + items；相对时间由前端用 committedAt 计算。
 */
export interface MergeRequestCommit {
  sha: string
  message: string
  authorName: string
  authorUserId: string | null
  committedAt: string
}

export interface MergeRequestCommitList {
  totalCount: number
  items: MergeRequestCommit[]
}

export interface DiffReviewBatch {
  id: string
  taskId: string
  reviewStatus: DiffReviewStatus
  /** Read-only authorization source; SYSTEM represents MR_FIRST auto-delivery. */
  confirmationSource: DiffReviewConfirmationSource
  deliveryStatus: DiffReviewDeliveryStatus
  aggregateHash: string
  reviewReason: string | null
  diffs: DiffListItem[]
  repositoryDeliveries: Array<{ repositoryId: string; repositoryName: string; diffId: string; deliveryStatus: 'NOT_STARTED' | 'COMMITTED' | 'MR_CREATED' | 'FAILED'; failureCode: string | null; failureReason: string | null; mergeRequest: { id: string; number: number; title: string; status: string; webUrl: string | null } | null; updatedAt: string }>
}

// ---------------------------------------------------------------------------
// MR 预检 (Preflight) 类型 — 统一创建 MR 自动预检流程
// ---------------------------------------------------------------------------

/**
 * 预检状态机：
 * REQUESTED → DRY_RUN_QUEUED → DRY_RUN_RUNNING → WAITING_CQ → CREATING_MR → MR_CREATED
 *                                                   ↘ CQ_REJECTED
 *                                                   ↘ FAILED
 *                                                   ↘ STALE
 */
export type PreflightStatus =
  | 'REQUESTED'
  | 'DRY_RUN_QUEUED'
  | 'DRY_RUN_RUNNING'
  | 'WAITING_CQ'
  | 'CQ_REJECTED'
  | 'CREATING_MR'
  | 'MR_CREATED'
  | 'FAILED'
  | 'STALE'

export type PreflightFailureCode =
  | 'BRANCH_NOT_PUSHED'
  | 'MR_BRANCH_LOCKED'
  | 'PREFLIGHT_CONTEXT_STALE'
  | 'DRY_RUN_FAILED'
  | 'DRY_RUN_CONFLICT'
  | 'CQ_REJECTED'
  | 'GIT_STORE_SYNC_FAILED'
  | 'WORKER_UNAVAILABLE'
  | 'MR_CREATE_FAILED'
  | string

/** 单个仓库的预检状态摘要 */
export interface PreflightRepositoryStatus {
  /** 分支级预检申请 ID，用于失败后创建新的 Dry Run。 */
  preflightId: string | null
  /** 服务端推导的分支级预检状态。 */
  status?: PreflightStatus
  repositoryId: string
  repositoryName: string
  sourceBranch: string
  targetBranch: string
  headCommit: string | null
  targetCommit: string | null
  dryRunId: string | null
  dryRunStatus: string | null
  dryRunSummary?: Record<string, unknown> | null
  cqStatus: 'APPROVED' | 'REJECTED' | 'PENDING' | 'MISSING'
  cqReviewerUserId: string | null
  cqReviewerName: string | null
  cqReviewReason: string | null
  cqReviewedAt: string | null
  failureCode: PreflightFailureCode | null
  failureReason: string | null
  failureDetails?: Array<Record<string, unknown>>
  failureStage?: string | null
  workerCode?: string | null
  workerHttpStatus?: number | null
  retryable: boolean
  mergeRequest: MergeRequestSummary | null
}

/** 预检申请响应（POST /merge-requests/preflight 或 GET 查询） */
export interface MergeRequestPreflight {
  id: string
  taskId: string | null
  repositoryId: string
  sourceBranch: string
  headCommit: string | null
  targetBranch: string
  targetCommit: string | null
  status: PreflightStatus
  dryRunId: string | null
  blockers: string[]
  failureCode: PreflightFailureCode | null
  failureReason: string | null
  coveredTaskIds: string[]
  coveredDiffIds: string[]
  branchLockStatus: 'UNLOCKED' | 'LOCKED' | null
  isBranchLevel: boolean
  mergeRequest: MergeRequestSummary | null
  createdAt: string
  updatedAt: string
}

/** 按 Task 查询多个仓库预检响应 */
export interface TaskMergeRequestPreflightList {
  taskId: string
  items: PreflightRepositoryStatus[]
  totalCount: number
}
