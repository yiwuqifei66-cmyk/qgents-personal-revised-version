import { describe, expect, it, beforeEach } from 'vitest'
import type { LocalRunHistoryItem } from '@/types/testset'
import { pushRunHistory, readRunHistory, removeRunHistory } from './runHistory'

const projectId = 'demo-project'

const sample: LocalRunHistoryItem = {
  kind: 'DRY_RUN',
  id: 'dryrun-1',
  repositoryId: 'bound-1',
  createdAt: '2026-08-15T02:00:00Z',
  label: 'Dry-run · feat/login-api',
}

beforeEach(() => {
  localStorage.clear()
})

describe('runHistory', () => {
  it('pushes and reads local history newest first', () => {
    pushRunHistory(projectId, sample)
    pushRunHistory(projectId, {
      ...sample,
      id: 'testrun-1',
      kind: 'TEST_RUN',
      label: 'Test run · testrun-1',
    })
    expect(readRunHistory(projectId).map((item) => item.id)).toEqual(['testrun-1', 'dryrun-1'])
  })

  it('removes one history entry from localStorage', () => {
    pushRunHistory(projectId, sample)
    pushRunHistory(projectId, {
      ...sample,
      id: 'testrun-1',
      kind: 'TEST_RUN',
      label: 'Test run · testrun-1',
    })
    const next = removeRunHistory(projectId, 'dryrun-1')
    expect(next.map((item) => item.id)).toEqual(['testrun-1'])
    expect(readRunHistory(projectId).map((item) => item.id)).toEqual(['testrun-1'])
  })
})
