import type {
  DiffComment,
  DiffFile,
  DiffFileStatus,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  DiffPreview,
  DiffPreviewFile,
  DiffPreviewLine,
  DiffPreviewLineType,
  MergeRequestCheck,
  MergeRequestCheckName,
  MergeRequestCqDecision,
  MergeRequestCqReview,
  MergeRequestCommit,
  MergeRequestCommitList,
  MergeRequestPreflight,
  MergeRequestStatus,
  MergeRequestSummary,
  PreflightRepositoryStatus,
  PreflightStatus,
  TaskMergeRequestPreflightList,
  TaskModelPage,
} from '@/types/task-model'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function readOptionalString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapChangeType(value: unknown): DiffFileStatus {
  if (value === 'ADDED' || value === 'MODIFIED' || value === 'DELETED') return value
  return 'MODIFIED'
}

function mapLineKind(value: unknown): DiffLineKind {
  // 后端枚举 CONTEXT/ADD/DELETE → 前端 CONTEXT/ADD/DEL；兼容旧 DEL
  if (value === 'ADD' || value === 'DEL' || value === 'CONTEXT') return value
  if (value === 'DELETE') return 'DEL'
  return 'CONTEXT'
}

function mapLines(raw: unknown): DiffLine[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!isRecord(item)) return []
    return [
      {
        // 后端新结构 type/oldLineNo/newLineNo/content；兼容旧 kind/oldLine/newLine/text
        kind: mapLineKind(item.type ?? item.kind),
        oldLine: typeof item.oldLineNo === 'number' ? item.oldLineNo : (typeof item.oldLine === 'number' ? item.oldLine : null),
        newLine: typeof item.newLineNo === 'number' ? item.newLineNo : (typeof item.newLine === 'number' ? item.newLine : null),
        text: typeof item.content === 'string' ? item.content : (typeof item.text === 'string' ? item.text : ''),
      },
    ]
  })
}

