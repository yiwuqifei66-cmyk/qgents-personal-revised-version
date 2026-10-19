import { http, HttpResponse } from 'msw'
import { taskModelHandlers } from '../task-model/handlers'
import { agentHandlers } from '../agent/handlers'
import { testsetHandlers } from '../testset/handlers'
import type { GithubOAuthStatus } from '@/types/auth'

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// Mock 鏁版嵁
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

const MOCK_USER = {
  id: 'user-001',
  email: 'demo@qgents.dev',
  displayName: 'Demo User',
  avatarChar: 'D',
}

let MOCK_GITHUB_OAUTH_STATUS: GithubOAuthStatus = {
  authorized: false,
  provider: null,
  githubUserId: null,
  githubLogin: null,
  scopes: [],
  authorizedAt: null,
  lastValidatedAt: null,
  canCreatePublicPersonalRepository: false,
  canCreatePrivatePersonalRepository: false,
  personalRepositorySetup: 'NEED_OAUTH',
  expectedInstallationLogin: null,
}

const MOCK_TEAMS = [
  {
    id: 'team-owned-001',
    name: 'Xinghe Workspace',
    description: 'Qgents demo team',
    createdAt: '2026-06-01T08:00:00Z',
    myRole: 'TEAM_OWNER' as const,
    memberCount: 5,
  },
  {
    id: 'team-joined-001',
    name: '骞垮伐鍒涙柊鍥㈤槦',
    description: '鏍″洯鎶€鏈洟闃燂紝AI 涓?Web 鏂瑰悜',
    createdAt: '2026-05-15T08:00:00Z',
    myRole: 'TEAM_MEMBER' as const,
    memberCount: 8,
  },
]

const MOCK_TEAM_MEMBERS = [
  { userId: 'user-001', displayName: 'Demo User', email: 'demo@qgents.dev', role: 'TEAM_OWNER' as const },
  { userId: 'user-002', displayName: '寮犲伐', email: 'zhang@example.com', role: 'TEAM_MEMBER' as const },
  { userId: 'user-003', displayName: 'Li Designer', email: 'li@example.com', role: 'TEAM_MEMBER' as const },
  { userId: 'user-004', displayName: 'Wang Tester', email: 'wang@example.com', role: 'TEAM_MEMBER' as const },
  { userId: 'user-005', displayName: 'Zhao Builder', email: 'zhao@example.com', role: 'TEAM_MEMBER' as const },
]

const MOCK_PROJECTS: Record<string, Array<{ id: string; teamId: string; name: string; description: string; createdAt: string; myRole: 'PROJECT_ADMIN' | 'PROJECT_MEMBER'; repositoryCount: number }>> = {
  'team-owned-001': [
    { id: 'demo-project', teamId: 'team-owned-001', name: 'Demo Project', description: 'Demo project for Mock acceptance', createdAt: '2026-08-13T00:00:00Z', myRole: 'PROJECT_ADMIN', repositoryCount: 1 },
    { id: 'proj-001', teamId: 'team-owned-001', name: 'Qgents', description: 'Agent collaboration project', createdAt: '2026-07-01T08:00:00Z', myRole: 'PROJECT_ADMIN', repositoryCount: 3 },
    { id: 'proj-002', teamId: 'team-owned-001', name: 'Pet Health', description: 'Pet health management', createdAt: '2026-07-15T08:00:00Z', myRole: 'PROJECT_ADMIN', repositoryCount: 1 },
  ],
  'team-joined-001': [
    { id: 'proj-003', teamId: 'team-joined-001', name: 'Decision System', description: 'Course recommendation system', createdAt: '2026-06-10T08:00:00Z', myRole: 'PROJECT_MEMBER', repositoryCount: 2 },
    { id: 'proj-004', teamId: 'team-joined-001', name: 'Campus Assistant', description: 'Unified campus query service', createdAt: '2026-08-01T08:00:00Z', myRole: 'PROJECT_MEMBER', repositoryCount: 1 },
  ],
}

let nextTeamId = 10
let nextProjectId = 10

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// Auth锛堝凡鏈夛級
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

