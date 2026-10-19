import type { CursorPage } from './api'

export type DeliveryResourceType = 'CODE' | 'MEMORY' | 'SKILL' | 'AGENT'
export type DeliveryDisplayStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'DELIVERED'
  | 'FAILED'
  | 'ARCHIVED'

export type DeliveryOpenTarget =
  | { kind: 'TASK_DIFF_REVIEW'; taskId: string; diffReviewBatchId: string }
  | { kind: 'DIFF'; taskId: string; diffId: string }
  | { kind: 'MEMORY'; memoryId: string }
  | { kind: 'SKILL'; skillId: string }
  | { kind: 'AGENT'; agentId: string }

export type DeliverySource = {
  taskId: string | null
  taskDisplayCode: string | null
  taskTitle: string | null
  taskRunId: string | null
  taskStepId: string | null
  messageId: string | null
  artifactId: string | null
}

export interface DeliveryActor {
  id: string
  displayName: string
  avatarUrl: string | null
}

export interface DeliveryRequirementGroup {
  id: string
  name: string
}

export interface DeliveryCapabilities {
  canSubmitReview: boolean
  canApprove: boolean
  canReject: boolean
  canArchive: boolean
  canRetryDelivery: boolean
  canOpenResource: boolean
  disabledReasons: {
    canSubmitReview: string | null
    canApprove: string | null
    canReject: string | null
    canArchive: string | null
    canRetryDelivery: string | null
    canOpenResource: string | null
  }
}

export interface DeliveryRepositoryRef {
  repositoryId: string
  name: string
  branch: string | null
}

export type CodeReviewStatus = 'PENDING_CONFIRMATION' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED'
export type CodeDeliveryStatus = 'NOT_STARTED' | 'DELIVERING' | 'DELIVERED' | 'PARTIALLY_DELIVERED' | 'FAILED'

export interface CodeRepositoryDelivery {
  repositoryId: string
  repositoryName: string
  deliveryStatus: 'NOT_STARTED' | 'COMMITTED' | 'MR_CREATED' | 'FAILED'
  failureCode: string | null
  failureReason: string | null
  mergeRequest: DeliveryMergeRequestSummary | null
  updatedAt: string
}

export interface DeliveryMergeRequestSummary {
  id: string
  number: number
  title: string
  status: string
  webUrl: string | null
}

interface DeliveryItemBase<TOpenTarget extends DeliveryOpenTarget = DeliveryOpenTarget> {
  id: string
  projectId: string
  resourceId: string
  openTarget: TOpenTarget
  title: string
  summary: string | null
  version: string | null
  displayStatus: DeliveryDisplayStatus
  resourceStatus: string
  requirementGroup: DeliveryRequirementGroup | null
  source: DeliverySource
  creator: DeliveryActor
  submitter: DeliveryActor | null
  reviewer: DeliveryActor | null
  reviewReason: string | null
  createdAt: string
  submittedAt: string | null
  reviewedAt: string | null
  updatedAt: string
  capabilities: DeliveryCapabilities
}

export interface CodeDeliveryItem extends DeliveryItemBase<Extract<DeliveryOpenTarget, { kind: 'TASK_DIFF_REVIEW' }>> {
  resourceType: 'CODE'
  repositories: DeliveryRepositoryRef[]
  diffReviewId: string
  diffId: string | null
  reviewStatus: CodeReviewStatus
  deliveryStatus: CodeDeliveryStatus
  filesChanged: number
  additions: number
  deletions: number
  repositoryDeliveries: CodeRepositoryDelivery[]
  mergeRequest: DeliveryMergeRequestSummary | null
}

export interface MemorySource {
  groupId: string | null
  messageId: string
}

export interface MemoryDeliveryItem extends DeliveryItemBase<Extract<DeliveryOpenTarget, { kind: 'MEMORY' }>> {
  resourceType: 'MEMORY'
  category: string
  tags: string[]
  visibility: 'PROJECT_SHARED'
  sources: MemorySource[]
  contentExcerpt: string | null
}

export interface SkillDeliveryItem extends DeliveryItemBase<Extract<DeliveryOpenTarget, { kind: 'SKILL' }>> {
  resourceType: 'SKILL'
  tags: string[]
  visibility: 'PRIVATE' | 'PROJECT_SHARED'
  capabilitySummary: string | null
  contentExcerpt: string | null
}

/** §30.3 交付中心 AGENT 类型：PENDING/TEAM/ARCHIVED 进入；PRIVATE/SYSTEM 不进入。 */
export interface AgentDeliveryItem extends DeliveryItemBase<Extract<DeliveryOpenTarget, { kind: 'AGENT' }>> {
  resourceType: 'AGENT'
  role: string
  descriptionExcerpt: string | null
  isDefault: false
  /** §30.3 唯一允许存在的内部状态值：PENDING / TEAM / ARCHIVED。 */
  agentVisibility: 'PENDING' | 'TEAM' | 'ARCHIVED'
}

export type DeliveryItem = CodeDeliveryItem | MemoryDeliveryItem | SkillDeliveryItem | AgentDeliveryItem

export interface DeliveryItemsFilters {
  groupId?: string
  type?: DeliveryResourceType
  status?: DeliveryDisplayStatus
  repositoryId?: string
  createdBy?: string
  keyword?: string
  cursor?: string
  limit?: number
}

export type DeliveryItemsResponse = CursorPage<DeliveryItem> & { requestId: string }

export interface DeliveryCountsByType {
  CODE: number
  MEMORY: number
  SKILL: number
  AGENT: number
}

export type DeliveryStatusCounts = Record<DeliveryDisplayStatus, number>

export interface DeliveryRepositorySummary {
  repositoryId: string
  repositoryName: string
  total: number
  accepted: number
  pending: number
  failed: number
  deliveryStatus: CodeRepositoryDelivery['deliveryStatus'] | null
  mergeRequest: DeliveryMergeRequestSummary | null
}

export interface DeliveryRequirementGroupSummary {
  requirementGroupId: string
  name: string
  total: number
  pending: number
}

export interface DeliverySummary {
  total: number
  countsByType: DeliveryCountsByType
  countsByStatus: DeliveryStatusCounts
  pendingForCurrentUser: number
  repositorySummaries: DeliveryRepositorySummary[]
  requirementGroupSummaries: DeliveryRequirementGroupSummary[]
  updatedAt: string
}

/** Runtime v1.8.0 response observed from the Delivery Summary endpoint. */
export type DeliverySummaryResponse = DeliverySummary

export interface DeliverySummaryFilters {
  groupId?: string
  type?: DeliveryResourceType
  status?: DeliveryDisplayStatus
  repositoryId?: string
  createdBy?: string
  keyword?: string
}

export type DeliveryAction =
  | 'submitReview'
  | 'approve'
  | 'reject'
  | 'archive'
  | 'confirm'
  | 'retryDelivery'

export interface DeliveryActionInput {
  projectId: string
  /** §30.3 AGENT 操作需要 teamId 命中 /api/teams/{teamId}/agents/{agentId}/... */
  teamId?: string
  item: DeliveryItem
  action: DeliveryAction
  reason?: string
}
