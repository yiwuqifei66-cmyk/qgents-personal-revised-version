import { Tag } from 'antd'
import type { TaskStatus } from '@/types/task-model'

const STATUS_META: Record<TaskStatus, { color: string; label: string }> = {
  PLANNING: { color: 'blue', label: '规划中' },
  PENDING: { color: 'gold', label: '待处理' },
  RUNNING: { color: 'processing', label: '运行中' },
  WAITING_DIFF_CONFIRMATION: { color: 'gold', label: '等待 Diff 确认' },
  WAITING_PREFLIGHT: { color: 'gold', label: '等待 CQ+1' },
  DIFF_REJECTED: { color: 'error', label: 'Diff 已拒绝' },
  DELIVERING: { color: 'processing', label: '交付中' },
  DELIVERY_FAILED: { color: 'error', label: '交付失败' },
  SUCCEEDED: { color: 'success', label: '已完成' },
  FAILED: { color: 'error', label: '失败' },
  CANCELLING: { color: 'warning', label: '取消中' },
  CANCELLED: { color: 'default', label: '已取消' },
}

export function TaskModelStatusTag({ status, completedWithoutCode = false }: { status: TaskStatus; completedWithoutCode?: boolean }) {
  // 兜底：后端新增状态未同步时原样展示，避免 meta 为 undefined 崩溃
  const meta = STATUS_META[status] ?? { color: 'default', label: status }
  return <Tag color={meta.color}>{completedWithoutCode && status === 'SUCCEEDED' ? '已完成，无代码变更' : meta.label}</Tag>
}
