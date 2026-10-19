import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, App, Button, Empty, Input, Select, Space, Spin, Table, Tag, Typography, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PATHS } from '@/routes/paths'
import { mergeRequestsApi } from '@/api/taskModel'
import {
  useMergeMergeRequest,
  useMergeRequests,
  useRequestMergeRequestPreflight,
  useRetryMergeRequestPreflight,
  useSyncMergeRequest,
} from '@/hooks/task-model'
import { formatApiError } from '@/utils/formatApiError'
import { ApiError } from '@/api/client'
import type { ProjectBoundRepository } from '@/types/github'
import type {
  MergeRequestStatus,
  MergeRequestSummary,
  PreflightStatus,
} from '@/types/task-model'
import { githubPullRequestUrl } from './mergeRequestDisplay'

const { Text } = Typography

const STATUS_OPTIONS: Array<{ value: MergeRequestStatus; label: string }> = [
  { value: 'PENDING_CREATE', label: '待发起' },
  { value: 'OPEN', label: '进行中' },
  { value: 'MERGED', label: '已合并' },
  { value: 'CLOSED', label: '已关闭（未合并）' },
]

function isMergeRequestStatus(value: string | null): value is MergeRequestStatus {
  return value === 'OPEN' || value === 'MERGED' || value === 'CLOSED' || value === 'PENDING_CREATE'
}

function statusLabel(status: MergeRequestStatus): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status
}

function statusColor(status: MergeRequestStatus): string {
  if (status === 'OPEN') return 'blue'
  if (status === 'MERGED') return 'green'
  if (status === 'CLOSED') return 'default'
  // PENDING_CREATE：占位 MR，GitHub PR 尚未创建
  return 'cyan'
}

/**
 * 前端派生状态：严格按 PreflightStatus 区分不同阶段，便于用户理解 Dry Run 是否已通过。
 *  - 'IDLE'                未申请预检
 *  - 'DRY_RUN_RUNNING'     Dry Run 执行中（请求受理 / 排队 / 实际执行）
 *  - 'WAITING_CQ'          Dry Run 已通过，等待独立成员 CQ+1 盖章
 *  - 'READY_CREATE'        DryRun + CQ+1 都通过，等待人工点「创建MR」（仅 MANUAL 模式）
 *  - 'CREATING'            用户点了创建MR，后端正在建 PR
 *  - 'MR_CREATED'          MR 已创建（GitHub PR 已存在）
 *  - 'FAILED'              预检失败（Dry Run 失败 / CQ 被拒 / Worker 不可用等）
 */
type EffectiveState =
  | 'IDLE'
  | 'DRY_RUN_RUNNING'
  | 'WAITING_CQ'
  | 'READY_CREATE'
  | 'CREATING'
  | 'MR_CREATED'
  | 'NO_CHANGES'
  | 'FAILED'

type PreflightUiStatus = PreflightStatus | 'NO_CHANGES'

function deriveEffectiveState(
  status: string | null | undefined,
  createMode: 'MANUAL' | 'SYSTEM' | 'UNKNOWN' | undefined,
  cqApproved: boolean,
): EffectiveState {
  switch (status) {
    case null:
    case undefined:
      return 'IDLE'
    // 来自 task-model.ts 的预检状态（创建响应）
    case 'REQUESTED':
    case 'DRY_RUN_QUEUED':
    case 'DRY_RUN_RUNNING':
      return 'DRY_RUN_RUNNING'
    case 'WAITING_CQ':
      if (createMode === 'MANUAL' && cqApproved) return 'READY_CREATE'
      return 'WAITING_CQ'
    case 'CREATING_MR':
      return 'CREATING'
    case 'CQ_REJECTED':
    case 'FAILED':
    case 'STALE':
      return 'FAILED'
    case 'MR_CREATED':
      return 'MR_CREATED'
    case 'NO_CHANGES':
      return 'NO_CHANGES'
    // 来自 qualityGate.ts 的预检状态（轮询接口）
    case 'PENDING':
      return 'DRY_RUN_RUNNING'  // PENDING = Dry Run 正在运行
    case 'PASSED':
      if (createMode === 'MANUAL' && cqApproved) return 'READY_CREATE'
      return 'WAITING_CQ'  // PASSED = Dry Run 通过，等待 CQ+1
    default:
      return 'IDLE'
  }
}

function preflightButtonLabel(
  eff: EffectiveState,
  isAdmin: boolean = false,
): { text: string; loading: boolean; disabled: boolean; failed: boolean; clickable: boolean } {
  switch (eff) {
    case 'IDLE':
      return { text: '申请MR', loading: false, disabled: false, failed: false, clickable: true }
    case 'DRY_RUN_RUNNING':
      return { text: '待预检通过', loading: true, disabled: true, failed: false, clickable: false }
    case 'WAITING_CQ':
      return { text: '等待 CQ+1', loading: false, disabled: true, failed: false, clickable: false }
    case 'READY_CREATE':
      // CQ+1通过后，需要用户再点「创建MR」
      return { text: '创建MR', loading: false, disabled: false, failed: false, clickable: true }
    case 'CREATING':
      return { text: '正在创建 MR', loading: true, disabled: true, failed: false, clickable: false }
    case 'MR_CREATED':
      // MR 已创建：Admin 显示"合并"按钮，非 Admin 显示"已创建成功"（禁用）
      if (isAdmin) {
        return { text: '合并', loading: false, disabled: false, failed: false, clickable: true }
      }
      return { text: '已创建成功', loading: false, disabled: true, failed: false, clickable: false }
    case 'NO_CHANGES':
      return { text: '无新增变更', loading: false, disabled: true, failed: false, clickable: false }
    case 'FAILED':
      // 预检失败：允许用户点击重新发起预检
      return { text: '重新预检', loading: false, disabled: false, failed: true, clickable: true }
  }
}

function preflightTagText(eff: EffectiveState): string {
  switch (eff) {
    case 'IDLE': return '尚未预检'
    case 'DRY_RUN_RUNNING': return '正在进行质量门禁'
    case 'WAITING_CQ': return '等待 CQ+1'
    case 'READY_CREATE': return '可创建 MR'
    case 'CREATING': return '正在创建 MR'
    case 'MR_CREATED': return '待合并'  // 用户要求：状态列显示"待合并"
    case 'NO_CHANGES': return '无新增变更'
    case 'FAILED': return '预检失败'
  }
}

