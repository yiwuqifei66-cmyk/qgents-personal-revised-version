import type {
  DiffComment,
  DiffDetail,
  DiffFile,
  ExecutionContext,
  InputRequest,
  Task,
  TaskRunDetail,
  TaskRunLog,
  TaskRunStep,
  TaskStep,
  TaskArtifact,
  DiffReviewBatch,
  MergeRequestCommit,
  MergeRequestSummary,
} from '@/types/task-model'

export interface TaskModelStore {
  tasks: Map<string, Task>
  taskSteps: Map<string, TaskStep>
  taskRuns: Map<string, TaskRunDetail>
  taskArtifacts: Map<string, TaskArtifact[]>
  diffReviews: Map<string, DiffReviewBatch>
  taskRunSteps: Map<string, TaskRunStep[]>
  taskRunLogs: Map<string, TaskRunLog[]>
  executionContexts: Map<string, ExecutionContext>
  inputRequests: Map<string, InputRequest>
  diffs: Map<string, DiffDetail>
  diffFiles: Map<string, DiffFile[]>
  diffComments: Map<string, DiffComment[]>
  mergeRequests: Map<string, MergeRequestSummary>
  mergeRequestCommits: Map<string, MergeRequestCommit[]>
}

export function createTaskModelStore(): TaskModelStore {
  return {
    tasks: new Map(),
    taskSteps: new Map(),
    taskRuns: new Map(),
    taskArtifacts: new Map(),
    diffReviews: new Map(),
    taskRunSteps: new Map(),
    taskRunLogs: new Map(),
    executionContexts: new Map(),
    inputRequests: new Map(),
    diffs: new Map(),
    diffFiles: new Map(),
    diffComments: new Map(),
    mergeRequests: new Map(),
    mergeRequestCommits: new Map(),
  }
}

export function findTask(store: TaskModelStore, taskId: string): Task | undefined {
  return store.tasks.get(taskId)
}

export function findTaskStep(store: TaskModelStore, taskStepId: string): TaskStep | undefined {
  return store.taskSteps.get(taskStepId)
}

export function findTaskRun(store: TaskModelStore, taskRunId: string): TaskRunDetail | undefined {
  return store.taskRuns.get(taskRunId)
}

export function findInputRequest(store: TaskModelStore, requestId: string): InputRequest | undefined {
  return store.inputRequests.get(requestId)
}

export function findDiff(store: TaskModelStore, diffId: string): DiffDetail | undefined {
  return store.diffs.get(diffId)
}
