import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router-dom'
import { StrictMode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffMessageContent, Group, Message, Page, TaskStatusMessageContent, TextMessageContent } from '@/types'

const reconnectListeners = vi.hoisted(() => new Set<() => void>())

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'chat-reader', displayName: 'Reader' } }),
}))
vi.mock('@/hooks/agents', () => ({ useAgents: () => ({ data: { data: [] } }) }))
vi.mock('@/realtime', () => ({
  subscribeRealtimeReconnect: (listener: () => void) => {
    reconnectListeners.add(listener)
    return () => { reconnectListeners.delete(listener) }
  },
}))
vi.mock('@/realtime/useProjectTaskDomainEvents', () => ({ useProjectTaskPollingInterval: () => false }))
vi.mock('@/components/task-domain', () => ({ TaskTriggerModal: () => null }))
vi.mock('@/components/chat/ChatSettingsDrawer', () => ({ ChatSettingsDrawer: () => null }))
vi.mock('@/components/chat/AttachmentPreviewModal', () => ({ AttachmentPreviewModal: () => null }))
vi.mock('@/components/chat/ChatHeader', () => ({
  ChatHeader: ({ group }: { group?: Group }) => <h2>{group?.title ?? '聊天'}</h2>,
}))
vi.mock('@/components/chat/ChatMessageBubble', () => ({
  MessageBubble: ({ message }: { message: Message }) => {
    if (message.type === 'TASK_STATUS') {
      const content = message.content as TaskStatusMessageContent
      return <article aria-label={`任务状态 ${message.id}`}>
        <p>{content.message}</p>
        {content.plan?.steps?.map((step) => <p key={step.stepId}>{step.title}：{step.status}</p>)}
      </article>
    }
    if (message.type === 'DIFF') {
      const content = message.content as DiffMessageContent
      return <article aria-label={`Diff 交付 ${message.id}`}><p>{content.title}</p><p>{content.reviewStatus} / {content.deliveryStatus}</p></article>
    }
    return <span>{(message.content as TextMessageContent).text}</span>
  },
}))

import { ChatPanel } from './ChatPanel'

const PROJECT_ID = 'chat004-project'
const GROUP_A = 'chat004-a'
const GROUP_B = 'chat004-b'
const HISTORY_CURSOR = 'older-31'
const SYNC_WARNING = '同步未成功，当前显示已有消息'
const INPUT_PLACEHOLDER = '输入消息，@ 可提及成员或 Agent，回车发送…'
const clients: QueryClient[] = []
const observedRequests: URL[] = []

function message(id: string, sequence: number, text: string, groupId = GROUP_A): Message {
  return { id, groupId, sequence, type: 'TEXT', senderType: 'USER', senderId: 'other-user', senderName: 'Teammate', content: { text }, createdAt: new Date(Date.UTC(2026, 9, 19, 8, 0, sequence)).toISOString() }
}

const currentMessages = [message('message-31', 31, '已经加载的消息一'), message('message-32', 32, '已经加载的消息二')]
const otherMessages = [message('message-b', 11, '另一个群的消息', GROUP_B)]

function page(data: Message[], nextCursor: string | null = null): Page<Message> {
  return { data, page: { nextCursor, hasMore: nextCursor !== null } }
}

function unavailable() {
  return HttpResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: '测试注入的临时错误' } }, { status: 503 })
}

function createGate() {
  let resolveGate = () => {}
  const promise = new Promise<void>((resolve) => { resolveGate = resolve })
  return { promise, release: () => resolveGate() }
}

const server = setupServer(
  http.get('/api/projects/:projectId/groups', () => HttpResponse.json({ data: [
    { id: GROUP_A, projectId: PROJECT_ID, type: 'REQUIREMENT', title: '群 A', status: 'ACTIVE' },
    { id: GROUP_B, projectId: PROJECT_ID, type: 'REQUIREMENT', title: '群 B', status: 'ACTIVE' },
  ] })),
  http.get('/api/projects/:projectId', () => HttpResponse.json({ data: { id: PROJECT_ID, teamId: 'chat004-team', name: 'Chat regression' } })),
  http.get('/api/projects/:projectId/groups/:groupId/members', () => HttpResponse.json({ data: [] })),
  http.get('/api/projects/:projectId/tasks', () => HttpResponse.json(page([]))),
  http.post('/api/projects/:projectId/groups/:groupId/read', ({ params }) => HttpResponse.json({ data: { groupId: params.groupId, lastReadSequenceNo: 32, unreadCount: 0 } })),
  http.get('/api/projects/:projectId/groups/:groupId/messages', ({ params }) => HttpResponse.json(page(params.groupId === GROUP_A ? currentMessages : otherMessages))),
  http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => HttpResponse.json(page([]))),
)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request }) => observedRequests.push(new URL(request.url)))
})
beforeEach(() => {
  observedRequests.length = 0
  reconnectListeners.clear()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  onlineManager.setOnline(true)
  server.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

function messagesKey(groupId = GROUP_A) {
  return ['groups', PROJECT_ID, groupId, 'messages'] as const
}

function renderChat(groupId = GROUP_A, cached?: Page<Message> | InfiniteData<Page<Message>>, strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } })
  clients.push(client)
  if (cached) client.setQueryData<InfiniteData<Page<Message>>>(messagesKey(groupId), 'pages' in cached ? cached : { pages: [cached], pageParams: [undefined] })
  const tree = (nextGroupId: string) => (
    <QueryClientProvider client={client}>
      <AntdApp>
        <MemoryRouter>
          <ChatPanel projectId={PROJECT_ID} groupId={nextGroupId} />
        </MemoryRouter>
      </AntdApp>
    </QueryClientProvider>
  )
  const view = (nextGroupId: string) => strict ? <StrictMode>{tree(nextGroupId)}</StrictMode> : tree(nextGroupId)
  const result = render(view(groupId))
  return { ...result, client, switchGroup: (nextGroupId: string) => result.rerender(view(nextGroupId)) }
}

