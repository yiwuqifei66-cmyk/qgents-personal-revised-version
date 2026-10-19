import { Button, Card, Progress, Space, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { TaskListItem } from '@/types/task-model'
import { TaskModelStatusTag } from './TaskModelStatusTag'
import { useTaskCompletedWithoutCode } from '@/store/taskNoCodeChangeStore'
import { formatExactTime, formatRelativeTime, taskExecutionSummary, taskRepositories, valueOrNone } from './taskDisplay'
import styles from './TaskCenterPage.module.scss'

const { Text, Paragraph } = Typography

interface TaskCardProps {
  task: TaskListItem
  onViewDetails: (taskId: string) => void
}

export function TaskCard({ task: rawTask, onViewDetails }: TaskCardProps) {
  const task: TaskListItem = {
    ...rawTask,
    repositories: taskRepositories(rawTask),
    executionSummary: taskExecutionSummary(rawTask) ?? {
      totalSteps: 0,
      pendingSteps: 0,
      runningSteps: 0,
      waitingSteps: 0,
      blockedSteps: 0,
      succeededSteps: 0,
      failedSteps: 0,
      currentStage: null,
      currentStageTitle: null,
      requiresUserAction: false,
    },
  }
  const completedWithoutCode = useTaskCompletedWithoutCode(task.projectId, task.id)
  const hasActiveExecution = task.status === 'RUNNING' || task.executionSummary.runningSteps > 0
  // 任务最终失败时进度条以红色异常样式呈现，与「成功完成度」语义一致：失败任务按成功步骤占比
  // 显示百分比，同时用红色明确传达失败终态，避免与成功任务的 100% 混淆。
  const taskFailed = task.status === 'FAILED' || task.status === 'DELIVERY_FAILED'
  // 已取消任务进度条以橙色（antd warning 色）呈现，与失败红色、成功蓝色区分。
  const taskCancelled = task.status === 'CANCELLED'
  const attentionText = !hasActiveExecution && task.attention ? [task.attention.title, task.attention.summary].filter((value): value is string => Boolean(value)).join('：') : null
  return (
    <Card
      className={styles.taskCard}
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={() => onViewDetails(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onViewDetails(task.id)
      }}
    >
      <div className={styles.taskCardHeading}>
        <Text className={styles.taskCode}>#{valueOrNone(task.displayCode)}</Text>
        <div className={styles.taskCardTitleLine}>
          <Typography.Title level={5} ellipsis={{ tooltip: valueOrNone(task.title) }}>{valueOrNone(task.title)}</Typography.Title>
          <TaskModelStatusTag status={task.status} completedWithoutCode={completedWithoutCode} />
        </div>
      </div>
      <Space wrap size={[6, 6]} className={styles.taskCardTags}>
        <Tag className={styles.groupTag}>{valueOrNone(task.requirementGroup?.name)}</Tag>
        <Tag className={styles.deliveryTag}>{task.deliveryMode ?? '待判定'}</Tag>
      </Space>
      <Paragraph ellipsis={{ rows: 1, tooltip: valueOrNone(task.requirementSummary) }} className={styles.taskCardCopy}>{valueOrNone(task.requirementSummary)}</Paragraph>
      <div className={styles.taskCardInfoGrid}>
        <div>
          <Text type="secondary">仓库</Text>
          <RepositoryLocation task={task} />
        </div>
        <div>
          <Text type="secondary">发起人</Text>
          <Tooltip title={valueOrNone(task.createdByUser?.displayName)}>
            <Text className={styles.taskInfoEllipsis}>{valueOrNone(task.createdByUser?.displayName)}</Text>
          </Tooltip>
        </div>
        <div>
          <Text type="secondary">执行概览</Text>
          <Tooltip title={<ExecutionSummaryTooltip summary={task.executionSummary} />}>
            <div className={styles.executionOverview}>
              <Text className={styles.taskInfoEllipsis}>{valueOrNone(task.executionSummary.currentStageTitle ?? task.executionSummary.currentStage)}</Text>
              <Progress percent={executionPercent(task.executionSummary, task.status)} size="small" showInfo status={taskFailed ? 'exception' : undefined} strokeColor={taskCancelled ? '#faad14' : undefined} />
            </div>
          </Tooltip>
        </div>
      </div>
      {attentionText ? <Tooltip title={attentionText}><div className={styles.taskCardAttention}>{attentionText}</div></Tooltip> : <div className={`${styles.taskCardAttention} ${styles.taskCardAttentionPlaceholder}`} />}
      <div className={styles.taskCardDates}><Tooltip title={formatExactTime(task.updatedAt)}><Text type="secondary">更新：{formatRelativeTime(task.updatedAt)}</Text></Tooltip></div>
      <div className={styles.taskCardActions}>
        <Button type="link" className={styles.cardDetailsButton} onClick={(event) => { event.stopPropagation(); onViewDetails(task.id) }}>
          查看完整任务详情
        </Button>
      </div>
    </Card>
  )
}

function RepositoryLocation({ task }: { task: TaskListItem }) {
  const repositories = task.repositories
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRefs = useRef<Array<HTMLSpanElement | null>>([])
  const [visibleCount, setVisibleCount] = useState(repositories.length)
  const repositorySignature = repositories.map((repository) => `${repository.repositoryId}:${repository.name}`).join('|')

  const updateVisibleCount = useCallback(() => {
    const availableWidth = containerRef.current?.clientWidth ?? 0
    const widths = measureRefs.current.map((element) => element?.getBoundingClientRect().width ?? 0)
    if (availableWidth <= 0 || widths.length === 0) return

    const gap = 4
    const moreWidth = 30
    const allWidth = widths.reduce((total, width, index) => total + width + (index > 0 ? gap : 0), 0)
    if (allWidth <= availableWidth) {
      setVisibleCount(repositories.length)
      return
    }

    let usedWidth = 0
    let count = 0
    for (const width of widths) {
      const nextWidth = usedWidth + (count > 0 ? gap : 0) + width
      if (nextWidth + moreWidth > availableWidth && count > 0) break
      usedWidth = nextWidth
      count += 1
    }
    setVisibleCount(Math.max(1, count))
  }, [repositories.length])

  useLayoutEffect(() => {
    updateVisibleCount()
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateVisibleCount)
    observer.observe(container)
    return () => observer.disconnect()
  }, [repositorySignature, updateVisibleCount])

  if (repositories.length === 0) return <Text className={styles.taskInfoEllipsis}>{task.status === 'PLANNING' ? '规划中，待分析涉及仓库' : '暂无'}</Text>
  const hiddenCount = repositories.length - visibleCount
  return (
    <Tooltip title={repositorySummary(task)}>
      <div ref={containerRef} className={styles.repositoryLocationValue}>
        <div className={styles.repositoryVisibleTags}>
          {repositories.slice(0, visibleCount).map((repository) => <Tag key={repository.repositoryId} className={styles.repositoryName}>{repository.name}</Tag>)}
          {hiddenCount > 0 ? <Text className={styles.repositoryMore}>+{hiddenCount}</Text> : null}
        </div>
        <div aria-hidden className={styles.repositoryMeasure}>
          {repositories.map((repository, index) => (
            <span key={repository.repositoryId} ref={(element) => { measureRefs.current[index] = element }}><Tag className={styles.repositoryName}>{repository.name}</Tag></span>
          ))}
        </div>
      </div>
    </Tooltip>
  )
}

