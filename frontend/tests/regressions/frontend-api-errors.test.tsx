// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiErrorMessage } from '../../packages/core/src/components/ApiErrorMessage'

afterEach(() => cleanup())

describe('typed API errors in user-visible UI', () => {
  it('renders the backend message from a Kubb-style response error', () => {
    render(<ApiErrorMessage error={{
      response: {
        data: {
          code: 'UPSTREAM_OBSERVATION_UNSTABLE',
          message: 'The upstream wallet state changed while it was being read. Retry the request.',
          details: {},
        },
      },
    }} />)

    expect(screen.getByText('The upstream wallet state changed while it was being read. Retry the request.')).toBeTruthy()
  })

  it('falls back instead of rendering proxy HTML', () => {
    render(<ApiErrorMessage error={{ data: '<html>gateway failure</html>' }} fallbackMessage="Request failed safely." />)
    expect(screen.getByText('Request failed safely.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('gateway failure')
  })
})
