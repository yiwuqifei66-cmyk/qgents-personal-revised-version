import { Button, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { PATHS } from '@/routes/paths'
import type { TaskStatusMessageContent, TaskStatusRepositoryMapping } from '@/types'

const { Text } = Typography

export function TaskStatusCard({ content, queriedStatus, projectId }: { content: TaskStatusMessageContent; queriedStatus?: string; projectId: string }) {
  const steps = content.plan?.steps ?? []
  const mappings = normalizeMappings(content.repositoryMappings).filter((m) => content.currentRepositoryPaths === undefined || content.currentRepositoryPaths.includes(m.workspacePath))
  const messageStatus = content.status?.toUpperCase()
  const queried = queriedStatus?.toUpperCase()
  const hasRunningStep = steps.some((step) => step.status === 'RUNNING')
  const stale = !queried || ['PLANNING', 'PENDING', 'RUNNING', 'IN_PROGRESS'].includes(queried)
  const terminal = Boolean(messageStatus && ['WAITING_DIFF_CONFIRMATION', 'WAITING_PREFLIGHT', 'DELIVERING', 'DELIVERY_FAILED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(messageStatus))
  const display = terminal && stale ? messageStatus! : queried === 'PLANNING' && (messageStatus !== 'PLANNING' || hasRunningStep) ? (messageStatus && messageStatus !== 'PLANNING' ? messageStatus : 'RUNNING') : (queried ?? messageStatus ?? 'PLANNING')
  const diffReady = ['WAITING_DIFF_CONFIRMATION', 'DELIVERING', 'DELIVERY_FAILED', 'SUCCEEDED'].includes(display)
  return <div className="chat-panel__task-status-card">
    <div className="chat-panel__task-status-header"><strong>{content.phase ? `${content.phase} · ` : ''}任务运行状态</strong><Tag color={taskStatusColor(display)}>{taskStatusLabel(display)}</Tag></div>
    {content.message ? <Text>{content.message}</Text> : null}
    {content.plan?.summary ? <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{content.plan.summary}</Text> : null}
    {content.deliveryMode ? <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{content.deliveryMode}{content.deliveryReason ? ` · ${content.deliveryReason}` : ''}</Text> : null}
    {mappings.length ? <div className="chat-panel__task-status-repositories"><Text type="secondary" style={{ fontSize: 12 }}>当前操作仓库：</Text>{mappings.map((m) => <div key={`${m.repositoryId}:${m.workspacePath}`}><Tag>{m.fullName ?? m.name ?? m.workspacePath}</Tag><Text type="secondary" style={{ fontSize: 11 }}>工作区目录：{m.workspacePath}</Text></div>)}</div> : null}
    {steps.length ? <div className="chat-panel__task-status-steps">{steps.map((step) => <div key={step.stepId} className="chat-panel__task-status-step"><span style={{ background: stepStatusColor(step.status) }} /><div><div><Text strong>{step.sequence}.</Text> {step.title}{step.role ? <Text type="secondary" style={{ fontSize: 11 }}> · {step.role}</Text> : null}</div>{step.message ? <Text type="secondary" style={{ fontSize: 12 }}>{step.message}</Text> : null}</div></div>)}</div> : null}
    <div className="chat-panel__task-status-footer"><Text type="secondary" style={{ fontSize: 12 }}>{diffReady ? '任务已产生代码变更' : '代码变更生成后在此查看'}</Text>{diffReady ? <Link to={`${PATHS.projectDiffs(projectId)}?taskId=${encodeURIComponent(content.taskId)}`}><Button size="small" type="link">查看交付详情</Button></Link> : <Link to={PATHS.projectTaskDetail(projectId, content.taskId)}><Button size="small" type="link">查看任务</Button></Link>}</div>
  </div>
}

function normalizeMappings(mappings: TaskStatusMessageContent['repositoryMappings']): TaskStatusRepositoryMapping[] {
  if (!Array.isArray(mappings)) return []
  const unique = new Map<string, TaskStatusRepositoryMapping>()
  for (const mapping of mappings) if (mapping?.workspacePath && mapping.repositoryId) unique.set(`${mapping.repositoryId}:${mapping.workspacePath}`, mapping)
  return [...unique.values()].sort((a, b) => a.workspacePath.localeCompare(b.workspacePath))
}
function taskStatusColor(status: string): string { if (status.includes('FAIL')) return 'red'; if (['SUCCEEDED', 'DELIVERING'].includes(status)) return 'green'; if (status.includes('WAITING')) return 'orange'; return 'blue' }
function stepStatusColor(status: string): string { if (status === 'SUCCEEDED') return '#16a34a'; if (status === 'FAILED') return '#dc2626'; if (status === 'RUNNING') return '#2563eb'; return '#94a3b8' }
function taskStatusLabel(status: string): string { const labels: Record<string, string> = { PLANNING: '规划中', PENDING: '排队中', RUNNING: '执行中', WAITING_DIFF_CONFIRMATION: '等待确认', WAITING_PREFLIGHT: '等待预检', DELIVERING: '交付中', DELIVERY_FAILED: '交付失败', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消' }; return labels[status] ?? status }
