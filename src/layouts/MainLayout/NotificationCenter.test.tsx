import { describe, expect, it } from 'vitest'
import { PATHS } from '@/routes/paths'
import type { Notification } from '@/types'
import { notificationTargetPath } from './NotificationCenter'

const taskFailed: Notification = {
  id: 'notification-1',
  kind: 'TASK_FAILED',
  title: 'Task failed',
  isRead: false,
  createdAt: '2026-08-17T00:00:00Z',
  projectId: 'project-1',
  resourceId: 'task-1',
}

describe('notificationTargetPath', () => {
  it('opens the related Task detail for a task failure', () => {
    expect(notificationTargetPath(taskFailed)).toBe(PATHS.projectTaskDetail('project-1', 'task-1'))
  })

  it('falls back to Task Center when a task notification has no resource id', () => {
    expect(notificationTargetPath({ ...taskFailed, resourceId: undefined })).toBe(PATHS.projectTasks('project-1'))
  })

  it('opens the Diff detail page for a pending deliverable (resourceId = diffId)', () => {
    const pending: Notification = {
      id: 'notification-2',
      kind: 'DELIVERABLE_PENDING',
      title: 'Diff 待验收',
      isRead: false,
      createdAt: '2026-08-17T00:00:00Z',
      projectId: 'project-1',
      resourceId: 'diff-1',
    }
    expect(notificationTargetPath(pending)).toBe(PATHS.projectDiff('project-1', 'diff-1'))
  })

  it('falls back to Delivery Center when a pending deliverable has no resource id', () => {
    const pending: Notification = {
      id: 'notification-3',
      kind: 'DELIVERABLE_PENDING',
      title: 'Diff 待验收',
      isRead: false,
      createdAt: '2026-08-17T00:00:00Z',
      projectId: 'project-1',
    }
    expect(notificationTargetPath(pending)).toBe(PATHS.projectDiffs('project-1'))
  })

  it('opens the MR detail page for a pending MR when the resource id is present', () => {
    const pendingMr: Notification = {
      id: 'notification-4',
      kind: 'MR_PENDING',
      title: 'MR 待处理',
      isRead: false,
      createdAt: '2026-08-17T00:00:00Z',
      projectId: 'project-1',
      resourceId: 'mr-1',
    }
    expect(notificationTargetPath(pendingMr)).toBe(PATHS.projectCodeMr('project-1', 'mr-1'))
  })
})
