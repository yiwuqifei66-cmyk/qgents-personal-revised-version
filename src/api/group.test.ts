import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupApi } from './group'

afterEach(() => vi.restoreAllMocks())

describe('groupApi.sendMessage', () => {
  it('preserves the atomic message and quick Task result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        message: { id: 'message-1', groupId: 'group-1', type: 'TEXT', content: { text: 'Implement login' }, senderType: 'USER', createdAt: '2026-08-16T00:00:00Z' },
        task: { id: 'task-1', displayCode: 'T-1024', status: 'PLANNING', missingFields: ['repositoryIds', 'baseRef'] },
      },
      requestId: 'request-1',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    await expect(groupApi.sendMessage('project-1', 'group-1', {
      type: 'TEXT',
      content: { text: 'Implement login' },
      mentions: [{ type: 'AGENT', id: 'agent-1' }],
      clientMessageId: 'cmsg-1',
    })).resolves.toMatchObject({
      message: { id: 'message-1' },
      task: { id: 'task-1', missingFields: ['repositoryIds', 'baseRef'] },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/groups/group-1/messages', expect.objectContaining({ method: 'POST' }))
  })

  it('normalizes the asynchronous auto-trigger message response without inventing a Task', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'message-1', groupId: 'group-1', type: 'TEXT', content: { text: 'Hello' }, senderType: 'USER', createdAt: '2026-08-16T00:00:00Z' },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    await expect(groupApi.sendMessage('project-1', 'group-1', {
      type: 'TEXT', content: { text: 'Hello' }, mentions: [{ type: 'AGENT', id: 'agent-1' }], clientMessageId: 'cmsg-2',
    })).resolves.toMatchObject({ message: { id: 'message-1' }, task: null })
  })

  it('calls the explicit trigger endpoint with the required title derived from the message', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'task-1' },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    await expect(groupApi.triggerTask('project-1', 'group-1', 'message-1', {
      title: 'Implement login',
      requirement: 'Implement login',
      repositoryIds: ['project-repository-1'],
      baseRef: 'main',
    })).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/groups/group-1/messages/message-1/trigger-task',
      expect.objectContaining({ method: 'POST', body: '{"title":"Implement login","requirement":"Implement login","repositoryIds":["project-repository-1"],"baseRef":"main"}' }),
    )
  })
})

describe('groupApi.markRead', () => {
  it('marks the group read through the backend endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { groupId: 'group-1', lastReadSequenceNo: 42, unreadCount: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(groupApi.markRead('project-1', 'group-1')).resolves.toMatchObject({
      groupId: 'group-1',
      lastReadSequenceNo: 42,
      unreadCount: 0,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/groups/group-1/read',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('groupApi.listMainGroups', () => {
  it('lists all visible project main groups through the aggregation endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'group-main-1', projectId: 'project-1', type: 'PROJECT_MAIN', title: '项目主群', status: 'ACTIVE', unreadCount: 2 },
        { id: 'group-main-2', projectId: 'project-2', type: 'PROJECT_MAIN', title: '项目主群', status: 'ACTIVE', unreadCount: 0 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const groups = await groupApi.listMainGroups()
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ projectId: 'project-1', unreadCount: 2 })
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/main-groups', expect.any(Object))
  })
})

describe('groupApi.listMessagesIncremental（可靠消息同步 §1）', () => {
  it('requests messages after the given sequence in ascending order', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'message-42', sequence: 42, type: 'TEXT', content: { text: '新消息' }, senderType: 'USER', createdAt: '2026-08-23T08:00:00Z' },
      ],
      page: { nextCursor: '42', hasMore: false },
      requestId: 'request-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await groupApi.listMessagesIncremental('project-1', 'group-1', 40)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/groups/group-1/messages/incremental?afterSequence=40&limit=100',
      expect.any(Object),
    )
    expect(result.data[0]).toMatchObject({ id: 'message-42', sequence: 42 })
    expect(result.page.hasMore).toBe(false)
  })
})

describe('groupApi.listMessages（TASK_STATUS 仓库映射 §39）', () => {
  it('preserves repositoryMappings from the structured status-card content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{
        id: 'message-1',
        groupId: 'group-1',
        type: 'TASK_STATUS',
        senderType: 'AGENT',
        createdAt: '2026-08-20T08:00:00Z',
        content: {
          taskId: 'task-1',
          status: 'RUNNING',
          repositoryMappings: [
            { workspacePath: 'repo-2', repositoryId: 'project-repository-2' },
          ],
        },
      }],
      page: { nextCursor: null, hasMore: false },
      requestId: 'request-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await groupApi.listMessages('project-1', 'group-1')
    expect(result.data[0]?.content).toMatchObject({
      repositoryMappings: [{ workspacePath: 'repo-2', repositoryId: 'project-repository-2' }],
    })
  })
})
