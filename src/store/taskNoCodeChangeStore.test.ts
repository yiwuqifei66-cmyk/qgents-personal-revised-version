import { beforeEach, describe, expect, it } from 'vitest'
import { useTaskNoCodeChangeStore } from './taskNoCodeChangeStore'

describe('task no-code-change state', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useTaskNoCodeChangeStore.getState().clearAllCompletedWithoutCode()
  })

  it('records FINAL_DIFF_EMPTY per project and task without inventing a delivery item', () => {
    const store = useTaskNoCodeChangeStore.getState()
    store.markCompletedWithoutCode('project-1', 'task-1')

    expect(useTaskNoCodeChangeStore.getState().completedWithoutCode).toEqual({ 'project-1:task-1': true })
    expect(sessionStorage.getItem('qgents_task_no_code_changes')).toContain('project-1:task-1')

    store.clearCompletedWithoutCode('project-1', 'task-1')
    expect(useTaskNoCodeChangeStore.getState().completedWithoutCode).toEqual({})
  })
})
