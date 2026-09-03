import { PrivateKey } from '@goldenera/cryptoj'
import { afterEach, describe, expect, it, vi } from 'vitest'

const productionJournal = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  createUuid: vi.fn(() => '00000000-0000-4000-8000-000000000900'),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: productionJournal.get, set: productionJournal.set },
}))
vi.mock('../../packages/core/src/utils/UuidUtil', () => ({
  createUuid: productionJournal.createUuid,
}))

import {
  TransferBlockedError,
  TransferCoordinationUnavailableError,
  TransferCoordinator,
  TransferDurableUnknownError,
  TransferPreflightError,
  TransferSessionChangedError,
  type TransferBalanceRequest,
  type TransferCoordinatorDependencies,
  type TransferFeeLevel,
  type TransferJournalPort,
  type WalletAuthorizationSnapshot,
} from '../../packages/core/src/services/TransferCoordinator'
import {
  TransferJournalRecoveryBlockedError,
  TransferJournalRecoveryRequiredError,
  TransferJournalService,
} from '../../packages/core/src/services/TransferJournalService'
import type {
  NewTransferAttempt,
  TransferJournalRecord,
  TransferJournalRecoveryState,
  TransferJournalState,
  TransferJournalTransitionOptions,
} from '../../packages/core/src/services/TransferJournalService'
import {
  publishWalletInvalidation,
  withWalletAuthorizationBarrier,
} from '../../packages/core/src/services/WalletSessionService'
import golden from '../fixtures/crypto-v0.2.0.json'

const native = '0x0000000000000000000000000000000000000000'
const recipient = '0x2222222222222222222222222222222222222222'
const token = '0x3333333333333333333333333333333333333333'
const otherToken = '0x4444444444444444444444444444444444444444'
const now = 1_700_000_000_000
const recommendation = {
  baseFee: '1000', feePerByte: '10', minimumTotalFee: '2500', miningFeePerByte: '0', totalForAverageTx: '2500',
}
const keyA = PrivateKey.fromMnemonic(golden.seeds[0].mnemonic, golden.seeds[0].passphrase, golden.seeds[0].index)
const keyB = PrivateKey.fromMnemonic(golden.seeds[1].mnemonic, golden.seeds[1].passphrase, golden.seeds[1].index)
const senderA = keyA.getAddress().toLowerCase()
const senderB = keyB.getAddress().toLowerCase()

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const observedStates = [
  'pending',
  'confirming',
  'confirmed',
  'absent-reusable',
  'consumed-superseded',
  'blocked-unknown',
] as const satisfies readonly TransferJournalState[]

const transitionMatrix: Record<TransferJournalState, ReadonlySet<TransferJournalState>> = {
  dispatching: new Set(['accepted', 'rejected', 'unknown', ...observedStates]),
  accepted: new Set(observedStates),
  rejected: new Set(),
  unknown: new Set(observedStates),
  pending: new Set(['confirming', 'confirmed', 'absent-reusable', 'consumed-superseded', 'blocked-unknown']),
  confirming: new Set(['pending', 'confirmed', 'absent-reusable', 'consumed-superseded', 'blocked-unknown']),
  confirmed: new Set(),
  'absent-reusable': new Set(),
  'consumed-superseded': new Set(),
  'blocked-unknown': new Set(['pending', 'confirming', 'confirmed', 'absent-reusable', 'consumed-superseded']),
}

class MemoryJournal implements TransferJournalPort {
  records: TransferJournalRecord[] = []
  recovery: TransferJournalRecoveryState = {
    status: 'clear', issues: [], detectedAt: null, recoveredAt: null, globalBlocked: false, blockedSenders: [],
  }
  createCalls: NewTransferAttempt[] = []
  transitionCalls: Array<{
    attemptId: string
    state: TransferJournalState
    options: TransferJournalTransitionOptions | undefined
  }> = []
  failCreate = false
  failAfterPersistingUnknownTransition = false
  omitReadback = false
  beforeCreate: (() => void) | null = null
  beforeCreateGate: Promise<void> | null = null
  onCreate: (() => void) | null = null

  seed(record: TransferJournalRecord) {
    this.records.push(record)
  }

  async read() { return this.records.map(record => ({ ...record })) }

  async getRecoveryState() { return this.recovery }

  async recover() {
    this.recovery = { ...this.recovery, status: 'resolved', recoveredAt: now, globalBlocked: false, blockedSenders: [] }
    return this.recovery
  }

  async createDispatching(input: NewTransferAttempt): Promise<TransferJournalRecord> {
    this.createCalls.push(structuredClone(input))
    this.beforeCreate?.()
    await this.beforeCreateGate
    if (this.failCreate) throw new Error('synthetic persistence failure')
    if (this.records.some(record => record.hash === input.hash)) throw new Error('duplicate hash')
    const record: TransferJournalRecord = {
      version: 1,
      ...input,
      sender: input.sender.toLowerCase(),
      recipient: input.recipient.toLowerCase(),
      tokenAddress: input.tokenAddress.toLowerCase(),
      hash: input.hash.toLowerCase(),
      state: 'dispatching',
      updatedAt: input.submissionStartedAt,
    }
    this.records.push(record)
    this.onCreate?.()
    return { ...record }
  }

  async transition(
    attemptId: string,
    state: TransferJournalState,
    updatedAt = now,
    options?: TransferJournalTransitionOptions,
  ): Promise<TransferJournalRecord> {
    this.transitionCalls.push({ attemptId, state, options })
    const index = this.records.findIndex(record => record.attemptId === attemptId)
    if (index < 0) throw new Error('missing record')
    const current = this.records[index]!
    if (current.state !== state && !transitionMatrix[current.state].has(state)) throw new Error('illegal transition')
    const reanchorsClockRollback = options?.source === 'reconciliation' &&
      options.reanchorClockRollback === true && state === 'blocked-unknown' && updatedAt < current.updatedAt
    const refreshesObservationAnchor = current.state === state &&
      (state === 'pending' || state === 'confirming') && updatedAt > current.updatedAt
    const next = reanchorsClockRollback
      ? { ...current, state, updatedAt }
      : current.state === state
        ? refreshesObservationAnchor ? { ...current, updatedAt } : current
        : { ...current, state, updatedAt: Math.max(updatedAt, current.updatedAt) }
    this.records[index] = next
    if (this.failAfterPersistingUnknownTransition && state === 'unknown') {
      throw new Error('synthetic post-persistence unknown failure')
    }
    return { ...next }
  }

  async find(attemptId: string) {
    if (this.omitReadback) return null
    const record = this.records.find(candidate => candidate.attemptId === attemptId)
    return record ? { ...record } : null
  }

  async listForSender(network: 'MAINNET', sender: string) {
    return this.records
      .filter(record => record.network === network && record.sender === sender.toLowerCase())
      .map(record => ({ ...record }))
  }
}

function transactionStatus(
  identity: Pick<TransferJournalRecord, 'hash' | 'sender' | 'nonce'>,
  status: 'PENDING' | 'CONFIRMING' | 'CONFIRMED' | 'ABSENT_REUSABLE' | 'CONSUMED_SUPERSEDED' | 'BLOCKED_UNKNOWN',
  nextNonce: string | null,
  confirmations = status === 'CONFIRMED' ? '6' : status === 'CONFIRMING' ? '1' : null,
) {
  return {
    status,
    hash: identity.hash,
    sender: identity.sender,
    nonce: identity.nonce,
    nextNonce,
    confirmations,
    requiredConfirmations: '6',
  }
}

