import { bytesToHex } from '@goldenera/cryptoj'
import type { PrivateKey } from '@goldenera/cryptoj'
import z from 'zod/v4'
import { createUuid } from '../utils/UuidUtil'
import {
  TransferJournalService,
  type NewTransferAttempt,
  TransferJournalRecoveryBlockedError,
  TransferJournalRecoveryRequiredError,
  type TransferJournalRecord,
  type TransferJournalRecoveryState,
  type TransferJournalState,
  type TransferJournalTransitionOptions,
} from './TransferJournalService'
import {
  createExactFeeTransfer,
  type TransferFeeRecommendation,
} from './TransferFee'
import { withWalletAuthorizationBarrier } from './WalletSessionService'

const NETWORK = 'MAINNET' as const
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const DEFAULT_REVIEW_MAX_AGE_MS = 2 * 60 * 1000
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 15_000
const DEFAULT_SUBMISSION_TIMEOUT_MS = 15_000
const DEFAULT_RECONCILIATION_TIMEOUT_MS = 40_000
const DEFAULT_PROPAGATION_GRACE_MS = 60_000
const MAX_RECONCILIATION_SENDER_CONCURRENCY = 3
const MAX_UINT256 = (1n << 256n) - 1n

const canonicalDecimal = /^(0|[1-9][0-9]*)$/
const canonicalAddress = /^0x[0-9a-f]{40}$/
const canonicalHash = /^0x[0-9a-f]{64}$/
const walletIdentity = /^[A-Za-z0-9._:-]{1,200}$/

const decimalSchema = z.string()
  .max(78)
  .refine(value => canonicalDecimal.test(value) && BigInt(value) <= MAX_UINT256, 'invalid uint256 decimal')
const addressSchema = z.string().regex(canonicalAddress)
const feeLevelSchema = z.enum(['fast', 'standard', 'slow'])
const feeRecommendationSchema = z.object({
  baseFee: decimalSchema,
  feePerByte: decimalSchema,
  totalForAverageTx: decimalSchema,
}).strict()

const walletSnapshotSchema = z.object({
  walletId: z.string().regex(walletIdentity),
  vaultRevision: z.number().int().nonnegative().safe(),
  generation: z.number().int().nonnegative().safe(),
  storageToken: z.string().nullable(),
  sender: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
}).strict()

const prepareTransferSchema = z.object({
  sender: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: decimalSchema.refine(value => BigInt(value) > 0n, 'Transfer amount must be positive'),
  feeLevel: feeLevelSchema,
}).strict()

const transferReviewSchema = z.object({
  version: z.literal(1),
  reviewId: z.string().uuid(),
  network: z.literal(NETWORK),
  walletId: z.string().regex(walletIdentity),
  vaultRevision: z.number().int().nonnegative().safe(),
  walletGeneration: z.number().int().nonnegative().safe(),
  walletStorageToken: z.string().nullable(),
  sender: addressSchema,
  recipient: addressSchema,
  tokenAddress: addressSchema,
  amount: decimalSchema,
  feeLevel: feeLevelSchema,
  fee: decimalSchema,
  nonce: decimalSchema,
  nodeNextNonce: decimalSchema,
  acceptedNonceHighWater: decimalSchema.nullable(),
  timestamp: decimalSchema,
  estimatedSignedSize: z.number().int().positive().max(1_048_576).safe(),
  recommendation: feeRecommendationSchema,
  balanceFingerprint: z.string().min(1).max(512),
  preparedAt: z.number().int().nonnegative().safe(),
}).strict()

const balanceRowSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  balance: decimalSchema,
}).passthrough()

const transactionStatusSchema = z.object({
  status: z.enum([
    'PENDING',
    'CONFIRMING',
    'CONFIRMED',
    'ABSENT_REUSABLE',
    'CONSUMED_SUPERSEDED',
    'BLOCKED_UNKNOWN',
  ]),
  hash: addressLikeHashSchema(),
  sender: addressSchema,
  nonce: decimalSchema,
  nextNonce: decimalSchema.nullable(),
  confirmations: decimalSchema.nullable(),
  requiredConfirmations: decimalSchema,
}).strict()

const mempoolResultSchema = z.object({
  status: z.string(),
  message: z.string().nullable().optional(),
}).strict()

function addressLikeHashSchema() {
  return z.string().regex(canonicalHash)
}

export interface WalletAuthorizationSnapshot {
  walletId: string
  vaultRevision: number
  generation: number
  storageToken: string | null
  sender: string
}

export type TransferFeeLevel = z.infer<typeof feeLevelSchema>

export interface PrepareTransferInput {
  sender: string
  recipient: string
  tokenAddress: string
  amount: string
  feeLevel: TransferFeeLevel
}

export interface TransferBalanceRow {
  address: string
  tokenAddress: string
  balance: string
  [key: string]: unknown
}

