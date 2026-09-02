import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workerScript = fileURLToPath(new URL('../../apps/web/public/wallet-reset-barrier-sw.js', import.meta.url))
const protocol = 'goldenera-wallet-reset-barrier-v1'

type WorkerMessage = { type: string; protocol: string; requestId: string; nonce?: string }
type FakeClient = {
  id: string
  url: string
  postMessage: (message: WorkerMessage) => void
  navigate: (url: string) => Promise<unknown>
}
type ReplyPort = { messages: Record<string, unknown>[]; closed: boolean; postMessage: (message: Record<string, unknown>) => void; close: () => void }

async function loadWorker(matchAll: () => Promise<FakeClient[]> | FakeClient[]) {
  let messageListener!: (event: Record<string, unknown>) => void
  const matchOptions: unknown[] = []
  const scope = {
    location: { origin: 'https://wallet.example' },
    crypto: { randomUUID: () => 'public-test-nonce' },
    clients: {
      matchAll: (options: unknown) => {
        matchOptions.push(options)
        return matchAll()
      },
    },
    addEventListener: (type: string, listener: typeof messageListener) => {
      if (type === 'message') messageListener = listener
    },
  }
  const source = await readFile(workerScript, 'utf8')
  vm.runInNewContext(source, {
    self: scope,
    URL,
    Map,
    Set,
    Promise,
    Date,
    Error,
    AbortController,
    setTimeout,
    clearTimeout,
  })
  return { messageListener, matchOptions }
}

function port(): ReplyPort {
  const result: ReplyPort = {
    messages: [],
    closed: false,
    postMessage: message => result.messages.push(message),
    close: () => { result.closed = true },
  }
  return result
}

function dispatchRequest(
  messageListener: (event: Record<string, unknown>) => void,
  caller: FakeClient,
  requestId = 'public-test-request',
  reply = port(),
) {
  let pending = Promise.resolve()
  messageListener({
    data: { type: 'GE_WALLET_RESET_PREPARE', protocol, requestId },
    source: caller,
    ports: [reply],
    waitUntil: (promise: Promise<void>) => { pending = promise },
  })
  return { reply, pending }
}

