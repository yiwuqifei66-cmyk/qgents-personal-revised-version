import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  App,
  Alert,
  BackTop,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  Descriptions,
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleFilled,
  CodeOutlined,
  LeftOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/context/AuthContext'
import {
  useApproveDryRunCq,
  usePreflight,
  useRejectDryRunCq,
} from '@/hooks/qualityGate'
import {
  useApproveMergeRequestCq,
  useMergeRequest,
  useMergeRequestChecks,
  useRejectMergeRequestCq,
  useDiffs,
  useTask,
} from '@/hooks/task-model'
import { PATHS } from '@/routes/paths'
import { findCqCheck, isMergeRequestAuthor } from '../cqSeal'
import { CqSealCard } from '../MergeRequestDetail/CqSealCard'
import { formatApiError } from '@/utils/formatApiError'
import { ApiError } from '@/api/client'
import type { Preflight } from '@/types/qualityGate'
import styles from './CqReviewPage.module.scss'

const { Title, Text, Paragraph } = Typography

const pageTheme = {
  algorithm: undefined,
  token: {
    colorPrimary: '#0d9b9b',
    colorBgBase: '#ffffff',
    colorText: '#12213d',
    colorTextSecondary: '#6d7d95',
    colorBorder: '#e4eaf2',
    borderRadius: 8,
  },
}

/**
 * CQ+1 审查页（大印章页）。
 *
 * 支持两种入口参数（必须给其中一套）：
 *  1) ?mr=<mergeRequestId>                   —— 基于 MR 的审查（旧入口兼容、MR 详情页入口）
 *  2) ?taskId=<taskId>&repositoryId=<repoId> —— 基于 Task+Preflight 的审查（流程图节点入口，时序正确：CQ → 后创建 MR）
 *
 * 两种入口都会走到「当前 Dry Run + CQ 审查事实」：
 *   • 先 CQ+1（通过 Dry Run 级接口）→ 后端监听事件自动创建 MR（MR_FIRST 模式）
 *   • 如果 MR 已存在也能用 MR 级接口盖章，但不改变流程语义。
 */
