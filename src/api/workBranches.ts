import { request } from './client'
import type { WorkBranch, WorkBranchListFilters } from '@/types/workBranch'

interface ApiEnvelope<T> {
  data: T
  page?: { nextCursor: string | null; hasMore: boolean }
  requestId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? value : ''
}

function readNullableString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : null
}

function readNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key]
  return typeof value === 'number' ? value : Number(value) || 0
}

function mapFinalDiff(raw: unknown): { id: string } | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (!isRecord(raw)) return null
  const id = readString(raw, 'id')
  return id ? { id } : null
}

function mapLatestTask(raw: unknown): WorkBranch['latestTask'] {
  if (!isRecord(raw)) return null
  const id = readString(raw, 'id')
  if (!id) return null
  const finalDiff = mapFinalDiff(raw.finalDiff)
  return {
    id,
    displayCode: readString(raw, 'displayCode') || id,
    title: readString(raw, 'title'),
    ...(finalDiff !== undefined ? { finalDiff } : {}),
  }
}

function mapRequirementGroups(raw: unknown): WorkBranch['requirementGroups'] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = readString(item, 'id')
    if (!id) return []
    return [{ id, title: readString(item, 'title') || id }]
  })
}

function mapLatestDiff(raw: unknown): WorkBranch['latestDiff'] {
  if (!isRecord(raw)) return null
  const id = readString(raw, 'id')
  if (!id) return null
  const stats = isRecord(raw.changeStats) ? raw.changeStats : {}
  return {
    id,
    taskId: readNullableString(raw, 'taskId'),
    status: readString(raw, 'status') || 'PENDING_REVIEW',
    changeStats: {
      additions: readNumber(stats, 'additions'),
      deletions: readNumber(stats, 'deletions'),
      files: readNumber(stats, 'files') || undefined,
    },
  }
}

function mapOpenMr(raw: unknown): WorkBranch['openMergeRequest'] {
  if (!isRecord(raw)) return null
  const id = readString(raw, 'id')
  if (!id) return null
  return {
    id,
    number: readNumber(raw, 'number'),
    status: readString(raw, 'status') || 'OPEN',
  }
}

function mapVerification(raw: unknown): WorkBranch['lastVerification'] {
  if (!isRecord(raw)) return null
  const commitSha = readString(raw, 'commitSha')
  if (!commitSha) return null
  return {
    kind: readNullableString(raw, 'kind'),
    status: readString(raw, 'status') || 'PENDING',
    commitSha,
    completedAt: readString(raw, 'completedAt'),
  }
}

export function mapWorkBranch(raw: unknown): WorkBranch | null {
  if (!isRecord(raw)) return null
  const projectRepositoryId = readString(raw, 'projectRepositoryId') || readString(raw, 'repositoryId')
  const name = readString(raw, 'name')
  if (!projectRepositoryId || !name) return null
  const id = readString(raw, 'id')
  return {
    id: id || undefined,
    projectRepositoryId,
    name,
    workspaceId: readNullableString(raw, 'workspaceId'),
    lastKnownHead: readNullableString(raw, 'lastKnownHead'),
    latestTask: mapLatestTask(raw.latestTask),
    requirementGroups: mapRequirementGroups(raw.requirementGroups),
    latestDiff: mapLatestDiff(raw.latestDiff),
    openMergeRequest: mapOpenMr(raw.openMergeRequest),
    lastVerification: mapVerification(raw.lastVerification),
  }
}

function buildQuery(filters: WorkBranchListFilters): string {
  const params = new URLSearchParams()
  if (filters.repositoryId) params.set('repositoryId', filters.repositoryId)
  if (filters.requirementGroupId) params.set('requirementGroupId', filters.requirementGroupId)
  if (filters.cursor) params.set('cursor', filters.cursor)
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  const q = params.toString()
  return q ? `?${q}` : ''
}

export const workBranchesApi = {
  /**
   * GET /projects/{projectId}/work-branches
   * repositoryId / requirementGroupId 均为 project 侧 UUID；未传 = 不过滤。
   */
  list(projectId: string, filters: WorkBranchListFilters = {}) {
    return request<ApiEnvelope<unknown>>(
      `/projects/${projectId}/work-branches${buildQuery(filters)}`,
      { unwrapData: false },
    ).then((res) => {
      const rows = Array.isArray(res.data) ? res.data : []
      return {
        data: rows.map(mapWorkBranch).filter((item): item is NonNullable<typeof item> => item !== null),
        page: res.page ?? { nextCursor: null, hasMore: false },
        requestId: res.requestId,
      }
    })
  },
}
