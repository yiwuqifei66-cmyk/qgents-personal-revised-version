import type { TaskStatus } from '@/types/task-model'

export type TaskCenterStatusFilter = 'all' | TaskStatus
export type TaskCenterView = 'board' | 'table'

export const TASK_CENTER_STATUS_OPTIONS: Array<{ value: TaskCenterStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'PLANNING', label: '规划中' },
  { value: 'PENDING', label: '待处理' },
  { value: 'RUNNING', label: '运行中' },
  { value: 'WAITING_DIFF_CONFIRMATION', label: '等待 Diff 确认' },
  { value: 'DELIVERING', label: '交付中' },
  { value: 'DELIVERY_FAILED', label: '交付失败' },
  { value: 'SUCCEEDED', label: '已完成' },
  { value: 'FAILED', label: '失败' },
  { value: 'CANCELLING', label: '取消中' },
  { value: 'CANCELLED', label: '已取消' },
]
