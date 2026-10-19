import { useEffect, useState } from 'react'
import { Alert, App, Avatar, Button, Form, Input, Modal, Select, Spin, Tag, Typography, Upload } from 'antd'
import { CameraOutlined, UploadOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { agentApi, projectApi } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAgent, useAgentRuntime, useAgents, useArchiveAgent, useCreateAgent, usePublishAgent, useUpdateAgent } from '@/hooks'
import type { AgentDetail, AgentRole, AgentSummary, CreateAgentPayload } from '@/types'
import { canPerformAgentAction } from '@/utils/agentActions'
import { AgentDetailPanel } from './AgentDetailPanel'
import styles from './AgentTeamPage.module.scss'

// 自定义 Agent 可选角色：编排助手（ORCHESTRATOR）与规划 Agent（PLANNER）由系统提供，不接受自定义创建
const roles: AgentRole[] = ['DEVELOPER', 'TESTER', 'REVIEWER', 'GENERAL']
const emptyAgents: AgentSummary[] = []
const { Title, Text } = Typography

function agentLoadErrorMessage(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined
  if (status === 403) return '暂无查看 Agent 的权限'
  if (status === 404) return '团队或项目不存在'
  if (typeof status === 'number' && status >= 500) return 'Agent 服务暂时不可用'
  return 'Agent 数据加载失败'
}

export default function AgentTeamPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AgentDetail | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [form] = Form.useForm<CreateAgentPayload>()
  const project = useQuery({ queryKey: ['qgents', 'projects', projectId], queryFn: () => projectApi.getById(projectId), enabled: Boolean(projectId) })
  const teamId = project.data?.teamId ?? ''
  const list = useAgents(projectId, teamId)
  const agents = list.data?.data ?? emptyAgents
  const agentId = new URLSearchParams(location.search).get('agentId')
  const selected = agents.find((agent) => agent.id === agentId) ?? null
  const detail = useAgent(projectId, teamId, selected?.id ?? null)
  const current = detail.data ?? selected
  const isCreator = Boolean(user?.id && current?.createdBy === user.id)
  const create = useCreateAgent(projectId, teamId)
  const update = useUpdateAgent(projectId, teamId)
  const publish = usePublishAgent(projectId, teamId)
  const archive = useArchiveAgent(projectId, teamId)

  useEffect(() => {
    if (!agentId && agents[0]) {
      navigate(`?agentId=${encodeURIComponent(agents[0].id)}`, { replace: true })
      return
    }
    if (agentId && !selected) {
      if (agents[0]) navigate(`?agentId=${encodeURIComponent(agents[0].id)}`, { replace: true })
      else navigate(location.pathname, { replace: true })
    }
  }, [agentId, agents, location.pathname, navigate, selected])

  const reload = () => {
    if (project.isError) {
      void project.refetch()
      return
    }
    void list.refetch()
  }

  if (project.isLoading || (!project.isError && !teamId) || list.isLoading) return <div className={styles.page}><div className={styles.empty}><Spin /></div></div>
  if (project.isError || list.isError) return <div className={styles.page}><div className={styles.error}><Alert type="error" showIcon message={agentLoadErrorMessage(project.error ?? list.error)} action={<Button onClick={reload}>重新加载</Button>} /></div></div>

  const invalid = Boolean(agentId && !selected)
  const save = async (values: CreateAgentPayload) => {
    const saved = editing ? await update.mutateAsync({ agentId: editing.id, payload: values }) : await create.mutateAsync(values)
    setOpen(false)
    message.success(editing ? 'Agent 已更新' : 'Agent 已创建')
    navigate(`?agentId=${encodeURIComponent(saved.id)}`)
  }
  /** Agent 头像：签发直传凭证 → 直传 OSS → 确认返回公共 URL，回填表单 */
  async function handleAvatarUpload(file: File): Promise<boolean> {
    if (!teamId || avatarUploading) return false
    setAvatarUploading(true)
    try {
      const credential = await agentApi.avatarCredential(teamId, { mediaType: file.type, sizeBytes: file.size })
      const putRes = await fetch(credential.uploadUrl, { method: 'PUT', body: await file.arrayBuffer() })
      if (!putRes.ok) throw new Error(`头像上传失败（${putRes.status}）`)
      const result = await agentApi.avatarConfirm(teamId, credential.objectKey)
      form.setFieldsValue({ avatar: result.avatarUrl })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '头像上传失败，请重试')
    } finally {
      setAvatarUploading(false)
    }
    return false
  }
  const beginEdit = () => {
    if (!current || !isCreator || !canPerformAgentAction(current, 'edit') || !detail.data) return
    setEditing(detail.data)
    form.setFieldsValue({ name: detail.data.name, avatar: detail.data.avatar ?? undefined, role: detail.data.role, description: detail.data.description ?? '', prompt: detail.data.prompt ?? '' })
    setOpen(true)
  }
  async function publishAgent(): Promise<void> {
    if (!current) return
    try {
      const result = await publish.mutateAsync({ agentId: current.id })
      message.success(result.visibility === 'TEAM' ? 'Agent 已发布为团队可用' : 'Agent 已提交发布审核')
    } catch {
      void detail.refetch()
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}><div className={styles.titleRow}><div><Title level={2} className={styles.title}>Agent 团队</Title><Text className={styles.subtitle}>管理团队可见的 Agent，并查看项目内的运行与分配情况。</Text></div></div><div className={styles.headerActions}><Button className={styles.addButton} type="primary" onClick={() => { setEditing(null); form.resetFields(); form.setFieldsValue({ role: 'GENERAL', description: '', prompt: '' }); setOpen(true) }}>添加 Agent</Button></div></header>
    <div className={styles.notice}>Agent 是个人级资源；仓库、基准分支和工作分支由 Task、TaskStep 与 ExecutionContext 决定，不固定绑定在 Agent 上。</div>
    {invalid ? <Alert type="warning" showIcon message="Agent 不存在或当前不可见" /> : null}
    <div className={styles.layout}>
      <main className={styles.listPane} aria-label="Agent 列表">
        {agents.length === 0 ? <div className={styles.empty}>暂无 Agent</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Agent</th><th>类型/角色</th><th>实时状态</th><th>并发上限</th><th>需求群分配</th></tr></thead><tbody>{agents.map((agent) => <AgentRuntimeRow key={agent.id} projectId={projectId} agent={agent} selected={agent.id === selected?.id} onSelect={() => navigate(`?agentId=${encodeURIComponent(agent.id)}`)} />)}</tbody></table></div>}
      </main>
      {current ? <AgentDetailPanel projectId={projectId} agent={current} detail={detail.data} onEdit={beginEdit} canEdit={isCreator && canPerformAgentAction(current, 'edit')} canPublish={isCreator && canPerformAgentAction(current, 'publish')} canArchive={isCreator && canPerformAgentAction(current, 'archive')} onPublish={() => void publishAgent()} onArchive={() => archive.mutate({ agentId: current.id }, { onError: () => void detail.refetch() })} /> : <aside className={styles.detailPane}><div className={styles.empty}>{agents.length ? '请选择一个 Agent' : '暂无 Agent'}</div></aside>}
    </div>
    <Modal open={open} title={editing ? '编辑 Agent' : '添加 Agent'} onCancel={() => setOpen(false)} onOk={() => form.submit()} cancelText="取消" okText={editing ? '保存' : '创建'} confirmLoading={create.isPending || update.isPending}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="例如：接口开发 Agent" maxLength={255} /></Form.Item>
        <Form.Item name="avatar" label="头像">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Form.Item name="avatar" noStyle>
              <Avatar size={56} src={form.getFieldValue('avatar')} icon={<CameraOutlined />} style={{ flexShrink: 0 }} />
            </Form.Item>
            <Upload accept="image/*" showUploadList={false} beforeUpload={handleAvatarUpload}>
              <Button icon={<UploadOutlined />} loading={avatarUploading}>上传图片</Button>
            </Upload>
          </div>
        </Form.Item>
        <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
          <Select options={roles.map((role) => ({ value: role, label: role }))} placeholder="选择该 Agent 承担的工作角色" />
        </Form.Item>
        <Form.Item name="description" label="用途描述" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} placeholder="说明该 Agent 适合处理什么任务（将作为编排选用的决策依据）" /></Form.Item>
        <Form.Item name="prompt" label="Prompt" rules={[{ required: true }]}><Input.TextArea /></Form.Item>
      </Form>
    </Modal>
  </div>
}

