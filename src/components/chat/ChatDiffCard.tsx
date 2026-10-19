import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { App, Button, Empty, Input, Popconfirm, Spin, Typography } from 'antd'
import { BranchesOutlined, DownOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, diffsApi, tasksApi } from '@/api'
import { formatApiError } from '@/utils/formatApiError'
import { taskModelQueryKeys } from '@/query/taskModelKeys'
import { deliveryCenterKeys } from '@/query/deliveryCenterKeys'
import { diffFileStatusLabel } from '@/types/diff'
import { PATHS } from '@/routes/paths'
import { highlightDiffCode, syntaxLanguageLabel } from '@/utils/diffSyntaxHighlight'
import type { DiffPreviewFile, DiffPreviewLine } from '@/types/task-model'
import type { DiffMessageContent, Message } from '@/types'

const { Text } = Typography

/** 群聊内联 Diff 展开区的固定高度（左右栏内部各自滚动） */
const PANEL_HEIGHT = 440
/** 左栏文件树宽度 */
const FILE_TREE_WIDTH = 208
/** §16.2 卡片展开/切文件时才请求预览；以下错误码关闭预览或跳转详情 */
const CODE_FINAL_ONLY = 'DIFF_PREVIEW_FINAL_ONLY'
const CODE_CONTEXT_INVALID = 'DIFF_PREVIEW_CONTEXT_INVALID'
const CODE_FILE_LIMIT = 'DIFF_PREVIEW_FILE_LIMIT'

interface Props {
  message: Message
  projectId: string
  onReply?: (m: Message) => void
}

/**
 * 群聊内 Diff 卡片 —— §16 契约：固定高度可展开的「文件树 + 代码提交 diff 视图」框。
 * - 只展开 Task 级最终 Diff（后端 preview 接口校验，中间/普通 Diff 返回 422 时前端关闭预览）
 * - 卡片折叠时不请求预览；展开 / 切换文件时才调用 GET /diffs/{diffId}/preview
 * - 切换文件以 files[].fileId 重请求，用响应 selectedFileId 替换当前预览
 * - viewDetailsRequired = truncated || filesTruncated || contentTruncated → 显示「查看详情」跳 detailPath
 * - 「查看 Diff」跳转 /app/projects/:projectId/code/diff/:diffId（代码提交 diff 视图）
 */
