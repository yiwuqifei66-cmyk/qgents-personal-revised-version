import { http, HttpResponse } from 'msw'
import type { GithubAuthorizedRepository, GithubInstallation } from '@/types/github'
import type { GithubOAuthStatus } from '@/types/auth'
import type { Group, GroupMember, Message } from '@/types/group'
import type { Activity, Memory, Notification, MyTeamInvitation } from '@/types'
import { MOCK_CURRENT_USER } from './currentUser'
import { deliveryCenterHandlers } from './delivery-center/handlers'
import { createTaskFromMessageIntent, findTaskByTriggerMessageId } from './task-model/handlers'
import { createWorkBranchHandlers } from './workBranches'

/**
 * 自动建任务从消息中提取可读正文。QUOTE 的 content 是结构化引用元数据，不能
 * stringify 后作为任务标题；优先使用为任务准备的 content.text，再兼容顶层 replyText。
 */
function messageTextForTask(content: unknown, replyText?: string): string {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const value = content as Record<string, unknown>
    if (typeof value.text === 'string' && value.text.trim()) return value.text.trim()
    if (typeof value.replyText === 'string' && value.replyText.trim()) return value.replyText.trim()
  }
  return typeof replyText === 'string' ? replyText.trim() : ''
}

// ══════════════════════════════════════════════
// Mock 数据
// ══════════════════════════════════════════════