/** 后端 hunk header 对象 {oldStart,newStart,oldLines,newLines} → 展示用 '@@ -a,b +c,d @@' 头字符串 */
function formatHunkHeader(header: Record<string, unknown>): string {
  const oldStart = typeof header.oldStart === 'number' ? header.oldStart : 0
  const newStart = typeof header.newStart === 'number' ? header.newStart : 0
  const oldLines = typeof header.oldLines === 'number' ? header.oldLines : 1
  const newLines = typeof header.newLines === 'number' ? header.newLines : 1
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`
}

function mapHunks(raw: unknown): DiffHunk[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!isRecord(item)) return []
    return [
      {
        id: readString(item, 'id') || `hunk-${index + 1}`,
        // 后端新结构 header 为 {oldStart,newStart,oldLines,newLines} 对象；兼容旧字符串 header
        header: isRecord(item.header) ? formatHunkHeader(item.header) : readString(item, 'header'),
        lines: mapLines(item.lines),
      },
    ]
  })
}

/** DiffFileResponse：changeType；若仍带 status / hunks 则一并收。 */
export function mapDiffFile(raw: unknown): DiffFile {
  const row = isRecord(raw) ? raw : {}
  const changeType = mapChangeType(row.changeType ?? row.status)
  return {
    id: readString(row, 'id'),
    sequence: readNumber(row, 'sequence'),
    path: readString(row, 'path'),
    changeType,
    status: changeType,
    additions: readNumber(row, 'additions'),
    deletions: readNumber(row, 'deletions'),
    binary: row.binary === true,
    hunks: mapHunks(row.hunks),
  }
}

export function mapDiffFilePage(page: TaskModelPage<unknown>): TaskModelPage<DiffFile> {
  const data = Array.isArray(page.data) ? page.data.map(mapDiffFile) : []
  return { ...page, data }
}

/** §16 群聊 Diff 卡预览映射（GET /diffs/{diffId}/preview） */
function mapDiffPreviewFile(raw: unknown): DiffPreviewFile | null {
  if (!isRecord(raw)) return null
  const fileId = readString(raw, 'fileId')
  const path = readString(raw, 'path')
  if (!fileId || !path) return null
  const changeType = mapChangeType(raw.changeType ?? 'MODIFIED')
  const extension = readOptionalString(raw, 'extension')
  return {
    fileId,
    sequence: readNumber(raw, 'sequence'),
    path,
    fileName: readString(raw, 'fileName') || path.split('/').pop() || path,
    extension: extension ?? undefined,
    changeType,
    additions: readNumber(raw, 'additions'),
    deletions: readNumber(raw, 'deletions'),
    binary: raw.binary === true,
  }
}

function mapDiffPreviewLine(raw: unknown): DiffPreviewLine | null {
  if (!isRecord(raw)) return null
  const typeValue = raw.type
  const type: DiffPreviewLineType =
    typeValue === 'CONTEXT' || typeValue === 'DELETE' || typeValue === 'ADD' ? typeValue : 'CONTEXT'
  return {
    type,
    oldLineNo: typeof raw.oldLineNo === 'number' ? raw.oldLineNo : null,
    newLineNo: typeof raw.newLineNo === 'number' ? raw.newLineNo : null,
    content: typeof raw.content === 'string' ? raw.content : '',
    contentTruncated: raw.contentTruncated === true,
  }
}

export function mapDiffPreview(raw: unknown): DiffPreview {
  const row = isRecord(raw) ? raw : {}
  return {
    diffId: readString(row, 'diffId'),
    detailPath: readString(row, 'detailPath'),
    previewLineLimit: readNumber(row, 'previewLineLimit'),
    totalFileCount: readNumber(row, 'totalFileCount'),
    filesTruncated: row.filesTruncated === true,
    files: Array.isArray(row.files) ? row.files.flatMap((item) => {
      const file = mapDiffPreviewFile(item)
      return file ? [file] : []
    }) : [],
    selectedFileId: readString(row, 'selectedFileId'),
    totalLineCount: readNumber(row, 'totalLineCount'),
    lines: Array.isArray(row.lines) ? row.lines.flatMap((item) => {
      const line = mapDiffPreviewLine(item)
      return line ? [line] : []
    }) : [],
    truncated: row.truncated === true,
    viewDetailsRequired: row.viewDetailsRequired === true,
  }
}

/** DiffCommentResponse：authorUserId + createdAt；authorName 需补前可缺。 */
export function mapDiffComment(raw: unknown): DiffComment {
  const row = isRecord(raw) ? raw : {}
  return {
    id: readString(row, 'id'),
    diffId: readString(row, 'diffId') || null,
    path: typeof row.path === 'string' ? row.path : null,
    side: typeof row.side === 'string' ? row.side : null,
    line: typeof row.line === 'number' ? row.line : null,
    hunkId: typeof row.hunkId === 'string' ? row.hunkId : null,
    commitSha: typeof row.commitSha === 'string' ? row.commitSha : null,
    body: readString(row, 'body'),
    authorUserId: typeof row.authorUserId === 'string' ? row.authorUserId : null,
    authorName: typeof row.authorName === 'string' ? row.authorName : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
  }
}

export function mapDiffCommentPage(page: TaskModelPage<unknown>): TaskModelPage<DiffComment> {
  const data = Array.isArray(page.data) ? page.data.map(mapDiffComment) : []
  return { ...page, data }
}

function mapCheckName(value: unknown): MergeRequestCheckName | null {
  if (value === 'TESTSET' || value === 'AI_REVIEW' || value === 'DRY_RUN' || value === 'CQ_PLUS_ONE') {
    return value
  }
  return null
}

function mapCheckStatus(value: unknown): MergeRequestCheck['status'] {
  if (value === 'PASSED' || value === 'FAILED' || value === 'PENDING') return value
  return 'PENDING'
}

export function mapMergeRequestCheck(raw: unknown): MergeRequestCheck | null {
  const row = isRecord(raw) ? raw : {}
  const type = mapCheckName(row.type ?? row.name)
  if (!type) return null
  const reviewer = mapCheckReviewer(row)
  return {
    id: readString(row, 'id'),
    type,
    status: mapCheckStatus(row.status),
    attemptNo: typeof row.attemptNo === 'number' ? row.attemptNo : null,
    testsetId: typeof row.testsetId === 'string' ? row.testsetId : null,
    testRunId: typeof row.testRunId === 'string' ? row.testRunId : null,
    dryRunId: typeof row.dryRunId === 'string' ? row.dryRunId : null,
    commitSha: typeof row.commitSha === 'string' ? row.commitSha : null,
    source: typeof row.source === 'string' ? row.source : null,
    startedAt: typeof row.startedAt === 'string' ? row.startedAt : null,
    completedAt: typeof row.completedAt === 'string' ? row.completedAt : null,
    reviewedByUserId: reviewer.id,
    reviewedByName: reviewer.name,
    reviewReason: readOptionalString(row, 'reviewReason', 'reason'),
  }
}

function mapCheckReviewer(row: Record<string, unknown>): { id: string | null; name: string | null } {
  const nested = isRecord(row.reviewedBy) ? row.reviewedBy : isRecord(row.reviewer) ? row.reviewer : null
  const nestedId = nested && typeof nested.id === 'string' ? nested.id : null
  const nestedName =
    nested && typeof nested.displayName === 'string'
      ? nested.displayName
      : nested && typeof nested.name === 'string'
        ? nested.name
        : null
  return {
    id: readOptionalString(row, 'reviewedByUserId', 'reviewerUserId')
      ?? nestedId
      ?? (typeof row.reviewedBy === 'string' ? row.reviewedBy : null),
    name: readOptionalString(row, 'reviewedByName', 'reviewerName', 'authorName') ?? nestedName,
  }
}

/** 现状：扁平数组。若以后包装成 {items[]} 也收。 */
export function mapMergeRequestChecks(raw: unknown): MergeRequestCheck[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : []
  return list.flatMap((item) => {
    const mapped = mapMergeRequestCheck(item)
    return mapped ? [mapped] : []
  })
}

function mapCqDecision(value: unknown): MergeRequestCqDecision | null {
  if (value === 'APPROVED' || value === 'ACCEPTED' || value === 'PASSED' || value === 'APPROVE') return 'APPROVED'
  if (value === 'REJECTED' || value === 'FAILED' || value === 'REJECT') return 'REJECTED'
  return null
}

export function mapMergeRequestCqReview(raw: unknown): MergeRequestCqReview | null {
  const row = isRecord(raw) ? raw : {}
  const kind = readOptionalString(row, 'kind', 'type', 'source')
  if (kind && kind !== 'CQ' && kind !== 'CQ_PLUS_ONE' && kind !== 'HUMAN' && kind !== 'MANUAL') {
    return null
  }
  const decision =
    mapCqDecision(row.decision)
    ?? mapCqDecision(row.status)
    ?? mapCqDecision(row.result)
    ?? mapCqDecision(row.outcome)
  if (!decision) return null
  const reviewer = mapCheckReviewer(row)
  const name = reviewer.name?.trim() || '未知审查者'
  const createdAt =
    readOptionalString(row, 'createdAt', 'completedAt', 'reviewedAt', 'decidedAt')
  return {
    id: readString(row, 'id') || `${decision}-${createdAt ?? 'unknown'}-${name}`,
    decision,
    reviewerName: name,
    reason: readOptionalString(row, 'reason', 'reviewReason', 'comment'),
    createdAt,
    commitSha: readOptionalString(row, 'commitSha', 'headCommit'),
  }
}

/** GET /reviews：扁平数组，或 {items|reviews|cqReviews[]}。只展示人工 CQ 决策。 */
export function mapMergeRequestCqReviews(raw: unknown): MergeRequestCqReview[] {
  const root = isRecord(raw) ? raw : null
  const list = Array.isArray(raw)
    ? raw
    : root && Array.isArray(root.items)
      ? root.items
      : root && Array.isArray(root.reviews)
        ? root.reviews
        : root && Array.isArray(root.cqReviews)
          ? root.cqReviews
          : root && Array.isArray(root.cqApprovals)
            ? root.cqApprovals
            : []
  return list.flatMap((item) => {
    const mapped = mapMergeRequestCqReview(item)
    return mapped ? [mapped] : []
  })
}

export function mapMergeRequestCommit(raw: unknown): MergeRequestCommit | null {
  const row = isRecord(raw) ? raw : {}
  const sha = readOptionalString(row, 'sha', 'commitSha', 'id')
  const message = readOptionalString(row, 'message', 'title', 'subject')
  const committedAt = readOptionalString(row, 'committedAt', 'authoredAt', 'createdAt')
  if (!sha || !message || !committedAt) return null
  const author = isRecord(row.author) ? row.author : isRecord(row.committer) ? row.committer : null
  const authorName =
    readOptionalString(row, 'authorName', 'authorDisplayName')
    ?? (author && typeof author.displayName === 'string' ? author.displayName : null)
    ?? (author && typeof author.name === 'string' ? author.name : null)
    ?? '未知作者'
  const authorUserId =
    readOptionalString(row, 'authorUserId')
    ?? (author && typeof author.id === 'string' ? author.id : null)
  return {
    sha,
    message,
    authorName,
    authorUserId,
    committedAt,
  }
}

export function mapMergeRequestCommitList(raw: unknown): MergeRequestCommitList {
  const root = isRecord(raw) ? raw : null
  const list = Array.isArray(raw)
    ? raw
    : root && Array.isArray(root.items)
      ? root.items
      : root && Array.isArray(root.commits)
        ? root.commits
        : []
  const items = list.flatMap((item) => {
    const mapped = mapMergeRequestCommit(item)
    return mapped ? [mapped] : []
  })
  const totalCount =
    root && typeof root.totalCount === 'number' && Number.isFinite(root.totalCount)
      ? root.totalCount
      : items.length
  return { totalCount, items }
}

function mapMrStatus(value: unknown, raw?: Record<string, unknown>): MergeRequestStatus {
  if (value === 'OPEN' || value === 'MERGED' || value === 'CLOSED' || value === 'PENDING_CREATE') return value
  if (value === 'WAITING_CREATE' || value === 'TO_BE_CREATED') return 'PENDING_CREATE'
  // 兼容占位 MR：后端尚未在 GitHub 端创建 PR 时，可能还没同步 providerNumber / webUrl。
  // 仅当 row 存在显式 taskId 绑定（说明这不是 GitHub 镜像的空壳 MR）时，才按 number/webUrl 兜底为 PENDING_CREATE。
  if (value !== 'MERGED' && value !== 'CLOSED') {
    const number = typeof raw?.number === 'number' ? raw.number : null
    const webUrl = typeof raw?.webUrl === 'string' ? raw.webUrl : ''
    const hasTask = typeof (raw as { taskId?: unknown })?.taskId === 'string'
      && Boolean((raw as { taskId?: unknown }).taskId as string)
    if (hasTask && (number === null || number <= 0) && !webUrl) return 'PENDING_CREATE'
  }
  return 'OPEN'
}

export function mapMergeRequest(raw: unknown): MergeRequestSummary {
  const row = isRecord(raw) ? raw : {}
  const qualityGate = isRecord(row.qualityGate) ? row.qualityGate : null
  const requiredChecks = Array.isArray(qualityGate?.requiredChecks)
    ? qualityGate.requiredChecks.filter((item): item is string => typeof item === 'string')
    : []
  const groupIds = Array.isArray(row.groupIds)
    ? row.groupIds.filter((item): item is string => typeof item === 'string')
    : []
  const createModeRaw = typeof row.createMode === 'string' ? row.createMode.toUpperCase() : null
  const createMode: MergeRequestSummary['createMode'] =
    createModeRaw === 'MANUAL' ? 'MANUAL'
      : createModeRaw === 'SYSTEM' || createModeRaw === 'AUTOMATIC' ? 'SYSTEM'
        : 'UNKNOWN'
  const rawNumber = readNumber(row, 'number')
  const rawWebUrl = typeof row.webUrl === 'string' && row.webUrl ? row.webUrl : null
  const rawTaskId = typeof row.taskId === 'string' && row.taskId.trim() ? row.taskId : null
  const rawStatus = typeof row.status === 'string' ? row.status : undefined
  const effectiveStatus: MergeRequestStatus = mapMrStatus(rawStatus, {
    ...row,
    number: rawNumber,
    webUrl: rawWebUrl,
    taskId: rawTaskId,
  })
  return {
    id: readString(row, 'id'),
    repositoryId: readString(row, 'repositoryId') || readString(row, 'projectRepositoryId'),
    groupIds,
    provider: readString(row, 'provider') || 'GITHUB',
    number: rawNumber,
    title: typeof row.title === 'string' ? row.title : null,
    description: typeof row.description === 'string' ? row.description : null,
    sourceBranch: readString(row, 'sourceBranch'),
    targetBranch: readString(row, 'targetBranch'),
    status: effectiveStatus,
    mergeOperationStatus:
      row.mergeOperationStatus === 'RUNNING' || row.mergeOperationStatus === 'COMPLETED' || row.mergeOperationStatus === 'FAILED'
        ? row.mergeOperationStatus
        : null,
    mergeOperationFailureCode: typeof row.mergeOperationFailureCode === 'string' ? row.mergeOperationFailureCode : null,
    mergeOperationFailureReason: typeof row.mergeOperationFailureReason === 'string'
      ? row.mergeOperationFailureReason
      : null,
    headCommit: typeof row.headCommit === 'string' ? row.headCommit : null,
    webUrl: rawWebUrl,
    taskId: rawTaskId,
    qualityGate: qualityGate
      ? {
        status: typeof qualityGate.status === 'string' ? qualityGate.status : 'PENDING',
        requiredChecks,
      }
      : undefined,
    createMode,
  }
}

export function mapMergeRequestPage(page: TaskModelPage<unknown>): TaskModelPage<MergeRequestSummary> {
  const data = Array.isArray(page.data) ? page.data.map(mapMergeRequest) : []
  return { ...page, data }
}

// ---------------------------------------------------------------------------
// MR 预检 (Preflight) 映射
// ---------------------------------------------------------------------------

function isPreflightStatus(value: unknown): value is PreflightStatus {
  const valid: PreflightStatus[] = [
    'REQUESTED',
    'DRY_RUN_QUEUED',
    'DRY_RUN_RUNNING',
    'WAITING_CQ',
    'CQ_REJECTED',
    'CREATING_MR',
    'MR_CREATED',
    'FAILED',
    'STALE',
  ]
  return typeof value === 'string' && valid.includes(value as PreflightStatus)
}

function mapPreflightRepositoryStatus(raw: Record<string, unknown>): PreflightRepositoryStatus {
  return {
    preflightId: typeof raw.id === 'string'
      ? raw.id
      : typeof raw.preflightId === 'string' ? raw.preflightId : null,
    status: isPreflightStatus(raw.status) ? raw.status : undefined,
    repositoryId: typeof raw.repositoryId === 'string' ? raw.repositoryId : '',
    repositoryName: typeof raw.repositoryName === 'string' ? raw.repositoryName : '',
    sourceBranch: typeof raw.sourceBranch === 'string' ? raw.sourceBranch : '',
    targetBranch: typeof raw.targetBranch === 'string' ? raw.targetBranch : '',
    headCommit: typeof raw.headCommit === 'string' ? raw.headCommit : null,
    targetCommit: typeof raw.targetCommit === 'string' ? raw.targetCommit : null,
    dryRunId: typeof raw.dryRunId === 'string' ? raw.dryRunId : null,
    dryRunStatus: typeof raw.dryRunStatus === 'string' ? raw.dryRunStatus : null,
    dryRunSummary: isRecord(raw.dryRunSummary) ? raw.dryRunSummary : null,
    cqStatus: raw.cqStatus === 'APPROVED' || raw.cqStatus === 'REJECTED' || raw.cqStatus === 'PENDING' || raw.cqStatus === 'MISSING' ? raw.cqStatus : 'MISSING',
    cqReviewerUserId: typeof raw.cqReviewerUserId === 'string' ? raw.cqReviewerUserId : null,
    cqReviewerName: typeof raw.cqReviewerName === 'string' ? raw.cqReviewerName : null,
    cqReviewReason: typeof raw.cqReviewReason === 'string' ? raw.cqReviewReason : null,
    cqReviewedAt: typeof raw.cqReviewedAt === 'string' ? raw.cqReviewedAt : null,
    failureCode: typeof raw.failureCode === 'string' ? raw.failureCode : null,
    failureReason: typeof raw.failureReason === 'string' ? raw.failureReason : null,
    failureDetails: Array.isArray(raw.failureDetails)
      ? raw.failureDetails.filter(isRecord)
      : [],
    failureStage: typeof raw.failureStage === 'string' ? raw.failureStage : null,
    workerCode: typeof raw.workerCode === 'string' ? raw.workerCode : null,
    workerHttpStatus: typeof raw.workerHttpStatus === 'number' ? raw.workerHttpStatus : null,
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : false,
    mergeRequest: isRecord(raw.mergeRequest) ? mapMergeRequest(raw.mergeRequest) : null,
  }
}

export function mapPreflightResponse(raw: unknown): MergeRequestPreflight {
  const row = isRecord(raw) ? raw : {}
  return {
    id: typeof row.id === 'string' ? row.id : '',
    taskId: typeof row.taskId === 'string' ? row.taskId : null,
    repositoryId: typeof row.repositoryId === 'string' ? row.repositoryId : '',
    sourceBranch: typeof row.sourceBranch === 'string' ? row.sourceBranch : '',
    headCommit: typeof row.headCommit === 'string' ? row.headCommit : null,
    targetBranch: typeof row.targetBranch === 'string' ? row.targetBranch : '',
    targetCommit: typeof row.targetCommit === 'string' ? row.targetCommit : null,
    status: isPreflightStatus(row.status) ? row.status : 'REQUESTED',
    dryRunId: typeof row.dryRunId === 'string' ? row.dryRunId : null,
    blockers: Array.isArray(row.blockers) ? row.blockers.filter((b): b is string => typeof b === 'string') : [],
    failureCode: typeof row.failureCode === 'string' ? row.failureCode : null,
    failureReason: typeof row.failureReason === 'string' ? row.failureReason : null,
    coveredTaskIds: Array.isArray(row.coveredTaskIds) ? row.coveredTaskIds.filter((t): t is string => typeof t === 'string') : [],
    coveredDiffIds: Array.isArray(row.coveredDiffIds) ? row.coveredDiffIds.filter((d): d is string => typeof d === 'string') : [],
    branchLockStatus: row.branchLockStatus === 'UNLOCKED' || row.branchLockStatus === 'LOCKED' ? row.branchLockStatus : null,
    isBranchLevel: typeof row.isBranchLevel === 'boolean' ? row.isBranchLevel : false,
    mergeRequest: isRecord(row.mergeRequest) ? mapMergeRequest(row.mergeRequest) : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
  }
}

function mapTaskPreflightItem(raw: Record<string, unknown>): PreflightRepositoryStatus {
  const status = typeof raw.status === 'string' ? raw.status : ''
  const nestedDryRun = isRecord(raw.dryRun) ? raw.dryRun : null
  const nestedCq = isRecord(raw.cqPlusOne) ? raw.cqPlusOne : null
  const dryRunStatus = typeof raw.dryRunStatus === 'string'
    ? raw.dryRunStatus
    : nestedDryRun && typeof nestedDryRun.status === 'string'
      ? nestedDryRun.status
    : status === 'WAITING_CQ' || status === 'CREATING_MR' || status === 'MR_CREATED'
      ? 'PASSED'
      : status === 'FAILED' || status === 'CQ_REJECTED' || status === 'STALE'
        ? 'FAILED'
        : status
  const rawCqStatus = typeof raw.cqStatus === 'string'
    ? raw.cqStatus
    : typeof raw.cqPlusOneStatus === 'string'
      ? raw.cqPlusOneStatus
      : nestedCq && typeof nestedCq.status === 'string'
        ? nestedCq.status
        : null
  const cqStatus = rawCqStatus === 'APPROVED' || rawCqStatus === 'REJECTED'
    || rawCqStatus === 'PENDING' || rawCqStatus === 'MISSING'
    ? rawCqStatus
    : status === 'WAITING_CQ'
      ? 'PENDING'
      : status === 'CQ_REJECTED'
        ? 'REJECTED'
        : status === 'CREATING_MR' || status === 'MR_CREATED'
          ? 'APPROVED'
          : 'MISSING'

  return mapPreflightRepositoryStatus({
    ...raw,
    dryRunStatus,
    cqStatus,
    cqReviewerUserId: raw.cqReviewerUserId
      ?? (nestedCq ? nestedCq.reviewerUserId : undefined),
    cqReviewerName: raw.cqReviewerName
      ?? (nestedCq ? nestedCq.reviewerName : undefined),
    cqReviewReason: raw.cqReviewReason
      ?? (nestedCq ? nestedCq.reason : undefined),
    cqReviewedAt: raw.cqReviewedAt
      ?? (nestedCq ? nestedCq.reviewedAt : undefined),
  })
}

export function mapTaskPreflightList(raw: unknown): TaskMergeRequestPreflightList {
  const payload = isRecord(raw) ? raw : null
  const rawItems = Array.isArray(raw)
    ? raw
    : payload && Array.isArray(payload.items)
      ? payload.items
      : payload && Array.isArray(payload.data)
        ? payload.data
        : []
  const items = rawItems.filter(isRecord).map(mapTaskPreflightItem)
  const firstItem = rawItems.find(isRecord)
  const taskId = payload && typeof payload.taskId === 'string'
    ? payload.taskId
    : firstItem && typeof firstItem.taskId === 'string'
      ? firstItem.taskId
      : ''
  return {
    taskId,
    items,
    totalCount: items.length,
  }
}
