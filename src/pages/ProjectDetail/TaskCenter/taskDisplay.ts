import type { TaskExecutionSummary, TaskListItem, TaskRepositorySummary } from '@/types/task-model'

export function valueOrNone(value: string | null | undefined): string {
  return value?.trim() || '暂无'
}

export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '暂无'
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return '暂无'
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return formatDateTime(value, false)
}

export function formatExactTime(value: string | null | undefined): string {
  return formatDateTime(value, true)
}

function formatDateTime(value: string | null | undefined, withSeconds: boolean): string {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  const pad = (part: number) => String(part).padStart(2, '0')
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}${withSeconds ? `:${pad(date.getSeconds())}` : ''}`
  return `${datePart} ${timePart}`
}

/** Safely render a list item while its repository projection is still incomplete. */
export function taskRepositories(task: Pick<TaskListItem, 'repositories'>): TaskRepositorySummary[] {
  return Array.isArray(task.repositories) ? task.repositories : []
}

/** Planner 尚未选出写入仓库时，避免把空投影误显示成“暂无目标”。 */
export function taskRepositoryLabel(task: Pick<TaskListItem, 'repositories' | 'status'>): string {
  const repositories = taskRepositories(task)
  if (repositories.length > 0) return repositories.map((repository) => repository.name).join('、')
  return task.status === 'PLANNING' ? '规划中，待分析涉及仓库' : '暂无'
}

/** Safely render a list item while its execution projection is still incomplete. */
export function taskExecutionSummary(task: Pick<TaskListItem, 'executionSummary'>): TaskExecutionSummary | null {
  const summary = task.executionSummary
  return summary && typeof summary === 'object' ? summary : null
}