export interface TransferBalanceRequest {
  sender: string
  tokenAddresses: readonly string[]
}

export interface TransactionStatusRequest {
  hash: string
  sender: string
  nonce: string
}

export interface TransferJournalPort {
  read(): Promise<TransferJournalRecord[]>
  createDispatching(input: NewTransferAttempt): Promise<TransferJournalRecord>
  transition(
    attemptId: string,
    state: TransferJournalState,
    updatedAt?: number,
    options?: TransferJournalTransitionOptions,
  ): Promise<TransferJournalRecord>
  find(attemptId: string): Promise<TransferJournalRecord | null>
  listForSender(network: typeof NETWORK, sender: string): Promise<TransferJournalRecord[]>
  getRecoveryState?(): Promise<TransferJournalRecoveryState>
  recover?(): Promise<TransferJournalRecoveryState>
}

export interface TransferCoordinatorDependencies {
  getWalletSnapshot(): WalletAuthorizationSnapshot | Promise<WalletAuthorizationSnapshot>
  getNextNonce(sender: string, signal: AbortSignal): Promise<unknown>
  getBalances(request: TransferBalanceRequest, signal: AbortSignal): Promise<unknown>
  getFeeRecommendation(feeLevel: TransferFeeLevel, signal: AbortSignal): Promise<unknown>
  getPrivateKey(snapshot: Readonly<WalletAuthorizationSnapshot>): PrivateKey | null | Promise<PrivateKey | null>
  submitTransaction(hexData: string, signal: AbortSignal): Promise<unknown>
  getTransactionStatus(request: TransactionStatusRequest, signal: AbortSignal): Promise<unknown>
  journal?: TransferJournalPort
  now?: () => number
  randomUUID?: () => string
  reviewMaxAgeMs?: number
  preflightTimeoutMs?: number
  submissionTimeoutMs?: number
  reconciliationTimeoutMs?: number
  propagationGraceMs?: number
}

export type TransferReview = Readonly<z.infer<typeof transferReviewSchema>>

export type TransferConfirmationResult =
  | Readonly<{ kind: 'reconfirm', review: TransferReview }>
  | Readonly<{ kind: 'accepted' | 'rejected' | 'unknown', record: TransferJournalRecord }>

export class TransferCoordinatorError extends Error {}
export class TransferCoordinationUnavailableError extends TransferCoordinatorError {}
export class TransferBlockedError extends TransferCoordinatorError {
  readonly records: readonly TransferJournalRecord[]

  constructor(records: readonly TransferJournalRecord[]) {
    super('An earlier transaction has an unresolved outcome. Reconcile it before sending again.')
    this.records = records
  }
}
export class TransferBalanceError extends TransferCoordinatorError {}
export class TransferSessionChangedError extends TransferCoordinatorError {}
export class TransferPreflightError extends TransferCoordinatorError {}
export class TransferSubmissionTimeoutError extends TransferCoordinatorError {}

/**
 * The exact attempt is durably marked unknown, but the coordinator could not
 * complete the confirmation call that was meant to report it.
 */
export class TransferDurableUnknownError extends TransferCoordinatorError {
  readonly record: TransferJournalRecord

  constructor(record: TransferJournalRecord, cause: unknown) {
    super('The transaction outcome is unknown and was durably recorded for reconciliation.', { cause })
    this.record = record
  }
}

interface NormalizedWalletSnapshot {
  walletId: string
  vaultRevision: number
  generation: number
  storageToken: string | null
  sender: string
}

interface PreflightObservation {
  snapshot: NormalizedWalletSnapshot
  nodeNextNonce: string
  acceptedNonceHighWater: string | null
  nonce: string
  recommendation: TransferFeeRecommendation
  balances: ReadonlyMap<string, bigint>
}

type ReconciliationTarget = TransferJournalState | 'clock-rollback-reanchor'

const terminalStates = new Set<TransferJournalState>([
  'rejected',
  'confirmed',
  'absent-reusable',
  'consumed-superseded',
])
const blockingStates = new Set<TransferJournalState>(['dispatching', 'unknown', 'blocked-unknown'])
const highWaterStates = new Set<TransferJournalState>([
  'accepted',
  'pending',
  'confirming',
  'confirmed',
  'consumed-superseded',
])
const reusableNonceStates = new Set<TransferJournalState>(['rejected', 'absent-reusable'])
const explicitRejectionStatuses = new Set([
  'REJECTED_FEE',
  'REJECTED_STATE',
  'REJECTED_NONCE_TOO_FAR_FUTURE',
  'REJECTED_MEMPOOL_FULL',
])

const localLaneQueues = new Map<string, Promise<void>>()

function normalizeAddress(value: string, field: string): string {
  const normalized = value.toLowerCase()
  if (!canonicalAddress.test(normalized)) throw new TransferCoordinatorError(`Invalid ${field} address.`)
  return normalized
}

