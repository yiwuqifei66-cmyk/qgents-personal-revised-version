import type { ReactNode } from 'react'
import { Alert, Button, Spin, Tag, Typography } from 'antd'
import { CheckCircleFilled, ClockCircleFilled, ExclamationCircleFilled, MinusCircleFilled } from '@ant-design/icons'
import { usePreflight } from '@/hooks/qualityGate'
import type { PreflightStatus } from '@/types/qualityGate'

const { Text } = Typography

type GateBarState = 'HIDDEN' | 'PENDING' | 'PASSED' | 'FAILED'

function preflightToGateBarStatus(preflightStatus: PreflightStatus | undefined): GateBarState {
  if (!preflightStatus) return 'HIDDEN'
  switch (preflightStatus) {
    case 'PASSED':
      return 'PASSED'
    case 'FAILED':
    case 'STALE':
      return 'FAILED'
    case 'PENDING':
    default:
      return 'PENDING'
  }
}

function gateBarIcon(state: GateBarState): ReactNode {
  switch (state) {
    case 'PASSED':
      return <CheckCircleFilled style={{ color: '#52c41a' }} />
    case 'FAILED':
      return <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />
    case 'PENDING':
      return <ClockCircleFilled style={{ color: '#faad14' }} />
    default:
      return <MinusCircleFilled style={{ color: '#d9d9d9' }} />
  }
}

function gateBarLabel(state: GateBarState): string {
  switch (state) {
    case 'PASSED':
      return '预检通过'
    case 'FAILED':
      return '预检未过'
    case 'PENDING':
      return '预检中'
    default:
      return '未启动预检'
  }
}

/**
 * Preflight 三态指示灯：展示 Dry Run 关联的 MR 前预检进度。
 * 有 taskId / repositoryId / targetBranch 任一字段时即显示，调用 usePreflight 获取真实状态。
 * 三个字段均缺时返回 null。
 */
export function PreflightGateBar({
  projectId,
  taskId,
  repositoryId,
  targetBranch,
}: {
  projectId: string
  taskId?: string
  repositoryId?: string
  targetBranch?: string
}) {
  const hasAny = Boolean(taskId || repositoryId || targetBranch)

  const preflightQuery = usePreflight(
    projectId,
    taskId ?? '',
    repositoryId ?? '',
    targetBranch ?? '',
  )

  const state = preflightToGateBarStatus(preflightQuery.data?.status)

  if (!hasAny) return null

  return (
    <Alert
      type={state === 'PASSED' ? 'success' : state === 'FAILED' ? 'error' : 'info'}
      showIcon
      icon={gateBarIcon(state)}
      message={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {gateBarLabel(state)}
          {preflightQuery.data?.targetBranch ? (
            <>
              <Text type="secondary">· 目标分支 </Text>
              <Text code>{preflightQuery.data.targetBranch}</Text>
            </>
          ) : null}
          {preflightQuery.data?.sourceCommit ? (
            <>
              <Text type="secondary">· 源提交 </Text>
              <Text code>{preflightQuery.data.sourceCommit.slice(0, 7)}</Text>
            </>
          ) : null}
          {preflightQuery.data?.dryRun ? (
            <>
              <Text type="secondary">· Dry Run </Text>
              <Tag
                color={
                  preflightQuery.data.dryRun.status === 'PASSED'
                    ? 'success'
                    : preflightQuery.data.dryRun.status === 'FAILED'
                      ? 'error'
                      : 'processing'
                }
              >
                {preflightQuery.data.dryRun.status}
              </Tag>
            </>
          ) : null}
          {preflightQuery.data?.cqPlusOne ? (
            <>
              <Text type="secondary">· CQ+1 </Text>
              <Tag
                color={
                  preflightQuery.data.cqPlusOne.status === 'APPROVED'
                    ? 'success'
                    : preflightQuery.data.cqPlusOne.status === 'REJECTED'
                      ? 'error'
                      : 'default'
                }
              >
                {preflightQuery.data.cqPlusOne.status === 'APPROVED'
                  ? '已通过'
                  : preflightQuery.data.cqPlusOne.status === 'REJECTED'
                    ? '已拒绝'
                    : '缺失'}
              </Tag>
            </>
          ) : null}
        </span>
      }
      style={{ marginBottom: 16 }}
      action={
        preflightQuery.isFetching && !preflightQuery.isLoading ? (
          <Spin size="small" />
        ) : (
          <Button size="small" onClick={() => void preflightQuery.refetch()}>
            刷新
          </Button>
        )
      }
    />
  )
}
