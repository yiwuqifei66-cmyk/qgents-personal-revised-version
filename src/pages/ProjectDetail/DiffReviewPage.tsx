import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Typography,
  Tag,
  Button,
  Space,
  Avatar,
  Empty,
  App,
  Spin,
  Alert,
  Input,
} from 'antd'
import {
  LeftOutlined,
  RightOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { projectApi } from '@/api/project'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import { commentAuthorAvatar, commentAuthorName, HUNK_UNAVAILABLE_HINT } from './commentAuthor'
import {
  useDiff,
  useDiffComments,
  useDiffFiles,
  useTask,
  useAddDiffComment,
} from '@/hooks/task-model'
import { isEmptyBranchDiffId } from './emptyBranchDiff'
import { diffFileStatusLabel, diffStatusLabel } from '@/types/diff'
import type { DiffComment, DiffFile, DiffLine } from '@/types/task-model'
import './DiffReviewPage.css'

const { Text } = Typography
const FILE_PAGE_SIZE = 100

/**
 * PROJECT_MEMBER:能看代码页、Diff、评论；通过后可创建 MR
 * PROJECT_ADMIN / TEAM_OWNER: 通过、请求修改；通过后同一按钮变为创建 MR
 * Diff 与 CR 详情
 * 入口：代码与 Branch → 点击 Diff 列 +/-
 *
 * GET  /projects/{projectId}/diffs/{diffId}    //Diff 标题、状态、SHA(commit当中)、+/- 汇总
 * GET  /projects/{projectId}/diffs/{diffId}/files //左侧文件树、文件数、+8/-2
 * GET  /projects/{projectId}/diffs/{diffId}/comments  //底部两条评论、发表评论
 * POST /projects/{projectId}/diffs/{diffId}/comments
 * POST /projects/{projectId}/diffs/{diffId}/accept | reject    //通过 / 请求修改
 * POST /projects/{projectId}/merge-requests  // 创建 MR；成功后跳站内详情
 * GET  /projects/{projectId}/merge-requests  // 刷新后用 OPEN 列表恢复「已开过 MR」
 *
 * accept 同步：200 时 headCommit 已是真实 SHA，失败保持 PENDING_REVIEW。不轮询、不依赖 SSE。
 *
 * 通过 / 请求修改：Project Admin 或 Team Owner。
 * 创建 MR：项目成员可见；未通过 Diff 时禁用。远端核验与项目访问权由服务端在 POST 时校验。
 *
 * 数据一律走 diffsApi / mergeRequestsApi + TanStack Query；Mock / 真后端同一条调用链。
 */
export default function DiffReviewPage() {
  const { message } = App.useApp()
  void message // message 占位：暂未使用，保留以便后续提示
  const [draft, setDraft] = useState('')
  const { projectId = '', diffId = '' } = useParams<{
    projectId: string
    diffId: string
  }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fileHint = searchParams.get('file')?.trim() || undefined
  const [fileIndex, setFileIndex] = useState(0)

  const membersQuery = useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => projectApi.listMembers(projectId),
    enabled: Boolean(projectId),
  })

  const emptyBranchShell = isEmptyBranchDiffId(diffId)
  const liveDiffId = emptyBranchShell ? '' : diffId
  const detailQuery = useDiff(projectId, liveDiffId)
  const filesQuery = useDiffFiles(projectId, liveDiffId, { limit: FILE_PAGE_SIZE })
  const commentsQuery = useDiffComments(projectId, liveDiffId, { limit: FILE_PAGE_SIZE })
  const taskQuery = useTask(projectId, detailQuery.data?.taskId ?? '')
  const addComment = useAddDiffComment(projectId, liveDiffId)

  const review = detailQuery.data
  const files = filesQuery.data?.data ?? []
  const comments = commentsQuery.data?.data ?? []

  useEffect(() => {
    const list = filesQuery.data?.data ?? []
    if (!fileHint || list.length === 0) return
    const index = list.findIndex((item) => item.path === fileHint || item.path.endsWith(fileHint))
    if (index >= 0) setFileIndex(index)
  }, [fileHint, filesQuery.data])
  const safeIndex = Math.min(fileIndex, Math.max(files.length - 1, 0))
  const current = files[safeIndex]
  const fileComments = current
    ? comments.filter((item) => item.path === current.path)
    : []
  const tree = useMemo(() => groupFiles(filesQuery.data?.data ?? []), [filesQuery.data])
  const fileLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const file of filesQuery.data?.data ?? []) {
      if (file.path) map.set(file.path, file.path)
    }
    return map
  }, [filesQuery.data])
  const members = membersQuery.data ?? []

  function goFile(next: number) {
    if (next < 0 || next >= files.length) return
    setFileIndex(next)
  }

  function submitComment() {
    if (!review || !draft.trim()) return
    const firstChanged = current?.hunks
      .flatMap((hunk) => hunk.lines)
      .find((line) => line.kind === 'ADD' || line.kind === 'DEL')
    addComment.mutate(
      {
        path: current?.path,
        side: 'RIGHT',
        line: firstChanged?.newLine ?? firstChanged?.oldLine ?? 1,
        hunkId: current?.hunks[0]?.id,
        body: draft.trim(),
      },
      {
        onSuccess: () => {
          setDraft('')
          message.success('评论已提交')
        },
        onError: (error) => message.error(formatApiError(error)),
      },
    )
  }


  if (!diffId) {
    return (
      <div className="diff-review">
        <Empty description="缺少 diffId" />
      </div>
    )
  }

  // 代码与 Branch：+/- 为 0 且无真实快照时进入的空壳
  if (emptyBranchShell) {
    return (
      <div className="diff-review">
        <div style={{ padding: '8px 16px 0' }}>
          <Button type="text" icon={<LeftOutlined />} onClick={() => navigate(PATHS.projectCode(projectId))}>
            返回分支与diff详情
          </Button>
        </div>
        <header className="diff-review__top">
          <div className="diff-review__title-row">
            <h1>Diff</h1>
            <Tag>无变更</Tag>
          </div>
          <p className="diff-review__branch">该分支当前没有可查看的代码变更</p>
        </header>
        <div className="diff-review__toolbar">
          <Text>变更文件：0</Text>
          <Space>
            <Text type="success">+0</Text>
            <Text type="danger">-0</Text>
          </Space>
        </div>
        <Empty style={{ margin: 48 }} description="没有文件" />
      </div>
    )
  }

  if (detailQuery.isLoading || filesQuery.isLoading) {
    return (
      <div className="diff-review">
        <div className="diff-review__empty">
          <Spin />
        </div>
      </div>
    )
  }

  if (detailQuery.isError || !review) {
    return (
      <div className="diff-review">
        <div style={{ padding: '8px 16px 0' }}>
          <Button type="text" icon={<LeftOutlined />} onClick={() => navigate(PATHS.projectCode(projectId))}>
            返回分支与diff详情
          </Button>
        </div>
        <div className="diff-review__top" />
        <Alert
          type="error"
          showIcon
          style={{ margin: 24 }}
          message={detailQuery.error ? formatApiError(detailQuery.error) : '该分支没有可查看的 Diff'}
          action={
            <Button size="small" onClick={() => void detailQuery.refetch()}>
              重试
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="diff-review">
      <div style={{ padding: '8px 16px 0' }}>
        <Button type="text" icon={<LeftOutlined />} onClick={() => navigate(PATHS.projectCode(projectId))}>
          返回分支与diff详情
        </Button>
      </div>
      <header className="diff-review__top">
        <div className="diff-review__title-row">
          <h1>Diff-{taskQuery.data?.title?.trim() || review.taskId}</h1>
          <Tag color={review.status === 'PENDING_REVIEW' ? 'success' : 'default'}>
            {diffStatusLabel(review.status)}
          </Tag>
        </div>
        <p className="diff-review__branch">{review.sourceBranch}</p>
      </header>

      <div className="diff-review__toolbar">
        <Text>变更文件：{review.changeStats.files}</Text>
        <Space>
          <Button
            icon={<LeftOutlined />}
            disabled={safeIndex <= 0}
            onClick={() => goFile(safeIndex - 1)}
          />
          <Text>
            {files.length === 0 ? '0/0' : `${safeIndex + 1}/${files.length}`} 个文件
          </Text>
          <Button
            icon={<RightOutlined />}
            disabled={safeIndex >= files.length - 1}
            onClick={() => goFile(safeIndex + 1)}
          />
        </Space>
      </div>

      {filesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ margin: '12px 16px 0' }}
          message={formatApiError(filesQuery.error)}
        />
      ) : null}

      <div className="diff-review__body">
        <aside className="diff-review__panel" aria-label="文件树">
          <div className="diff-review__panel-head">文件树</div>
          <div className="diff-review__tree">
            {tree.map((group) => (
              <div key={group.dir || '(root)'}>
                {group.dir ? <div className="diff-review__dir">{group.dir}</div> : null}
                {group.files.map((file) => {
                  const index = files.indexOf(file)
                  const mark = diffFileStatusLabel(file.changeType || file.status)
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={`diff-review__file${index === safeIndex ? ' is-active' : ''}`}
                      onClick={() => goFile(index)}
                    >
                      <span className="diff-review__file-name">{fileName(file.path)}</span>
                      <span className={`diff-review__file-mark is-${mark.toLowerCase()}`}>{mark}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </aside>

        <section className="diff-review__panel diff-review__main">
          {current ? (
            <>
              <div className="diff-review__file-meta">
                {current.path}
                <Text type="secondary" style={{ marginLeft: 12 }}>
                  <Text type="success">+{current.additions}</Text>
                  {' / '}
                  <Text type="danger">-{current.deletions}</Text>
                </Text>
              </div>
              {current.binary ? (
                <div className="diff-review__binary">二进制文件，无法展示行级 Diff</div>
              ) : current.hunks.length === 0 ? (
                <Empty style={{ margin: 48 }} description={HUNK_UNAVAILABLE_HINT} />
              ) : (
                current.hunks.map((hunk) => (
                  <div key={hunk.id}>
                    <div className="diff-review__hunk-head">{hunk.header}</div>
                    {hunk.lines.map((line, lineIndex) => (
                      <DiffLineRow
                        key={`${hunk.id}-${lineIndex}`}
                        line={line}
                        commented={fileComments.some((item) => item.line === (line.newLine ?? line.oldLine))}
                      />
                    ))}
                  </div>
                ))
              )}
            </>
          ) : (
            <Empty style={{ margin: 48 }} description="没有文件" />
          )}
        </section>

        <aside className="diff-review__panel diff-review__aside-wrap" aria-label="历史评论">
          <ReviewAside
            comments={comments}
            members={members}
            fileLookup={fileLookup}
            draft={draft}
            submitting={addComment.isPending}
            onDraftChange={setDraft}
            onSubmit={submitComment}
          />
        </aside>
      </div>
    </div>
  )
}

function ReviewAside({
  comments,
  members,
  fileLookup,
  draft,
  submitting,
  onDraftChange,
  onSubmit,
}: {
  comments: DiffComment[]
  members: Array<{ userId: string; displayName?: string; avatarUrl?: string | null }>
  fileLookup: Map<string, string>
  draft: string
  submitting: boolean
  onDraftChange: (value: string) => void
  onSubmit: () => void
}) {
  // 按创建时间升序：旧 → 新
  const sorted = [...comments].sort((a, b) => {
    const at = a.createdAt ?? ''
    const bt = b.createdAt ?? ''
    return at.localeCompare(bt)
  })

  return (
    <div className="diff-review__aside">
      <h3 className="diff-review__aside-title">历史评论</h3>
      <div className="diff-review__aside-history">
        {sorted.length === 0 ? (
          <Text type="secondary">还没有评论记录</Text>
        ) : (
          sorted.map((item) => (
            <CommentCard
              key={item.id}
              comment={item}
              members={members}
              fileLabel={item.path ? fileLookup.get(item.path) ?? item.path : undefined}
            />
          ))
        )}
      </div>

      <div className="diff-review__composer">
        <Input.TextArea
          id="diff-comment-input"
          value={draft}
          placeholder="在当前 Diff 发表意见"
          autoSize={{ minRows: 3, maxRows: 6 }}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={submitting}
          disabled={!draft.trim()}
          onClick={onSubmit}
        >
          发表评论
        </Button>
      </div>
    </div>
  )
}

function CommentCard({
  comment,
  members,
  fileLabel,
}: {
  comment: DiffComment
  members: Array<{ userId: string; displayName?: string; avatarUrl?: string | null }>
  fileLabel?: string
}) {
  const name = commentAuthorName(comment, members)
  const avatar = commentAuthorAvatar(comment, members)
  return (
    <article className="diff-review__comment">
      <Avatar size={28} src={avatar}>{name.slice(0, 1)}</Avatar>
      <div className="diff-review__comment-body">
        <strong>{name}</strong>
        {fileLabel ? (
          <div className="diff-review__comment-meta">
            <Text type="secondary">{fileLabel}</Text>
            {comment.line != null ? <Text type="secondary"> · L{comment.line}</Text> : null}
          </div>
        ) : null}
        <p>{comment.body}</p>
        <time>
          {comment.createdAt ? comment.createdAt.replace('T', ' ').slice(0, 16) : ''}
        </time>
      </div>
    </article>
  )
}

function DiffLineRow({ line, commented }: { line: DiffLine; commented: boolean }) {
  const sign = line.kind === 'ADD' ? '+' : line.kind === 'DEL' ? '-' : ''
  return (
    <div
      className={`diff-review__line${line.kind === 'ADD' ? ' is-add' : ''}${line.kind === 'DEL' ? ' is-del' : ''}${commented ? ' has-comment' : ''}`}
    >
      <span className="diff-review__gutter">{line.oldLine ?? ''}</span>
      <span className="diff-review__gutter">{line.newLine ?? ''}</span>
      <span className="diff-review__sign">{sign}</span>
      <span className="diff-review__code">{line.text}</span>
    </div>
  )
}

function fileName(path: string): string {
  return path.split('/').pop() || path
}

function groupFiles(files: DiffFile[]): Array<{ dir: string; files: DiffFile[] }> {
  const map = new Map<string, DiffFile[]>()
  for (const file of files) {
    const parts = file.path.split('/')
    const dir = parts.slice(0, -1).join('/')
    const list = map.get(dir) ?? []
    list.push(file)
    map.set(dir, list)
  }
  return [...map.entries()].map(([dir, grouped]) => ({ dir, files: grouped }))
}