function normalizeSnapshot(value: unknown): NormalizedWalletSnapshot {
  const parsed = walletSnapshotSchema.parse(value)
  return {
    ...parsed,
    sender: normalizeAddress(parsed.sender, 'wallet sender'),
  }
}

function parseCanonicalDecimal(value: unknown, field: string): string {
  const parsed = decimalSchema.safeParse(value)
  if (!parsed.success) throw new TransferPreflightError(`The ${field} is missing or is not a canonical decimal string.`)
  return parsed.data
}

function parseSafeDuration(value: number | undefined, fallback: number, field: string): number {
  const duration = value ?? fallback
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 10 * 60 * 1000) {
    throw new TransferCoordinatorError(`Invalid ${field}.`)
  }
  return duration
}

function assertCoordinationAvailable(): void {
  if (typeof navigator !== 'undefined' && navigator.locks) return
  if (typeof document !== 'undefined') {
    throw new TransferCoordinationUnavailableError(
      'This browser cannot safely coordinate outgoing transactions across tabs. Update your browser and retry.',
    )
  }
}

function laneName(sender: string): string {
  return `goldenera-wallet-transfer-mainnet-${normalizeAddress(sender, 'transaction sender')}`
}

async function withSenderLane<T>(sender: string, operation: () => Promise<T>): Promise<T> {
  assertCoordinationAvailable()
  const name = laneName(sender)
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, operation)
  }

  const previous = localLaneQueues.get(name) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  const settled = result.then(() => undefined, () => undefined)
  localLaneQueues.set(name, settled)
  void settled.finally(() => {
    if (localLaneQueues.get(name) === settled) localLaneQueues.delete(name)
  })
  return result
}

function sameSnapshot(left: NormalizedWalletSnapshot, right: NormalizedWalletSnapshot): boolean {
  return left.walletId === right.walletId &&
    left.vaultRevision === right.vaultRevision &&
    left.generation === right.generation &&
    left.storageToken === right.storageToken &&
    left.sender === right.sender
}

function sameWalletBinding(review: TransferReview, snapshot: NormalizedWalletSnapshot): boolean {
  return review.walletId === snapshot.walletId &&
    review.vaultRevision === snapshot.vaultRevision &&
    review.walletGeneration === snapshot.generation &&
    review.walletStorageToken === snapshot.storageToken &&
    review.sender === snapshot.sender
}

function reviewAuthorizationKey(review: TransferReview): string {
  return JSON.stringify({
    network: review.network,
    walletId: review.walletId,
    vaultRevision: review.vaultRevision,
    walletGeneration: review.walletGeneration,
    walletStorageToken: review.walletStorageToken,
    sender: review.sender,
    recipient: review.recipient,
    tokenAddress: review.tokenAddress,
    amount: review.amount,
    feeLevel: review.feeLevel,
    fee: review.fee,
    nonce: review.nonce,
    nodeNextNonce: review.nodeNextNonce,
    acceptedNonceHighWater: review.acceptedNonceHighWater,
    timestamp: review.timestamp,
    estimatedSignedSize: review.estimatedSignedSize,
    recommendation: review.recommendation,
    balanceFingerprint: review.balanceFingerprint,
    preparedAt: review.preparedAt,
  })
}

function transitionTimestamp(record: TransferJournalRecord, now: number): number {
  return Math.max(record.updatedAt, now)
}

function expectedDispatchingRecord(input: NewTransferAttempt): TransferJournalRecord {
  return {
    version: 1,
    ...input,
    sender: input.sender.toLowerCase(),
    recipient: input.recipient.toLowerCase(),
    tokenAddress: input.tokenAddress.toLowerCase(),
    hash: input.hash.toLowerCase(),
    state: 'dispatching',
    updatedAt: input.submissionStartedAt,
  }
}

function isExactJournalRecord(value: unknown, expected: TransferJournalRecord): value is TransferJournalRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const expectedEntries = Object.entries(expected)
  if (Object.keys(candidate).length !== expectedEntries.length) return false
  return expectedEntries.every(([key, expectedValue]) =>
    Object.hasOwn(candidate, key) && candidate[key] === expectedValue)
}

function parseBalances(value: unknown, sender: string): Map<string, bigint> {
  if (!Array.isArray(value)) throw new TransferBalanceError('The wallet balance response is missing or malformed.')
  const balances = new Map<string, bigint>()
  for (const candidate of value) {
    const parsed = balanceRowSchema.safeParse(candidate)
    if (!parsed.success) throw new TransferBalanceError('The wallet balance response contains an invalid row.')
    const address = normalizeAddress(parsed.data.address, 'balance owner')
    const tokenAddress = normalizeAddress(parsed.data.tokenAddress, 'balance token')
    if (address !== sender) throw new TransferBalanceError('The wallet balance response belongs to another address.')
    if (balances.has(tokenAddress)) throw new TransferBalanceError('The wallet balance response contains a duplicate token row.')
    balances.set(tokenAddress, BigInt(parsed.data.balance))
  }
  return balances
}

