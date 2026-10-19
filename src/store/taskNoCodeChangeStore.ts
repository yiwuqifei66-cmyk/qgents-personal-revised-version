import { create } from 'zustand'

const STORAGE_KEY = 'qgents_task_no_code_changes'

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`
}

function readStoredTasks(): Record<string, true> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === true)) as Record<string, true>
  } catch {
    return {}
  }
}

function persist(tasks: Record<string, true>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  } catch {
    // sessionStorage 不可用时保留当前会话内存状态。
  }
}

interface TaskNoCodeChangeState {
  completedWithoutCode: Record<string, true>
  markCompletedWithoutCode: (projectId: string, taskId: string) => void
  clearCompletedWithoutCode: (projectId: string, taskId: string) => void
  clearAllCompletedWithoutCode: () => void
}

export const useTaskNoCodeChangeStore = create<TaskNoCodeChangeState>((set, get) => ({
  completedWithoutCode: readStoredTasks(),
  markCompletedWithoutCode: (projectId, taskId) => {
    const completedWithoutCode: Record<string, true> = { ...get().completedWithoutCode, [taskKey(projectId, taskId)]: true }
    persist(completedWithoutCode)
    set({ completedWithoutCode })
  },
  clearCompletedWithoutCode: (projectId, taskId) => {
    const completedWithoutCode = { ...get().completedWithoutCode }
    delete completedWithoutCode[taskKey(projectId, taskId)]
    persist(completedWithoutCode)
    set({ completedWithoutCode })
  },
  clearAllCompletedWithoutCode: () => {
    persist({})
    set({ completedWithoutCode: {} })
  },
}))

export function useTaskCompletedWithoutCode(projectId: string, taskId: string): boolean {
  return useTaskNoCodeChangeStore((state) => state.completedWithoutCode[taskKey(projectId, taskId)] === true)
}
