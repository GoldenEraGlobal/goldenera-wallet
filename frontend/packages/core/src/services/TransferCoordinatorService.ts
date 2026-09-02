import {
  getBalances,
  getMempoolRecommendedFees,
  getNextNonce,
  getTransactionStatus,
  normalizeApiInteger,
  submitTransaction,
} from '@project/api'
import type { PrivateKey } from '@goldenera/cryptoj'
import { useWalletStore, type WalletSessionSnapshot } from '../store/WalletStore'
import {
  TransferCoordinator,
  TransferSessionChangedError,
  type TransferCoordinatorDependencies,
  type TransferFeeLevel,
  type WalletAuthorizationSnapshot,
} from './TransferCoordinator'
import type { TransferJournalRecord, TransferJournalRecoveryState } from './TransferJournalService'

function matchesAuthorization(
  session: WalletSessionSnapshot,
  expected: Readonly<WalletAuthorizationSnapshot>,
): boolean {
  return session.vaultId === expected.walletId &&
    session.vaultRevision === expected.vaultRevision &&
    session.revision === expected.generation &&
    session.storageToken === expected.storageToken &&
    session.address === expected.sender.toLowerCase()
}

export function getCurrentWalletAuthorizationSnapshot(): WalletAuthorizationSnapshot {
  const session = useWalletStore.getState().getSessionSnapshot()
  if (!session) throw new TransferSessionChangedError('Unlock the wallet before preparing a transaction.')
  return {
    walletId: session.vaultId,
    vaultRevision: session.vaultRevision,
    generation: session.revision,
    storageToken: session.storageToken,
    sender: session.address,
  }
}

export function getPrivateKeyForAuthorization(
  expected: Readonly<WalletAuthorizationSnapshot>,
): PrivateKey | null {
  const state = useWalletStore.getState()
  const session = state.getSessionSnapshot()
  if (!session || !matchesAuthorization(session, expected)) return null
  return state.getPrivateKeyForSnapshot(session)
}

const productionDependencies: TransferCoordinatorDependencies = {
  getWalletSnapshot: getCurrentWalletAuthorizationSnapshot,
  getPrivateKey: getPrivateKeyForAuthorization,
  getNextNonce: async (sender, signal) => {
    const response = await getNextNonce({ query: { address: sender }, signal })
    return normalizeApiInteger(response.data, 'next nonce')
  },
  getBalances: async (request, signal) => {
    const response = await getBalances({
      query: {
        addresses: [request.sender],
        tokenAddresses: [...request.tokenAddresses],
      },
      signal,
    })
    return response.data
  },
  getFeeRecommendation: async (feeLevel: TransferFeeLevel, signal) => {
    const response = await getMempoolRecommendedFees({ signal })
    return response.data[feeLevel]
  },
  submitTransaction: async (hexData, signal) => {
    const response = await submitTransaction({ body: { hexData }, signal })
    return response.data
  },
  getTransactionStatus: async (request, signal) => {
    const response = await getTransactionStatus({ query: request, signal })
    return response.data
  },
}

export const transferCoordinator = new TransferCoordinator(productionDependencies)

export function getTransferJournalRecoveryState(): Promise<TransferJournalRecoveryState | null> {
  return transferCoordinator.getJournalRecoveryState()
}

export function recoverTransferJournal(): Promise<TransferJournalRecoveryState> {
  return transferCoordinator.recoverJournal()
}

export type TransferReconciliationTrigger = 'startup' | 'unlock' | 'focus' | 'online' | 'submission' | 'journal'

type TransferReconciliationCoordinator = Pick<TransferCoordinator,
  | 'reconcile'
  | 'reconcileOnStartup'
  | 'reconcileOnUnlock'
  | 'reconcileOnFocus'
  | 'reconcileOnOnline'>

export interface TransferReconciliationPolicyOptions {
  now?: () => number
  passiveTriggerCooldownMs?: number
  automaticRetryDelaysMs?: readonly number[]
}

export interface TransferReconciliationService {
  reconcileTransfers(trigger: TransferReconciliationTrigger): Promise<TransferJournalRecord[]>
  dispose(): void
}

const DEFAULT_PASSIVE_TRIGGER_COOLDOWN_MS = 5_000
const DEFAULT_AUTOMATIC_RETRY_DELAYS_MS = Object.freeze([10_000, 30_000, 60_000])
const MAX_AUTOMATIC_RETRIES = 8
const terminalStates = new Set<TransferJournalRecord['state']>([
  'rejected',
  'confirmed',
  'absent-reusable',
  'consumed-superseded',
])

function parsePolicyDuration(value: number, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 10 * 60 * 1000) {
    throw new Error(`Invalid transfer reconciliation ${field}.`)
  }
  return value
}