function journalRecord(
  index: number,
  state: TransferJournalState,
  overrides: Partial<TransferJournalRecord> = {},
): TransferJournalRecord {
  return {
    version: 1,
    attemptId: uuid(100 + index),
    network: 'MAINNET',
    walletId: 'wallet-previous',
    vaultRevision: 1,
    sender: senderA,
    recipient,
    tokenAddress: native,
    hash: `0x${index.toString(16).padStart(64, '0')}`,
    nonce: String(index),
    amount: '100000000',
    fee: '2500',
    signedSize: 137,
    state,
    createdAt: now - 10_000 + index,
    updatedAt: now - 10_000 + index,
    submissionStartedAt: now - 10_000 + index,
    ...overrides,
  }
}

interface SetupOptions {
  sender?: string
  key?: PrivateKey
  journal?: MemoryJournal
  submissionTimeoutMs?: number
  reconciliationTimeoutMs?: number
  propagationGraceMs?: number
}

function setup(options: SetupOptions = {}) {
  const sender = options.sender ?? senderA
  const privateKey = options.key ?? keyA
  const journal = options.journal ?? new MemoryJournal()
  const snapshot: WalletAuthorizationSnapshot = {
    walletId: `wallet-${sender.slice(-8)}`,
    vaultRevision: 2,
    generation: 3,
    storageToken: 'session-token',
    sender,
  }
  let nextNonce: unknown = '7'
  let balances: unknown = [
    { address: sender, tokenAddress: native, balance: '1000000000000' },
    { address: sender, tokenAddress: token, balance: '1000000000000' },
  ]
  let fees: unknown = { ...recommendation }
  let statusResult: unknown = null
  let id = 1
  let clock = now
  const dependencies: TransferCoordinatorDependencies = {
    getWalletSnapshot: vi.fn(async () => ({ ...snapshot })),
    getNextNonce: vi.fn(async () => nextNonce),
    getBalances: vi.fn(async (_request: TransferBalanceRequest, _signal: AbortSignal) => structuredClone(balances)),
    getFeeRecommendation: vi.fn(async (_feeLevel: TransferFeeLevel, _signal: AbortSignal) => structuredClone(fees)),
    getPrivateKey: vi.fn(async () => privateKey),
    submitTransaction: vi.fn(async () => ({ status: 'SUCCESS' })),
    getTransactionStatus: vi.fn(async () => structuredClone(statusResult)),
    journal,
    now: () => clock,
    randomUUID: () => uuid(id++),
    reviewMaxAgeMs: 120_000,
    preflightTimeoutMs: 1_000,
    submissionTimeoutMs: options.submissionTimeoutMs ?? 1_000,
    ...(options.reconciliationTimeoutMs === undefined
      ? {}
      : { reconciliationTimeoutMs: options.reconciliationTimeoutMs }),
    propagationGraceMs: options.propagationGraceMs ?? 1_000,
  }
  const coordinator = new TransferCoordinator(dependencies)
  return {
    coordinator,
    dependencies,
    journal,
    snapshot,
    setNextNonce: (value: unknown) => { nextNonce = value },
    setBalances: (value: unknown) => { balances = value },
    setFees: (value: unknown) => { fees = value },
    setStatus: (value: unknown) => { statusResult = value },
    setNow: (value: number) => { clock = value },
  }
}

async function prepareNative(coordinator: TransferCoordinator, sender = senderA) {
  return coordinator.prepare({ sender, recipient, tokenAddress: native, amount: '100000000', feeLevel: 'standard' })
}

function installNoLockBrowser() {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
  return () => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete (globalThis as { navigator?: unknown }).navigator
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
    else delete (globalThis as { document?: unknown }).document
  }
}

interface QueuedLockRequest {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

class DeterministicLockManager {
  private readonly active = new Set<string>()
  private readonly queues = new Map<string, QueuedLockRequest[]>()

  request<T>(name: string, operation: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queue = this.queues.get(name) ?? []
      queue.push({
        run: () => Promise.resolve().then(operation),
        resolve: value => resolve(value as T),
        reject,
      })
      this.queues.set(name, queue)
      this.drain(name)
    })
  }

  pending(name: string): number {
    return this.queues.get(name)?.length ?? 0
  }

  private drain(name: string): void {
    if (this.active.has(name)) return
    const queue = this.queues.get(name)
    const request = queue?.shift()
    if (!request) {
      this.queues.delete(name)
      return
    }
    this.active.add(name)
    void request.run().then(request.resolve, request.reject).finally(() => {
      this.active.delete(name)
      this.drain(name)
    })
  }
}

function installLockBrowser(locks: DeterministicLockManager) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    },
  })
  return () => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete (globalThis as { navigator?: unknown }).navigator
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
    else delete (globalThis as { document?: unknown }).document
    if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor)
    else Reflect.deleteProperty(window, 'localStorage')
  }
}

afterEach(() => {
  vi.useRealTimers()
  productionJournal.values.clear()
  productionJournal.get.mockReset()
  productionJournal.set.mockReset()
  productionJournal.createUuid.mockReset()
  productionJournal.createUuid.mockReturnValue('00000000-0000-4000-8000-000000000900')
})