function repositorySummary(task: TaskListItem): string {
  if (task.repositories.length === 0) return task.status === 'PLANNING' ? '规划中，待分析涉及仓库' : '暂无'
  return task.repositories.map((repository) => repository.name).join('、')
}

function executionPercent(summary: TaskListItem['executionSummary'], taskStatus: TaskListItem['status']): number {
  if (summary.totalSteps <= 0) return 0
  // 进度条语义 = 成功完成度：
  // - 任务成功终态（含成功路径的交付中间态）强制 100%——任务成功即视为全部完成，避免
  //   「任务成功但某验证/测试步骤未通过」时进度停在 75%（如 VERIFY 步骤 FAILED）；
  // - 执行中/失败/取消按成功步骤占比（succeeded/total）——失败任务不显示 100% 的误导
  //   进度（如任务 FAILED 但所有步骤都已终态时，「终态占比」口径会错误地显示 100%）。
  const successful = taskStatus === 'SUCCEEDED' || taskStatus === 'WAITING_DIFF_CONFIRMATION'
    || taskStatus === 'DELIVERING' || taskStatus === 'WAITING_PREFLIGHT'
  if (successful) return 100
  return Math.min(100, Math.round((summary.succeededSteps / summary.totalSteps) * 100))
}

function ExecutionSummaryTooltip({ summary }: { summary: TaskListItem['executionSummary'] }) {
  return <div>{valueOrNone(summary.currentStageTitle ?? summary.currentStage)}</div>
}
