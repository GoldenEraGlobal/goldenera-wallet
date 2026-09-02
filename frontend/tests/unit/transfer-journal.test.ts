import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as uuidUtil from '../../packages/core/src/utils/UuidUtil'
import { createTransferReconciliationService } from '../../packages/core/src/services/TransferCoordinatorService'

const preferences = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  tamperReadBack: false,
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: preferences.get,
    set: preferences.set,
  },
}))

import {
  subscribeTransferJournal,
  TransferJournalPersistenceError,
  TransferJournalRecoveryRequiredError,
  TransferJournalService,
  TransferJournalTransitionError,
} from '../../packages/core/src/services/TransferJournalService'
import type { NewTransferAttempt } from '../../packages/core/src/services/TransferJournalService'

const sender = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const otherSender = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const recipient = '0x2222222222222222222222222222222222222222'
const tokenAddress = '0x0000000000000000000000000000000000000000'
const journalKey = 'ge_transfer_journal:records'
const recoveryKey = 'ge_transfer_journal:recovery'

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

function attempt(index: number, overrides: Partial<NewTransferAttempt> = {}): NewTransferAttempt {
  const timestamp = 1_700_000_000_000 + index
  return {
    attemptId: uuid(index),
    network: 'MAINNET',
    walletId: 'wallet-public-test',
    vaultRevision: 2,
    sender,
    recipient,
    tokenAddress,
    hash: `0x${index.toString(16).padStart(64, '0')}`,
    nonce: String(index),
    amount: '100000000',
    fee: '2500',
    signedSize: 137,
    createdAt: timestamp,
    submissionStartedAt: timestamp,
    ...overrides,
  }
}

beforeEach(() => {
  preferences.values.clear()
  preferences.tamperReadBack = false
  preferences.get.mockImplementation(async ({ key }: { key: string }) => ({
    value: preferences.tamperReadBack && preferences.values.has(key)
      ? `${preferences.values.get(key)} `
      : preferences.values.get(key) ?? null,
  }))
  preferences.set.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
    preferences.values.set(key, value)
  })
})

afterEach(() => {
  preferences.values.clear()
})