export function ChatDiffCard({ message, projectId, onReply }: Props) {
  const { message: messageApi } = App.useApp()
  const queryClient = useQueryClient()
  const c = message.content as DiffMessageContent
  const diffId = c.diffId ?? ''
  const taskId = c.taskId?.trim() ?? ''
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  // 群聊卡片的确认操作必须走任务级最终 DiffReviewBatch，不能验收单个已归档的 Diff。
  // 仅在展开时读取任务状态与 capabilities，避免历史消息列表为每张卡片额外发请求。
  const taskQuery = useQuery({
    queryKey: taskModelQueryKeys.tasks.detail(projectId, taskId),
    queryFn: () => tasksApi.get(projectId, taskId),
    enabled: open && Boolean(projectId && taskId),
  })
  const canConfirmDelivery = taskQuery.data?.diffReviewSummary.reviewStatus === 'PENDING_CONFIRMATION'
    && taskQuery.data.capabilities.canConfirmDiffReview === true
  const deliveryActionLabel = taskQuery.isLoading
    ? '读取交付状态'
    : canConfirmDelivery
      ? '确认交付'
      : taskQuery.data?.diffReviewSummary.deliveryStatus === 'DELIVERING'
        ? '交付中'
        : taskQuery.data?.diffReviewSummary.deliveryStatus === 'DELIVERED'
          ? '已交付'
          : '确认交付'

  const confirmDeliveryMutation = useMutation({
    mutationFn: () => tasksApi.confirmDiffReview(projectId, taskId),
    onSuccess: () => {
      messageApi.success('已确认交付，正在执行仓库交付')
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.tasks.detail(projectId, taskId) })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.taskDiffReview.detail(projectId, taskId) })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.tasks.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.diffs.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: deliveryCenterKeys.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: ['groups', projectId] })
    },
    onError: (error) => {
      void taskQuery.refetch()
      messageApi.error(formatApiError(error))
    },
  })

  // §16.2 卡片折叠时不请求预览；展开 / 切换文件时才调用本接口
  const previewQuery = useQuery({
    queryKey: taskModelQueryKeys.diffs.preview(projectId, diffId, selectedFileId ?? undefined),
    queryFn: () => diffsApi.preview(projectId, diffId, selectedFileId ?? undefined),
    enabled: open && !!diffId,
  })
  const preview = previewQuery.data

  // §16.3.3 以响应 selectedFileId 对齐本地选中（后端可能纠正/选定默认文件），避免预览与文件树不一致
  useEffect(() => {
    if (!preview || !preview.selectedFileId) return
    if (preview.selectedFileId !== selectedFileId) setSelectedFileId(preview.selectedFileId)
  }, [preview, selectedFileId])

  // §16.3.5 错误码：422 FINAL_ONLY / CONTEXT_INVALID → 不可展开；422 FILE_LIMIT → 直接跳详情
  const previewErrorCode =
    previewQuery.error instanceof ApiError &&
    previewQuery.error.body &&
    typeof previewQuery.error.body === 'object' &&
    'error' in previewQuery.error.body
      ? (previewQuery.error.body as { error?: { code?: unknown } }).error?.code
      : undefined
  const notExpandable = previewErrorCode === CODE_FINAL_ONLY || previewErrorCode === CODE_CONTEXT_INVALID
  useEffect(() => {
    if (previewErrorCode === CODE_FILE_LIMIT) {
      navigate(PATHS.projectCodeDiff(projectId, diffId))
    }
  }, [previewErrorCode, projectId, diffId, navigate])

  // 文件树：按文件名/路径过滤；文件标签用 fileName + extension，path 区分同名
  const visibleFiles = useMemo<DiffPreviewFile[]>(() => {
    if (!preview) return []
    const q = keyword.trim().toLowerCase()
    if (!q) return preview.files
    return preview.files.filter(
      (f) => f.path.toLowerCase().includes(q) || f.fileName.toLowerCase().includes(q),
    )
  }, [preview, keyword])

  const selectedFile =
    preview?.files.find((f) => f.fileId === preview.selectedFileId) ?? visibleFiles[0]
  const tree = useMemo(() => groupFiles(visibleFiles), [visibleFiles])
  const detailPath = preview?.detailPath || PATHS.projectCodeDiff(projectId, diffId)

  const displayTitle = c.displayCode
    ? `${c.displayCode}${c.repositoryName ? ` · ${c.repositoryName}` : ''}${c.sourceBranch ? ` / ${c.sourceBranch}` : ''}`
    : (c.title ?? '代码交付')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        borderRadius: 8,
        background: 'rgba(59, 130, 246, 0.06)',
        minWidth: 220,
        maxWidth: '100%',
      }}
    >
      {/* 头部：Diff 码 · 仓库 / 源分支 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BranchesOutlined style={{ fontSize: 16, color: '#3b82f6' }} />
        <Text strong style={{ fontSize: 14 }}>{displayTitle}</Text>
      </div>
      {/* 目标分支与变更统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {c.repositoryName && c.targetBranch ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            -{c.repositoryName}/{c.targetBranch}
          </Text>
        ) : null}
        {c.additions != null ? (
          <Text style={{ fontSize: 12, color: '#16a34a' }}>+{c.additions}</Text>
        ) : null}
        {c.deletions != null ? (
          <Text style={{ fontSize: 12, color: '#dc2626' }}>-{c.deletions}</Text>
        ) : null}
        {preview && preview.totalFileCount > 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{preview.totalFileCount} 个文件</Text>
        ) : null}
      </div>
      {c.reviewStatus === 'REJECTED' && c.reviewReason?.trim() ? (
        <div
          style={{
            color: '#b42318',
            background: '#fff1f0',
            border: '1px solid #ffccc7',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 12,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          <strong>拒绝意见：</strong>{c.reviewReason.trim()}
        </div>
      ) : null}
      {/* 变更文件列表（收起时展示消息 content 里的路径摘要） */}
      {!open && c.files && c.files.length > 0 ? (
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
          {c.files.slice(0, 5).map((file) => (
            <div key={file} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file}
            </div>
          ))}
          {c.files.length > 5 ? (
            <Text type="secondary">…共 {c.files.length} 个文件</Text>
          ) : null}
        </div>
      ) : null}
      {/* 操作：展开 / 查看 Diff / 根据审查意见继续修改 */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
        <Button
          size="small"
          type="link"
          icon={open ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起 Diff' : '展开 Diff'}
        </Button>
        <Link to={PATHS.projectCodeDiff(projectId, diffId)}>
          <Button size="small" type="link" icon={<BranchesOutlined />}>
            查看 Diff
          </Button>
        </Link>
        {onReply ? (
          <Button size="small" type="link" onClick={() => onReply(message)}>
            {c.reviewStatus === 'REJECTED' ? '根据拒绝意见继续修改' : '引用继续修改'}
          </Button>
        ) : null}
      </div>

      {/* 展开区：固定高度「文件树 + diff 视图」左右分栏。
          宽度固定 820px（窄屏受气泡 maxWidth 78% 限制收缩，不会溢出）；
          代码超长行在右侧内容区整体横向滚动。 */}
      {open ? (
        <div
          style={{
            display: 'flex',
            width: 820,
            maxWidth: '100%',
            height: PANEL_HEIGHT,
            marginTop: 8,
            border: '1px solid #d9e2ef',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          {/* 左栏：文件树 */}
          <div
            style={{
              width: FILE_TREE_WIDTH,
              flexShrink: 0,
              borderRight: '1px solid #eef2f6',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                fontSize: 12,
                fontWeight: 700,
                color: '#5b6b82',
                borderBottom: '1px solid #eef2f6',
              }}
            >
              📂 文件树
            </div>
            <div style={{ padding: 8 }}>
              <Input
                size="small"
                prefix={<SearchOutlined />}
                placeholder="Filter files…"
                allowClear
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {previewQuery.isLoading ? (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <Spin size="small" />
                </div>
              ) : notExpandable ? (
                <div style={{ padding: 16, fontSize: 12, color: '#5b6b82' }}>
                  该 Diff 不可在群聊中展开（仅 Task 级最终 Diff 可预览）
                </div>
              ) : tree.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有文件" />
              ) : (
                <>
                  {tree.map((group) => (
                    <div key={group.dir || '(root)'}>
                      {group.dir ? (
                        <div style={{ padding: '6px 12px 2px', fontSize: 12, color: '#5b6b82' }}>
                          {group.dir}
                        </div>
                      ) : null}
                      {group.files.map((file) => {
                        const active = selectedFile?.fileId === file.fileId
                        const mark = diffFileStatusLabel(file.changeType || 'MODIFIED')
                        return (
                          <button
                            key={file.fileId}
                            type="button"
                            onClick={() => setSelectedFileId(file.fileId)}
                            title={file.path}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              border: 0,
                              background: active ? '#eef8f6' : 'transparent',
                              padding: '6px 12px 6px 20px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              color: 'inherit',
                            }}
                          >
                            {/* 有 diff 的文件的绿色符号标记 */}
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: '#16a34a',
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontSize: 13,
                              }}
                            >
                              {file.fileName}
                            </span>
                            <span
                              style={{
                                marginLeft: 'auto',
                                fontSize: 11,
                                fontWeight: 800,
                                color: mark === 'A' ? '#16a34a' : mark === 'M' ? '#2563eb' : '#dc2626',
                              }}
                            >
                              {mark}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                  {preview?.filesTruncated ? (
                    <div style={{ padding: '8px 12px', fontSize: 12, color: '#5b6b82' }}>
                      仅显示前 {preview.files.length} 个文件 ·{' '}
                      <Link to={detailPath}>查看详情</Link>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* 右栏：行级 diff 预览（整体横向滚动，行号列固定） */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto', background: '#fff' }}>
            {notExpandable ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: '#5b6b82' }}>
                <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  该 Diff 不可在群聊中展开（仅 Task 级最终 Diff 可预览）
                </Text>
                <Link to={detailPath}>
                  <Button size="small" type="primary">查看详情</Button>
                </Link>
              </div>
            ) : previewQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin />
              </div>
            ) : previewQuery.isError ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: '#5b6b82' }}>
                <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  预览加载失败
                </Text>
                <Button size="small" onClick={() => void previewQuery.refetch()}>重试</Button>
              </div>
            ) : !preview || !selectedFile ? (
              <Empty style={{ margin: 40 }} description="没有文件" />
            ) : (
              <>
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #eef2f6',
                    fontFamily: 'ui-monospace, Consolas, monospace',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    // 固定顶部：文件路径与「确认交付/查看详情」按钮不随 diff 内容滚动
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    background: '#fff',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedFile.path}
                  </span>
                  <Text type="secondary" style={{ fontSize: 11 }}>{syntaxLanguageLabel(selectedFile.path)}</Text>
                  <Text type="success" style={{ fontSize: 12 }}>+{selectedFile.additions}</Text>
                  <Text type="danger" style={{ fontSize: 12 }}>-{selectedFile.deletions}</Text>
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {preview.viewDetailsRequired ? (
                      <Link to={detailPath}>
                        <Button size="small" type="link">查看详情</Button>
                      </Link>
                    ) : null}
                    {canConfirmDelivery ? (
                      <Popconfirm
                        title="确认交付"
                        description="确认该任务的最终 Diff 已审查通过并开始交付？"
                        okText="确认交付"
                        cancelText="取消"
                        onConfirm={() => confirmDeliveryMutation.mutate()}
                      >
                        <Button size="small" type="primary" loading={confirmDeliveryMutation.isPending}>
                          确认交付
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Button
                        size="small"
                        type="primary"
                        loading={taskQuery.isLoading}
                        disabled
                        title={taskQuery.data?.capabilities.canConfirmDiffReviewDisabledReason ?? '当前交付状态不能再次确认'}
                      >
                        {deliveryActionLabel}
                      </Button>
                    )}
                  </span>
                </div>
                {selectedFile.binary ? (
                  <div style={{ padding: 36, textAlign: 'center', color: '#5b6b82' }}>
                    二进制文件，无法展示正文
                  </div>
                ) : preview.lines.length === 0 ? (
                  <Empty style={{ margin: 40 }} description="无行级 Diff" />
                ) : (
                  <div style={{ width: 'max-content', minWidth: '100%' }}>
                    {preview.lines.map((line, index) => (
                      <PreviewLineRow key={index} line={line} path={selectedFile.path} />
                    ))}
                    {preview.truncated ? (
                      <div style={{ padding: '10px 12px', fontSize: 12, color: '#5b6b82' }}>
                        已显示前 {preview.previewLineLimit} 行（共至少 {preview.totalLineCount} 行）·{' '}
                        <Link to={detailPath}>查看详情</Link>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 预览行：行号 + 符号 + 内容（ADD 绿底 / DELETE 红底 / CONTEXT 无背景） */
function PreviewLineRow({ line, path }: { line: DiffPreviewLine; path: string }) {
  const sign = line.type === 'ADD' ? '+' : line.type === 'DELETE' ? '-' : ''
  return (
    <div
      style={{
        display: 'flex',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.55,
        background: line.type === 'ADD' ? '#e7f8ee' : line.type === 'DELETE' ? '#fdecec' : undefined,
      }}
    >
      <span style={{ width: 44, flexShrink: 0, color: '#94a3b8', textAlign: 'right', padding: '0 6px', userSelect: 'none' }}>
        {line.oldLineNo ?? ''}
      </span>
      <span style={{ width: 44, flexShrink: 0, color: '#94a3b8', textAlign: 'right', padding: '0 6px', userSelect: 'none' }}>
        {line.newLineNo ?? ''}
      </span>
      <span style={{ width: 22, flexShrink: 0, textAlign: 'center', fontWeight: 700 }}>{sign}</span>
      <span style={{ padding: '0 10px', whiteSpace: 'pre' }}>{highlightDiffCode(line.content, path)}</span>
    </div>
  )
}

function groupFiles(files: DiffPreviewFile[]): Array<{ dir: string; files: DiffPreviewFile[] }> {
  const map = new Map<string, DiffPreviewFile[]>()
  for (const file of files) {
    const parts = file.path.split('/')
    const dir = parts.slice(0, -1).join('/')
    const list = map.get(dir) ?? []
    list.push(file)
    map.set(dir, list)
  }
  return [...map.entries()].map(([dir, grouped]) => ({ dir, files: grouped }))
}