export default function CqReviewPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { message, modal } = App.useApp()
  const [submittedDecision, setSubmittedDecision] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [reviewLocked, setReviewLocked] = useState(false)

  const mergeRequestId = searchParams.get('mr')?.trim() || ''
  const taskId = searchParams.get('taskId')?.trim() || ''
  const repositoryId = searchParams.get('repositoryId')?.trim() || ''
  const targetBranchParam = searchParams.get('targetBranch')?.trim() || ''

  // ========== 模式 A：MR 级入口（?mr=） ==========
  const mrQuery = useMergeRequest(projectId, mergeRequestId)
  const checksQuery = useMergeRequestChecks(projectId, mergeRequestId)
  const approveMrCq = useApproveMergeRequestCq(projectId)
  const rejectMrCq = useRejectMergeRequestCq(projectId)
  const mrTaskQuery = useTask(projectId, mrQuery.data?.taskId ?? '')

  // ========== 模式 B：Preflight 级入口（?taskId=&repositoryId=） ==========
  const taskQuery = useTask(projectId, taskId)
  const task = taskId ? taskQuery.data : mrTaskQuery.data
  const targetBranch = useMemo(() => {
    if (!repositoryId) return targetBranchParam
    const summary = task?.repositories?.find((r) => r.repositoryId === repositoryId)
    return summary?.baseRef || targetBranchParam
  }, [task, repositoryId, targetBranchParam])
  const preflightQuery = usePreflight(projectId, taskId, repositoryId, targetBranch)
  const approveDryCq = useApproveDryRunCq(projectId)
  const rejectDryCq = useRejectDryRunCq(projectId)

  // ========== 入口模式判定 ==========
  const byMr = Boolean(mergeRequestId)
  const byPreflight = Boolean(taskId && repositoryId)

  // ========== 统一派生：isAuthor + CQ 状态 + 印章数据 ==========
  const isAuthor = useMemo(() => {
    if (byMr) return isMergeRequestAuthor(user?.id, mrTaskQuery.data?.createdByUser?.id)
    return isMergeRequestAuthor(user?.id, task?.createdByUser?.id)
  }, [user?.id, byMr, mrTaskQuery.data, task?.createdByUser?.id])

  const mr = byMr ? mrQuery.data : null
  const cqFromMr = useMemo(() => {
    if (!byMr) return null
    return findCqCheck(checksQuery.data ?? [])
  }, [byMr, checksQuery.data])

  const preflight: Preflight | null = byPreflight && preflightQuery.data ? preflightQuery.data : null
  const dryRun = preflight?.dryRun ?? null
  const cqPlusOne = preflight?.cqPlusOne ?? null
  const preflightUnavailable = byPreflight
    && !preflightQuery.isLoading
    && (preflightQuery.isError || !preflightQuery.data)
  const reviewTaskId = taskId || mrQuery.data?.taskId || ''
  const reviewRepositoryId = repositoryId || mrQuery.data?.repositoryId || ''
  const diffsQuery = useDiffs(projectId, { taskId: reviewTaskId || undefined, limit: 100 })
  const reviewDiff = useMemo(() => {
    const sourceCommit = preflight?.sourceCommit || mrQuery.data?.headCommit || ''
    return (diffsQuery.data?.data ?? [])
      .filter((diff) => !reviewRepositoryId || diff.repositoryId === reviewRepositoryId)
      .sort((left, right) => {
        const leftMatches = sourceCommit && left.headCommit === sourceCommit ? 1 : 0
        const rightMatches = sourceCommit && right.headCommit === sourceCommit ? 1 : 0
        if (leftMatches !== rightMatches) return rightMatches - leftMatches
        const leftAccepted = left.status === 'ACCEPTED' ? 1 : 0
        const rightAccepted = right.status === 'ACCEPTED' ? 1 : 0
        if (leftAccepted !== rightAccepted) return rightAccepted - leftAccepted
        return right.createdAt.localeCompare(left.createdAt)
      })[0] ?? null
  }, [diffsQuery.data, mrQuery.data?.headCommit, preflight?.sourceCommit, reviewRepositoryId])
  const dryRunCqStatus = (() => {
    if (submittedDecision) return submittedDecision
    // Preflight 接口 cqPlusOne.status 的合法值是 'MISSING' | 'APPROVED' | 'REJECTED'
    // （参见 types/qualityGate.ts PreflightCqPlusOneStatus）。
    // 本页内部 CQ 状态机统一用 'PENDING' 表示"等待审查"，因此把 'MISSING' 与 null/undefined 归一化。
    const raw = cqPlusOne?.status
    if (raw === 'APPROVED' || raw === 'REJECTED') return raw
    return 'PENDING'
  })() // 'PENDING' | 'APPROVED' | 'REJECTED'
  const cqStatus = byMr
    ? (cqFromMr?.status ?? 'PENDING')
    : dryRunCqStatus === 'APPROVED'
      ? 'PASSED'
      : dryRunCqStatus === 'REJECTED'
        ? 'FAILED'
        : 'PENDING'

  // 加载 / 错误 / 空态
  const loading = byMr
    ? mrQuery.isLoading || checksQuery.isLoading || mrTaskQuery.isLoading
    : taskQuery.isLoading || preflightQuery.isLoading

  const hasError = byMr
    ? mrQuery.isError
    : taskQuery.isError || preflightQuery.isError
  const errorMessage = byMr
    ? mrQuery.error?.message
    : (taskQuery.error?.message || preflightQuery.error?.message)

  const canReview = byMr
    ? mr?.status === 'OPEN' && (!cqFromMr || cqFromMr.status === 'PENDING') && !isAuthor
    : dryRun?.status === 'PASSED'
    // 注意：Preflight 接口返回 cqPlusOne.status∈{MISSING,APPROVED,REJECTED}，
    // 但 dryRunCqStatus 已经把 MISSING 归一化成 PENDING；这里仍兼容原始 MISSING 作为双保险。
    && (dryRunCqStatus === 'PENDING' || dryRunCqStatus === 'MISSING' as string)
    && !preflightUnavailable
    && !isAuthor
    && !reviewLocked

  // ========== 返回按钮 ==========
  function goBack() {
    // 返回测试集页面
    navigate(PATHS.projectTestset(projectId))
  }

  // ========== CQ 提交：自动按模式选接口 ==========
  function submitCq(kind: 'approve' | 'reject') {
    if (byMr) {
      if (!mr || mr.status !== 'OPEN') {
        message.warning('仅可对进行中的 MR 进行 CQ 审查')
        return
      }
    } else if (byPreflight) {
      if (!dryRun) {
        message.warning('当前还没有 Dry Run，无法进行 CQ 审查')
        return
      }
      if (dryRun.status !== 'PASSED') {
        message.warning(`Dry Run 状态为 ${dryRun.status}，只有 PASSED 才能 CQ 审查`)
        return
      }
      if (!dryRun.id) {
        message.warning('Dry Run ID 缺失，无法提交审查')
        return
      }
    } else {
      return
    }
    if (isAuthor) {
      message.warning('不能审核自己的任务')
      return
    }

    let reason = ''
    const rejecting = kind === 'reject'
    modal.confirm({
      title: rejecting ? '拒绝 CQ' : '盖 CQ+1？',
      content: (
        <Input.TextArea
          placeholder={rejecting ? '请填写拒绝理由' : '请填写审查意见'}
          autoSize={{ minRows: 3, maxRows: 6 }}
          onChange={(event) => {
            reason = event.target.value
          }}
        />
      ),
      okText: rejecting ? '拒绝' : '盖章',
      okButtonProps: rejecting ? { danger: true } : undefined,
      onOk: async () => {
        if (!reason.trim()) {
          message.warning(rejecting ? '拒绝理由不能为空' : '审查意见不能为空')
          return Promise.reject(new Error('reason required'))
        }
        try {
          if (byMr) {
            const mutate = rejecting ? rejectMrCq.mutateAsync : approveMrCq.mutateAsync
            await mutate({ mergeRequestId: mr!.id, input: { reason: reason.trim() } })
            void checksQuery.refetch()
            void mrQuery.refetch()
          } else if (byPreflight && dryRun?.id) {
            const mutate = rejecting ? rejectDryCq.mutateAsync : approveDryCq.mutateAsync
            await mutate({ dryRunId: dryRun.id, input: { reason: reason.trim() } })
            // The backend creates the MR asynchronously. Lock this page from
            // the successful response so a stale refetch cannot reopen CQ.
            setSubmittedDecision(rejecting ? 'REJECTED' : 'APPROVED')
            setReviewLocked(true)
            void preflightQuery.refetch()
          }
          message.success(rejecting ? '已拒绝 CQ+1' : '已盖 CQ+1')
        } catch (error) {
          const code = error instanceof ApiError && error.body && typeof error.body === 'object'
            ? ((error.body as { error?: { code?: string } }).error?.code ?? '')
            : ''
          if (byPreflight && code === 'PREFLIGHT_CQ_ALREADY_DECIDED') {
            setReviewLocked(true)
            void preflightQuery.refetch()
            message.info('该 Dry Run 已完成 CQ+1 审查，无需重复提交')
            return
          }
          message.error(formatApiError(error))
          return Promise.reject(error)
        }
      },
    })
  }

  // ========== 顶部占位：缺少参数空态 ==========
  if (!byMr && !byPreflight) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Empty
              description={
                <span>
                  缺少入口参数。请使用以下任一形式进入：
                  <br />
                  <Text code>?mr=MR_ID</Text>（MR 详情入口）
                  <br />
                  <Text code>?taskId=TASK_ID&repositoryId=REPO_ID</Text>（流程图 CQ+1 节点入口）
                </span>
              }
            >
              <Button type="primary" onClick={goBack}>
                返回
              </Button>
            </Empty>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  if (loading) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Spin />
          </div>
        </div>
      </ConfigProvider>
    )
  }

  if (hasError) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Empty description={formatApiError(new Error(errorMessage || '加载失败'))}>
              <Button
                onClick={() => {
                  if (byMr) void mrQuery.refetch()
                  else {
                    void taskQuery.refetch()
                    void preflightQuery.refetch()
                  }
                }}
              >
                重试
              </Button>
              <Button onClick={goBack}>返回</Button>
            </Empty>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  if (byMr && !mr) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Empty description="未找到该 MR，无法进行 CQ+1 审查">
              <Button onClick={goBack}>返回</Button>
            </Empty>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  if (byPreflight && !task) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Empty description="未找到对应任务，无法加载 CQ+1 审查">
              <Button onClick={goBack}>返回</Button>
            </Empty>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  const busy = byMr
    ? approveMrCq.isPending || rejectMrCq.isPending
    : approveDryCq.isPending || rejectDryCq.isPending
  const busyAction: 'approve' | 'reject' | null = byMr
    ? approveMrCq.isPending ? 'approve' : rejectMrCq.isPending ? 'reject' : null
    : approveDryCq.isPending ? 'approve' : rejectDryCq.isPending ? 'reject' : null

  // 标题区：两种模式下不同的描述 Tag
  const headerInfo = byMr
    ? {
      title: `MR #${mr!.number} · ${mr!.title?.trim() || `${mr!.sourceBranch} → ${mr!.targetBranch}`}`,
      tags: [
        {
          key: 'mr-status',
          color: mr!.status === 'OPEN' ? 'blue' : mr!.status === 'MERGED' ? 'green' : 'default',
          label: mr!.status === 'OPEN' ? '进行中' : mr!.status === 'MERGED' ? '已合并' : '已关闭',
        },
        {
          key: 'cq',
          color: cqStatus === 'PASSED' ? 'success' : cqStatus === 'FAILED' ? 'error' : 'default',
          label:
            cqStatus === 'PASSED' ? 'CQ+1：已盖章' : cqStatus === 'FAILED' ? 'CQ+1：已拒绝' : 'CQ+1：待审查',
        },
      ],
    }
    : {
      title: task?.title?.trim() || `任务 ${taskId.slice(0, 8)}`,
      tags: [
        {
          key: 'task-status',
          color: 'cyan',
          label: `任务：${task?.status || '未知'}`,
        },
        {
          key: 'dry-run-status',
          color:
            dryRun?.status === 'PASSED'
              ? 'success'
              : dryRun?.status === 'FAILED'
                ? 'error'
                : dryRun?.status === 'RUNNING' || dryRun?.status === 'QUEUED'
                  ? 'geekblue'
                  : 'default',
          label: `Dry Run：${dryRun?.status || '暂无'}`,
        },
        {
          key: 'cq',
          color: preflightUnavailable || cqStatus === 'FAILED' ? 'error' : cqStatus === 'PASSED' ? 'success' : 'default',
          label:
            preflightUnavailable
              ? '预检失败'
              : cqStatus === 'PASSED' ? 'CQ+1：已盖章' : cqStatus === 'FAILED' ? 'CQ+1：已拒绝' : 'CQ+1：待审查',
        },
      ],
    }

  return (
    <ConfigProvider theme={pageTheme}>
      <div className={styles.page}>
        <BackTop />
        <button type="button" className={styles.backLink} onClick={goBack}>
          <LeftOutlined /> 返回质量门禁和MR
        </button>

        <header className={styles.header}>
          <div>
            <Title level={2} className={styles.title}>
              CQ+1 审查
            </Title>
            <Paragraph className={styles.subtitle}>{headerInfo.title}</Paragraph>
          </div>
          <Space wrap>{headerInfo.tags.map((t) => <Tag key={t.key} color={t.color}>{t.label}</Tag>)}</Space>
        </header>

        {/* ======== 模式 A：MR 级 —— 直接复用原 CqSealCard + findCqCheck ======== */}
        {byMr ? (
          checksQuery.isError ? (
            <Card className={styles.content}>
              <Empty description={formatApiError(checksQuery.error)}>
                <Button onClick={() => void checksQuery.refetch()}>重试</Button>
              </Empty>
            </Card>
          ) : (
            <Card className={styles.content}>
              <div className={styles.sealBlock}>
                <CqSealCard
                  check={cqFromMr ?? undefined}
                  headCommit={mr!.headCommit}
                  mrStatus={mr!.status}
                  isAuthor={isAuthor}
                  busy={busy}
                  busyAction={busyAction}
                  onApprove={() => submitCq('approve')}
                  onReject={() => submitCq('reject')}
                />
              </div>
              <div className={styles.submitSection}>
                <div className={styles.submitHeader}>
                  <Text strong>提交记录</Text>
                </div>
                <SubmitHistoryList
                  isAuthor={isAuthor}
                  cqStatus={cqStatus}
                  cqReason={cqFromMr?.reviewReason ?? null}
                  canAct={canReview}
                  busy={busy}
                  onApprove={() => submitCq('approve')}
                  onReject={() => submitCq('reject')}
                  reviewerUserId={cqFromMr?.reviewedByUserId ?? null}
                  cqReviewedByName={cqFromMr?.reviewedByName ?? null}
                  reviewedAt={cqFromMr?.completedAt ?? null}
                />
              </div>
            </Card>
          )
        ) : null}

        {/* ======== 模式 B：Preflight 级 —— 仅在非 MR 模式下渲染 ======== */}
        {byPreflight && !byMr ? (
          <Card className={styles.content}>
            {preflightUnavailable ? (
              <Alert
                type="error"
                showIcon
                message="预检未完成，暂不可进行 CQ+1"
                description={preflightQuery.error?.message || '预检服务暂时不可用，请稍后重试。'}
                action={<Button size="small" onClick={() => void preflightQuery.refetch()}>重试</Button>}
                style={{ marginBottom: 20 }}
              />
            ) : null}
            {/* Dry Run 上下文信息 */}
            <Descriptions size="small" column={2} style={{ marginBottom: 20 }} bordered>
              <Descriptions.Item label="Dry Run ID">
                {dryRun?.id ? (
                  <Text copyable>{dryRun.id.slice(0, 16)}…</Text>
                ) : (
                  <Text type="secondary">暂无</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="目标分支">
                {preflight?.targetBranch || targetBranch ? (
                  <Text code>{preflight?.targetBranch || targetBranch}</Text>
                ) : <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="源提交 (HEAD)">
                {preflight?.sourceCommit ? <Text code>{preflight.sourceCommit.slice(0, 12)}</Text> : <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="目标提交">
                {preflight?.targetCommit ? <Text code>{preflight.targetCommit.slice(0, 12)}</Text> : <Text type="secondary">—</Text>}
              </Descriptions.Item>
            </Descriptions>
            {reviewDiff ? (
              <Space style={{ marginBottom: 20 }}>
                <Button
                  icon={<CodeOutlined />}
                  onClick={() => navigate(PATHS.projectCodeDiff(projectId, reviewDiff.id))}
                >
                  查看代码 Diff
                </Button>
                <Text type="secondary">先查看本次提交的文件和行级变更，再决定是否盖 CQ+1。</Text>
              </Space>
            ) : null}

            {/* 自定义大印章（与 CqSealCard 视觉风格对齐，用 Preflight 数据） */}
            <div className={styles.sealBlock} aria-label="CQ+1 印章">
              <PreflightSeal
                status={dryRunCqStatus as 'PENDING' | 'APPROVED' | 'REJECTED'}
                isAuthor={isAuthor}
                dryRunStatus={dryRun?.status ?? null}
                sourceCommit={preflight?.sourceCommit ?? null}
                reason={cqPlusOne?.reason ?? null}
                reviewedAt={cqPlusOne?.reviewedAt ?? null}
                reviewerName={cqPlusOne?.reviewerName ?? null}
              />
            </div>

            <div className={styles.submitSection}>
              <div className={styles.submitHeader}>
                <Text strong>提交记录</Text>
              </div>
              <SubmitHistoryList
                isAuthor={isAuthor}
                cqStatus={cqStatus}
                cqReason={cqPlusOne?.reason ?? null}
                reviewerUserId={cqPlusOne?.reviewerUserId ?? null}
                cqReviewedByName={cqPlusOne?.reviewerName ?? null}
                reviewedAt={cqPlusOne?.reviewedAt ?? null}
                canAct={canReview}
                unavailable={preflightUnavailable}
                busy={busy}
                onApprove={() => submitCq('approve')}
                onReject={() => submitCq('reject')}
              />
            </div>
          </Card>
        ) : null}
      </div>
    </ConfigProvider>
  )
}

// ======== Preflight 模式下自定义大印章（视觉与 CqSealCard 保持一致） ========
function PreflightSeal({
  status,
  isAuthor,
  dryRunStatus,
  sourceCommit,
  reason,
}: {
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  isAuthor: boolean
  dryRunStatus: string | null
  sourceCommit: string | null
  reason: string | null
  reviewedAt: string | null
  reviewerName: string | null
}) {
  // 印章外观：locked / empty / stamped / failed
  let appearance: 'locked' | 'empty' | 'stamped' | 'failed' = 'empty'
  if (isAuthor) appearance = 'locked'
  else if (status === 'APPROVED') appearance = 'stamped'
  else if (status === 'REJECTED') appearance = 'failed'

  const sealClass = (
    appearance === 'stamped' ? styles.isStamped :
      appearance === 'failed' ? styles.isFailed :
        appearance === 'locked' ? styles.isLocked : styles.isEmpty
  )
  const sha = sourceCommit?.slice(0, 7) ?? '—'
  const stateLabel =
    appearance === 'stamped' ? '有效' :
      appearance === 'failed' ? '未通过' :
        appearance === 'locked' ? '锁定' : '未盖章'
  const caption =
    appearance === 'locked' ? '不能给自己盖章' :
      appearance === 'stamped' ? 'CQ+1 已盖章' :
        appearance === 'failed' ? 'CQ+1 已被拒绝' :
          dryRunStatus === 'PASSED' ? 'Dry Run 已通过，等待审查者盖章' : `Dry Run：${dryRunStatus || '暂无'}，暂不可盖章`

  return (
    <>
      <div className={`${styles.seal} ${sealClass}`} data-appearance={appearance} aria-hidden="true">
        <div className={styles.sealRing}>
          <div className={styles.sealInner}>
            {appearance === 'locked' ? <LockOutlined className={styles.sealLock} /> : null}
            <span className={styles.sealMark}>CQ+1</span>
            <span className={styles.sealSha}>{sha}</span>
            <span className={styles.sealState}>{stateLabel}</span>
          </div>
        </div>
      </div>
      <div className={styles.sealMeta}>
        <p>{caption}</p>
        {reason && (appearance === 'stamped' || appearance === 'failed') ? (
          <Text type="secondary">{reason}</Text>
        ) : null}
      </div>
    </>
  )
}

// ======== 公共提交记录/操作区 ========
function SubmitHistoryList({
  isAuthor,
  cqStatus,
  cqReason,
  reviewerUserId,
  reviewedAt,
  canAct,
  unavailable,
  busy,
  onApprove,
  onReject,
  cqReviewedByName,
}: {
  isAuthor: boolean
  cqStatus: string
  cqReason: string | null
  reviewerUserId: string | null
  reviewedAt: string | null
  canAct: boolean
  unavailable?: boolean
  busy: boolean
  onApprove: () => void
  onReject: () => void
  cqReviewedByName?: string | null
}) {
  const reviewerDisplay =
    cqReviewedByName || (reviewerUserId ? `用户 ${reviewerUserId.slice(0, 8)}` : null)

  return (
    <div className={styles.submitList}>
      {canAct ? (
        <div className={styles.submitActions}>
          <Button type="primary" disabled={busy} onClick={onApprove}>
            盖 CQ+1
          </Button>
          <Button danger disabled={busy} onClick={onReject}>
            拒绝
          </Button>
          <Text type="secondary">请在上方印章处确认审查</Text>
        </div>
      ) : cqStatus === 'PASSED' ? (
        <div className={styles.submitSuccess}>
          <CheckCircleFilled style={{ color: '#16a34a', fontSize: 24 }} />
          <div>
            <Text strong>CQ+1 已通过</Text>
            {reviewerDisplay ? <Text type="secondary"> · by {reviewerDisplay}</Text> : null}
            {reviewedAt ? <Text type="secondary"> · {reviewedAt}</Text> : null}
          </div>
        </div>
      ) : cqStatus === 'FAILED' ? (
        <div className={styles.submitFailed}>
          <CloseCircleFilled style={{ color: '#dc2626', fontSize: 24 }} />
          <div>
            <Text strong>CQ+1 已拒绝</Text>
            {cqReason ? (
              <Paragraph type="secondary" style={{ marginTop: 4 }}>
                拒绝理由：{cqReason}
              </Paragraph>
            ) : null}
          </div>
        </div>
      ) : unavailable ? (
        <div className={styles.submitFailed}>
          <CloseCircleFilled style={{ color: '#dc2626', fontSize: 24 }} />
          <div>
            <Text strong>预检未完成，暂不可进行 CQ+1</Text>
            <Text type="secondary">请等待预检服务恢复后重试</Text>
          </div>
        </div>
      ) : isAuthor ? (
        <div className={styles.submitLocked}>
          <LockOutlined style={{ color: '#94a3b8', fontSize: 20 }} />
          <Text type="secondary">不能审核自己的任务，请等待他人审查</Text>
        </div>
      ) : (
        <div className={styles.submitPending}>
          <ClockCircleFilled style={{ color: '#94a3b8', fontSize: 20 }} />
          <Text type="secondary">等待 CQ+1 审查</Text>
        </div>
      )}
    </div>
  )
}
