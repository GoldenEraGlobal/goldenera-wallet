import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const protocol = 'goldenera-wallet-reset-barrier-v1'
let previousNavigator: typeof globalThis.navigator
let previousChannel: typeof globalThis.MessageChannel

class FakePort {
  peer?: FakePort
  closed = false
  onmessage: ((event: MessageEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(data: unknown): void {
    this.peer?.onmessage?.({ data } as MessageEvent)
  }

  close(): void {
    this.closed = true
  }
}

class FakeMessageChannel {
  readonly port1 = new FakePort()
  readonly port2 = new FakePort()

  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

type WorkerHandler = (message: Record<string, unknown>, port: FakePort) => void

function worker(handler: WorkerHandler) {
  const events = new EventTarget()
  return Object.assign(events, {
    postMessage: (message: Record<string, unknown>, ports: readonly FakePort[] = []) => handler(message, ports[0]!),
  }) as unknown as ServiceWorker
}

function setup(initial: ServiceWorker, update: () => Promise<unknown> | unknown = () => undefined) {
  const serviceWorkerEvents = new EventTarget()
  const registrationEvents = new EventTarget()
  const registration = Object.assign(registrationEvents, {
    active: initial,
    installing: null,
    waiting: null,
    update: vi.fn(update),
  }) as unknown as ServiceWorkerRegistration
  const serviceWorker = Object.assign(serviceWorkerEvents, {
    controller: initial,
    getRegistration: vi.fn(async () => registration),
  })
  vi.stubGlobal('navigator', { serviceWorker })
  return {
    registration,
    serviceWorker,
    replace(next: ServiceWorker, notify = true) {
      ;(registration as { active: ServiceWorker }).active = next
      ;(serviceWorker as { controller: ServiceWorker }).controller = next
      if (notify) serviceWorkerEvents.dispatchEvent(new Event('controllerchange'))
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(0)
  previousNavigator = globalThis.navigator
  previousChannel = globalThis.MessageChannel
  vi.stubGlobal('MessageChannel', FakeMessageChannel)
})

afterEach(() => {
  vi.useRealTimers()
  vi.stubGlobal('navigator', previousNavigator)
  vi.stubGlobal('MessageChannel', previousChannel)
})

describe('PWA wallet reset barrier client', () => {
  it('attests challenges and lets the current worker succeed after a hung update check', async () => {
    const attested: Record<string, unknown>[] = []
    const current = worker((message, port) => {
      if (message.type === 'GE_WALLET_RESET_ATTESTED') attested.push(message)
      if (message.type === 'GE_WALLET_RESET_PREPARE') port.postMessage({ ok: true, protocol })
    })
    const { serviceWorker } = setup(current, () => new Promise(() => undefined))
    const client = await import('../../apps/web/src/WalletResetBarrierClient')
    client.installPwaWalletResetAttestation()
    const challenge = new Event('message') as MessageEvent
    Object.defineProperties(challenge, {
      data: { value: { type: 'GE_WALLET_RESET_CHALLENGE', protocol, requestId: 'public-request', nonce: 'public-nonce' } },
      source: { value: current },
    })
    serviceWorker.dispatchEvent(challenge)

    expect(attested).toEqual([{
      type: 'GE_WALLET_RESET_ATTESTED',
      protocol,
      requestId: 'public-request',
      nonce: 'public-nonce',
    }])
    const reset = client.preparePwaWalletReset()
    await vi.advanceTimersByTimeAsync(2_500)

    await expect(reset).resolves.toBeUndefined()
  })

  it('uses registration.active before a redundant controller and succeeds unchanged', async () => {
    const active = worker((message, port) => {
      if (message.type === 'GE_WALLET_RESET_PREPARE') port.postMessage({ ok: true, protocol })
    })
    const controller = worker(() => { throw new Error('controller must not receive a barrier request') })
    const { serviceWorker } = setup(active)
    ;(serviceWorker as { controller: ServiceWorker }).controller = controller
    const client = await import('../../apps/web/src/WalletResetBarrierClient')

    await expect(client.preparePwaWalletReset()).resolves.toBeUndefined()
  })

  it('uses a silently replaced worker at the reserved handoff boundary', async () => {
    const oldPorts: FakePort[] = []
    const oldWorker = worker((_message, port) => { oldPorts.push(port) })
    const replacement = worker((message, port) => {
      if (message.type === 'GE_WALLET_RESET_PREPARE') port.postMessage({ ok: true, protocol })
    })
    const harness = setup(oldWorker)
    const client = await import('../../apps/web/src/WalletResetBarrierClient')
    const reset = client.preparePwaWalletReset()
    await vi.advanceTimersByTimeAsync(3_000)
    harness.replace(replacement, false)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(reset).resolves.toBeUndefined()
    expect(oldPorts[0]?.closed).toBe(true)
  })

  it('aborts an old request when replacement wins and ignores its late success', async () => {
    let oldPort: FakePort | undefined
    let replacementRequests = 0
    const oldWorker = worker((_message, port) => { oldPort = port })
    const replacement = worker((message, port) => {
      if (message.type === 'GE_WALLET_RESET_PREPARE') {
        replacementRequests += 1
        port.postMessage({ ok: true, protocol })
      }
    })
    const harness = setup(oldWorker)
    const client = await import('../../apps/web/src/WalletResetBarrierClient')
    const reset = client.preparePwaWalletReset()
    await vi.advanceTimersByTimeAsync(1)
    harness.replace(replacement)
    oldPort?.postMessage({ ok: true, protocol })

    await expect(reset).resolves.toBeUndefined()
    expect(oldPort?.closed).toBe(true)
    expect(replacementRequests).toBe(1)
  })

  it('fails closed when neither the old request nor a replacement arrives', async () => {
    const current = worker(() => undefined)
    setup(current)
    const client = await import('../../apps/web/src/WalletResetBarrierClient')
    const reset = client.preparePwaWalletReset()
    const failed = expect(reset).rejects.toThrow('Open wallet windows did not finish updating in time')
    await vi.advanceTimersByTimeAsync(8_000)

    await failed
  })

  it('fails closed after a replacement when both barrier workers stay silent', async () => {
    let oldRequests = 0
    let newRequests = 0
    const oldWorker = worker(() => { oldRequests += 1 })
    const replacement = worker(() => { newRequests += 1 })
    const harness = setup(oldWorker)
    const client = await import('../../apps/web/src/WalletResetBarrierClient')
    const reset = client.preparePwaWalletReset()
    const failed = expect(reset).rejects.toThrow('Open wallet windows did not finish updating in time')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.replace(replacement)
    await vi.advanceTimersByTimeAsync(11_000)

    await failed
    expect(oldRequests).toBe(1)
    expect(newRequests).toBe(1)
  })

  it('requires a useful request window after a slow registration lookup', async () => {
    const current = worker(() => undefined)
    const harness = setup(current)
    ;(harness.serviceWorker.getRegistration as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(harness.registration), 7_500)),
    )
    const client = await import('../../apps/web/src/WalletResetBarrierClient')
    const reset = client.preparePwaWalletReset()
    const failed = expect(reset).rejects.toThrow('Open wallet windows did not finish updating in time')
    await vi.advanceTimersByTimeAsync(7_500)

    await failed
  })

  it.each([
    ['synchronous postMessage failure', (port: FakePort) => { port.close(); throw new Error('synthetic send failure') }],
    ['invalid response', (port: FakePort) => port.postMessage({ ok: 'yes', protocol })],
    ['message decoding failure', (port: FakePort) => port.peer?.onmessageerror?.()],
  ])('cleans up ports for %s', async (_name, respond) => {
    let requestPort: FakePort | undefined
    const current = worker((_message, port) => {
      requestPort = port
      respond(port)
    })
    setup(current)
    const client = await import('../../apps/web/src/WalletResetBarrierClient')

    await expect(client.preparePwaWalletReset()).rejects.toThrow()
    expect(requestPort?.closed).toBe(true)
    expect(requestPort?.peer?.closed).toBe(true)
  })
})