function emitMessageEvent(groupId = GROUP_A) {
  act(() => {
    window.dispatchEvent(new CustomEvent('qgents:message-event', { detail: { projectId: PROJECT_ID, groupId, eventType: 'message.created' } }))
  })
}

function returnToVisibleTab() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

function reconnectRealtime() {
  act(() => { for (const listener of reconnectListeners) listener() })
}

function historyRequests() {
  return observedRequests.filter((url) => url.pathname === `/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages`)
}

function incrementalRequests(groupId = GROUP_A) {
  return observedRequests.filter((url) => url.pathname === `/api/projects/${PROJECT_ID}/groups/${groupId}/messages/incremental`)
}

function cardRequests(messageId: string, groupId = GROUP_A) {
  return observedRequests.filter((url) => url.pathname === `/api/projects/${PROJECT_ID}/groups/${groupId}/messages/${messageId}`)
}

async function settleInitialMessages(expectedText = '已经加载的消息一') {
  await screen.findByText(expectedText)
  await waitFor(() => expect(incrementalRequests().length).toBeGreaterThan(0))
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
}

function getViewport() {
  return screen.getByLabelText('对话内容')
}

describe('ChatPanel CHAT-004 request failures', () => {
  it('offers a first-load retry without showing an empty conversation', async () => {
    let failing = true
    server.use(http.get('/api/projects/:projectId/groups/:groupId/messages', () => failing ? unavailable() : HttpResponse.json(page(currentMessages))))
    renderChat()

    expect(await screen.findByText('消息加载失败')).toBeInTheDocument()
    expect(screen.queryByText('还没有消息，来说点什么吧')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: '首载失败时写下的草稿' } })
    const requestsBeforeRetry = historyRequests().length
    failing = false
    fireEvent.click(screen.getByRole('button', { name: '重试加载消息' }))

    expect(await screen.findByText('已经加载的消息一')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('首载失败时写下的草稿')
    expect(screen.queryByText('消息加载失败')).not.toBeInTheDocument()
    expect(historyRequests().length).toBeGreaterThan(requestsBeforeRetry)
  })

  it('keeps message nodes, the draft and the reading anchor after a history failure, then retries the same cursor', async () => {
    let failingHistory = true
    let incrementalMessage: Message | null = null
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === HISTORY_CURSOR) return failingHistory ? unavailable() : HttpResponse.json(page([message('message-29', 29, '更早的历史消息')]))
        return HttpResponse.json(page(currentMessages, HISTORY_CURSOR))
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => {
        const received = incrementalMessage
        incrementalMessage = null
        return HttpResponse.json(page(received ? [received] : []))
      }),
    )
    renderChat()
    await settleInitialMessages()
    const viewport = getViewport()
    const originalRow = document.getElementById('msg-message-31')
    Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: () => 1200 }, clientHeight: { configurable: true, get: () => 300 } })
    viewport.scrollTop = 20
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: '保留我的历史阅读草稿' } })
    fireEvent.scroll(viewport)

    expect(await screen.findByText('更早消息加载失败')).toBeInTheDocument()
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    expect(originalRow).toBeInTheDocument()
    expect(getViewport()).toBe(viewport)
    expect(viewport.scrollTop).toBe(20)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('保留我的历史阅读草稿')
    expect(screen.queryByText('消息加载失败')).not.toBeInTheDocument()

    // A concurrent successful increment must not acknowledge the failed history request.
    incrementalMessage = message('message-33', 33, '分页失败后到达的新消息')
    emitMessageEvent()
    expect(await screen.findByText('分页失败后到达的新消息')).toBeInTheDocument()
    expect(screen.getByText('更早消息加载失败')).toBeInTheDocument()

    failingHistory = false
    fireEvent.click(screen.getByRole('button', { name: '重试加载历史' }))
    expect(await screen.findByText('更早的历史消息')).toBeInTheDocument()
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    expect(viewport.scrollTop).toBe(20)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('保留我的历史阅读草稿')
    expect(screen.queryByText('更早消息加载失败')).not.toBeInTheDocument()
    expect(historyRequests().map((url) => url.searchParams.get('cursor')).filter((cursor) => cursor !== null)).toEqual([HISTORY_CURSOR, HISTORY_CURSOR])
  })

  it('retains existing messages after a refetch failure and retries that query even after an incremental success', async () => {
    let failingRefetch = false
    let incrementalMessage: Message | null = null
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', () => failingRefetch ? unavailable() : HttpResponse.json(page(currentMessages))),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => {
        const received = incrementalMessage
        incrementalMessage = null
        return HttpResponse.json(page(received ? [received] : []))
      }),
    )
    const { client } = renderChat()
    await settleInitialMessages()
    const originalRow = document.getElementById('msg-message-31')
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: '后台失败不能清空' } })
    failingRefetch = true
    await act(async () => { await client.invalidateQueries({ queryKey: messagesKey(), exact: true }) })

    expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('后台失败不能清空')
    incrementalMessage = message('message-33', 33, '同步警告期间到达的新消息')
    emitMessageEvent()
    expect(await screen.findByText('同步警告期间到达的新消息')).toBeInTheDocument()
    expect(screen.getByText(SYNC_WARNING)).toBeInTheDocument()

    const retrySync = screen.getByRole('button', { name: /重试同步/ })
    await waitFor(() => expect(retrySync).not.toHaveClass('ant-btn-loading'))
    const beforeRetry = historyRequests().length
    failingRefetch = false
    fireEvent.click(retrySync)
    await waitFor(() => expect(historyRequests()).toHaveLength(beforeRetry + 1))
    await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('后台失败不能清空')
  })

  it('distinguishes a cached empty conversation from an uncached first-load error', async () => {
    let failingRefetch = true
    server.use(http.get('/api/projects/:projectId/groups/:groupId/messages', () => failingRefetch ? unavailable() : HttpResponse.json(page([]))))
    const { client } = renderChat(GROUP_A, page([]))
    expect(await screen.findByText('还没有消息，来说点什么吧')).toBeInTheDocument()
    await act(async () => { await client.invalidateQueries({ queryKey: messagesKey(), exact: true }) })

    expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
    expect(screen.getByText('还没有消息，来说点什么吧')).toBeInTheDocument()
    expect(screen.queryByText('消息加载失败')).not.toBeInTheDocument()
    failingRefetch = false
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }))
    await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
    expect(screen.getByText('还没有消息，来说点什么吧')).toBeInTheDocument()
  })

  it('reports a direct incremental failure and clears it after a successful empty incremental retry', async () => {
    let failingIncrement = false
    server.use(http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => failingIncrement ? unavailable() : HttpResponse.json(page([]))))
    renderChat()
    await settleInitialMessages()
    const originalRow = document.getElementById('msg-message-31')
    failingIncrement = true
    emitMessageEvent()
    expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    const beforeRetry = incrementalRequests().length
    const historyCount = historyRequests().length

    failingIncrement = false
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }))
    await waitFor(() => expect(incrementalRequests()).toHaveLength(beforeRetry + 1))
    await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
    expect(incrementalRequests().at(-1)?.searchParams.get('afterSequence')).toBe('32')
    expect(historyRequests()).toHaveLength(historyCount)
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
  })

  it('retries reconciliation when both its incremental request and full-query fallback fail', async () => {
    let failingRequests = false
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', () => failingRequests ? unavailable() : HttpResponse.json(page(currentMessages))),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => failingRequests ? unavailable() : HttpResponse.json(page([]))),
    )
    renderChat()
    await settleInitialMessages()
    const originalRow = document.getElementById('msg-message-31')
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: '校准失败仍保留的草稿' } })
    const beforeFallback = historyRequests().length
    failingRequests = true
    returnToVisibleTab()
    expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
    await waitFor(() => expect(historyRequests().length).toBeGreaterThan(beforeFallback))
    const retrySync = screen.getByRole('button', { name: /重试同步/ })
    await waitFor(() => expect(retrySync).not.toHaveClass('ant-btn-loading'))
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('校准失败仍保留的草稿')
    const beforeRetry = incrementalRequests().length

    failingRequests = false
    fireEvent.click(retrySync)
    await waitFor(() => expect(incrementalRequests().length).toBeGreaterThan(beforeRetry))
    await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
    expect(incrementalRequests().at(-1)?.searchParams.get('afterSequence')).toBe('32')
    expect(document.getElementById('msg-message-31')).toBe(originalRow)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('校准失败仍保留的草稿')
  })

  it('recovers from a reconciliation incremental failure through a successful full-query fallback', async () => {
    let failingIncrement = false
    server.use(http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => failingIncrement ? unavailable() : HttpResponse.json(page([]))))
    const { client } = renderChat()
    await settleInitialMessages()
    const beforeFallback = historyRequests().length
    failingIncrement = true
    returnToVisibleTab()

    await waitFor(() => expect(historyRequests().length).toBeGreaterThan(beforeFallback))
    await waitFor(() => expect(client.getQueryState(messagesKey())?.fetchStatus).toBe('idle'))
    expect(await screen.findByText('显示当前已加载消息')).toBeInTheDocument()
    expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument()
    expect(screen.getByText('已经加载的消息一')).toBeInTheDocument()
  })

  it('keeps an in-flight history page and its reading state when a concurrent reconciliation fallback fails', async () => {
    const historyResponse = createGate()
    const incrementalFailure = createGate()
    const fallbackResponse = createGate()
    const fallbackReturned = createGate()
    let failNextIncrement = false
    let failingFallback = false
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', async ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === HISTORY_CURSOR) {
          await historyResponse.promise
          return HttpResponse.json(page([message('message-29', 29, '延迟加载的历史消息')]))
        }
        if (failingFallback) {
          await fallbackResponse.promise
          fallbackReturned.release()
          return unavailable()
        }
        return HttpResponse.json(page(currentMessages, HISTORY_CURSOR))
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => {
        if (failNextIncrement) {
          failNextIncrement = false
          incrementalFailure.release()
          return unavailable()
        }
        return HttpResponse.json(page([]))
      }),
    )
    renderChat()
    await settleInitialMessages()
    const originalRow = document.getElementById('msg-message-31')
    const viewport = getViewport()
    Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: () => 1200 }, clientHeight: { configurable: true, get: () => 300 } })
    viewport.scrollTop = 20
    fireEvent.scroll(viewport)
    await waitFor(() => expect(historyRequests().some((url) => url.searchParams.get('cursor') === HISTORY_CURSOR)).toBe(true))
    const initialFullRequests = historyRequests().filter((url) => !url.searchParams.has('cursor')).length
    failingFallback = true
    failNextIncrement = true
    returnToVisibleTab()
    try {
      await act(async () => { await incrementalFailure.promise })
      act(() => { historyResponse.release() })

      expect(await screen.findByText('延迟加载的历史消息')).toBeInTheDocument()
      await waitFor(() => expect(historyRequests().filter((url) => !url.searchParams.has('cursor')).length).toBeGreaterThan(initialFullRequests))
      await act(async () => {
        fallbackResponse.release()
        await fallbackReturned.promise
      })
      expect(screen.getByText(SYNC_WARNING)).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: /重试同步/ })).not.toHaveClass('ant-btn-loading'))
      expect(document.getElementById('msg-message-31')).toBe(originalRow)
      expect(screen.queryByText('消息加载失败')).not.toBeInTheDocument()
    } finally {
      historyResponse.release()
      fallbackResponse.release()
    }
  })

  it('keeps a paused reconciliation fallback failed until its actual online HTTP response succeeds', async () => {
    const fallbackStarted = createGate()
    const fallbackResponse = createGate()
    let failNextIncrement = false
    let holdFallback = false
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', async () => {
        if (holdFallback) {
          fallbackStarted.release()
          await fallbackResponse.promise
        }
        return HttpResponse.json(page(currentMessages))
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => {
        if (failNextIncrement) {
          failNextIncrement = false
          return unavailable()
        }
        return HttpResponse.json(page([]))
      }),
    )
    const { client } = renderChat()
    await settleInitialMessages()
    const initialFullRequests = historyRequests().length
    const originalRow = document.getElementById('msg-message-31')
    holdFallback = true
    failNextIncrement = true
    act(() => { onlineManager.setOnline(false) })
    returnToVisibleTab()
    try {
      await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: messagesKey() }).some((query) => query.state.fetchStatus === 'paused')).toBe(true))
      expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
      expect(historyRequests()).toHaveLength(initialFullRequests)
      act(() => { onlineManager.setOnline(true) })
      await act(async () => { await fallbackStarted.promise })
      expect(client.getQueryCache().findAll({ queryKey: messagesKey() }).some((query) => query.state.fetchStatus === 'fetching')).toBe(true)
      expect(screen.getByText(SYNC_WARNING)).toBeInTheDocument()
      expect(document.getElementById('msg-message-31')).toBe(originalRow)

      act(() => { fallbackResponse.release() })
      await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: messagesKey() }).every((query) => query.state.fetchStatus === 'idle')).toBe(true))
      await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
      expect(document.getElementById('msg-message-31')).toBe(originalRow)
    } finally {
      fallbackResponse.release()
    }
  })

  it.each(['failure', 'success'] as const)('ignores an old group incremental %s after switching groups', async (outcome) => {
    let holdOldRequest = false
    let releaseOld: (() => void) | undefined
    let oldResponseSent: (() => void) | undefined
    const oldRequestGate = new Promise<void>((resolve) => { releaseOld = resolve })
    const oldResponseDone = new Promise<void>((resolve) => { oldResponseSent = resolve })
    server.use(http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', async ({ params }) => {
      if (params.groupId === GROUP_A && holdOldRequest) {
        await oldRequestGate
        oldResponseSent?.()
        return outcome === 'failure' ? unavailable() : HttpResponse.json(page([]))
      }
      if (params.groupId === GROUP_B && outcome === 'success') return unavailable()
      return HttpResponse.json(page([]))
    }))
    const { switchGroup } = renderChat()
    await settleInitialMessages()
    holdOldRequest = true
    const beforeRequest = incrementalRequests().length
    emitMessageEvent()
    await waitFor(() => expect(incrementalRequests().length).toBeGreaterThan(beforeRequest))
    switchGroup(GROUP_B)
    expect(await screen.findByText('另一个群的消息')).toBeInTheDocument()
    if (outcome === 'success') expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()

    await act(async () => {
      releaseOld?.()
      await oldResponseDone
    })
    // Wait through response parsing and React's queued notifications, not a time-based sleep.
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(screen.getByText('另一个群的消息')).toBeInTheDocument()
    if (outcome === 'failure') expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument()
    else expect(screen.getByText(SYNC_WARNING)).toBeInTheDocument()
  })
})

