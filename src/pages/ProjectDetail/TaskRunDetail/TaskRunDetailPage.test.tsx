import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import TaskRunDetailPage from './TaskRunDetailPage'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

describe('TaskRunDetailPage', () => {
  it('preserves the legacy execution deep link by opening the task workbench inspector', () => {
    render(<MemoryRouter initialEntries={['/app/projects/project-1/tasks/task-1/executions/run-1']}><Routes><Route path="/app/projects/:projectId/tasks/:taskId/executions/:taskRunId" element={<TaskRunDetailPage />} /><Route path="/app/projects/:projectId/tasks/:taskId" element={<LocationProbe />} /></Routes></MemoryRouter>)

    expect(screen.getByTestId('location')).toHaveTextContent('/app/projects/project-1/tasks/task-1?runId=run-1')
  })
})
