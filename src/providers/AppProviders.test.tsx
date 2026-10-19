import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppProviders } from './AppProviders'

describe('AppProviders', () => {
  it('renders children through the shared providers', () => {
    render(
      <AppProviders>
        <span>foundation-ready</span>
      </AppProviders>,
    )
    expect(screen.getByText('foundation-ready')).toBeInTheDocument()
  })
})
