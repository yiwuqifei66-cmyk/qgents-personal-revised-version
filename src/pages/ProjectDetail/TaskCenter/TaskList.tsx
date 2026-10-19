import { Empty, Space, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { TaskListItem } from '@/types/task-model'
import { TaskModelStatusTag } from './TaskModelStatusTag'
import type { TaskCenterView } from './taskCenterConfig'
import { TaskCard } from './TaskCard'
import { formatExactTime, formatRelativeTime, taskRepositoryLabel, valueOrNone } from './taskDisplay'
import styles from './TaskCenterPage.module.scss'

interface TaskListProps {
  tasks: TaskListItem[]
  view: TaskCenterView
  onViewDetails: (taskId: string) => void
}

export function TaskList({ tasks, view, onViewDetails }: TaskListProps) {
  if (tasks.length === 0) return <Empty description="暂无匹配任务" className={styles.empty} />

  if (view === 'table') {
    const columns: ColumnsType<TaskListItem> = [
      { title: '编号 / 任务', key: 'title', render: (_, task) => <Space direction="vertical" size={0}><Typography.Text type="secondary">{valueOrNone(task.displayCode)}</Typography.Text><Typography.Text>{valueOrNone(task.title)}</Typography.Text></Space>, ellipsis: true },
      { title: '状态', key: 'status', render: (_, task) => <TaskModelStatusTag status={task.status} /> },
      { title: '需求群', key: 'requirementGroup', render: (_, task) => valueOrNone(task.requirementGroup?.name) },
      { title: '仓库', key: 'repository', render: (_, task) => taskRepositoryLabel(task) },
      { title: '创建人', key: 'createdByUser', render: (_, task) => valueOrNone(task.createdByUser?.displayName) },
      { title: '更新', key: 'updatedAt', render: (_, task) => <Tooltip title={formatExactTime(task.updatedAt)}>{formatRelativeTime(task.updatedAt)}</Tooltip> },
      { title: '详情', key: 'details', render: (_, task) => <a onClick={(event) => { event.stopPropagation(); onViewDetails(task.id) }}>查看完整任务详情</a> },
    ]
    return <Table className={styles.table} rowKey="id" columns={columns} dataSource={tasks} pagination={false} scroll={{ x: 820 }} onRow={(task) => ({ onClick: () => onViewDetails(task.id) })} />
  }

  return <div className={styles.board}>{tasks.map((task) => <TaskCard key={task.id} task={task} onViewDetails={onViewDetails} />)}</div>
}
