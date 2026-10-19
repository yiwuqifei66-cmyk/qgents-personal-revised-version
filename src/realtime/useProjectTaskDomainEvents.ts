import { useEffect, useState } from 'react'
import { projectEventsEnabled } from '@/api/projectEvents'
import { useTaskNoCodeChangeStore } from '@/store/taskNoCodeChangeStore'
import { invalidateProjectTaskEvent, invalidateProjectTaskModel } from './queryInvalidation'
import { ProjectEventConnection, type ProjectEventConnectionStatus } from './projectEventConnection'
import { useRealtimeConnectionStatus } from './realtimeClient'

type StatusListener = (status: ProjectEventConnectionStatus) => void

interface SharedProjectConnection {
  connection: ProjectEventConnection | null
  listeners: Set<StatusListener>
  refCount: number
  status: ProjectEventConnectionStatus
}

const connections = new Map<string, SharedProjectConnection>()

function createSharedConnection(projectId: string): SharedProjectConnection {
  const shared: SharedProjectConnection = {
    connection: null,
    listeners: new Set<StatusListener>(),
    refCount: 0,
    status: 'idle',
  }
  shared.connection = new ProjectEventConnection(projectId, {
    onEvent: (event) => {
      if (event.type === 'diff-review.skipped' && event.payload.reason === 'FINAL_DIFF_EMPTY') {
        const taskId = event.payload.taskId
        if (typeof taskId === 'string' && taskId.length > 0) {
          useTaskNoCodeChangeStore.getState().markCompletedWithoutCode(projectId, taskId)
        }
      }
      invalidateProjectTaskEvent(projectId, event)
    },
    onCursorExpired: () => invalidateProjectTaskModel(projectId),
    onStatusChange: (status) => {
      shared.status = status
      for (const listener of shared.listeners) listener(status)
    },
  })
  return shared
}

export function subscribeProjectTaskDomainEvents(
  projectId: string,
  listener: StatusListener,
): () => void {
  let shared = connections.get(projectId)
  if (!shared) {
    shared = createSharedConnection(projectId)
    connections.set(projectId, shared)
  }
  shared.refCount += 1
  shared.listeners.add(listener)
  listener(shared.status)
  shared.connection?.start()

  return () => {
    const current = connections.get(projectId)
    if (!current) return
    current.listeners.delete(listener)
    current.refCount -= 1
    if (current.refCount <= 0) {
      current.connection?.stop()
      connections.delete(projectId)
    }
  }
}

export function useProjectTaskDomainEvents(projectId: string, enabled = true): ProjectEventConnectionStatus {
  const [status, setStatus] = useState<ProjectEventConnectionStatus>('idle')

  useEffect(() => {
    if (!projectId || !enabled || !projectEventsEnabled()) {
      setStatus('idle')
      return undefined
    }
    return subscribeProjectTaskDomainEvents(projectId, setStatus)
  }, [enabled, projectId])

  return status
}

/**
 * SSE 已连接时由事件驱动 Query 失效；只有断连或不可用时才保留轮询兜底。
 * 每个调用点共享同一项目连接，不会额外建立 EventSource。
 */
export function useProjectTaskPollingInterval(projectId: string, fallbackIntervalMs: number): number | false {
  const realtimeStatus = useRealtimeConnectionStatus()
  const status = useProjectTaskDomainEvents(projectId, realtimeStatus !== 'connected')
  return realtimeStatus === 'connected' || status === 'connected' ? false : fallbackIntervalMs
}
