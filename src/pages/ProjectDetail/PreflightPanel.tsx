import { useMemo, useCallback } from 'react'
import { Alert, App, Button, Input, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useAuth } from '@/context/AuthContext'
import { useApproveDryRunCq, useRejectDryRunCq } from '@/hooks/qualityGate'
import { queryClient, queryKeys } from '@/query'
import { formatApiError } from '@/utils/formatApiError'
import { readApiErrorCode } from '@/api/qualityGate'
import {
  cqPlusOneStatusColor,
  cqPlusOneStatusDescription,
  dryRunStatusColor,
  dryRunStatusDescription,
  preflightBlockerLabel,
  preflightRepoSummary,
} from './preflightDisplay'
import type { Preflight } from '@/types/qualityGate'

const { Text, Paragraph } = Typography

interface PreflightRepoRow {
  key: string
  repositoryId: string
  repositoryName: string
  preflight: Preflight | undefined
  loading: boolean
  error: Error | null
}

/**
 * MR 前预检面板 —— 按仓库分别展示状态。
 *
 * 设计：
 *  - 每个仓库一行，展示 Dry Run 状态 + CQ+1 状态 + 操作按钮
 *  - 不提供手动「创建 MR」按钮 —— CQ+1 通过后后端自动创建
 *  - 不提供手动「开始 Dry Run」按钮 —— Dry Run 由后端自动触发
 *  - 仅当 dryRun.status === 'PASSED' 且 CQ+1 缺失时，非发起人可点击「通过 CQ+1」
 *  - SSE 事件（preflight.updated / dry-run.updated）只触发刷新此面板
 */
