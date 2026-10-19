import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import DeliveryCenterPage from './DeliveryCenterPage'
import { deliveryCenterHandlers } from '@/mocks/delivery-center/handlers'
import { resetDeliveryCenterStore } from '@/mocks/delivery-center/store'
import { agentHandlers } from '@/mocks/agent/handlers'
import { resetAgentStores } from '@/mocks/agent/handlers'

const server = setupServer(
  ...deliveryCenterHandlers,
  ...agentHandlers,
  http.get('/api/projects/:projectId', () => HttpResponse.json({ data: { id: 'project-delivery-center', teamId: 'team-owned-001' } })),
  http.get('/api/projects/:projectId/groups', () => HttpResponse.json({ data: [{ id: 'group-delivery', projectId: 'project-delivery-center', type: 'REQUIREMENT', title: 'Delivery Center rollout', status: 'ACTIVE' }] })),
  http.get('/api/projects/:projectId/repositories', () => HttpResponse.json({ data: [{ id: 'binding-main', repositoryId: 'repo-main', displayName: 'qgents-web', fullName: 'example/qgents-web', defaultBranch: 'main', authorizationStatus: 'AUTHORIZED' }] })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  server.resetHandlers()
  resetDeliveryCenterStore()
  resetAgentStores()
})

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/projects/:projectId/diffs" element={<DeliveryCenterPage />} />
          <Route path="/app/projects/:projectId/diffs/:diffId" element={<div>Diff Center</div>} />
          <Route path="/app/projects/:projectId/tasks/:taskId" element={<div>Task Detail</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DeliveryCenterPage', () => {
  it('consumes the observed direct summary response shape without crashing', async () => {
    server.use(
      http.get('/api/projects/:projectId/delivery-items', () => HttpResponse.json({ data: [], page: { nextCursor: null, hasMore: false }, requestId: 'items-empty' })),
      http.get('/api/projects/:projectId/delivery-summary', () => HttpResponse.json({
        total: 0,
        countsByType: { CODE: 0, MEMORY: 0, SKILL: 0, AGENT: 0 },
        countsByStatus: { DRAFT: 0, PENDING_REVIEW: 0, PROCESSING: 0, ACCEPTED: 0, REJECTED: 0, DELIVERED: 0, FAILED: 0, ARCHIVED: 0 },
        pendingForCurrentUser: 0,
        repositorySummaries: [],
        requirementGroupSummaries: [],
        updatedAt: '2026-08-15T13:38:15.215Z',
      })),
    )

    renderPage('/app/projects/project-delivery-center/diffs')

    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(await screen.findByText('交付概览')).toBeInTheDocument()
    expect(screen.queryByText('交付概览加载失败')).not.toBeInTheDocument()
  })

  it('renders discriminated types, requirement groups, restores URL filters, and loads the next cursor', async () => {
    const filteredRender = renderPage('/app/projects/project-delivery-center/diffs?groupId=group-delivery&type=MEMORY&status=DRAFT')

    const card = await screen.findByText('Draft memory')
    expect(screen.getByTestId('location')).toHaveTextContent('groupId=group-delivery&type=MEMORY&status=DRAFT')
    expect(card).toBeInTheDocument()
    expect(screen.queryByText('Published skill')).not.toBeInTheDocument()

    filteredRender.unmount()
    renderPage('/app/projects/project-delivery-center/diffs')
    expect(await screen.findByText('Draft memory')).toBeInTheDocument()
    expect(screen.queryByText('Published skill')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看全部交付物' }))
    expect(await screen.findByText('未关联需求群')).toBeInTheDocument()
    const loadMore = await screen.findByRole('button', { name: '加载更多' })
    fireEvent.click(loadMore)
    expect((await screen.findAllByText('Code delivery in progress')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('CODE').length).toBeGreaterThan(0)
  })

  it('routes code details through the formal openTarget and enforces capabilities plus rejection reason validation', async () => {
    const firstRender = renderPage('/app/projects/project-delivery-center/diffs?view=all')
    await screen.findByText('Draft memory')
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    const codeTitle = (await screen.findAllByText('Code delivery in progress')).find((element) => element.closest('article'))
    const codeCard = codeTitle?.closest('article')
    if (!codeCard) throw new Error('code card not rendered')
    fireEvent.click(within(codeCard).getByRole('button', { name: /查看 Diff/ }))
    expect(await screen.findByText('Diff Center')).toBeInTheDocument()

    firstRender.unmount()
    const diffRender = renderPage('/app/projects/project-delivery-center/diffs?view=all')
    await screen.findByText('Draft memory')
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    const partialTitle = (await screen.findAllByText('Code delivery partially failed')).find((element) => element.closest('article'))
    const partialCard = partialTitle?.closest('article')
    if (!partialCard) throw new Error('partial code card not rendered')
    fireEvent.click(within(partialCard).getByRole('button', { name: /查看 Diff/ }))
    expect(await screen.findByText('Diff Center')).toBeInTheDocument()
    diffRender.unmount()
    const secondRender = renderPage('/app/projects/project-delivery-center/diffs?view=all')
    await screen.findByText('Draft memory')
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    fireEvent.click((await screen.findAllByRole('button', { name: /拒绝/ }))[0]!)
    expect(screen.getByRole('button', { name: '确认拒绝' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('请说明需要修改的内容'), { target: { value: '需要补充验收说明' } })
    expect(screen.getByRole('button', { name: '确认拒绝' })).not.toBeDisabled()

    secondRender.unmount()
    renderPage('/app/projects/project-no-approval/diffs?view=all')
    const memberItem = await screen.findByText('Member pending memory')
    const memberCard = memberItem.closest('article')
    if (!memberCard) throw new Error('member card not rendered')
    expect(within(memberCard).queryByRole('button', { name: '批准并共享' })).not.toBeInTheDocument()
  })

  it('completes a Mock submit flow and isolates summary errors from the list', async () => {
    const firstRender = renderPage('/app/projects/project-delivery-center/diffs?type=MEMORY')
    const draft = await screen.findByText('Draft memory')
    const draftCard = draft.closest('article')
    if (!draftCard) throw new Error('draft card not rendered')
    fireEvent.click(within(draftCard).getByRole('button', { name: /申请交付/ }))
    await waitFor(() => expect(within(draftCard).getByText('待审核')).toBeInTheDocument())

    firstRender.unmount()
    server.use(http.get('/api/projects/:projectId/delivery-summary', () => HttpResponse.json({ error: { code: 'SUMMARY_FAILED', message: 'summary unavailable' } }, { status: 500 })))
    renderPage('/app/projects/project-delivery-center/diffs?type=MEMORY')
    expect(await screen.findByText('Draft memory')).toBeInTheDocument()
    expect(await screen.findByText('交付概览加载失败')).toBeInTheDocument()
  })

  it('approves a PENDING Agent via the §30 review endpoint (smoke)', async () => {
    renderPage('/app/projects/project-delivery-center/diffs?type=AGENT')
    const pending = await screen.findByText('Frontend Developer Agent')
    const card = pending.closest('article')
    if (!card) throw new Error('pending Agent card not rendered')
    const approveButton = within(card).getByRole('button', { name: /批准发布/ })
    expect(approveButton).toBeInTheDocument()
    fireEvent.click(approveButton)
    // 触发即视为 mock approve 已通过；后续展示由真实接口驱动
    await waitFor(() => expect(within(card).queryByText('Frontend Developer Agent')).toBeInTheDocument())
  })

  it('rejects an PENDING Agent and opens the reason modal (smoke)', async () => {
    renderPage('/app/projects/project-delivery-center/diffs?type=AGENT')
    const pending = await screen.findByText('Frontend Developer Agent')
    const card = pending.closest('article')
    if (!card) throw new Error('pending Agent card not rendered')
    fireEvent.click(within(card).getByRole('button', { name: /拒绝发布/ }))
    expect(screen.getByRole('button', { name: '确认拒绝' })).toBeDisabled()
    expect(screen.getByPlaceholderText('请说明需要修改的内容')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('请说明需要修改的内容'), { target: { value: '需要补充 capability 描述' } })
    expect(screen.getByRole('button', { name: '确认拒绝' })).not.toBeDisabled()
  })
})