function balanceFingerprintEntry(
  balances: ReadonlyMap<string, bigint>,
  tokenAddress: string,
): string {
  const available = balances.get(tokenAddress)
  if (available === undefined) throw new TransferBalanceError('The available balance is missing.')
  return `${tokenAddress}=${available}`
}

/** The backend balance is authoritative and already nets pending outgoing amounts and native fees. */
function assertBalanceAndFingerprint(
  balances: ReadonlyMap<string, bigint>,
  sender: string,
  tokenAddress: string,
  amount: bigint,
  fee: bigint,
): string {
  const nativeBalance = balances.get(NATIVE_TOKEN)
  if (nativeBalance === undefined) throw new TransferBalanceError('The native available balance is missing.')

  if (tokenAddress === NATIVE_TOKEN) {
    if (amount + fee > nativeBalance) throw new TransferBalanceError('Insufficient native balance for amount and fee.')
    return `${sender}|${balanceFingerprintEntry(balances, NATIVE_TOKEN)}`
  }

  const tokenBalance = balances.get(tokenAddress)
  if (tokenBalance === undefined) throw new TransferBalanceError('The token available balance is missing.')
  if (amount > tokenBalance) throw new TransferBalanceError('Insufficient token balance.')
  if (fee > nativeBalance) throw new TransferBalanceError('Insufficient native balance for the fee.')
  return `${sender}|${balanceFingerprintEntry(balances, NATIVE_TOKEN)}` +
    `|${balanceFingerprintEntry(balances, tokenAddress)}`
}

function acceptedHighWater(records: readonly TransferJournalRecord[]): bigint | null {
  let highWater: bigint | null = null
  for (const record of records) {
    if (!highWaterStates.has(record.state)) continue
    const nonce = BigInt(record.nonce)
    if (highWater === null || nonce > highWater) highWater = nonce
  }
  return highWater
}

function createDeadline<T>(
  milliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutError: () => Error,
): Promise<T> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const operationPromise = Promise.resolve().then(() => operation(controller.signal))
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(timeoutError())
    }, milliseconds)
  })
  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  })
}

export class TransferCoordinator {
  private readonly dependencies: TransferCoordinatorDependencies
  private readonly journal: TransferJournalPort
  private readonly now: () => number
  private readonly randomUUID: () => string
  private readonly reviewMaxAgeMs: number
  private readonly preflightTimeoutMs: number
  private readonly submissionTimeoutMs: number
  private readonly reconciliationTimeoutMs: number
  private readonly propagationGraceMs: number

  constructor(dependencies: TransferCoordinatorDependencies) {
    this.dependencies = dependencies
    this.journal = dependencies.journal ?? TransferJournalService
    this.now = dependencies.now ?? (() => Date.now())
    this.randomUUID = dependencies.randomUUID ?? createUuid
    this.reviewMaxAgeMs = parseSafeDuration(dependencies.reviewMaxAgeMs, DEFAULT_REVIEW_MAX_AGE_MS, 'review lifetime')
    this.preflightTimeoutMs = parseSafeDuration(dependencies.preflightTimeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS, 'preflight timeout')
    this.submissionTimeoutMs = parseSafeDuration(dependencies.submissionTimeoutMs, DEFAULT_SUBMISSION_TIMEOUT_MS, 'submission timeout')
    this.reconciliationTimeoutMs = parseSafeDuration(
      dependencies.reconciliationTimeoutMs,
      DEFAULT_RECONCILIATION_TIMEOUT_MS,
      'reconciliation timeout',
    )
    this.propagationGraceMs = parseSafeDuration(
      dependencies.propagationGraceMs,
      DEFAULT_PROPAGATION_GRACE_MS,
      'transaction propagation grace',
    )
  }

  async getJournalRecoveryState(): Promise<TransferJournalRecoveryState | null> {
    return this.journal.getRecoveryState ? this.journal.getRecoveryState() : null
  }

  async recoverJournal(): Promise<TransferJournalRecoveryState> {
    if (!this.journal.recover) {
      throw new TransferCoordinatorError('Transaction recovery is unavailable for this journal.')
    }
    return this.journal.recover()
  }

  async prepare(input: PrepareTransferInput): Promise<TransferReview> {
    const parsed = prepareTransferSchema.parse(input)
    const normalizedInput: PrepareTransferInput = {
      sender: normalizeAddress(parsed.sender, 'transaction sender'),
      recipient: normalizeAddress(parsed.recipient, 'recipient'),
      tokenAddress: normalizeAddress(parsed.tokenAddress, 'token'),
      amount: parsed.amount,
      feeLevel: parsed.feeLevel,
    }
    assertCoordinationAvailable()
    return withSenderLane(normalizedInput.sender, async () => {
      const observation = await this.readPreflight(normalizedInput)
      const now = this.checkedNow()
      return this.materializeReview(normalizedInput, observation, now, now, this.randomUUID())
    })
  }

