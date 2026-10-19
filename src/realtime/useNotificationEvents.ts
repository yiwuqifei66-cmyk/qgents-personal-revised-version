import { useEventStream } from './useEventStream'
import { queryClient } from '@/query'

/**
 * 通知级 SSE（GET /notifications/events）—— 当前登录用户维度。
 *
 * 收到 notification.created（新通知）或 notification.removed（通知被撤销，如任务
 * 从 FAILED 恢复后补偿删除 TASK_FAILED）后刷新通知中心列表（铃铛实时提醒）。
 */
export function useNotificationEvents(enabled = true): void {
  useEventStream(
    enabled ? 'notifications' : '',
    enabled ? '/notifications/events' : '',
    (eventType) => {
      if (eventType === 'notification.created' || eventType === 'notification.removed') {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }
    },
  )
}
