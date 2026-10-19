import { Tooltip } from 'antd'
import {
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import { PATHS } from '@/routes/paths'
import styles from './FlowStepper.module.scss'

export type FlowStep = 'gate' | 'cq' | 'createMr'

export interface FlowStepStatus {
  gate: 'pending' | 'passed' | 'failed' | 'disabled'
  cq: 'pending' | 'approved' | 'rejected' | 'disabled'
  createMr: boolean
}

interface FlowStepperProps {
  projectId: string
  status: FlowStepStatus
  /** 紧凑模式：缩小 padding / node / circle 尺寸，降低页面高度占比（其它页面不传则用默认尺寸） */
  compact?: boolean
  /** 是否已存在 OPEN 状态的 MR（大任务自动创建后传 true，节点会变绿并提示"MR 已创建"，不传则旧行为不变） */
  mrCreated?: boolean
  /** 点击第一个节点「testset和dry-run」，未传则默认跳 testset 页质量门禁详情 */
  onClickGate?: () => void
  /** 点击"CQ+1"节点，未传则点击该节点不响应 */
  onClickCq?: () => void
  /** 点击"创建 MR"节点（仅未创建时触发；已创建时节点不可点击） */
  onClickCreateMr?: () => void
}

export function FlowStepper({
  projectId,
  status,
  compact,
  mrCreated,
  onClickGate,
  onClickCq,
  onClickCreateMr,
}: FlowStepperProps) {
  const preconditionsMet = status.gate === 'passed' && status.cq === 'approved'
  const stepNodeCompact = Boolean(compact)
  // 创建 MR 节点状态三态：已创建 → 绿(passed)；条件满足未创建 → 蓝(active)；否则 → 灰(disabled)
  const createMrNodeStatus: 'passed' | 'active' | 'disabled' = mrCreated
    ? 'passed'
    : preconditionsMet
      ? 'active'
      : 'disabled'
  const createMrDesc =
    mrCreated ? 'MR 已创建' : preconditionsMet ? '可以创建 MR' : '等待 testset 和 dry-run 与 CQ+1 通过'
  // 创建 MR 节点可点击 = active（条件满足未创建），显示蓝色实心带点击态
  // onClickCreateMr 未传的话也保持可点击外观（但不响应，避免在没有回调的场景下看起来"按钮灰着像没达到条件"）
  const createMrClickable = createMrNodeStatus === 'active'
  // 第二段连接线：只有创建 MR 节点是绿（已创建）时才变绿（代表这一段流程真正走完）
  const secondConnectorPassed = mrCreated

  return (
    <div className={`${styles.stepper} ${compact ? styles.stepperCompact : ''}`}>
      {/* 连接线 1: gate → cq */}
      <div
        className={`${styles.connector} ${status.gate === 'passed' ? styles.connectorPassed : ''}`}
      />

      {/* 连接线 2: cq → createMr */}
      <div
        className={`${styles.connector} ${styles.connectorSecond} ${secondConnectorPassed ? styles.connectorPassed : ''
          }`}
      />

      {/* 节点 1: testset和dry-run（原"质量门禁"，现改名更贴合实际执行链路） */}
      <StepNode
        aria-label="步骤：testset 和 dry-run"
        label="testset和dry-run"
        status={status.gate === 'disabled' ? 'disabled' : status.gate === 'pending' ? 'pending' : status.gate === 'passed' ? 'passed' : 'failed'}
        description={stepDescription('gate', status.gate)}
        onClick={onClickGate}
        href={onClickGate ? undefined : status.gate === 'disabled' ? undefined : PATHS.projectQualityGate(projectId)}
        compact={stepNodeCompact}
      />

      {/* 节点 2: CQ+1 */}
      <StepNode
        aria-label="步骤：CQ+1 人工审查盖章"
        label="CQ+1"
        status={
          status.cq === 'disabled' ? 'disabled' : status.cq === 'pending' ? 'pending' : status.cq === 'approved' ? 'passed' : 'failed'
        }
        description={stepDescription('cq', status.cq)}
        onClick={status.cq === 'disabled' ? undefined : onClickCq}
        compact={stepNodeCompact}
      />

      {/* 节点 3: 创建 MR */}
      <StepNode
        aria-label="步骤：创建 MR"
        label="创建 MR"
        status={createMrNodeStatus}
        description={createMrDesc}
        onClick={createMrClickable ? onClickCreateMr : undefined}
        isAction
        compact={stepNodeCompact}
      />
    </div>
  )
}

function stepDescription(step: FlowStep, status: FlowStepStatus[FlowStep]): string {
  if (step === 'gate') {
    if (status === 'disabled') return '未开始'
    if (status === 'passed') return '已通过'
    if (status === 'failed') return '未通过'
    return '待检查'
  }
  if (step === 'cq') {
    if (status === 'disabled') return '未开始'
    if (status === 'approved') return '已盖章'
    if (status === 'rejected') return '已拒绝'
    return '待盖章'
  }
  return ''
}

type NodeStatus = 'pending' | 'passed' | 'failed' | 'active' | 'disabled'

interface StepNodeProps {
  ariaLabel?: string
  label: string
  status: NodeStatus
  description: string
  href?: string
  onClick?: () => void
  isAction?: boolean
  compact?: boolean
}

function StepNode({ ariaLabel, label, status, description, href, onClick, isAction, compact }: StepNodeProps) {
  const icon = nodeIcon(status)
  const className = [
    styles.node,
    styles[`node_${status}`],
    href || onClick ? styles.nodeClickable : '',
    isAction ? styles.nodeAction : '',
    compact ? styles.nodeCompact : '',
  ]
    .filter(Boolean)
    .join(' ')

  const circleClassName = [styles.nodeCircle, compact ? styles.nodeCircleCompact : '']
    .filter(Boolean)
    .join(' ')
  const labelClassName = [styles.nodeLabel, compact ? styles.nodeLabelCompact : '']
    .filter(Boolean)
    .join(' ')
  const descClassName = [styles.nodeDesc, compact ? styles.nodeDescCompact : '']
    .filter(Boolean)
    .join(' ')

  if (href && !onClick) {
    return (
      <Tooltip title={description}>
        <a href={href} className={className} aria-label={ariaLabel}>
          <div className={circleClassName}>{icon}</div>
          <div className={labelClassName}>{label}</div>
          <div className={descClassName}>{description}</div>
        </a>
      </Tooltip>
    )
  }

  if (!onClick) {
    return (
      <Tooltip title={description}>
        <div className={className} aria-label={ariaLabel}>
          <div className={circleClassName}>{icon}</div>
          <div className={labelClassName}>{label}</div>
          <div className={descClassName}>{description}</div>
        </div>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={status === 'disabled' ? description : undefined}>
      <button
        type="button"
        aria-label={ariaLabel}
        className={className}
        onClick={onClick}
        disabled={status === 'disabled'}
      >
        <div className={circleClassName}>{icon}</div>
        <div className={labelClassName}>{label}</div>
        <div className={descClassName}>{description}</div>
      </button>
    </Tooltip>
  )
}

function nodeIcon(status: NodeStatus): React.ReactNode {
  if (status === 'passed' || status === 'active') {
    return <CheckCircleFilled />
  }
  if (status === 'failed') {
    return <CloseCircleFilled />
  }
  if (status === 'pending') {
    return <ClockCircleFilled />
  }
  if (status === 'disabled') {
    return <QuestionCircleOutlined />
  }
  return null
}
