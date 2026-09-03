import { PrivateKey } from '@goldenera/cryptoj'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getBalances: vi.fn(),
  getMempoolRecommendedFees: vi.fn(),
  getNextNonce: vi.fn(),
  getTransactionStatus: vi.fn(),
  submitTransaction: vi.fn(),
}))

const preferences = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@project/api', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}))
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: preferences.get,
    set: preferences.set,
  },
}))

import {
  createTransferReconciliationService,
  getCurrentWalletAuthorizationSnapshot,
  getPrivateKeyForAuthorization,
  reconcileTransfers,
  transferCoordinator,
} from '../../packages/core/src/services/TransferCoordinatorService'
import { useWalletStore, type WalletSessionSnapshot } from '../../packages/core/src/store/WalletStore'
import {
  TransferJournalService,
  type TransferJournalRecord,
} from '../../packages/core/src/services/TransferJournalService'
import golden from '../fixtures/crypto-v0.2.0.json'

const native = '0x0000000000000000000000000000000000000000'
const token = '0x3333333333333333333333333333333333333333'
const recipient = '0x2222222222222222222222222222222222222222'
const privateKey = PrivateKey.fromMnemonic(golden.seeds[0].mnemonic, golden.seeds[0].passphrase, golden.seeds[0].index)
const sender = privateKey.getAddress().toLowerCase()
const originalState = useWalletStore.getState()
let session: WalletSessionSnapshot
let getPrivateKeyForSnapshot: ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function reconciliationRecord(state: TransferJournalRecord['state']): TransferJournalRecord {
  return {
    version: 1,
    attemptId: '00000000-0000-4000-8000-000000000099',
    network: 'MAINNET',
    walletId: 'wallet-production-test',
    vaultRevision: 3,
    sender,
    recipient,
    tokenAddress: native,
    hash: `0x${'9'.padStart(64, '0')}`,
    nonce: '9',
    amount: '100',
    fee: '2500',
    signedSize: 137,
    state,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    submissionStartedAt: 1_700_000_000_000,
  }
}

beforeEach(() => {
  preferences.values.clear()
  preferences.get.mockImplementation(async ({ key }: { key: string }) => ({
    value: preferences.values.get(key) ?? null,
  }))
  preferences.set.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
    preferences.values.set(key, value)
  })

  session = {
    revision: 9,
    vaultId: 'wallet-production-test',
    vaultRevision: 3,
    address: sender,
    storageToken: 'session-token',
  }
  getPrivateKeyForSnapshot = vi.fn(() => privateKey)
  useWalletStore.setState({
    getSessionSnapshot: () => session,
    getPrivateKeyForSnapshot,
  })
})

afterEach(() => {
  vi.useRealTimers()
  useWalletStore.setState(originalState, true)
  preferences.values.clear()
})