const MOCK_USER: { id: string; email: string; displayName: string; avatarChar: string; avatarUrl?: string } = {
  ...MOCK_CURRENT_USER,
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

// 项目设置（需求群规则）默认值，对齐 §22.2
const DEFAULT_PROJECT_SETTINGS = {
  allowCreateGroup: true,
  autoArchiveGroup: false,
  allowAgentTrigger: true,
  autoJoinAllGroups: false,
}
const MOCK_PROJECT_SETTINGS: Record<string, typeof DEFAULT_PROJECT_SETTINGS> = {}

/** 注册验证码（§11）：email → 一次性 6 位码；mock 演示固定 483920，真实环境由邮件送达 */
const registerCodeByEmail = new Map<string, string>()

const MOCK_TEAMS = [
  {
    id: 'team-owned-001',
    name: '星河工作室',
    description: '全栈开发团队，专注内部工具与开源项目',
    createdAt: '2026-06-01T08:00:00Z',
    role: 'TEAM_OWNER' as const,
    memberCount: 5,
    avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=星河工作室',
  },
  {
    id: 'team-joined-001',
    name: '广工创新团队',
    description: '校园技术团队，AI 与 Web 方向',
    createdAt: '2026-05-15T08:00:00Z',
    role: 'TEAM_MEMBER' as const,
    memberCount: 8,
  },
]

const MOCK_TEAM_MEMBERS = [
  { userId: 'user-001', displayName: '陈同学', email: 'demo@qgents.dev', role: 'TEAM_OWNER' as const, avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=陈同学' },
  { userId: 'user-002', displayName: '张工', email: 'zhang@example.com', role: 'TEAM_MEMBER' as const, avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=张工' },
  { userId: 'user-003', displayName: '李设计', email: 'li@example.com', role: 'TEAM_MEMBER' as const, avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=李设计' },
  { userId: 'user-004', displayName: '王测试', email: 'wang@example.com', role: 'TEAM_MEMBER' as const, avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=王测试' },
  { userId: 'user-005', displayName: '赵架构', email: 'zhao@example.com', role: 'TEAM_MEMBER' as const, avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=赵架构' },
]

const MOCK_PROJECTS: Record<string, Array<{ id: string; teamId: string; name: string; description: string; createdAt: string; role: 'PROJECT_ADMIN' | 'PROJECT_MEMBER'; repositoryCount: number; memberCount?: number; status?: 'ACTIVE' | 'ARCHIVED' }>> = {
  'team-owned-001': [
    { id: 'demo-project', teamId: 'team-owned-001', name: 'Demo Project', description: 'Demo project for Mock acceptance', createdAt: '2026-08-13T00:00:00Z', role: 'PROJECT_ADMIN', repositoryCount: 1, memberCount: 2, status: 'ACTIVE' },
    { id: 'proj-001', teamId: 'team-owned-001', name: 'Qgents', description: '团队多人 + 多 Agent 云端协作开发平台', createdAt: '2026-07-01T08:00:00Z', role: 'PROJECT_ADMIN', repositoryCount: 3, memberCount: 5, status: 'ACTIVE' },
    { id: 'proj-002', teamId: 'team-owned-001', name: '宠影记', description: '宠物健康管理小程序', createdAt: '2026-07-15T08:00:00Z', role: 'PROJECT_ADMIN', repositoryCount: 1, memberCount: 4, status: 'ACTIVE' },
  ],
  'team-joined-001': [
    { id: 'proj-003', teamId: 'team-joined-001', name: 'AI 决策系统', description: '校园选课推荐与学业规划', createdAt: '2026-06-10T08:00:00Z', role: 'PROJECT_MEMBER', repositoryCount: 2, memberCount: 6, status: 'ACTIVE' },
    { id: 'proj-004', teamId: 'team-joined-001', name: '校园助手', description: '课表、成绩、图书馆一站式查询', createdAt: '2026-08-01T08:00:00Z', role: 'PROJECT_MEMBER', repositoryCount: 1, memberCount: 3, status: 'ARCHIVED' },
  ],
}

let nextTeamId = 10
let nextProjectId = 10

// 当前用户收到的待处理团队邀请（演示用样例，对齐后端1对接文档：无 token）
const MOCK_MY_INVITATIONS: MyTeamInvitation[] = [
  {
    id: 'my-inv-001',
    teamId: 'team-joined-001',
    teamName: '广工创新团队',
    role: 'TEAM_MEMBER',
    inviterDisplayName: '陈同学',
    status: 'PENDING',
    expiresAt: '2026-08-21T00:00:00Z',
    createdAt: '2026-08-14T10:00:00Z',
  },
]

// ══════════════════════════════════════════════
// 群聊（Group / Message）Mock 数据 —— 对齐接口文档 v1.1.8 §7
// ══════════════════════════════════════════════

const MOCK_GROUPS: Record<string, Group[]> = {
  'proj-001': [
    {
      id: 'group-main-proj-001',
      projectId: 'proj-001',
      type: 'PROJECT_MAIN',
      title: '项目总群',
      description: '项目级讨论与结构化动态',
      status: 'ACTIVE',
      latestActivityAt: '2026-08-12T10:05:00Z',
      unreadCount: 0,
      isPinned: true,
      isArchived: false,
    },
    {
      id: 'group-login-proj-001',
      projectId: 'proj-001',
      type: 'REQUIREMENT',
      title: '登录功能',
      description: '账号与登录体验',
      status: 'ACTIVE',
      createdBy: 'user-001',
      latestActivityAt: '2026-08-12T10:03:00Z',
      unreadCount: 2,
      // 有 @ 当前用户（user-001）的未读消息 → 侧栏「有人@你」角标
      mentionedUnread: 1,
      isPinned: true,
      isArchived: false,
    },
    {
      id: 'group-pay-proj-001',
      projectId: 'proj-001',
      type: 'REQUIREMENT',
      title: '支付回调',
      description: '支付回调与对账',
      status: 'ACTIVE',
      createdBy: 'user-001',
      latestActivityAt: '2026-08-11T18:00:00Z',
      unreadCount: 0,
      isPinned: false,
      isArchived: false,
    },
    {
      id: 'group-home-proj-001',
      projectId: 'proj-001',
      type: 'REQUIREMENT',
      title: '首页改版',
      description: '旧版首页重构，已完成并归档',
      status: 'ARCHIVED',
      createdBy: 'user-002',
      latestActivityAt: '2026-08-01T09:00:00Z',
      unreadCount: 0,
      isPinned: false,
      isArchived: true,
    },
  ],
}

const MOCK_MESSAGES: Record<string, Message[]> = {
  'group-main-proj-001': [
    {
      id: 'msg-main-001',
      groupId: 'group-main-proj-001',
      type: 'TEXT',
      content: { text: '欢迎来到 Qgents 项目总群。需求讨论请到对应需求群。' },
      senderType: 'SYSTEM',
      sequence: 1,
      createdAt: '2026-08-12T09:00:00Z',
      replyToId: null,
    },
    {
      id: 'msg-main-002',
      groupId: 'group-main-proj-001',
      type: 'TEXT',
      content: { text: '登录功能的需求群已经建好了，大家进去领一下。' },
      senderType: 'USER',
      senderId: 'user-001',
      senderName: '陈同学',
      sequence: 2,
      createdAt: '2026-08-12T09:30:00Z',
      replyToId: null,
    },
  ],
  'group-login-proj-001': [
    {
      id: 'msg-login-001',
      groupId: 'group-login-proj-001',
      type: 'TEXT',
      content: { text: '登录接口需要支持邮箱和密码两种方式。' },
      senderType: 'USER',
      senderId: 'user-001',
      senderName: '陈同学',
      sequence: 1,
      createdAt: '2026-08-12T10:00:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-002',
      groupId: 'group-login-proj-001',
      type: 'CODE',
      content: {
        code: 'POST /auth/login\n{ "email": "...", "password": "..." }',
        language: 'http',
      },
      senderType: 'AGENT',
      senderId: 'agent-orchestrator',
      senderName: 'AgentOrchestrator',
      sequence: 2,
      createdAt: '2026-08-12T10:01:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-003',
      groupId: 'group-login-proj-001',
      type: 'TEXT',
      content: { text: '好的，我按接口文档实现，完成后给出 Diff。' },
      senderType: 'AGENT',
      senderId: 'agent-orchestrator',
      senderName: 'AgentOrchestrator',
      sequence: 3,
      createdAt: '2026-08-12T10:02:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-004',
      groupId: 'group-login-proj-001',
      type: 'TEXT',
      content: { text: '密码要用 RSA 加密后传输，别发明文。' },
      senderType: 'USER',
      senderId: 'user-002',
      senderName: '张工',
      sequence: 4,
      createdAt: '2026-08-12T10:03:00Z',
      replyToId: null,
    },
    // ── 演示用样例：验证多类型消息渲染（content 结构对齐「A-联调约定」第三节）──
    {
      id: 'msg-login-005',
      groupId: 'group-login-proj-001',
      type: 'IMAGE',
      content: {
        url: 'https://picsum.photos/seed/qgents/400/240',
        width: 400,
        height: 240,
      },
      senderType: 'USER',
      senderId: 'user-002',
      senderName: '张工',
      sequence: 5,
      createdAt: '2026-08-12T10:10:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-006',
      groupId: 'group-login-proj-001',
      type: 'FILE',
      content: {
        url: 'https://example.com/files/api-design.pdf',
        name: '登录接口设计.pdf',
        size: 524288,
        mimeType: 'application/pdf',
      },
      senderType: 'USER',
      senderId: 'user-001',
      senderName: '陈同学',
      sequence: 6,
      createdAt: '2026-08-12T10:12:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-007',
      groupId: 'group-login-proj-001',
      type: 'QUOTE',
      content: {
        quotedMessageId: 'msg-login-004',
        quotedText: '密码要用 RSA 加密后传输，别发明文。',
        quotedSenderName: '张工',
      },
      replyText: '收到，我会在注册/登录链路统一走 RSA 加密。',
      senderType: 'AGENT',
      senderId: 'agent-developer',
      senderName: 'Developer',
      sequence: 7,
      createdAt: '2026-08-12T10:15:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-008',
      groupId: 'group-login-proj-001',
      type: 'DIFF',
      content: {
        taskId: 'task-001',
        diffId: 'diff-001',
        reviewBatchId: 'review-task-001',
        displayCode: 'D-1024',
        repositoryName: 'auth-service',
        sourceBranch: 'feat/login-api',
        targetBranch: 'main',
        title: '实现邮箱登录',
        additions: 128,
        deletions: 12,
        files: [
          'api/v1/auth/login.py',
          'backend/services/auth_service.py',
          'tests/test_login.py',
          'docs/login-legacy.md',
        ],
        reviewStatus: 'PENDING_CONFIRMATION',
        deliveryStatus: 'NOT_STARTED',
      },
      senderType: 'AGENT',
      senderId: 'agent-developer',
      senderName: 'Developer',
      sequence: 8,
      createdAt: '2026-08-12T10:30:00Z',
      replyToId: null,
    },
    {
      id: 'msg-login-009',
      groupId: 'group-login-proj-001',
      type: 'TASK_STATUS',
      content: {
        taskId: 'task-001',
        status: 'SUCCEEDED',
        phase: 'CODING',
        deliveryMode: 'DIFF_FIRST',
        deliveryReason: '小范围单仓库修改',
        message: '正在执行代码修改',
        currentStepId: 'step-002',
        repositoryMappings: [
          { workspacePath: 'auth-service', repositoryId: 'project-repository-auth-service' },
          { workspacePath: 'web-console', repositoryId: 'project-repository-web-console' },
        ],
        plan: {
          summary: '修复需求群权限过滤和 Agent 回群校验',
          steps: [
            { stepId: 'step-001', sequence: 1, title: '分析现有群权限逻辑', role: 'REVIEWER', status: 'SUCCEEDED', message: '已完成权限链路检查' },
            { stepId: 'step-002', sequence: 2, title: '修改群列表和上下文过滤', role: 'CODER', status: 'RUNNING', message: '正在修改实现' },
            { stepId: 'step-003', sequence: 3, title: '执行测试并审查修改', role: 'TESTER', status: 'PENDING', message: null },
          ],
        },
      },
      senderType: 'SYSTEM',
      sequence: 9,
      createdAt: '2026-08-12T10:35:00Z',
      replyToId: null,
    },
    {
      // 演示「有人@你」：张工 @ 了当前用户（user-001）
      id: 'msg-login-010',
      groupId: 'group-login-proj-001',
      type: 'TEXT',
      content: { text: '@陈同学 登录接口的校验逻辑麻烦确认一下' },
      senderType: 'USER',
      senderId: 'user-002',
      senderName: '张工',
      sequence: 10,
      createdAt: '2026-08-12T10:40:00Z',
      replyToId: null,
      mentions: [{ type: 'USER', id: 'user-001' }],
    },
  ],
}

// ══════════════════════════════════════════════
// 群成员数据 —— 对齐接口文档 v1.1.8 §7「群成员 = 项目成员 + 群内 Agent」
// ══════════════════════════════════════════════

interface MockProjectMember {
  userId: string
  displayName: string
  email: string
  role: 'PROJECT_ADMIN' | 'PROJECT_MEMBER'
  avatarUrl?: string
}

// 项目成员（按项目隔离，作为群 USER 成员来源；同时供 GET /projects/:id/members 复用）
const MOCK_PROJECT_MEMBERS: Record<string, MockProjectMember[]> = {
  'proj-001': [
    { userId: 'user-001', displayName: '陈同学', email: 'demo@qgents.dev', role: 'PROJECT_ADMIN', avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=陈同学' },
    { userId: 'user-002', displayName: '张工', email: 'zhang@example.com', role: 'PROJECT_MEMBER', avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=张工' },
    { userId: 'user-003', displayName: '李设计', email: 'li@example.com', role: 'PROJECT_MEMBER', avatarUrl: 'https://api.dicebear.com/9.x/initials/svg?seed=李设计' },
  ],
}

// 每个群参与的 Agent（按群隔离：不同需求触发不同 Agent 回群）
const MOCK_GROUP_AGENTS: Record<string, GroupMember[]> = {
  'group-main-proj-001': [
    { id: 'agent-orchestrator', displayName: 'AgentOrchestrator', memberType: 'AGENT' },
  ],
  'group-login-proj-001': [
    { id: 'agent-orchestrator', displayName: 'AgentOrchestrator', memberType: 'AGENT' },
    { id: 'agent-planner', displayName: 'Planner', memberType: 'AGENT' },
    { id: 'agent-developer', displayName: 'Developer', memberType: 'AGENT' },
    { id: 'agent-tester', displayName: 'Tester', memberType: 'AGENT' },
    { id: 'agent-reviewer', displayName: 'Reviewer', memberType: 'AGENT' },
  ],
  'group-pay-proj-001': [
    { id: 'agent-orchestrator', displayName: 'AgentOrchestrator', memberType: 'AGENT' },
    { id: 'agent-developer', displayName: 'Developer', memberType: 'AGENT' },
  ],
}

// 每个群的 USER 成员（groupId → 项目成员 userId[]）：
// 存量群默认 = 全部项目成员（保持旧行为）；新建群 = [创建者, ...建群时选择的 memberIds]
const MOCK_GROUP_USER_MEMBERS: Record<string, string[]> = {}
function seedGroupUserMembers(projectId: string, groupId: string): void {
  if (MOCK_GROUP_USER_MEMBERS[groupId]) return
  MOCK_GROUP_USER_MEMBERS[groupId] = (MOCK_PROJECT_MEMBERS[projectId] ?? []).map((m) => m.userId)
}
for (const [projectId, groups] of Object.entries(MOCK_GROUPS)) {
  for (const group of groups) seedGroupUserMembers(projectId, group.id)
}

// 群成员 = 该群 USER 成员（含 email）+ 该群参与的 Agent；memberCount 与此函数保持一致
function getGroupMembers(projectId: string, groupId: string): GroupMember[] {
  seedGroupUserMembers(projectId, groupId)
  const membersById = new Map((MOCK_PROJECT_MEMBERS[projectId] ?? []).map((m) => [m.userId, m]))
  const users: GroupMember[] = (MOCK_GROUP_USER_MEMBERS[groupId] ?? [])
    .map((userId) => membersById.get(userId))
    .filter((m): m is MockProjectMember => Boolean(m))
    .map((m): GroupMember => ({ id: m.userId, displayName: m.displayName, email: m.email, avatarUrl: m.avatarUrl, memberType: 'USER' }))
  return [...users, ...(MOCK_GROUP_AGENTS[groupId] ?? [])]
}

// 最新消息摘要（会话列表展示用）：从 MOCK_MESSAGES 取该群最后一条消息，与消息列表保持一致
function getLatestMessageSummary(groupId: string): Group['latestMessage'] {
  const msgs = MOCK_MESSAGES[groupId] ?? []
  const last = msgs[msgs.length - 1]
  if (!last) return undefined
  const text =
    last.type === 'CODE'
      ? ((last.content as { code?: string }).code ?? '').split('\n')[0]
      : (last.content as { text?: string }).text ?? ''
  return { senderName: last.senderName, text }
}

// ══════════════════════════════════════════════
// 通知中心 Mock 数据 —— 对齐分工安排「通知中心」（本轮前端 Mock）
// ══════════════════════════════════════════════

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-1',
    kind: 'TASK_COMPLETED',
    title: '登录功能任务已完成',
    description: 'Agent 已完成「实现邮箱登录」，Diff 待你验收',
    isRead: false,
    createdAt: '2026-08-13T01:00:00Z',
    projectId: 'proj-001',
    groupId: 'group-login-proj-001',
    resourceId: 'task-001',
  },
  {
    id: 'notif-2',
    kind: 'AGENT_INPUT_REQUIRED',
    title: 'Agent 需要你补充信息',
    description: 'Developer 在「支付回调」任务中请求补充验收说明',
    isRead: false,
    createdAt: '2026-08-13T00:40:00Z',
    projectId: 'proj-001',
    groupId: 'group-pay-proj-001',
    resourceId: 'task-002',
  },
  {
    id: 'notif-3',
    kind: 'MR_PENDING',
    title: 'MR 待处理',
    description: 'feature/login-api 已提交，等待质量门禁与合并',
    isRead: false,
    createdAt: '2026-08-12T23:30:00Z',
    projectId: 'proj-001',
    resourceId: 'mr-001',
  },
  {
    id: 'notif-4',
    kind: 'TASK_FAILED',
    title: '测试任务失败',
    description: 'Tester 在「登录功能」中报告测试未通过',
    isRead: true,
    createdAt: '2026-08-12T22:10:00Z',
    projectId: 'proj-001',
    groupId: 'group-login-proj-001',
    resourceId: 'task-003',
  },
  {
    id: 'notif-5',
    kind: 'DELIVERABLE_PENDING',
    title: '交付物待验收',
    description: '「登录功能」产出代码交付物，请验收',
    isRead: true,
    createdAt: '2026-08-12T21:00:00Z',
    projectId: 'proj-001',
    groupId: 'group-login-proj-001',
    resourceId: 'task-001',
  },
  {
    id: 'notif-6',
    kind: 'MESSAGE_MENTION',
    title: '张工在「登录功能」群里 @ 了你',
    description: '登录接口的校验逻辑麻烦确认一下',
    isRead: false,
    createdAt: '2026-08-12T10:41:00Z',
    projectId: 'proj-001',
    groupId: 'group-login-proj-001',
    resourceId: 'msg-login-010',
  },
]

// ══════════════════════════════════════════════
// 团队最近动态（演示用样例，对齐「前端待接接口清单.md」的 activities 接口设计）
// ══════════════════════════════════════════════

const MOCK_ACTIVITIES: Activity[] = [
  {
    id: 'act-002',
    type: 'TASK_COMPLETED',
    title: '任务「实现登录功能」已完成',
    summary: null,
    actor: { id: 'agent-developer', displayName: 'Developer' },
    target: { type: 'TASK', id: 'task-001', title: '实现登录功能' },
    createdAt: '2026-08-14T08:30:00Z',
  },
  {
    id: 'act-003',
    type: 'MR_CREATED',
    title: '登录功能 MR #42 已创建',
    summary: null,
    actor: { id: 'agent-developer', displayName: 'Developer' },
    target: { type: 'MR', id: 'mr-001', title: '#42 登录功能' },
    createdAt: '2026-08-14T08:00:00Z',
  },
  {
    id: 'act-005',
    type: 'TEST_RUN_FAILED',
    title: '测试运行失败',
    summary: null,
    actor: null,
    target: { type: 'PROJECT', id: 'proj-001', title: 'Qgents Web' },
    createdAt: '2026-08-13T18:00:00Z',
  },
]

// ══════════════════════════════════════════════
// 共享 Memory Mock 数据 —— 对齐接口文档 v1.1.8 §9
// ══════════════════════════════════════════════

let nextMemoryId = 100
const MOCK_MEMORIES: Record<string, Memory[]> = {
  'proj-001': [
    {
      id: 'mem-1',
      projectId: 'proj-001',
      title: '密码存储约定',
      content: '密码仅存储 bcrypt 哈希，登录时使用 bcrypt.compare 校验，不得明文存储或日志输出。',
      category: 'ENGINEERING_DECISION',
      tags: ['auth', 'security'],
      status: 'APPROVED',
      source: 'MESSAGE',
      sources: [{ groupId: 'group-login-proj-001', messageId: 'msg-login-004' }],
      creator: { id: 'user-001', displayName: '陈同学' },
      reviewer: { id: 'user-002', displayName: '张工' },
      reviewedAt: '2026-08-12T11:00:00Z',
      createdAt: '2026-08-12T10:30:00Z',
      updatedAt: '2026-08-12T11:00:00Z',
    },
    {
      id: 'mem-2',
      projectId: 'proj-001',
      title: 'API 响应统一信封',
      content: '所有接口统一返回 { data, requestId }，错误返回 { error, requestId }，前端 client.ts 已按此解包。',
      category: 'ENGINEERING_DECISION',
      tags: ['api', 'convention'],
      status: 'APPROVED',
      source: 'MANUAL',
      sources: [],
      creator: { id: 'user-001', displayName: '陈同学' },
      reviewer: { id: 'user-002', displayName: '张工' },
      reviewedAt: '2026-08-11T15:00:00Z',
      createdAt: '2026-08-11T14:00:00Z',
      updatedAt: '2026-08-11T15:00:00Z',
    },
    {
      id: 'mem-3',
      projectId: 'proj-001',
      title: '支付回调幂等处理',
      content: '支付回调需带 Idempotency-Key，重复通知返回首次结果，避免重复入账。',
      category: 'ENGINEERING_DECISION',
      tags: ['pay', 'idempotency'],
      status: 'PENDING_REVIEW',
      source: 'MESSAGE',
      sources: [{ groupId: 'group-pay-proj-001', messageId: 'msg-pay-001' }],
      creator: { id: 'user-002', displayName: '张工' },
      reviewer: null,
      reviewedAt: null,
      createdAt: '2026-08-13T00:30:00Z',
      updatedAt: '2026-08-13T00:30:00Z',
    },
    {
      id: 'mem-4',
      projectId: 'proj-001',
      title: '登录错误码约定',
      content: '登录失败统一返回 401 + INVALID_CREDENTIALS，不区分"用户不存在"和"密码错误"以免泄露账号信息。',
      category: 'ENGINEERING_DECISION',
      tags: ['auth'],
      status: 'DRAFT',
      source: 'MANUAL',
      sources: [],
      creator: { id: 'user-001', displayName: '陈同学' },
      reviewer: null,
      reviewedAt: null,
      createdAt: '2026-08-13T01:00:00Z',
      updatedAt: '2026-08-13T01:00:00Z',
    },
    {
      id: 'mem-5',
      projectId: 'proj-001',
      title: '旧版 token 存储方案',
      content: '早期曾讨论将 token 存 cookie，后废弃改用 localStorage + Bearer 头。',
      category: 'DEPRECATED',
      tags: ['auth'],
      status: 'REJECTED',
      source: 'MANUAL',
      sources: [],
      creator: { id: 'user-003', displayName: '李设计' },
      reviewer: { id: 'user-002', displayName: '张工' },
      reviewedAt: '2026-08-10T10:00:00Z',
      createdAt: '2026-08-10T09:00:00Z',
      updatedAt: '2026-08-10T10:00:00Z',
    },
    {
      id: 'mem-6',
      projectId: 'proj-001',
      title: '初版部署流程',
      content: '旧版手工部署流程，已被自动化 CI 取代，归档留存。',
      category: 'PROCESS',
      tags: ['deploy'],
      status: 'ARCHIVED',
      source: 'MANUAL',
      sources: [],
      creator: { id: 'user-001', displayName: '陈同学' },
      reviewer: { id: 'user-002', displayName: '张工' },
      reviewedAt: '2026-07-20T12:00:00Z',
      createdAt: '2026-07-20T11:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
  ],
}

// ══════════════════════════════════════════════
// GitHub 集成 Mock 数据
// ══════════════════════════════════════════════

const MOCK_TEAM_ID = 'team-owned-001'

let mockInstallations: GithubInstallation[] = [
  {
    id: 'gh-install-1001',
    providerInstallationId: 12345678,
    accountLogin: 'Yjingwen-svg',
    accountType: 'USER',
    installedAt: '2026-08-01T08:00:00Z',
    status: 'ACTIVE',
    metadataSyncedAt: '2026-08-13T10:00:00Z',
  },
  {
    id: 'gh-install-1002',
    providerInstallationId: 87654321,
    accountLogin: 'qgents-lab',
    accountType: 'ORGANIZATION',
    installedAt: '2026-08-08T10:00:00Z',
    status: 'ACTIVE',
    metadataSyncedAt: '2026-08-13T10:00:00Z',
  },
]

const mockAuthorizedRepos: GithubAuthorizedRepository[] = [
  {
    id: 'repo-1',
    installationId: 'gh-install-1001',
    providerRepositoryId: 987654321,
    fullName: 'Yjingwen-svg/qgents-web',
    githubUrl: 'https://github.com/Yjingwen-svg/qgents-web',
    defaultBranch: 'main',
    visibility: 'PUBLIC',
    archived: false,
    authorizationStatus: 'AUTHORIZED',
    metadataSyncedAt: '2026-08-13T10:00:00Z',
  },
  {
    id: 'repo-2',
    installationId: 'gh-install-1001',
    providerRepositoryId: 987654322,
    fullName: 'Yjingwen-svg/qgents-server',
    githubUrl: 'https://github.com/Yjingwen-svg/qgents-server',
    defaultBranch: 'main',
    visibility: 'PRIVATE',
    archived: false,
    authorizationStatus: 'AUTHORIZED',
    metadataSyncedAt: '2026-08-13T10:00:00Z',
  },
  {
    id: 'repo-3',
    installationId: 'gh-install-1002',
    providerRepositoryId: 987654323,
    fullName: 'qgents-lab/pet-app',
    githubUrl: 'https://github.com/qgents-lab/pet-app',
    defaultBranch: 'develop',
    visibility: 'PRIVATE',
    archived: false,
    authorizationStatus: 'AUTHORIZED',
    metadataSyncedAt: '2026-08-13T09:00:00Z',
  },
]

// ══════════════════════════════════════════════
// 项目仓库绑定（内存表）
// ══════════════════════════════════════════════

/** 项目已绑定仓库内存表（MSW 进程内） */
// 用闭包变量模拟后端落库
function createRepoBindingHandlers() {
  const bindings = new Map<string, import('@/types/github').ProjectBoundRepository[]>()
  bindings.set('proj-qgents', [
    {
      id: 'bound-proj-qgents-repo-1',
      repositoryId: 'repo-1',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654321,
      fullName: 'Yjingwen-svg/qgents-web',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-web',
      displayName: 'qgents-web',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-10T12:00:00Z',
    },
  ])
  bindings.set('proj-001', [
    {
      id: 'bound-demo-auth-service',
      repositoryId: 'repo-2',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654322,
      fullName: 'Yjingwen-svg/qgents-server',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-server',
      displayName: 'auth-service',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-10T12:00:00Z',
    },
    {
      id: 'bound-demo-web-console',
      repositoryId: 'repo-1',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654321,
      fullName: 'Yjingwen-svg/qgents-web',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-web',
      displayName: 'web-console',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-10T12:00:00Z',
    },
    {
      id: 'bound-demo-shared-sdk',
      repositoryId: 'repo-3',
      installationId: 'gh-install-1002',
      providerRepositoryId: 987654323,
      fullName: 'qgents-lab/pet-app',
      githubUrl: 'https://github.com/qgents-lab/pet-app',
      displayName: 'shared-sdk',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T09:00:00Z',
      boundAt: '2026-08-11T09:00:00Z',
    },
  ])
  bindings.set('demo-project', [
    {
      id: 'bound-demo-auth-service',
      repositoryId: 'repo-2',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654322,
      fullName: 'Yjingwen-svg/qgents-server',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-server',
      displayName: 'auth-service',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-10T12:00:00Z',
    },
    {
      id: 'bound-demo-web-console',
      repositoryId: 'repo-1',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654321,
      fullName: 'Yjingwen-svg/qgents-web',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-web',
      displayName: 'web-console',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-10T12:00:00Z',
    },
    {
      id: 'bound-demo-shared-sdk',
      repositoryId: 'repo-3',
      installationId: 'gh-install-1002',
      providerRepositoryId: 987654323,
      fullName: 'qgents-lab/pet-app',
      githubUrl: 'https://github.com/qgents-lab/pet-app',
      displayName: 'shared-sdk',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T09:00:00Z',
      boundAt: '2026-08-11T09:00:00Z',
    },
  ])
  bindings.set('proj-002', [
    {
      id: 'bound-proj-002-pet-app',
      repositoryId: 'repo-3',
      installationId: 'gh-install-1002',
      providerRepositoryId: 987654323,
      fullName: 'qgents-lab/pet-app',
      githubUrl: 'https://github.com/qgents-lab/pet-app',
      displayName: '宠影记',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T09:00:00Z',
      boundAt: '2026-08-12T08:00:00Z',
    },
  ])
  bindings.set('proj-003', [
    {
      id: 'bound-proj-003-decision',
      repositoryId: 'repo-1',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654321,
      fullName: 'Yjingwen-svg/qgents-web',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-web',
      displayName: 'decision-web',
      defaultBranch: 'main',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-09T10:00:00Z',
    },
    {
      id: 'bound-proj-003-server',
      repositoryId: 'repo-2',
      installationId: 'gh-install-1001',
      providerRepositoryId: 987654322,
      fullName: 'Yjingwen-svg/qgents-server',
      githubUrl: 'https://github.com/Yjingwen-svg/qgents-server',
      displayName: 'decision-api',
      defaultBranch: 'develop',
      authorizationStatus: 'AUTHORIZED',
      metadataSyncedAt: '2026-08-13T10:00:00Z',
      boundAt: '2026-08-09T10:30:00Z',
    },
  ])

  return [
    http.get('/api/projects/:projectId/repositories', ({ params }) => {
      const projectId = String(params.projectId)
      return HttpResponse.json({
        data: bindings.get(projectId) ?? [],
        requestId: 'req_mock_project_repos',
      })
    }),

    http.post('/api/projects/:projectId/repositories', async ({ params, request }) => {
      const projectId = String(params.projectId)
      const body = (await request.json().catch(() => ({}))) as {
        installationId?: string
        repositoryId?: string
        displayName?: string
      }
      const source = mockAuthorizedRepos.find((r) => r.id === body.repositoryId)
      const record: import('@/types/github').ProjectBoundRepository = {
        id: `bound-${projectId}-${body.repositoryId ?? 'repo'}`,
        installationId: body.installationId ?? source?.installationId ?? 'unknown',
        repositoryId: body.repositoryId ?? 'unknown',
        providerRepositoryId: source?.providerRepositoryId ?? 0,
        fullName: source?.fullName ?? body.displayName ?? 'demo/repo',
        githubUrl: source?.githubUrl ?? `https://github.com/${body.displayName ?? 'demo/repo'}`,
        displayName:
          body.displayName ?? source?.fullName.split('/').pop() ?? source?.fullName,
        defaultBranch: source?.defaultBranch ?? '',
        authorizationStatus: source?.authorizationStatus ?? 'AUTHORIZED',
        metadataSyncedAt: source?.metadataSyncedAt ?? new Date().toISOString(),
        boundAt: new Date().toISOString(),
      }
      const prev = (bindings.get(projectId) ?? []).filter(
        (b) => b.repositoryId !== record.repositoryId,
      )
      bindings.set(projectId, [...prev, record])
      return HttpResponse.json({ data: record, requestId: 'req_mock_bind_repo' })
    }),

    /** POST /api/projects/:projectId/repositories/new — 项目内新建仓库并绑定（v2.0.19 §44） */
    http.post('/api/projects/:projectId/repositories/new', async ({ params, request }) => {
      const projectId = String(params.projectId)
      const idempotencyKey = request.headers.get('Idempotency-Key')
      const body = (await request.json().catch(() => ({}))) as {
        name?: string
        description?: string
        private?: boolean
        installationId?: string
        displayName?: string
      }

      if (!body.name || !body.name.trim()) {
        return HttpResponse.json(
          { data: null, error: { code: 'INVALID_INPUT', message: '仓库名称不能为空' } },
          { status: 422 },
        )
      }
      if (!body.installationId) {
        return HttpResponse.json(
          { data: null, error: { code: 'INVALID_INPUT', message: '必须指定 GitHub Installation' } },
          { status: 422 },
        )
      }

      // 找到对应 Installation 以拼接 fullName / githubUrl
      const installation = mockInstallations.find((i) => i.id === body.installationId)
      const accountLogin = installation?.accountLogin ?? 'unknown-user'
      const repoName = body.name.trim()
      const now = new Date().toISOString()
      const newRepoId = `repo-new-${Date.now()}`
      const newBindingId = `bound-${projectId}-new-${Date.now()}`

      // 同时创建绑定记录（让 listProjectRepositories 立刻能查到）
      const bindingRecord: import('@/types/github').ProjectBoundRepository = {
        id: newBindingId,
        installationId: body.installationId,
        repositoryId: newRepoId,
        providerRepositoryId: Math.floor(Math.random() * 1_000_000),
        fullName: `${accountLogin}/${repoName}`,
        githubUrl: `https://github.com/${accountLogin}/${repoName}`,
        displayName: body.displayName?.trim() || repoName,
        defaultBranch: 'main',
        authorizationStatus: 'AUTHORIZED',
        metadataSyncedAt: now,
        boundAt: now,
      }
      const prev = bindings.get(projectId) ?? []
      // 防止 HMR 热重载时重复添加同一个仓库到 bindings
      const alreadyBound = prev.some((b) => b.fullName === bindingRecord.fullName)
      if (!alreadyBound) {
        bindings.set(projectId, [...prev, bindingRecord])
      }

      // 同时加入授权仓库列表，方便在 TeamAuthorizedReposPage 看到
      // 防 HMR 重复：仅当 fullName 不存在时才 push
      const alreadyInAuthorized = mockAuthorizedRepos.some(
        (r) => r.fullName === bindingRecord.fullName,
      )
      if (!alreadyInAuthorized) {
        mockAuthorizedRepos.push({
          id: newRepoId,
          installationId: body.installationId,
          providerRepositoryId: bindingRecord.providerRepositoryId,
          fullName: bindingRecord.fullName,
          githubUrl: bindingRecord.githubUrl,
          defaultBranch: 'main',
          visibility: body.private ? 'PRIVATE' : 'PUBLIC',
          archived: false,
          authorizationStatus: 'AUTHORIZED',
          metadataSyncedAt: now,
        })
      }

      return HttpResponse.json(
        {
          data: {
            id: newBindingId,
            repositoryId: newRepoId,
            installationId: body.installationId,
            fullName: bindingRecord.fullName,
            githubUrl: bindingRecord.githubUrl,
            defaultBranch: 'main',
            displayName: body.displayName?.trim() || undefined,
            status: 'READY',
            failureCode: null,
            failureReason: null,
            createdAt: now,
          },
          requestId: 'req_mock_new_repo',
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        { status: 201 },
      )
    }),

    http.delete('/api/projects/:projectId/repositories/:bindingId', ({ params }) => {
      const projectId = String(params.projectId)
      const bindingId = String(params.bindingId)
      const next = (bindings.get(projectId) ?? []).filter(
        (b) => b.id !== bindingId && b.repositoryId !== bindingId,
      )
      bindings.set(projectId, next)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

// ══════════════════════════════════════════════
// 所有 Handlers
// ══════════════════════════════════════════════

export const handlers = [
  ...deliveryCenterHandlers,
  // ── health ──
  http.get('/api/health', () => HttpResponse.json({ status: 'ok', source: 'msw' })),

  // ── Auth ──
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string }
    if (!body.email?.includes('@')) {
      return HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } }, { status: 401 })
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

  // ── 注册邮箱验证码（§11：先发验证码、再带码注册）──
  http.post('/api/auth/register/verification-codes', async ({ request }) => {
    const body = (await request.json()) as { email?: string }
    if (!body.email?.includes('@')) {
      return HttpResponse.json({ error: { code: 'INVALID_INPUT', message: '邮箱格式不正确' } }, { status: 400 })
    }
    // 演示固定码，方便 mock 模式下直接注册；真实环境码由邮件送达
    registerCodeByEmail.set(body.email, '483920')
    return HttpResponse.json(
      { data: { message: '验证码已发送到邮箱，10 分钟内有效' }, requestId: 'mock-register-code' },
      { status: 202 },
    )
  }),

  http.post('/api/auth/register', async ({ request }) => {
    const body = (await request.json()) as { email?: string; displayName?: string; verificationCode?: string }
    if (!body.email?.includes('@')) {
      return HttpResponse.json({ error: { code: 'INVALID_INPUT', message: '邮箱格式不正确' } }, { status: 400 })
    }
    // §11.2：verificationCode 必填、长度固定 6 位数字
    const code = body.verificationCode?.trim() ?? ''
    if (!/^\d{6}$/.test(code)) {
      return HttpResponse.json(
        { error: { code: 'INVALID_VERIFICATION_CODE', message: '验证码无效或已过期' } },
        { status: 422 },
      )
    }
    if (registerCodeByEmail.get(body.email) !== code) {
      return HttpResponse.json(
        { error: { code: 'INVALID_VERIFICATION_CODE', message: '验证码无效或已过期' } },
        { status: 422 },
      )
    }
    // 验证码一次性：校验通过后消费掉，重试需重新获取
    registerCodeByEmail.delete(body.email)
    return HttpResponse.json({
      data: {
        accessToken: 'mock-access-token-' + Date.now(),
        accessTokenExpiresIn: 900,
        refreshToken: 'mock-refresh-token-' + Date.now(),
        refreshTokenExpiresIn: 2592000,
        user: { id: 'user-' + Date.now(), email: body.email!, displayName: body.displayName || body.email!.split('@')[0], avatarChar: (body.displayName || '用')[0] },
      },
    })
  }),

  http.post('/api/auth/refresh', async ({ request }) => {
    const body = (await request.json()) as { refreshToken?: string }
    if (!body.refreshToken) {
      return HttpResponse.json(
        { error: { code: 'INVALID_REFRESH_TOKEN', message: '刷新令牌无效' } },
        { status: 401 },
      )
    }
    return HttpResponse.json({
      data: {
        accessToken: 'mock-access-token-' + Date.now(),
        accessTokenExpiresIn: 900,
        refreshToken: 'mock-refresh-token-' + Date.now(),
        refreshTokenExpiresIn: 2592000,
      },
    })
  }),

  // ── 忘记密码（§4：发起找回密码邮件 / 用重置令牌设置新密码）──
  http.post('/api/auth/password-reset-requests', async ({ request }) => {
    const body = (await request.json()) as { email?: string }
    if (!body.email?.includes('@')) {
      return HttpResponse.json(
        { error: { code: 'INVALID_INPUT', message: '邮箱格式不正确' } },
        { status: 400 },
      )
    }
    // 模拟邮件已发送（演示环境无真实邮件网关；重置令牌即「验证码」）
    return HttpResponse.json({ data: { sent: true, expiresIn: 1800 } })
  }),

  http.post('/api/auth/password-resets', async ({ request }) => {
    const body = (await request.json()) as { email?: string; token?: string; newPassword?: string }
    if (!body.email?.includes('@') || !body.token?.trim() || !body.newPassword) {
      return HttpResponse.json(
        { error: { code: 'INVALID_RESET_TOKEN', message: '验证码无效或已过期' } },
        { status: 400 },
      )
    }
    return HttpResponse.json({ data: { reset: true } })
  }),

  http.get('/api/me', () =>
    HttpResponse.json({
      data: {
        user: MOCK_USER,
        teams: MOCK_TEAMS.map((t) => ({ id: t.id, name: t.name, role: t.role ?? 'TEAM_MEMBER' })),
        projects: Object.values(MOCK_PROJECTS)
          .flat()
          .map((p) => ({ id: p.id, teamId: p.teamId, name: p.name, role: p.role })),
      },
    }),
  ),

  // ── 个人 GitHub OAuth（§49；Mock 与 authApi 使用同一请求链路）──
  http.post('/api/me/integrations/github/oauth/start', () =>
    HttpResponse.json({
      data: {
        authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=mock&scope=repo&state=mock-state',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
      requestId: 'mock-github-oauth-start',
    }),
  ),

  // 仅供本地手动联调：模拟后端校验 callback 后回跳前端，不接收或返回任何 Token。
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

  // 修改昵称/头像（§4 PATCH /me）
  http.patch('/api/me', async ({ request }) => {
    const body = (await request.json()) as { displayName?: string; avatarUrl?: string }
    if (typeof body.displayName === 'string' && body.displayName.trim()) {
      MOCK_USER.displayName = body.displayName.trim()
      MOCK_USER.avatarChar = MOCK_USER.displayName.slice(0, 1)
    }
    if (typeof body.avatarUrl === 'string' && body.avatarUrl.trim()) {
      MOCK_USER.avatarUrl = body.avatarUrl.trim()
    }
    return HttpResponse.json({ data: null })
  }),

  // 签发头像直传凭证（§4；模拟 OSS，uploadUrl 指向本机路径供 MSW 拦截 PUT）
  http.post('/api/me/avatar/credential', async ({ request }) => {
    const body = (await request.json()) as { mediaType?: string; sizeBytes?: number }
    const mediaType = body.mediaType ?? ''
    if (!mediaType.startsWith('image/')) {
      return HttpResponse.json({ error: { code: 'INVALID_MEDIA_TYPE', message: '仅支持图片格式' } }, { status: 400 })
    }
    if (typeof body.sizeBytes !== 'number' || body.sizeBytes <= 0 || body.sizeBytes > 5 * 1024 * 1024) {
      return HttpResponse.json({ error: { code: 'AVATAR_SIZE_EXCEEDED', message: '头像大小需 ≤ 5MB' } }, { status: 400 })
    }
    const ext = mediaType.split('/')[1] ?? 'png'
    const objectKey = `avatars/${MOCK_USER.id}/mock-${Date.now()}.${ext}`
    return HttpResponse.json({
      data: {
        objectKey,
        uploadUrl: `/api/mock-avatar-upload/${objectKey}`,
        method: 'PUT',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        headers: {},
      },
    })
  }),

  // 直传落盘（MSW 拦截预签名 PUT，模拟 OSS 接收文件字节）
  http.put('/api/mock-avatar-upload/:objectKey', () => HttpResponse.json(null, { status: 200 })),

  // 确认头像上传，写入 users.avatar_url 并返回公共读 URL（§4）
  http.post('/api/me/avatar/confirm', async ({ request }) => {
    const body = (await request.json()) as { objectKey?: string }
    const objectKey = body.objectKey ?? ''
    if (!objectKey.startsWith(`avatars/${MOCK_USER.id}/`)) {
      return HttpResponse.json({ error: { code: 'AVATAR_OBJECT_FORBIDDEN', message: '头像对象不属于当前用户' } }, { status: 403 })
    }
    const avatarUrl = `https://mock-cdn.example.com/${objectKey}`
    MOCK_USER.avatarUrl = avatarUrl
    return HttpResponse.json({ data: { avatarUrl } })
  }),

  // ── 团队头像（§28.1）：credential → PUT → confirm，与用户头像同构 ──
  http.post('/api/teams/:teamId/avatar/credential', async ({ request }) => {
    const team = MOCK_TEAMS.find((t) => t.id === request.url.split('/teams/')[1]?.split('/')[0])
    if (!team) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '团队不存在' } }, { status: 404 })
    const body = (await request.json()) as { mediaType?: string; sizeBytes?: number }
    const mediaType = body.mediaType ?? ''
    if (!mediaType.startsWith('image/')) {
      return HttpResponse.json({ error: { code: 'INVALID_MEDIA_TYPE', message: '仅支持图片格式' } }, { status: 400 })
    }
    const ext = mediaType.split('/')[1] ?? 'png'
    const objectKey = `teams/${team.id}/mock-${Date.now()}.${ext}`
    return HttpResponse.json({
      data: {
        objectKey,
        uploadUrl: `/api/mock-team-avatar-upload/${objectKey}`,
        method: 'PUT',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        headers: {},
      },
    })
  }),

  // 直传落盘（模拟 OSS 接收团队头像字节）
  http.put('/api/mock-team-avatar-upload/:objectKey', () => HttpResponse.json(null, { status: 200 })),

  // 确认团队头像上传，写入 teams.avatar_url 并返回公共读 URL（§28.1）
  http.post('/api/teams/:teamId/avatar/confirm', async ({ request }) => {
    const teamId = request.url.split('/teams/')[1]?.split('/')[0]
    const team = MOCK_TEAMS.find((t) => t.id === teamId)
    if (!team) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '团队不存在' } }, { status: 404 })
    const body = (await request.json()) as { objectKey?: string }
    const objectKey = body.objectKey ?? ''
    // §28.1：对象键前缀必须匹配 teams/{teamId}/，否则 403
    if (!objectKey.startsWith(`teams/${teamId}/`)) {
      return HttpResponse.json({ error: { code: 'AVATAR_OBJECT_KEY_FORBIDDEN', message: '头像对象前缀不匹配' } }, { status: 403 })
    }
    const avatarUrl = `https://mock-cdn.example.com/${objectKey}`
    team.avatarUrl = avatarUrl
    return HttpResponse.json({ data: { avatarUrl } })
  }),

  http.post('/api/auth/logout', () => HttpResponse.json({ data: null })),

  // ── Teams ──
  http.get('/api/teams', () => HttpResponse.json({ data: MOCK_TEAMS })),

  http.post('/api/teams', async ({ request }) => {
    const body = (await request.json()) as { name?: string; description?: string }
    const newTeam = {
      id: 'team-new-' + nextTeamId++,
      name: body.name || '未命名团队',
      description: body.description || '',
      createdAt: new Date().toISOString(),
      role: 'TEAM_OWNER' as const,
      memberCount: 1,
    }
    return HttpResponse.json({ data: newTeam }, { status: 201 })
  }),

  http.get('/api/teams/:teamId', ({ params }) => {
    const team = MOCK_TEAMS.find((t) => t.id === params.teamId)
    if (!team) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '团队不存在' } }, { status: 404 })
    return HttpResponse.json({ data: team })
  }),

  // GET /teams/:teamId/activities —— 团队最近动态（演示样例，分页包装）
  http.get('/api/teams/:teamId/activities', () =>
    HttpResponse.json({ data: MOCK_ACTIVITIES, page: { nextCursor: null, hasMore: false } }),
  ),

  http.patch('/api/teams/:teamId', async ({ params, request }) => {
    const body = (await request.json()) as { name?: string; description?: string; avatarUrl?: string }
    const team = MOCK_TEAMS.find((t) => t.id === params.teamId)
    if (!team) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '团队不存在' } }, { status: 404 })
    // §28.2：avatarUrl 空串清空，null 保留原值
    if (body.avatarUrl === '') {
      delete body.avatarUrl
      team.avatarUrl = undefined
    }
    return HttpResponse.json({ data: { ...team, ...body } })
  }),

  http.get('/api/teams/:teamId/members', ({ params }) => {
    const members = params.teamId === 'team-joined-001'
      ? MOCK_TEAM_MEMBERS.map((m) => (m.userId === 'user-001' ? { ...m, role: 'TEAM_MEMBER' as const } : m))
      : MOCK_TEAM_MEMBERS
    return HttpResponse.json({ data: members })
  }),

  http.post('/api/teams/:teamId/invitations', async ({ request }) => {
    const body = (await request.json()) as { email?: string; role?: string }
    return HttpResponse.json({
      data: { id: 'inv-' + Date.now(), email: body.email || '', role: body.role || 'TEAM_MEMBER', status: 'PENDING', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
    }, { status: 201 })
  }),

  http.get('/api/teams/:teamId/invitations', () => HttpResponse.json({ data: [] })),

  // GET /team-invitations —— 当前用户收到的待处理邀请（收件人视角，分页包装）
  http.get('/api/team-invitations', () =>
    HttpResponse.json({ data: MOCK_MY_INVITATIONS, page: { nextCursor: null, hasMore: false } }),
  ),

  http.post('/api/team-invitations/:reference/accept', () =>
    HttpResponse.json({
      data: { userId: 'user-001', displayName: '陈同学', role: 'TEAM_MEMBER', joinedAt: '2026-08-15T10:00:00Z' },
    }),
  ),

  // ── GitHub 集成 ──
  http.get('/api/teams/:teamId/integrations/github/installations', ({ params }) => {
    if (params.teamId !== MOCK_TEAM_ID) {
      return HttpResponse.json({ data: [], requestId: 'req_mock_empty' })
    }
    return HttpResponse.json({
      data: mockInstallations,
      requestId: 'req_mock_installations',
    })
  }),

  http.get('/api/teams/:teamId/integrations/github/repositories', ({ params }) => {
    if (params.teamId !== MOCK_TEAM_ID) {
      return HttpResponse.json({ data: [], requestId: 'req_mock_repos_empty' })
    }
    return HttpResponse.json({
      data: mockAuthorizedRepos,
      requestId: 'req_mock_authorized_repos',
    })
  }),
  // 来自 MSW 内部，在【拦截成功、路由匹配上之后】，MSW 自动组装、生成这个info上下文对象，再调用你的回调函数，把它塞进来。
  //info 对象;const params = info.params
  // const request = info.request
  // const cookies = info.cookies
  // const requestId = info.requestId
  // 拦截,匹配路由,执行回调函数
  //匹配路由:只要是 POST 请求，并且 URL 路径符合 /api/teams/【任意值】/integrations/github/installations 这个格式，就触发后面这个回调，不要发到真实后端。
  //拦截 = MSW 在浏览器发出真实网络请求、发给后端之前，把这个请求 “半路截住”，不走真实后端，直接用你写的 mock 函数返回假数据。
  //request.url 不是对象！是字符串！
  http.post('/api/teams/:teamId/integrations/github/installations', ({ params, request }) => {//路径参数对象params,就是路径当中用:进行占位的都赋值给params
    const teamId = String(params.teamId)
    const idempotencyKey = request.headers.get('Idempotency-Key')
    const clientParam = new URL(request.url).searchParams.get('client')
    const client = clientParam === 'MOBILE' ? 'MOBILE' : 'WEB'
    console.info('[MSW] createInstallation', { teamId, client, idempotencyKey })

    const state = encodeURIComponent(`mock:${teamId}:${Date.now()}`)//模拟的state,真实的不会这样写.进行url编码,encodeURIComponent 只是传输包装，不是 state 本身的业务内容。
    const installationUrl = `https://github.com/apps/qgents/installations/new?state=${state}`

    return HttpResponse.json({
      data: {
        installationUrl,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      requestId: 'req_mock_install_redirect',
    })
  }),

  http.delete(
    '/api/teams/:teamId/integrations/github/installations/:installationId',
    ({ params }) => {
      const installationId = String(params.installationId)
      mockInstallations = mockInstallations.filter((i) => i.id !== installationId)
      for (let index = mockAuthorizedRepos.length - 1; index >= 0; index -= 1) {
        if (mockAuthorizedRepos[index]?.installationId === installationId) {
          mockAuthorizedRepos.splice(index, 1)
        }
      }
      return new HttpResponse(null, { status: 204 })
    },
  ),

  /** POST .../installations/{installationId}/sync —— 刷新 Installation 与授权仓库元数据 */
  http.post(
    '/api/teams/:teamId/integrations/github/installations/:installationId/sync',
    ({ params }) => {
      const installationId = String(params.installationId)
      const now = new Date().toISOString()
      mockInstallations = mockInstallations.map((i) =>
        i.id === installationId ? { ...i, metadataSyncedAt: now } : i,
      )
      mockAuthorizedRepos.forEach((repo, index) => {
        if (repo.installationId === installationId) {
          mockAuthorizedRepos[index] = { ...repo, metadataSyncedAt: now }
        }
      })
      const updated = mockInstallations.find((i) => i.id === installationId)
      if (!updated) {
        return HttpResponse.json(
          {
            error: {
              code: 'GITHUB_RESOURCE_NOT_FOUND',
              message: 'Installation 不存在',
              details: [],
            },
            requestId: 'req_mock_sync_404',
          },
          { status: 404 },
        )
      }
      return HttpResponse.json({ data: updated, requestId: 'req_mock_sync' })
    },
  ),

  /** GET /teams/{teamId}/projects —— Owner 绑定仓库时用 */
  // ── Projects ──
  http.get('/api/teams/:teamId/projects', ({ params }) => {
    const projects = MOCK_PROJECTS[params.teamId as string] || []
    return HttpResponse.json({ data: projects })
  }),

  http.post('/api/teams/:teamId/projects', async ({ params, request }) => {
    const body = (await request.json()) as { name?: string; description?: string }
    const teamId = params.teamId as string
    const newProject = {
      id: 'proj-new-' + nextProjectId++,
      teamId,
      name: body.name || '未命名项目',
      description: body.description || '',
      createdAt: new Date().toISOString(),
      role: 'PROJECT_ADMIN' as const,
      repositoryCount: 0,
      memberCount: 1,
      status: 'ACTIVE' as const,
    }
    // 写回内存，保证后续 GET /projects/:id 能查到
    if (!MOCK_PROJECTS[teamId]) MOCK_PROJECTS[teamId] = []
    MOCK_PROJECTS[teamId].push(newProject)

    // 新建项目的成员只有创建者本人
    MOCK_PROJECT_MEMBERS[newProject.id] = [
      { userId: 'user-001', displayName: '陈同学', email: 'demo@qgents.dev', role: 'PROJECT_ADMIN' },
    ]

    // 对齐接口文档 §7：创建项目时服务端自动创建唯一的 PROJECT_MAIN 总群
    const mainGroupId = 'group-main-' + newProject.id
    if (!MOCK_GROUPS[newProject.id]) MOCK_GROUPS[newProject.id] = []
    MOCK_GROUPS[newProject.id].push({
      id: mainGroupId,
      projectId: newProject.id,
      type: 'PROJECT_MAIN',
      title: '项目总群',
      description: '项目级讨论与结构化动态',
      status: 'ACTIVE',
      memberCount: getGroupMembers(newProject.id, mainGroupId).length,
      latestActivityAt: new Date().toISOString(),
      unreadCount: 0,
      isPinned: true,
      isArchived: false,
    })

    return HttpResponse.json({ data: newProject }, { status: 201 })
  }),

  http.get('/api/projects/:projectId', ({ params }) => {
    for (const list of Object.values(MOCK_PROJECTS)) {
      const proj = list.find((p) => p.id === params.projectId)
      if (proj) return HttpResponse.json({ data: proj })
    }
    return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '项目不存在' } }, { status: 404 })
  }),

  // §24.2：项目成员分页响应（仅显式 project_members，不为 Team Owner 虚构行）
  http.get('/api/projects/:projectId/members', ({ params, request }) => {
    const projectId = params.projectId as string
    const all = MOCK_PROJECT_MEMBERS[projectId] ?? []
    const search = new URL(request.url).searchParams
    const rawLimit = Number(search.get('limit') ?? '30')
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30
    const rawCursor = Number(search.get('cursor') ?? '0')
    const start = Number.isInteger(rawCursor) && rawCursor >= 0 ? rawCursor : 0
    const data = all.slice(start, start + limit)
    const nextStart = start + data.length
    return HttpResponse.json({
      data,
      page: { nextCursor: nextStart < all.length ? String(nextStart) : null, hasMore: nextStart < all.length },
      requestId: 'mock-project-members',
    })
  }),

  http.post('/api/projects/:projectId/members', () => HttpResponse.json({ data: null }, { status: 201 })),

  http.post('/api/projects/:projectId/archive', () => HttpResponse.json({ data: null })),

  http.post('/api/projects/:projectId/restore', () => HttpResponse.json({ data: null })),

  // ── 项目设置（需求群规则，§22.2）──
  http.get('/api/projects/:projectId/settings', ({ params }) => {
    const settings = (MOCK_PROJECT_SETTINGS[params.projectId as string] ??= { ...DEFAULT_PROJECT_SETTINGS })
    return HttpResponse.json({ data: settings })
  }),
  http.patch('/api/projects/:projectId/settings', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>
    const settings = (MOCK_PROJECT_SETTINGS[params.projectId as string] ??= { ...DEFAULT_PROJECT_SETTINGS })
    Object.assign(settings, body)
    return HttpResponse.json({ data: settings })
  }),

  // ── Group 与消息 ──
  http.get('/api/projects/:projectId/groups', ({ params }) => {
    const projectId = params.projectId as string
    // memberCount 由群成员派生（= 项目成员 + 群内 Agent），与 GET .../members 保持一致；
    // latestMessage 由消息列表派生，与 GET .../messages 保持一致
    const groups = (MOCK_GROUPS[projectId] ?? []).map((g) => ({
      ...g,
      memberCount: getGroupMembers(projectId, g.id).length,
      latestMessage: getLatestMessageSummary(g.id),
    }))
    return HttpResponse.json({ data: groups })
  }),

  // 主群聚合（§五）：一次返回全部可见项目主群，替代 teams→projects→groups 三层串联查询
  http.get('/api/chat/main-groups', () => {
    const groups = Object.entries(MOCK_GROUPS)
      .flatMap(([projectId, list]) =>
        list
          .filter((g) => g.type === 'PROJECT_MAIN')
          .map((g) => ({
            ...g,
            projectId,
            memberCount: getGroupMembers(projectId, g.id).length,
            latestMessage: getLatestMessageSummary(g.id),
          })),
      )
      .sort((a, b) => (b.latestActivityAt ?? '').localeCompare(a.latestActivityAt ?? ''))
    return HttpResponse.json({ data: groups })
  }),

  // 标记已读（§三 进群全读）：后端推进已读游标到群最新消息，未读数归零
  http.post('/api/projects/:projectId/groups/:groupId/read', ({ params }) => {
    const projectId = params.projectId as string
    const groupId = params.groupId as string
    const group = (MOCK_GROUPS[projectId] ?? []).find((g) => g.id === groupId)
    if (!group) return HttpResponse.json({ error: { code: 'GROUP_NOT_FOUND', message: '群不存在' } }, { status: 404 })
    // 演示用：游标停在最新一条之前，让最新消息高于已读游标，便于观察「↑ 有人@你」提示条。
    // 真实后端按「进群全读」推进到最新即可。
    const maxSeq = (MOCK_MESSAGES[groupId] ?? []).reduce(
      (max, m) => Math.max(max, m.sequence ?? 0),
      0,
    )
    const lastReadSequenceNo = Math.max(0, maxSeq - 1)
    group.unreadCount = 0
    return HttpResponse.json({ data: { groupId, lastReadSequenceNo, unreadCount: 0 } })
  }),

  http.post('/api/projects/:projectId/groups', async ({ params, request }) => {
    const projectId = params.projectId as string
    const body = (await request.json()) as { title?: string; description?: string; type?: string; memberIds?: string[] }
    // 只接受 REQUIREMENT（省略 type 也按 REQUIREMENT 处理），PROJECT_MAIN 返回 422
    if (body.type === 'PROJECT_MAIN') {
      return HttpResponse.json(
        { error: { code: 'SYSTEM_GROUP_MANAGED', message: '项目总群由系统管理，不可创建' } },
        { status: 422 },
      )
    }
    const groupId = 'group-' + Date.now()
    const group: Group = {
      id: groupId,
      projectId,
      type: 'REQUIREMENT',
      title: body.title || '未命名需求群',
      description: body.description || '',
      status: 'ACTIVE',
      createdBy: MOCK_CURRENT_USER.id,
      // 新需求群：创建者自动入群 + 建群时选择的成员；Agent 参与由后续编排决定
      memberCount: 0,
      latestActivityAt: new Date().toISOString(),
      unreadCount: 0,
      isPinned: false,
      isArchived: false,
    }
    const list = MOCK_GROUPS[projectId] ?? (MOCK_GROUPS[projectId] = [])
    list.push(group)
    const validIds = new Set((MOCK_PROJECT_MEMBERS[projectId] ?? []).map((m) => m.userId))
    const selected = (body.memberIds ?? []).filter(
      (userId): userId is string => typeof userId === 'string' && validIds.has(userId) && userId !== MOCK_CURRENT_USER.id,
    )
    MOCK_GROUP_USER_MEMBERS[groupId] = [MOCK_CURRENT_USER.id, ...new Set(selected)]
    group.memberCount = getGroupMembers(projectId, groupId).length
    return HttpResponse.json({ data: group }, { status: 201 })
  }),

  http.post('/api/projects/:projectId/groups/:groupId/archive', ({ params }) => {
    const groupId = params.groupId as string
    const projectId = params.projectId as string
    const group = (MOCK_GROUPS[projectId] ?? []).find((g) => g.id === groupId)
    if (!group) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '群不存在' } }, { status: 404 })
    if (group.type === 'PROJECT_MAIN') {
      return HttpResponse.json({ error: { code: 'SYSTEM_GROUP_MANAGED', message: '项目总群不可归档' } }, { status: 422 })
    }
    group.status = 'ARCHIVED'
    group.isArchived = true
    return HttpResponse.json({ data: null })
  }),

  // §24.4 退出项目：移除显式项目成员身份；最后一名 Admin / Team Owner 拒绝
  http.post('/api/projects/:projectId/groups/:groupId/leave', ({ params }) => {
    const projectId = params.projectId as string
    const members = MOCK_PROJECT_MEMBERS[projectId]
    if (!members) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '项目不存在' } }, { status: 404 })
    }
    const current = members.find((m) => m.userId === MOCK_CURRENT_USER.id)
    if (!current) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '当前用户不是项目成员' } }, { status: 404 })
    }
    // canonical Team Owner 保留跨项目兜底权限，不可退出（与 §24.4 一致）
    if (MOCK_CURRENT_USER.id === 'user-001' && members.some((m) => m.userId === 'user-001' && m.role === 'PROJECT_ADMIN')) {
      // mock 里 user-001 是创建者（Team Owner + 项目创建者）：按 Team Owner 语义拒绝
      return HttpResponse.json(
        { error: { code: 'TEAM_OWNER_CANNOT_LEAVE_PROJECT', message: '团队 Owner 保留跨项目权限，不能退出项目' } },
        { status: 409 },
      )
    }
    // 最后一名 Project Admin 不可退出
    const admins = members.filter((m) => m.role === 'PROJECT_ADMIN')
    if (current.role === 'PROJECT_ADMIN' && admins.length <= 1) {
      return HttpResponse.json(
        { error: { code: 'PROJECT_ADMIN_CANNOT_LEAVE', message: '最后一名管理员不能退出项目' } },
        { status: 409 },
      )
    }
    MOCK_PROJECT_MEMBERS[projectId] = members.filter((m) => m.userId !== MOCK_CURRENT_USER.id)
    return HttpResponse.json({ data: null })
  }),

  http.get('/api/projects/:projectId/groups/:groupId/members', ({ params }) => {
    // 群成员 = 该群 USER 成员（含 email）+ 群内 Agent，群内成员平等、无角色区分
    return HttpResponse.json({
      data: getGroupMembers(params.projectId as string, params.groupId as string),
    })
  }),

  // 邀请项目成员入群（创建者或 Project Admin 管理成员；Agent 成员不受此接口影响）
  http.post('/api/projects/:projectId/groups/:groupId/members', async ({ params, request }) => {
    const projectId = params.projectId as string
    const groupId = params.groupId as string
    const group = (MOCK_GROUPS[projectId] ?? []).find((g) => g.id === groupId)
    if (!group) return HttpResponse.json({ error: { code: 'GROUP_NOT_FOUND', message: '群不存在' } }, { status: 404 })
    const body = (await request.json()) as { userId?: string }
    const member = (MOCK_PROJECT_MEMBERS[projectId] ?? []).find((m) => m.userId === body.userId)
    if (!member) return HttpResponse.json({ error: { code: 'PROJECT_MEMBER_NOT_FOUND', message: '该用户不是项目成员' } }, { status: 404 })
    const membership = MOCK_GROUP_USER_MEMBERS[groupId] ?? (MOCK_GROUP_USER_MEMBERS[groupId] = [])
    if (!membership.includes(member.userId)) membership.push(member.userId)
    group.memberCount = getGroupMembers(projectId, groupId).length
    return HttpResponse.json({
      data: { id: member.userId, displayName: member.displayName, email: member.email, memberType: 'USER' },
    })
  }),

  // 移出群聊（创建者或 Project Admin；创建者本人不可移出）
  http.delete('/api/projects/:projectId/groups/:groupId/members/:userId', ({ params }) => {
    const projectId = params.projectId as string
    const groupId = params.groupId as string
    const userId = params.userId as string
    const group = (MOCK_GROUPS[projectId] ?? []).find((g) => g.id === groupId)
    if (!group) return HttpResponse.json({ error: { code: 'GROUP_NOT_FOUND', message: '群不存在' } }, { status: 404 })
    if (userId === MOCK_CURRENT_USER.id) {
      return HttpResponse.json({ error: { code: 'GROUP_CANNOT_REMOVE_SELF', message: '不能移出自己' } }, { status: 422 })
    }
    if (userId === group.createdBy) {
      return HttpResponse.json({ error: { code: 'GROUP_CREATOR_NOT_REMOVABLE', message: '群创建者不可被移出' } }, { status: 422 })
    }
    const membership = MOCK_GROUP_USER_MEMBERS[groupId]
    if (!membership || !membership.includes(userId)) {
      return HttpResponse.json({ error: { code: 'GROUP_MEMBER_NOT_FOUND', message: '该用户不在群内' } }, { status: 404 })
    }
    MOCK_GROUP_USER_MEMBERS[groupId] = membership.filter((id) => id !== userId)
    group.memberCount = getGroupMembers(projectId, groupId).length
    return HttpResponse.json({ data: null })
  }),

  http.get('/api/projects/:projectId/groups/:groupId/messages', ({ params }) => {
    const messages = MOCK_MESSAGES[params.groupId as string] ?? []
    return HttpResponse.json({
      data: messages,
      page: { nextCursor: null, hasMore: false },
    })
  }),

  // 单条消息定位（通知「@ 提及」跳转用）：目标消息不在已加载分页时拉取
  http.get('/api/projects/:projectId/groups/:groupId/messages/:messageId', ({ params }) => {
    const message = (MOCK_MESSAGES[params.groupId as string] ?? []).find(
      (m) => m.id === params.messageId,
    )
    if (!message) {
      return HttpResponse.json({ error: { code: 'MESSAGE_NOT_FOUND', message: '消息不存在' } }, { status: 404 })
    }
    return HttpResponse.json({ data: message })
  }),

  http.post('/api/projects/:projectId/groups/:groupId/messages', async ({ params, request }) => {
    const groupId = params.groupId as string
    const body = (await request.json()) as {
      type?: Message['type']
      content?: unknown
      senderId?: string
      clientMessageId?: string
      replyToId?: string | null
      replyText?: string
      mentions?: Array<{ type?: string; id?: string }>
    }
    const projectId = params.projectId as string
    const group = (MOCK_GROUPS[projectId] ?? []).find((item) => item.id === groupId)
    if (!group) return HttpResponse.json({ error: { code: 'GROUP_NOT_FOUND', message: '需求群不存在' } }, { status: 404 })
    const mentionedAgents = body.mentions?.filter((mention) => mention.type === 'AGENT' && typeof mention.id === 'string' && mention.id.length > 0) ?? []
    if (mentionedAgents.length > 0 && (group.type !== 'REQUIREMENT' || group.status !== 'ACTIVE' || group.isArchived)) {
      return HttpResponse.json({ error: { code: 'TASK_TRIGGER_GROUP_INVALID', message: '只能在活跃需求群中发起任务' } }, { status: 422 })
    }
    if (mentionedAgents.length > 1) {
      return HttpResponse.json({ error: { code: 'MULTIPLE_AGENT_TASK_TRIGGER_UNSUPPORTED', message: '一条消息只能提及一个 Agent 发起任务' } }, { status: 422 })
    }
    const list = MOCK_MESSAGES[groupId] ?? (MOCK_MESSAGES[groupId] = [])
    const message: Message = {
      id: 'msg-' + Date.now(),
      groupId,
      type: body.type ?? 'TEXT',
      content: body.content ?? { text: '' },
      senderType: 'USER',
      senderId: 'user-001',
      senderName: '陈同学',
      sequence: list.length + 1,
      createdAt: new Date().toISOString(),
      replyToId: body.replyToId ?? null,
      // §7 冻结：QUOTE 的回复正文回显在顶层（发送与 GET 同构）
      replyText: body.replyText ?? undefined,
    }
    list.push(message)
    const taskText = messageTextForTask(body.content, body.replyText)
    const taskRecord = mentionedAgents[0]
      ? createTaskFromMessageIntent(projectId, {
        requirementGroupId: groupId,
        title: taskText.slice(0, 80) || '来自群聊的任务',
        requirement: taskText,
        messageId: message.id,
        createdAt: message.createdAt,
      })
      : null
    const task = taskRecord
      ? { id: taskRecord.id, displayCode: taskRecord.displayCode, status: taskRecord.status, missingFields: ['repositoryIds', 'baseRef'] }
      : null
    return HttpResponse.json({ data: { message, task } }, { status: 201 })
  }),

  http.post('/api/projects/:projectId/groups/:groupId/messages/:messageId/trigger-task', ({ params }) => {
    const projectId = params.projectId as string
    const groupId = params.groupId as string
    const messageId = params.messageId as string
    const group = (MOCK_GROUPS[projectId] ?? []).find((item) => item.id === groupId)
    if (!group) return HttpResponse.json({ error: { code: 'GROUP_NOT_FOUND', message: '需求群不存在' } }, { status: 404 })
    if (group.type !== 'REQUIREMENT' || group.status !== 'ACTIVE' || group.isArchived) {
      return HttpResponse.json({ error: { code: 'TASK_TRIGGER_GROUP_INVALID', message: '只能在活跃需求群中发起任务' } }, { status: 422 })
    }
    const message = (MOCK_MESSAGES[groupId] ?? []).find((item) => item.id === messageId)
    if (!message) return HttpResponse.json({ error: { code: 'MESSAGE_NOT_FOUND', message: '消息不存在' } }, { status: 404 })
    const existing = findTaskByTriggerMessageId(projectId, messageId)
    const taskText = messageTextForTask(message.content, message.replyText)
    const task = existing ?? createTaskFromMessageIntent(projectId, {
      requirementGroupId: groupId,
      title: taskText.slice(0, 80) || '来自群聊的任务',
      requirement: taskText,
      messageId,
      createdAt: message.createdAt,
    })
    return HttpResponse.json({ data: task }, { status: existing ? 200 : 201 })
  }),

  // ── 项目仓库绑定（GitHub）──
  ...createRepoBindingHandlers(),
  // ── 工作分支（代码与 Branch）──
  ...createWorkBranchHandlers(),

  // ── 通知中心（本轮前端 Mock）──
  http.get('/api/notifications', () => HttpResponse.json({ data: MOCK_NOTIFICATIONS })),

  http.post('/api/notifications/:id/read', ({ params }) => {
    const n = MOCK_NOTIFICATIONS.find((x) => x.id === params.id)
    if (n) n.isRead = true
    return HttpResponse.json({ data: null })
  }),

  http.post('/api/notifications/read-all', () => {
    MOCK_NOTIFICATIONS.forEach((n) => {
      n.isRead = true
    })
    return HttpResponse.json({ data: null })
  }),

  // ── 共享 Memory（对齐接口文档 §9）──
  http.get('/api/projects/:projectId/memories', ({ params }) => {
    const list = MOCK_MEMORIES[params.projectId as string] ?? []
    // 文档：默认仅返回 APPROVED；此处返回全量供前端按状态筛选演示
    return HttpResponse.json({ data: list })
  }),

  http.post('/api/projects/:projectId/memories', async ({ params, request }) => {
    const projectId = params.projectId as string
    const body = (await request.json()) as {
      title?: string
      content?: string
      category?: string
      tags?: string[]
    }
    const memory: Memory = {
      id: 'mem-' + nextMemoryId++,
      projectId,
      title: body.title || '未命名 Memory',
      content: body.content || '',
      category: body.category || 'GENERAL',
      tags: body.tags ?? [],
      status: 'DRAFT',
      source: 'MANUAL',
      sources: [],
      creator: { id: 'user-001', displayName: '陈同学' },
      reviewer: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
      ; (MOCK_MEMORIES[projectId] ??= []).push(memory)
    return HttpResponse.json({ data: memory }, { status: 201 })
  }),

  http.post('/api/projects/:projectId/memories/drafts', async ({ params, request }) => {
    const projectId = params.projectId as string
    const body = (await request.json()) as {
      sourceMessages?: { groupId: string; messageId: string }[]
      instruction?: string
    }
    const src = body.sourceMessages ?? []
    const memory: Memory = {
      id: 'mem-' + nextMemoryId++,
      projectId,
      title: '群聊生成草稿' + (body.instruction ? `：${body.instruction}` : ''),
      content: `根据 ${src.length} 条群消息自动生成的草稿，待人工确认。`,
      category: 'GENERAL',
      tags: [],
      status: 'DRAFT',
      source: 'MESSAGE',
      sources: src,
      creator: { id: 'user-001', displayName: '陈同学' },
      reviewer: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
      ; (MOCK_MEMORIES[projectId] ??= []).push(memory)
    return HttpResponse.json({ data: memory }, { status: 201 })
  }),

  http.patch('/api/projects/:projectId/memories/:memoryId', async ({ params, request }) => {
    const list = MOCK_MEMORIES[params.projectId as string] ?? []
    const memory = list.find((m) => m.id === params.memoryId)
    if (!memory) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Memory 不存在' } }, { status: 404 })
    }
    const body = (await request.json()) as Partial<Memory>
    Object.assign(memory, body, { updatedAt: new Date().toISOString() })
    return HttpResponse.json({ data: memory })
  }),

  http.post('/api/projects/:projectId/memories/:memoryId/submit-review', ({ params }) => {
    const memory = (MOCK_MEMORIES[params.projectId as string] ?? []).find(
      (m) => m.id === params.memoryId,
    )
    if (memory) {
      memory.status = 'PENDING_REVIEW'
      memory.updatedAt = new Date().toISOString()
    }
    return HttpResponse.json({ data: memory })
  }),

  http.post('/api/projects/:projectId/memories/:memoryId/approve', ({ params }) => {
    const memory = (MOCK_MEMORIES[params.projectId as string] ?? []).find(
      (m) => m.id === params.memoryId,
    )
    if (memory) {
      memory.status = 'APPROVED'
      memory.reviewer = { id: 'user-002', displayName: '张工' }
      memory.reviewedAt = new Date().toISOString()
      memory.updatedAt = new Date().toISOString()
    }
    return HttpResponse.json({ data: memory })
  }),

  http.post('/api/projects/:projectId/memories/:memoryId/reject', async ({ params, request }) => {
    const memory = (MOCK_MEMORIES[params.projectId as string] ?? []).find(
      (m) => m.id === params.memoryId,
    )
    if (memory) {
      memory.status = 'REJECTED'
      memory.reviewer = { id: 'user-002', displayName: '张工' }
      memory.reviewedAt = new Date().toISOString()
      memory.updatedAt = new Date().toISOString()
      await request.json().catch(() => ({}))
    }
    return HttpResponse.json({ data: memory })
  }),

  http.post('/api/projects/:projectId/memories/:memoryId/archive', ({ params }) => {
    const memory = (MOCK_MEMORIES[params.projectId as string] ?? []).find(
      (m) => m.id === params.memoryId,
    )
    if (memory) {
      memory.status = 'ARCHIVED'
      memory.updatedAt = new Date().toISOString()
    }
    return HttpResponse.json({ data: memory })
  }),
]
