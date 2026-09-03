import { afterEach, describe, expect, it, vi } from 'vitest'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

class FakeChannel {
  static instances: FakeChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false

  constructor(readonly name: string) {
    FakeChannel.instances.push(this)
  }

  postMessage(_message: unknown) {}
  close() { this.closed = true }
}

function installWindow(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  vi.stubGlobal('window', {
    crypto: globalThis.crypto,
    BroadcastChannel: FakeChannel,
    localStorage: { setItem: vi.fn() },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(listener)
      listeners.set(type, handlers)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => listeners.get(type)?.delete(listener),
    ...overrides,
  })
}

afterEach(() => {
  FakeChannel.instances = []
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('wallet authorization barrier', () => {
  it('rejects invalidation publication outside its active barrier scope', async () => {
    const {
      publishWalletInvalidation,
      withWalletAuthorizationBarrier,
    } = await import('../../packages/core/src/services/WalletSessionService')
    let publishAfterRelease: (() => string | null) | null = null

    await withWalletAuthorizationBarrier(async scope => {
      publishAfterRelease = () => publishWalletInvalidation(scope)
    })

    expect(() => publishAfterRelease?.()).toThrow(/active authorization barrier/)
  })

  it('fails closed in a production-like browser without Web Locks', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {})
    const { withWalletAuthorizationBarrier } = await import(
      '../../packages/core/src/services/WalletSessionService'
    )
    const operation = vi.fn(async () => 'unreachable')

    await expect(withWalletAuthorizationBarrier(operation)).rejects.toThrow(
      /cannot safely coordinate wallet authorization across tabs/,
    )
    expect(operation).not.toHaveBeenCalled()
  })

  it('serializes browser barrier requests on one shared Web Lock', async () => {
    let queue: Promise<unknown> = Promise.resolve()
    const request = vi.fn(<T>(_name: string, operation: () => Promise<T>): Promise<T> => {
      const result = queue.then(operation, operation)
      queue = result.catch(() => undefined)
      return result
    })
    vi.stubGlobal('navigator', { locks: { request } })
    vi.stubGlobal('document', {})
    const { withWalletAuthorizationBarrier } = await import(
      '../../packages/core/src/services/WalletSessionService'
    )
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const order: string[] = []

    const first = withWalletAuthorizationBarrier(async () => {
      order.push('first-enter')
      await firstGate
      order.push('first-exit')
    })
    await vi.waitFor(() => expect(order).toEqual(['first-enter']))
    const second = withWalletAuthorizationBarrier(async () => {
      order.push('second-enter')
      order.push('second-exit')
    })
    await Promise.resolve()
    expect(order).toEqual(['first-enter'])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-enter', 'first-exit', 'second-enter', 'second-exit'])
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.map(call => call[0])).toEqual([
      'goldenera-wallet-authorization-barrier',
      'goldenera-wallet-authorization-barrier',
    ])
  })
})

describe('biometric generation event transport', () => {
  it('keeps independent BroadcastChannel subscriptions alive', async () => {
    installWindow()
    const { subscribeBiometricGeneration } = await import('../../packages/core/src/services/BiometricSessionService')
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeBiometricGeneration(first)
    const unsubscribeSecond = subscribeBiometricGeneration(second)
    const event = { sourceId: 'other-tab', walletId: 'wallet-a', generation: 4, nonce: 'event-1' }

    FakeChannel.instances[0]!.onmessage?.({ data: event } as MessageEvent)
    FakeChannel.instances[1]!.onmessage?.({ data: event } as MessageEvent)
    expect(first).toHaveBeenCalledWith(event)
    expect(second).toHaveBeenCalledWith(event)

    unsubscribeFirst()
    expect(FakeChannel.instances[0]!.closed).toBe(true)
    expect(FakeChannel.instances[1]!.closed).toBe(false)
    FakeChannel.instances[1]!.onmessage?.({ data: { ...event, nonce: 'event-2' } } as MessageEvent)
    expect(second).toHaveBeenCalledTimes(2)
    unsubscribeSecond()
  })

  it('does not report committed generation failure when both notifications fail', async () => {
    class FailingChannel extends FakeChannel {
      override postMessage() { throw new Error('Synthetic channel failure') }
    }
    installWindow({
      BroadcastChannel: FailingChannel,
      localStorage: { setItem: () => { throw new Error('Synthetic storage-event failure') } },
    })
    const { publishBiometricGeneration } = await import('../../packages/core/src/services/BiometricSessionService')

    expect(() => publishBiometricGeneration('wallet-a', 5)).not.toThrow()
  })

  it('loads and publishes valid UUID events without crypto.randomUUID', async () => {
    let nextByte = 0
    const setItem = vi.fn()
    installWindow({
      crypto: {
        getRandomValues: (array: Uint8Array) => {
          for (let index = 0; index < array.length; index += 1) array[index] = nextByte++ & 0xff
          return array
        },
      },
      localStorage: { setItem },
    })

    const { publishBiometricGeneration } = await import('../../packages/core/src/services/BiometricSessionService')
    const {
      publishWalletInvalidation,
      withWalletAuthorizationBarrier,
    } = await import('../../packages/core/src/services/WalletSessionService')

    expect(() => publishBiometricGeneration('wallet-a', 7)).not.toThrow()
    await expect(withWalletAuthorizationBarrier(async scope => publishWalletInvalidation(scope)))
      .resolves.toBeTypeOf('string')
    expect(setItem).toHaveBeenCalledTimes(2)

    const biometric = JSON.parse(setItem.mock.calls[0]![1]) as { sourceId: string; nonce: string }
    const wallet = JSON.parse(setItem.mock.calls[1]![1]) as { sourceId: string; nonce: string }
    for (const identifier of [biometric.sourceId, biometric.nonce, wallet.sourceId, wallet.nonce]) {
      expect(identifier).toMatch(uuidV4)
    }
    expect(new Set([biometric.sourceId, biometric.nonce, wallet.sourceId, wallet.nonce]).size).toBe(4)
  })
})