  async confirm(input: TransferReview): Promise<TransferConfirmationResult> {
    const review = transferReviewSchema.parse(input)
    assertCoordinationAvailable()
    return withSenderLane(review.sender, async () => {
      const preparedInput: PrepareTransferInput = {
        sender: review.sender,
        recipient: review.recipient,
        tokenAddress: review.tokenAddress,
        amount: review.amount,
        feeLevel: review.feeLevel,
      }
      const observation = await this.readPreflight(preparedInput)
      const now = this.checkedNow()
      if (!sameWalletBinding(review, observation.snapshot)) {
        throw new TransferSessionChangedError('The active wallet changed after this transaction was reviewed.')
      }

      const stale = now < review.preparedAt || now - review.preparedAt > this.reviewMaxAgeMs
      const candidate = this.materializeReview(
        preparedInput,
        observation,
        BigInt(review.timestamp),
        review.preparedAt,
        review.reviewId,
      )
      if (stale || reviewAuthorizationKey(candidate) !== reviewAuthorizationKey(review)) {
        const updated = this.materializeReview(preparedInput, observation, now, now, this.randomUUID())
        return Object.freeze({ kind: 'reconfirm', review: updated })
      }

      await this.assertSnapshotCurrent(observation.snapshot)
      const privateKey = await this.dependencies.getPrivateKey(observation.snapshot)
      if (!privateKey) throw new TransferSessionChangedError('The wallet signing session is no longer available.')
      await this.assertSnapshotCurrent(observation.snapshot)

      const exactTransfer = createExactFeeTransfer({
        timestamp: BigInt(review.timestamp),
        sender: review.sender,
        recipient: review.recipient,
        tokenAddress: review.tokenAddress,
        amount: BigInt(review.amount),
        nonce: BigInt(review.nonce),
        recommendation: review.recommendation,
      })
      if (exactTransfer.fee.toString() !== review.fee ||
        exactTransfer.estimatedSignedSize !== review.estimatedSignedSize) {
        throw new TransferPreflightError('The reviewed fee no longer produces the reviewed transaction size.')
      }

      const signed = exactTransfer.sign(privateKey)
      await this.assertSnapshotCurrent(observation.snapshot)
      const hash = normalizeHash(signed.transaction.hash)

      // Signing stays outside the global barrier. The sender lane is already held;
      // the final authorization barrier is acquired only for exact revalidation,
      // journal-before-POST dispatch, and durable outcome classification.
      return withWalletAuthorizationBarrier(async () => {
        await this.assertSnapshotCurrent(observation.snapshot)
        const startedAt = this.checkedNow()
        const attemptId = this.randomUUID()
        const attempt: NewTransferAttempt = {
          attemptId,
          network: NETWORK,
          walletId: observation.snapshot.walletId,
          vaultRevision: observation.snapshot.vaultRevision,
          sender: exactTransfer.sender,
          recipient: exactTransfer.recipient,
          tokenAddress: exactTransfer.tokenAddress,
          hash,
          nonce: exactTransfer.nonce.toString(),
          amount: exactTransfer.amount.toString(),
          fee: exactTransfer.fee.toString(),
          signedSize: signed.encoded.length,
          createdAt: startedAt,
          submissionStartedAt: startedAt,
        }
        const expectedDispatching = expectedDispatchingRecord(attempt)
        const committed = await this.journal.createDispatching(attempt)
        const persisted = await this.journal.find(attemptId)
        if (!isExactJournalRecord(committed, expectedDispatching) ||
          !isExactJournalRecord(persisted, expectedDispatching)) {
          throw new TransferCoordinatorError(
            'The dispatch journal could not be read back and verified. No transaction was sent.',
          )
        }
        const dispatching = persisted

        // Catch same-tab local invalidation during the durable journal write. Global
        // token rotations cannot pass this point until the barrier is released.
        if (!await this.isSnapshotCurrent(observation.snapshot)) {
          const unknown = await this.persistUnknown(dispatching)
          return Object.freeze({ kind: 'unknown' as const, record: unknown })
        }

        const hexData = bytesToHex(signed.encoded)
        let nextState: 'accepted' | 'rejected' | 'unknown'
        try {
          const result = await createDeadline(
            this.submissionTimeoutMs,
            signal => this.dependencies.submitTransaction(hexData, signal),
            () => new TransferSubmissionTimeoutError('The transaction submission outcome is unknown after its deadline.'),
          )
          nextState = classifySubmissionResult(result)
        } catch {
          nextState = 'unknown'
        }
        const record = nextState === 'unknown'
          ? await this.persistUnknown(dispatching)
          : await this.journal.transition(
            dispatching.attemptId,
            nextState,
            transitionTimestamp(dispatching, this.checkedNow()),
          )
        return Object.freeze({ kind: nextState, record })
      })
    })
  }