function preflightTagColor(eff: EffectiveState): string {
  switch (eff) {
    case 'IDLE': return 'cyan'
    case 'DRY_RUN_RUNNING': return 'processing'
    case 'WAITING_CQ': return 'warning'
    case 'READY_CREATE': return 'warning'
    case 'CREATING': return 'processing'
    case 'MR_CREATED': return 'blue'
    case 'NO_CHANGES': return 'default'
    case 'FAILED': return 'error'
  }
}

function shortSha(value: string | null): string {
  if (!value) return '—'
  return value.slice(0, 7)
}

function repoLabel(repositories: ProjectBoundRepository[], repositoryId: string): string {
  const repo = repositories.find((item) => item.id === repositoryId)
  return repo?.displayName || repo?.fullName || repositoryId
}

function isNoChangesError(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.body) return false
  const body = error.body as { error?: { code?: string } }
  return body.error?.code === 'MR_NO_CHANGES'
}

function mergeRequestRowEqual(left: MergeRequestSummary, right: MergeRequestSummary): boolean {
  return left.id === right.id
    && left.status === right.status
    && left.number === right.number
    && left.webUrl === right.webUrl
    && left.sourceBranch === right.sourceBranch
    && left.targetBranch === right.targetBranch
    && left.headCommit === right.headCommit
    && left.mergeOperationStatus === right.mergeOperationStatus
    && left.mergeOperationFailureCode === right.mergeOperationFailureCode
    && left.mergeOperationFailureReason === right.mergeOperationFailureReason
    && left.qualityGate?.status === right.qualityGate?.status
}

function dedupeMergeRequestRows(rows: MergeRequestSummary[]): MergeRequestSummary[] {
  const byId = new Map<string, MergeRequestSummary>()
  for (const row of rows) {
    const previous = byId.get(row.id)
    if (!previous) {
      byId.set(row.id, row)
      continue
    }
    // Keep the most complete representation when a placeholder and a refreshed
    // copy of the same MR arrive in one response.
    byId.set(row.id, {
      ...previous,
      ...row,
      webUrl: row.webUrl ?? previous.webUrl,
      number: row.number > 0 ? row.number : previous.number,
    })
  }
  return [...byId.values()]
}

