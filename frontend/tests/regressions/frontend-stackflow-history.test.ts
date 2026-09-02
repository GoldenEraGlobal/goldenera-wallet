// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CleanableHistory } from '../../packages/core/src/router/CleanableHistory'

const metadata = () => (window.history.state as any)?.goldeneraWalletStack

beforeEach(() => {
  window.history.replaceState(null, '', '/#/')
})

afterEach(() => {
  window.history.replaceState(null, '', '/#/')
})

describe('realm-bound browser history', () => {
  it('writes namespaced schema, realm, app instance, and ordinal metadata', () => {
    const history = new CleanableHistory('authenticated')
    history.reset()
    history.startBrowserSync()
    history.push('/settings')

    expect(metadata()).toMatchObject({
      schema: 'goldenera-wallet-stack',
      version: 1,
      realm: 'authenticated',
      ordinal: 1,
    })
    expect(metadata().instanceId).toEqual(expect.any(String))
    expect(window.location.hash).toBe('#/settings')
    history.destroy()
  })

  it('normalizes a foreign authenticated entry without erasing Stackflow root state', () => {
    const history = new CleanableHistory('unauthenticated')
    history.reset()
    history.startBrowserSync()
    const stackflowRootState = {
      _TAG: '@stackflow/plugin-history-sync',
      flattedState: '[{"activity":"1","ordinal":0},{"id":"welcome"}]',
    }
    history.replace('/', stackflowRootState)
    history.push('/import-wallet', {
      _TAG: '@stackflow/plugin-history-sync',
      flattedState: '[{"activity":"1","ordinal":1},{"id":"import"}]',
    })

    const foreignState = {
      goldeneraWalletStack: {
        schema: 'goldenera-wallet-stack',
        version: 1,
        realm: 'authenticated',
        instanceId: 'prior-authenticated-instance',
        ordinal: 4,
      },
    }
    window.history.replaceState(foreignState, '', '/#/settings')
    window.dispatchEvent(new PopStateEvent('popstate', { state: foreignState }))

    expect(history.location.pathname).toBe('/')
    expect(history.location.state).toEqual(stackflowRootState)
    expect(window.location.hash).toBe('#/')
    expect(metadata()).toMatchObject({ realm: 'unauthenticated', ordinal: 0 })
    expect(metadata().instanceId).not.toBe('prior-authenticated-instance')

    const nextStackflowState = {
      _TAG: '@stackflow/plugin-history-sync',
      flattedState: '[{"activity":"1","ordinal":1},{"id":"create"}]',
    }
    history.push('/create-wallet', nextStackflowState)
    expect(history.location.state).toEqual(nextStackflowState)
    expect(metadata().ordinal).toBe(1)
    history.destroy()
  })

  it('rejects missing or invalid ordinals and still follows validated own entries', () => {
    const history = new CleanableHistory('unauthenticated')
    history.reset()
    history.startBrowserSync()
    const rootState = structuredClone(window.history.state)
    history.push('/import-wallet')
    const importState = structuredClone(window.history.state)

    window.dispatchEvent(new PopStateEvent('popstate', { state: rootState }))
    expect(history.location.pathname).toBe('/')
    window.dispatchEvent(new PopStateEvent('popstate', { state: importState }))
    expect(history.location.pathname).toBe('/import-wallet')

    const invalid = structuredClone(importState)
    invalid.goldeneraWalletStack.ordinal = Number.MAX_SAFE_INTEGER + 1
    window.history.replaceState(invalid, '', '/#/import-wallet')
    window.dispatchEvent(new PopStateEvent('popstate', { state: invalid }))
    expect(history.location.pathname).toBe('/')
    expect(metadata().ordinal).toBe(0)
    history.destroy()
  })
})
