import type {
  AgentDeliveryItem,
  CodeDeliveryItem,
  DeliveryActor,
  DeliveryCapabilities,
  DeliveryItem,
  DeliverySource,
  MemoryDeliveryItem,
  SkillDeliveryItem,
} from '@/types/delivery-center'

const member: DeliveryActor = { id: 'user-002', displayName: 'Demo Member', avatarUrl: null }
const reviewer: DeliveryActor = { id: 'user-003', displayName: 'Project Admin', avatarUrl: null }
const sourceWithTask: DeliverySource = {
  taskId: 'task-delivery-001',
  taskDisplayCode: 'TASK-001',
  taskTitle: 'Repository sync task',
  taskRunId: 'run-delivery-001',
  taskStepId: 'step-delivery-001',
  messageId: null,
  artifactId: 'artifact-delivery-001',
}
const sourceWithoutTask: DeliverySource = {
  taskId: null,
  taskDisplayCode: null,
  taskTitle: null,
  taskRunId: null,
  taskStepId: null,
  messageId: 'message-memory-001',
  artifactId: null,
}
const sourceWithMemory: DeliverySource = {
  ...sourceWithoutTask,
  messageId: 'message-memory-001',
}

function capabilities(canApprove: boolean, canSubmitReview: boolean, canRetryDelivery = false, canArchive = canApprove): DeliveryCapabilities {
  const noApproval = 'Project Admin approval required'
  const notDraft = 'Only draft resources can be submitted'
  const noRetry = 'Delivery is not retryable'
  return {
    canSubmitReview,
    canApprove,
    canReject: canApprove,
    canArchive,
    canRetryDelivery,
    canOpenResource: true,
    disabledReasons: {
      canSubmitReview: canSubmitReview ? null : notDraft,
      canApprove: canApprove ? null : noApproval,
      canReject: canApprove ? null : noApproval,
      canArchive: canArchive ? null : noApproval,
      canRetryDelivery: canRetryDelivery ? null : noRetry,
      canOpenResource: null,
    },
  }
}

function codeItem(overrides: Partial<CodeDeliveryItem> & Pick<CodeDeliveryItem, 'id' | 'resourceId' | 'title' | 'displayStatus' | 'resourceStatus' | 'reviewStatus' | 'deliveryStatus'>): CodeDeliveryItem {
  return {
    id: overrides.id,
    projectId: overrides.projectId ?? 'project-delivery-center',
    resourceType: 'CODE',
    resourceId: overrides.resourceId,
    openTarget: overrides.openTarget ?? { kind: 'TASK_DIFF_REVIEW', taskId: sourceWithTask.taskId!, diffReviewBatchId: overrides.resourceId },
    title: overrides.title,
    summary: 'Code delivery aggregation summary',
    version: null,
    displayStatus: overrides.displayStatus,
    resourceStatus: overrides.resourceStatus,
    requirementGroup: { id: 'group-delivery', name: 'Delivery Center rollout' },
    source: sourceWithTask,
    creator: member,
    submitter: member,
    reviewer: overrides.reviewer ?? null,
    reviewReason: overrides.reviewReason ?? null,
    createdAt: '2026-08-12T08:00:00Z',
    submittedAt: '2026-08-12T09:00:00Z',
    reviewedAt: overrides.reviewedAt ?? null,
    updatedAt: '2026-08-14T08:00:00Z',
    capabilities: overrides.capabilities ?? capabilities(overrides.reviewStatus === 'PENDING_CONFIRMATION', false, overrides.deliveryStatus === 'FAILED' || overrides.deliveryStatus === 'PARTIALLY_DELIVERED'),
    repositories: overrides.repositories ?? [{ repositoryId: 'repo-main', name: 'qgents-web', branch: 'feat/delivery-center' }],
    diffReviewId: overrides.diffReviewId ?? overrides.resourceId,
    diffId: overrides.diffId ?? `diff-${overrides.id}`,
    reviewStatus: overrides.reviewStatus,
    deliveryStatus: overrides.deliveryStatus,
    filesChanged: overrides.filesChanged ?? 4,
    additions: overrides.additions ?? 42,
    deletions: overrides.deletions ?? 8,
    repositoryDeliveries: overrides.repositoryDeliveries ?? [{ repositoryId: 'repo-main', repositoryName: 'qgents-web', deliveryStatus: 'MR_CREATED', failureCode: null, failureReason: null, mergeRequest: { id: 'mr-001', number: 18, title: 'Delivery Center change', status: 'OPEN', webUrl: 'https://github.com/example/qgents-web/pull/18' }, updatedAt: '2026-08-14T08:00:00Z' }],
    mergeRequest: overrides.mergeRequest ?? { id: 'mr-001', number: 18, title: 'Delivery Center change', status: 'OPEN', webUrl: 'https://github.com/example/qgents-web/pull/18' },
  }
}

