import { Preferences } from '@capacitor/preferences'
import z from 'zod/v4'
import { createUuid } from '../utils/UuidUtil'

const STORAGE_KEY = 'ge_transfer_journal:records'
const RECOVERY_KEY = 'ge_transfer_journal:recovery'
const EVENT_KEY = 'ge_transfer_journal:event'
const CHANNEL_NAME = 'goldenera-wallet-transfer-journal'
const MUTATION_LOCK_NAME = 'goldenera-wallet-transfer-journal-mutation'
const SOURCE_ID = typeof window !== 'undefined' ? createUuid(window.crypto) : 'server'
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const TERMINAL_RECORD_LIMIT = 32
const TOTAL_RECORD_LIMIT = 256
const MAX_RECOVERY_ISSUES = 32
const MAX_RECOVERY_ISSUE_COUNT = TOTAL_RECORD_LIMIT
const MAX_RECENT_EVENT_NONCES = 256
const RECENT_EVENT_NONCE_TTL_MS = 60_000
const MAX_UINT256 = (1n << 256n) - 1n

const canonicalDecimal = /^(0|[1-9][0-9]*)$/
const normalizedAddress = /^0x[0-9a-f]{40}$/
const canonicalHash = /^0x[0-9a-f]{64}$/
const walletIdentity = /^[A-Za-z0-9._:-]{1,200}$/

export const transferJournalStates = [
  'dispatching',
  'accepted',
  'rejected',
  'unknown',
  'pending',
  'confirming',
  'confirmed',
  'absent-reusable',
  'consumed-superseded',
  'blocked-unknown',
] as const

export type TransferJournalState = typeof transferJournalStates[number]

const transferJournalStateSchema = z.enum(transferJournalStates)
const decimalSchema = z.string()
  .max(78)
  .refine(value => canonicalDecimal.test(value) && BigInt(value) <= MAX_UINT256, 'invalid uint256 decimal')
const addressSchema = z.string().regex(normalizedAddress)
const hashSchema = z.string().regex(canonicalHash)

const transferJournalRecordSchema = z.object({
  version: z.literal(1),
  attemptId: z.string().uuid(),
  network: z.literal('MAINNET'),
  walletId: z.string().regex(walletIdentity),
  vaultRevision: z.number().int().nonnegative().safe(),
  sender: addressSchema,
  recipient: addressSchema,
  tokenAddress: addressSchema,
  hash: hashSchema,
  nonce: decimalSchema,
  amount: decimalSchema,
  fee: decimalSchema,
  signedSize: z.number().int().positive().max(1_048_576).safe(),
  state: transferJournalStateSchema,
  createdAt: z.number().int().nonnegative().safe(),
  updatedAt: z.number().int().nonnegative().safe(),
  submissionStartedAt: z.number().int().nonnegative().safe(),
}).strict().superRefine((record, context) => {
  if (record.updatedAt < record.createdAt) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt precedes createdAt' })
  }
  if (record.submissionStartedAt < record.createdAt || record.submissionStartedAt > record.updatedAt) {
    context.addIssue({ code: 'custom', path: ['submissionStartedAt'], message: 'submissionStartedAt is outside the record lifetime' })
  }
})

const newTransferAttemptSchema = z.object({
  attemptId: z.string().uuid(),
  network: z.literal('MAINNET'),
  walletId: z.string().regex(walletIdentity),
  vaultRevision: z.number().int().nonnegative().safe(),
  sender: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  nonce: decimalSchema,
  amount: decimalSchema,
  fee: decimalSchema,
  signedSize: z.number().int().positive().max(1_048_576).safe(),
  createdAt: z.number().int().nonnegative().safe(),
  submissionStartedAt: z.number().int().nonnegative().safe(),
}).strict().superRefine((record, context) => {
  if (record.submissionStartedAt < record.createdAt) {
    context.addIssue({ code: 'custom', path: ['submissionStartedAt'], message: 'submissionStartedAt precedes createdAt' })
  }
})

const transferJournalEnvelopeSchema = z.object({
  version: z.literal(1),
  records: z.array(transferJournalRecordSchema).max(TOTAL_RECORD_LIMIT),
}).strict()

