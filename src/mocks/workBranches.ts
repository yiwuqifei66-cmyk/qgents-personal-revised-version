import { http, HttpResponse } from 'msw'
import type { WorkBranch } from '@/types/workBranch'

/** Mock：Qgents 可追溯工作分支（对齐联调草案，非 GitHub 全量分支） */
function mockWorkBranchesFor(projectId: string): WorkBranch[] {
  if (projectId === 'demo-project' || projectId === 'proj-001') {
    return [
      {
        id: `wb-${projectId}-login`,
        projectRepositoryId: 'bound-demo-auth-service',
        name: 'feat/login-api',
        workspaceId: 'workspace-login',
        lastKnownHead: 'a1b2c3d',
        latestTask: {
          id: 'task-login',
          displayCode: 'T-1024',
          title: '登录接口开发',
          finalDiff: { id: `diff-${projectId}-login-api` },
        },
        requirementGroups: [{ id: 'group-login-proj-001', title: '登录功能' }],
        latestDiff: {
          id: `diff-${projectId}-login-api`,
          taskId: 'task-login',
          status: 'PENDING_REVIEW',
          changeStats: { files: 2, additions: 12, deletions: 3 },
        },
        openMergeRequest: {
          id: 'mr-1',
          number: 42,
          status: 'OPEN',
        },
        lastVerification: {
          kind: 'TEST_RUN',
          status: 'PASSED',
          commitSha: 'a1b2c3d',
          completedAt: '2026-08-17T12:00:00Z',
        },
      },
      {
        id: `wb-${projectId}-web-login`,
        projectRepositoryId: 'bound-demo-web-console',
        name: 'feat/login-api',
        workspaceId: 'workspace-web-login',
        lastKnownHead: 'b7c8d9e',
        latestTask: {
          id: 'task-login',
          displayCode: 'T-1024',
          title: '登录接口开发',
          finalDiff: { id: `diff-${projectId}-web-login` },
        },
        requirementGroups: [{ id: 'group-login-proj-001', title: '登录功能' }],
        latestDiff: {
          id: `diff-${projectId}-web-login`,
          taskId: 'task-login',
          status: 'PENDING_REVIEW',
          changeStats: { files: 3, additions: 40, deletions: 2 },
        },
        openMergeRequest: null,
        lastVerification: null,
      },
      {
        id: `wb-${projectId}-pay`,
        projectRepositoryId: 'bound-demo-auth-service',
        name: 'feat/payment-hook',
        workspaceId: 'workspace-pay',
        lastKnownHead: 'c4d5e6f',
        latestTask: {
          id: 'task-pay',
          displayCode: 'T-1028',
          title: '支付回调校验',
          finalDiff: null,
        },
        requirementGroups: [{ id: 'group-pay-proj-001', title: '支付回调' }],
        latestDiff: null,
        openMergeRequest: null,
        lastVerification: {
          kind: 'TEST_RUN',
          status: 'FAILED',
          commitSha: 'oldsha1',
          completedAt: '2026-08-16T08:00:00Z',
        },
      },
    ]
  }
  return []
}

export function createWorkBranchHandlers() {
  return [
    http.get('/api/projects/:projectId/work-branches', ({ params, request }) => {
      const projectId = String(params.projectId)
      const url = new URL(request.url)
      const repositoryId = url.searchParams.get('repositoryId') ?? undefined
      const requirementGroupId = url.searchParams.get('requirementGroupId') ?? undefined
      let rows = mockWorkBranchesFor(projectId)
      if (repositoryId) {
        rows = rows.filter((row) => row.projectRepositoryId === repositoryId)
      }
      if (requirementGroupId) {
        rows = rows.filter((row) =>
          row.requirementGroups.some((group) => group.id === requirementGroupId),
        )
      }
      return HttpResponse.json({
        data: rows,
        page: { nextCursor: null, hasMore: false },
        requestId: 'req_mock_work_branches',
      })
    }),
  ]
}