describe('production TransferCoordinator dependencies', () => {
  it('maps the exact Store session identity without exposing its storage token', () => {
    expect(getCurrentWalletAuthorizationSnapshot()).toEqual({
      walletId: session.vaultId,
      vaultRevision: session.vaultRevision,
      generation: session.revision,
      storageToken: session.storageToken,
      sender,
    })
  })

  it('returns a private key only through an exact fresh Store snapshot', () => {
    const authorization = getCurrentWalletAuthorizationSnapshot()
    expect(getPrivateKeyForAuthorization(authorization)).toBe(privateKey)
    expect(getPrivateKeyForSnapshot).toHaveBeenCalledWith(session)

    getPrivateKeyForSnapshot.mockClear()
    expect(getPrivateKeyForAuthorization({ ...authorization, generation: authorization.generation + 1 })).toBeNull()
    expect(getPrivateKeyForSnapshot).not.toHaveBeenCalled()
  })

  it('rejects a reviewed transfer after a storage-token-only operation fence before private-key access or POST', async () => {
    api.getNextNonce.mockResolvedValue({ data: '7' })
    api.getBalances.mockResolvedValue({ data: [
      { address: sender, tokenAddress: token, balance: '1000000' },
      { address: sender, tokenAddress: native, balance: '1000000' },
    ] })
    api.getMempoolRecommendedFees.mockResolvedValue({ data: {
      slow: { baseFee: '1', feePerByte: '1', minimumTotalFee: '150', miningFeePerByte: '0', totalForAverageTx: '150' },
      standard: { baseFee: '1000', feePerByte: '10', minimumTotalFee: '2500', miningFeePerByte: '0', totalForAverageTx: '2500' },
      fast: { baseFee: '2000', feePerByte: '20', minimumTotalFee: '5000', miningFeePerByte: '0', totalForAverageTx: '5000' },
    } })
    const authorization = getCurrentWalletAuthorizationSnapshot()
    const review = await transferCoordinator.prepare({
      sender,
      recipient,
      tokenAddress: token,
      amount: '100',
      feeLevel: 'standard',
    })
    session = { ...session, storageToken: 'fenced-session-token' }
    getPrivateKeyForSnapshot.mockClear()

    expect(getPrivateKeyForAuthorization(authorization)).toBeNull()
    await expect(transferCoordinator.confirm(review)).rejects.toThrow(/active wallet changed/)
    expect(session.revision).toBe(9)
    expect(getPrivateKeyForSnapshot).not.toHaveBeenCalled()
    expect(api.submitTransaction).not.toHaveBeenCalled()
  })

  it('normalizes a transitional numeric nonce while requesting only the selected balances and fee level', async () => {
    api.getNextNonce.mockResolvedValue({ data: 7 })
    api.getBalances.mockResolvedValue({ data: [
      { address: sender, tokenAddress: token, balance: '1000000' },
      { address: sender, tokenAddress: native, balance: '1000000' },
    ] })
    api.getMempoolRecommendedFees.mockResolvedValue({ data: {
      slow: { baseFee: '1', feePerByte: '1', minimumTotalFee: '150', miningFeePerByte: '0', totalForAverageTx: '150' },
      standard: { baseFee: '1000', feePerByte: '10', minimumTotalFee: '2500', miningFeePerByte: '0', totalForAverageTx: '2500' },
      fast: { baseFee: '2000', feePerByte: '20', minimumTotalFee: '5000', miningFeePerByte: '0', totalForAverageTx: '5000' },
    } })

    const review = await transferCoordinator.prepare({
      sender,
      recipient,
      tokenAddress: token,
      amount: '100',
      feeLevel: 'standard',
    })

    expect(review).toMatchObject({
      walletId: session.vaultId,
      vaultRevision: session.vaultRevision,
      walletGeneration: session.revision,
      walletStorageToken: session.storageToken,
      sender,
      recipient,
      tokenAddress: token,
      amount: '100',
      feeLevel: 'standard',
      nodeNextNonce: '7',
      nonce: '7',
      recommendation: {
        baseFee: '1000', feePerByte: '10', minimumTotalFee: '2500', miningFeePerByte: '0', totalForAverageTx: '2500',
      },
    })
    expect(api.getNextNonce).toHaveBeenCalledWith({
      query: { address: sender },
      signal: expect.any(AbortSignal),
    })
    expect(api.getBalances).toHaveBeenCalledWith({
      query: { addresses: [sender], tokenAddresses: [token, native] },
      signal: expect.any(AbortSignal),
    })
    expect(api.getMempoolRecommendedFees).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(api.submitTransaction).not.toHaveBeenCalled()
    expect(api.getTransactionStatus).not.toHaveBeenCalled()
  })

  it('runs lifecycle reconciliation single-flight without signing or submitting', async () => {
    const pending = deferred<Awaited<ReturnType<typeof transferCoordinator.reconcileOnFocus>>>()
    const focus = vi.spyOn(transferCoordinator, 'reconcileOnFocus').mockReturnValue(pending.promise)
    const online = vi.spyOn(transferCoordinator, 'reconcileOnOnline').mockResolvedValue([])
    const unlock = vi.spyOn(transferCoordinator, 'reconcileOnUnlock').mockResolvedValue([])

    const first = reconcileTransfers('focus')
    const concurrent = reconcileTransfers('online')
    expect(concurrent).toBe(first)
    await Promise.resolve()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(online).not.toHaveBeenCalled()
    expect(getPrivateKeyForSnapshot).not.toHaveBeenCalled()
    expect(api.submitTransaction).not.toHaveBeenCalled()

    pending.resolve([])
    await first
    await reconcileTransfers('unlock')
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(online).not.toHaveBeenCalled()
    expect(getPrivateKeyForSnapshot).not.toHaveBeenCalled()
    expect(api.submitTransaction).not.toHaveBeenCalled()
  })

  it('automatically retries a grace-deferred record after propagation grace without signing or replaying', async () => {
    vi.useFakeTimers()
    const anchoredAt = 1_700_000_000_000
    vi.setSystemTime(anchoredAt)
    const record = await TransferJournalService.createDispatching({
      attemptId: '00000000-0000-4000-8000-000000000077',
      network: 'MAINNET',
      walletId: session.vaultId,
      vaultRevision: session.vaultRevision,
      sender,
      recipient,
      tokenAddress: native,
      hash: `0x${'a'.repeat(64)}`,
      nonce: '7',
      amount: '100',
      fee: '2500',
      signedSize: 137,
      createdAt: anchoredAt,
      submissionStartedAt: anchoredAt,
    })
    await TransferJournalService.transition(record.attemptId, 'accepted', anchoredAt)
    api.getTransactionStatus.mockResolvedValue({ data: {
      status: 'ABSENT_REUSABLE',
      hash: record.hash,
      sender: record.sender,
      nonce: record.nonce,
      nextNonce: record.nonce,
      confirmations: null,
      requiredConfirmations: '6',
    } })
    const service = createTransferReconciliationService(transferCoordinator, {
      passiveTriggerCooldownMs: 5_000,
      automaticRetryDelaysMs: [60_000],
    })

    await expect(service.reconcileTransfers('focus')).resolves.toMatchObject([{ state: 'accepted' }])
    expect(api.getTransactionStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(api.getTransactionStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(api.getTransactionStatus).toHaveBeenCalledTimes(2))
    await vi.waitFor(async () => {
      expect(await TransferJournalService.find(record.attemptId)).toMatchObject({ state: 'absent-reusable' })
    })
    expect(getPrivateKeyForSnapshot).not.toHaveBeenCalled()
    expect(api.submitTransaction).not.toHaveBeenCalled()
    service.dispose()
  })

  it('schedules bounded backoff retries until grace can produce a terminal observation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const coordinator = {
      reconcile: vi.fn()
        .mockResolvedValueOnce([reconciliationRecord('unknown')])
        .mockResolvedValueOnce([reconciliationRecord('absent-reusable')]),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(async () => [reconciliationRecord('unknown')]),
      reconcileOnOnline: vi.fn(async () => []),
    }
    const service = createTransferReconciliationService(coordinator, {
      passiveTriggerCooldownMs: 50,
      automaticRetryDelaysMs: [100, 200],
    })

    await expect(service.reconcileTransfers('focus')).resolves.toMatchObject([{ state: 'unknown' }])
    await vi.advanceTimersByTimeAsync(99)
    expect(coordinator.reconcile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('stops automatic retries at the configured bound for persistently blocked records', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const blocked = [reconciliationRecord('blocked-unknown')]
    const coordinator = {
      reconcile: vi.fn(async () => blocked),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(async () => blocked),
      reconcileOnOnline: vi.fn(async () => []),
    }
    const service = createTransferReconciliationService(coordinator, {
      passiveTriggerCooldownMs: 50,
      automaticRetryDelaysMs: [10, 20],
    })

    await service.reconcileTransfers('focus')
    await vi.advanceTimersByTimeAsync(30)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('retries unexpected reconciliation rejections while preserving the original rejection and single-flight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const failure = new Error('journal read failed')
    const retry = deferred<TransferJournalRecord[]>()
    const coordinator = {
      reconcile: vi.fn(() => retry.promise),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(async () => { throw failure }),
      reconcileOnOnline: vi.fn(async () => []),
    }
    const service = createTransferReconciliationService(coordinator, {
      passiveTriggerCooldownMs: 50,
      automaticRetryDelaysMs: [10, 20],
    })

    await expect(service.reconcileTransfers('focus')).rejects.toBe(failure)
    await vi.advanceTimersByTimeAsync(10)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)
    const concurrent = service.reconcileTransfers('online')
    expect(coordinator.reconcileOnOnline).not.toHaveBeenCalled()

    retry.resolve([])
    await expect(concurrent).resolves.toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('does not start a retry until a rejected reconciliation run has fully settled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const delayedFailure = deferred<TransferJournalRecord[]>()
    const failure = new Error('a sender worker failed')
    const coordinator = {
      reconcile: vi.fn(async () => []),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(() => delayedFailure.promise),
      reconcileOnOnline: vi.fn(async () => []),
    }
    const service = createTransferReconciliationService(coordinator, {
      automaticRetryDelaysMs: [10],
    })

    const first = service.reconcileTransfers('focus')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(coordinator.reconcile).not.toHaveBeenCalled()
    delayedFailure.reject(failure)
    await expect(first).rejects.toBe(failure)
    await vi.advanceTimersByTimeAsync(9)
    expect(coordinator.reconcile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('coalesces submission and journal hints during an active run into one fresh follow-up pass', async () => {
    const initial = deferred<TransferJournalRecord[]>()
    const refreshed = deferred<TransferJournalRecord[]>()
    const freshRecords = [reconciliationRecord('unknown')]
    const coordinator = {
      reconcile: vi.fn(() => refreshed.promise),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(() => initial.promise),
      reconcileOnOnline: vi.fn(async () => []),
    }
    const service = createTransferReconciliationService(coordinator)

    const first = service.reconcileTransfers('focus')
    await vi.waitFor(() => expect(coordinator.reconcileOnFocus).toHaveBeenCalledTimes(1))
    const submission = service.reconcileTransfers('submission')
    const journal = service.reconcileTransfers('journal')
    const duplicateJournal = service.reconcileTransfers('journal')
    const anotherSubmission = service.reconcileTransfers('submission')
    expect(journal).toBe(submission)
    expect(duplicateJournal).toBe(submission)
    expect(anotherSubmission).toBe(submission)
    expect(coordinator.reconcile).not.toHaveBeenCalled()

    initial.resolve([])
    await expect(first).resolves.toEqual([])
    await vi.waitFor(() => expect(coordinator.reconcile).toHaveBeenCalledTimes(1))
    refreshed.resolve(freshRecords)
    await expect(submission).resolves.toEqual(freshRecords)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('bounds failed automatic reconciliation retries and cancels them on disposal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const failure = new Error('journal transition failed')
    const coordinator = {
      reconcile: vi.fn(async () => { throw failure }),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(async () => { throw failure }),
      reconcileOnOnline: vi.fn(async () => []),
    }
    const service = createTransferReconciliationService(coordinator, {
      passiveTriggerCooldownMs: 50,
      automaticRetryDelaysMs: [10, 20],
    })

    await expect(service.reconcileTransfers('focus')).rejects.toBe(failure)
    await vi.advanceTimersByTimeAsync(30)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)

    const disposal = createTransferReconciliationService(coordinator, {
      automaticRetryDelaysMs: [10],
    })
    await expect(disposal.reconcileTransfers('focus')).rejects.toBe(failure)
    disposal.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('coalesces repeated focus/online events and safely reschedules one follow-up after cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const blocked = [reconciliationRecord('blocked-unknown')]
    const focusResult = deferred<TransferJournalRecord[]>()
    const coordinator = {
      reconcile: vi.fn(async () => [reconciliationRecord('confirmed')]),
      reconcileOnStartup: vi.fn(async () => []),
      reconcileOnUnlock: vi.fn(async () => []),
      reconcileOnFocus: vi.fn(() => focusResult.promise),
      reconcileOnOnline: vi.fn(async () => blocked),
    }
    const service = createTransferReconciliationService(coordinator, {
      passiveTriggerCooldownMs: 50,
      automaticRetryDelaysMs: [100],
    })

    const first = service.reconcileTransfers('focus')
    const concurrent = service.reconcileTransfers('online')
    expect(concurrent).toBe(first)
    focusResult.resolve(blocked)
    await first

    await service.reconcileTransfers('focus')
    await service.reconcileTransfers('online')
    expect(coordinator.reconcileOnFocus).toHaveBeenCalledTimes(1)
    expect(coordinator.reconcileOnOnline).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(49)
    await service.reconcileTransfers('online')
    expect(coordinator.reconcileOnOnline).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await service.reconcileTransfers('online')
    expect(coordinator.reconcileOnOnline).toHaveBeenCalledTimes(1)

    await service.reconcileTransfers('focus')
    await vi.advanceTimersByTimeAsync(99)
    expect(coordinator.reconcile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(coordinator.reconcile).toHaveBeenCalledTimes(1)
    service.dispose()
  })
})