function memoryItem(overrides: Partial<MemoryDeliveryItem> & Pick<MemoryDeliveryItem, 'id' | 'resourceId' | 'title' | 'displayStatus' | 'resourceStatus' | 'visibility'>): MemoryDeliveryItem {
  return {
    id: overrides.id,
    projectId: overrides.projectId ?? 'project-delivery-center',
    resourceType: 'MEMORY',
    resourceId: overrides.resourceId,
    openTarget: overrides.openTarget ?? { kind: 'MEMORY', memoryId: overrides.resourceId },
    title: overrides.title,
    summary: 'Memory excerpt is intentionally limited to a short preview.',
    version: null,
    displayStatus: overrides.displayStatus,
    resourceStatus: overrides.resourceStatus,
    requirementGroup: overrides.requirementGroup ?? { id: 'group-delivery', name: 'Delivery Center rollout' },
    source: overrides.source ?? sourceWithMemory,
    creator: member,
    submitter: overrides.submitter ?? (overrides.displayStatus === 'DRAFT' ? null : member),
    reviewer: overrides.reviewer ?? null,
    reviewReason: overrides.reviewReason ?? null,
    createdAt: '2026-08-11T08:00:00Z',
    submittedAt: overrides.submittedAt ?? (overrides.displayStatus === 'DRAFT' ? null : '2026-08-12T09:00:00Z'),
    reviewedAt: overrides.reviewedAt ?? null,
    updatedAt: '2026-08-14T08:00:00Z',
    capabilities: overrides.capabilities ?? capabilities(overrides.displayStatus === 'PENDING_REVIEW', overrides.displayStatus === 'DRAFT' || overrides.displayStatus === 'REJECTED', false, overrides.displayStatus === 'ACCEPTED'),
    category: overrides.category ?? 'PROJECT_KNOWLEDGE',
    tags: overrides.tags ?? ['delivery'],
    visibility: 'PROJECT_SHARED',
    sources: overrides.sources ?? [{ groupId: 'group-delivery', messageId: 'message-memory-001' }],
    contentExcerpt: overrides.contentExcerpt ?? 'Short memory content preview only; full content is never returned by this aggregate endpoint.',
  }
}

function skillItem(overrides: Partial<SkillDeliveryItem> & Pick<SkillDeliveryItem, 'id' | 'resourceId' | 'title' | 'displayStatus' | 'resourceStatus' | 'visibility'>): SkillDeliveryItem {
  return {
    id: overrides.id,
    projectId: overrides.projectId ?? 'project-delivery-center',
    resourceType: 'SKILL',
    resourceId: overrides.resourceId,
    openTarget: overrides.openTarget ?? { kind: 'SKILL', skillId: overrides.resourceId },
    title: overrides.title,
    summary: 'Skill capability summary without prompt or credentials.',
    version: null,
    displayStatus: overrides.displayStatus,
    resourceStatus: overrides.resourceStatus,
    requirementGroup: overrides.requirementGroup ?? null,
    source: overrides.source ?? { ...sourceWithoutTask, messageId: null },
    creator: member,
    submitter: overrides.submitter ?? (overrides.displayStatus === 'DRAFT' ? null : member),
    reviewer: overrides.reviewer ?? null,
    reviewReason: overrides.reviewReason ?? null,
    createdAt: '2026-08-10T08:00:00Z',
    submittedAt: overrides.submittedAt ?? (overrides.displayStatus === 'DRAFT' ? null : '2026-08-12T09:00:00Z'),
    reviewedAt: overrides.reviewedAt ?? null,
    updatedAt: '2026-08-14T08:00:00Z',
    capabilities: overrides.capabilities ?? capabilities(overrides.displayStatus === 'PENDING_REVIEW', overrides.displayStatus === 'DRAFT' || overrides.displayStatus === 'REJECTED', false, overrides.displayStatus === 'ACCEPTED'),
    tags: overrides.tags ?? ['automation'],
    visibility: overrides.visibility,
    capabilitySummary: overrides.capabilitySummary ?? 'Reusable repository review capability',
    contentExcerpt: overrides.contentExcerpt ?? 'Skill excerpt only; prompts, credentials, and full content are excluded.',
  }
}