export function PreflightPanel({
  projectId,
  preflights,
  onRefreshAll,
  taskCreatedByUserId,
}: {
  projectId: string
  /** 按仓库排列的预检查询结果 */
  preflights: Array<{
    repositoryId: string
    repositoryName: string
    preflight: Preflight | undefined
    loading: boolean
    error: Error | null
    refetch: () => void
  }>
  onRefreshAll: () => void
  taskCreatedByUserId?: string | null
}) {
  const { message, modal } = App.useApp()
  const { user } = useAuth()

  const approveCq = useApproveDryRunCq(projectId)
  const rejectCq = useRejectDryRunCq(projectId)

  const currentUserId = user?.id
  const isAuthor = Boolean(currentUserId && taskCreatedByUserId && currentUserId === taskCreatedByUserId)

  const refreshPreflight = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.preflight.all(projectId) })
  }, [projectId])

  const submitCq = useCallback(
    (preflight: Preflight, kind: 'approve' | 'reject') => {
      if (!preflight.dryRun?.id) {
        message.error('Dry Run 信息缺失，请刷新后重试')
        return
      }
      const dryRunId = preflight.dryRun.id

      let reason = ''
      const rejecting = kind === 'reject'
      modal.confirm({
        title: rejecting ? '拒绝该 Dry Run？' : '给该 Dry Run 盖 CQ+1？',
        content: rejecting ? (
          <Input.TextArea
            placeholder="请填写修改意见（必填）"
            autoSize={{ minRows: 3, maxRows: 6 }}
            onChange={(event) => { reason = event.target.value }}
          />
        ) : (
          <Text type="secondary">
            确认由你作为独立成员审批该 Dry Run？审批通过后系统将自动创建 MR。
          </Text>
        ),
        okText: rejecting ? '拒绝' : '盖章',
        okButtonProps: rejecting ? { danger: true } : undefined,
        onOk: () => {
          if (rejecting && !reason.trim()) {
            message.warning('修改意见不能为空')
            return Promise.reject(new Error('reason required'))
          }
          const mutate = rejecting ? rejectCq.mutateAsync : approveCq.mutateAsync
          return mutate({ dryRunId, input: { reason: reason.trim() } }).then(
            () => {
              message.success(rejecting ? '已拒绝该 Dry Run' : '已盖 CQ+1')
              refreshPreflight()
            },
            (error: unknown) => {
              const code = readApiErrorCode(error)
              if (code === 'PREFLIGHT_CQ_AUTHOR_FORBIDDEN') {
                message.error('Task 发起人不可自审，请由独立成员审批该 Dry Run')
              } else if (code === 'PREFLIGHT_CONTEXT_STALE' || code === 'PREFLIGHT_TASK_NOT_READY') {
                refreshPreflight()
                message.error('预检上下文已变化，已刷新预检，请重新确认')
              } else {
                message.error(formatApiError(error))
              }
              return Promise.reject(error)
            },
          )
        },
      })
    },
    [modal, message, approveCq, rejectCq, refreshPreflight],
  )

  const rows: PreflightRepoRow[] = useMemo(
    () => preflights.map((p) => ({
      key: p.repositoryId,
      repositoryId: p.repositoryId,
      repositoryName: p.repositoryName,
      preflight: p.preflight,
      loading: p.loading,
      error: p.error,
    })),
    [preflights],
  )

  const columns: ColumnsType<PreflightRepoRow> = useMemo(
    () => [
      {
        title: '仓库',
        dataIndex: 'repositoryName',
        key: 'repo',
        width: 180,
        render: (name: string) => <Text strong>{name}</Text>,
      },
      {
        title: 'Dry Run',
        key: 'dryRun',
        width: 200,
        render: (_: unknown, row) => {
          if (row.loading) return <Spin size="small" />
          const ds = row.preflight?.dryRun?.status
          return (
            <Space>
              <Tag color={dryRunStatusColor(ds)}>
                {dryRunStatusDescription(ds)}
              </Tag>
              {row.preflight?.dryRun?.id ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ID: {row.preflight.dryRun.id.slice(0, 8)}
                </Text>
              ) : null}
            </Space>
          )
        },
      },
      {
        title: 'CQ+1',
        key: 'cq',
        width: 150,
        render: (_: unknown, row) => {
          if (row.loading) return <Spin size="small" />
          const cs = row.preflight?.cqPlusOne?.status
          return (
            <Tag color={cqPlusOneStatusColor(cs)}>
              {cqPlusOneStatusDescription(cs)}
            </Tag>
          )
        },
      },
      {
        title: '状态描述',
        key: 'summary',
        width: 320,
        render: (_: unknown, row) => {
          if (row.loading) return <Text type="secondary">加载中...</Text>
          if (row.error) return <Text type="danger">{formatApiError(row.error)}</Text>
          if (!row.preflight) return <Text type="secondary">等待预检...</Text>
          const { text, color } = preflightRepoSummary({
            dryRunStatus: row.preflight.dryRun?.status,
            cqStatus: row.preflight.cqPlusOne?.status,
            blockers: row.preflight.blockers,
          })
          const tagColor = color === 'success' ? 'green' : color === 'error' ? 'red' : color === 'warning' ? 'orange' : color === 'processing' ? 'blue' : 'default'

          // 展示主要描述 tag + blocker 详情 tooltip
          const blockers = row.preflight.blockers ?? []
          const significantBlockers = blockers.filter(
            (b) => b.code !== 'DRY_RUN_MISSING' && b.code !== 'CQ_PLUS_ONE_MISSING',
          )

          if (significantBlockers.length > 0) {
            const blockerList = significantBlockers
              .map((b) => preflightBlockerLabel(b.code))
              .join('；')
            return (
              <Tooltip title={<div style={{ maxWidth: 300 }}>{blockerList}</div>}>
                <Space direction="vertical" size={4}>
                  <Tag color={tagColor}>{text}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    阻塞原因：{blockerList}
                  </Text>
                </Space>
              </Tooltip>
            )
          }

          return <Tag color={tagColor}>{text}</Tag>
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 220,
        render: (_: unknown, row) => {
          if (row.loading) return null
          if (row.error) {
            return (
              <Button size="small" onClick={() => preflights.find((p) => p.repositoryId === row.repositoryId)?.refetch()}>
                重试
              </Button>
            )
          }
          const pf = row.preflight
          if (!pf) return <Text type="secondary">等待数据...</Text>

          const dryRunPassed = pf.dryRun?.status === 'PASSED'
          const cqMissing = !pf.cqPlusOne || pf.cqPlusOne.status === 'MISSING'
          const cqApproved = pf.cqPlusOne?.status === 'APPROVED'
          const cqRejected = pf.cqPlusOne?.status === 'REJECTED'
          const dryRunRunning = pf.dryRun?.status === 'QUEUED' || pf.dryRun?.status === 'RUNNING'
          const dryRunFailed = pf.dryRun?.status === 'FAILED'

          // 禁止操作的场景
          if (dryRunRunning) {
            return <Text type="secondary">Dry Run 执行中...</Text>
          }
          if (cqApproved) {
            return <Text type="secondary">CQ+1 已通过</Text>
          }

          const canApprove = dryRunPassed && cqMissing && !isAuthor
          const canReject = dryRunPassed && (cqMissing || cqRejected) && !isAuthor

          return (
            <Space size={4}>
              {canApprove ? (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => submitCq(pf, 'approve')}
                  loading={approveCq.isPending}
                >
                  通过 CQ+1
                </Button>
              ) : null}
              {canReject ? (
                <Button
                  size="small"
                  danger
                  onClick={() => submitCq(pf, 'reject')}
                  loading={rejectCq.isPending}
                >
                  拒绝
                </Button>
              ) : null}
              {isAuthor && dryRunPassed && cqMissing ? (
                <Tooltip title="任务发起人不能审查自己的代码，请由独立成员完成 CQ+1">
                  <Text type="secondary" style={{ fontSize: 12 }}>发起人</Text>
                </Tooltip>
              ) : null}
              {dryRunFailed ? (
                <Tooltip title="基础设施错误才需要重试，其他情况请修复代码后重试">
                  <Button
                    size="small"
                    onClick={() => preflights.find((p) => p.repositoryId === row.repositoryId)?.refetch()}
                  >
                    刷新
                  </Button>
                </Tooltip>
              ) : null}
              {!canApprove && !canReject && !dryRunFailed && !cqApproved ? (
                <Button
                  size="small"
                  onClick={() => preflights.find((p) => p.repositoryId === row.repositoryId)?.refetch()}
                >
                  刷新
                </Button>
              ) : null}
            </Space>
          )
        },
      },
    ],
    [preflights, isAuthor, submitCq, approveCq.isPending, rejectCq.isPending],
  )

  const allLoading = preflights.every((p) => p.loading)

  // 计算整体预检状态，用于动态渲染顶部 Alert
  const summary = useMemo(() => {
    const loaded = preflights.filter((p) => !p.loading && p.preflight)
    const loading = preflights.filter((p) => p.loading)
    const errored = preflights.filter((p) => p.error)

    if (loaded.length === 0 && loading.length > 0) {
      return { type: 'info' as const, message: '正在加载预检状态...', description: '请稍候，正在获取仓库预检信息。' }
    }

    // 检查所有已加载仓库是否都有 TASK_NOT_READY blocker（任务仍在 DELIVERING）
    const allTaskNotReady = loaded.length > 0 && loaded.every((p) =>
      p.preflight?.blockers?.some((b) => b.code === 'TASK_NOT_READY'),
    )
    if (allTaskNotReady) {
      return {
        type: 'info' as const,
        message: '任务正在交付中（commit/push 进行中）',
        description: '代码推送完成后，系统将自动触发各仓库的 Dry Run。请耐心等待，页面会自动刷新。',
      }
    }

    const allDryRunRunning = loaded.every((p) => {
      const ds = p.preflight?.dryRun?.status
      return ds === 'QUEUED' || ds === 'RUNNING' || !ds
    })
    const someDryRunFailed = loaded.some((p) => p.preflight?.dryRun?.status === 'FAILED')
    const allCqApproved = loaded.length > 0 && loaded.every((p) => p.preflight?.cqPlusOne?.status === 'APPROVED')
    const someCqMissing = loaded.some((p) => {
      const cs = p.preflight?.cqPlusOne?.status
      return !cs || cs === 'MISSING'
    })

    if (someDryRunFailed) {
      return { type: 'error' as const, message: '部分 Dry Run 失败', description: '请查看失败仓库的报告，修复后由系统重新触发 Dry Run。' }
    }
    if (allCqApproved) {
      return { type: 'success' as const, message: 'CQ+1 已通过，系统正在创建 MR', description: 'MR 创建完成后将自动出现在 MR 列表中。' }
    }
    if (allDryRunRunning) {
      return { type: 'info' as const, message: '代码已推送，Dry Run 自动执行中', description: '请由非任务发起人完成 CQ+1，审核通过后系统将自动创建 MR。' }
    }
    if (someCqMissing) {
      return { type: 'warning' as const, message: 'Dry Run 已通过，等待独立成员 CQ+1', description: '请由非任务发起人完成 CQ+1 审批，审核通过后系统将自动创建 MR。' }
    }
    if (errored.length > 0) {
      return { type: 'error' as const, message: '部分仓库预检加载失败', description: '点击刷新全部重试。' }
    }
    return { type: 'info' as const, message: '预检状态汇总', description: '请查看下方各仓库的详细状态。' }
  }, [preflights])

  if (allLoading && preflights.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <Spin size="small" /> <Text type="secondary">正在加载 MR 前预检...</Text>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Alert
        type={summary.type}
        showIcon
        message={summary.message}
        description={<Text type="secondary">{summary.description}</Text>}
        action={
          preflights.some((p) => p.loading) ? (
            <Spin size="small" />
          ) : (
            <Button size="small" onClick={onRefreshAll}>刷新全部</Button>
          )
        }
        style={{ marginBottom: 4 }}
      />

      {preflights.some((p) => p.error) ? (
        <Alert
          type="error"
          showIcon
          message="部分仓库预检加载失败"
          description={
            <div>
              {preflights.filter((p) => p.error).map((p) => (
                <div key={p.repositoryId}>
                  <Text strong>{p.repositoryName}</Text>
                  <Text type="secondary">：{formatApiError(p.error)}</Text>
                </div>
              ))}
            </div>
          }
          action={<Button size="small" onClick={onRefreshAll}>重试</Button>}
          style={{ marginBottom: 4 }}
        />
      ) : null}

      {rows.length === 0 ? (
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          暂无仓库信息，等待任务完成代码提交后将自动触发 Dry Run。
        </Paragraph>
      ) : (
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          columns={columns}
          dataSource={rows}
          loading={allLoading}
          scroll={{ x: 1000 }}
        />
      )}

      {isAuthor ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          你是此任务的发起人，不能给自己的代码盖 CQ+1。请邀请团队成员完成审查。
        </Text>
      ) : null}
    </div>
  )
}
