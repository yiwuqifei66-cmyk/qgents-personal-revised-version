import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  PlusOutlined,
  TagsOutlined,
  UserOutlined,
  MessageOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { ApiError, groupApi, memoryApi } from '@/api'
import { EmptyState } from '@/components/EmptyState'
import type { CreateMemoryPayload, Memory, MemoryStatus } from '@/types'
import './MemoryPage.css'

const { Text, Paragraph } = Typography

type FilterKey = 'ALL' | MemoryStatus

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'DRAFT', label: '草稿' },
  { key: 'PENDING_REVIEW', label: '待审核' },
  { key: 'APPROVED', label: '已发布' },
  { key: 'REJECTED', label: '已拒绝' },
  { key: 'ARCHIVED', label: '已归档' },
]

const STATUS_META: Record<MemoryStatus, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: '草稿' },
  PENDING_REVIEW: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已发布' },
  REJECTED: { color: 'red', label: '已拒绝' },
  ARCHIVED: { color: 'default', label: '已归档' },
}

/**
 * 共享 Memory —— 对齐接口文档 §9（A 负责）
 * 列表 / 状态筛选 / 详情 / 手动创建 / 从群消息生成草稿 / 归档
 * 审核功能（提交审核 / 批准·拒绝）统一在交付中心处理，本页不提供
 */
export function MemoryPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [filter, setFilter] = useState<FilterKey>('ALL')
  const [keyword, setKeyword] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const { data: memories = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['memories', projectId],
    queryFn: () => memoryApi.list(projectId),
    enabled: !!projectId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['memories', projectId] })

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return memories.filter((memory) => {
      const matchesFilter = filter === 'ALL' || memory.status === filter
      const searchable = [memory.title, memory.content, memory.category, ...(memory.tags ?? [])].join(' ').toLowerCase()
      return matchesFilter && (!normalized || searchable.includes(normalized))
    })
  }, [memories, filter, keyword])

  const detail = memories.find((m) => m.id === detailId) ?? null
  const editTarget = memories.find((m) => m.id === editId) ?? null

  const archive = useMutation({
    mutationFn: (id: string) => memoryApi.archive(projectId, id),
    onSuccess: invalidate,
    // 归档失败给出明确提示（如非 Admin 的 403 PROJECT_ADMIN_REQUIRED），避免无反馈；
    // 只展示后端 message，不带 [错误码] 前缀
    onError: (error) => {
      const backendMessage =
        error instanceof ApiError && error.body && typeof error.body === 'object' && 'error' in error.body
          ? (error.body as { error?: { message?: string } }).error?.message
          : undefined
      message.error(backendMessage || (error instanceof Error ? error.message : '归档失败，请重试'))
    },
  })

  if (isLoading) {
    return (
      <div className="memory-page">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      </div>
    )
  }

  return (
    <div className="memory-page">
      <header className="memory-page__header">
        <h1 className="memory-page__title">共享 Memory</h1>
        <p className="memory-page__desc">将需求讨论中确认的工程约定沉淀为项目知识</p>
      </header>

      <div className="memory-page__toolbar">
        <Select<FilterKey>
          className="memory-page__filter"
          options={FILTERS.map((f) => ({ label: f.label, value: f.key }))}
          value={filter}
          onChange={setFilter}
        />
        <Space>
          <Input.Search
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题、内容或标签"
            style={{ width: 240 }}
          />
          <Button icon={<MessageOutlined />} onClick={() => setAiOpen(true)}>
            AI 沉淀
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建 Memory
          </Button>
        </Space>
      </div>

      {isError ? (
        <EmptyState
          icon="⚠️"
          title="Memory 加载失败"
          description="请检查网络后重试"
          action={<Button onClick={() => void refetch()}>重新加载</Button>}
        />
      ) : <div className="memory-page__workspace">
        <section className="memory-page__list-panel" aria-label="Memory 列表">
          <div className="memory-page__list-heading">
            <span>知识条目</span>
            <span>{filtered.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon="🧠"
              title={keyword.trim() || filter !== 'ALL' ? '没有匹配的 Memory' : '暂无 Memory'}
              description={keyword.trim() || filter !== 'ALL' ? '可以更换关键词或状态筛选' : '从需求群沉淀讨论结论，或手动新建一条项目知识'}
            />
          ) : (
            <div className="memory-page__list">
              {filtered.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  selected={m.id === detailId}
                  onClick={() => setDetailId(m.id)}
                />
              ))}
            </div>
          )}
        </section>

        <MemoryDetail
          memory={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditId(detail?.id ?? null)
            setCreateOpen(true)
          }}
          onArchive={async () => {
            if (!detail) return
            try {
              await archive.mutateAsync(detail.id)
            } catch {
              // mutation.onError 已给出错误提示，此处吞掉避免 unhandled rejection
            }
          }}
        />
      </div>}

      {/* AI 沉淀：选择项目内需求群，自动检索其最近聊天生成草稿 */}
      <AiDraftModal
        projectId={projectId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onCreated={() => {
          invalidate()
          setAiOpen(false)
        }}
      />
      {/* 新建 / 编辑弹窗 */}
      <CreateMemoryModal
        projectId={projectId}
        open={createOpen}
        editTarget={editTarget}
        onClose={() => {
          setCreateOpen(false)
          setEditId(null)
        }}
        onCreated={() => {
          invalidate()
          setCreateOpen(false)
          setEditId(null)
        }}
      />
    </div>
  )
}