  async reconcile(): Promise<TransferJournalRecord[]> {
    assertCoordinationAvailable()
    const recovery = await this.getJournalRecoveryState()
    if (recovery?.status === 'action-required') throw new TransferJournalRecoveryRequiredError()
    const records = await this.journal.read()
    const bySender = new Map<string, TransferJournalRecord[]>()
    for (const record of records) {
      if (terminalStates.has(record.state)) continue
      const list = bySender.get(record.sender) ?? []
      list.push(record)
      bySender.set(record.sender, list)
    }
    const entries = [...bySender.entries()]
    const groups: TransferJournalRecord[][] = Array.from({ length: entries.length }, () => [])
    let nextEntry = 0
    const reconcileNextSender = async (): Promise<void> => {
      while (nextEntry < entries.length) {
        const index = nextEntry++
        const [sender, senderRecords] = entries[index]!
        const reconciled: TransferJournalRecord[] = []
        for (const record of senderRecords) {
          const result = await withSenderLane(sender, async () => {
            const current = await this.journal.find(record.attemptId)
            if (!current || terminalStates.has(current.state)) return null
            return this.reconcileRecord(current)
          })
          if (result) reconciled.push(result)
        }
        groups[index] = reconciled
      }
    }
    const workerCount = Math.min(MAX_RECONCILIATION_SENDER_CONCURRENCY, entries.length)
    const workers = await Promise.allSettled(
      Array.from({ length: workerCount }, () => reconcileNextSender()),
    )
    const failure = workers.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    return groups.flat()
  }

  reconcileOnStartup(): Promise<TransferJournalRecord[]> { return this.reconcile() }
  reconcileOnUnlock(): Promise<TransferJournalRecord[]> { return this.reconcile() }
  reconcileOnFocus(): Promise<TransferJournalRecord[]> { return this.reconcile() }
  reconcileOnOnline(): Promise<TransferJournalRecord[]> { return this.reconcile() }

  private async assertJournalRecoveryAllowsSender(sender: string): Promise<void> {
    const recovery = await this.getJournalRecoveryState()
    if (!recovery) return
    if (recovery.status === 'action-required') throw new TransferJournalRecoveryRequiredError()
    if (recovery.status === 'blocked' &&
      (recovery.globalBlocked || recovery.blockedSenders.includes(sender))) {
      throw new TransferJournalRecoveryBlockedError()
    }
  }

  private async readPreflight(input: PrepareTransferInput): Promise<PreflightObservation> {
    return createDeadline(
      this.preflightTimeoutMs,
      async signal => {
        await this.assertJournalRecoveryAllowsSender(input.sender)
        const snapshot = normalizeSnapshot(await this.dependencies.getWalletSnapshot())
        if (snapshot.sender !== input.sender) {
          throw new TransferSessionChangedError('The active wallet does not match the reviewed transaction sender.')
        }
        const senderRecords = await this.journal.listForSender(NETWORK, input.sender)
        const blockers = senderRecords.filter(record => blockingStates.has(record.state))
        if (blockers.length > 0) throw new TransferBlockedError(blockers)
        const tokenAddresses = input.tokenAddress === NATIVE_TOKEN
          ? Object.freeze([NATIVE_TOKEN])
          : Object.freeze([input.tokenAddress, NATIVE_TOKEN])
        const balanceRequest: TransferBalanceRequest = Object.freeze({
          sender: input.sender,
          tokenAddresses,
        })
        const [rawNonce, rawBalances, rawRecommendation] = await Promise.all([
          this.dependencies.getNextNonce(input.sender, signal),
          this.dependencies.getBalances(balanceRequest, signal),
          this.dependencies.getFeeRecommendation(input.feeLevel, signal),
        ])

        const nodeNextNonce = parseCanonicalDecimal(rawNonce, 'next nonce')
        const highWater = acceptedHighWater(senderRecords)
        const nodeNonce = BigInt(nodeNextNonce)
        const exactNonceRecords = senderRecords.filter(record => record.nonce === nodeNextNonce)
        const exactReusableGap = exactNonceRecords.length > 0 &&
          exactNonceRecords.every(record => reusableNonceStates.has(record.state))
        let safeNonce: bigint
        if (highWater === null || nodeNonce > highWater || exactReusableGap) {
          safeNonce = nodeNonce
        } else {
          if (highWater === MAX_UINT256) {
            throw new TransferPreflightError('The accepted transaction nonce has reached the uint256 limit.')
          }
          safeNonce = highWater + 1n
        }
        const recommendation = feeRecommendationSchema.parse(rawRecommendation)
        return {
          snapshot,
          nodeNextNonce,
          acceptedNonceHighWater: highWater?.toString() ?? null,
          nonce: safeNonce.toString(),
          recommendation,
          balances: parseBalances(rawBalances, input.sender),
        }
      },
      () => new TransferPreflightError('The final transaction preflight did not finish within its deadline.'),
    )
  }