describe('TransferJournalService', () => {
  it('persists and verifies only strict public metadata before dispatch', async () => {
    const record = await TransferJournalService.createDispatching(attempt(1))

    expect(record).toMatchObject({
      state: 'dispatching',
      sender: sender.toLowerCase(),
      hash: `0x${'1'.padStart(64, '0')}`,
    })
    expect(preferences.set).toHaveBeenCalledTimes(1)
    const raw = preferences.values.get(journalKey)!
    expect(raw).not.toMatch(/mnemonic|password|privateKey|signature|prf|hexData|signedBytes/i)
    expect(JSON.parse(raw)).toEqual({ version: 1, records: [record] })
  })

  it('rejects secret or unknown input fields without touching storage', async () => {
    await expect(TransferJournalService.createDispatching({
      ...attempt(1),
      mnemonic: 'public test phrase must still never enter the journal',
    } as NewTransferAttempt)).rejects.toThrow()

    expect(preferences.set).not.toHaveBeenCalled()
    expect(preferences.values.size).toBe(0)
  })

  it('quarantines persisted corruption without copying its raw content, then requires explicit recovery', async () => {
    await TransferJournalService.createDispatching(attempt(1))
    const corrupt = JSON.parse(preferences.values.get(journalKey)!)
    corrupt.records[0].hexData = '0xdeadbeef-public-test-must-not-be-copied'
    const original = JSON.stringify(corrupt)
    preferences.values.set(journalKey, original)

    await expect(TransferJournalService.read()).resolves.toEqual([])
    expect(preferences.values.get(journalKey)).toBe(original)
    const recovery = await TransferJournalService.getRecoveryState()
    expect(recovery).toMatchObject({ status: 'action-required', globalBlocked: false })
    expect(JSON.stringify(JSON.parse(preferences.values.get(recoveryKey)!)))
      .not.toContain('0xdeadbeef-public-test-must-not-be-copied')
    await expect(TransferJournalService.createDispatching(attempt(2)))
      .rejects.toBeInstanceOf(TransferJournalRecoveryRequiredError)

    await expect(TransferJournalService.recover()).resolves.toMatchObject({ status: 'blocked' })
    expect(JSON.parse(preferences.values.get(journalKey)!)).toEqual({ version: 1, records: [] })
    expect(JSON.stringify(JSON.parse(preferences.values.get(recoveryKey)!)))
      .not.toMatch(/hexData|deadbeef|mnemonic|password|privateKey|signature|signedBytes/i)
  })

  it.each(['attemptId', 'hash'] as const)('quarantines conflicting duplicate persisted %s values until recovery', async field => {
    const record = await TransferJournalService.createDispatching(attempt(1))
    const duplicate = {
      ...record,
      attemptId: uuid(2),
      hash: `0x${'2'.padStart(64, '0')}`,
      state: 'accepted',
      updatedAt: record.updatedAt + 1,
    }
    duplicate[field] = record[field]
    preferences.values.set(journalKey, JSON.stringify({ version: 1, records: [record, duplicate] }))

    await expect(TransferJournalService.read()).resolves.toEqual([])
    await expect(TransferJournalService.getRecoveryState()).resolves.toMatchObject({
      status: 'action-required',
      issues: expect.arrayContaining([expect.objectContaining({ category: 'duplicate-conflict' })]),
    })
  })

  it.each(['nonce', 'amount', 'fee'] as const)('rejects %s values above uint256', async field => {
    await expect(TransferJournalService.createDispatching({
      ...attempt(1),
      [field]: (1n << 256n).toString(),
    })).rejects.toThrow()
    expect(preferences.set).not.toHaveBeenCalled()
  })

  it('preserves valid sender records while a malformed record stays quarantined', async () => {
    const record = await TransferJournalService.createDispatching(attempt(1))
    const valid = { ...record, attemptId: uuid(2), hash: `0x${'2'.padStart(64, '0')}`, sender: otherSender.toLowerCase() }
    preferences.values.set(journalKey, JSON.stringify({
      version: 1,
      records: [record, { ...record, amount: (1n << 256n).toString() }, valid],
    }))

    await expect(TransferJournalService.listForSender('MAINNET', otherSender)).resolves.toEqual([valid])
    await expect(TransferJournalService.listForSender('MAINNET', sender)).resolves.toEqual([record])
    await expect(TransferJournalService.getRecoveryState()).resolves.toMatchObject({
      status: 'action-required',
      blockedSenders: [sender.toLowerCase()],
    })
  })

  it.each([
    ['malformed JSON', '{not-json', 'malformed-envelope'],
    ['future envelope', JSON.stringify({ version: 2, records: [] }), 'unsupported-envelope-version'],
  ])('uses a durable global recovery path for %s', async (_name, raw, category) => {
    preferences.values.set(journalKey, raw)

    await expect(TransferJournalService.read()).resolves.toEqual([])
    await expect(TransferJournalService.getRecoveryState()).resolves.toMatchObject({
      status: 'action-required',
      globalBlocked: true,
      issues: expect.arrayContaining([expect.objectContaining({ category })]),
    })
    await expect(TransferJournalService.recover()).resolves.toMatchObject({ status: 'blocked', globalBlocked: true })
    await expect(TransferJournalService.createDispatching(attempt(1)))
      .rejects.toThrow(/remains ambiguous/)
  })

  it('never interprets a future record and retains other valid records across recovery and reload', async () => {
    const record = await TransferJournalService.createDispatching(attempt(1))
    const independent = {
      ...record,
      attemptId: uuid(2),
      hash: `0x${'2'.padStart(64, '0')}`,
      sender: otherSender.toLowerCase(),
      state: 'rejected',
      updatedAt: record.updatedAt + 1,
    }
    preferences.values.set(journalKey, JSON.stringify({
      version: 1,
      records: [record, { version: 2, network: 'MAINNET', sender: sender.toLowerCase() }, independent],
    }))

    await expect(TransferJournalService.read()).resolves.toEqual([record, independent])
    await expect(TransferJournalService.recover()).resolves.toMatchObject({
      status: 'blocked', blockedSenders: [sender.toLowerCase()],
    })
    await expect(TransferJournalService.read()).resolves.toEqual([record, independent])
    expect(JSON.parse(preferences.values.get(journalKey)!)).toEqual({ version: 1, records: [record, independent] })
    await expect(TransferJournalService.createDispatching(attempt(3, { sender: otherSender })))
      .resolves.toMatchObject({ sender: otherSender.toLowerCase() })
  })

  it('deduplicates identical logical records only after acknowledgement and remains idempotent', async () => {
    const record = await TransferJournalService.createDispatching(attempt(1))
    preferences.values.set(journalKey, JSON.stringify({ version: 1, records: [record, structuredClone(record)] }))

    await expect(TransferJournalService.read()).resolves.toEqual([record])
    await expect(TransferJournalService.getRecoveryState()).resolves.toMatchObject({
      status: 'action-required',
      issues: expect.arrayContaining([expect.objectContaining({ category: 'duplicate-identical' })]),
    })
    const recovered = await TransferJournalService.recover()
    expect(recovered.status).toBe('resolved')
    const writesAfterFirstRecovery = preferences.set.mock.calls.length
    await expect(TransferJournalService.recover()).resolves.toEqual(recovered)
    expect(preferences.set).toHaveBeenCalledTimes(writesAfterFirstRecovery)
    await expect(TransferJournalService.read()).resolves.toEqual([record])
  })

  it('persists one stable public quarantine state across repeated reads', async () => {
    preferences.values.set(journalKey, '{not-json')

    await Promise.all([
      TransferJournalService.getRecoveryState(),
      TransferJournalService.getRecoveryState(),
      TransferJournalService.read(),
    ])
    expect(preferences.set).toHaveBeenCalledTimes(1)
    const stored = preferences.values.get(recoveryKey)!
    await TransferJournalService.getRecoveryState()
    expect(preferences.set).toHaveBeenCalledTimes(1)
    expect(preferences.values.get(recoveryKey)).toBe(stored)
  })

  it('blocks journal mutations before acknowledgement so no malformed payload is rewritten', async () => {
    const valid = await TransferJournalService.createDispatching(attempt(1))
    const original = JSON.stringify({ version: 1, records: [valid, { sender, network: 'MAINNET', signedBytes: 'do-not-copy' }] })
    preferences.values.set(journalKey, original)

    await expect(TransferJournalService.transition(valid.attemptId, 'unknown', valid.updatedAt + 1))
      .rejects.toBeInstanceOf(TransferJournalRecoveryRequiredError)
    expect(preferences.values.get(journalKey)).toBe(original)
    expect(preferences.values.get(recoveryKey)).not.toContain('do-not-copy')
  })

  it('blocks dispatch and publishes nothing when persisted read-back differs', async () => {
    const windowObject = window as typeof window & {
      BroadcastChannel?: typeof BroadcastChannel
      localStorage?: Storage
    }
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const broadcastDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'BroadcastChannel')
    const storageDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'localStorage')
    const postMessage = vi.fn()
    const notificationWrite = vi.fn()
    preferences.tamperReadBack = true
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: { request: vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation()) } },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      Object.defineProperty(windowObject, 'BroadcastChannel', {
        configurable: true,
        value: class {
          postMessage = postMessage
          close() {}
        },
      })
      Object.defineProperty(windowObject, 'localStorage', {
        configurable: true,
        value: { setItem: notificationWrite },
      })

      await expect(TransferJournalService.createDispatching(attempt(1)))
        .rejects.toBeInstanceOf(TransferJournalPersistenceError)
      expect(postMessage).not.toHaveBeenCalled()
      expect(notificationWrite).not.toHaveBeenCalled()
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
      if (broadcastDescriptor) Object.defineProperty(windowObject, 'BroadcastChannel', broadcastDescriptor)
      else Reflect.deleteProperty(windowObject, 'BroadcastChannel')
      if (storageDescriptor) Object.defineProperty(windowObject, 'localStorage', storageDescriptor)
      else Reflect.deleteProperty(windowObject, 'localStorage')
    }
  })

  it('fails closed in a production-like browser with storage but without Web Locks', async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    try {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: { getItem: vi.fn(), setItem: vi.fn() },
      })

      await expect(TransferJournalService.createDispatching(attempt(1)))
        .rejects.toBeInstanceOf(TransferJournalPersistenceError)
      expect(preferences.get).not.toHaveBeenCalled()
      expect(preferences.set).not.toHaveBeenCalled()
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
      if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor)
      else Reflect.deleteProperty(window, 'localStorage')
    }
  })

  it('serializes concurrent mutations and rejects identifier or hash rebinding', async () => {
    const first = attempt(1)
    const second = attempt(2, { sender: otherSender })
    await Promise.all([
      TransferJournalService.createDispatching(first),
      TransferJournalService.createDispatching(second),
    ])
    expect(await TransferJournalService.read()).toHaveLength(2)

    await expect(TransferJournalService.createDispatching({ ...first, amount: '2' }))
      .rejects.toBeInstanceOf(TransferJournalPersistenceError)
    await expect(TransferJournalService.createDispatching({ ...attempt(3), hash: first.hash }))
      .rejects.toBeInstanceOf(TransferJournalPersistenceError)
  })

  it('atomically blocks competing dispatches, stale high-water nonces and non-reusable nonce reuse', async () => {
    const [first, second] = await Promise.allSettled([
      TransferJournalService.createDispatching(attempt(1)),
      TransferJournalService.createDispatching(attempt(2)),
    ])
    expect(first.status).toBe('fulfilled')
    expect(second.status).toBe('rejected')
    expect(await TransferJournalService.read()).toHaveLength(1)

    await TransferJournalService.transition(attempt(1).attemptId, 'accepted', attempt(1).createdAt + 1)
    await expect(TransferJournalService.createDispatching(attempt(3, { nonce: '1' })))
      .rejects.toThrow(/already bound/)
    await expect(TransferJournalService.createDispatching(attempt(4, { nonce: '0' })))
      .rejects.toThrow(/high-water/)
    await expect(TransferJournalService.createDispatching(attempt(5, { nonce: '2' })))
      .resolves.toMatchObject({ state: 'dispatching', nonce: '2' })
  })

  it.each(['rejected', 'absent-reusable'] as const)('allows nonce reuse only after %s', async state => {
    const first = attempt(1)
    await TransferJournalService.createDispatching(first)
    await TransferJournalService.transition(first.attemptId, state, first.createdAt + 1)

    await expect(TransferJournalService.createDispatching(attempt(2, { nonce: first.nonce })))
      .resolves.toMatchObject({ state: 'dispatching', nonce: first.nonce })
  })

  it('allows an exact reusable nonce gap below a later accepted high-water mark', async () => {
    const gap = attempt(1, { nonce: '7' })
    await TransferJournalService.createDispatching(gap)
    await TransferJournalService.transition(gap.attemptId, 'absent-reusable', gap.createdAt + 1)

    const later = attempt(2, { nonce: '9' })
    await TransferJournalService.createDispatching(later)
    await TransferJournalService.transition(later.attemptId, 'accepted', later.createdAt + 1)

    await expect(TransferJournalService.createDispatching(attempt(3, { nonce: '7' })))
      .resolves.toMatchObject({ state: 'dispatching', nonce: '7' })
  })

  it('never reuses a consumed or otherwise non-reusable nonce below high-water', async () => {
    const consumed = attempt(1, { nonce: '7' })
    await TransferJournalService.createDispatching(consumed)
    await TransferJournalService.transition(consumed.attemptId, 'accepted', consumed.createdAt + 1)
    await TransferJournalService.transition(consumed.attemptId, 'consumed-superseded', consumed.createdAt + 2)

    await expect(TransferJournalService.createDispatching(attempt(2, { nonce: '7' })))
      .rejects.toThrow(/already bound/)
  })

  it('keeps idempotent retries safe across valid transitions and derives lane state', async () => {
    const first = attempt(4)
    const second = attempt(5)
    await TransferJournalService.createDispatching(first)
    await TransferJournalService.transition(first.attemptId, 'accepted', first.createdAt + 1)
    const pending = await TransferJournalService.transition(first.attemptId, 'pending', first.createdAt + 2)
    expect(await TransferJournalService.transition(first.attemptId, 'pending', first.createdAt)).toEqual(pending)
    await TransferJournalService.transition(first.attemptId, 'confirming', first.createdAt + 3)
    await TransferJournalService.transition(first.attemptId, 'pending', first.createdAt + 4)
    expect((await TransferJournalService.createDispatching(first)).state).toBe('pending')

    await TransferJournalService.createDispatching(second)
    await TransferJournalService.transition(second.attemptId, 'unknown', second.createdAt + 1)
    expect(await TransferJournalService.acceptedNonceHighWater('MAINNET', sender)).toBe(4n)
    expect((await TransferJournalService.listBlocking('MAINNET', sender)).map(record => record.attemptId))
      .toEqual([second.attemptId])

    await TransferJournalService.transition(first.attemptId, 'confirmed', first.createdAt + 5)
    await expect(TransferJournalService.transition(first.attemptId, 'pending', first.createdAt + 6))
      .rejects.toBeInstanceOf(TransferJournalTransitionError)
  })

  it('refreshes only pending and confirming observation anchors with newer timestamps', async () => {
    const record = attempt(4)
    await TransferJournalService.createDispatching(record)
    await TransferJournalService.transition(record.attemptId, 'accepted', record.createdAt + 1)
    const pending = await TransferJournalService.transition(record.attemptId, 'pending', record.createdAt + 2)
    const refreshedPending = await TransferJournalService.transition(record.attemptId, 'pending', record.createdAt + 3)
    expect(refreshedPending.updatedAt).toBe(record.createdAt + 3)
    expect(await TransferJournalService.transition(record.attemptId, 'pending', record.createdAt + 3))
      .toEqual(refreshedPending)
    expect(await TransferJournalService.transition(record.attemptId, 'pending', pending.updatedAt))
      .toEqual(refreshedPending)

    const confirming = await TransferJournalService.transition(record.attemptId, 'confirming', record.createdAt + 4)
    const refreshedConfirming = await TransferJournalService.transition(record.attemptId, 'confirming', record.createdAt + 5)
    expect(refreshedConfirming.updatedAt).toBe(record.createdAt + 5)
    expect(await TransferJournalService.transition(record.attemptId, 'confirming', confirming.updatedAt))
      .toEqual(refreshedConfirming)

    const persisted = (await TransferJournalService.find(record.attemptId))!
    expect(persisted.updatedAt).toBe(record.createdAt + 5)
  })

  it('durably re-anchors only a reconciliation-owned nonterminal record to blocked-unknown', async () => {
    const input = attempt(4)
    await TransferJournalService.createDispatching(input)
    await TransferJournalService.transition(input.attemptId, 'accepted', input.createdAt + 1)
    const futurePending = await TransferJournalService.transition(
      input.attemptId,
      'pending',
      input.createdAt + 100_000,
      { source: 'reconciliation' },
    )

    const reanchored = await TransferJournalService.transition(
      input.attemptId,
      'blocked-unknown',
      input.createdAt + 2,
      { source: 'reconciliation', reanchorClockRollback: true },
    )

    expect(futurePending.updatedAt).toBe(input.createdAt + 100_000)
    expect(reanchored).toMatchObject({ state: 'blocked-unknown', updatedAt: input.createdAt + 2 })
    await expect(TransferJournalService.find(input.attemptId)).resolves.toEqual(reanchored)
    expect(JSON.parse(preferences.values.get(journalKey)!)).toEqual({ version: 1, records: [reanchored] })
  })

  it('rejects clock rollback re-anchor requests outside reconciliation', async () => {
    const input = attempt(4)
    await TransferJournalService.createDispatching(input)
    await TransferJournalService.transition(input.attemptId, 'unknown', input.createdAt + 100_000)

    await expect(TransferJournalService.transition(
      input.attemptId,
      'blocked-unknown',
      input.createdAt + 1,
      { source: 'local', reanchorClockRollback: true },
    )).rejects.toBeInstanceOf(TransferJournalTransitionError)
    await expect(TransferJournalService.find(input.attemptId)).resolves.toMatchObject({
      state: 'unknown',
      updatedAt: input.createdAt + 100_000,
    })
  })

  it('never moves a terminal-safe record backward during clock re-anchoring', async () => {
    const input = attempt(4)
    await TransferJournalService.createDispatching(input)
    const confirmed = await TransferJournalService.transition(
      input.attemptId,
      'confirmed',
      input.createdAt + 100_000,
      { source: 'reconciliation' },
    )

    await expect(TransferJournalService.transition(
      input.attemptId,
      'blocked-unknown',
      input.createdAt + 1,
      { source: 'reconciliation', reanchorClockRollback: true },
    )).rejects.toBeInstanceOf(TransferJournalTransitionError)
    await expect(TransferJournalService.find(input.attemptId)).resolves.toEqual(confirmed)
  })

  it('rejects clock re-anchors before record lifetime or without a backward timestamp', async () => {
    const beforeLifetime = attempt(4)
    await TransferJournalService.createDispatching(beforeLifetime)
    await TransferJournalService.transition(
      beforeLifetime.attemptId,
      'unknown',
      beforeLifetime.createdAt + 100_000,
    )
    await expect(TransferJournalService.transition(
      beforeLifetime.attemptId,
      'blocked-unknown',
      beforeLifetime.createdAt - 1,
      { source: 'reconciliation', reanchorClockRollback: true },
    )).rejects.toBeInstanceOf(TransferJournalTransitionError)

    preferences.values.clear()
    const nonBackward = attempt(5)
    await TransferJournalService.createDispatching(nonBackward)
    await TransferJournalService.transition(nonBackward.attemptId, 'unknown', nonBackward.createdAt + 1)
    await expect(TransferJournalService.transition(
      nonBackward.attemptId,
      'blocked-unknown',
      nonBackward.createdAt + 1,
      { source: 'reconciliation', reanchorClockRollback: true },
    )).rejects.toBeInstanceOf(TransferJournalTransitionError)
    await expect(TransferJournalService.find(nonBackward.attemptId)).resolves.toMatchObject({
      state: 'unknown',
      updatedAt: nonBackward.createdAt + 1,
    })
  })

  it('prunes expired terminal records but never unresolved attempts', async () => {
    const oldTerminal = attempt(1, { createdAt: 1, submissionStartedAt: 1 })
    const oldUnresolved = attempt(2, { createdAt: 2, submissionStartedAt: 2 })
    await TransferJournalService.createDispatching(oldTerminal)
    await TransferJournalService.transition(oldTerminal.attemptId, 'confirmed', 3)
    await TransferJournalService.createDispatching(oldUnresolved)

    const now = 40 * 24 * 60 * 60 * 1000
    await TransferJournalService.prune(now)
    const records = await TransferJournalService.read()
    expect(records.map(record => record.attemptId)).toEqual([oldUnresolved.attemptId])
  })

  it('publishes only after a locked durable write and keeps notification failures non-fatal', async () => {
    const windowObject = window as typeof window & {
      BroadcastChannel?: typeof BroadcastChannel
      localStorage?: Storage
    }
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const broadcastDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'BroadcastChannel')
    const storageDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'localStorage')
    const lockRequest = vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation())
    const notificationWrite = vi.fn(() => { throw new Error('synthetic storage failure') })
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: { request: lockRequest } },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      Object.defineProperty(windowObject, 'BroadcastChannel', {
        configurable: true,
        value: class { constructor() { throw new Error('synthetic channel failure') } },
      })
      Object.defineProperty(windowObject, 'localStorage', {
        configurable: true,
        value: { setItem: notificationWrite },
      })

      await expect(TransferJournalService.createDispatching(attempt(1))).resolves.toMatchObject({ state: 'dispatching' })
      expect(lockRequest).toHaveBeenCalledTimes(1)
      expect(preferences.set).toHaveBeenCalledTimes(1)
      expect(preferences.get).toHaveBeenCalledTimes(3)
      expect(notificationWrite).toHaveBeenCalledTimes(1)
      expect(preferences.set.mock.invocationCallOrder[0])
        .toBeLessThan(preferences.get.mock.invocationCallOrder[2]!)
      expect(preferences.get.mock.invocationCallOrder[2])
        .toBeLessThan(notificationWrite.mock.invocationCallOrder[0]!)
      expect(await TransferJournalService.read()).toHaveLength(1)
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
      if (broadcastDescriptor) Object.defineProperty(windowObject, 'BroadcastChannel', broadcastDescriptor)
      else Reflect.deleteProperty(windowObject, 'BroadcastChannel')
      if (storageDescriptor) Object.defineProperty(windowObject, 'localStorage', storageDescriptor)
      else Reflect.deleteProperty(windowObject, 'localStorage')
    }
  })

  it('publishes local transitions but not reconciliation observations after durable persistence', async () => {
    const windowObject = window as typeof window & {
      BroadcastChannel?: typeof BroadcastChannel
      localStorage?: Storage
    }
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const broadcastDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'BroadcastChannel')
    const storageDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'localStorage')
    const postMessage = vi.fn()
    const notificationWrite = vi.fn()
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: { request: vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation()) } },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      Object.defineProperty(windowObject, 'BroadcastChannel', {
        configurable: true,
        value: class {
          postMessage = postMessage
          close() {}
        },
      })
      Object.defineProperty(windowObject, 'localStorage', {
        configurable: true,
        value: { setItem: notificationWrite },
      })
      const dispatching = await TransferJournalService.createDispatching(attempt(1))
      postMessage.mockClear()
      notificationWrite.mockClear()

      await TransferJournalService.transition(dispatching.attemptId, 'accepted', dispatching.createdAt + 1)
      expect(postMessage).toHaveBeenCalledTimes(1)
      expect(notificationWrite).toHaveBeenCalledTimes(1)
      postMessage.mockClear()
      notificationWrite.mockClear()

      await TransferJournalService.transition(
        dispatching.attemptId,
        'pending',
        dispatching.createdAt + 2,
        { source: 'reconciliation' },
      )
      expect(postMessage).not.toHaveBeenCalled()
      expect(notificationWrite).not.toHaveBeenCalled()
      await expect(TransferJournalService.find(dispatching.attemptId)).resolves.toMatchObject({ state: 'pending' })
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
      if (broadcastDescriptor) Object.defineProperty(windowObject, 'BroadcastChannel', broadcastDescriptor)
      else Reflect.deleteProperty(windowObject, 'BroadcastChannel')
      if (storageDescriptor) Object.defineProperty(windowObject, 'localStorage', storageDescriptor)
      else Reflect.deleteProperty(windowObject, 'localStorage')
    }
  })

  it('keeps an accepted durable transition non-fatal when only its event UUID allocation fails', async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const createUuid = vi.spyOn(uuidUtil, 'createUuid')
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { crypto: {} } })
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: { request: vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation()) } },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      createUuid
        .mockImplementationOnce(() => uuid(800))
        .mockImplementationOnce(() => { throw new Error('synthetic accepted-event UUID failure') })

      const dispatching = await TransferJournalService.createDispatching(attempt(1))
      const accepted = await TransferJournalService.transition(
        dispatching.attemptId,
        'accepted',
        dispatching.createdAt + 1,
      )

      expect(accepted).toMatchObject({ state: 'accepted' })
      await expect(TransferJournalService.find(dispatching.attemptId)).resolves.toMatchObject({ state: 'accepted' })
      expect(preferences.set).toHaveBeenCalledTimes(2)
    } finally {
      createUuid.mockRestore()
      if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
      else delete (globalThis as { window?: unknown }).window
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
    }
  })

  it('deduplicates one journal nonce delivered through BroadcastChannel and storage', () => {
    const channels: FakeBroadcastChannel[] = []
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null
      closed = false
      constructor(readonly name: string) { channels.push(this) }
      postMessage() {}
      close() { this.closed = true }
    }
    const windowObject = window as typeof window & {
      BroadcastChannel?: typeof BroadcastChannel
      addEventListener?: typeof window.addEventListener
      removeEventListener?: typeof window.removeEventListener
    }
    const broadcastDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'BroadcastChannel')
    const addDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'addEventListener')
    const removeDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'removeEventListener')
    let storageListener: ((event: StorageEvent) => void) | null = null
    const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'storage' && typeof listener === 'function') {
        storageListener = listener as (event: StorageEvent) => void
      }
    })
    const removeEventListener = vi.fn()
    try {
      Object.defineProperty(windowObject, 'BroadcastChannel', { configurable: true, value: FakeBroadcastChannel })
      Object.defineProperty(windowObject, 'addEventListener', { configurable: true, value: addEventListener })
      Object.defineProperty(windowObject, 'removeEventListener', { configurable: true, value: removeEventListener })
      const listener = vi.fn()
      const unsubscribe = subscribeTransferJournal(listener)
      expect(channels).toHaveLength(1)
      expect(storageListener).not.toBeNull()

      const event = {
        version: 1,
        sourceId: 'other-tab',
        attemptId: uuid(1),
        updatedAt: 1,
        nonce: uuid(99),
      }
      channels[0]!.onmessage?.({ data: event } as MessageEvent)
      storageListener?.({ key: 'ge_transfer_journal:event', newValue: JSON.stringify(event) } as StorageEvent)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(event)

      const laterEvent = { ...event, nonce: uuid(100), updatedAt: 2 }
      storageListener?.({ key: 'ge_transfer_journal:event', newValue: JSON.stringify(laterEvent) } as StorageEvent)
      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenLastCalledWith(laterEvent)

      const recoveryEvent = { version: 1, sourceId: 'other-tab', kind: 'recovery', updatedAt: 3, nonce: uuid(101) }
      channels[0]!.onmessage?.({ data: recoveryEvent } as MessageEvent)
      expect(listener).toHaveBeenCalledTimes(3)
      expect(listener).toHaveBeenLastCalledWith(recoveryEvent)
      expect(JSON.stringify(recoveryEvent)).not.toMatch(/hexData|signedBytes|mnemonic|password|privateKey/i)

      unsubscribe()
      expect(channels[0]!.closed).toBe(true)
      expect(removeEventListener).toHaveBeenCalledWith('storage', expect.any(Function))
      channels[0]!.onmessage?.({ data: { ...event, nonce: uuid(101) } } as MessageEvent)
      storageListener?.({ key: 'ge_transfer_journal:event', newValue: JSON.stringify({ ...event, nonce: uuid(102) }) } as StorageEvent)
      expect(listener).toHaveBeenCalledTimes(3)
    } finally {
      if (broadcastDescriptor) Object.defineProperty(windowObject, 'BroadcastChannel', broadcastDescriptor)
      else Reflect.deleteProperty(windowObject, 'BroadcastChannel')
      if (addDescriptor) Object.defineProperty(windowObject, 'addEventListener', addDescriptor)
      else Reflect.deleteProperty(windowObject, 'addEventListener')
      if (removeDescriptor) Object.defineProperty(windowObject, 'removeEventListener', removeDescriptor)
      else Reflect.deleteProperty(windowObject, 'removeEventListener')
    }
  })

  it('stops a two-tab reconciliation cycle while later local unknown work still reaches the peer', async () => {
    type Tab = 'A' | 'B' | null
    let publishingTab: Tab = null
    let subscriptionTab: Tab = null
    const channels: FakeBroadcastChannel[] = []
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null
      closed = false
      readonly tab = subscriptionTab
      constructor(readonly name: string) { channels.push(this) }
      postMessage(data: unknown) {
        if (!publishingTab) return
        for (const channel of channels) {
          if (!channel.closed && channel.tab !== publishingTab && channel.name === this.name) {
            channel.onmessage?.({
              data: { ...(data as object), sourceId: `tab-${publishingTab}` },
            } as MessageEvent)
          }
        }
      }
      close() { this.closed = true }
    }
    const windowObject = window as typeof window & { BroadcastChannel?: typeof BroadcastChannel }
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const broadcastDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'BroadcastChannel')
    const addDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'addEventListener')
    const removeDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'removeEventListener')
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: { request: vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation()) } },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
      Object.defineProperty(windowObject, 'BroadcastChannel', { configurable: true, value: FakeBroadcastChannel })
      Object.defineProperty(windowObject, 'addEventListener', { configurable: true, value: vi.fn() })
      Object.defineProperty(windowObject, 'removeEventListener', { configurable: true, value: vi.fn() })
      const first = attempt(1)
      const later = attempt(2, { sender: otherSender })
      await TransferJournalService.createDispatching(first)
      await TransferJournalService.createDispatching(later)

      const reconcileA = vi.fn(async () => [])
      const reconcileB = vi.fn(async () => {
        const records = await TransferJournalService.read()
        publishingTab = 'B'
        try {
          return await Promise.all(records
            .filter(record => record.state === 'unknown')
            .map(record => TransferJournalService.transition(
              record.attemptId,
              'pending',
              record.updatedAt + 1,
              { source: 'reconciliation' },
            )))
        } finally {
          publishingTab = null
        }
      })
      const lifecycleA = createTransferReconciliationService({
        reconcile: reconcileA,
        reconcileOnStartup: reconcileA,
        reconcileOnUnlock: reconcileA,
        reconcileOnFocus: reconcileA,
        reconcileOnOnline: reconcileA,
      })
      const lifecycleB = createTransferReconciliationService({
        reconcile: reconcileB,
        reconcileOnStartup: reconcileB,
        reconcileOnUnlock: reconcileB,
        reconcileOnFocus: reconcileB,
        reconcileOnOnline: reconcileB,
      })
      subscriptionTab = 'A'
      const unsubscribeA = subscribeTransferJournal(() => {
        void lifecycleA.reconcileTransfers('journal').catch(() => undefined)
      })
      subscriptionTab = 'B'
      const unsubscribeB = subscribeTransferJournal(() => {
        void lifecycleB.reconcileTransfers('journal').catch(() => undefined)
      })
      subscriptionTab = null
      try {
        expect(channels.filter(channel => !channel.closed)).toHaveLength(2)
        publishingTab = 'A'
        await TransferJournalService.transition(first.attemptId, 'unknown', first.createdAt + 1)
        publishingTab = null
        await vi.waitFor(() => expect(reconcileB).toHaveBeenCalledTimes(1))
        await vi.waitFor(async () => {
          await expect(TransferJournalService.find(first.attemptId)).resolves.toMatchObject({ state: 'pending' })
        })
        await Promise.resolve()
        expect(reconcileA).not.toHaveBeenCalled()

        publishingTab = 'A'
        await TransferJournalService.transition(later.attemptId, 'unknown', later.createdAt + 1)
        publishingTab = null
        await vi.waitFor(() => expect(reconcileB).toHaveBeenCalledTimes(2))
        await vi.waitFor(async () => {
          await expect(TransferJournalService.find(later.attemptId)).resolves.toMatchObject({ state: 'pending' })
        })
        expect(reconcileA).not.toHaveBeenCalled()

        await lifecycleA.reconcileTransfers('submission')
        expect(reconcileA).toHaveBeenCalledTimes(1)
      } finally {
        publishingTab = null
        unsubscribeA()
        unsubscribeB()
        lifecycleA.dispose()
        lifecycleB.dispose()
      }
      expect(channels.every(channel => channel.closed)).toBe(true)
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
      else delete (globalThis as { document?: unknown }).document
      if (broadcastDescriptor) Object.defineProperty(windowObject, 'BroadcastChannel', broadcastDescriptor)
      else Reflect.deleteProperty(windowObject, 'BroadcastChannel')
      if (addDescriptor) Object.defineProperty(windowObject, 'addEventListener', addDescriptor)
      else Reflect.deleteProperty(windowObject, 'addEventListener')
      if (removeDescriptor) Object.defineProperty(windowObject, 'removeEventListener', removeDescriptor)
      else Reflect.deleteProperty(windowObject, 'removeEventListener')
    }
  })
})