const transferJournalEventSchema = z.object({
  version: z.literal(1),
  sourceId: z.string().min(1),
  attemptId: z.string().uuid().optional(),
  updatedAt: z.number().int().nonnegative().safe(),
  nonce: z.string().uuid(),
  kind: z.enum(['record', 'recovery']).optional(),
}).strict().superRefine((event, context) => {
  if ((event.kind ?? 'record') === 'record' && !event.attemptId) {
    context.addIssue({ code: 'custom', path: ['attemptId'], message: 'record events require an attempt id' })
  }
})

const recoveryIssueCategorySchema = z.enum([
  'malformed-envelope',
  'unsupported-envelope-version',
  'malformed-record',
  'unsupported-record-version',
  'duplicate-identical',
  'duplicate-conflict',
  'malformed-recovery-metadata',
])
const recoveryIssueSchema = z.object({
  category: recoveryIssueCategorySchema,
  count: z.number().int().positive().max(MAX_RECOVERY_ISSUE_COUNT).safe(),
  network: z.literal('MAINNET').optional(),
  sender: addressSchema.optional(),
}).strict().superRefine((issue, context) => {
  if ((issue.network === undefined) !== (issue.sender === undefined)) {
    context.addIssue({ code: 'custom', message: 'recovery lane identity is incomplete' })
  }
})
const recoveryMetadataSchema = z.object({
  version: z.literal(1),
  status: z.enum(['action-required', 'resolved', 'blocked']),
  issues: z.array(recoveryIssueSchema).min(1).max(MAX_RECOVERY_ISSUES),
  detectedAt: z.number().int().nonnegative().safe(),
  recoveredAt: z.number().int().nonnegative().safe().optional(),
}).strict().superRefine((metadata, context) => {
  if (metadata.status === 'action-required' && metadata.recoveredAt !== undefined) {
    context.addIssue({ code: 'custom', path: ['recoveredAt'], message: 'unacknowledged recovery cannot have a recovery time' })
  }
  if (metadata.status !== 'action-required' && metadata.recoveredAt === undefined) {
    context.addIssue({ code: 'custom', path: ['recoveredAt'], message: 'recovery outcome requires a recovery time' })
  }
})

export type TransferJournalRecord = Readonly<z.infer<typeof transferJournalRecordSchema>>
export type NewTransferAttempt = Readonly<z.input<typeof newTransferAttemptSchema>>
export type TransferJournalEvent = z.infer<typeof transferJournalEventSchema>
export type TransferJournalRecoveryIssue = Readonly<z.infer<typeof recoveryIssueSchema>>
export type TransferJournalRecoveryStatus = 'clear' | z.infer<typeof recoveryMetadataSchema>['status']
export interface TransferJournalRecoveryState {
  status: TransferJournalRecoveryStatus
  issues: readonly TransferJournalRecoveryIssue[]
  detectedAt: number | null
  recoveredAt: number | null
  globalBlocked: boolean
  blockedSenders: readonly string[]
}
export type TransferJournalTransitionSource = 'local' | 'reconciliation'

export interface TransferJournalTransitionOptions {
  source?: TransferJournalTransitionSource
  /** Re-anchors a nonterminal record after a durable clock rollback. */
  reanchorClockRollback?: boolean
}

export class TransferJournalError extends Error {}
/** Retained for callers which need a typed failure for an old fail-closed journal. */
export class TransferJournalCorruptError extends TransferJournalError {}
export class TransferJournalPersistenceError extends TransferJournalError {}
export class TransferJournalTransitionError extends TransferJournalError {}
export class TransferJournalRecoveryRequiredError extends TransferJournalError {
  constructor() {
    super('Transaction state is unreadable. Acknowledge transaction recovery before sending or reconciling.')
  }
}
export class TransferJournalRecoveryBlockedError extends TransferJournalError {
  constructor() {
    super('Transaction state remains ambiguous for this sender. Sending is blocked and no nonce is treated as reusable.')
  }
}

const terminalStates = new Set<TransferJournalState>([
  'rejected',
  'confirmed',
  'absent-reusable',
  'consumed-superseded',
])
const highWaterStates = new Set<TransferJournalState>([
  'accepted',
  'pending',
  'confirming',
  'confirmed',
  'consumed-superseded',
])
const blockingStates = new Set<TransferJournalState>(['dispatching', 'unknown', 'blocked-unknown'])
const reusableNonceStates = new Set<TransferJournalState>(['rejected', 'absent-reusable'])