function attestingClient(id: string, url: string, listener: { current?: (event: Record<string, unknown>) => void }): FakeClient {
  const client = {
    id,
    url,
    postMessage: (message: WorkerMessage) => {
      if (message.type === 'GE_WALLET_RESET_CHALLENGE') {
        listener.current?.({
          data: { type: 'GE_WALLET_RESET_ATTESTED', protocol, requestId: message.requestId, nonce: message.nonce },
          source: client,
          ports: [],
        })
      }
    },
    navigate: async () => client,
  } satisfies FakeClient
  return client
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('production service-worker reset barrier', () => {
  it('includes uncontrolled windows, uses two stable rounds, and resets stability for a new client', async () => {
    const listener: { current?: (event: Record<string, unknown>) => void } = {}
    const caller = attestingClient('current-caller', 'https://wallet.example/settings', listener)
    const newClient = attestingClient('late-client', 'https://wallet.example/import', listener)
    let rounds = 0
    const loaded = await loadWorker(() => {
      rounds += 1
      return rounds === 1 ? [caller] : [caller, newClient]
    })
    listener.current = loaded.messageListener

    const request = dispatchRequest(loaded.messageListener, caller)
    await vi.runAllTimersAsync()
    await request.pending

    expect(request.reply.messages).toEqual([{ ok: true, protocol }])
    expect(loaded.matchOptions).toContainEqual({ type: 'window', includeUncontrolled: true })
    expect(rounds).toBeGreaterThanOrEqual(4)
  })

  it('starts eligible navigations independently when another client never settles', async () => {
    const listener: { current?: (event: Record<string, unknown>) => void } = {}
    const caller = attestingClient('current-caller', 'https://wallet.example/delete-wallet', listener)
    let secondNavigations = 0
    const never = {
      id: 'never-settles',
      url: 'https://wallet.example/create',
      postMessage: () => undefined,
      navigate: () => new Promise(() => undefined),
    } satisfies FakeClient
    const second = {
      id: 'also-stale',
      url: 'https://wallet.example/import',
      postMessage: () => undefined,
      navigate: async () => { secondNavigations += 1; return second },
    } satisfies FakeClient
    const loaded = await loadWorker(() => [caller, never, second])
    listener.current = loaded.messageListener

    const request = dispatchRequest(loaded.messageListener, caller)
    await vi.runAllTimersAsync()
    await request.pending

    expect(secondNavigations).toBe(1)
    expect(request.reply.messages).toMatchObject([{ ok: false, protocol, unresolvedClients: 2 }])
  })

  it('fences never-settling navigation and ignores late completion after cleanup', async () => {
    const listener: { current?: (event: Record<string, unknown>) => void } = {}
    const caller = attestingClient('current-caller', 'https://wallet.example/delete-wallet', listener)
    let resolveLate!: (value: FakeClient) => void
    let rejectLate!: (error: Error) => void
    const lateNavigation = new Promise<FakeClient>(resolve => { resolveLate = resolve })
    const rejectedNavigation = new Promise<FakeClient>((_resolve, reject) => { rejectLate = reject })
    const stale = {
      id: 'late-navigation',
      url: 'https://wallet.example/create',
      postMessage: () => undefined,
      navigate: () => lateNavigation,
    } satisfies FakeClient
    const rejected = {
      id: 'late-rejection',
      url: 'https://wallet.example/import',
      postMessage: () => undefined,
      navigate: () => rejectedNavigation,
    } satisfies FakeClient
    const loaded = await loadWorker(() => [caller, stale, rejected])
    listener.current = loaded.messageListener

    const request = dispatchRequest(loaded.messageListener, caller)
    await vi.runAllTimersAsync()
    await request.pending
    resolveLate(stale)
    rejectLate(new Error('late navigation rejection'))
    await vi.runAllTimersAsync()

    expect(request.reply.messages).toHaveLength(1)
    expect(request.reply.closed).toBe(true)
  })

  it('rejects duplicates without extending the original and permits an ID only after cleanup', async () => {
    const listener: { current?: (event: Record<string, unknown>) => void } = {}
    const caller = attestingClient('current-caller', 'https://wallet.example/settings', listener)
    const loaded = await loadWorker(() => [caller])
    listener.current = loaded.messageListener
    const original = dispatchRequest(loaded.messageListener, caller, 'reused-id')
    const duplicate = dispatchRequest(loaded.messageListener, caller, 'reused-id')

    expect(duplicate.reply.messages).toEqual([{
      ok: false,
      protocol,
      reason: 'A duplicate wallet update request was rejected.',
    }])
    expect(duplicate.reply.closed).toBe(true)
    await vi.runAllTimersAsync()
    await original.pending

    const reused = dispatchRequest(loaded.messageListener, caller, 'reused-id')
    await vi.runAllTimersAsync()
    await reused.pending
    expect(reused.reply.messages).toEqual([{ ok: true, protocol }])
  })

  it('does not accept attestations with an external source or wrong nonce', async () => {
    const listener: { current?: (event: Record<string, unknown>) => void } = {}
    const caller = attestingClient('current-caller', 'https://wallet.example/settings', listener)
    let nonce = ''
    const stale = {
      id: 'stale-client',
      url: 'https://wallet.example/import',
      postMessage: (message: WorkerMessage) => { nonce = message.nonce ?? '' },
      navigate: async () => stale,
    } satisfies FakeClient
    let externalChallenges = 0
    const external = {
      id: 'external-client',
      url: 'https://evil.example/',
      postMessage: () => { externalChallenges += 1 },
      navigate: async () => external,
    } satisfies FakeClient
    const loaded = await loadWorker(() => [caller, stale, external])
    listener.current = loaded.messageListener
    const request = dispatchRequest(loaded.messageListener, caller)
    await vi.advanceTimersByTimeAsync(1)
    loaded.messageListener({
      data: { type: 'GE_WALLET_RESET_ATTESTED', protocol, requestId: 'public-test-request', nonce },
      source: external,
      ports: [],
    })
    loaded.messageListener({
      data: { type: 'GE_WALLET_RESET_ATTESTED', protocol, requestId: 'public-test-request', nonce: 'wrong' },
      source: stale,
      ports: [],
    })
    await vi.runAllTimersAsync()
    await request.pending

    expect(request.reply.messages).toMatchObject([{ ok: false, protocol, unresolvedClients: 1 }])
    expect(externalChallenges).toBe(0)
  })
})