/** 列表卡片 */
function MemoryCard({ memory, selected, onClick }: { memory: Memory; selected: boolean; onClick: () => void }) {
  const meta = STATUS_META[memory.status] ?? { color: 'default', label: memory.status }
  return (
    <Card className={`memory-card${selected ? ' memory-card--selected' : ''}`} onClick={onClick}>
      <div className="memory-card__main">
        <div className="memory-card__left">
          <div className="memory-card__name-wrap">
            <Text className="memory-card__name">{memory.title}</Text>
            <Paragraph ellipsis={{ rows: 1 }} className="memory-card__content">
              {memory.content}
            </Paragraph>
          </div>
        </div>
        <div className="memory-card__right">
          <Tag color={meta.color} style={{ margin: 0 }}>
            {meta.label}
          </Tag>
          <Text className="memory-card__creator">
            {memory.creator?.displayName ?? '未知'}
          </Text>
        </div>
      </div>
      <div className="memory-card__tags">
        <Tag bordered={false} className="memory-card__category">
          {memory.category}
        </Tag>
        {(memory.tags ?? []).map((t) => (
          <Tag key={t} icon={<TagsOutlined />} bordered={false}>
            {t}
          </Tag>
        ))}
        {memory.source === 'MESSAGE' && (
          <span className="memory-card__source">
            <MessageOutlined /> 来自群消息
          </span>
        )}
      </div>
    </Card>
  )
}

/** 固定详情栏 */
function MemoryDetail({
  memory,
  onClose,
  onEdit,
  onArchive,
}: {
  memory: Memory | null
  onClose: () => void
  onEdit: () => void
  onArchive: () => Promise<void>
}) {
  if (!memory) {
    return (
      <aside className="memory-detail memory-detail--empty">
        <MessageOutlined className="memory-detail__empty-icon" />
        <Text strong>选择一条 Memory</Text>
        <Text type="secondary">在这里查看完整内容和来源信息</Text>
      </aside>
    )
  }
  const meta = STATUS_META[memory.status] ?? { color: 'default', label: memory.status }

  return (
    <aside className="memory-detail">
      <div className="memory-detail__header">
        <div>
          <Text className="memory-detail__title">{memory.title}</Text>
          <div className="memory-detail__meta">
            <Tag color={meta.color}>{meta.label}</Tag>
            <Text type="secondary">{memory.category}</Text>
          </div>
        </div>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="关闭详情" />
      </div>
      <div className="memory-detail__body">
        {(memory.tags ?? []).length > 0 && (
          <div className="memory-detail__tags">
            {(memory.tags ?? []).map((t) => (
              <Tag key={t} icon={<TagsOutlined />}>
                {t}
              </Tag>
            ))}
          </div>
        )}
        <Paragraph className="memory-detail__content">{memory.content}</Paragraph>
        <div className="memory-detail__provenance">
          <div>
            <UserOutlined /> 创建者：{memory.creator?.displayName ?? '未知'}
          </div>
          {memory.reviewer && (
            <div>
              <UserOutlined /> 审核者：{memory.reviewer.displayName}
              {memory.reviewedAt ? ` · ${formatDate(memory.reviewedAt)}` : ''}
            </div>
          )}
          {memory.source === 'MESSAGE' && (memory.sources ?? []).length > 0 && (
            <div>
              <MessageOutlined /> 来源：{(memory.sources ?? []).length} 条群消息
            </div>
          )}
        </div>
        <div className="memory-detail__actions">
          {(memory.status === 'DRAFT' || memory.status === 'REJECTED') && (
            <Button type="primary" onClick={onEdit}>编辑</Button>
          )}
          {memory.status === 'APPROVED' && (
            <Button onClick={onArchive}>归档</Button>
          )}
        </div>
      </div>
    </aside>
  )
}

