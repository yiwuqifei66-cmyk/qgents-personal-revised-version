import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/query'
import { dispatchRealtimeFrame, realtimeWsUrl } from './realtimeClient'
import type { RealtimeFrame } from '@/types'

afterEach(() => vi.restoreAllMocks())

describe('realtimeWsUrl', () => {
  it('builds the ws endpoint with the access token in the query', () => {
    const url = realtimeWsUrl('token-123')
    expect(url.startsWith('ws://') || url.startsWith('wss://')).toBe(true)
    expect(url.endsWith('/ws/realtime?token=token-123')).toBe(true)
  })

  it('URL-encodes the token', () => {
    expect(realtimeWsUrl('a b&c')).toContain('?token=a%20b%26c')
  })
})

describe('dispatchRealtimeFrame', () => {
  it('refreshes the notification list for any notification-scope frame (type=kind, e.g. PROJECT_ADDED)', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    dispatchRealtimeFrame({
      type: 'PROJECT_ADDED',
      scope: 'notification',
      recipientUserId: 'user-1',
      payload: { notificationId: 'notification-1', kind: 'PROJECT_ADDED' },
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] })
  })

  it('invalidates group list, messages and main-group aggregation for project message.created', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const frame: RealtimeFrame = {
      type: 'message.created',
      scope: 'project',
      projectId: 'project-1',
      groupId: 'group-1',
      resourceId: 'message-1',
      payload: { projectId: 'project-1', groupId: 'group-1', messageId: 'message-1' },
    }
    dispatchRealtimeFrame(frame)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['groups', 'project-1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['groups', 'project-1', 'group-1', 'messages'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat', 'main-groups'] })
  })

  it('invalidates task queries for project task.updated', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    dispatchRealtimeFrame({
      type: 'task.updated',
      scope: 'project',
      projectId: 'project-1',
      payload: { projectId: 'project-1', taskId: 'task-1' },
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['qgents', 'projects', 'project-1', 'tasks'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['qgents', 'projects', 'project-1', 'tasks', 'task-1'] })
  })

  it('refreshes team lists for team-scope events', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    dispatchRealtimeFrame({
      type: 'project.member.added',
      scope: 'team',
      teamId: 'team-1',
      payload: { teamId: 'team-1' },
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['teams', 'mine'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['teams', 'team-1', 'projects'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['teams', 'team-1', 'members'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['teams', 'team-1', 'activities'] })
  })

  it('ignores a project frame without a project id', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    dispatchRealtimeFrame({ type: 'message.created', scope: 'project', payload: {} })
    expect(spy).not.toHaveBeenCalled()
  })
})
