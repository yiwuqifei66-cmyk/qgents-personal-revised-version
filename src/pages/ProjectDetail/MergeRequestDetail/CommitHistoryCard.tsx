import { useState } from 'react'
import { Alert, Avatar, Button, Empty, Modal, Spin, Typography } from 'antd'
import { useMergeRequestCommits } from '@/hooks/task-model'
import { formatApiError } from '@/utils/formatApiError'
import type { MergeRequestCommit } from '@/types/task-model'
import { shortCommitSha } from '../cqSeal'
import styles from './MergeRequestDetailPage.module.scss'

const { Text } = Typography

const PREVIEW_LIMIT = 3

const AVATAR_COLORS = ['#f58220', '#005bab', '#722ed1', '#0f766e', '#c2410c', '#2563eb']

export function CommitHistoryCard({
  projectId,
  mergeRequestId,
}: {
  projectId: string
  mergeRequestId: string
}) {
  const [allOpen, setAllOpen] = useState(false)
  const previewQuery = useMergeRequestCommits(projectId, mergeRequestId, PREVIEW_LIMIT)
  const allQuery = useMergeRequestCommits(projectId, mergeRequestId, 100, allOpen)
  const totalCount = previewQuery.data?.totalCount ?? 0
  const preview = previewQuery.data?.items ?? []

  return (
    <section className={styles.card} aria-label="提交记录">
      <h2 className={styles.cardTitle}>提交记录 ({previewQuery.isLoading ? '…' : totalCount})</h2>
      {previewQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={formatApiError(previewQuery.error)}
          action={
            <Button size="small" onClick={() => void previewQuery.refetch()}>
              重试
            </Button>
          }
        />
      ) : previewQuery.isLoading ? (
        <div className={styles.commitState}>
          <Spin />
        </div>
      ) : preview.length === 0 ? (
        <Empty description="暂无提交记录" />
      ) : (
        <>
          <CommitList items={preview} />
          <Button
            type="link"
            className={styles.commitMore}
            onClick={() => setAllOpen(true)}
            aria-label="view-all-commits"
          >
            查看全部提交 →
          </Button>
        </>
      )}
      <Modal
        title={`全部提交 (${allQuery.data?.totalCount ?? totalCount})`}
        open={allOpen}
        onCancel={() => setAllOpen(false)}
        footer={null}
        destroyOnHidden
        width={640}
      >
        {allQuery.isLoading ? (
          <div className={styles.commitState}>
            <Spin />
          </div>
        ) : allQuery.isError ? (
          <Alert type="error" showIcon message={formatApiError(allQuery.error)} />
        ) : (allQuery.data?.items.length ?? 0) === 0 ? (
          <Empty description="暂无提交记录" />
        ) : (
          <CommitList items={allQuery.data?.items ?? []} />
        )}
      </Modal>
    </section>
  )
}

function CommitList({ items }: { items: MergeRequestCommit[] }) {
  return (
    <ul className={styles.commitList}>
      {items.map((item) => (
        <li key={item.sha} className={styles.commitRow}>
          <Avatar size={28} style={{ backgroundColor: avatarColor(item.authorName), flex: '0 0 auto' }}>
            {avatarChar(item.authorName)}
          </Avatar>
          <Text code className={styles.commitSha}>
            {shortCommitSha(item.sha)}
          </Text>
          <span className={styles.commitMessage} title={item.message}>
            {item.message}
          </span>
          <span className={styles.commitAuthor}>{item.authorName}</span>
          <time className={styles.commitTime} dateTime={item.committedAt}>
            {formatRelativeTime(item.committedAt)}
          </time>
        </li>
      ))}
    </ul>
  )
}

function avatarChar(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.slice(0, 1) : '?'
}

function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash + char.charCodeAt(0) * 17) % AVATAR_COLORS.length
  return AVATAR_COLORS[hash] ?? AVATAR_COLORS[0]!
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return iso
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}
