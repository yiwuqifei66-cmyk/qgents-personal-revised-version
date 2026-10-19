import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, TagsOutlined, UserOutlined } from '@ant-design/icons'
import { skillApi } from '@/api'
import { EmptyState } from '@/components/EmptyState'
import type { CreateSkillPayload, Skill, SkillStatus } from '@/types'
import './SkillPage.css'

const { Text, Paragraph } = Typography

/** 状态筛选维度 */
type FilterKey = 'ALL' | SkillStatus

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'DRAFT', label: '草稿' },
  { key: 'PENDING_REVIEW', label: '待审核' },
  { key: 'PUBLISHED', label: '已发布' },
  { key: 'REJECTED', label: '已拒绝' },
  { key: 'ARCHIVED', label: '已归档' },
]

const STATUS_META: Record<SkillStatus, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: '草稿' },
  PENDING_REVIEW: { color: 'orange', label: '待审核' },
  PUBLISHED: { color: 'green', label: '已发布' },
  REJECTED: { color: 'red', label: '已拒绝' },
  ARCHIVED: { color: 'default', label: '已归档' },
}

const VISIBILITY_META: Record<Skill['visibility'], { color: string; label: string }> = {
  PRIVATE: { color: 'default', label: '私有' },
  PROJECT_SHARED: { color: 'blue', label: '项目共享' },
}

/**
 * 共享 Skill —— 对齐接口文档 v1.3.0 §8
 * 列表 / 状态筛选 / 详情 / 手动创建 / 归档
 * 普通成员的审核功能（提交审核 / 批准·拒绝）统一在交付中心处理，本页不提供；
 * Project Admin 创建 PROJECT_SHARED Skill 时由后端直接发布。
 */