const handlers: ReturnType<typeof http.get>[] = [
  // 鈹€鈹€ health 鈹€鈹€
  http.get('/api/health', () => HttpResponse.json({ status: 'ok', source: 'msw' })),

  // 鈹€鈹€ Auth 鈹€鈹€
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string }
    if (!body.email?.includes('@')) {
      return HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }, { status: 401 })
    }
    return HttpResponse.json({
      data: {
        accessToken: 'mock-access-token-' + Date.now(),
        accessTokenExpiresIn: 900,
        refreshToken: 'mock-refresh-token-' + Date.now(),
        refreshTokenExpiresIn: 2592000,
        user: { ...MOCK_USER, email: body.email },
      },
    })
  }),

  http.post('/api/auth/register', async ({ request }) => {
    const body = (await request.json()) as { email?: string; displayName?: string }
    if (!body.email?.includes('@')) {
      return HttpResponse.json({ error: { code: 'INVALID_INPUT', message: 'Invalid input' } }, { status: 400 })
    }
    return HttpResponse.json({
      data: {
        accessToken: 'mock-access-token-' + Date.now(),
        accessTokenExpiresIn: 900,
        refreshToken: 'mock-refresh-token-' + Date.now(),
        refreshTokenExpiresIn: 2592000,
        user: { id: 'user-' + Date.now(), email: body.email!, displayName: body.displayName || body.email!.split('@')[0], avatarChar: (body.displayName || 'U')[0] },
      },
    })
  }),

  http.get('/api/me', () => HttpResponse.json({ data: MOCK_USER })),

  // ── 个人 GitHub OAuth（§49）──
  http.post('/api/me/integrations/github/oauth/start', () =>
    HttpResponse.json({
      data: {
        authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=mock&scope=repo&state=mock-state',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
      requestId: 'mock-github-oauth-start',
    }),
  ),

  http.get('/api/integrations/github/oauth/callback', ({ request }) => {
    const url = new URL(request.url)
    if (url.searchParams.get('error')) {
      return HttpResponse.redirect('/app/settings/integrations/github?githubOAuth=failed&code=GITHUB_OAUTH_CALLBACK_DENIED')
    }
    MOCK_GITHUB_OAUTH_STATUS = {
      authorized: true,
      provider: 'GITHUB',
      githubUserId: 12345678,
      githubLogin: 'qgents-demo',
      scopes: ['repo'],
      authorizedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      canCreatePublicPersonalRepository: true,
      canCreatePrivatePersonalRepository: true,
      personalRepositorySetup: 'READY',
      expectedInstallationLogin: null,
    }
    return HttpResponse.redirect('/app/settings/integrations/github?githubOAuth=authorized')
  }),

  http.get('/api/me/integrations/github/oauth', () =>
    HttpResponse.json({ data: MOCK_GITHUB_OAUTH_STATUS, requestId: 'mock-github-oauth-status' }),
  ),

  http.delete('/api/me/integrations/github/oauth', () => {
    MOCK_GITHUB_OAUTH_STATUS = {
      authorized: false,
      provider: null,
      githubUserId: null,
      githubLogin: null,
      scopes: [],
      authorizedAt: null,
      lastValidatedAt: null,
      canCreatePublicPersonalRepository: false,
      canCreatePrivatePersonalRepository: false,
      personalRepositorySetup: 'NEED_OAUTH',
      expectedInstallationLogin: null,
    }
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/auth/logout', () => HttpResponse.json({ data: null })),

  // 鈹€鈹€ Teams 鈹€鈹€

  /** GET /api/teams */
  http.get('/api/teams', () => HttpResponse.json({ data: MOCK_TEAMS })),

  /** POST /api/teams */
  http.post('/api/teams', async ({ request }) => {
    const body = (await request.json()) as { name?: string; description?: string }
    const newTeam = {
      id: 'team-new-' + nextTeamId++,
      name: body.name || 'Unnamed team',
      description: body.description || '',
      createdAt: new Date().toISOString(),
      myRole: 'TEAM_OWNER' as const,
      memberCount: 1,
    }
    return HttpResponse.json({ data: newTeam }, { status: 201 })
  }),

  /** GET /api/teams/:teamId */
  http.get('/api/teams/:teamId', ({ params }) => {
    const team = MOCK_TEAMS.find((t) => t.id === params.teamId)
    if (!team) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Team not found' } }, { status: 404 })
    return HttpResponse.json({ data: team })
  }),

  /** PATCH /api/teams/:teamId */
  http.patch('/api/teams/:teamId', async ({ params, request }) => {
    const body = (await request.json()) as { name?: string; description?: string }
    const team = MOCK_TEAMS.find((t) => t.id === params.teamId)
    if (!team) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Team not found' } }, { status: 404 })
    return HttpResponse.json({ data: { ...team, ...body } })
  }),

  /** GET /api/teams/:teamId/members */
  http.get('/api/teams/:teamId/members', ({ params }) => {
    // 鎵€鏈?Mock 鍥㈤槦杩斿洖鍚屼竴缁勬垚鍛樺垪琛?
    const members = params.teamId === 'team-joined-001'
      ? MOCK_TEAM_MEMBERS.map((m) => (m.userId === 'user-001' ? { ...m, role: 'TEAM_MEMBER' as const } : m))
      : MOCK_TEAM_MEMBERS
    return HttpResponse.json({ data: members })
  }),

  /** POST /api/teams/:teamId/invitations */
  http.post('/api/teams/:teamId/invitations', async ({ request }) => {
    const body = (await request.json()) as { email?: string; role?: string }
    return HttpResponse.json({
      data: { id: 'inv-' + Date.now(), email: body.email || '', role: body.role || 'TEAM_MEMBER', status: 'PENDING', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
    }, { status: 201 })
  }),

  /** GET /api/teams/:teamId/invitations */
  http.get('/api/teams/:teamId/invitations', () => HttpResponse.json({ data: [] })),

  /** POST /api/team-invitations/:token/accept */
  http.post('/api/team-invitations/:token/accept', ({ params: _params }) =>
    HttpResponse.json({ data: { teamId: 'team-joined-001', teamName: '骞垮伐鍒涙柊鍥㈤槦' } }),
  ),

  // 鈹€鈹€ Projects 鈹€鈹€

  /** GET /api/teams/:teamId/projects */
  http.get('/api/teams/:teamId/projects', ({ params }) => {
    const projects = MOCK_PROJECTS[params.teamId as string] || []
    return HttpResponse.json({ data: projects })
  }),

  /** POST /api/teams/:teamId/projects */
  http.post('/api/teams/:teamId/projects', async ({ params, request }) => {
    const body = (await request.json()) as { name?: string; description?: string; newRepository?: { name?: string } }
    // 演示后端 §49.7 稳定错误码：OAuth 建仓成功但 GitHub App 暂不可见该仓库
    if (body.newRepository?.name?.includes('__unauthorized__')) {
      return HttpResponse.json(
        {
          error: {
            code: 'GITHUB_REPOSITORY_NOT_AUTHORIZED',
            message: 'Repository created but not visible to the GitHub App',
          },
        },
        { status: 403 },
      )
    }
    // 演示 OAuth scope 不足（§49.7 GITHUB_OAUTH_SCOPE_INSUFFICIENT）
    if (body.newRepository?.name?.includes('__scope__')) {
      return HttpResponse.json(
        {
          error: {
            code: 'GITHUB_OAUTH_SCOPE_INSUFFICIENT',
            message: 'Insufficient OAuth scope for the requested repository type',
          },
        },
        { status: 403 },
      )
    }
    const newProject = {
      id: 'proj-new-' + nextProjectId++,
      teamId: params.teamId as string,
      name: body.name || 'Unnamed project',
      description: body.description || '',
      createdAt: new Date().toISOString(),
      myRole: 'PROJECT_ADMIN' as const,
      repositoryCount: 0,
    }
    return HttpResponse.json({ data: newProject }, { status: 201 })
  }),

  /** GET /api/projects/:projectId */
  http.get('/api/projects/:projectId', ({ params }) => {
    for (const list of Object.values(MOCK_PROJECTS)) {
      const proj = list.find((p) => p.id === params.projectId)
      if (proj) return HttpResponse.json({ data: proj })
    }
    return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, { status: 404 })
  }),

  /** GET /api/projects/:projectId/groups: project shell needs this list for its navigation */
  http.get('/api/projects/:projectId/groups', () => HttpResponse.json({ data: [] })),

  /** GET /api/projects/:projectId/members */
  http.get('/api/projects/:projectId/members', () =>
    HttpResponse.json({
      data: [
        { userId: 'user-001', displayName: 'Demo User', email: 'demo@qgents.dev', role: 'PROJECT_ADMIN' },
        { userId: 'user-002', displayName: 'Zhang Builder', email: 'zhang@example.com', role: 'PROJECT_MEMBER' },
      ],
    }),
  ),

  /** POST /api/projects/:projectId/members */
  http.post('/api/projects/:projectId/members', () => HttpResponse.json({ data: null }, { status: 201 })),

  /** POST /api/projects/:projectId/archive */
  http.post('/api/projects/:projectId/archive', () => HttpResponse.json({ data: null })),

  /** POST /api/projects/:projectId/restore */
  http.post('/api/projects/:projectId/restore', () => HttpResponse.json({ data: null })),
  // B domain: Task model and Agent
  // 鈹€鈹€ B 鐨勪换鍔″煙锛坱ask-domain + agent锛夆攢鈹€
  ...taskModelHandlers,
  ...agentHandlers,
  ...testsetHandlers,
]

export { handlers }
