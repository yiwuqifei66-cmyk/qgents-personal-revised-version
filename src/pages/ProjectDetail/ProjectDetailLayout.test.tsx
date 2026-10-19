import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import ProjectDetailLayout from './ProjectDetailLayout'

vi.mock('@/pages/ProjectDetail/requirements', () => ({ PROJECT_REQUIREMENTS: [] }))

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
})

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderLayout(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes><Route path="/app/projects/:projectId/*" element={<ProjectDetailLayout />} /></Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  )
}

describe('ProjectDetailLayout Diff Center navigation', () => {
  it('shows the delivery center entry and navigates with the project path', () => {
    renderLayout('/app/projects/project-1/overview')

    fireEvent.click(screen.getByText('交付中心'))

    expect(screen.getByTestId('location')).toHaveTextContent('/app/projects/project-1/diffs')
  })

  it('keeps delivery center selected on the detail route', () => {
    renderLayout('/app/projects/project-1/diffs/diff-1')

    expect(screen.getByRole('link', { name: /交付中心/ })).toHaveClass('is-active')
  })
})
