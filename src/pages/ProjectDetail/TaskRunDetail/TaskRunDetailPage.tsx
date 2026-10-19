import { Navigate, useParams } from 'react-router-dom'
import { PATHS } from '@/routes/paths'

/**
 * 单次运行现在在任务工作台的检查抽屉中展示。
 * 保留原地址，保证既有链接、通知和 SSE 跳转仍然可用。
 */
export default function TaskRunDetailPage() {
  const { projectId = '', taskId = '', taskRunId = '' } = useParams<{ projectId: string; taskId: string; taskRunId: string }>()
  const target = `${PATHS.projectTaskDetail(projectId, taskId)}?runId=${encodeURIComponent(taskRunId)}`
  return <Navigate replace to={target} />
}