describe('TransferCoordinator final authorization and dispatch', () => {
  it('fails closed before any dependency access in a browser without Web Locks', async () => {
    const environment = setup()
    const review = await prepareNative(environment.coordinator)
    vi.mocked(environment.dependencies.getWalletSnapshot).mockClear()
    vi.mocked(environment.dependencies.getNextNonce).mockClear()
    vi.mocked(environment.dependencies.getBalances).mockClear()
    vi.mocked(environment.dependencies.getFeeRecommendation).mockClear()
    const restore = installNoLockBrowser()
    try {
      await expect(environment.coordinator.confirm(review)).rejects.toBeInstanceOf(TransferCoordinationUnavailableError)
      expect(environment.dependencies.getWalletSnapshot).not.toHaveBeenCalled()
      expect(environment.dependencies.getNextNonce).not.toHaveBeenCalled()
      expect(environment.dependencies.getBalances).not.toHaveBeenCalled()
      expect(environment.dependencies.getFeeRecommendation).not.toHaveBeenCalled()
      expect(environment.journal.createCalls).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('returns a fresh review without signing or dispatch when final preflight changes', async () => {
    const environment = setup()
    const review = await prepareNative(environment.coordinator)
    environment.setNextNonce('8')

    const result = await environment.coordinator.confirm(review)

    expect(result.kind).toBe('reconfirm')
    if (result.kind === 'reconfirm') expect(result.review.nonce).toBe('8')
    expect(environment.dependencies.getPrivateKey).not.toHaveBeenCalled()
    expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()
    expect(environment.journal.createCalls).toHaveLength(0)
  })

  it('binds the selected fee level and exact balance token context into final preflight', async () => {
    const environment = setup()
    environment.journal.seed(journalRecord(6, 'accepted', {
      nonce: '6',
      tokenAddress: otherToken,
      amount: '900000000000',
      fee: '2500',
    }))
    const fastReview = await environment.coordinator.prepare({
      sender: senderA,
      recipient,
      tokenAddress: token,
      amount: '100000000',
      feeLevel: 'fast',
    })

    expect(fastReview.feeLevel).toBe('fast')
    expect(fastReview.balanceFingerprint).toBe(
      `${senderA}|${native}=1000000000000|${token}=1000000000000`,
    )
    expect(Object.isFrozen(fastReview)).toBe(true)
    expect(environment.dependencies.getFeeRecommendation).toHaveBeenLastCalledWith('fast', expect.any(AbortSignal))
    expect(environment.dependencies.getBalances).toHaveBeenLastCalledWith({
      sender: senderA,
      tokenAddresses: [token, native],
    }, expect.any(AbortSignal))

    environment.setFees({ ...recommendation, minimumTotalFee: '5000', totalForAverageTx: '5000' })
    const result = await environment.coordinator.confirm(fastReview)
    expect(result.kind).toBe('reconfirm')
    if (result.kind === 'reconfirm') {
      expect(result.review.feeLevel).toBe('fast')
      expect(result.review.fee).toBe('5000')
    }
    expect(environment.dependencies.getFeeRecommendation).toHaveBeenLastCalledWith('fast', expect.any(AbortSignal))
    expect(environment.dependencies.getPrivateKey).not.toHaveBeenCalled()

    const nativeEnvironment = setup()
    await prepareNative(nativeEnvironment.coordinator)
    expect(nativeEnvironment.dependencies.getBalances).toHaveBeenLastCalledWith({
      sender: senderA,
      tokenAddresses: [native],
    }, expect.any(AbortSignal))
  })

  it('persists verified public dispatch metadata before the only POST', async () => {
    const environment = setup()
    vi.mocked(environment.dependencies.submitTransaction).mockImplementation(async hexData => {
      expect(hexData).toMatch(/^0x[0-9a-f]+$/)
      expect(environment.journal.records).toHaveLength(1)
      expect(environment.journal.records[0]?.state).toBe('dispatching')
      return { status: 'SUCCESS' }
    })
    const review = await prepareNative(environment.coordinator)

    const result = await environment.coordinator.confirm(review)

    expect(result.kind).toBe('accepted')
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
    const persisted = JSON.stringify(environment.journal.createCalls[0])
    expect(persisted).not.toMatch(/mnemonic|privateKey|signature|signedBytes|hexData|password|prf/i)
    expect(Object.keys(environment.journal.createCalls[0]!).sort()).toEqual([
      'amount', 'attemptId', 'createdAt', 'fee', 'hash', 'network', 'nonce', 'recipient',
      'sender', 'signedSize', 'submissionStartedAt', 'tokenAddress', 'vaultRevision', 'walletId',
    ].sort())
  })

  it('returns accepted after the accepted journal write when event nonce allocation fails', async () => {
    productionJournal.get.mockImplementation(async ({ key }: { key: string }) => ({
      value: productionJournal.values.get(key) ?? null,
    }))
    productionJournal.set.mockImplementation(async ({ key, value }: { key: string, value: string }) => {
      productionJournal.values.set(key, value)
    })
    productionJournal.createUuid
      .mockImplementationOnce(() => uuid(800))
      .mockImplementationOnce(() => { throw new Error('synthetic accepted-event UUID failure') })

    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { crypto: {} } })
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: { request: vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation()) } },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      const snapshot: WalletAuthorizationSnapshot = {
        walletId: 'wallet-production-journal',
        vaultRevision: 2,
        generation: 3,
        storageToken: 'session-token',
        sender: senderA,
      }
      const submitTransaction = vi.fn(async () => ({ status: 'SUCCESS' }))
      let id = 1
      const coordinator = new TransferCoordinator({
        getWalletSnapshot: async () => snapshot,
        getNextNonce: async () => '7',
        getBalances: async () => [
          { address: senderA, tokenAddress: native, balance: '1000000000000' },
        ],
        getFeeRecommendation: async () => recommendation,
        getPrivateKey: async () => keyA,
        submitTransaction,
        getTransactionStatus: async () => null,
        journal: TransferJournalService,
        now: () => now,
        randomUUID: () => uuid(id++),
        reviewMaxAgeMs: 120_000,
        preflightTimeoutMs: 1_000,
        submissionTimeoutMs: 1_000,
        propagationGraceMs: 1_000,
      })

      const result = await coordinator.confirm(await prepareNative(coordinator))

      expect(result).toMatchObject({ kind: 'accepted' })
      expect(submitTransaction).toHaveBeenCalledTimes(1)
      if (result.kind !== 'accepted') throw new Error('expected accepted transaction')
      await expect(TransferJournalService.find(result.record.attemptId)).resolves.toMatchObject({ state: 'accepted' })
      expect(productionJournal.set).toHaveBeenCalledTimes(2)
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
      else delete (globalThis as { window?: unknown }).window
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
    }
  })

  it('anchors propagation grace to the durable outcome after a long suspension before POST', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const review = await prepareNative(environment.coordinator)
    environment.journal.onCreate = () => { environment.setNow(now + 120_000) }

    const result = await environment.coordinator.confirm(review)

    expect(result.kind).toBe('accepted')
    if (result.kind !== 'accepted') throw new Error('expected accepted transaction')
    expect(result.record.submissionStartedAt).toBe(now)
    expect(result.record.updatedAt).toBe(now + 120_000)
    environment.setStatus(transactionStatus(
      result.record,
      'ABSENT_REUSABLE',
      result.record.nonce,
    ))

    environment.setNow(result.record.updatedAt + 999)
    const deferredRecord = (await environment.coordinator.reconcile())[0]!
    expect(deferredRecord.state).toBe('accepted')
    expect(deferredRecord.updatedAt).toBe(result.record.updatedAt)

    environment.setNow(result.record.updatedAt + 1_000)
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('absent-reusable')
  })

  it('performs zero POSTs when dispatch persistence or readback cannot be verified', async () => {
    const writeFailure = setup()
    writeFailure.journal.failCreate = true
    await expect(writeFailure.coordinator.confirm(await prepareNative(writeFailure.coordinator)))
      .rejects.toThrow('synthetic persistence failure')
    expect(writeFailure.dependencies.submitTransaction).not.toHaveBeenCalled()

    const readbackFailure = setup()
    readbackFailure.journal.omitReadback = true
    await expect(readbackFailure.coordinator.confirm(await prepareNative(readbackFailure.coordinator)))
      .rejects.toThrow(/read back and verified/)
    expect(readbackFailure.dependencies.submitTransaction).not.toHaveBeenCalled()
  })

  it.each(['SUCCESS', 'QUEUED'])('treats %s as accepted', async status => {
    const environment = setup()
    vi.mocked(environment.dependencies.submitTransaction).mockResolvedValue({ status })
    const result = await environment.coordinator.confirm(await prepareNative(environment.coordinator))
    expect(result.kind).toBe('accepted')
    expect(result.record.state).toBe('accepted')
  })

  it('persists only an unambiguous validation rejection as rejected', async () => {
    const environment = setup()
    vi.mocked(environment.dependencies.submitTransaction).mockResolvedValue({ status: 'REJECTED_FEE' })
    const result = await environment.coordinator.confirm(await prepareNative(environment.coordinator))
    expect(result.kind).toBe('rejected')
    expect(result.record.state).toBe('rejected')
  })

  it.each([
    ['STALE', { status: 'STALE' }],
    ['duplicate', { status: 'REJECTED_DUPLICATE' }],
    ['RBF', { status: 'REJECTED_RBF' }],
    ['other', { status: 'REJECTED_OTHER' }],
    ['malformed', null],
  ])('persists an observation-oriented unknown outcome for %s responses', async (_name, response) => {
    const environment = setup()
    vi.mocked(environment.dependencies.submitTransaction).mockResolvedValue(response)
    const result = await environment.coordinator.confirm(await prepareNative(environment.coordinator))
    expect(result.kind).toBe('unknown')
    expect(result.record.state).toBe('unknown')
  })

  it('persists transport failure and coordinator-owned timeout as unknown', async () => {
    const transport = setup()
    vi.mocked(transport.dependencies.submitTransaction).mockRejectedValue(new Error('connection lost'))
    expect((await transport.coordinator.confirm(await prepareNative(transport.coordinator))).kind).toBe('unknown')

    const timeout = setup({ submissionTimeoutMs: 10 })
    vi.mocked(timeout.dependencies.submitTransaction).mockImplementation((_hex, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
    const result = await timeout.coordinator.confirm(await prepareNative(timeout.coordinator))
    expect(result.kind).toBe('unknown')
    expect(result.record.state).toBe('unknown')
  })

  it('reports a typed error only when an unknown outcome was durably persisted but could not be returned', async () => {
    const environment = setup()
    environment.journal.failAfterPersistingUnknownTransition = true
    vi.mocked(environment.dependencies.submitTransaction).mockRejectedValue(new Error('connection lost'))

    await expect(environment.coordinator.confirm(await prepareNative(environment.coordinator)))
      .rejects.toBeInstanceOf(TransferDurableUnknownError)
    expect(environment.journal.records[0]).toMatchObject({ state: 'unknown' })
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
  })

  it('continues a dispatched POST after the caller detaches and never accepts a caller abort signal', async () => {
    const environment = setup()
    const response = deferred<unknown>()
    vi.mocked(environment.dependencies.submitTransaction).mockReturnValue(response.promise)
    const review = await prepareNative(environment.coordinator)
    const callerOnly = new AbortController()

    const confirmation = environment.coordinator.confirm(review)
    await vi.waitFor(() => expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1))
    callerOnly.abort()
    response.resolve({ status: 'SUCCESS' })

    await expect(confirmation).resolves.toMatchObject({ kind: 'accepted' })
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
  })

  it('does not POST after generation changes before signing or after durable dispatch', async () => {
    const beforeSign = setup()
    vi.mocked(beforeSign.dependencies.getPrivateKey).mockImplementation(async () => {
      beforeSign.snapshot.generation++
      return keyA
    })
    await expect(beforeSign.coordinator.confirm(await prepareNative(beforeSign.coordinator)))
      .rejects.toBeInstanceOf(TransferSessionChangedError)
    expect(beforeSign.journal.createCalls).toHaveLength(0)
    expect(beforeSign.dependencies.submitTransaction).not.toHaveBeenCalled()

    const afterDispatch = setup()
    afterDispatch.journal.onCreate = () => { afterDispatch.snapshot.generation++ }
    const result = await afterDispatch.coordinator.confirm(await prepareNative(afterDispatch.coordinator))
    expect(result.kind).toBe('unknown')
    expect(result.record.state).toBe('unknown')
    expect(afterDispatch.dependencies.submitTransaction).not.toHaveBeenCalled()
  })

  it('lets a transfer already inside the authorization barrier finish before revocation completes', async () => {
    const environment = setup()
    const review = await prepareNative(environment.coordinator)
    const locks = new DeterministicLockManager()
    const restore = installLockBrowser(locks)
    const transferEnteredBarrier = deferred<void>()
    const releaseTransfer = deferred<void>()
    environment.journal.beforeCreate = () => transferEnteredBarrier.resolve()
    environment.journal.beforeCreateGate = releaseTransfer.promise

    try {
      const confirmation = environment.coordinator.confirm(review)
      await transferEnteredBarrier.promise

      let revocationEntered = false
      let revocationCompleted = false
      const revocation = withWalletAuthorizationBarrier(async scope => {
        revocationEntered = true
        const nextToken = publishWalletInvalidation(scope)
        if (nextToken === null) throw new Error('expected a durable wallet session token')
        environment.snapshot.storageToken = nextToken
      })
      void revocation.then(() => { revocationCompleted = true })

      await vi.waitFor(() => {
        expect(locks.pending('goldenera-wallet-authorization-barrier')).toBe(1)
      })
      expect(revocationEntered).toBe(false)
      expect(revocationCompleted).toBe(false)
      expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()

      releaseTransfer.resolve()
      await expect(confirmation).resolves.toMatchObject({ kind: 'accepted' })
      expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
      expect(environment.journal.records).toHaveLength(1)
      expect(environment.journal.records[0]?.state).toBe('accepted')
      await expect(revocation).resolves.toBeUndefined()
      expect(revocationEntered).toBe(true)
      expect(revocationCompleted).toBe(true)
      expect(environment.snapshot.storageToken).not.toBe('session-token')
      expect(window.localStorage.getItem('ge_wallet_session_event'))
        .toBe(environment.snapshot.storageToken)
    } finally {
      releaseTransfer.resolve()
      restore()
    }
  })

  it('fences a transfer at its final barrier recheck when revocation linearizes first', async () => {
    const environment = setup()
    const review = await prepareNative(environment.coordinator)
    const locks = new DeterministicLockManager()
    const restore = installLockBrowser(locks)
    const revocationEntered = deferred<void>()
    const releaseRevocation = deferred<void>()

    try {
      const revocation = withWalletAuthorizationBarrier(async scope => {
        revocationEntered.resolve()
        await releaseRevocation.promise
        const nextToken = publishWalletInvalidation(scope)
        if (nextToken === null) throw new Error('expected a durable wallet session token')
        environment.snapshot.storageToken = nextToken
      })
      await revocationEntered.promise

      const confirmation = environment.coordinator.confirm(review)
      await vi.waitFor(() => {
        expect(locks.pending('goldenera-wallet-authorization-barrier')).toBe(1)
      })
      expect(environment.journal.createCalls).toHaveLength(0)
      expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()

      releaseRevocation.resolve()
      await expect(revocation).resolves.toBeUndefined()
      await expect(confirmation).rejects.toBeInstanceOf(TransferSessionChangedError)
      expect(environment.snapshot.storageToken).not.toBe('session-token')
      expect(window.localStorage.getItem('ge_wallet_session_event'))
        .toBe(environment.snapshot.storageToken)
      expect(environment.journal.createCalls).toHaveLength(0)
      expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()
    } finally {
      releaseRevocation.resolve()
      restore()
    }
  })

  it('validates exact uint256 strings and reserves native fees for token transfers', async () => {
    const environment = setup()
    const overflow = (1n << 256n).toString()
    await expect(environment.coordinator.prepare({
      sender: senderA,
      recipient,
      tokenAddress: native,
      amount: overflow,
      feeLevel: 'standard',
    })).rejects.toThrow()
    environment.setBalances([
      { address: senderA, tokenAddress: native, balance: '2499' },
      { address: senderA, tokenAddress: token, balance: '100000000' },
    ])
    await expect(environment.coordinator.prepare({
      sender: senderA,
      recipient,
      tokenAddress: token,
      amount: '100000000',
      feeLevel: 'standard',
    })).rejects.toThrow(/native balance/)

    environment.setBalances([{ address: senderA, tokenAddress: native, balance: 1000000000000 }])
    await expect(prepareNative(environment.coordinator)).rejects.toThrow(/invalid row/)
    environment.setNextNonce(Number.MAX_SAFE_INTEGER + 1)
    await expect(prepareNative(environment.coordinator)).rejects.toThrow(/canonical decimal string/)
    environment.setNextNonce(overflow)
    await expect(prepareNative(environment.coordinator)).rejects.toThrow(/canonical decimal string/)

    environment.setNextNonce('7')
    environment.setBalances([{ address: senderA, tokenAddress: native, balance: overflow }])
    await expect(prepareNative(environment.coordinator)).rejects.toThrow(/invalid row/)

    environment.setBalances([{ address: senderA, tokenAddress: native, balance: '1000000000000' }])
    vi.mocked(environment.dependencies.getFeeRecommendation).mockResolvedValue({
      ...recommendation,
      baseFee: overflow,
    })
    await expect(prepareNative(environment.coordinator)).rejects.toThrow()
  })

  it('treats backend available balances as already net of journaled pending debits', async () => {
    const nativeEnvironment = setup()
    nativeEnvironment.journal.seed(journalRecord(6, 'accepted', {
      nonce: '6',
      tokenAddress: native,
      amount: '900000000000',
      fee: '900000000000',
    }))
    nativeEnvironment.setBalances([{
      address: senderA,
      tokenAddress: native,
      balance: '100002500',
    }])

    const nativeReview = await prepareNative(nativeEnvironment.coordinator)
    expect(nativeReview.balanceFingerprint).toBe(`${senderA}|${native}=100002500`)

    const tokenEnvironment = setup()
    tokenEnvironment.journal.seed(journalRecord(6, 'pending', {
      nonce: '6',
      tokenAddress: token,
      amount: '900000000000',
      fee: '900000000000',
    }))
    const input = {
      sender: senderA,
      recipient,
      tokenAddress: token,
      amount: '100',
      feeLevel: 'standard' as const,
    }
    tokenEnvironment.setBalances([
      { address: senderA, tokenAddress: native, balance: '2500' },
      { address: senderA, tokenAddress: token, balance: '100' },
    ])

    const tokenReview = await tokenEnvironment.coordinator.prepare(input)
    expect(tokenReview.balanceFingerprint).toBe(`${senderA}|${native}=2500|${token}=100`)

    tokenEnvironment.setBalances([
      { address: senderA, tokenAddress: native, balance: '2499' },
      { address: senderA, tokenAddress: token, balance: '100' },
    ])
    await expect(tokenEnvironment.coordinator.prepare(input)).rejects.toThrow(/native balance/)

    tokenEnvironment.setBalances([
      { address: senderA, tokenAddress: native, balance: '2500' },
      { address: senderA, tokenAddress: token, balance: '99' },
    ])
    await expect(tokenEnvironment.coordinator.prepare(input)).rejects.toThrow(/token balance/)
  })
})