/** 新建 / 编辑弹窗 */
function CreateMemoryModal({
  projectId,
  open,
  editTarget,
  onClose,
  onCreated,
}: {
  projectId: string
  open: boolean
  editTarget: Memory | null
  onClose: () => void
  onCreated: () => void
}) {
  const [form] = Form.useForm<CreateMemoryPayload>()
  const { message } = App.useApp()

  // 弹窗打开/编辑目标变化时显式回填表单（绕开 Modal destroyOnClose 下 initialValues 时序问题，
  // 确保编辑时标签等所有字段回显）
  useEffect(() => {
    if (!open) return
    if (editTarget) {
      form.setFieldsValue({
        title: editTarget.title,
        content: editTarget.content,
        category: editTarget.category,
        // 标签输入为逗号分隔字符串（提交时 splitTags 转回数组）
        tags: (editTarget.tags ?? []).join(','),
      } as unknown as Partial<CreateMemoryPayload>)
    } else {
      form.resetFields()
      form.setFieldsValue({ category: 'ENGINEERING_DECISION' })
    }
  }, [open, editTarget, form])

  const save = useMutation({
    mutationFn: (payload: CreateMemoryPayload) =>
      editTarget
        ? memoryApi.patch(projectId, editTarget.id, payload)
        : memoryApi.create(projectId, payload),
    onSuccess: (saved) => {
      form.resetFields()
      onCreated()
      // Project Admin 自建免审批：直接 APPROVED 上架；普通成员创建为草稿
      if (editTarget) {
        message.success('Memory 已更新')
      } else {
        message.success(saved.status === 'APPROVED' ? 'Memory 已创建并发布为项目共享知识' : 'Memory 草稿已创建，提交审核后即可共享')
      }
    },
  })

  return (
    <Modal
      title={editTarget ? '编辑 Memory' : '新建 Memory'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={editTarget ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={save.isPending}
      destroyOnClose
      // 编辑目标变化时强制重建 Modal 内容，确保 initialValues（含标签回显）重新生效
      key={editTarget?.id ?? 'create'}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => save.mutate({ ...v, tags: splitTags(v.tags) })}
        initialValues={
          editTarget
            ? {
                title: editTarget.title,
                content: editTarget.content,
                category: editTarget.category,
                tags: (editTarget.tags ?? []).join(','),
              }
            : { category: 'ENGINEERING_DECISION' }
        }
      >
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder="例如：密码存储约定" maxLength={50} />
        </Form.Item>
        <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
          <Input.TextArea
            placeholder="沉淀为可复用的项目知识或约定"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>
        <Form.Item name="category" label="分类">
          <Select
            options={[
              { value: 'ENGINEERING_DECISION', label: '工程决策' },
              { value: 'PROCESS', label: '流程约定' },
              { value: 'GENERAL', label: '通用' },
            ]}
          />
        </Form.Item>
        <Form.Item name="tags" label="标签（逗号分隔）">
          <Input placeholder="如 auth / security，用逗号分隔" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** 标签输入（逗号分隔字符串或数组）→ string[] */
function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === 'string')
  if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean)
  return []
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** AI 沉淀弹窗：选择项目内需求群，后端自动检索其最近聊天生成草稿（投给用户/Admin 审核确认） */
function AiDraftModal({
  projectId,
  open,
  onClose,
  onCreated,
}: {
  projectId: string
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { message } = App.useApp()
  const [groupId, setGroupId] = useState<string | undefined>(undefined)

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['groups', projectId],
    queryFn: () => groupApi.listByProject(projectId),
    enabled: open && !!projectId,
  })

  const generate = useMutation({
    mutationFn: () => {
      if (!groupId) throw new Error('请选择要沉淀的需求群')
      const selected = groups.find((g) => g.id === groupId)
      if (!selected?.latestMessage) throw new Error('该需求群暂无消息，无需沉淀')
      return memoryApi.generateDraft(projectId, { groupId })
    },
    onSuccess: () => {
      message.success('AI 已根据该群最近聊天生成 Memory 草稿')
      setGroupId(undefined)
      onCreated()
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Memory 生成失败，请重试')
    },
  })

  return (
    <Modal
      title="AI 沉淀 Memory"
      open={open}
      onCancel={() => {
        setGroupId(undefined)
        onClose()
      }}
      onOk={() => generate.mutate()}
      okText="生成草稿"
      cancelText="取消"
      confirmLoading={generate.isPending}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, color: 'var(--qg-text-secondary)', fontSize: 13 }}>
        AI 将自动检索所选需求群的最近聊天记录，甄别值得沉淀的内容并生成一份草稿。
        仅可选择有消息的需求群（空群不消耗 AI 生成）。
      </div>
      <Select<string>
        placeholder={groupsLoading ? '加载需求群…' : '选择需求群'}
        style={{ width: '100%' }}
        value={groupId}
        loading={groupsLoading}
        onChange={setGroupId}
        options={groups.map((g) => ({
          value: g.id,
          label: g.latestMessage ? (g.title || g.id) : `${g.title || g.id}（暂无消息）`,
          disabled: !g.latestMessage,
        }))}
      />
    </Modal>
  )
}
