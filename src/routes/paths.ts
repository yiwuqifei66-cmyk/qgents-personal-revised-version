/**
 * 路由路径常量 —— 避免魔法字符串散落各处
 * 新增页面时先在这里登记，再挂到 routes/index.tsx
 */
export const PATHS = {
  /** 登录 / 注册 */
  LOGIN: '/login',

  /** 忘记密码（输入邮箱获取验证码 → 设置新密码） */
  FORGOT_PASSWORD: '/forgot-password',

  /**
   * 登录后若尚未加入任何团队 → 欢迎页（创建 / 加入）
   * 对应原型：欢迎来到 Qgents
   */
  WELCOME: '/welcome',

  /** 主应用壳（含顶部 Banner） */
  APP: '/app',
  /** 团队首页（Banner「团队首页」入口） */
  MY_TEAMS: '/app/teams',
  CREATE_TEAM: '/app/teams/create',
  JOIN_TEAM: '/app/teams/join',

  /**
   * 团队详情（我的团队卡片「查看详情」）
   * 此页提供「创建项目」入口
   * @param asOwner 是否来自「我创建的团队」——仅 Owner 可见「GitHub 集成」入口
   */
  teamDetail: (teamId: string, asOwner = false) =>
    asOwner ? `/app/teams/${teamId}?as=owner` : `/app/teams/${teamId}`,

  /**
   * 团队设置页（基本信息 / 成员管理 / GitHub 集成 / 危险区域）
   */
  teamSettings: (teamId: string) => `/app/teams/${encodeURIComponent(teamId)}/settings`,

  /**
   * 团队动态页（查看全部动态）
   */
  teamActivities: (teamId: string) => `/app/teams/${encodeURIComponent(teamId)}/activities`,

  /**
   * 创建项目（个人中心 / 团队详情均可进入）
   * TODO[后端联调]: teamId 用于绑定项目所属团队
   */
  createProject: (teamId: string) => `/app/teams/${teamId}/projects/create`,

  /**
   * 该团队已授权的所有 GitHub 仓库（创建项目时「绑定github仓库」进入）
   * 数据：GET .../repositories + GET .../installations（拼授权账号）
   */
  teamAuthorizedRepos: (teamId: string) =>
    `/app/teams/${encodeURIComponent(teamId)}/github/authorized-repos`,

  /**
   * 项目群聊工作台外壳
   * 左侧会话列表 + 顶栏 + 底部输入；中间消息区留空待填充
   * 团队上下文挂在路由层：/app/chat?teamId=xxx，刷新后不串团队（v2.0.6）
   */
  CHAT: '/app/chat',
  /** 项目群聊工作台（携带当前团队，刷新保持不串团队；无团队时用 CHAT 由页面兜底） */
  chat: (teamId: string) => `/app/chat?teamId=${encodeURIComponent(teamId)}`,

  /** 项目详情根路径（会重定向到默认子页） */
  projectDetail: (projectId: string) => `/app/projects/${projectId}`,

  /** 项目详情 — 各左侧导航子路由 */
  projectOverview: (projectId: string) => `/app/projects/${projectId}/overview`,

  /**
   * 群聊（项目总群 / 需求群）
   * 具体某个群：projectReqChat(projectId, groupId)
   */
  projectReqChat: (projectId: string, groupId: string) =>
    `/app/projects/${projectId}/req-chat/${groupId}`,

  projectTasks: (projectId: string) => `/app/projects/${projectId}/tasks`,
  projectDiffs: (projectId: string) => `/app/projects/${projectId}/diffs`,
  projectDiff: (projectId: string, diffId: string) => `/app/projects/${projectId}/diffs/${diffId}`,
  projectTaskDetail: (projectId: string, taskId: string) => `/app/projects/${projectId}/tasks/${taskId}`,
  projectTaskRunDetail: (projectId: string, taskId: string, taskRunId: string) =>
    `/app/projects/${projectId}/tasks/${taskId}/executions/${taskRunId}`,
  projectAgents: (projectId: string) => `/app/projects/${projectId}/agents`,
  projectSkills: (projectId: string) => `/app/projects/${projectId}/skills`,
  projectMemory: (projectId: string) => `/app/projects/${projectId}/memory`,
  projectCode: (projectId: string) => `/app/projects/${projectId}/code`,
  /** 单条 Diff / CR 详情（入口：代码与 Branch 表格 Diff 列 +/-） */
  projectCodeDiff: (projectId: string, diffId: string) =>
    `/app/projects/${projectId}/code/diff/${encodeURIComponent(diffId)}`,
  /** 单条 MR 详情（入口：代码与 Branch → MR Tab） */
  projectCodeMr: (projectId: string, mergeRequestId: string) =>
    `/app/projects/${projectId}/code/mr/${encodeURIComponent(mergeRequestId)}`,
  projectTestset: (projectId: string) => `/app/projects/${projectId}/testset`,
  projectTestsetsManage: (projectId: string) => `/app/projects/${projectId}/testset/manage`,
  projectQualityGate: (projectId: string) => `/app/projects/${projectId}/quality-gate`,
  projectCqReview: (projectId: string) => `/app/projects/${projectId}/cq-review`,
  projectMembers: (projectId: string) => `/app/projects/${projectId}/members`,
  projectSettings: (projectId: string) => `/app/projects/${projectId}/settings`,

  /**
   * GitHub 集成（入口：我创建的团队 → 查看详情 →「GitHub 集成」按钮）
   * 团队级 GitHub App 授权 + 仓库绑定管理
   * TODO[后端联调]: 见接口文档 §6 GitHub App 与项目仓库
   */
  GITHUB_INTEGRATION: '/app/integrations/github',
  /** 当前用户个人 GitHub OAuth 授权，不属于团队 GitHub App 集成页 */
  GITHUB_OAUTH: '/app/settings/integrations/github',
  githubIntegration: (teamId: string) =>
    `/app/integrations/github?teamId=${encodeURIComponent(teamId)}`,

  /**
   * 某次安装下的已授权仓库列表（由集成页「查看仓库」进入）
   */
  githubInstallationRepos: (teamId: string, installationId: string) =>
    `/app/integrations/github/installations/${encodeURIComponent(installationId)}/repositories?teamId=${encodeURIComponent(teamId)}`,

  /**
   * 将授权仓库绑定到团队项目（Owner：看到该团队全部项目）
   * query: installationId / repositoryId / fullName
   */
  bindRepoToProject: (
    teamId: string,
    opts: { installationId: string; repositoryId: string; fullName?: string },
  ) => {
    const q = new URLSearchParams({
      teamId,
      installationId: opts.installationId,
      repositoryId: opts.repositoryId,
    })
    if (opts.fullName) q.set('fullName', opts.fullName)
    return `/app/integrations/github/bind-repo?${q.toString()}`
  },
} as const

/** 项目详情左侧导航 path 段（相对 projects/:projectId） */
export const PROJECT_NAV = [
  { path: 'overview', label: '概览', to: PATHS.projectOverview },
  { path: 'tasks', label: '任务中心', to: PATHS.projectTasks },
  { path: 'diffs', label: '交付中心', to: PATHS.projectDiffs },
  { path: 'agents', label: 'Agent 团队', to: PATHS.projectAgents },
  { path: 'skills', label: '共享 Skill', to: PATHS.projectSkills },
  { path: 'memory', label: '共享 Memory', to: PATHS.projectMemory },
  { path: 'code', label: '分支与 Diff 详情', to: PATHS.projectCode },
  { path: 'testset', label: '质量门禁和 MR', to: PATHS.projectTestset },
  { path: 'members', label: '项目成员', to: PATHS.projectMembers },
  { path: 'settings', label: '项目设置', to: PATHS.projectSettings },
] as const