const observedStates = [
  'pending',
  'confirming',
  'confirmed',
  'absent-reusable',
  'consumed-superseded',
  'blocked-unknown',
] as const satisfies readonly TransferJournalState[]

const allowedTransitions: Record<TransferJournalState, ReadonlySet<TransferJournalState>> = {
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

let mutationQueue: Promise<unknown> = Promise.resolve()

/** Browser journal mutations require Web Locks; tests and SSR use an in-process queue. */
export function withTransferJournalMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(MUTATION_LOCK_NAME, operation)
  }
  if (typeof document !== 'undefined') {
    return Promise.reject(new TransferJournalPersistenceError(
      'This browser cannot safely coordinate outgoing transactions across tabs. Update your browser and retry.',
    ))
  }
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.catch(() => undefined)
  return result
}

type RecoveryIssueCategory = z.infer<typeof recoveryIssueCategorySchema>
type RecoveryMetadata = z.infer<typeof recoveryMetadataSchema>
interface Inspection {
  usableRecords: TransferJournalRecord[]
  canonicalRecords: TransferJournalRecord[]
  issues: TransferJournalRecoveryIssue[]
}
interface LoadedJournal extends Inspection {
  recovery: TransferJournalRecoveryState
  metadata: RecoveryMetadata | null
}

function safeLaneIdentity(value: unknown): Pick<TransferJournalRecoveryIssue, 'network' | 'sender'> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.network !== 'MAINNET' || typeof candidate.sender !== 'string') return null
  const sender = candidate.sender.toLowerCase()
  return normalizedAddress.test(sender) ? { network: 'MAINNET', sender } : null
}

function issue(
  category: RecoveryIssueCategory,
  count: number,
  lane: Pick<TransferJournalRecoveryIssue, 'network' | 'sender'> | null = null,
): TransferJournalRecoveryIssue {
  return lane
    ? { category, count: Math.min(count, MAX_RECOVERY_ISSUE_COUNT), ...lane }
    : { category, count: Math.min(count, MAX_RECOVERY_ISSUE_COUNT) }
}

function issueKey(value: TransferJournalRecoveryIssue): string {
  return `${value.category}|${value.network ?? ''}|${value.sender ?? ''}`
}

function boundedIssues(values: readonly TransferJournalRecoveryIssue[]): TransferJournalRecoveryIssue[] {
  const grouped = new Map<string, TransferJournalRecoveryIssue>()
  for (const value of values) {
    const key = issueKey(value)
    const existing = grouped.get(key)
    grouped.set(key, existing
      ? { ...existing, count: Math.min(MAX_RECOVERY_ISSUE_COUNT, existing.count + value.count) }
      : { ...value })
  }
  const sorted = [...grouped.values()].sort((left, right) => issueKey(left).localeCompare(issueKey(right)))
  if (sorted.length <= MAX_RECOVERY_ISSUES) return sorted
  const retained = sorted.slice(0, MAX_RECOVERY_ISSUES - 1)
  const overflowCount = sorted.slice(MAX_RECOVERY_ISSUES - 1)
    .reduce((count, current) => Math.min(MAX_RECOVERY_ISSUE_COUNT, count + current.count), 0)
  return [...retained, issue('malformed-envelope', overflowCount)]
}

