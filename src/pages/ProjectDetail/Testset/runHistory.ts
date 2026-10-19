import type { LocalRunHistoryItem } from '@/types/testset'

const STORAGE_PREFIX = 'qgents:testset-run-history:'
const MAX_ITEMS = 50

/** 会话历史的 localStorage 键（按项目隔离） */
function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`
}

/**
 * 读取本页会话内发起过的 Test Run / Dry-run。
 * 后端没有历史列表接口（分工：缺少时先本地记录），联调后若补 GET 列表只需替换这里。
 */
export function readRunHistory(projectId: string): LocalRunHistoryItem[] {
  if (!projectId || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isHistoryItem).slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

/** 把一次新发起的运行记入本地历史（最新在前） */
export function pushRunHistory(projectId: string, item: LocalRunHistoryItem): LocalRunHistoryItem[] {
  const next = [item, ...readRunHistory(projectId).filter((row) => row.id !== item.id)].slice(0, MAX_ITEMS)
  return writeRunHistory(projectId, next)
}

/** 从本地历史里删掉一条（只清浏览器记录，不调后端删除接口） */
export function removeRunHistory(projectId: string, runId: string): LocalRunHistoryItem[] {
  const next = readRunHistory(projectId).filter((row) => row.id !== runId)
  return writeRunHistory(projectId, next)
}

function writeRunHistory(projectId: string, next: LocalRunHistoryItem[]): LocalRunHistoryItem[] {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(next))
  } catch {
    /* 配额满时忽略，页面仍能展示当前列表 */
  }
  return next
}

/** 判断本地历史项形状是否合法 */
function isHistoryItem(value: unknown): value is LocalRunHistoryItem {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    (row.kind === 'TEST_RUN' || row.kind === 'DRY_RUN') &&
    typeof row.id === 'string' &&
    typeof row.repositoryId === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.label === 'string'
  )
}