describe('TransferCoordinator sender lanes and nonce fencing', () => {
  it('serializes same-sender confirmation and makes the second review reconfirm at the accepted high-water nonce', async () => {
    const environment = setup()
    const reviewA = await prepareNative(environment.coordinator)
    const reviewB = await prepareNative(environment.coordinator)
    const response = deferred<unknown>()
    vi.mocked(environment.dependencies.submitTransaction).mockReturnValueOnce(response.promise)

    const first = environment.coordinator.confirm(reviewA)
    await vi.waitFor(() => expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1))
    const second = environment.coordinator.confirm(reviewB)
    await Promise.resolve()
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
    response.resolve({ status: 'SUCCESS' })

    await expect(first).resolves.toMatchObject({ kind: 'accepted' })
    const secondResult = await second
    expect(secondResult.kind).toBe('reconfirm')
    if (secondResult.kind === 'reconfirm') expect(secondResult.review.nonce).toBe('8')
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
    expect(environment.dependencies.getPrivateKey).toHaveBeenCalledTimes(1)
  })

  it('keeps different sender lanes independent while serializing their final dispatch barriers', async () => {
    const first = setup({ sender: senderA, key: keyA })
    const second = setup({ sender: senderB, key: keyB })
    const firstResponse = deferred<unknown>()
    const secondResponse = deferred<unknown>()
    vi.mocked(first.dependencies.submitTransaction).mockReturnValue(firstResponse.promise)
    vi.mocked(second.dependencies.submitTransaction).mockReturnValue(secondResponse.promise)
    const reviewA = await prepareNative(first.coordinator, senderA)
    const reviewB = await prepareNative(second.coordinator, senderB)

    const confirmationA = first.coordinator.confirm(reviewA)
    const confirmationB = second.coordinator.confirm(reviewB)
    await vi.waitFor(() => expect(first.dependencies.submitTransaction).toHaveBeenCalledTimes(1))
    expect(second.dependencies.submitTransaction).not.toHaveBeenCalled()

    firstResponse.resolve({ status: 'SUCCESS' })
    await expect(confirmationA).resolves.toMatchObject({ kind: 'accepted' })
    await vi.waitFor(() => expect(second.dependencies.submitTransaction).toHaveBeenCalledTimes(1))
    secondResponse.resolve({ status: 'QUEUED' })
    await expect(confirmationB).resolves.toMatchObject({ kind: 'accepted' })
  })

  it('blocks unresolved attempts across wallet IDs and revisions before node preflight', async () => {
    const environment = setup()
    environment.journal.seed(journalRecord(7, 'unknown', {
      walletId: 'another-wallet',
      vaultRevision: 99,
      sender: senderA,
    }))

    await expect(prepareNative(environment.coordinator)).rejects.toBeInstanceOf(TransferBlockedError)
    expect(environment.dependencies.getNextNonce).not.toHaveBeenCalled()
    expect(environment.dependencies.getBalances).not.toHaveBeenCalled()
  })

  it('requires explicit recovery before prepare, confirm, or reconciliation accesses the network', async () => {
    const environment = setup()
    const reviewedBeforeCorruption = await prepareNative(environment.coordinator)
    vi.mocked(environment.dependencies.getNextNonce).mockClear()
    vi.mocked(environment.dependencies.getTransactionStatus).mockClear()
    vi.mocked(environment.dependencies.getPrivateKey).mockClear()
    vi.mocked(environment.dependencies.submitTransaction).mockClear()
    environment.journal.recovery = {
      status: 'action-required',
      issues: [{ category: 'malformed-record', count: 1, network: 'MAINNET', sender: senderA }],
      detectedAt: now,
      recoveredAt: null,
      globalBlocked: false,
      blockedSenders: [senderA],
    }

    await expect(prepareNative(environment.coordinator)).rejects.toBeInstanceOf(TransferJournalRecoveryRequiredError)
    await expect(environment.coordinator.confirm(reviewedBeforeCorruption)).rejects.toBeInstanceOf(TransferJournalRecoveryRequiredError)
    await expect(environment.coordinator.reconcile()).rejects.toBeInstanceOf(TransferJournalRecoveryRequiredError)
    expect(environment.dependencies.getNextNonce).not.toHaveBeenCalled()
    expect(environment.dependencies.getTransactionStatus).not.toHaveBeenCalled()
    expect(environment.dependencies.getPrivateKey).not.toHaveBeenCalled()
    expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()

    await expect(environment.coordinator.recoverJournal()).resolves.toMatchObject({ status: 'resolved' })
    const recoveredReview = await prepareNative(environment.coordinator)
    await expect(environment.coordinator.confirm(recoveredReview)).resolves.toMatchObject({ kind: 'accepted' })
  })

  it('keeps a recovered blocked lane from creating nonce reuse evidence while other senders work', async () => {
    const environment = setup()
    environment.journal.recovery = {
      status: 'blocked',
      issues: [{ category: 'duplicate-conflict', count: 1, network: 'MAINNET', sender: senderA }],
      detectedAt: now,
      recoveredAt: now + 1,
      globalBlocked: false,
      blockedSenders: [senderA],
    }

    await expect(prepareNative(environment.coordinator)).rejects.toBeInstanceOf(TransferJournalRecoveryBlockedError)
    expect(environment.dependencies.getNextNonce).not.toHaveBeenCalled()

    const other = setup({ sender: senderB, key: keyB, journal: environment.journal })
    await expect(prepareNative(other.coordinator, senderB)).resolves.toMatchObject({ sender: senderB })
  })

  it('selects max(node nextNonce, accepted journal high-water plus one)', async () => {
    const environment = setup()
    environment.journal.seed(journalRecord(9, 'accepted', { sender: senderA, nonce: '9' }))
    environment.setNextNonce('7')
    expect((await prepareNative(environment.coordinator)).nonce).toBe('10')

    environment.journal.records = []
    environment.journal.seed(journalRecord(5, 'accepted', { sender: senderA, nonce: '5' }))
    environment.setNextNonce('12')
    expect((await prepareNative(environment.coordinator)).nonce).toBe('12')
  })

  it('fills an exact reusable nonce gap below high-water without reusing a bound nonce', async () => {
    const reusable = setup()
    reusable.journal.seed(journalRecord(7, 'absent-reusable', { nonce: '7' }))
    reusable.journal.seed(journalRecord(9, 'accepted', { nonce: '9' }))
    reusable.setNextNonce('7')

    const gapReview = await prepareNative(reusable.coordinator)
    expect(gapReview.nonce).toBe('7')
    expect(gapReview.acceptedNonceHighWater).toBe('9')

    const bound = setup()
    bound.journal.seed(journalRecord(7, 'pending', { nonce: '7' }))
    bound.journal.seed(journalRecord(9, 'accepted', { nonce: '9' }))
    bound.setNextNonce('7')
    expect((await prepareNative(bound.coordinator)).nonce).toBe('10')
  })

  it('fails closed before review or dispatch when accepted high-water is uint256 max', async () => {
    const environment = setup()
    const max = ((1n << 256n) - 1n).toString()
    environment.journal.seed(journalRecord(9, 'accepted', { sender: senderA, nonce: max }))
    environment.setNextNonce(max)

    await expect(prepareNative(environment.coordinator)).rejects.toBeInstanceOf(TransferPreflightError)
    expect(environment.journal.createCalls).toHaveLength(0)
    expect(environment.dependencies.getPrivateKey).not.toHaveBeenCalled()
    expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()
  })
})