function sameRecord(left: TransferJournalRecord, right: TransferJournalRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function inspectEnvelope(raw: string | null): Inspection {
  if (raw === null) return { usableRecords: [], canonicalRecords: [], issues: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      usableRecords: [],
      canonicalRecords: [],
      issues: [issue('malformed-envelope', 1)],
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { usableRecords: [], canonicalRecords: [], issues: [issue('malformed-envelope', 1)] }
  }
  const envelope = parsed as Record<string, unknown>
  if (envelope.version !== 1) {
    const category: RecoveryIssueCategory = typeof envelope.version === 'number' && envelope.version > 1
      ? 'unsupported-envelope-version'
      : 'malformed-envelope'
    return { usableRecords: [], canonicalRecords: [], issues: [issue(category, 1)] }
  }
  if (Object.keys(envelope).length !== 2 || !Object.hasOwn(envelope, 'records') || !Array.isArray(envelope.records) ||
    envelope.records.length > TOTAL_RECORD_LIMIT) {
    return { usableRecords: [], canonicalRecords: [], issues: [issue('malformed-envelope', 1)] }
  }

  const valid: TransferJournalRecord[] = []
  const issues: TransferJournalRecoveryIssue[] = []
  for (const value of envelope.records) {
    const parsedRecord = transferJournalRecordSchema.safeParse(value)
    if (parsedRecord.success) {
      valid.push(parsedRecord.data)
      continue
    }
    const lane = safeLaneIdentity(value)
    const version = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).version
      : undefined
    issues.push(issue(typeof version === 'number' && version > 1
      ? 'unsupported-record-version'
      : 'malformed-record', 1, lane))
  }

  const conflicted = new Set<TransferJournalRecord>()
  const duplicateGroups = [
    new Map<string, TransferJournalRecord[]>(),
    new Map<string, TransferJournalRecord[]>(),
  ]
  for (const record of valid) {
    for (const [index, key] of [[0, record.attemptId], [1, record.hash]] as const) {
      const group = duplicateGroups[index].get(key) ?? []
      group.push(record)
      duplicateGroups[index].set(key, group)
    }
  }
  const seenDuplicateGroups = new Set<string>()
  for (const groupMap of duplicateGroups) {
    for (const group of groupMap.values()) {
      if (group.length < 2) continue
      const signature = group.map(record => JSON.stringify(record)).sort().join(String.fromCharCode(0))
      if (seenDuplicateGroups.has(signature)) continue
      seenDuplicateGroups.add(signature)
      const identical = group.every(record => sameRecord(record, group[0]!))
      const sameLane = group.every(record => record.network === group[0]!.network && record.sender === group[0]!.sender)
      const lane = sameLane ? { network: group[0]!.network, sender: group[0]!.sender } : null
      issues.push(issue(identical ? 'duplicate-identical' : 'duplicate-conflict', group.length - 1, lane))
      if (!identical) group.forEach(record => conflicted.add(record))
    }
  }

  const canonicalRecords: TransferJournalRecord[] = []
  const seenExact = new Set<string>()
  for (const record of valid) {
    if (conflicted.has(record)) continue
    const exact = JSON.stringify(record)
    if (seenExact.has(exact)) continue
    seenExact.add(exact)
    canonicalRecords.push(record)
  }
  const usableRecords = canonicalRecords.filter(record => !conflicted.has(record))
  return {
    usableRecords,
    canonicalRecords,
    issues: boundedIssues(issues),
  }
}

function parseRecoveryMetadata(raw: string | null): { metadata: RecoveryMetadata | null, malformed: boolean } {
  if (raw === null) return { metadata: null, malformed: false }
  try {
    const parsed = recoveryMetadataSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { metadata: parsed.data, malformed: false } : { metadata: null, malformed: true }
  } catch {
    return { metadata: null, malformed: true }
  }
}

async function readStoredValues(): Promise<{ records: string | null, recovery: string | null }> {
  try {
    const [records, recovery] = await Promise.all([
      Preferences.get({ key: STORAGE_KEY }),
      Preferences.get({ key: RECOVERY_KEY }),
    ])
    return { records: records.value, recovery: recovery.value }
  } catch (error) {
    throw new TransferJournalPersistenceError('The transaction journal could not be read. Sending is blocked.', { cause: error })
  }
}

function publicRecoveryState(metadata: RecoveryMetadata | null): TransferJournalRecoveryState {
  if (!metadata) {
    return Object.freeze({
      status: 'clear', issues: Object.freeze([]), detectedAt: null, recoveredAt: null,
      globalBlocked: false, blockedSenders: Object.freeze([]),
    })
  }
  const unresolved = metadata.status === 'action-required' || metadata.status === 'blocked'
  const globalBlocked = unresolved && metadata.issues.some(item => item.sender === undefined)
  const blockedSenders = unresolved
    ? [...new Set(metadata.issues.flatMap(item => item.sender === undefined ? [] : [item.sender]))].sort()
    : []
  return Object.freeze({
    status: metadata.status,
    issues: Object.freeze(metadata.issues.map(item => Object.freeze({ ...item }))),
    detectedAt: metadata.detectedAt,
    recoveredAt: metadata.recoveredAt ?? null,
    globalBlocked,
    blockedSenders: Object.freeze(blockedSenders),
  })
}

