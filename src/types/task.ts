/**
 * 任务执行模型 —— 对齐接口文档 v1.1.8 §3.2 / §11.3 / §12.2
 *
 * 唯一执行层级：Task -> TaskStep -> TaskRun
 * 旧模型（orchestrationRun / workPackage / Deliverable / SubTask / TaskRunStep）
 * 已废弃，禁止重新引入。
 */

/** 工作流角色（§11.1 / §11.3）—— Agent 身份卡与 TaskStep 声明共用的角色枚举 */
export type WorkflowRole =
  | 'ORCHESTRATOR'
  | 'PLANNER'
  | 'DEVELOPER'
  | 'TESTER'
  | 'REVIEWER'
  | 'GENERAL'

/** Task 状态（§3.2）：取消时 RUNNING -> CANCELLING -> CANCELLED */
export type TaskStatus =
  | 'PLANNING'
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLING'
  | 'CANCELLED'

/** TaskStep 状态（§3.2） */
export type TaskStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'

/** TaskRun 状态（§3.2）：可进入 WAITING_INPUT / WAITING_APPROVAL / BLOCKED */
export type TaskRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'WAITING_INPUT'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'CANCELLING'
  | 'CANCELLED'

/** Task 关联的 Workspace 仓库 worktree（§11.3 repositories 数组项） */
export interface TaskRepository {
  repositoryId: string
  workspacePath: string
  baseCommit: string
  sourceBranch: string
  headCommit: string | null
}

/** Task（大任务，用户可见的顶层任务）—— 对齐 §11.3 Task 响应示例 */
export interface Task {
  id: string
  projectId: string
  requirementGroupId: string
  /** 触发该任务的需求群消息；从弹窗创建而非 @消息 触发时为 null */
  triggerMessageId: string | null
  title: string
  requirement: string
  status: TaskStatus
  workspaceId: string
  workspaceStatus: string
  continuationOfTaskId: string | null
  repositoryIds: string[]
  repositories: TaskRepository[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** TaskStep（Planner 拆出的有依赖小步骤）—— 对齐 §11.3 TaskStep 响应示例 */
export interface TaskStep {
  id: string
  taskId: string
  /** 声明所需工作流角色，调度器按角色挑可用 Agent */
  role: WorkflowRole
  agentId: string
  repositoryId: string
  baseRef: string
  dependencies: string[]
  testsetIds: string[]
  status: TaskStepStatus
  acceptanceNotes: string
}

/** TaskRun（某 TaskStep 的一次执行尝试）—— 对齐 §12.2 TaskRun 响应示例 */
export interface TaskRun {
  id: string
  projectId: string
  taskId: string
  taskStepId: string
  agentId: string
  role: WorkflowRole
  status: TaskRunStatus
  retryOfTaskRunId: string | null
  artifactSummary: { total: number; diffCount: number }
  startedAt: string | null
  finishedAt: string | null
  /** 由 finishedAt - startedAt 派生，任一端为空时为 null */
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

/** 创建 Task 请求体（§11.3）—— 从需求群 @Agent 发起任务 */
export interface CreateTaskPayload {
  requirementGroupId: string
  title: string
  requirement: string
  repositoryIds: string[]
  baseRef: string
}