export function createTransferReconciliationService(
  coordinator: TransferReconciliationCoordinator,
  options: TransferReconciliationPolicyOptions = {},
): TransferReconciliationService {
  const now = options.now ?? (() => Date.now())
  const passiveTriggerCooldownMs = parsePolicyDuration(
    options.passiveTriggerCooldownMs ?? DEFAULT_PASSIVE_TRIGGER_COOLDOWN_MS,
    'passive trigger cooldown',
    true,
  )
  const automaticRetryDelaysMs = options.automaticRetryDelaysMs ?? DEFAULT_AUTOMATIC_RETRY_DELAYS_MS
  if (automaticRetryDelaysMs.length > MAX_AUTOMATIC_RETRIES) {
    throw new Error('Too many automatic transfer reconciliation retries.')
  }
  const retryDelays = automaticRetryDelaysMs.map(delay =>
    parsePolicyDuration(delay, 'automatic retry delay'))

  let activeReconciliation: Promise<TransferJournalRecord[]> | null = null
  let lastActivityAt: number | null = null
  let lastRecords: TransferJournalRecord[] = []
  let retryIndex = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let queuedFreshFollowUp: {
    promise: Promise<TransferJournalRecord[]>
    resolve: (records: TransferJournalRecord[]) => void
    reject: (error: unknown) => void
  } | null = null
  let disposed = false

  const clearRetryTimer = () => {
    if (retryTimer === null) return
    clearTimeout(retryTimer)
    retryTimer = null
  }

  const needsFollowUp = (records: readonly TransferJournalRecord[]) =>
    records.some(record => !terminalStates.has(record.state))

  const invoke = (trigger: TransferReconciliationTrigger | 'retry') =>
    trigger === 'retry' || trigger === 'submission' || trigger === 'journal'
    ? coordinator.reconcile()
    : trigger === 'startup'
      ? coordinator.reconcileOnStartup()
      : trigger === 'unlock'
        ? coordinator.reconcileOnUnlock()
        : trigger === 'online'
          ? coordinator.reconcileOnOnline()
          : coordinator.reconcileOnFocus()

  const scheduleFollowUp = () => {
    if (disposed || retryTimer !== null || retryIndex >= retryDelays.length) return
    const delay = retryDelays[retryIndex++]!
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (disposed) return
      void startReconciliation('retry', true).catch(() => undefined)
    }, delay)
  }

  const queueFreshFollowUp = (): Promise<TransferJournalRecord[]> => {
    if (queuedFreshFollowUp) return queuedFreshFollowUp.promise
    let resolve!: (records: TransferJournalRecord[]) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<TransferJournalRecord[]>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    queuedFreshFollowUp = { promise, resolve, reject }
    return promise
  }

  const startQueuedFreshFollowUp = () => {
    const queued = queuedFreshFollowUp
    if (!queued) return
    queuedFreshFollowUp = null
    const followUp = disposed
      ? Promise.resolve<TransferJournalRecord[]>([])
      : startReconciliation('submission', false)
    void followUp.then(queued.resolve, queued.reject)
  }

  function startReconciliation(
    trigger: TransferReconciliationTrigger | 'retry',
    automatic: boolean,
  ): Promise<TransferJournalRecord[]> {
    if (disposed) return Promise.resolve([])
    if (activeReconciliation) return activeReconciliation
    if (!automatic) {
      clearRetryTimer()
      retryIndex = 0
    }
    lastActivityAt = now()
    const operation = Promise.resolve().then(() => invoke(trigger))
    const settled = operation.then(
      records => {
        lastRecords = records
        lastActivityAt = now()
        if (activeReconciliation === settled) activeReconciliation = null
        if (queuedFreshFollowUp) startQueuedFreshFollowUp()
        else if (needsFollowUp(records)) scheduleFollowUp()
        else {
          clearRetryTimer()
          retryIndex = 0
        }
        return records
      },
      error => {
        lastActivityAt = now()
        if (activeReconciliation === settled) activeReconciliation = null
        if (queuedFreshFollowUp) startQueuedFreshFollowUp()
        else scheduleFollowUp()
        throw error
      },
    )
    activeReconciliation = settled
    return settled
  }

  return {
    reconcileTransfers(trigger) {
      if (disposed) return Promise.resolve([])
      if (activeReconciliation) {
        if (trigger === 'submission' || trigger === 'journal') return queueFreshFollowUp()
        return activeReconciliation
      }
      const currentTime = now()
      const passiveTrigger = trigger === 'focus' || trigger === 'online'
      if (passiveTrigger && lastActivityAt !== null &&
        (currentTime < lastActivityAt || currentTime - lastActivityAt < passiveTriggerCooldownMs)) {
        if (needsFollowUp(lastRecords)) scheduleFollowUp()
        return Promise.resolve(lastRecords)
      }
      return startReconciliation(trigger, false)
    },
    dispose() {
      disposed = true
      clearRetryTimer()
      queuedFreshFollowUp?.resolve([])
      queuedFreshFollowUp = null
    },
  }
}

const reconciliationService = createTransferReconciliationService(transferCoordinator)
export const reconcileTransfers = reconciliationService.reconcileTransfers
