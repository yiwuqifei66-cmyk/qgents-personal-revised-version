import { useState } from 'react'
import { Alert, Avatar, Button, Empty, Spin, Tag, Tooltip, Typography } from 'antd'
import { CloudUploadOutlined, EditOutlined, InboxOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAgentAssignments, useAgentRuntime, useAgentTaskRuns } from '@/hooks'
import type { AgentAssignmentSummary, AgentDetail, AgentDetailTab, AgentRuntimeSummary, AgentSummary, AgentTaskRunSummary } from '@/types'
import { PATHS } from '@/routes/paths'
import styles from './AgentDetailPanel.module.scss'

const { Text, Title } = Typography

const tabs: Array<{ key: AgentDetailTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'assignments', label: '分配详情' },
  { key: 'config', label: '配置' },
  { key: 'runs', label: '运行记录' },
]

interface AgentDetailPanelProps {
  projectId: string
  agent: AgentDetail | AgentSummary
  detail?: AgentDetail
  onEdit: () => void
  canEdit: boolean
  onPublish: () => void
  onArchive: () => void
  canPublish: boolean
  canArchive: boolean
}

export function AgentDetailPanel({ projectId, agent, detail, onEdit, canEdit, onPublish, onArchive, canPublish, canArchive }: AgentDetailPanelProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<AgentDetailTab>('overview')
  const current = detail ?? agent
  const assignmentsGroups = useAgentAssignments(projectId, current.id, { type: 'REQUIREMENT_GROUP' }, activeTab === 'assignments')
  const runs = useAgentTaskRuns(projectId, current.id, undefined, activeTab === 'overview' || activeTab === 'runs')
  const runtimeQuery = useAgentRuntime(projectId, current.id, activeTab === 'overview')
  const task = runs.data?.data.find((item) => ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED', 'CANCELLING'].includes(item.status))

  return <aside className={styles.panel}>
    <header className={styles.header}>
      <div className={styles.identity}>
        <Avatar className={styles.avatar} src={current.avatar ?? undefined}>{current.name.slice(0, 2)}</Avatar>
        <div className={styles.identityText}><Title level={4} className={styles.name}>{current.name}</Title><Text type="secondary">{current.role}</Text></div>
      </div>
      <div className={styles.actions}>{canEdit ? <Tooltip title="编辑"><Button size="small" type="text" icon={<EditOutlined />} aria-label="编辑" onClick={onEdit} /></Tooltip> : null}{canPublish ? <Tooltip title="发布为 TEAM"><Button size="small" type="text" icon={<CloudUploadOutlined />} aria-label="发布为 TEAM" onClick={onPublish} /></Tooltip> : null}{canArchive ? <Tooltip title="归档"><Button size="small" type="text" danger icon={<InboxOutlined />} aria-label="归档" onClick={onArchive} /></Tooltip> : null}</div>
    </header>
    <nav className={styles.tabs} aria-label="Agent 详情 Tab">
      {tabs.map((tab) => <button type="button" key={tab.key} className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}
    </nav>
    <div className={styles.body}>
      {activeTab === 'overview' ? <Overview agent={current} runtime={runtimeQuery} task={task} /> : null}
      {activeTab === 'assignments' ? <Assignments groups={assignmentsGroups} /> : null}
      {activeTab === 'config' ? <Config agent={current} /> : null}
      {activeTab === 'runs' ? <Runs projectId={projectId} query={runs} navigate={navigate} /> : null}
    </div>
  </aside>
}

function Overview({ agent, runtime, task }: { agent: AgentDetail | AgentSummary; runtime: ReturnType<typeof useAgentRuntime>; task?: AgentTaskRunSummary }) {
  if (runtime.isLoading) return <Spin />
  if (runtime.isError || !runtime.data) return <Alert type="error" showIcon message="Agent runtime 数据加载失败" />
  const data: AgentRuntimeSummary = runtime.data
  return <div>
    <section className={styles.section}><Text className={styles.description}>{agent.description ?? '暂无描述'}</Text></section>
    <section className={styles.usageGrid} aria-label="Agent 运行使用量">
      <Usage label="实时状态" value={data.status} />
      <Usage label="并发使用量" value={`${data.activeRunCount}/${data.concurrencyLimit ?? '暂无'}`} />
      <Usage label="需求群分配" value={`${data.assignmentUsage.requirementGroups.assignedCount}/${data.assignmentUsage.requirementGroups.assignableCount}`} />
    </section>
    <section className={styles.section}><Title level={5}>当前正在执行的 TaskRun</Title>{task ? <TaskRunSummaryCard run={task} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有正在执行的 TaskRun" />}</section>
  </div>
}

function Usage({ label, value }: { label: string; value: string }) { return <div className={styles.usage}><Text type="secondary">{label}</Text><strong>{value}</strong></div> }

function Assignments({ groups }: { groups: ReturnType<typeof useAgentAssignments> }) {
  return <div className={styles.assignmentColumns}><AssignmentList title="已分配需求群" query={groups} /></div>
}

function AssignmentList({ title, query }: { title: string; query: ReturnType<typeof useAgentAssignments> }) {
  if (query.isLoading) return <section className={styles.card}><Title level={5}>{title}</Title><Spin size="small" /></section>
  if (query.isError) return <section className={styles.card}><Title level={5}>{title}</Title><Alert type="error" showIcon message="分配详情加载失败" /></section>
  const items = query.data?.data ?? []
  return <section className={styles.card}><Title level={5}>{title}</Title>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分配" /> : <ul className={styles.list}>{items.map((item) => <AssignmentItem key={item.resourceId} item={item} />)}</ul>}</section>
}

function AssignmentItem({ item }: { item: AgentAssignmentSummary }) { return <li><span>{item.resourceName}</span><Tag>{item.status}</Tag></li> }

function Config({ agent }: { agent: AgentDetail | AgentSummary }) {
  return <section className={styles.card}><Title level={5}>现有配置</Title><dl className={styles.definition}><dt>可见性</dt><dd>{agent.visibility}</dd><dt>生命周期</dt><dd>{agent.status}</dd><dt>Prompt</dt><dd>{'prompt' in agent && agent.prompt ? agent.prompt : '未提供或无权限查看'}</dd></dl><Text type="secondary">当前保留自定义 Agent 入口与原有配置内容，本轮不新增保存字段。</Text></section>
}

function Runs({ projectId, query, navigate }: { projectId: string; query: ReturnType<typeof useAgentTaskRuns>; navigate: ReturnType<typeof useNavigate> }) {
  if (query.isLoading) return <Spin />
  if (query.isError) return <Alert type="error" showIcon message="运行记录加载失败" />
  const runs = query.data?.data ?? []
  if (runs.length === 0) return <Empty description="暂无运行记录" />
  return <div className={styles.runList}>{runs.map((run) => <button type="button" className={styles.runItem} key={run.id} onClick={() => navigate(PATHS.projectTaskRunDetail(projectId, run.taskId, run.id))}><div className={styles.runHeader}><strong>{run.taskDisplayCode}</strong><RunStatusTag status={run.status} /></div><Text>{run.taskTitle}</Text><Text type="secondary">{run.taskStepTitle} · {run.requirementGroup.name}</Text><Text type="secondary">{run.repository?.name ?? '暂无仓库'} · {formatDate(run.createdAt)}</Text></button>)}</div>
}

function TaskRunSummaryCard({ run }: { run: AgentTaskRunSummary }) { return <div className={styles.taskCard}><div><Text strong>{run.taskDisplayCode}</Text><Text> · {run.taskTitle}</Text></div><Text type="secondary">TaskStep：{run.taskStepTitle}</Text><Text type="secondary">需求群：{run.requirementGroup.name}</Text><Text type="secondary">仓库：{run.repository?.name ?? '暂无仓库'}</Text><RunStatusTag status={run.status} /><Text type="secondary">创建：{formatDate(run.createdAt)}</Text></div> }

function RunStatusTag({ status }: { status: AgentTaskRunSummary['status'] }) { return <Tag color={runStatusColor(status)}>{status}</Tag> }

function runStatusColor(status: AgentTaskRunSummary['status']): 'success' | 'processing' | 'warning' | 'error' | 'default' {
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'RUNNING' || status === 'CANCELLING') return 'processing'
  if (status === 'QUEUED' || status === 'WAITING_INPUT' || status === 'WAITING_APPROVAL') return 'warning'
  if (status === 'FAILED' || status === 'BLOCKED') return 'error'
  return 'default'
}

function formatDate(value: string | null): string { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未开始' }