/** §30.3 AGENT 交付项：canSubmitReview 恒 false；capabilities 由 teamRole 决定 */
function agentItem(overrides: Partial<AgentDeliveryItem> & Pick<AgentDeliveryItem, 'id' | 'resourceId' | 'title' | 'displayStatus' | 'agentVisibility'>): AgentDeliveryItem {
  return {
    id: overrides.id,
    projectId: overrides.projectId ?? 'project-delivery-center',
    resourceType: 'AGENT',
    resourceId: overrides.resourceId,
    openTarget: overrides.openTarget ?? { kind: 'AGENT', agentId: overrides.resourceId },
    title: overrides.title,
    summary: null,
    version: null,
    displayStatus: overrides.displayStatus,
    resourceStatus: 'ACTIVE',
    requirementGroup: overrides.requirementGroup ?? null,
    source: overrides.source ?? sourceWithoutTask,
    creator: member,
    submitter: overrides.submitter ?? member,
    reviewer: overrides.reviewer ?? null,
    reviewReason: overrides.reviewReason ?? null,
    createdAt: '2026-08-14T08:00:00Z',
    submittedAt: overrides.submittedAt ?? '2026-08-14T08:30:00Z',
    reviewedAt: overrides.reviewedAt ?? null,
    updatedAt: '2026-08-14T09:00:00Z',
    capabilities: overrides.capabilities ?? capabilities(overrides.agentVisibility === 'PENDING', false, false, overrides.agentVisibility === 'TEAM'),
    role: overrides.role ?? 'DEVELOPER',
    descriptionExcerpt: overrides.descriptionExcerpt ?? '负责后端接口与数据层实现。',
    isDefault: false,
    agentVisibility: overrides.agentVisibility,
  }
}