describe('TransferCoordinator reconciliation', () => {
  it('maps public lifecycle statuses without signing, submitting, or replaying bytes', async () => {
    const environment = setup()
    const pending = journalRecord(1, 'accepted', { nonce: '1' })
    const confirming = journalRecord(2, 'pending', { nonce: '2' })
    const confirmed = journalRecord(3, 'unknown', { nonce: '3' })
    const reusable = journalRecord(4, 'accepted', { nonce: '4' })
    const consumed = journalRecord(5, 'blocked-unknown', { nonce: '5' })
    const blocked = journalRecord(6, 'unknown', { nonce: '6' })
    for (const record of [pending, confirming, confirmed, reusable, consumed, blocked]) {
      environment.journal.seed(record)
    }
    vi.mocked(environment.dependencies.getTransactionStatus).mockImplementation(async request => {
      if (request.hash === pending.hash) {
        return transactionStatus(request, 'PENDING', '2')
      }
      if (request.hash === confirming.hash) {
        return transactionStatus(request, 'CONFIRMING', '3', '2')
      }
      if (request.hash === confirmed.hash) {
        return transactionStatus(request, 'CONFIRMED', '4', '6')
      }
      if (request.hash === reusable.hash) {
        return transactionStatus(request, 'ABSENT_REUSABLE', request.nonce)
      }
      if (request.hash === consumed.hash) {
        return transactionStatus(request, 'CONSUMED_SUPERSEDED', '6')
      }
      return transactionStatus(request, 'BLOCKED_UNKNOWN', null)
    })

    const records = await environment.coordinator.reconcileOnStartup()

    expect(records.map(record => record.state)).toEqual([
      'pending',
      'confirming',
      'confirmed',
      'absent-reusable',
      'consumed-superseded',
      'blocked-unknown',
    ])
    expect(environment.dependencies.getPrivateKey).not.toHaveBeenCalled()
    expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()
    await environment.coordinator.reconcileOnFocus()
    await environment.coordinator.reconcileOnOnline()
    await environment.coordinator.reconcileOnUnlock()
    expect(environment.dependencies.submitTransaction).not.toHaveBeenCalled()
  })

  it('caps cross-sender status concurrency at three', async () => {
    const environment = setup()
    for (let index = 1; index <= 6; index++) {
      environment.journal.seed(journalRecord(index, 'accepted', {
        sender: `0x${index.toString(16).padStart(40, '0')}`,
        nonce: '1',
      }))
    }
    let active = 0
    let maximum = 0
    const releases: Array<() => void> = []
    vi.mocked(environment.dependencies.getTransactionStatus).mockImplementation(request =>
      new Promise(resolve => {
        active++
        maximum = Math.max(maximum, active)
        releases.push(() => {
          active--
          resolve(transactionStatus(request, 'PENDING', '2'))
        })
      }))

    const reconciliation = environment.coordinator.reconcile()
    await vi.waitFor(() => expect(environment.dependencies.getTransactionStatus).toHaveBeenCalledTimes(3))
    expect(active).toBe(3)
    expect(maximum).toBe(3)

    releases.splice(0).forEach(release => { release() })
    await vi.waitFor(() => expect(environment.dependencies.getTransactionStatus).toHaveBeenCalledTimes(6))
    expect(active).toBe(3)
    releases.splice(0).forEach(release => { release() })

    await expect(reconciliation).resolves.toHaveLength(6)
    expect(maximum).toBe(3)
  })

  it('marks reconciliation journal transitions as non-publishing observations', async () => {
    const environment = setup()
    const record = journalRecord(1, 'accepted', { nonce: '1' })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'PENDING', '2'))

    await environment.coordinator.reconcile()

    expect(environment.journal.transitionCalls).toContainEqual({
      attemptId: record.attemptId,
      state: 'pending',
      options: { source: 'reconciliation' },
    })
  })

  it('waits for all launched sender workers before rejecting a reconciliation run', async () => {
    const environment = setup()
    const failing = journalRecord(1, 'accepted', { sender: senderA, nonce: '1' })
    const slow = journalRecord(2, 'accepted', { sender: senderB, nonce: '2' })
    environment.journal.seed(failing)
    environment.journal.seed(slow)
    const slowStatus = deferred<unknown>()
    const failure = new Error('synthetic journal transition failure')
    const originalTransition = environment.journal.transition.bind(environment.journal)
    vi.spyOn(environment.journal, 'transition').mockImplementation(async (attemptId, state, updatedAt) => {
      if (attemptId === failing.attemptId) throw failure
      return originalTransition(attemptId, state, updatedAt)
    })
    vi.mocked(environment.dependencies.getTransactionStatus).mockImplementation(request => {
      if (request.sender === slow.sender) return slowStatus.promise
      return Promise.resolve(transactionStatus(request, 'PENDING', '2'))
    })

    const reconciliation = environment.coordinator.reconcile()
    await vi.waitFor(() => expect(environment.dependencies.getTransactionStatus).toHaveBeenCalledTimes(2))
    let rejected = false
    void reconciliation.catch(() => { rejected = true })
    await Promise.resolve()
    expect(rejected).toBe(false)

    slowStatus.resolve(transactionStatus(slow, 'PENDING', '3'))
    await expect(reconciliation).rejects.toBe(failure)
    expect(environment.journal.records.find(record => record.attemptId === slow.attemptId))
      .toMatchObject({ state: 'pending' })
  })

  it('releases a sender lane between reconciled records so prepare can interleave safely', async () => {
    const environment = setup()
    const first = journalRecord(1, 'accepted', { nonce: '1' })
    const second = journalRecord(2, 'accepted', { nonce: '2' })
    environment.journal.seed(first)
    environment.journal.seed(second)
    const firstStatus = deferred<unknown>()
    const nextNonce = deferred<unknown>()
    vi.mocked(environment.dependencies.getTransactionStatus)
      .mockReturnValueOnce(firstStatus.promise)
      .mockImplementation(async request => transactionStatus(request, 'PENDING', '3'))
    vi.mocked(environment.dependencies.getNextNonce).mockReturnValueOnce(nextNonce.promise)

    const reconciliation = environment.coordinator.reconcile()
    await vi.waitFor(() => expect(environment.dependencies.getTransactionStatus).toHaveBeenCalledTimes(1))
    const preparation = prepareNative(environment.coordinator)
    firstStatus.resolve(transactionStatus(first, 'PENDING', '2'))

    await vi.waitFor(() => expect(environment.dependencies.getNextNonce).toHaveBeenCalledTimes(1))
    expect(environment.dependencies.getTransactionStatus).toHaveBeenCalledTimes(1)

    nextNonce.resolve('7')
    await expect(preparation).resolves.toMatchObject({ nonce: '7' })
    await expect(reconciliation).resolves.toHaveLength(2)
    expect(environment.dependencies.getTransactionStatus).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['PENDING', '4', null, 'pending'],
    ['PENDING', '7', null, 'pending'],
    ['PENDING', '9', null, 'pending'],
    ['PENDING', null, null, 'pending'],
    ['CONFIRMING', '4', '1', 'confirming'],
    ['CONFIRMING', '7', '5', 'confirming'],
    ['CONFIRMED', '9', '6', 'confirmed'],
    ['CONFIRMED', null, '10', 'confirmed'],
  ] as const)('maps exact %s with nextNonce %s to %s', async (status, nextNonce, confirmations, expected) => {
    const environment = setup()
    const record = journalRecord(7, 'unknown', { nonce: '7' })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, status, nextNonce, confirmations))

    expect((await environment.coordinator.reconcile())[0]?.state).toBe(expected)
  })

  it.each([
    ['7', 'absent-reusable'],
    ['4', 'blocked-unknown'],
    ['9', 'blocked-unknown'],
    [null, 'blocked-unknown'],
  ] as const)('requires exact nextNonce equality for ABSENT_REUSABLE: %s', async (nextNonce, expected) => {
    const environment = setup()
    const record = journalRecord(7, 'unknown', { nonce: '7' })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'ABSENT_REUSABLE', nextNonce))

    expect((await environment.coordinator.reconcile())[0]?.state).toBe(expected)
  })

  it.each([
    ['ABSENT_REUSABLE', '7', 'absent-reusable'],
    ['CONSUMED_SUPERSEDED', '8', 'consumed-superseded'],
  ] as const)(
    'anchors crash-stuck dispatching after the first %s observation before reaching %s',
    async (status, nextNonce, terminalState) => {
      const environment = setup({ propagationGraceMs: 1_000 })
      const record = journalRecord(7, 'dispatching', {
        nonce: '7',
        createdAt: now - 120_000,
        updatedAt: now - 120_000,
        submissionStartedAt: now - 120_000,
      })
      environment.journal.seed(record)
      environment.setStatus(transactionStatus(record, status, nextNonce))

      const anchored = (await environment.coordinator.reconcile())[0]!
      expect(anchored.state).toBe('blocked-unknown')
      expect(anchored.updatedAt).toBe(now)

      environment.setNow(now + 999)
      const deferredRecord = (await environment.coordinator.reconcile())[0]!
      expect(deferredRecord.state).toBe('blocked-unknown')
      expect(deferredRecord.updatedAt).toBe(now)

      environment.setNow(now + 1_000)
      expect((await environment.coordinator.reconcile())[0]?.state).toBe(terminalState)
    },
  )

  it('waits through propagation grace before making an absent ambiguous nonce reusable', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const record = journalRecord(7, 'unknown', {
      nonce: '7',
      createdAt: now,
      updatedAt: now,
      submissionStartedAt: now,
    })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'ABSENT_REUSABLE', record.nonce))

    expect((await environment.coordinator.reconcile())[0]?.state).toBe('unknown')
    environment.setNow(now + 999)
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('unknown')
    environment.setNow(now + 1_000)
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('absent-reusable')
  })

  it.each([
    ['ABSENT_REUSABLE', '7', 'absent-reusable'],
    ['CONSUMED_SUPERSEDED', '8', 'consumed-superseded'],
  ] as const)(
    're-anchors a years-future durable timestamp before a fresh full grace interval for %s',
    async (status, nextNonce, terminalState) => {
      const environment = setup({ propagationGraceMs: 1_000 })
      const futureAnchor = now + (10 * 365 * 24 * 60 * 60 * 1_000)
      const record = journalRecord(7, 'accepted', {
        nonce: '7',
        createdAt: now - 10_000,
        submissionStartedAt: now - 10_000,
        updatedAt: futureAnchor,
      })
      environment.journal.seed(record)
      environment.setStatus(transactionStatus(record, status, nextNonce))

      const reanchored = (await environment.coordinator.reconcile())[0]!
      expect(reanchored).toMatchObject({ state: 'blocked-unknown', updatedAt: now })
      await expect(environment.journal.find(record.attemptId)).resolves.toEqual(reanchored)
      expect(environment.journal.transitionCalls.at(-1)).toEqual({
        attemptId: record.attemptId,
        state: 'blocked-unknown',
        options: { source: 'reconciliation', reanchorClockRollback: true },
      })

      environment.setNow(now + 999)
      const deferredRecord = (await environment.coordinator.reconcile())[0]!
      expect(deferredRecord).toMatchObject({ state: 'blocked-unknown', updatedAt: now })

      environment.setNow(now + 1_000)
      expect((await environment.coordinator.reconcile())[0]).toMatchObject({
        state: terminalState,
        updatedAt: now + 1_000,
      })
    },
  )

  it('retains a newer durable anchor for a minor clock rollback', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const record = journalRecord(7, 'accepted', {
      nonce: '7',
      createdAt: now - 10_000,
      submissionStartedAt: now - 10_000,
      updatedAt: now + 500,
    })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'ABSENT_REUSABLE', record.nonce))

    const deferredRecord = (await environment.coordinator.reconcile())[0]!
    expect(deferredRecord).toMatchObject({ state: 'accepted', updatedAt: now + 500 })
    expect(environment.journal.transitionCalls.at(-1)?.options).toEqual({ source: 'reconciliation' })

    environment.setNow(now + 1_499)
    expect((await environment.coordinator.reconcile())[0]).toMatchObject({
      state: 'accepted',
      updatedAt: now + 500,
    })
    environment.setNow(now + 1_500)
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('absent-reusable')
  })

  it('does not re-anchor from an observation predating the durable record lifetime', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const futureAnchor = now + (10 * 365 * 24 * 60 * 60 * 1_000)
    const record = journalRecord(7, 'accepted', {
      nonce: '7',
      createdAt: now + 1_000,
      submissionStartedAt: now + 1_000,
      updatedAt: futureAnchor,
    })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'ABSENT_REUSABLE', record.nonce))

    const deferredRecord = (await environment.coordinator.reconcile())[0]!
    expect(deferredRecord).toMatchObject({ state: 'accepted', updatedAt: futureAnchor })
    expect(environment.journal.transitionCalls.at(-1)?.options).toEqual({ source: 'reconciliation' })
  })

  it('fails closed when a clock rollback re-anchor cannot be read back exactly', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const record = journalRecord(7, 'accepted', {
      nonce: '7',
      createdAt: now - 10_000,
      submissionStartedAt: now - 10_000,
      updatedAt: now + (10 * 365 * 24 * 60 * 60 * 1_000),
    })
    environment.journal.seed(record)
    const find = environment.journal.find.bind(environment.journal)
    vi.spyOn(environment.journal, 'find').mockImplementation(async attemptId => {
      const reanchorAttempted = environment.journal.transitionCalls.some(call =>
        call.options?.reanchorClockRollback === true)
      return reanchorAttempted ? null : find(attemptId)
    })
    environment.setStatus(transactionStatus(record, 'ABSENT_REUSABLE', record.nonce))

    await expect(environment.coordinator.reconcile()).rejects.toThrow(/re-anchor could not be read back and verified/)
    expect(environment.journal.records[0]).toMatchObject({ state: 'blocked-unknown', updatedAt: now })
  })

  it('restarts terminal-observation grace from durable pending evidence without resetting on deferral', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const record = journalRecord(7, 'accepted', {
      nonce: '7',
      createdAt: now - 120_000,
      updatedAt: now - 120_000,
      submissionStartedAt: now - 120_000,
    })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'PENDING', '8'))

    const pending = (await environment.coordinator.reconcile())[0]!
    expect(pending.state).toBe('pending')
    expect(pending.updatedAt).toBe(now)

    environment.setStatus(transactionStatus(record, 'ABSENT_REUSABLE', record.nonce))
    environment.setNow(now + 999)
    const deferredRecord = (await environment.coordinator.reconcile())[0]!
    expect(deferredRecord.state).toBe('pending')
    expect(deferredRecord.updatedAt).toBe(now)

    environment.setNow(now + 1_000)
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('absent-reusable')
  })

  it.each([
    ['PENDING', 'ABSENT_REUSABLE', '7', 'pending'],
    ['CONFIRMING', 'CONSUMED_SUPERSEDED', '8', 'confirming'],
  ] as const)(
    'refreshes the %s observation anchor before a %s terminal observation',
    async (positiveStatus, terminalStatus, terminalNextNonce, expectedDeferredState) => {
      const environment = setup({ propagationGraceMs: 1_000 })
      const record = journalRecord(7, 'accepted', {
        nonce: '7',
        createdAt: now - 120_000,
        updatedAt: now - 120_000,
        submissionStartedAt: now - 120_000,
      })
      environment.journal.seed(record)
      const positiveConfirmations = positiveStatus === 'CONFIRMING' ? '1' : null
      environment.setStatus(transactionStatus(record, positiveStatus, '8', positiveConfirmations))

      const firstObservation = (await environment.coordinator.reconcile())[0]!
      expect(firstObservation.state).toBe(expectedDeferredState)
      expect(firstObservation.updatedAt).toBe(now)

      environment.setNow(now + 500)
      const refreshedObservation = (await environment.coordinator.reconcile())[0]!
      expect(refreshedObservation.state).toBe(expectedDeferredState)
      expect(refreshedObservation.updatedAt).toBe(now + 500)

      environment.setNow(now)
      const olderObservation = (await environment.coordinator.reconcile())[0]!
      expect(olderObservation.updatedAt).toBe(now + 500)

      environment.setStatus(transactionStatus(record, terminalStatus, terminalNextNonce))
      environment.setNow(now + 1_499)
      const deferredTerminal = (await environment.coordinator.reconcile())[0]!
      expect(deferredTerminal.state).toBe(expectedDeferredState)
      expect(deferredTerminal.updatedAt).toBe(now + 500)

      environment.setNow(now + 1_500)
      expect((await environment.coordinator.reconcile())[0]?.state).toBe(
        terminalStatus === 'ABSENT_REUSABLE' ? 'absent-reusable' : 'consumed-superseded',
      )
    },
  )

  it('applies propagation grace before a recent accepted record becomes consumed-superseded', async () => {
    const environment = setup({ propagationGraceMs: 1_000 })
    const record = journalRecord(7, 'accepted', {
      nonce: '7',
      createdAt: now,
      updatedAt: now,
      submissionStartedAt: now,
    })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'CONSUMED_SUPERSEDED', '8'))

    expect((await environment.coordinator.reconcile())[0]?.state).toBe('accepted')
    environment.setNow(now + 1_000)
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('consumed-superseded')
  })

  it('moves an absent hash with an advanced authoritative nonce to a safe consumed terminal state', async () => {
    const environment = setup()
    const record = journalRecord(7, 'unknown', { nonce: '7' })
    environment.journal.seed(record)
    environment.setStatus(transactionStatus(record, 'CONSUMED_SUPERSEDED', '8'))

    expect((await environment.coordinator.reconcile())[0]?.state).toBe('consumed-superseded')
    expect(await environment.coordinator.reconcile()).toEqual([])
  })

  it('keeps shallow confirmations reversible and finalizes only at the advertised depth', async () => {
    const environment = setup()
    const record = journalRecord(7, 'accepted', { nonce: '7' })
    environment.journal.seed(record)

    environment.setStatus(transactionStatus(record, 'CONFIRMING', '8', '1'))
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('confirming')

    environment.setStatus(transactionStatus(record, 'PENDING', '8'))
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('pending')

    environment.setStatus(transactionStatus(record, 'CONFIRMING', '8', '5'))
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('confirming')

    environment.setStatus(transactionStatus(record, 'CONFIRMED', '8', '6'))
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('confirmed')
    expect(await environment.coordinator.reconcile()).toEqual([])
  })

  it('fails closed on status identity mismatches or malformed fields', async () => {
    const environment = setup()
    const first = journalRecord(5, 'unknown', { nonce: '5' })
    environment.journal.seed(first)
    environment.setStatus({
      ...transactionStatus(first, 'CONFIRMED', '6', '6'),
      hash: `0x${'f'.repeat(64)}`,
    })
    expect((await environment.coordinator.reconcile())[0]?.state).toBe('blocked-unknown')

    const overflow = setup()
    const oversized = journalRecord(7, 'unknown', { nonce: '7' })
    overflow.journal.seed(oversized)
    overflow.setStatus(transactionStatus(
      oversized,
      'PENDING',
      (1n << 256n).toString(),
    ))
    expect((await overflow.coordinator.reconcile())[0]?.state).toBe('blocked-unknown')
  })

  it('uses a 40s backend-budget-compatible default deadline and honors an override', async () => {
    vi.useFakeTimers()

    const defaultEnvironment = setup()
    const defaultRecord = journalRecord(7, 'unknown', { nonce: '7' })
    defaultEnvironment.journal.seed(defaultRecord)
    let defaultAborted = false
    vi.mocked(defaultEnvironment.dependencies.getTransactionStatus).mockImplementation((_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          defaultAborted = true
          reject(new Error('aborted'))
        }, { once: true })
      }))

    const defaultReconciliation = defaultEnvironment.coordinator.reconcile()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(39_999)
    expect(defaultAborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(defaultReconciliation).resolves.toMatchObject([{ state: 'blocked-unknown' }])
    expect(defaultAborted).toBe(true)

    const overrideEnvironment = setup({ reconciliationTimeoutMs: 25 })
    const overrideRecord = journalRecord(8, 'unknown', { nonce: '8' })
    overrideEnvironment.journal.seed(overrideRecord)
    let overrideAborted = false
    vi.mocked(overrideEnvironment.dependencies.getTransactionStatus).mockImplementation((_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          overrideAborted = true
          reject(new Error('aborted'))
        }, { once: true })
      }))

    const overrideReconciliation = overrideEnvironment.coordinator.reconcile()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(24)
    expect(overrideAborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(overrideReconciliation).resolves.toMatchObject([{ state: 'blocked-unknown' }])
    expect(overrideAborted).toBe(true)
  })

  it('never automatically replays an unknown signed transaction', async () => {
    const environment = setup()
    vi.mocked(environment.dependencies.submitTransaction).mockRejectedValue(new Error('ambiguous transport'))
    const review = await prepareNative(environment.coordinator)
    const unknown = await environment.coordinator.confirm(review)
    expect(unknown.kind).toBe('unknown')
    const record = environment.journal.records[0]!
    environment.setStatus(transactionStatus(
      record,
      'PENDING',
      (BigInt(record.nonce) + 1n).toString(),
    ))

    await environment.coordinator.reconcileOnOnline()
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
    expect(environment.dependencies.getPrivateKey).toHaveBeenCalledTimes(1)
    const retried = await environment.coordinator.confirm(review)
    expect(retried.kind).toBe('reconfirm')
    expect(environment.dependencies.submitTransaction).toHaveBeenCalledTimes(1)
  })
})
