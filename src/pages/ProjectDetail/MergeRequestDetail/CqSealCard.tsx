import { Button, Space, Typography } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import type { MergeRequestCheck, MergeRequestStatus } from '@/types/task-model'
import { cqSealAppearance, formatCqTime, shortCommitSha } from '../cqSeal'
import styles from './MergeRequestDetailPage.module.scss'

const { Text } = Typography
type CqAction = 'approve' | 'reject'

export function CqSealCard({
  check,
  headCommit,
  mrStatus,
  isAuthor,
  busy,
  busyAction,
  onApprove,
  onReject,
  rootRef,
}: {
  check: MergeRequestCheck | undefined
  headCommit: string | null
  mrStatus: MergeRequestStatus
  isAuthor: boolean
  busy: boolean
  busyAction?: CqAction | null
  onApprove: () => void
  onReject: () => void
  rootRef?: React.RefObject<HTMLDivElement | null>
}) {
  const status = check?.status ?? 'PENDING'
  const appearance = cqSealAppearance({
    status,
    isAuthor,
    stampedSha: check?.commitSha,
    headCommit,
  })
  const displaySha = shortCommitSha(
    appearance === 'cracked' ? check?.commitSha ?? headCommit : headCommit ?? check?.commitSha,
  )
  // 同一提交一旦已有决定，不允许重复盖章或重复拒绝；新提交进入 cracked 状态时允许重新盖章。
  const canAct = mrStatus === 'OPEN' && !isAuthor && (status === 'PENDING' || appearance === 'cracked')
  const approveLabel = appearance === 'cracked' ? '重新盖章' : '盖 CQ+1'
  const showApprove = canAct && appearance !== 'stamped'
  const showReject = canAct && status === 'PENDING'

  return (
    <div ref={rootRef} className={styles.sealBlock} aria-label="CQ+1 印章">
      <div
        className={`${styles.seal} ${sealClass(appearance)}`}
        data-appearance={appearance}
        aria-hidden="true"
      >
        <div className={styles.sealRing}>
          <div className={styles.sealInner}>
            {appearance === 'locked' ? <LockOutlined className={styles.sealLock} /> : null}
            <span className={styles.sealMark}>CQ+1</span>
            <span className={styles.sealSha}>{displaySha}</span>
            <span className={styles.sealState}>{sealStateLabel(appearance)}</span>
          </div>
        </div>
      </div>
      <div className={styles.sealMeta}>
        {appearance === 'locked' ? (
          <p className={styles.sealDenied}>不能给自己盖章</p>
        ) : (
          <p>{sealCaption(appearance, check)}</p>
        )}
        {check?.reviewReason && (appearance === 'stamped' || appearance === 'failed') ? (
          <Text type="secondary">{check.reviewReason}</Text>
        ) : null}
      </div>
      {showApprove || showReject ? (
        <Space>
          {showApprove ? (
            <Button type="primary" loading={busy && (!busyAction || busyAction === 'approve')} onClick={onApprove} aria-label="approve-cq">
              {approveLabel}
            </Button>
          ) : null}
          {showReject ? (
            <Button danger loading={busy && (!busyAction || busyAction === 'reject')} onClick={onReject} aria-label="reject-cq">
              拒绝
            </Button>
          ) : null}
        </Space>
      ) : null}
    </div>
  )
}

function sealClass(appearance: ReturnType<typeof cqSealAppearance>): string {
  if (appearance === 'stamped') return styles.isStamped
  if (appearance === 'cracked') return styles.isCracked
  if (appearance === 'failed') return styles.isFailed
  if (appearance === 'locked') return styles.isLocked
  return styles.isEmpty
}

function sealStateLabel(appearance: ReturnType<typeof cqSealAppearance>): string {
  if (appearance === 'stamped') return '有效'
  if (appearance === 'cracked') return '已失效'
  if (appearance === 'failed') return '未通过'
  if (appearance === 'locked') return '锁定'
  return '未盖章'
}

function sealCaption(
  appearance: ReturnType<typeof cqSealAppearance>,
  check: MergeRequestCheck | undefined,
): string {
  if (appearance === 'cracked') return 'HEAD 已更新，旧 CQ+1 可能作废'
  if (appearance === 'failed') return check?.reviewedByName ? `${check.reviewedByName} 已拒绝` : '已拒绝本次 CQ'
  if (appearance === 'stamped') {
    const who = check?.reviewedByName?.trim() || '已盖章'
    const when = formatCqTime(check?.completedAt)
    return when ? `${who} · ${when}` : who
  }
  return '尚未有人在当前 HEAD 上盖章'
}