export function MergeRequestTab({
  projectId,
  repositories,
  isAdmin = false,
}: {
  projectId: string
  repositories: ProjectBoundRepository[]
  isAdmin?: boolean
}) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const repositoryId = searchParams.get('repositoryId')?.trim() || undefined
  const statusParam = searchParams.get('status')
  const status = isMergeRequestStatus(statusParam) ? statusParam : undefined
  const { modal, message } = App.useApp()

  const query = useMergeRequests(projectId, {
    repositoryId,
    status,
    limit: 50,
  })
  // 使用本地 state 包裹，允许预检 MR_CREATED 时乐观回写 webUrl/number
  const [items, setItems] = useState<MergeRequestSummary[]>(query.data?.data ?? [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const lastDataRef = useRef(query.data?.data)
  useEffect(() => {
    const latest = dedupeMergeRequestRows(query.data?.data ?? [])
    if (lastDataRef.current === query.data?.data) return // query data 引用未更新，跳过
    lastDataRef.current = query.data?.data
    setItems((prev) => {
      const current = dedupeMergeRequestRows(prev)
      const latestIds = latest.map((m) => m.id).join('|')
      const prevIds = current.map((m) => m.id).join('|')
      if (latestIds !== prevIds) return latest
      const next = latest.map((m) => {
        const local = current.find((p) => p.id === m.id)
        if (!local) return m
        return {
          ...m,
          webUrl: m.webUrl ?? local.webUrl,
          number: m.number ?? local.number,
        }
      })
      return next.every((row, index) => mergeRequestRowEqual(row, current[index])) ? current : next
    })
  }, [query.data?.data])

  // 后端按 status 过滤；这里再做一次显示层过滤，避免切换筛选时本地乐观 state
  // 短暂保留上一个查询结果，导致 OPEN/MERGED 混入 PENDING_CREATE 列表。
  const displayItems = useMemo(() => {
    const unique = dedupeMergeRequestRows(items)
    return status ? unique.filter((item) => item.status === status) : unique
  }, [items, status])

  const mergeMr = useMergeMergeRequest(projectId)
  const requestPreflight = useRequestMergeRequestPreflight(projectId)
  const retryPreflight = useRetryMergeRequestPreflight(projectId)
  const syncMr = useSyncMergeRequest(projectId)
  const [mergingId, setMergingId] = useState<string | null>(null)
  const previousMergeStatusesRef = useRef<Record<string, string | null>>({})
  useEffect(() => {
    const previous = previousMergeStatusesRef.current
    for (const item of items) {
      if (item.mergeOperationStatus === 'FAILED' && previous[item.id] === 'RUNNING') {
        message.error(item.mergeOperationFailureReason || 'GitHub 拒绝了合并请求，请检查 MR 状态后重试')
      }
    }
    previousMergeStatusesRef.current = Object.fromEntries(
      items.map((item) => [item.id, item.mergeOperationStatus ?? null]),
    )
  }, [items, message])
  const [creatingId, setCreatingId] = useState<string | null>(null)
  // 记录每行的预检状态（前端跟踪，真实环境由 SSE/后端返回）
  const [preflightStatusMap, setPreflightStatusMap] = useState<Record<string, PreflightUiStatus>>({})
  const [preflightFailureMap, setPreflightFailureMap] = useState<Record<string, {
    reason: string | null
    stage: string | null
    workerCode: string | null
    workerHttpStatus: number | null
    details: Array<Record<string, unknown>>
  }>>({})
  const [preflightIdMap, setPreflightIdMap] = useState<Record<string, string>>({})
  // 自动模式提交预检请求期间，不能把“请求尚未返回”误显示成“待预检通过”。
  const [preflightRequestingIds, setPreflightRequestingIds] = useState<Set<string>>(new Set())
  const [coverageMap, setCoverageMap] = useState<Record<string, { taskCount: number; diffCount: number }>>({})
  // 预检状态是否正在加载（用于显示 loading 状态）
  const [preflightLoading, setPreflightLoading] = useState(false)
  // 已完成加载预检状态的 MR ID 集合
  const [loadedPreflightIds, setLoadedPreflightIds] = useState<Set<string>>(new Set())
  // 标记是否已完成"首轮回溯查询"——首次挂载/列表首次就绪时，不管 MANUAL 还是 SYSTEM，
  // 都必须向后端查一次，恢复用户在其他页面/会话中已经发起的预检状态。之后才进入"MANUAL
  // 未显式点击就跳过"的保守轮询模式，避免过度请求。
  const [initialRecoveryDone, setInitialRecoveryDone] = useState(false)
  const [preflightRefreshVersion, setPreflightRefreshVersion] = useState(0)
  const initialRecoveryDoneRef = useRef(false)
  initialRecoveryDoneRef.current = initialRecoveryDone
  // 轮询过程中状态会持续更新，但不能因此取消当前批次的请求。
  const preflightStatusMapRef = useRef(preflightStatusMap)
  preflightStatusMapRef.current = preflightStatusMap
  const preflightRefreshInFlightRef = useRef(false)

  // The MR list can refresh after CQ approval while the asynchronous MR
  // creation is still pending. Reset only the non-terminal local states so a
  // stale WAITING_CQ entry cannot keep its CQ+1 link clickable.
  const lastPreflightResetDataRef = useRef(query.data?.data)
  useEffect(() => {
    if (lastPreflightResetDataRef.current === query.data?.data) return
    lastPreflightResetDataRef.current = query.data?.data
    const pendingIds = new Set(
      (query.data?.data ?? [])
        .filter((row) => row.status === 'PENDING_CREATE')
        .map((row) => row.id),
    )
    setPreflightStatusMap((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of pendingIds) {
        if (preflightRequestingIds.has(id)) continue
        if (next[id] && !['MR_CREATED', 'NO_CHANGES', 'FAILED', 'STALE', 'CQ_REJECTED'].includes(next[id])) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
    setLoadedPreflightIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of pendingIds) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
    setInitialRecoveryDone(false)
    setPreflightRefreshVersion((version) => version + 1)
  }, [query.data?.data, preflightRequestingIds])

  // 页面加载和真实占位行替换时恢复已启动的预检状态。
  // 优化：使用并发控制（最多 3 个同时请求），避免超过浏览器并发限制
  const CONCURRENCY_LIMIT = 3
  const PREFLIGHT_QUERY_TIMEOUT_MS = 8000
  const preflightPolling = true
  const [preflightPollingInterval] = useState(10000)  // 轮询间隔

  // 并发控制：限制同时发出的请求数量
  async function asyncPool<T>(
    items: T[],
    limit: number,
    iteratorFn: (item: T) => Promise<void>,
  ) {
    const executing: Promise<void>[] = []
    for (const item of items) {
      const p = iteratorFn(item).finally(() => {
        const idx = executing.indexOf(p)
        if (idx > -1) executing.splice(idx, 1)
      })
      executing.push(p)
      if (executing.length >= limit) {
        await Promise.race(executing)
      }
    }
    await Promise.all(executing)
  }

  // GitHub webhook 可能因本地测试环境、隧道或网络问题延迟到达；定期同步 OPEN MR，
  // 避免远端已合并但本地镜像仍显示“合并MR”。列表只同步当前前 20 条，且限制并发量。
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const MR_SYNC_INTERVAL_MS = 15000
    const MR_SYNC_CONCURRENCY = 3

    const refreshRemoteStatuses = async () => {
      const openRows = itemsRef.current
        .filter((mr) => mr.status === 'OPEN' && Boolean(mr.id))
        .slice(0, 20)
      await asyncPool(openRows, MR_SYNC_CONCURRENCY, async (row) => {
        try {
          const synced = await syncMr.mutateAsync(row.id)
          if (cancelled) return
          setItems((prev) => {
            let changed = false
            const next = prev.map((item) => {
              if (item.id !== synced.id) return item
              const updated = { ...item, ...synced }
              if (!mergeRequestRowEqual(item, updated)) changed = true
              return changed ? updated : item
            })
            return changed ? next : prev
          })
        } catch {
          // webhook 或后续轮询可能完成同步；单行同步失败不影响列表其余内容。
        }
      })
      if (!cancelled) {
        timer = setTimeout(() => void refreshRemoteStatuses(), MR_SYNC_INTERVAL_MS)
      }
    }

    void refreshRemoteStatuses()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (displayItems.length === 0) return // 等待 MR 列表加载完成
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = async () => {
      if (preflightRefreshInFlightRef.current) {
        // A list refresh may restart this effect while the previous batch is
        // still waiting on the API. Keep a retry timer so polling does not die
        // when that happens, while still avoiding overlapping batches.
        if (!cancelled) timer = setTimeout(() => void refresh(), 1000)
        return
      }
      preflightRefreshInFlightRef.current = true
      const taskIds = new Set<string>()
      const pendingRows = displayItems.filter((mr) => {
        const currentStatus = preflightStatusMapRef.current[mr.id]
        const terminal = currentStatus === 'NO_CHANGES'
          || currentStatus === 'FAILED'
          || currentStatus === 'STALE'
          || currentStatus === 'CQ_REJECTED'
          || currentStatus === 'MR_CREATED'
        if (mr.status === 'PENDING_CREATE' && mr.taskId && !terminal) {
          // 首轮回溯阶段：不管 MANUAL / SYSTEM，只要是 PENDING_CREATE + 有 taskId 都查，
          // 用于恢复用户在之前页面、之前会话已经发起的预检状态。
          if (!initialRecoveryDoneRef.current) {
            taskIds.add(mr.taskId)
            return true
          }
          // DIFF_FIRST (MANUAL) 模式：只有用户显式点击"申请MR"后才允许后续持续轮询
          // 如果 preflightStatusMap 中没有该 MR 的状态，说明尚未发起预检，跳过轮询
          if (mr.createMode === 'MANUAL' && !currentStatus) {
            return false
          }
          taskIds.add(mr.taskId)
          return true
        }
        return false
      })

      if (taskIds.size === 0) {
        preflightRefreshInFlightRef.current = false
        setPreflightLoading(false)
        // 没有要查询的任务也视为"首轮回溯完成"（比如所有行都已经是终态或列表为空）
        if (!initialRecoveryDoneRef.current) {
          setInitialRecoveryDone(true)
        }
        return
      }
      setPreflightLoading(true)

      try {
        const newMap: Record<string, PreflightUiStatus> = {}
        const loadedIds = new Set<string>()

        // 使用并发控制，最多 CONCURRENCY_LIMIT 个同时请求
        await asyncPool(Array.from(taskIds), CONCURRENCY_LIMIT, async (taskId) => {
          if (cancelled) return
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), PREFLIGHT_QUERY_TIMEOUT_MS)
          const taskMrRows = pendingRows.filter((mr) => mr.taskId === taskId)
          try {
            const res = await mergeRequestsApi.getTaskPreflight(projectId, taskId, controller.signal)
            if (cancelled) return
            taskMrRows.forEach((mr) => loadedIds.add(mr.id))
            if (res?.items?.length) {
              taskMrRows.forEach((mr) => {
                const repoStatus = res.items.find((it) => it.repositoryId === mr.repositoryId)
                if (repoStatus) {
                  setPreflightFailureMap((prev) => ({
                    ...prev,
                    [mr.id]: {
                      reason: repoStatus.failureReason,
                      stage: repoStatus.failureStage ?? null,
                      workerCode: repoStatus.workerCode ?? null,
                      workerHttpStatus: repoStatus.workerHttpStatus ?? null,
                      details: repoStatus.failureDetails ?? [],
                    },
                  }))
                }
                if (repoStatus?.preflightId) {
                  setPreflightIdMap((prev) => ({ ...prev, [mr.id]: repoStatus.preflightId! }))
                }
                if (repoStatus?.failureCode === 'MR_NO_CHANGES') {
                  newMap[mr.id] = 'NO_CHANGES'
                } else if (repoStatus?.mergeRequest) {
                  // 预检状态已落库真实 MR 时，用真实 ID 替换占位 ID，
                  // 否则后续“合并”会把 pending-mr:* 发给真实 MR 接口。
                  newMap[mr.id] = 'MR_CREATED'
                  setItems((prev) => prev.map((item) => item.id === mr.id
                    ? { ...item, ...repoStatus.mergeRequest! }
                    : item))
                } else if (repoStatus?.status === 'CREATING_MR') {
                  // CQ approval only moves the backend workflow into the
                  // asynchronous creation phase. A real MR exists only when
                  // mergeRequest is present (or status is MR_CREATED).
                  newMap[mr.id] = 'CREATING_MR'
                } else if (repoStatus?.status === 'MR_CREATED') {
                  newMap[mr.id] = 'MR_CREATED'
                } else if (repoStatus?.dryRunStatus) {
                  if (repoStatus.cqStatus === 'APPROVED') {
                    newMap[mr.id] = 'CREATING_MR'
                  } else if (repoStatus.cqStatus === 'REJECTED') {
                    newMap[mr.id] = 'CQ_REJECTED'
                  } else if (repoStatus.dryRunStatus === 'PASSED') {
                    newMap[mr.id] = 'WAITING_CQ'
                  } else if (repoStatus.dryRunStatus === 'FAILED') {
                    newMap[mr.id] = 'FAILED'
                  } else {
                    newMap[mr.id] = 'DRY_RUN_RUNNING'
                  }
                }
              })
            }
          } catch {
            // 请求失败或超时也要结束该行的加载态，允许用户重新发起预检。
            taskMrRows.forEach((mr) => loadedIds.add(mr.id))
          } finally {
            clearTimeout(timeoutId)
          }
        })

        if (!cancelled) {
          if (Object.keys(newMap).length > 0) {
            setPreflightStatusMap((prev) => ({ ...prev, ...newMap }))
          }
          setLoadedPreflightIds(loadedIds)
        }
      } catch {
        // 静默失败
      } finally {
        preflightRefreshInFlightRef.current = false
        if (!cancelled) {
          setPreflightLoading(false)
          // 首轮跑完，无论有没有查到结果，都标记首轮回溯完成。
          // 之后进入保守轮询模式（MANUAL 未显式点击就跳过）。
          if (!initialRecoveryDoneRef.current) {
            setInitialRecoveryDone(true)
          }
        }
      }

      if (!cancelled && preflightPolling) {
        timer = setTimeout(() => void refresh(), preflightPollingInterval)
      }
    }

    void refresh()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, displayItems, preflightPolling, preflightPollingInterval, preflightRefreshVersion])

  // ============== 自动模式（createMode = SYSTEM）：页面加载完自动触发申请预检 ==============
  // 后端返回占位 MR 时已经标记好 SYSTEM，前端就不需要用户再手动点「申请MR」。
  const autoStartRef = useRef<Set<string>>(new Set())
  const autoStartTriedCountRef = useRef(0)
  useEffect(() => {
    if (displayItems.length === 0) return
    const systemRows = displayItems.filter((mr) =>
      mr.status === 'PENDING_CREATE'
      && mr.taskId
      && mr.createMode === 'SYSTEM'
      && !preflightStatusMap[mr.id]
      && !autoStartRef.current.has(mr.id),
    )
    if (systemRows.length === 0) {
      autoStartTriedCountRef.current += 1
      return
    }
    systemRows.forEach((mr) => {
      autoStartRef.current.add(mr.id)
      setPreflightRequestingIds((prev) => {
        const next = new Set(prev)
        next.add(mr.id)
        return next
      })
      const __mr = mr
        ; (async () => {
          try {
            const res = await requestPreflight.mutateAsync({
              taskId: __mr.taskId!,
              repositoryId: __mr.repositoryId,
            })
            setPreflightStatusMap((prev) => ({ ...prev, [__mr.id]: res.status }))
            setCoverageMap((prev) => ({
              ...prev,
              [__mr.id]: { taskCount: res.coveredTaskIds.length, diffCount: res.coveredDiffIds.length },
            }))
            if (res.mergeRequest && res.status === 'MR_CREATED') {
              setItems((prevItems) =>
                prevItems.map((item) =>
                  item.id === __mr.id
                    ? {
                      ...item,
                      ...res.mergeRequest!,
                      qualityGate: res.mergeRequest!.qualityGate ?? item.qualityGate,
                    }
                    : item,
                ),
              )
            }
          } catch (error) {
            if (isNoChangesError(error)) {
              setPreflightStatusMap((prev) => ({ ...prev, [__mr.id]: 'NO_CHANGES' }))
              message.info('该分支与目标分支没有新增提交，无需申请 MR')
            } else {
              setPreflightStatusMap((prev) =>
                prev[__mr.id] === 'REQUESTED'
                  ? { ...prev, [__mr.id]: 'FAILED' }
                  : prev,
              )
            }
          } finally {
            setPreflightRequestingIds((prev) => {
              const next = new Set(prev)
              next.delete(__mr.id)
              return next
            })
          }
        })()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayItems, preflightStatusMap, creatingId, requestPreflight])

  function handleMerge(record: MergeRequestSummary) {
    let commitMessage = ''
    modal.confirm({
      title: `合并 MR #${record.number}？`,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text>将 {record.sourceBranch} 合并到 {record.targetBranch}。此操作不可撤销。</Text>
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="合并提交说明（可选，留空使用 GitHub 默认说明）"
            onChange={(event) => { commitMessage = event.target.value }}
          />
        </Space>
      ),
      okText: '确认合并',
      cancelText: '取消',
      okButtonProps: { loading: mergingId === record.id },
      onOk: async () => {
        setMergingId(record.id)
        const progressKey = `merge-request-${record.id}`
        message.open({
          key: progressKey,
          type: 'loading',
          content: '正在请求 GitHub 合并，请稍候…',
          duration: 0,
        })
        try {
          const result = await mergeMr.mutateAsync({ mergeRequestId: record.id, commitMessage })
          setItems((prevItems) => prevItems.map((item) =>
            item.id === record.id
              ? {
                ...item, mergeOperationStatus: result.mergeOperationStatus ?? item.mergeOperationStatus,
                status: result.status,
              }
              : item,
          ))
          if (result.mergeOperationStatus === 'RUNNING') {
            message.open({
              key: progressKey,
              type: 'info',
              content: '合并请求已受理，GitHub 正在处理，页面会自动刷新结果。',
              duration: 4,
            })
          } else if (result.status === 'MERGED') {
            message.open({ key: progressKey, type: 'success', content: 'MR 已合并', duration: 3 })
          } else {
            message.open({ key: progressKey, type: 'warning', content: '合并尚未完成，请稍后查看 MR 状态。', duration: 4 })
          }
        } catch (error) {
          message.open({ key: progressKey, type: 'error', content: formatApiError(error), duration: 5 })
        } finally {
          setMergingId(null)
        }
      },
    })
  }

  function handleCreate(record: MergeRequestSummary) {
    const taskId = record.taskId
    if (!taskId) {
      message.warning('该 MR 未关联任务，无法从列表直接申请预检')
      return
    }
    // 检查 repositoryId 是否存在
    if (!record.repositoryId) {
      message.error('缺少仓库绑定信息，无法申请预检')
      console.error('[handleCreate] repositoryId is missing', record)
      return
    }
    // 如果已在预检流程中，根据当前状态决定是否允许重新申请
    const currentStatus = preflightStatusMap[record.id]
    const currentPreflightId = preflightIdMap[record.id]
    if (currentStatus && !['FAILED', 'STALE', 'CQ_REJECTED'].includes(currentStatus)) {
      // 预检进行中或已在等待 CQ，只允许「重新预检」的场景
      const label = preflightButtonLabel(
        deriveEffectiveState(currentStatus, record.createMode, false),
      )
      if (label.loading || currentStatus === 'WAITING_CQ' || currentStatus === 'MR_CREATED') {
        message.info(`当前状态：${label.text}，无需重复操作`)
        return
      }
    }
    // 直接执行预检申请（无需弹窗确认）
    setCreatingId(record.id)
    setPreflightStatusMap((prev) => ({ ...prev, [record.id]: 'REQUESTED' }))
    // 添加调试日志
    console.log('[handleCreate] Request payload:', {
      taskId,
      repositoryId: record.repositoryId,
      record: {
        id: record.id,
        status: record.status,
        createMode: record.createMode,
        sourceBranch: record.sourceBranch,
        targetBranch: record.targetBranch,
      },
    })
    const request = currentStatus === 'FAILED' || currentStatus === 'CQ_REJECTED'
      ? currentPreflightId
        ? retryPreflight.mutateAsync(currentPreflightId)
        : requestPreflight.mutateAsync({ taskId, repositoryId: record.repositoryId })
      : requestPreflight.mutateAsync({ taskId, repositoryId: record.repositoryId })
    request
      .then((res) => {
        console.log('[handleCreate] API success:', res)
        if (res.id) {
          setPreflightIdMap((prev) => ({ ...prev, [record.id]: res.id }))
        }
        setPreflightStatusMap((prev) => ({ ...prev, [record.id]: res.status }))
        setCoverageMap((prev) => ({
          ...prev,
          [record.id]: { taskCount: res.coveredTaskIds.length, diffCount: res.coveredDiffIds.length },
        }))
        if (res.mergeRequest && res.status === 'MR_CREATED') {
          setItems((prevItems) =>
            prevItems.map((item) =>
              item.id === record.id
                ? {
                  ...item,
                  ...res.mergeRequest!,
                  qualityGate: res.mergeRequest!.qualityGate ?? item.qualityGate,
                }
                : item,
            ),
          )
        }
        if (res.status === 'FAILED' || res.status === 'STALE' || res.status === 'CQ_REJECTED') {
          message.error(res.failureReason || '申请失败')
        } else if (res.status === 'MR_CREATED') {
          message.success('MR 已创建，点击 GitHub 按钮可跳转')
        } else if (res.status === 'WAITING_CQ') {
          // Dry Run 已通过；此时用户的下一步是等待独立成员完成 CQ+1。
          message.success('预检已通过，等待 CQ+1')
        } else if (res.status === 'REQUESTED' || res.status === 'DRY_RUN_QUEUED' || res.status === 'DRY_RUN_RUNNING') {
          message.success('已申请 MR，正在预检（Dry Run）')
        } else {
          message.success('已申请 MR，正在处理')
        }
      })
      .catch((error) => {
        console.error('[handleCreate] API error:', error)
        // 解析后端错误响应结构: { error: { code, message, details: [{field, message}] }, requestId }
        let errorMessage = formatApiError(error)
        let details: Array<{ field?: string; message?: string }> = []
        // ApiError 实例的 body 包含完整响应
        if (error instanceof ApiError && error.body) {
          const body = error.body as { error?: { code?: string; message?: string; details?: unknown[] }; requestId?: string }
          if (body?.error?.details && Array.isArray(body.error.details)) {
            details = body.error.details as Array<{ field?: string; message?: string }>
          }
          // 构建更详细的错误消息
          if (details.length > 0) {
            const detailMsgs = details.map(d => `${d.field || '字段'}: ${d.message || '不合法'}`).join('; ')
            errorMessage = `${body.error?.message || errorMessage} - ${detailMsgs}`
          }
        }
        console.error('[handleCreate] Error details:', {
          status: error?.status,
          errorMessage,
          details,
          fullBody: error instanceof ApiError ? error.body : null,
        })
        if (isNoChangesError(error)) {
          setPreflightStatusMap((prev) => ({ ...prev, [record.id]: 'NO_CHANGES' }))
          message.info('该分支与目标分支没有新增提交，无需申请 MR')
        } else {
          setPreflightStatusMap((prev) => ({ ...prev, [record.id]: 'FAILED' }))
          message.error({
            content: errorMessage,
            duration: 5, // 延长显示时间
          })
        }
      })
      .finally(() => {
        setCreatingId(null)
      })
  }

  /**
   * MANUAL 模式专属：Dry Run + CQ+1 通过后，用户点击「创建MR」，
   * 才让后端真正在 GitHub 创建 PR。
   */
  function handleCreateFromManualReady(record: MergeRequestSummary) {
    const taskId = record.taskId
    if (!taskId) {
      message.warning('该 MR 未关联任务')
      return
    }
    modal.confirm({
      title: '创建 MR？',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p>
            Dry Run 与 CQ+1 均已通过。确认后将由后端在 GitHub 端基于{' '}
            <code>{record.sourceBranch} → {record.targetBranch}</code> 创建 PR。
          </p>
        </div>
      ),
      okText: '创建MR',
      cancelText: '取消',
      okButtonProps: { loading: creatingId === record.id },
      onOk: async () => {
        setCreatingId(record.id)
        setPreflightStatusMap((prev) => ({ ...prev, [record.id]: 'CREATING_MR' }))
        try {
          // 此时 MANUAL 模式需再发一次「触发后端真正创建 MR」的请求。
          // 统一使用 preflight 接口（后端在 WAITING_CQ+CQ_APPROVED 时会进入创建 MR 流程）。
          const res = await requestPreflight.mutateAsync({
            taskId,
            repositoryId: record.repositoryId,
          })
          // 如果后端一次就返回了 MR_CREATED，则直接回写
          // 否则保守地把状态推进到 CREATING_MR，等待下次刷新
          const status = res.status === 'MR_CREATED' ? 'MR_CREATED' : 'CREATING_MR'
          setPreflightStatusMap((prev) => ({ ...prev, [record.id]: status }))
          setCoverageMap((prev) => ({
            ...prev,
            [record.id]: { taskCount: res.coveredTaskIds.length, diffCount: res.coveredDiffIds.length },
          }))
          if (res.mergeRequest) {
            setItems((prevItems) =>
              prevItems.map((item) =>
                item.id === record.id
                  ? {
                    ...item,
                    ...res.mergeRequest!,
                    qualityGate: res.mergeRequest!.qualityGate ?? item.qualityGate,
                  }
                  : item,
              ),
            )
            message.success('MR 已创建，点击 GitHub 按钮可跳转')
          } else if (res.status === 'FAILED' || res.status === 'STALE' || res.status === 'CQ_REJECTED') {
            message.error(res.failureReason || '创建 MR 失败')
          } else {
            message.success('正在创建 MR，稍后会显示 GitHub 跳转')
          }
        } catch (error) {
          if (isNoChangesError(error)) {
            setPreflightStatusMap((prev) => ({ ...prev, [record.id]: 'NO_CHANGES' }))
            message.info('该分支与目标分支没有新增提交，无需创建 MR')
          } else {
            setPreflightStatusMap((prev) => ({ ...prev, [record.id]: 'FAILED' }))
            message.error(formatApiError(error))
          }
        } finally {
          setCreatingId(null)
        }
      },
    })
  }

  function patchParams(patch: { repositoryId?: string; status?: string }) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'mr')
    if ('repositoryId' in patch) {
      if (patch.repositoryId) next.set('repositoryId', patch.repositoryId)
      else next.delete('repositoryId')
    }
    if ('status' in patch) {
      if (patch.status) next.set('status', patch.status)
      else next.delete('status')
    }
    setSearchParams(next, { replace: true })
  }

  const columns: ColumnsType<MergeRequestSummary> = useMemo(
    () => [
      {
        title: 'MR',
        key: 'number',
        width: 88,
        render: (_value, record) => (
          record.status === 'PENDING_CREATE' ? (
            <Tooltip title="这是任务分支的待发起候选，不是已创建的 GitHub MR；完成预检后才会生成真实 MR。">
              <Text type="secondary" style={{ cursor: 'help' }}>待发起</Text>
            </Tooltip>
          ) : <Text strong>#{record.number}</Text>
        ),
      },
      {
        title: '标题',
        key: 'title',
        render: (_value, record) => (
          <Space size={[6, 4]} wrap>
            <Text>
              {record.title?.trim() || `${record.sourceBranch} → ${record.targetBranch}`}
            </Text>
            {record.createMode === 'MANUAL' ? (
              <Tag color="purple" style={{ marginInlineStart: 0 }}>
                人工创建
              </Tag>
            ) : null}
            {record.createMode === 'SYSTEM' ? (
              <Tag color="geekblue" style={{ marginInlineStart: 0 }}>
                自动创建
              </Tag>
            ) : null}
            {/* createMode === 'UNKNOWN' 不显示 Tag（兼容后端尚未回传该字段的旧版本） */}
          </Space>
        ),
      },
      {
        title: '分支',
        key: 'branches',
        render: (_value, record) => {
          const coverage = coverageMap[record.id]
          return (
            <Space size={[6, 4]} wrap>
              <Text>
                <Text code>{record.sourceBranch}</Text>
                {' → '}
                <Text code>{record.targetBranch}</Text>
              </Text>
              {coverage && (coverage.taskCount > 1 || coverage.diffCount > 1) ? (
                <Tag color="blue">{coverage.taskCount} 个任务 · {coverage.diffCount} 个 Diff</Tag>
              ) : null}
            </Space>
          )
        },
      },
      {
        title: '仓库',
        key: 'repository',
        render: (_value, record) => repoLabel(repositories, record.repositoryId),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (value: MergeRequestStatus, record) => {
          if (record.status === 'PENDING_CREATE') {
            const status = preflightStatusMap[record.id]
            const isRequesting = preflightRequestingIds.has(record.id)
            const qgStatus = record.qualityGate?.status
            // 后端 placeholder 行目前写死 qualityGate.status = PENDING（尚未改为 NOT_STARTED），
            // 导致"未申请"和"预检真在跑"都显示 PENDING，因此 PENDING 本身不可信，不能当 fallback 触发。
            // 只有 PASSED / FAILED 是真实值（placeholder 永远不会写这两个），
            // 以及 NOT_STARTED 作为已明确"未启动"的可信空值。
            const hintBackendStarted = qgStatus === 'PASSED' || qgStatus === 'FAILED'
            const needRecoverySpin = !isRequesting
              && !status
              && !initialRecoveryDone
              && record.taskId
              // 首轮回溯前，如果明确看到 PASSED/FAILED 可信终态，或者正在加载，就显示 Spin
              && (hintBackendStarted || preflightLoading)
              && !loadedPreflightIds.has(record.id)
            // 首轮回溯或正在加载：显示 loading
            // 后台轮询期间 preflightLoading 会短暂变为 true，但不能让已完成首轮
            // 回溯、且尚未发起预检的行反复进入 loading。
            if (isRequesting || needRecoverySpin) {
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Spin size="small" />
                  <Text type="secondary">加载中</Text>
                </span>
              )
            }
            let effectiveStatus: PreflightUiStatus | undefined = status
            // 什么时候才用 qualityGate 做 fallback：
            //  ① 本地 map 还没这行记录
            //  ② 首轮回溯已经完成
            //  ③ qualityGate 是可信值（PASSED / FAILED）—— 这意味着后端真的有预检结果
            //  ④ 并且该行不在 loadedPreflightIds 里，或者 loadedPreflightIds 有但 map 空时
            //     只有当 qualityGate.status 不是 NOT_STARTED/PENDING 占位值时才兜底。
            // （注意：PENDING 绝不能兜底，因为 placeholder 写死 PENDING）
            if (!effectiveStatus && initialRecoveryDone && hintBackendStarted) {
              switch (qgStatus) {
                case 'PASSED': effectiveStatus = 'WAITING_CQ'; break
                case 'FAILED': effectiveStatus = 'FAILED'; break
                default: effectiveStatus = undefined
              }
            }
            const eff = deriveEffectiveState(effectiveStatus, record.createMode, false)
            return <Tag color={preflightTagColor(eff)}>{preflightTagText(eff)}</Tag>
          }
          if (record.mergeOperationStatus === 'FAILED') {
            return <Tag color="error">合并失败</Tag>
          }
          return <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
        },
      },
      {
        title: 'CQ+1',
        key: 'cqPlusOne',
        width: 120,
        render: (_value, record) => {
          const enabled = Boolean(record.taskId)
          if (!enabled) return <Text type="secondary">—</Text>
          const status = preflightStatusMap[record.id]
          // WAITING_CQ：进入审查；CQ_REJECTED：进入查看拒绝原因。
          // 其它状态（IDLE / DRY_RUN_RUNNING / CREATING_MR / MR_CREATED / FAILED / STALE 等）不展示入口。
          if (status !== 'WAITING_CQ' && status !== 'CQ_REJECTED') {
            return <Text type="secondary">—</Text>
          }
          const isRejected = status === 'CQ_REJECTED'
          return (
            <Tooltip title={isRejected ? '点击查看 CQ+1 拒绝原因' : '点击跳转到 CQ+1 大印章审查页'}>
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation()
                  const params = new URLSearchParams({
                    taskId: record.taskId ?? '',
                    repositoryId: record.repositoryId ?? '',
                    targetBranch: record.targetBranch ?? '',
                  })
                  if (record.status !== 'PENDING_CREATE' && record.id) {
                    params.set('mr', record.id)
                  }
                  navigate(`${PATHS.projectCqReview(projectId)}?${params.toString()}`)
                }}
              >
                <Tag color={isRejected ? 'error' : 'warning'}>
                  {isRejected ? '查看拒绝原因' : '前往 CQ+1'}
                </Tag>
              </Button>
            </Tooltip>
          )
        },
      },
      {
        title: 'HEAD',
        key: 'headCommit',
        width: 100,
        render: (_value, record) => <Text code>{shortSha(record.headCommit)}</Text>,
      },
      {
        title: '操作',
        key: 'action',
        width: 220,
        align: 'right',
        render: (_value, record) => {
          // ============== PENDING_CREATE：占位 MR，预检流程阶段 ==============
          if (record.status === 'PENDING_CREATE') {
            const status = preflightStatusMap[record.id]
            const isRequesting = preflightRequestingIds.has(record.id)
            // 后端 placeholder 行目前写死 qualityGate.status = PENDING（尚未改为 NOT_STARTED），
            // 导致"未申请"和"预检真在跑"都显示 PENDING，因此 PENDING 本身不可信，不能当 fallback 触发。
            // 只有 PASSED / FAILED 是真实值（placeholder 永远不会写这两个）。
            const qgStatus = record.qualityGate?.status
            const hintBackendStarted = qgStatus === 'PASSED' || qgStatus === 'FAILED'
            const needRecoverySpin = !isRequesting
              && !status
              && !initialRecoveryDone
              && record.taskId
              && (hintBackendStarted || preflightLoading)
              && !loadedPreflightIds.has(record.id)
            // 后台轮询只刷新预检结果；未发起预检的行保持稳定的按钮状态。
            if (isRequesting || needRecoverySpin) {
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Spin size="small" />
                  <Text type="secondary">加载中</Text>
                </span>
              )
            }
            // 只有当 qualityGate.status 为可信的 PASSED/FAILED 终态时，才作为最后的兜底渲染
            //（绝不能兜底 PENDING，因为 placeholder 写死 PENDING 会把新 MANUAL 任务误渲染成"待预检通过"）
            let effectiveStatus: PreflightUiStatus | undefined = status
            if (!effectiveStatus && initialRecoveryDone && hintBackendStarted) {
              switch (qgStatus) {
                case 'PASSED': effectiveStatus = 'WAITING_CQ'; break
                case 'FAILED': effectiveStatus = 'FAILED'; break
                default: effectiveStatus = undefined
              }
            }
            const eff = deriveEffectiveState(effectiveStatus, record.createMode, false)
            const { text, loading, disabled, failed, clickable } = preflightButtonLabel(eff, isAdmin)

            // MR_CREATED：后端已在 GitHub 成功创建 PR
            if (eff === 'MR_CREATED') {
              if (record.status === 'PENDING_CREATE' && !record.webUrl && (!record.number || record.number <= 0)) {
                return <Text type="secondary">MR 已创建，列表刷新中</Text>
              }
              const href = githubPullRequestUrl(
                record.webUrl,
                record.number,
                repositories.find((item) => item.id === record.repositoryId),
              )
              return (
                <Space size={8} wrap>
                  {href ? (
                    <Button
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation()
                        window.open(href, '_blank')
                      }}
                    >
                      查看 GitHub MR
                    </Button>
                  ) : null}
                  {/* Admin 显示"合并"按钮，非 Admin 显示"已创建成功" */}
                  {isAdmin ? (
                    <Button
                      size="small"
                      type="primary"
                      loading={mergingId === record.id || record.mergeOperationStatus === 'RUNNING'}
                      disabled={record.mergeOperationStatus === 'RUNNING'}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleMerge(record)
                      }}
                    >
                      {record.mergeOperationStatus === 'RUNNING' ? '合并中' : text}
                    </Button>
                  ) : (
                    <Button size="small" disabled>
                      {text}
                    </Button>
                  )}
                </Space>
              )
            }

            // 申请失败：显示 tooltip 原因
            let tip: string | null = null
            if (eff === 'FAILED') {
              if (effectiveStatus === 'CQ_REJECTED') tip = 'CQ+1 未通过，申请失败'
              else if (effectiveStatus === 'FAILED') tip = '质量门禁失败'
              else tip = '预检上下文过期，请刷新重试'
              const diagnostic = preflightFailureMap[record.id]
              if (diagnostic) {
                const detailText = diagnostic.details
                  .map((item) => [item.field, item.reason].filter(Boolean).join('：'))
                  .filter(Boolean)
                  .join('；')
                const workerText = diagnostic.workerCode
                  ? `Worker ${diagnostic.workerCode}${diagnostic.workerHttpStatus ? ` (${diagnostic.workerHttpStatus})` : ''}`
                  : ''
                tip = [tip, diagnostic.stage ? `阶段：${diagnostic.stage}` : '', workerText, detailText, diagnostic.reason ?? '']
                  .filter(Boolean)
                  .join('；')
              }
            } else if (eff === 'IDLE') {
              // 质量门禁、commit/push 与分支上下文由后端预检统一校验，
              // 不要求用户在点击前自行准备或判断门禁状态。
              tip = null
            } else if (eff === 'READY_CREATE') {
              tip = 'Dry Run + CQ+1 已通过，点击创建 MR 后由后端在 GitHub 端创建真实 PR'
            } else if (eff === 'NO_CHANGES') {
              tip = '当前分支 HEAD 与目标分支相同，没有可提交到 MR 的新增变更'
            }

            const btn = (
              <Button
                size="small"
                type={failed ? 'default' : 'primary'}
                danger={failed}
                ghost={!loading && !failed}
                loading={creatingId === record.id || loading}
                disabled={disabled || (!clickable && !failed)}
                onClick={(event) => {
                  event.stopPropagation()
                  if (eff === 'READY_CREATE') {
                    // MANUAL 模式：用户点「创建MR」→ 触发真正的 MR 创建
                    handleCreateFromManualReady(record)
                  } else {
                    handleCreate(record)
                  }
                }}
              >
                {text}
              </Button>
            )
            return tip ? <Tooltip title={tip}>{btn}</Tooltip> : btn
          }

          // ============== OPEN / MERGED / CLOSED：真实 MR 已存在 ==============
          // 真实 MR 存在时，操作列独立渲染 GitHub + Admin 合并MR（与GitHub列重复但符合用户需求）
          const canMerge =
            isAdmin &&
            record.status === 'OPEN' &&
            record.qualityGate?.status === 'PASSED' &&
            record.mergeOperationStatus !== 'RUNNING'
          const children: ReactElement[] = []
          children.push(
            <Button
              key="detail"
              size="small"
              onClick={(event) => {
                event.stopPropagation()
                navigate(PATHS.projectCodeMr(projectId, record.id))
              }}
            >
              查看 MR
            </Button>,
          )
          if (canMerge) {
            children.push(
              <Button
                key="merge"
                size="small"
                type={record.mergeOperationStatus === 'FAILED' ? undefined : 'primary'}
                color={record.mergeOperationStatus === 'FAILED' ? 'orange' : undefined}
                variant={record.mergeOperationStatus === 'FAILED' ? 'solid' : undefined}
                loading={mergingId === record.id || record.mergeOperationStatus === 'RUNNING'}
                onClick={(event) => {
                  event.stopPropagation()
                  handleMerge(record)
                }}
              >
                {record.mergeOperationStatus === 'RUNNING'
                  ? '合并中'
                  : record.mergeOperationStatus === 'FAILED' ? '重新合并' : '合并MR'}
              </Button>,
            )
          }
          if (record.status === 'OPEN' && record.qualityGate?.status !== 'PASSED') {
            return <Space size={8} wrap>{children}<Text type="secondary">门禁未过</Text></Space>
          }
          if (record.status === 'MERGED' || record.status === 'CLOSED') {
            return <Space size={8}>{children}</Space>
          }
          return children.length > 0 ? <Space size={8}>{children}</Space> : <Text type="secondary">—</Text>
        },
      },
    ],
    [projectId, repositories, isAdmin, mergingId, creatingId, items, preflightStatusMap, preflightFailureMap, preflightRequestingIds, coverageMap, navigate, handleMerge, handleCreate],
  )

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Text type="secondary">仓库</Text>
        <Select
          allowClear
          placeholder="全部仓库"
          style={{ minWidth: 200 }}
          value={repositoryId}
          onChange={(value) => patchParams({ repositoryId: value })}
          options={repositories.map((repo) => ({
            value: repo.id,
            label: repo.displayName || repo.fullName,
          }))}
        />
        <Text type="secondary">状态</Text>
        <Select
          allowClear
          placeholder="全部状态"
          style={{ minWidth: 140 }}
          value={status}
          onChange={(value) => patchParams({ status: value })}
          options={STATUS_OPTIONS}
        />
      </Space>
      {query.isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : query.isError ? (
        <Alert
          type="error"
          showIcon
          message={formatApiError(query.error)}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      ) : displayItems.length === 0 ? (
        <Empty description="当前筛选下没有 MR 或待发起候选。" />
      ) : (
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          columns={columns}
          dataSource={displayItems}
          scroll={{ x: 1120 }}
        />
      )}
    </Space>
  )
}