  private materializeReview(
    input: PrepareTransferInput,
    observation: PreflightObservation,
    timestamp: bigint | number,
    preparedAt: number,
    reviewId: string,
  ): TransferReview {
    const exact = createExactFeeTransfer({
      timestamp,
      sender: input.sender,
      recipient: input.recipient,
      tokenAddress: input.tokenAddress,
      amount: BigInt(input.amount),
      nonce: BigInt(observation.nonce),
      recommendation: observation.recommendation,
    })
    const balanceFingerprint = assertBalanceAndFingerprint(
      observation.balances,
      input.sender,
      input.tokenAddress,
      BigInt(input.amount),
      exact.fee,
    )
    const review = transferReviewSchema.parse({
      version: 1,
      reviewId,
      network: NETWORK,
      walletId: observation.snapshot.walletId,
      vaultRevision: observation.snapshot.vaultRevision,
      walletGeneration: observation.snapshot.generation,
      walletStorageToken: observation.snapshot.storageToken,
      sender: observation.snapshot.sender,
      recipient: input.recipient,
      tokenAddress: input.tokenAddress,
      amount: input.amount,
      feeLevel: input.feeLevel,
      fee: exact.fee.toString(),
      nonce: observation.nonce,
      nodeNextNonce: observation.nodeNextNonce,
      acceptedNonceHighWater: observation.acceptedNonceHighWater,
      timestamp: exact.timestamp.toString(),
      estimatedSignedSize: exact.estimatedSignedSize,
      recommendation: Object.freeze({ ...observation.recommendation }),
      balanceFingerprint,
      preparedAt,
    })
    return Object.freeze({ ...review, recommendation: Object.freeze({ ...review.recommendation }) })
  }

  private async assertSnapshotCurrent(expected: NormalizedWalletSnapshot): Promise<void> {
    if (!await this.isSnapshotCurrent(expected)) {
      throw new TransferSessionChangedError('The wallet session changed during final transaction authorization.')
    }
  }

  private async isSnapshotCurrent(expected: NormalizedWalletSnapshot): Promise<boolean> {
    try {
      return sameSnapshot(normalizeSnapshot(await this.dependencies.getWalletSnapshot()), expected)
    } catch {
      return false
    }
  }

  private async persistUnknown(dispatching: TransferJournalRecord): Promise<TransferJournalRecord> {
    try {
      const unknown = await this.journal.transition(
        dispatching.attemptId,
        'unknown',
        transitionTimestamp(dispatching, this.checkedNow()),
      )
      if (unknown.attemptId !== dispatching.attemptId || unknown.state !== 'unknown') {
        throw new TransferCoordinatorError('The transaction journal did not retain the required unknown outcome.')
      }
      return unknown
    } catch (error) {
      let persisted: TransferJournalRecord | null = null
      try {
        persisted = await this.journal.find(dispatching.attemptId)
      } catch { /* Preserve the original journal failure unless unknown persistence is verified. */ }
      if (persisted?.state === 'unknown' && persisted.attemptId === dispatching.attemptId) {
        throw new TransferDurableUnknownError(persisted, error)
      }
      throw error
    }
  }

  private async reconcileRecord(record: TransferJournalRecord): Promise<TransferJournalRecord> {
    let raw: unknown
    let target: ReconciliationTarget
    let observedAt: number
    try {
      raw = await createDeadline(
        this.reconciliationTimeoutMs,
        signal => this.dependencies.getTransactionStatus({
          hash: record.hash,
          sender: record.sender,
          nonce: record.nonce,
        }, signal),
        () => new TransferPreflightError('Transaction reconciliation exceeded its deadline.'),
      )
      observedAt = this.checkedNow()
      target = classifyTransactionStatus(raw, record, observedAt, this.propagationGraceMs)
    } catch {
      observedAt = this.checkedNow()
      target = 'blocked-unknown'
    }
    if (target === 'clock-rollback-reanchor') {
      return this.persistClockRollbackReanchor(record, observedAt)
    }
    const updatesObservationAnchor = target !== record.state ||
      (target === 'pending' && isPendingObservation(raw)) ||
      (target === 'confirming' && isConfirmingObservation(raw))
    return this.journal.transition(
      record.attemptId,
      target,
      updatesObservationAnchor ? transitionTimestamp(record, observedAt) : record.updatedAt,
      { source: 'reconciliation' },
    )
  }

