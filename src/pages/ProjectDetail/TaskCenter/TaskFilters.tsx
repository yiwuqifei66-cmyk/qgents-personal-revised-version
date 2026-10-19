import { Button, Input, Select, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { TaskCenterStatusFilter } from './taskCenterConfig'
import { TASK_CENTER_STATUS_OPTIONS } from './taskCenterConfig'
import styles from './TaskCenterPage.module.scss'

const { Text } = Typography

interface TaskFiltersProps {
  status: TaskCenterStatusFilter
  groupId?: string
  repositoryId?: string
  createdBy?: string
  search: string
  groupOptions: Array<{ label: string; value: string }>
  repositoryOptions: Array<{ label: string; value: string }>
  createdByOptions: Array<{ label: string; value: string }>
  onStatusChange: (value: TaskCenterStatusFilter) => void
  onGroupChange: (value: string | undefined) => void
  onRepositoryChange: (value: string | undefined) => void
  onCreatedByChange: (value: string | undefined) => void
  onSearchDraftChange: (value: string) => void
  onSearchCommit: (value: string) => void
  onReset: () => void
}

export function TaskFilters({
  status,
  groupId,
  repositoryId,
  createdBy,
  search,
  groupOptions,
  repositoryOptions,
  createdByOptions,
  onStatusChange,
  onGroupChange,
  onRepositoryChange,
  onCreatedByChange,
  onSearchDraftChange,
  onSearchCommit,
  onReset,
}: TaskFiltersProps) {
  return (
    <div className={styles.filters}>
      <div className={styles.filterRow}>
        <div className={styles.filterCell}>
          <Text type="secondary" className={styles.filterLabel}>需求群</Text>
          <Select aria-label="需求群筛选" allowClear placeholder="全部" value={groupId} options={groupOptions} onChange={onGroupChange} className={styles.filterControl} />
        </div>
        <div className={styles.filterCell}>
          <Text type="secondary" className={styles.filterLabel}>创建人</Text>
          <Select aria-label="创建人筛选" allowClear placeholder="全部" value={createdBy} options={createdByOptions} onChange={onCreatedByChange} className={styles.filterControl} />
        </div>
        <div className={styles.filterCell}>
          <Text type="secondary" className={styles.filterLabel}>仓库</Text>
          <Select aria-label="仓库筛选" allowClear placeholder="全部" value={repositoryId} options={repositoryOptions} onChange={onRepositoryChange} className={styles.filterControl} />
        </div>
        <div className={styles.filterCell}>
          <Text type="secondary" className={styles.filterLabel}>状态</Text>
          <Select aria-label="状态筛选" value={status} options={TASK_CENTER_STATUS_OPTIONS} onChange={onStatusChange} className={styles.filterControl} />
        </div>
        <div className={styles.filterCell}>
          <Text type="secondary" className={styles.filterLabel}>搜索任务</Text>
          <SearchInput value={search} onDraftChange={onSearchDraftChange} onCommit={onSearchCommit} />
        </div>
        <Button
          aria-label="重置筛选"
          icon={<ReloadOutlined />}
          onClick={onReset}
          className={styles.resetButton}
        >
          重置
        </Button>
      </div>
    </div>
  )
}

export { type TaskCenterStatusFilter }

interface SearchInputProps {
  value: string
  onDraftChange: (next: string) => void
  onCommit: (next: string) => void
}

/**
 * 搜索框分两层：
 * - `onDraftChange`：每次按键同步草稿到父组件（仅本地缓存，不触发 URL / 查询）；
 * - `onCommit`：仅在用户主动提交（回车 / 失焦 / 点击清除）时回调，驱动 URL 与查询。
 * 这样可以避免每次按键都触发查询与列表抖动。
 */
function SearchInput({ value, onDraftChange, onCommit }: SearchInputProps) {
  function commit(next: string) {
    const trimmed = next.trim()
    if (trimmed === value) return
    onCommit(trimmed)
  }

  return (
    <Input
      aria-label="搜索任务"
      allowClear
      value={value}
      placeholder="编号、标题或需求说明（回车搜索）"
      onChange={(event) => onDraftChange(event.target.value)}
      onPressEnter={(event) => commit(event.currentTarget.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onClear={() => commit('')}
      className={styles.searchControl}
    />
  )
}