export const deliveryCenterFixtures: Record<string, DeliveryItem[]> = {
  'project-delivery-center': [
    memoryItem({ id: 'delivery-memory-draft', resourceId: 'memory-draft-001', title: 'Draft memory', displayStatus: 'DRAFT', resourceStatus: 'DRAFT', visibility: 'PROJECT_SHARED' }),
    memoryItem({ id: 'delivery-memory-pending', resourceId: 'memory-pending-001', title: 'Pending memory', displayStatus: 'PENDING_REVIEW', resourceStatus: 'PENDING_REVIEW', visibility: 'PROJECT_SHARED', submittedAt: '2026-08-12T09:00:00Z' }),
    memoryItem({ id: 'delivery-memory-approved', resourceId: 'memory-approved-001', title: 'Approved memory', displayStatus: 'ACCEPTED', resourceStatus: 'APPROVED', visibility: 'PROJECT_SHARED', reviewer, reviewedAt: '2026-08-13T09:00:00Z' }),
    skillItem({ id: 'delivery-skill-published', resourceId: 'skill-published-001', title: 'Published skill', displayStatus: 'ACCEPTED', resourceStatus: 'PUBLISHED', visibility: 'PROJECT_SHARED', reviewer, reviewedAt: '2026-08-13T10:00:00Z', capabilitySummary: null }),
    skillItem({ id: 'delivery-skill-rejected', resourceId: 'skill-rejected-001', title: 'Rejected skill', displayStatus: 'REJECTED', resourceStatus: 'REJECTED', visibility: 'PRIVATE', reviewReason: 'Needs a narrower capability boundary', reviewer, reviewedAt: '2026-08-13T11:00:00Z' }),
    codeItem({ id: 'delivery-code-processing', resourceId: 'diff-review-processing', title: 'Code delivery in progress', displayStatus: 'PROCESSING', resourceStatus: 'DELIVERING', reviewStatus: 'ACCEPTED', deliveryStatus: 'DELIVERING', mergeRequest: null, repositoryDeliveries: [{ repositoryId: 'repo-main', repositoryName: 'qgents-web', deliveryStatus: 'NOT_STARTED', failureCode: null, failureReason: null, mergeRequest: null, updatedAt: '2026-08-14T08:00:00Z' }] }),
    codeItem({ id: 'delivery-code-partial', resourceId: 'diff-review-partial', title: 'Code delivery partially failed', displayStatus: 'FAILED', resourceStatus: 'PARTIALLY_DELIVERED', reviewStatus: 'ACCEPTED', deliveryStatus: 'PARTIALLY_DELIVERED', capabilities: capabilities(false, false, true), repositories: [{ repositoryId: 'repo-main', name: 'qgents-web', branch: 'feat/delivery-center' }, { repositoryId: 'repo-docs', name: 'qgents-docs', branch: 'feat/delivery-center' }], repositoryDeliveries: [{ repositoryId: 'repo-main', repositoryName: 'qgents-web', deliveryStatus: 'MR_CREATED', failureCode: null, failureReason: null, mergeRequest: { id: 'mr-001', number: 18, title: 'Delivery Center change', status: 'OPEN', webUrl: 'https://github.com/example/qgents-web/pull/18' }, updatedAt: '2026-08-14T08:00:00Z' }, { repositoryId: 'repo-docs', repositoryName: 'qgents-docs', deliveryStatus: 'FAILED', failureCode: 'PUSH_REJECTED', failureReason: 'Remote branch changed', mergeRequest: null, updatedAt: '2026-08-14T08:00:00Z' }] }),
    codeItem({ id: 'delivery-code-delivered', resourceId: 'diff-review-delivered', title: 'Delivered code', displayStatus: 'DELIVERED', resourceStatus: 'DELIVERED', reviewStatus: 'ACCEPTED', deliveryStatus: 'DELIVERED', capabilities: capabilities(false, false) }),
    codeItem({ id: 'delivery-code-archived', resourceId: 'diff-review-archived', title: 'Archived code', displayStatus: 'ARCHIVED', resourceStatus: 'ARCHIVED', reviewStatus: 'REJECTED', deliveryStatus: 'FAILED', capabilities: capabilities(false, false), reviewer, reviewedAt: '2026-08-12T11:00:00Z', reviewReason: 'Archived after review' }),
    // §30.3 AGENT 交付样例：PENDING 等审核 / TEAM 已发布 / ARCHIVED 已归档
    agentItem({ id: 'delivery-agent-pending', resourceId: 'agent-pending-frontend', title: 'Frontend Developer Agent', displayStatus: 'PENDING_REVIEW', agentVisibility: 'PENDING' }),
    agentItem({ id: 'delivery-agent-team', resourceId: 'agent-team-tester', title: 'Tester Agent', displayStatus: 'ACCEPTED', agentVisibility: 'TEAM', capabilities: capabilities(false, false, false, true) }),
  ],
  'project-no-approval': [
    memoryItem({ id: 'delivery-member-pending', projectId: 'project-no-approval', resourceId: 'memory-member-pending', title: 'Member pending memory', displayStatus: 'PENDING_REVIEW', resourceStatus: 'PENDING_REVIEW', visibility: 'PROJECT_SHARED', capabilities: capabilities(false, false) }),
  ],
  'project-empty': [],
}