  private async persistClockRollbackReanchor(
    record: TransferJournalRecord,
    observedAt: number,
  ): Promise<TransferJournalRecord> {
    const expected: TransferJournalRecord = {
      ...record,
      state: 'blocked-unknown',
      updatedAt: observedAt,
    }
    const committed = await this.journal.transition(
      record.attemptId,
      'blocked-unknown',
      observedAt,
      { source: 'reconciliation', reanchorClockRollback: true },
    )
    const persisted = await this.journal.find(record.attemptId)
    if (!isExactJournalRecord(committed, expected) || !isExactJournalRecord(persisted, expected)) {
      throw new TransferCoordinatorError(
        'The transaction clock rollback re-anchor could not be read back and verified. Sending remains blocked.',
      )
    }
    return persisted
  }

  private checkedNow(): number {
    const value = this.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new TransferCoordinatorError('The transaction clock is invalid.')
    return value
  }
}

function normalizeHash(value: unknown): string {
  if (typeof value !== 'string') throw new TransferCoordinatorError('CryptoJ returned a missing transaction hash.')
  const normalized = value.toLowerCase()
  if (!canonicalHash.test(normalized)) throw new TransferCoordinatorError('CryptoJ returned an invalid transaction hash.')
  return normalized
}

function classifySubmissionResult(value: unknown): 'accepted' | 'rejected' | 'unknown' {
  const parsed = mempoolResultSchema.safeParse(value)
  if (!parsed.success) return 'unknown'
  if (parsed.data.status === 'SUCCESS' || parsed.data.status === 'QUEUED') return 'accepted'
  if (explicitRejectionStatuses.has(parsed.data.status)) return 'rejected'
  return 'unknown'
}

function isPendingObservation(value: unknown): boolean {
  const parsed = transactionStatusSchema.safeParse(value)
  return parsed.success && parsed.data.status === 'PENDING'
}

function isConfirmingObservation(value: unknown): boolean {
  const parsed = transactionStatusSchema.safeParse(value)
  return parsed.success && parsed.data.status === 'CONFIRMING'
}

function graceProtectedTerminalState(
  record: TransferJournalRecord,
  terminalState: 'absent-reusable' | 'consumed-superseded',
  observedAt: number,
  propagationGraceMs: number,
): ReconciliationTarget {
  if (observedAt < record.updatedAt) {
    const rollback = record.updatedAt - observedAt
    const minimumDurableAnchor = Math.max(record.createdAt, record.submissionStartedAt)
    // A rollback smaller than one complete grace window remains fail-closed and
    // keeps the newer durable anchor. A larger future anchor is re-based only to
    // a valid point within the record lifetime, and this observation cannot make
    // the nonce reusable or superseded.
    if (rollback >= propagationGraceMs && observedAt >= minimumDurableAnchor) {
      return 'clock-rollback-reanchor'
    }
    return record.state
  }
  if (record.state === 'dispatching' || observedAt - record.updatedAt < propagationGraceMs) {
    return record.state === 'dispatching' ? 'blocked-unknown' : record.state
  }
  return terminalState
}

function classifyTransactionStatus(
  value: unknown,
  record: TransferJournalRecord,
  observedAt: number,
  propagationGraceMs: number,
): ReconciliationTarget {
  const parsed = transactionStatusSchema.safeParse(value)
  if (!parsed.success || parsed.data.hash !== record.hash || parsed.data.sender !== record.sender ||
    parsed.data.nonce !== record.nonce) return 'blocked-unknown'

  const requiredConfirmations = BigInt(parsed.data.requiredConfirmations)
  if (requiredConfirmations === 0n) return 'blocked-unknown'
  const confirmations = parsed.data.confirmations === null ? null : BigInt(parsed.data.confirmations)

  switch (parsed.data.status) {
    case 'PENDING':
      return confirmations === null ? 'pending' : 'blocked-unknown'
    case 'CONFIRMING':
      return confirmations !== null && confirmations > 0n && confirmations < requiredConfirmations
        ? 'confirming'
        : 'blocked-unknown'
    case 'CONFIRMED':
      return confirmations !== null && confirmations >= requiredConfirmations
        ? 'confirmed'
        : 'blocked-unknown'
    case 'ABSENT_REUSABLE':
      if (confirmations !== null || parsed.data.nextNonce !== record.nonce) return 'blocked-unknown'
      return graceProtectedTerminalState(record, 'absent-reusable', observedAt, propagationGraceMs)
    case 'CONSUMED_SUPERSEDED':
      if (confirmations !== null || parsed.data.nextNonce === null ||
        BigInt(parsed.data.nextNonce) <= BigInt(record.nonce)) return 'blocked-unknown'
      return graceProtectedTerminalState(record, 'consumed-superseded', observedAt, propagationGraceMs)
    case 'BLOCKED_UNKNOWN':
      return 'blocked-unknown'
  }
}