function sameMetadata(left: RecoveryMetadata | null, right: RecoveryMetadata | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function writeRecoveryMetadata(metadata: RecoveryMetadata): Promise<void> {
  const serialized = JSON.stringify(recoveryMetadataSchema.parse(metadata))
  try {
    await Preferences.set({ key: RECOVERY_KEY, value: serialized })
    const readBack = (await Preferences.get({ key: RECOVERY_KEY })).value
    if (readBack !== serialized) throw new Error('read-back mismatch')
  } catch (error) {
    throw new TransferJournalPersistenceError('The transaction recovery state could not be verified. Sending is blocked.', { cause: error })
  }
}

function pendingMetadata(
  existing: RecoveryMetadata | null,
  issues: readonly TransferJournalRecoveryIssue[],
): RecoveryMetadata {
  const merged = new Map<string, TransferJournalRecoveryIssue>()
  for (const candidate of [...(existing?.issues ?? []), ...issues]) {
    const key = issueKey(candidate)
    const previous = merged.get(key)
    // Re-reading the same corrupt value must not create a growing recovery record.
    merged.set(key, previous
      ? { ...previous, count: Math.max(previous.count, candidate.count) }
      : { ...candidate })
  }
  const now = Date.now()
  return recoveryMetadataSchema.parse({
    version: 1,
    status: 'action-required',
    issues: boundedIssues([...merged.values()]),
    detectedAt: existing?.detectedAt ?? now,
  })
}

async function loadJournalUnlocked(): Promise<LoadedJournal> {
  const stored = await readStoredValues()
  const inspection = inspectEnvelope(stored.records)
  const parsedRecovery = parseRecoveryMetadata(stored.recovery)
  const detectedIssues = parsedRecovery.malformed
    ? [...inspection.issues, issue('malformed-recovery-metadata', 1)]
    : inspection.issues
  let metadata = parsedRecovery.metadata
  if (detectedIssues.length > 0) {
    const next = pendingMetadata(metadata, detectedIssues)
    const changed = !sameMetadata(metadata, next) || parsedRecovery.malformed
    if (changed) {
      await writeRecoveryMetadata(next)
      // Hints contain no journal entry or malformed payload; persisted state is authoritative.
      publishRecoveryEvent(next.detectedAt)
    }
    metadata = next
  }
  return { ...inspection, recovery: publicRecoveryState(metadata), metadata }
}

function assertNoUnacknowledgedRecovery(recovery: TransferJournalRecoveryState): void {
  if (recovery.status === 'action-required') throw new TransferJournalRecoveryRequiredError()
}

function assertSenderMaySend(recovery: TransferJournalRecoveryState, sender: string): void {
  assertNoUnacknowledgedRecovery(recovery)
  if (recovery.status === 'blocked' && (recovery.globalBlocked || recovery.blockedSenders.includes(sender))) {
    throw new TransferJournalRecoveryBlockedError()
  }
}

function pruneRecords(records: TransferJournalRecord[], now: number): TransferJournalRecord[] {
  const unresolved = records.filter(record => !terminalStates.has(record.state))
  if (unresolved.length > TOTAL_RECORD_LIMIT) {
    throw new TransferJournalPersistenceError('Too many unresolved transaction attempts exist. Reconcile them before sending again.')
  }
  const availableTerminalSlots = Math.min(TERMINAL_RECORD_LIMIT, TOTAL_RECORD_LIMIT - unresolved.length)
  const terminal = records
    .filter(record => terminalStates.has(record.state) && record.updatedAt >= now - TERMINAL_RETENTION_MS)
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
    .slice(0, availableTerminalSlots)
  return [...unresolved, ...terminal]
    .sort((left, right) => left.createdAt - right.createdAt || left.attemptId.localeCompare(right.attemptId))
}

async function writeRecords(records: TransferJournalRecord[]): Promise<void> {
  let serialized: string
  try {
    serialized = JSON.stringify(transferJournalEnvelopeSchema.parse({ version: 1, records }))
  } catch (error) {
    throw new TransferJournalPersistenceError('The transaction journal update is invalid.', { cause: error })
  }
  try {
    await Preferences.set({ key: STORAGE_KEY, value: serialized })
    const readBack = (await Preferences.get({ key: STORAGE_KEY })).value
    if (readBack !== serialized) throw new Error('read-back mismatch')
  } catch (error) {
    throw new TransferJournalPersistenceError('The transaction journal update could not be verified. No transaction may be sent.', { cause: error })
  }
}

function publishEvent(record: TransferJournalRecord): void {
  publishJournalEvent({ attemptId: record.attemptId, updatedAt: record.updatedAt, kind: 'record' })
}

function publishRecoveryEvent(updatedAt: number): void {
  publishJournalEvent({ updatedAt, kind: 'recovery' })
}

function publishJournalEvent(eventInput: Pick<TransferJournalEvent, 'attemptId' | 'updatedAt' | 'kind'>): void {
  if (typeof window === 'undefined') return
  let event: TransferJournalEvent
  try {
    event = transferJournalEventSchema.parse({
      version: 1,
      sourceId: SOURCE_ID,
      ...eventInput,
      nonce: createUuid(window.crypto),
    })
  } catch { return /* Persisted journal state remains authoritative. */ }
  try {
    if ('BroadcastChannel' in window) {
      const channel = new window.BroadcastChannel(CHANNEL_NAME)
      channel.postMessage(event)
      channel.close()
    }
  } catch { /* Persisted journal state remains authoritative. */ }
  try {
    if ('localStorage' in window) window.localStorage.setItem(EVENT_KEY, JSON.stringify(event))
  } catch { /* Other tabs reconcile on their next operation. */ }
}

function sameAttemptMetadata(existing: TransferJournalRecord, dispatching: TransferJournalRecord): boolean {
  return sameRecord(existing, {
    ...dispatching,
    state: existing.state,
    updatedAt: existing.updatedAt,
  })
}

function normalizeNewAttempt(input: NewTransferAttempt): TransferJournalRecord {
  const parsed = newTransferAttemptSchema.parse(input)
  return transferJournalRecordSchema.parse({
    version: 1,
    ...parsed,
    sender: parsed.sender.toLowerCase(),
    recipient: parsed.recipient.toLowerCase(),
    tokenAddress: parsed.tokenAddress.toLowerCase(),
    hash: parsed.hash.toLowerCase(),
    state: 'dispatching',
    updatedAt: parsed.submissionStartedAt,
  })
}

function normalizedSender(sender: string): string {
  const value = sender.toLowerCase()
  if (!normalizedAddress.test(value)) throw new TransferJournalError('Invalid transaction sender address.')
  return value
}

function assertDispatchLaneAvailable(
  records: readonly TransferJournalRecord[],
  candidate: TransferJournalRecord,
): void {
  const laneRecords = records.filter(record =>
    record.network === candidate.network && record.sender === candidate.sender)
  if (laneRecords.some(record => blockingStates.has(record.state))) {
    throw new TransferJournalPersistenceError(
      'This sender has an unresolved transaction attempt. Reconcile it before sending again.',
    )
  }

  const sameNonceRecords = laneRecords.filter(record => record.nonce === candidate.nonce)
  if (sameNonceRecords.some(record => !reusableNonceStates.has(record.state))) {
    throw new TransferJournalPersistenceError(
      'The transaction nonce is already bound to an attempt that is not safely reusable.',
    )
  }
  const reusesExactReusableNonce = sameNonceRecords.length > 0 &&
    sameNonceRecords.every(record => reusableNonceStates.has(record.state))

  const candidateNonce = BigInt(candidate.nonce)
  let highWater: bigint | null = null
  for (const record of laneRecords) {
    if (!highWaterStates.has(record.state)) continue
    const nonce = BigInt(record.nonce)
    if (highWater === null || nonce > highWater) highWater = nonce
  }
  if (highWater !== null && candidateNonce <= highWater && !reusesExactReusableNonce) {
    throw new TransferJournalPersistenceError(
      'The transaction nonce neither advances the accepted high-water mark nor reuses an exact safe gap.',
    )
  }
}

function hasAmbiguousIssue(value: TransferJournalRecoveryIssue): boolean {
  return value.category !== 'duplicate-identical'
}

export const TransferJournalService = {
  async read(): Promise<TransferJournalRecord[]> {
    return withTransferJournalMutation(async () => (await loadJournalUnlocked()).usableRecords)
  },

  async getRecoveryState(): Promise<TransferJournalRecoveryState> {
    return withTransferJournalMutation(async () => (await loadJournalUnlocked()).recovery)
  },

  /**
   * This is the user's explicit decision to replace unreadable entries with a
   * public-only marker. It never asserts that a blocked nonce is reusable.
   */
  async recover(): Promise<TransferJournalRecoveryState> {
    let recovered!: TransferJournalRecoveryState
    await withTransferJournalMutation(async () => {
      const loaded = await loadJournalUnlocked()
      if (loaded.recovery.status !== 'action-required') {
        recovered = loaded.recovery
        return
      }
      const now = Date.now()
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new TransferJournalPersistenceError('The transaction recovery clock is invalid.')
      }
      // This write intentionally occurs only after the explicit recovery action.
      await writeRecords(loaded.canonicalRecords)
      const metadata = recoveryMetadataSchema.parse({
        version: 1,
        status: loaded.issues.some(hasAmbiguousIssue) ? 'blocked' : 'resolved',
        issues: loaded.metadata?.issues ?? loaded.issues,
        detectedAt: loaded.metadata?.detectedAt ?? now,
        recoveredAt: now,
      })
      await writeRecoveryMetadata(metadata)
      recovered = publicRecoveryState(metadata)
      publishRecoveryEvent(now)
    })
    return recovered
  },

  async createDispatching(input: NewTransferAttempt): Promise<TransferJournalRecord> {
    let committed!: TransferJournalRecord
    await withTransferJournalMutation(async () => {
      const record = normalizeNewAttempt(input)
      const loaded = await loadJournalUnlocked()
      assertSenderMaySend(loaded.recovery, record.sender)
      const records = loaded.usableRecords
      const existing = records.find(item => item.attemptId === record.attemptId)
      if (existing) {
        if (!sameAttemptMetadata(existing, record)) throw new TransferJournalPersistenceError('The transaction attempt identifier is already bound to different metadata.')
        committed = existing
        return
      }
      if (records.some(item => item.hash === record.hash)) {
        throw new TransferJournalPersistenceError('This transaction hash is already journaled.')
      }
      assertDispatchLaneAvailable(records, record)
      const next = pruneRecords([...records, record], record.updatedAt)
      await writeRecords(next)
      committed = record
      publishEvent(record)
    })
    return committed
  },

  async transition(
    attemptId: string,
    state: TransferJournalState,
    updatedAt = Date.now(),
    options: TransferJournalTransitionOptions = {},
  ): Promise<TransferJournalRecord> {
    const validAttemptId = z.string().uuid().parse(attemptId)
    const validState = transferJournalStateSchema.parse(state)
    const source = options.source ?? 'local'
    if (source !== 'local' && source !== 'reconciliation') {
      throw new TransferJournalTransitionError('The transaction journal transition source is invalid.')
    }
    if (options.reanchorClockRollback !== undefined && typeof options.reanchorClockRollback !== 'boolean') {
      throw new TransferJournalTransitionError('The transaction clock re-anchor option is invalid.')
    }
    const reanchorClockRollback = options.reanchorClockRollback === true
    if (reanchorClockRollback && source !== 'reconciliation') {
      throw new TransferJournalTransitionError('Only reconciliation may re-anchor a transaction clock rollback.')
    }
    const shouldPublish = source === 'local'
    let committed!: TransferJournalRecord
    await withTransferJournalMutation(async () => {
      const loaded = await loadJournalUnlocked()
      assertNoUnacknowledgedRecovery(loaded.recovery)
      const records = loaded.usableRecords
      const index = records.findIndex(record => record.attemptId === validAttemptId)
      if (index < 0) throw new TransferJournalTransitionError('The transaction attempt is not present in the journal.')
      const current = records[index]!
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
        throw new TransferJournalTransitionError('The transaction journal transition timestamp is invalid.')
      }
      if (reanchorClockRollback) {
        const minimumAnchor = Math.max(current.createdAt, current.submissionStartedAt)
        const mayEnterBlockingState = current.state === validState || allowedTransitions[current.state].has(validState)
        if (terminalStates.has(current.state)
          || validState !== 'blocked-unknown'
          || !mayEnterBlockingState
          || updatedAt < minimumAnchor
          || updatedAt >= current.updatedAt) {
          throw new TransferJournalTransitionError('The transaction clock rollback re-anchor is invalid.')
        }
        const nextRecord = transferJournalRecordSchema.parse({
          ...current,
          state: 'blocked-unknown',
          updatedAt,
        })
        records[index] = nextRecord
        const next = pruneRecords(records, updatedAt)
        await writeRecords(next)
        committed = nextRecord
        return
      }
      if (current.state === validState) {
        const refreshesObservationAnchor = (validState === 'pending' || validState === 'confirming') &&
          updatedAt > current.updatedAt
        if (!refreshesObservationAnchor) {
          committed = current
          return
        }
        const nextRecord = transferJournalRecordSchema.parse({ ...current, updatedAt })
        records[index] = nextRecord
        const next = pruneRecords(records, updatedAt)
        await writeRecords(next)
        committed = nextRecord
        if (shouldPublish) publishEvent(nextRecord)
        return
      }
      if (updatedAt < current.updatedAt) {
        throw new TransferJournalTransitionError('The transaction journal transition timestamp is invalid.')
      }
      if (!allowedTransitions[current.state].has(validState)) {
        throw new TransferJournalTransitionError(`Transaction state cannot move from ${current.state} to ${validState}.`)
      }
      const nextRecord = transferJournalRecordSchema.parse({ ...current, state: validState, updatedAt })
      records[index] = nextRecord
      const next = pruneRecords(records, updatedAt)
      await writeRecords(next)
      committed = nextRecord
      if (shouldPublish) publishEvent(nextRecord)
    })
    return committed
  },

  async find(attemptId: string): Promise<TransferJournalRecord | null> {
    const validAttemptId = z.string().uuid().parse(attemptId)
    return (await this.read()).find(record => record.attemptId === validAttemptId) ?? null
  },

  async listForSender(network: 'MAINNET', sender: string): Promise<TransferJournalRecord[]> {
    const value = normalizedSender(sender)
    return (await this.read()).filter(record => record.network === network && record.sender === value)
  },

  async listBlocking(network: 'MAINNET', sender: string): Promise<TransferJournalRecord[]> {
    return (await this.listForSender(network, sender)).filter(record => blockingStates.has(record.state))
  },

  async acceptedNonceHighWater(network: 'MAINNET', sender: string): Promise<bigint | null> {
    let highWater: bigint | null = null
    for (const record of await this.listForSender(network, sender)) {
      if (!highWaterStates.has(record.state)) continue
      const nonce = BigInt(record.nonce)
      if (highWater === null || nonce > highWater) highWater = nonce
    }
    return highWater
  },

  async prune(now = Date.now()): Promise<void> {
    if (!Number.isSafeInteger(now) || now < 0) throw new TransferJournalPersistenceError('Invalid transaction journal retention timestamp.')
    await withTransferJournalMutation(async () => {
      const loaded = await loadJournalUnlocked()
      assertNoUnacknowledgedRecovery(loaded.recovery)
      const next = pruneRecords(loaded.usableRecords, now)
      if (sameRecordArray(loaded.usableRecords, next)) return
      await writeRecords(next)
    })
  },
}