function taskStatusMessage(updated: boolean, id = 'status-card-31', sequence = 31, groupId = GROUP_A): Message {
  const content: TaskStatusMessageContent = {
    taskId: `task-${id}`,
    status: updated ? 'SUCCEEDED' : 'RUNNING',
    message: updated ? `${id} 的正文已校准` : `${id} 的旧正文`,
    plan: { steps: [{ stepId: `step-${id}`, sequence: 1, title: `${id} 的执行步骤`, status: updated ? 'SUCCEEDED' : 'RUNNING' }] },
  }
  return { ...message(id, sequence, '', groupId), type: 'TASK_STATUS', senderType: 'AGENT', content }
}

describe('ChatPanel CHAT-001 recovery calibration', () => {
  it.each(['visible', 'reconnect'] as const)('refreshes an existing status card body and steps after %s recovery with an empty increment', async (source) => {
    let updated = false
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', () => HttpResponse.json(page([taskStatusMessage(updated), currentMessages[1]]))),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, () => HttpResponse.json({ data: taskStatusMessage(updated) })),
    )
    const { client } = renderChat()
    await settleInitialMessages('status-card-31 的旧正文')
    const originalRow = document.getElementById('msg-status-card-31')
    const beforeRecovery = incrementalRequests().length
    updated = true
    if (source === 'visible') returnToVisibleTab()
    else reconnectRealtime()

    await waitFor(() => expect(incrementalRequests().length).toBeGreaterThan(beforeRecovery))
    expect(await screen.findByText('status-card-31 的正文已校准')).toBeInTheDocument()
    expect(screen.getByText('status-card-31 的执行步骤：SUCCEEDED')).toBeInTheDocument()
    expect(document.getElementById('msg-status-card-31')).toBe(originalRow)
    const cached = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages.flatMap((item) => item.data) ?? []
    expect(cached.filter((item) => item.id === 'status-card-31')).toHaveLength(1)
    expect(cached.find((item) => item.id === 'status-card-31')).toMatchObject({ sequence: 31, createdAt: taskStatusMessage(false).createdAt, content: { status: 'SUCCEEDED' } })
  })

  it.each(['TASK_STATUS', 'DIFF'] as const)('calibrates a SYSTEM fallback %s card by message type', async (kind) => {
    let updated = false
    const cardId = `system-${kind.toLowerCase()}`
    const systemCard = (): Message => {
      if (kind === 'TASK_STATUS') return { ...taskStatusMessage(updated, cardId), senderType: 'SYSTEM' }
      const content: DiffMessageContent = { diffId: 'diff-system-card', title: updated ? `${cardId} 的正文已校准` : `${cardId} 的旧正文`, reviewStatus: updated ? 'ACCEPTED' : 'PENDING_CONFIRMATION', deliveryStatus: updated ? 'DELIVERED' : 'PENDING' }
      return { ...message(cardId, 31, ''), type: 'DIFF', senderType: 'SYSTEM', content }
    }
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', () => HttpResponse.json(page([systemCard(), currentMessages[1]]))),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/${cardId}`, () => HttpResponse.json({ data: systemCard() })),
    )
    const { client } = renderChat()
    await settleInitialMessages(`${cardId} 的旧正文`)
    const originalRow = document.getElementById(`msg-${cardId}`)
    updated = true
    reconnectRealtime()

    expect(await screen.findByText(`${cardId} 的正文已校准`)).toBeInTheDocument()
    if (kind === 'TASK_STATUS') expect(screen.getByText(`${cardId} 的执行步骤：SUCCEEDED`)).toBeInTheDocument()
    else expect(screen.getByText('ACCEPTED / DELIVERED')).toBeInTheDocument()
    expect(document.getElementById(`msg-${cardId}`)).toBe(originalRow)
    const rows = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages.flatMap((item) => item.data) ?? []
    expect(rows.find((item) => item.id === cardId)).toMatchObject({ type: kind, senderType: 'SYSTEM', sequence: 31 })
  })

  it('restores the visible row offset when an earlier card grows after the reader scrolls during calibration', async () => {
    let updated = false
    const cardResponse = createGate()
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', () => HttpResponse.json(page([taskStatusMessage(updated), currentMessages[1]]))),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, async () => {
        await cardResponse.promise
        return HttpResponse.json({ data: taskStatusMessage(updated) })
      }),
    )
    renderChat()
    await settleInitialMessages('status-card-31 的旧正文')
    const viewport = getViewport()
    const cardRow = document.getElementById('msg-status-card-31')
    const readingRow = document.getElementById('msg-message-32')
    if (!cardRow || !readingRow) throw new Error('Expected the card and its following reading row')
    // jsdom has no layout: model a 90 px expansion only after the new content commits.
    const addedHeight = () => cardRow.textContent?.includes('正文已校准') ? 90 : 0
    Object.defineProperties(viewport, { clientHeight: { configurable: true, get: () => 300 }, scrollHeight: { configurable: true, get: () => 1400 + addedHeight() } })
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 10, 600, 300))
    vi.spyOn(cardRow, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 10 - viewport.scrollTop, 600, 100 + addedHeight()))
    vi.spyOn(readingRow, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 150 + addedHeight() - viewport.scrollTop, 600, 50))
    viewport.scrollTop = 80
    fireEvent.scroll(viewport)
    updated = true
    reconnectRealtime()
    try {
      await waitFor(() => expect(cardRequests('status-card-31').length).toBeGreaterThan(0))
      viewport.scrollTop = 120
      fireEvent.scroll(viewport)
      const offsetBeforeCommit = readingRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      act(() => { cardResponse.release() })

      expect(await screen.findByText('status-card-31 的正文已校准')).toBeInTheDocument()
      await waitFor(() => expect(viewport.scrollTop).toBe(210))
      expect(readingRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top).toBe(offsetBeforeCommit)
      expect(document.getElementById('msg-message-32')).toBe(readingRow)
    } finally {
      cardResponse.release()
    }
  })

  it('preserves and calibrates cards in the loaded history window even when new messages displace that whole window', async () => {
    let updated = false
    const latest = (newContent: boolean) => [taskStatusMessage(newContent), currentMessages[1]]
    const older = (newContent: boolean) => [taskStatusMessage(newContent, 'history-card-29', 29), message('history-text-30', 30, '原有历史文本')]
    const arrival = Array.from({ length: 90 }, (_, index) => message(`new-${100 + index}`, 100 + index, `恢复期间新增 ${100 + index}`))
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        if (cursor === HISTORY_CURSOR) return HttpResponse.json(page(older(updated)))
        if (!updated) return HttpResponse.json(page(latest(false), HISTORY_CURSOR))
        if (cursor === 'arrival-page-2') return HttpResponse.json(page(arrival.slice(30, 60), 'arrival-page-3'))
        if (cursor === 'arrival-page-3') return HttpResponse.json(page(arrival.slice(0, 30)))
        return HttpResponse.json(page(arrival.slice(60), 'arrival-page-2'))
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', ({ request }) => {
        const after = Number(new URL(request.url).searchParams.get('afterSequence'))
        return HttpResponse.json(page(updated ? arrival.filter((item) => (item.sequence ?? 0) > after) : []))
      }),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, () => HttpResponse.json({ data: taskStatusMessage(updated) })),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/history-card-29`, () => HttpResponse.json({ data: taskStatusMessage(updated, 'history-card-29', 29) })),
    )
    const { client } = renderChat(GROUP_A, { pages: [page(latest(false), HISTORY_CURSOR), page(older(false))], pageParams: [undefined, HISTORY_CURSOR] })
    await settleInitialMessages('status-card-31 的旧正文')
    await waitFor(() => expect(client.isFetching({ queryKey: messagesKey(), exact: true })).toBe(0))
    const latestRow = document.getElementById('msg-status-card-31')
    const historyRow = document.getElementById('msg-history-card-29')
    const viewport = getViewport()
    Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: () => 3000 }, clientHeight: { configurable: true, get: () => 300 } })
    viewport.scrollTop = 80
    fireEvent.scroll(viewport)
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: '保留历史窗口和草稿' } })
    updated = true
    reconnectRealtime()

    expect(await screen.findByText('status-card-31 的正文已校准')).toBeInTheDocument()
    expect(await screen.findByText('history-card-29 的正文已校准')).toBeInTheDocument()
    expect(screen.getByText('history-card-29 的执行步骤：SUCCEEDED')).toBeInTheDocument()
    expect(await screen.findByText('恢复期间新增 189')).toBeInTheDocument()
    expect(screen.getByText('原有历史文本')).toBeInTheDocument()
    expect(document.getElementById('msg-status-card-31')).toBe(latestRow)
    expect(document.getElementById('msg-history-card-29')).toBe(historyRow)
    expect(getViewport()).toBe(viewport)
    expect(viewport.scrollTop).toBe(80)
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('保留历史窗口和草稿')
    const cached = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages.flatMap((item) => item.data) ?? []
    const ids = cached.map((item) => item.id)
    expect(ids).toEqual(expect.arrayContaining(['status-card-31', 'history-card-29', 'message-32', 'history-text-30', ...arrival.map((item) => item.id)]))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(['incremental', 'history fallback'] as const)('fills all 250 new messages through multiple %s pages while retaining a previously complete old window', async (mode) => {
    let recovering = false
    let failNextIncrement = false
    const lastFallbackPageStarted = createGate()
    const lastFallbackPageResponse = createGate()
    const arrival = Array.from({ length: 250 }, (_, index) => message(`backlog-${33 + index}`, 33 + index, `积压消息 ${33 + index}`))
    const completeHistory = () => [...arrival, currentMessages[1], taskStatusMessage(true)].sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', async ({ request }) => {
        if (!recovering) return HttpResponse.json(page([taskStatusMessage(false), currentMessages[1]]))
        const params = new URL(request.url).searchParams
        const limit = Number(params.get('limit') ?? 30)
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return HttpResponse.json({ error: { code: 'INVALID_LIMIT', message: 'limit must be 1..100' } }, { status: 400 })
        const cursor = params.get('cursor')
        const start = cursor?.startsWith('restore-') ? Number(cursor.slice('restore-'.length)) : 0
        if (mode === 'history fallback' && start >= 200) {
          lastFallbackPageStarted.release()
          await lastFallbackPageResponse.promise
        }
        const rows = completeHistory()
        const next = start + limit
        return HttpResponse.json(page(rows.slice(start, next), next < rows.length ? `restore-${next}` : null))
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', ({ request }) => {
        if (failNextIncrement) {
          failNextIncrement = false
          return unavailable()
        }
        if (!recovering || mode === 'history fallback') return HttpResponse.json(page([]))
        const after = Number(new URL(request.url).searchParams.get('afterSequence'))
        const remaining = arrival.filter((item) => (item.sequence ?? 0) > after)
        const chunk = remaining.slice(0, 100)
        return HttpResponse.json(page(chunk, remaining.length > chunk.length ? String(chunk.at(-1)?.sequence) : null))
      }),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, () => HttpResponse.json({ data: taskStatusMessage(recovering) })),
    )
    const { client } = renderChat()
    await settleInitialMessages('status-card-31 的旧正文')
    await waitFor(() => expect(client.isFetching({ queryKey: messagesKey(), exact: true })).toBe(0))
    const originalRow = document.getElementById('msg-status-card-31')
    const initialRows = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())
    expect(initialRows?.pages[0].page.hasMore).toBe(false)
    const requestsBeforeRecovery = historyRequests().length
    recovering = true
    failNextIncrement = mode === 'history fallback'
    reconnectRealtime()
    try {
      if (mode === 'history fallback') {
        await act(async () => { await lastFallbackPageStarted.promise })
        expect(screen.getByText(SYNC_WARNING)).toBeInTheDocument()
        expect(screen.getByText('status-card-31 的旧正文')).toBeInTheDocument()
        expect(screen.queryByText('积压消息 282')).not.toBeInTheDocument()
        expect(document.getElementById('msg-status-card-31')).toBe(originalRow)
        act(() => { lastFallbackPageResponse.release() })
      }

      expect(await screen.findByText('积压消息 282')).toBeInTheDocument()
      expect(await screen.findByText('status-card-31 的正文已校准')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
      expect(document.getElementById('msg-status-card-31')).toBe(originalRow)
      const rows = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages.flatMap((item) => item.data) ?? []
      const ids = rows.map((item) => item.id)
      expect(ids).toEqual(expect.arrayContaining(['status-card-31', 'message-32', ...arrival.map((item) => item.id)]))
      expect(new Set(ids).size).toBe(ids.length)
      if (mode === 'history fallback') {
        const recoveryRequests = historyRequests().slice(requestsBeforeRecovery)
        expect(recoveryRequests.filter((url) => url.searchParams.has('cursor')).length).toBeGreaterThanOrEqual(2)
        expect(recoveryRequests.every((url) => Number(url.searchParams.get('limit')) <= 100)).toBe(true)
      } else {
        expect(incrementalRequests().some((url) => url.searchParams.get('afterSequence') === '132')).toBe(true)
        expect(incrementalRequests().some((url) => url.searchParams.get('afterSequence') === '232')).toBe(true)
      }
    } finally {
      lastFallbackPageResponse.release()
    }
  })

  it('keeps unknown old rows from a recovery boundary page out of the latest window until normal history pagination', async () => {
    let recovering = false
    let failNextIncrement = false
    const unseenOldMessage = message('unseen-history-29', 29, '只应通过历史翻页出现的旧消息')
    const arrival = message('new-message-33', 33, '边界恢复新增消息')
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === HISTORY_CURSOR) return HttpResponse.json(page([unseenOldMessage]))
        return HttpResponse.json(page(recovering ? [arrival, currentMessages[1], taskStatusMessage(true), unseenOldMessage] : [taskStatusMessage(false), currentMessages[1]], HISTORY_CURSOR))
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', () => {
        if (failNextIncrement) {
          failNextIncrement = false
          return unavailable()
        }
        return HttpResponse.json(page([]))
      }),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, () => HttpResponse.json({ data: taskStatusMessage(recovering) })),
    )
    const { client } = renderChat()
    await settleInitialMessages('status-card-31 的旧正文')
    recovering = true
    failNextIncrement = true
    reconnectRealtime()
    expect(await screen.findByText('边界恢复新增消息')).toBeInTheDocument()
    expect(await screen.findByText('status-card-31 的正文已校准')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
    expect(screen.queryByText('只应通过历史翻页出现的旧消息')).not.toBeInTheDocument()
    expect(client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages[0].page.nextCursor).toBe(HISTORY_CURSOR)

    const viewport = getViewport()
    Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: () => 1800 }, clientHeight: { configurable: true, get: () => 300 } })
    viewport.scrollTop = 20
    fireEvent.scroll(viewport)
    expect(await screen.findByText('只应通过历史翻页出现的旧消息')).toBeInTheDocument()
    const rows = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages.flatMap((item) => item.data) ?? []
    const ids = rows.map((item) => item.id)
    expect(ids.filter((id) => id === unseenOldMessage.id)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('completes the cached initial increment after StrictMode cleans up the first mount', async () => {
    const firstResponse = createGate()
    const readResponse = createGate()
    let incrementCalls = 0
    server.use(
      // Hold the unrelated mark-read invalidation so it cannot replace the seeded cache during this mount race.
      http.post('/api/projects/:projectId/groups/:groupId/read', async () => {
        await readResponse.promise
        return HttpResponse.json({ data: { groupId: GROUP_A, lastReadSequenceNo: 32, unreadCount: 0 } })
      }),
      http.get('/api/projects/:projectId/groups/:groupId/messages/incremental', async ({ request }) => {
      incrementCalls += 1
      if (incrementCalls === 1) {
        await firstResponse.promise
        return HttpResponse.json(page([message('strict-stale-34', 34, '应忽略已清理挂载的迟到补查')]))
      }
      const after = Number(new URL(request.url).searchParams.get('afterSequence'))
      return HttpResponse.json(page(after < 33 ? [message('strict-current-33', 33, 'StrictMode 缓存补查完成')] : []))
      }),
    )
    const { client } = renderChat(GROUP_A, page(currentMessages), true)
    try {
      await waitFor(() => expect(incrementCalls).toBeGreaterThanOrEqual(2))
      expect(await screen.findByText('StrictMode 缓存补查完成')).toBeInTheDocument()
      expect(incrementCalls).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('已经加载的消息一')).toBeInTheDocument()
      act(() => { firstResponse.release() })
      await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
      expect(screen.queryByText('应忽略已清理挂载的迟到补查')).not.toBeInTheDocument()
      const rows = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey())?.pages.flatMap((item) => item.data) ?? []
      expect(rows.some((item) => item.id === 'strict-current-33')).toBe(true)
      expect(rows.some((item) => item.id === 'strict-stale-34')).toBe(false)
    } finally {
      firstResponse.release()
      readResponse.release()
    }
  })

  it('preserves the old card after a calibration GET fails and retries calibration even when increments stay empty', async () => {
    let failingCard = false
    let updated = false
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', () => HttpResponse.json(page([taskStatusMessage(updated), currentMessages[1]]))),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, () => failingCard ? unavailable() : HttpResponse.json({ data: taskStatusMessage(updated) })),
    )
    renderChat()
    await settleInitialMessages('status-card-31 的旧正文')
    const originalRow = document.getElementById('msg-status-card-31')
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: '校准错误期间的草稿' } })
    failingCard = true
    updated = true
    reconnectRealtime()
    expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
    expect(screen.getByText('status-card-31 的旧正文')).toBeInTheDocument()
    expect(document.getElementById('msg-status-card-31')).toBe(originalRow)
    const retrySync = screen.getByRole('button', { name: /重试同步/ })
    await waitFor(() => expect(retrySync).not.toHaveClass('ant-btn-loading'))
    const beforeRetry = cardRequests('status-card-31').length
    failingCard = false
    fireEvent.click(retrySync)

    expect(await screen.findByText('status-card-31 的正文已校准')).toBeInTheDocument()
    expect(screen.getByText('status-card-31 的执行步骤：SUCCEEDED')).toBeInTheDocument()
    expect(cardRequests('status-card-31').length).toBeGreaterThan(beforeRetry)
    await waitFor(() => expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toHaveValue('校准错误期间的草稿')
    expect(document.getElementById('msg-status-card-31')).toBe(originalRow)
  })

  it.each(['failure', 'success'] as const)('isolates a late old-group card calibration %s from the current group', async (outcome) => {
    const oldCardResponse = createGate()
    const oldCardReturned = createGate()
    let holdOldCard = false
    server.use(
      http.get('/api/projects/:projectId/groups/:groupId/messages', ({ params }) => HttpResponse.json(page(params.groupId === GROUP_A ? [taskStatusMessage(false)] : [taskStatusMessage(false, 'group-b-card', 11, GROUP_B), ...otherMessages]))),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_A}/messages/status-card-31`, async () => {
        if (holdOldCard) {
          await oldCardResponse.promise
          oldCardReturned.release()
          return outcome === 'failure' ? unavailable() : HttpResponse.json({ data: taskStatusMessage(true) })
        }
        return HttpResponse.json({ data: taskStatusMessage(false) })
      }),
      http.get(`/api/projects/${PROJECT_ID}/groups/${GROUP_B}/messages/group-b-card`, () => outcome === 'success' ? unavailable() : HttpResponse.json({ data: taskStatusMessage(false, 'group-b-card', 11, GROUP_B) })),
    )
    const { client, switchGroup } = renderChat()
    await settleInitialMessages('status-card-31 的旧正文')
    holdOldCard = true
    const beforeOldCalibration = cardRequests('status-card-31').length
    reconnectRealtime()
    try {
      await waitFor(() => expect(cardRequests('status-card-31').length).toBeGreaterThan(beforeOldCalibration))
      switchGroup(GROUP_B)
      expect(await screen.findByText('另一个群的消息')).toBeInTheDocument()
      const currentRow = document.getElementById('msg-group-b-card')
      if (outcome === 'success') {
        reconnectRealtime()
        expect(await screen.findByText(SYNC_WARNING)).toBeInTheDocument()
      }
      await act(async () => {
        oldCardResponse.release()
        await oldCardReturned.promise
      })
      await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })

      expect(document.getElementById('msg-group-b-card')).toBe(currentRow)
      expect(screen.queryByText('status-card-31 的正文已校准')).not.toBeInTheDocument()
      if (outcome === 'failure') expect(screen.queryByText(SYNC_WARNING)).not.toBeInTheDocument()
      else expect(screen.getByText(SYNC_WARNING)).toBeInTheDocument()
      const cached = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey(GROUP_B))?.pages.flatMap((item) => item.data) ?? []
      expect(cached.some((item) => item.id === 'status-card-31')).toBe(false)
    } finally {
      oldCardResponse.release()
    }
  })
})