export function SkillPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [filter, setFilter] = useState<FilterKey>('ALL')
  const [keyword, setKeyword] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: skills = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['skills', projectId],
    queryFn: () => skillApi.list(projectId),
    enabled: !!projectId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['skills', projectId] })

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return skills.filter((skill) => {
      const matchesFilter = filter === 'ALL' || skill.status === filter
      const searchable = [skill.name, skill.content, ...(skill.tags ?? [])].join(' ').toLowerCase()
      return matchesFilter && (!normalized || searchable.includes(normalized))
    })
  }, [skills, filter, keyword])

  const detail = skills.find((s) => s.id === detailId) ?? null
  // 编辑目标独立于详情抽屉：点「编辑」时保存 editId，避免关闭抽屉后 editTarget 丢失
  const editTarget = skills.find((s) => s.id === editId) ?? null

  const archive = useMutation({
    mutationFn: (id: string) => skillApi.archive(projectId, id),
    onSuccess: invalidate,
    onError: () => message.error('归档失败，请检查权限或稍后重试'),
  })

  if (isLoading) {
    return (
      <div className="skill-page">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      </div>
    )
  }

  return (
    <div className="skill-page">
      <header className="skill-page__header">
        <h1 className="skill-page__title">共享 Skill</h1>
        <p className="skill-page__desc">沉淀可复用能力片段（规范、提示词、操作指引）；共享审核在交付中心处理</p>
      </header>

      <div className="skill-page__toolbar">
        <Segmented
          options={FILTERS.map((f) => ({ label: f.label, value: f.key }))}
          value={filter}
          onChange={(v) => setFilter(v as FilterKey)}
        />
        <Space>
          <Input.Search
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索名称、内容或标签"
            style={{ width: 240 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建 Skill
          </Button>
        </Space>
      </div>

      {isError ? (
        <EmptyState
          icon="⚠️"
          title="Skill 加载失败"
          description="请检查网络后重试"
          action={<Button onClick={() => void refetch()}>重新加载</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🛠️"
          title={keyword.trim() || filter !== 'ALL' ? '没有匹配的 Skill' : '暂无共享 Skill'}
          description={keyword.trim() || filter !== 'ALL' ? '可以更换关键词或状态筛选' : '新建私有 Skill，或创建项目共享 Skill'}
        />
      ) : (
        <div className="skill-page__list">
          {filtered.map((s, i) => (
            <SkillCard key={s.id} skill={s} index={i + 1} onClick={() => setDetailId(s.id)} />
          ))}
        </div>
      )}

      {/* 详情抽屉 */}
      <SkillDetail
        skill={detail}
        onClose={() => setDetailId(null)}
        onEdit={() => {
          setEditId(detail?.id ?? null)
          setDetailId(null)
          setCreateOpen(true)
        }}
        onArchive={async () => {
          if (!detail) return
          await archive.mutateAsync(detail.id)
        }}
      />

      {/* 新建 / 编辑弹窗 */}
      <CreateSkillModal
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
function SkillCard({ skill, index, onClick }: { skill: Skill; index: number; onClick: () => void }) {
  const meta = STATUS_META[skill.status] ?? { color: 'default', label: skill.status }
  const vis = VISIBILITY_META[skill.visibility] ?? { color: 'default', label: skill.visibility }
  return (
    <Card className="skill-card" onClick={onClick}>
      <div className="skill-card__main">
        <div className="skill-card__left">
          <span className="skill-card__index">{String(index).padStart(2, '0')}</span>
          <div className="skill-card__name-wrap">
            <Text className="skill-card__name">{skill.name}</Text>
            <Paragraph ellipsis={{ rows: 1 }} className="skill-card__content">
              {skill.content}
            </Paragraph>
          </div>
        </div>
        <div className="skill-card__right">
          <Space size={4}>
            <Tag color={vis.color} style={{ margin: 0 }}>
              {vis.label}
            </Tag>
            <Tag color={meta.color} style={{ margin: 0 }}>
              {meta.label}
            </Tag>
          </Space>
          <Text className="skill-card__creator">
            {skill.creator?.displayName ?? '未知'}
          </Text>
        </div>
      </div>
      {(skill.tags ?? []).length > 0 && (
        <div className="skill-card__tags">
          {(skill.tags ?? []).map((t) => (
            <Tag key={t} icon={<TagsOutlined />} bordered={false}>
              {t}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  )
}

/** 详情抽屉 */
function SkillDetail({
  skill,
  onClose,
  onEdit,
  onArchive,
}: {
  skill: Skill | null
  onClose: () => void
  onEdit: () => void
  onArchive: () => Promise<void>
}) {
  if (!skill) return <Drawer open={false} onClose={onClose} />
  const meta = STATUS_META[skill.status] ?? { color: 'default', label: skill.status }
  const vis = VISIBILITY_META[skill.visibility] ?? { color: 'default', label: skill.visibility }

  return (
    <Drawer
      title={skill.name}
      placement="right"
      size={420}
      open
      onClose={onClose}
      extra={<Tag color={meta.color}>{meta.label}</Tag>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Tag color={vis.color}>{vis.label}</Tag>
          {(skill.tags ?? []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              {(skill.tags ?? []).map((t) => (
                <Tag key={t} icon={<TagsOutlined />} style={{ marginBottom: 4 }}>
                  {t}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <Paragraph style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {skill.content}
        </Paragraph>

        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
          <div>
            <UserOutlined /> 创建者：{skill.creator?.displayName ?? '未知'}
          </div>
          {skill.reviewer && (
            <div>
              <UserOutlined /> 审核者：{skill.reviewer.displayName}
              {skill.reviewedAt ? ` · ${formatDate(skill.reviewedAt)}` : ''}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16 }}>
          {(skill.status === 'DRAFT' || skill.status === 'REJECTED') && (
            <Button type="primary" onClick={onEdit}>编辑</Button>
          )}
          {skill.status === 'PUBLISHED' && (
            <Button onClick={onArchive}>归档</Button>
          )}
        </div>
      </Space>
    </Drawer>
  )
}

/** 新建 / 编辑弹窗 */
function CreateSkillModal({
  projectId,
  open,
  editTarget,
  onClose,
  onCreated,
}: {
  projectId: string
  open: boolean
  editTarget: Skill | null
  onClose: () => void
  onCreated: () => void
}) {
  const [form] = Form.useForm<CreateSkillPayload>()
  const { message } = App.useApp()

  // 弹窗打开/编辑目标变化时显式回填表单（绕开 Modal destroyOnClose 下 initialValues 时序问题，
  // 确保编辑时标签等所有字段回显）
  useEffect(() => {
    if (!open) return
    if (editTarget) {
      form.setFieldsValue({
        name: editTarget.name,
        content: editTarget.content,
        // 标签输入为逗号分隔字符串（提交时 splitTags 转回数组）
        tags: (editTarget.tags ?? []).join(','),
        visibility: editTarget.visibility,
      } as unknown as Partial<CreateSkillPayload>)
    } else {
      form.resetFields()
      form.setFieldsValue({ visibility: 'PRIVATE' })
    }
  }, [open, editTarget, form])

  const create = useMutation({
    // 编辑模式走 patch（更新原记录），新建才走 create（对照 MemoryPage 同一模式）
    mutationFn: (payload: CreateSkillPayload) =>
      editTarget
        ? skillApi.patch(projectId, editTarget.id, payload)
        : skillApi.create(projectId, payload),
    onSuccess: (saved) => {
      form.resetFields()
      onCreated()
      if (editTarget) {
        message.success('Skill 已更新')
        return
      }
      // PRIVATE 创建即生效；PROJECT_SHARED 的 Admin 自建免审、成员为草稿
      if (saved.status === 'PUBLISHED') {
        message.success(saved.visibility === 'PRIVATE' ? 'Skill 已创建（私有，仅自己可用）' : 'Skill 已创建并发布')
      } else {
        message.success('Skill 草稿已创建，提交审核后即可共享')
      }
    },
  })

  return (
    <Modal
      title={editTarget ? '编辑 Skill' : '新建 Skill'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={editTarget ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={create.isPending}
      destroyOnClose
      // 编辑目标变化时强制重建 Modal 内容，确保 initialValues（含标签回显）重新生效
      key={editTarget?.id ?? 'create'}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => create.mutate({ ...v, tags: splitTags(v.tags) })}
        initialValues={
          editTarget
            ? {
                name: editTarget.name,
                content: editTarget.content,
                tags: (editTarget.tags ?? []).join(','),
                visibility: editTarget.visibility,
              }
            : { visibility: 'PRIVATE' }
        }
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="例如：Java API 规范" maxLength={50} />
        </Form.Item>
        <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
          <Input.TextArea
            placeholder="规范、提示词、操作指引或工具调用约束"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>
        <Form.Item name="visibility" label="可见性">
          <Select
            options={[
              { value: 'PRIVATE', label: '私有（仅自己可用）' },
              { value: 'PROJECT_SHARED', label: '项目共享' },
            ]}
          />
        </Form.Item>
        <Form.Item name="tags" label="标签（逗号分隔）">
          <Input placeholder="如 java / backend，用逗号分隔" />
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