function sameRecordArray(left: TransferJournalRecord[], right: TransferJournalRecord[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function subscribeTransferJournal(listener: (event: TransferJournalEvent) => void): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return () => undefined
  let disposed = false
  const recentNonces = new Map<string, number>()
  const isDuplicate = (nonce: string): boolean => {
    const currentTime = Date.now()
    for (const [recentNonce, seenAt] of recentNonces) {
      if (currentTime >= seenAt && currentTime - seenAt > RECENT_EVENT_NONCE_TTL_MS) {
        recentNonces.delete(recentNonce)
      }
    }
    if (recentNonces.has(nonce)) return true
    recentNonces.set(nonce, currentTime)
    while (recentNonces.size > MAX_RECENT_EVENT_NONCES) {
      const oldestNonce = recentNonces.keys().next().value
      if (oldestNonce === undefined) break
      recentNonces.delete(oldestNonce)
    }
    return false
  }
  const accept = (value: unknown) => {
    if (disposed) return
    const parsed = transferJournalEventSchema.safeParse(value)
    if (!parsed.success || parsed.data.sourceId === SOURCE_ID || isDuplicate(parsed.data.nonce)) return
    listener(parsed.data)
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== EVENT_KEY || !event.newValue) return
    try { accept(JSON.parse(event.newValue)) } catch { /* Ignore malformed notification hints. */ }
  }
  window.addEventListener('storage', onStorage)
  let channel: BroadcastChannel | undefined
  if ('BroadcastChannel' in window) {
    try {
      channel = new window.BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = event => accept(event.data)
    } catch { /* Storage events remain available. */ }
  }
  return () => {
    disposed = true
    recentNonces.clear()
    window.removeEventListener('storage', onStorage)
    channel?.close()
  }
}