function AgentRuntimeRow({ projectId, agent, selected, onSelect }: { projectId: string; agent: AgentSummary; selected: boolean; onSelect: () => void }) {
  const runtime = useAgentRuntime(projectId, agent.id)
  const data = runtime.data
  return <tr className={selected ? styles.selected : ''} onClick={onSelect}>
    <td data-label="Agent"><div className={styles.agentCell}><Avatar className={styles.avatar} src={agent.avatar ?? undefined}>{agent.name.slice(0, 2)}</Avatar><div><div className={styles.agentName}>{agent.name}</div><div className={styles.description}>{agent.description ?? '暂无描述'}</div></div></div></td>
    <td data-label="类型/角色"><Tag className={styles.tag}>{agent.role}</Tag></td>
    <td data-label="实时状态"><Tag className={`${styles.tag} ${data?.status === 'RUNNING' ? styles.statusRunning : styles.statusIdle}`}>{data?.status ?? '—'}</Tag></td>
    <td data-label="并发上限"><span className={styles.stat}>{data ? `${data.activeRunCount}/${data.concurrencyLimit ?? '暂无'}` : '—'}</span></td>
    <td data-label="需求群分配"><span className={styles.stat}>{data ? `${data.assignmentUsage.requirementGroups.assignedCount}/${data.assignmentUsage.requirementGroups.assignableCount}` : '—'}</span></td>
  </tr>
}
