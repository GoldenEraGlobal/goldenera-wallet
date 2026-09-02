import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { BiometricUtil, type BiometricType } from '../utils/BiometricUtil'
import { bufferToHex, hexToBuffer } from '../utils/CryptoUtil'
import { WalletUtil } from '../utils/WalletUtil'
import { publishBiometricGeneration } from './BiometricSessionService'
import { StorageService } from './StorageService'
import { assertWalletMutationScope, isWalletVaultCorruptionError, WalletVaultService, withWalletMutation, type WalletMutationScope, type WalletVaultRecord } from './WalletVaultService'

const KEYS = {
  ENABLED: 'biometric_enabled',
  CREDENTIAL_ID: 'biometric_credential_id',
  ENCRYPTED_PASSWORD: 'biometric_encrypted_password',
  PRF: 'biometric_prf_v2',
  GENERATION: 'biometric_generation_v1',
  MIGRATION: 'biometric_migration_v1',
}
const SERVER_ID = 'wallet.goldenera.global'
const SCHEME = 'webauthn-prf-hkdf-sha256-aes256gcm'
const WEBAUTHN_USER_NAME = 'GoldenEra Wallet'
const WEBAUTHN_USER_DISPLAY_NAME = 'GoldenEra Wallet'

export type BiometricErrorCode =
  | 'BIOMETRIC_UNSUPPORTED'
  | 'BIOMETRIC_CANCELLED'
  | 'BIOMETRIC_SUPERSEDED'
  | 'BIOMETRIC_GENERATION_CHANGED'
  | 'BIOMETRIC_GENERATION_MALFORMED'
  | 'BIOMETRIC_WRONG_CREDENTIAL'
  | 'BIOMETRIC_MALFORMED_STATE'
  | 'BIOMETRIC_CLEANUP_PENDING'
  | 'BIOMETRIC_POST_PASSWORD_COMMIT'

export class BiometricMigrationError extends Error {
  readonly code: BiometricErrorCode

  constructor(code: BiometricErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BiometricMigrationError'
    this.code = code
  }
}

export interface BiometricContext {
  vaultId: string
  vaultRevision: number
  biometricGeneration?: number
  signal?: AbortSignal
  isCurrent?: () => boolean
  isBiometricCurrent?: () => boolean
}
export interface BiometricEnrollmentResult {
  verified: boolean
  legacyCleanupComplete: boolean
  /** In-memory proof authorizing cleanup retries without another WebAuthn ceremony. */
  cleanupProof?: string
}
export type BiometricAuthenticationResult =
  | { success: false }
  | { success: true; password: string; proof: string }
export interface BiometricGenerationRepairResult {
  password: string
  mnemonic: string
  generation: number
}
interface PrfEnvelope {
  version: 2
  scheme: typeof SCHEME
  walletId: string
  vaultRevision: number
  rpId: string
  credentialId: string
  prfInput: string
  salt: string
  iv: string
  data: string
  /** Base64url-encoded opaque WebAuthn user handle, available for new enrollments. */
  userId?: string
}
export type BiometricPrfState = 'absent' | 'matching' | 'foreign' | 'malformed' | 'disabled'
export type LegacyBiometricState = 'absent' | 'complete' | 'partial'
export type BiometricJournalState = 'absent' | 'matching' | 'foreign' | 'malformed'
export type BiometricGenerationState = 'absent' | 'matching' | 'foreign' | 'malformed'
export type BiometricCleanupIntent = 'enroll' | 'password-only' | 'blocked' | null
export type BiometricMigrationPhase = 'legacy-cleanup-required' | 'prf-committed-cleanup' | 'legacy-recovery-prepared' | 'password-committed-enrollment' | 'password-only-retirement' | 'disable-biometric' | 'malformed-generation-repair'
export interface BiometricMigrationJournal {
  version: 1
  walletId: string
  vaultRevision: number
  phase: BiometricMigrationPhase
  updatedAt: number
}
export interface BiometricInspection {
  prfState: BiometricPrfState
  envelope: PrfEnvelope | null
  legacyState: LegacyBiometricState
  sensitiveLegacy: boolean
  enabledMarker: boolean
  journal: BiometricMigrationJournal | null
  journalState: BiometricJournalState
  generation: number | null
  generationState: BiometricGenerationState
  cleanupIntent: BiometricCleanupIntent
  cleanupPending: boolean
  /** Credential-ID legacy recovery is unsafe until this state is retired. */
  legacyRecoveryBlocked: boolean
}
interface GenerationRecord { version: 1; walletId: string; generation: number }
type PrfOutputs = AuthenticationExtensionsClientOutputs & { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }
type CredentialSignalApi = typeof PublicKeyCredential & {
  signalCurrentUserDetails?: (options: { rpId: string; userId: string; name: string; displayName: string }) => Promise<void>
}

const random = (length: number) => window.crypto.getRandomValues(new Uint8Array(length))
const hex = (value: unknown, bytes?: number): value is string => typeof value === 'string' && /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 && (bytes === undefined || value.length === bytes * 2)
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const isBase64url = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value)
const webauthnUserId = async (vaultId: string) => new Uint8Array(await window.crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(`goldenera-wallet/webauthn-user/v1:${vaultId}`),
))
// userId is intentionally excluded: existing PRF envelopes must keep the exact
// authenticated-data contract used before credential-label metadata existed.
const aad = (value: PrfEnvelope) => new TextEncoder().encode(JSON.stringify([value.version, value.scheme, value.walletId, value.vaultRevision, value.rpId, value.credentialId, value.prfInput, value.salt]))
const authenticationProof = (value: PrfEnvelope) => JSON.stringify([
  value.version, value.scheme, value.walletId, value.vaultRevision, value.rpId,
  value.credentialId, value.prfInput, value.salt, value.iv, value.data, value.userId ?? null,
])

/**
 * AES-GCM authenticates the legacy AAD contract, which intentionally excluded
 * userId. Persisted wrappers therefore need an exact structural readback too.
 */
function exactEnvelopeEqual(expected: PrfEnvelope, raw: unknown): raw is PrfEnvelope {
  const actual = parseEnvelope(raw)
  if (!actual || !raw || typeof raw !== 'object') return false
  const expectedKeys = ['version', 'scheme', 'walletId', 'vaultRevision', 'rpId', 'credentialId', 'prfInput', 'salt', 'iv', 'data']
  if (Object.prototype.hasOwnProperty.call(expected, 'userId')) expectedKeys.push('userId')
  const actualKeys = Object.keys(raw as Record<string, unknown>).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys.sort()[index])) return false
  return actual.version === expected.version
    && actual.scheme === expected.scheme
    && actual.walletId === expected.walletId
    && actual.vaultRevision === expected.vaultRevision
    && actual.rpId === expected.rpId
    && actual.credentialId === expected.credentialId
    && actual.prfInput === expected.prfInput
    && actual.salt === expected.salt
    && actual.iv === expected.iv
    && actual.data === expected.data
    && actual.userId === expected.userId
}
const matches = (envelope: PrfEnvelope, context: BiometricContext) => envelope.walletId === context.vaultId && envelope.vaultRevision === context.vaultRevision && envelope.rpId === window.location.hostname

function biometricError(code: BiometricErrorCode, message: string, cause?: unknown): BiometricMigrationError {
  return new BiometricMigrationError(code, message, cause === undefined ? undefined : { cause })
}

function normalizeCredentialError(error: unknown, context?: BiometricContext): Error {
  if (error instanceof BiometricMigrationError) return error
  if (context?.signal?.aborted || context?.isCurrent?.() === false || context?.isBiometricCurrent?.() === false) {
    try { assertCurrent(context) } catch (superseded) { return superseded as Error }
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return biometricError('BIOMETRIC_CANCELLED', 'Biometric verification was cancelled or timed out.', error)
  }
  return error instanceof Error ? error : new Error('Biometric operation failed')
}

function assertCurrent(context: BiometricContext) {
  if (context.signal?.aborted || context.isCurrent?.() === false) throw biometricError('BIOMETRIC_SUPERSEDED', 'Wallet session changed. Retry authentication.')
  if (context.isBiometricCurrent?.() === false) throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric settings changed in another tab. Retry authentication.')
}

async function assertGeneration(context: BiometricContext): Promise<void> {
  assertCurrent(context)
  const persisted = await currentGeneration(context.vaultId)
  assertCurrent(context)
  if (context.biometricGeneration !== undefined && persisted !== context.biometricGeneration) {
    throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric settings changed in another tab. Retry authentication.')
  }
}

function isDisabledTombstone(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2
    && record.version === 0
    && record.state === 'disabled'
}

function parseEnvelope(value: unknown): PrfEnvelope | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<PrfEnvelope>
  if (record.version !== 2 || record.scheme !== SCHEME || typeof record.walletId !== 'string' || record.walletId.trim().length === 0
    || typeof record.rpId !== 'string' || record.rpId.trim().length === 0 || !Number.isSafeInteger(record.vaultRevision) || Number(record.vaultRevision) < 0
    || !hex(record.credentialId) || !hex(record.prfInput, 32) || !hex(record.salt, 32)
    || !hex(record.iv, 12) || !hex(record.data)) return null
  if (record.userId !== undefined && !isBase64url(record.userId)) return null
  return record as PrfEnvelope
}

function parseJournal(value: unknown): BiometricMigrationJournal | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<BiometricMigrationJournal>
  if (record.version !== 1 || typeof record.walletId !== 'string' || record.walletId.trim().length === 0
    || !Number.isSafeInteger(record.vaultRevision) || Number(record.vaultRevision) < 0
    || !['legacy-cleanup-required', 'prf-committed-cleanup', 'legacy-recovery-prepared', 'password-committed-enrollment', 'password-only-retirement', 'disable-biometric', 'malformed-generation-repair'].includes(record.phase ?? '')
    || !Number.isSafeInteger(record.updatedAt) || Number(record.updatedAt) < 0) return null
  return record as BiometricMigrationJournal
}

function exactJournalEqual(expected: BiometricMigrationJournal, raw: unknown): raw is BiometricMigrationJournal {
  const actual = parseJournal(raw)
  if (!actual || !raw || typeof raw !== 'object') return false
  const expectedKeys = ['version', 'walletId', 'vaultRevision', 'phase', 'updatedAt']
  const actualKeys = Object.keys(raw as Record<string, unknown>).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys.sort()[index])) return false
  return actual.version === expected.version
    && actual.walletId === expected.walletId
    && actual.vaultRevision === expected.vaultRevision
    && actual.phase === expected.phase
    && actual.updatedAt === expected.updatedAt
}

function parseGeneration(value: unknown): GenerationRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<GenerationRecord>
  if (record.version !== 1 || typeof record.walletId !== 'string' || record.walletId.trim().length === 0
    || !Number.isSafeInteger(record.generation) || Number(record.generation) < 0) return null
  return record as GenerationRecord
}

function validLegacyEncrypted(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as { iv?: unknown; data?: unknown }
  return hex(record.iv, 12) && hex(record.data)
}

async function signalCredentialLabels(envelope: PrfEnvelope, assertedUserId?: string): Promise<void> {
  if (envelope.userId && assertedUserId && envelope.userId !== assertedUserId) return
  const userId = envelope.userId ?? assertedUserId
  if (!userId) return
  const api = globalThis.PublicKeyCredential as CredentialSignalApi | undefined
  if (typeof api?.signalCurrentUserDetails !== 'function') return
  try {
    await api.signalCurrentUserDetails({
      rpId: envelope.rpId,
      userId,
      name: WEBAUTHN_USER_NAME,
      displayName: WEBAUTHN_USER_DISPLAY_NAME,
    })
  } catch {
    // WebAuthn signals are opportunistic metadata updates. Authentication must
    // remain available when a browser or authenticator cannot apply the label.
  }
}

function prfOutput(credential: PublicKeyCredential): Uint8Array | null {
  const output = (credential.getClientExtensionResults() as PrfOutputs).prf?.results?.first
  return output instanceof ArrayBuffer && output.byteLength === 32 ? new Uint8Array(output) : null
}

async function wrappingKey(secret: Uint8Array, salt: string): Promise<CryptoKey> {
  try {
    const material = await window.crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey'])
    return await window.crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: hexToBuffer(salt) as BufferSource, info: new TextEncoder().encode('goldenera-wallet/prf/v2/password') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally {
    secret.fill(0)
  }
}

function validateClientData(credential: PublicKeyCredential, challenge: Uint8Array, type: 'webauthn.create' | 'webauthn.get') {
  const data = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON)) as { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean }
  const expected = btoa(String.fromCharCode(...challenge)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  if (data.type !== type || data.challenge !== expected || data.origin !== window.location.origin || data.crossOrigin === true) throw new Error('Invalid authenticator response')
}

async function assertion(credentialId: string, context: BiometricContext, prfInput?: string): Promise<PublicKeyCredential> {
  assertCurrent(context)
  const challenge = random(32)
  try {
    const credential = await navigator.credentials.get({
      signal: context.signal,
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        timeout: 60000,
        userVerification: 'required',
        allowCredentials: [{ id: hexToBuffer(credentialId) as BufferSource, type: 'public-key' }],
        ...(prfInput ? { extensions: { prf: { eval: { first: hexToBuffer(prfInput) } } } as AuthenticationExtensionsClientInputs } : {}),
      },
    }) as PublicKeyCredential | null
    assertCurrent(context)
    if (!credential || bufferToHex(credential.rawId) !== credentialId.toLowerCase()) throw biometricError('BIOMETRIC_WRONG_CREDENTIAL', 'Wrong authenticator credential')
    validateClientData(credential, challenge, 'webauthn.get')
    const authData = new Uint8Array((credential.response as AuthenticatorAssertionResponse).authenticatorData)
    const rpHash = bufferToHex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(window.location.hostname)))
    if (authData.length < 37 || (authData[32] & 5) !== 5 || bufferToHex(authData.slice(0, 32)) !== rpHash) throw new Error('User verification was not completed')
    return credential
  } catch (error) {
    throw normalizeCredentialError(error, context)
  }
}

async function decryptEnvelope(envelope: PrfEnvelope, key: CryptoKey): Promise<string> {
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBuffer(envelope.iv) as BufferSource, additionalData: aad(envelope) }, key, hexToBuffer(envelope.data) as BufferSource)
  return new TextDecoder().decode(decrypted)
}

async function authenticateEnvelope(envelope: PrfEnvelope, context: BiometricContext): Promise<{ password: string; credential: PublicKeyCredential }> {
  const credential = await assertion(envelope.credentialId, context, envelope.prfInput)
  const secret = prfOutput(credential)
  if (!secret) throw biometricError('BIOMETRIC_UNSUPPORTED', 'This authenticator cannot unlock the wallet securely. Use your password.')
  const password = await decryptEnvelope(envelope, await wrappingKey(secret, envelope.salt))
  assertCurrent(context)
  return { password, credential }
}

async function writeJournal(context: BiometricContext, phase: BiometricMigrationPhase, recheckGeneration = false): Promise<void> {
  assertCurrent(context)
  const journal: BiometricMigrationJournal = { version: 1, walletId: context.vaultId, vaultRevision: context.vaultRevision, phase, updatedAt: Date.now() }
  await StorageService.basic.setItem(KEYS.MIGRATION, journal)
  if (recheckGeneration) await assertGeneration(context)
  else assertCurrent(context)
  const saved = await StorageService.basic.getItem(KEYS.MIGRATION)
  if (recheckGeneration) await assertGeneration(context)
  else assertCurrent(context)
  if (!exactJournalEqual(journal, saved)) {
    throw new Error('Biometric migration journal persistence could not be verified')
  }
}

async function clearJournal(context: BiometricContext, expectedPhase?: BiometricMigrationPhase): Promise<void> {
  const raw = await StorageService.basic.getItem(KEYS.MIGRATION)
  if (raw === null) return
  const journal = parseJournal(raw)
  const matching = journal?.walletId === context.vaultId && journal.vaultRevision === context.vaultRevision
  if (expectedPhase && (!matching || journal?.phase !== expectedPhase)) {
    throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric cleanup intent changed before it could be verified.')
  }
  if (!expectedPhase && journal && !matching) return
  await StorageService.basic.removeItem(KEYS.MIGRATION)
  if (await StorageService.basic.getItem(KEYS.MIGRATION) !== null) throw new Error('Biometric migration journal cleanup could not be verified')
}

async function removeLegacyRaw(): Promise<void> {
  await StorageService.basic.removeItem(KEYS.ENCRYPTED_PASSWORD)
  await StorageService.basic.removeItem(KEYS.CREDENTIAL_ID)
  await StorageService.basic.removeItem(KEYS.ENABLED)
  if (await StorageService.basic.getItem(KEYS.ENCRYPTED_PASSWORD) !== null
    || await StorageService.basic.getItem(KEYS.CREDENTIAL_ID) !== null
    || await StorageService.basic.getItem(KEYS.ENABLED) !== null) {
    throw new Error('Older biometric data could not be removed')
  }
}

/** Makes legacy credential-ID recovery unreadable to cached PWA bundles. */
async function blockCachedLegacyAccess(context?: BiometricContext): Promise<void> {
  const tombstone = { version: 0, state: 'disabled' }
  await StorageService.basic.setItem(KEYS.ENCRYPTED_PASSWORD, tombstone)
  if (context) await assertGeneration(context)
  const saved = await StorageService.basic.getItem(KEYS.ENCRYPTED_PASSWORD)
  if (context) await assertGeneration(context)
  if (JSON.stringify(saved) !== JSON.stringify(tombstone)) {
    throw new Error('Older biometric access could not be disabled safely')
  }
}

/** Makes the PRF unreadable to both current and already-cached PWA bundles. */
async function blockCachedPrfAccess(context?: BiometricContext): Promise<void> {
  const tombstone = { version: 0, state: 'disabled' }
  await StorageService.basic.setItem(KEYS.PRF, tombstone)
  if (context) await assertGeneration(context)
  const saved = await StorageService.basic.getItem(KEYS.PRF)
  if (context) await assertGeneration(context)
  if (JSON.stringify(saved) !== JSON.stringify(tombstone)) {
    throw new Error('Biometric access could not be disabled safely')
  }
}

async function removePrfRecord(): Promise<void> {
  await StorageService.basic.removeItem(KEYS.PRF)
  if (await StorageService.basic.getItem(KEYS.PRF) !== null) throw new Error('Biometric access data could not be removed')
}

async function currentGeneration(walletId: string): Promise<number> {
  const raw = await StorageService.basic.getItem(KEYS.GENERATION)
  if (raw === null) return 0
  const record = parseGeneration(raw)
  if (!record) throw biometricError('BIOMETRIC_GENERATION_MALFORMED', 'Biometric generation state is malformed. Unlock with your password to reset biometric access safely.')
  return record.walletId === walletId ? record.generation : 0
}

async function commitGeneration(context: BiometricContext): Promise<number> {
  assertCurrent(context)
  const current = await currentGeneration(context.vaultId)
  if (context.biometricGeneration !== undefined && current !== context.biometricGeneration) {
    throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric settings changed in another tab. Retry authentication.')
  }
  if (current >= Number.MAX_SAFE_INTEGER) throw new Error('Biometric generation counter is exhausted')
  const next = current + 1
  const record: GenerationRecord = { version: 1, walletId: context.vaultId, generation: next }
  await StorageService.basic.setItem(KEYS.GENERATION, record)
  const saved = parseGeneration(await StorageService.basic.getItem(KEYS.GENERATION))
  if (!saved || saved.walletId !== record.walletId || saved.generation !== next) throw new Error('Biometric generation persistence could not be verified')
  publishBiometricGeneration(context.vaultId, next)
  return next
}

function exactStoredValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Biometric state cannot be compared safely')
  return serialized
}

function sameVaultRecord(left: WalletVaultRecord, right: WalletVaultRecord): boolean {
  return left.source === right.source
    && left.vault.version === right.vault.version
    && left.vault.id === right.vault.id
    && left.vault.revision === right.vault.revision
    && left.vault.address === right.vault.address
    && left.vault.encryptedMnemonic === right.vault.encryptedMnemonic
    && left.vault.backedUp === right.vault.backedUp
}

function permitsMalformedGenerationBiometricRepair(inspection: BiometricInspection): boolean {
  // A matching PRF may repair damaged generation metadata only when it remains
  // active authority. Retirement intent requires verified password cleanup.
  if (inspection.cleanupIntent === 'password-only') return false
  if (inspection.prfState !== 'matching' || !inspection.envelope) return false
  if (inspection.journalState === 'malformed' || inspection.journalState === 'foreign') return false
  return inspection.journalState !== 'matching'
    || !inspection.journal
    || !['password-only-retirement', 'disable-biometric', 'malformed-generation-repair'].includes(inspection.journal.phase)
}

function freshGeneration(rawGeneration: unknown, context: BiometricContext): number {
  const forbidden = new Set<number>()
  if (Number.isSafeInteger(context.biometricGeneration) && Number(context.biometricGeneration) >= 0) {
    forbidden.add(Number(context.biometricGeneration))
  }
  if (rawGeneration && typeof rawGeneration === 'object') {
    const hinted = (rawGeneration as { generation?: unknown }).generation
    if (Number.isSafeInteger(hinted) && Number(hinted) >= 0) forbidden.add(Number(hinted))
  }
  for (;;) {
    const bytes = random(6)
    let generation = 0
    for (const byte of bytes) generation = generation * 256 + byte
    if (generation > 0 && !forbidden.has(generation)) return generation
  }
}

async function verifyVault(context: BiometricContext, password: string): Promise<void> {
  const vault = await WalletVaultService.read()
  const mnemonic = vault && vault.id === context.vaultId && vault.revision === context.vaultRevision
    ? await WalletVaultService.decrypt(vault, password)
    : null
  if (!vault || !mnemonic) throw new Error('Wallet changed during biometric migration')
  let address: string
  try { address = WalletUtil.restoreFromMnemonic(mnemonic).address } catch {
    throw new Error('Stored recovery phrase is invalid')
  }
  if (vault.address && address.toLowerCase() !== vault.address.toLowerCase()) {
    throw new Error('Wallet identity changed during biometric migration')
  }
  assertCurrent(context)
}

async function inspectWeb(context?: BiometricContext): Promise<BiometricInspection> {
  const [rawPrf, credentialId, encrypted, enabled, rawJournal, rawGeneration] = await Promise.all([
    StorageService.basic.getItem(KEYS.PRF),
    StorageService.basic.getItem(KEYS.CREDENTIAL_ID),
    StorageService.basic.getItem(KEYS.ENCRYPTED_PASSWORD),
    StorageService.basic.getItem(KEYS.ENABLED),
    StorageService.basic.getItem(KEYS.MIGRATION),
    StorageService.basic.getItem(KEYS.GENERATION),
  ])
  const envelope = parseEnvelope(rawPrf)
  const prfState: BiometricPrfState = rawPrf === null
    ? 'absent'
    : isDisabledTombstone(rawPrf)
      ? 'disabled'
      : !envelope
        ? 'malformed'
        : context && matches(envelope, context)
          ? 'matching'
          : 'foreign'
  const hasCredential = credentialId !== null
  const hasEncrypted = encrypted !== null
  const legacyWrapperDisabled = isDisabledTombstone(encrypted)
  const validComplete = hex(credentialId) && validLegacyEncrypted(encrypted)
  const legacyState: LegacyBiometricState = !hasCredential && !hasEncrypted ? 'absent' : validComplete ? 'complete' : 'partial'
  const journal = parseJournal(rawJournal)
  const journalState: BiometricJournalState = rawJournal === null
    ? 'absent'
    : !journal
      ? 'malformed'
      : context && journal.walletId === context.vaultId && journal.vaultRevision === context.vaultRevision
        ? 'matching'
        : 'foreign'
  const generation = parseGeneration(rawGeneration)
  const generationState: BiometricGenerationState = rawGeneration === null
    ? 'absent'
    : !generation
      ? 'malformed'
      : context && generation.walletId === context.vaultId
        ? 'matching'
        : 'foreign'
  const foreignState = prfState === 'foreign'
    || journalState === 'foreign'
    || generationState === 'foreign'
  // These two journal phases intentionally carry a tombstoned old wrapper
  // forward into the password-replacement commit. Every other tombstone is an
  // authoritative restart marker for password-only retirement.
  const passwordReplacementContinuation = journalState === 'matching'
    && !!journal
    && ['legacy-recovery-prepared', 'password-committed-enrollment'].includes(journal.phase)
  const cleanupIntent: BiometricCleanupIntent = prfState === 'disabled'
    || (legacyWrapperDisabled && !passwordReplacementContinuation)
    ? 'password-only'
    : journalState === 'malformed' || prfState === 'malformed' || generationState === 'malformed'
      ? 'blocked'
      : foreignState
        ? 'password-only'
        : journalState !== 'matching' || !journal
          ? null
          : ['password-only-retirement', 'disable-biometric', 'malformed-generation-repair'].includes(journal.phase)
            ? 'password-only'
            : 'enroll'
  const inspection: BiometricInspection = {
    prfState,
    envelope,
    legacyState,
    sensitiveLegacy: legacyState !== 'absent',
    enabledMarker: enabled === true,
    journal,
    journalState,
    generation: generation?.generation ?? null,
    generationState,
    cleanupIntent,
    cleanupPending: legacyState !== 'absent'
      || journalState === 'matching'
      || journalState === 'malformed'
      || journalState === 'foreign'
      || prfState === 'malformed'
      || prfState === 'foreign'
      || prfState === 'disabled'
      || generationState === 'malformed'
      || generationState === 'foreign',
    legacyRecoveryBlocked: false,
  }
  inspection.legacyRecoveryBlocked = blocksLegacyRecovery(inspection)
  return inspection
}

const LEGACY_RECOVERY_BLOCKING_PHASES: ReadonlySet<BiometricMigrationPhase> = new Set([
  'prf-committed-cleanup',
  'legacy-recovery-prepared',
  'password-committed-enrollment',
  'password-only-retirement',
  'disable-biometric',
  'malformed-generation-repair',
])

function hasStrongLegacyRecoveryIntent(inspection: BiometricInspection): boolean {
  return inspection.journal !== null && LEGACY_RECOVERY_BLOCKING_PHASES.has(inspection.journal.phase)
}

function blocksLegacyRecovery(inspection: BiometricInspection): boolean {
  // A matching PRF envelope is already a durable, stronger authority even if the
  // journal write was interrupted. Never resume credential-ID-derived recovery.
  return hasStrongLegacyRecoveryIntent(inspection)
    || inspection.prfState === 'matching'
    || inspection.prfState === 'disabled'
    || inspection.journalState === 'malformed'
    || inspection.generationState === 'malformed'
}

function isPreparedLegacyRecoveryCommit(inspection: BiometricInspection, context: BiometricContext): boolean {
  const journal = inspection.journal
  return journal?.phase === 'legacy-recovery-prepared'
    && journal.walletId === context.vaultId
    && journal.vaultRevision + 1 === context.vaultRevision
}

async function verifyDestructiveCleanup(context: BiometricContext, phase: BiometricMigrationPhase): Promise<void> {
  const cleaned = await inspectWeb(context)
  if (cleaned.prfState !== 'absent'
    || cleaned.sensitiveLegacy
    || cleaned.enabledMarker
    || cleaned.journalState !== 'matching'
    || cleaned.journal?.phase !== phase) {
    throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement is incomplete. Retry with your password.')
  }
}

async function disableWithoutWalletMutation(context?: BiometricContext): Promise<void> {
  if (BiometricUtil.getPlatform() !== 'web') {
    await NativeBiometric.deleteCredentials({ server: SERVER_ID })
    await StorageService.basic.removeItem(KEYS.ENABLED)
    return
  }
  if (context) {
    await assertGeneration(context)
    const vault = await WalletVaultService.read()
    if (!vault || vault.id !== context.vaultId || vault.revision !== context.vaultRevision) throw new Error('Wallet changed during biometric removal')
    // Linearize verified password-only retirement before either wrapper can be
    // tombstoned. A crash after any subsequent write restarts password-only.
    await writeJournal(context, 'disable-biometric')
    await blockCachedLegacyAccess()
    await blockCachedPrfAccess()
  }
  if (!context) await StorageService.basic.removeItem(KEYS.PRF)
  await removeLegacyRaw()
  if (context) {
    await removePrfRecord()
    await verifyDestructiveCleanup(context, 'disable-biometric')
    await commitGeneration(context)
    await verifyDestructiveCleanup(context, 'disable-biometric')
    await clearJournal(context, 'disable-biometric')
    return
  }
  await StorageService.basic.removeItem(KEYS.MIGRATION)
  const cleaned = await inspectWeb()
  if (cleaned.prfState !== 'absent' || cleaned.sensitiveLegacy || cleaned.enabledMarker || cleaned.journalState !== 'absent') {
    throw new Error('Biometric removal could not be verified')
  }
}

async function cleanupOrphanedWithoutWalletMutation(scope?: WalletMutationScope): Promise<void> {
  if (BiometricUtil.getPlatform() !== 'web') {
    if (!await WalletVaultService.read(scope)) await StorageService.basic.removeItem(KEYS.ENABLED)
    return
  }
  if (await WalletVaultService.read(scope)) return
  const existing = await inspectWeb()
  const generationRecord = parseGeneration(await StorageService.basic.getItem(KEYS.GENERATION))
  const hasResidue = existing.prfState !== 'absent'
    || existing.legacyState !== 'absent'
    || existing.journalState !== 'absent'
    || existing.generationState !== 'absent'
    || existing.enabledMarker
  if (!hasResidue) return
  await StorageService.basic.removeItem(KEYS.PRF)
  await removeLegacyRaw()
  await StorageService.basic.removeItem(KEYS.MIGRATION)
  await StorageService.basic.removeItem(KEYS.GENERATION)
  const cleaned = await inspectWeb()
  if (cleaned.prfState !== 'absent'
    || cleaned.legacyState !== 'absent'
    || cleaned.journalState !== 'absent'
    || cleaned.generationState !== 'absent'
    || cleaned.enabledMarker) {
    throw new Error('Orphaned biometric state could not be removed safely')
  }
  for (const walletId of new Set([existing.journal?.walletId, existing.envelope?.walletId, generationRecord?.walletId])) {
    if (walletId) publishBiometricGeneration(walletId, 0)
  }
}

async function finishPrfCleanup(envelope: PrfEnvelope, password: string, context: BiometricContext): Promise<void> {
  await withWalletMutation(async () => {
    await assertGeneration(context)
    await verifyVault(context, password)
    const inspection = await inspectWeb(context)
    if (inspection.cleanupIntent === 'password-only' || inspection.cleanupIntent === 'blocked') {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement is pending. Unlock with your password to finish it safely.')
    }
    const persistedEnvelope = await StorageService.basic.getItem(KEYS.PRF)
    if (inspection.prfState !== 'matching' || !inspection.envelope
      || !exactEnvelopeEqual(envelope, persistedEnvelope)) {
      throw biometricError('BIOMETRIC_SUPERSEDED', 'Biometric settings changed while migration was finishing.')
    }
    try {
      await writeJournal(context, 'prf-committed-cleanup')
      await removeLegacyRaw()
      let cleaned = await inspectWeb(context)
      if (cleaned.prfState !== 'matching' || !cleaned.envelope
        || !exactEnvelopeEqual(envelope, await StorageService.basic.getItem(KEYS.PRF))
        || cleaned.sensitiveLegacy || cleaned.enabledMarker || cleaned.journal?.phase !== 'prf-committed-cleanup') {
        throw new Error('Older biometric data remains after cleanup')
      }
      await commitGeneration(context)
      cleaned = await inspectWeb(context)
      if (cleaned.prfState !== 'matching' || !cleaned.envelope
        || !exactEnvelopeEqual(envelope, await StorageService.basic.getItem(KEYS.PRF))
        || cleaned.sensitiveLegacy || cleaned.enabledMarker || cleaned.journal?.phase !== 'prf-committed-cleanup') {
        throw new Error('Biometric cleanup changed before journal commit')
      }
      await clearJournal(context, 'prf-committed-cleanup')
    } catch (error) {
      if (error instanceof BiometricMigrationError
        && (error.code === 'BIOMETRIC_GENERATION_CHANGED' || error.code === 'BIOMETRIC_SUPERSEDED')) throw error
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Older biometric access could not be retired. Retry migration.', error)
    }
  })
}

export const BiometricService = {
  async isAvailable(): Promise<boolean> {
    if (BiometricUtil.getPlatform() !== 'web') {
      try { return (await NativeBiometric.isAvailable()).isAvailable } catch { return false }
    }
    if (!BiometricUtil.isWebAuthnAvailable()) return false
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
  },

  async getType(): Promise<BiometricType> {
    if (BiometricUtil.getPlatform() !== 'web') {
      try {
        const result = await NativeBiometric.isAvailable()
        if (!result.isAvailable) return 'none'
        if (result.biometryType === 2 || result.biometryType === 4) return 'face'
        if (result.biometryType === 5) return 'iris'
        return 'fingerprint'
      } catch { return 'none' }
    }
    return await this.isAvailable() ? 'fingerprint' : 'none'
  },

  async inspect(context?: BiometricContext): Promise<BiometricInspection> {
    if (BiometricUtil.getPlatform() !== 'web') {
      const enabled = await StorageService.basic.getItem(KEYS.ENABLED) === true
      return { prfState: 'absent', envelope: null, legacyState: 'absent', sensitiveLegacy: false, enabledMarker: enabled, journal: null, journalState: 'absent', generation: null, generationState: 'absent', cleanupIntent: null, cleanupPending: false, legacyRecoveryBlocked: false }
    }
    return inspectWeb(context)
  },

  async getGeneration(walletId: string): Promise<number> {
    return BiometricUtil.getPlatform() === 'web' ? currentGeneration(walletId) : 0
  },

  async hasLegacy(): Promise<boolean> {
    return (await this.inspect()).sensitiveLegacy
  },

  async isEnabled(context: BiometricContext): Promise<boolean> {
    if (BiometricUtil.getPlatform() !== 'web') return await StorageService.basic.getItem(KEYS.ENABLED) === true
    return (await inspectWeb(context)).prfState === 'matching'
  },

  async authenticate(context: BiometricContext): Promise<BiometricAuthenticationResult> {
    assertCurrent(context)
    if (BiometricUtil.getPlatform() !== 'web') {
      await NativeBiometric.verifyIdentity({ reason: 'Authenticate to unlock your wallet', title: 'GoldenEra Wallet' })
      const credentials = await NativeBiometric.getCredentials({ server: SERVER_ID })
      assertCurrent(context)
      return { success: true, password: credentials.password, proof: 'native-biometric-verification' }
    }
    await assertGeneration(context)
    const inspection = await inspectWeb(context)
    if (inspection.cleanupIntent === 'password-only' || inspection.cleanupIntent === 'blocked') {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement is pending. Unlock with your password to finish it safely.')
    }
    if (inspection.prfState !== 'matching' || !inspection.envelope) return { success: false }
    const { password, credential } = await authenticateEnvelope(inspection.envelope, context)
    await assertGeneration(context)
    if (inspection.cleanupPending) await finishPrfCleanup(inspection.envelope, password, context)
    const returnedUserHandle = (credential.response as AuthenticatorAssertionResponse).userHandle
    const assertedUserId = returnedUserHandle instanceof ArrayBuffer && returnedUserHandle.byteLength > 0 && returnedUserHandle.byteLength <= 64
      ? base64url(new Uint8Array(returnedUserHandle))
      : undefined
    void signalCredentialLabels(inspection.envelope, assertedUserId)
    return { success: true, password, proof: authenticationProof(inspection.envelope) }
  },

  /** Revalidates the asserted credential at the wallet-opening linearization point. */
  async verifyAuthenticationWithinWalletMutation(
    _scope: WalletMutationScope,
    proof: string,
    context: BiometricContext,
  ): Promise<void> {
    assertWalletMutationScope(_scope)
    if (BiometricUtil.getPlatform() !== 'web') return
    await assertGeneration(context)
    const inspection = await inspectWeb(context)
    if (inspection.prfState !== 'matching'
      || !inspection.envelope
      || inspection.cleanupPending
      || authenticationProof(inspection.envelope) !== proof) {
      throw biometricError('BIOMETRIC_SUPERSEDED', 'Biometric access was disabled or changed before the wallet could open. Retry or use your password.')
    }
  },

  async enable(password: string, context: BiometricContext): Promise<BiometricEnrollmentResult> {
    assertCurrent(context)
    if (BiometricUtil.getPlatform() !== 'web') {
      await NativeBiometric.setCredentials({ username: 'goldenera-wallet', password, server: SERVER_ID })
      await StorageService.basic.setItem(KEYS.ENABLED, true)
      return { verified: true, legacyCleanupComplete: true }
    }
    await assertGeneration(context)
    const existing = await inspectWeb(context)
    if (existing.cleanupIntent === 'password-only' || existing.cleanupIntent === 'blocked') {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement is pending. Unlock with your password to finish it safely.')
    }
    if (existing.prfState === 'matching' && existing.envelope) {
      const authenticated = await authenticateEnvelope(existing.envelope, context)
      if (authenticated.password !== password) throw biometricError('BIOMETRIC_WRONG_CREDENTIAL', 'The committed biometric credential does not match this wallet password.')
      try {
        await finishPrfCleanup(existing.envelope, password, context)
        return { verified: true, legacyCleanupComplete: true }
      } catch (error) {
        if (error instanceof BiometricMigrationError && error.code === 'BIOMETRIC_CLEANUP_PENDING') {
          return {
            verified: true,
            legacyCleanupComplete: false,
            cleanupProof: authenticationProof(existing.envelope),
          }
        }
        throw error
      }
    }
    if (!BiometricUtil.isWebAuthnAvailable()) return { verified: false, legacyCleanupComplete: false }
    if (existing.cleanupPending) {
      await withWalletMutation(async () => {
        await assertGeneration(context)
        await verifyVault(context, password)
        await writeJournal(context, 'legacy-cleanup-required')
      })
    }
    const userId = await webauthnUserId(context.vaultId)
    assertCurrent(context)
    const challenge = random(32)
    const prfInput = random(32)
    let credential: PublicKeyCredential | null
    try {
      credential = await navigator.credentials.create({
        signal: context.signal,
        publicKey: {
          challenge,
          rp: { name: 'GoldenEra Wallet', id: window.location.hostname },
          user: { id: userId, name: WEBAUTHN_USER_NAME, displayName: WEBAUTHN_USER_DISPLAY_NAME },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60000,
          extensions: { prf: { eval: { first: prfInput } } } as AuthenticationExtensionsClientInputs,
        },
      }) as PublicKeyCredential | null
    } catch (error) {
      throw normalizeCredentialError(error, context)
    }
    assertCurrent(context)
    if (!credential) return { verified: false, legacyCleanupComplete: false }
    validateClientData(credential, challenge, 'webauthn.create')
    if ((credential.getClientExtensionResults() as PrfOutputs).prf?.enabled !== true) return { verified: false, legacyCleanupComplete: false }
    const credentialId = bufferToHex(credential.rawId)
    const secret = prfOutput(credential) ?? prfOutput(await assertion(credentialId, context, bufferToHex(prfInput)))
    if (!secret) return { verified: false, legacyCleanupComplete: false }
    const envelope: PrfEnvelope = {
      version: 2, scheme: SCHEME, walletId: context.vaultId, vaultRevision: context.vaultRevision,
      rpId: window.location.hostname, credentialId, prfInput: bufferToHex(prfInput), salt: bufferToHex(random(32)), iv: bufferToHex(random(12)), data: '',
      userId: base64url(userId),
    }
    const key = await wrappingKey(secret, envelope.salt)
    envelope.data = bufferToHex(await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: hexToBuffer(envelope.iv) as BufferSource, additionalData: aad(envelope) }, key, new TextEncoder().encode(password)))
    let verified = false
    let legacyCleanupComplete = false
    await withWalletMutation(async () => {
      await assertGeneration(context)
      await verifyVault(context, password)
      await writeJournal(context, 'legacy-cleanup-required')
      const previous = await StorageService.basic.getItem(KEYS.PRF)
      try {
        await StorageService.basic.setItem(KEYS.PRF, envelope)
        const persistedRaw = await StorageService.basic.getItem(KEYS.PRF)
        const persisted = parseEnvelope(persistedRaw)
        if (!persisted || !exactEnvelopeEqual(envelope, persistedRaw)
          || !matches(persisted, context)
          || await decryptEnvelope(persisted, key) !== password) throw new Error('Biometric persistence verification failed')
        // This exact decrypt-readback is the strong in-process commit. From this
        // point onward retain its stronger authority even if later cleanup fails.
        verified = true
      } catch (error) {
        try {
          if (previous === null) await StorageService.basic.removeItem(KEYS.PRF)
          else await StorageService.basic.setItem(KEYS.PRF, previous)
        } catch { /* The caller still treats this enrollment as unverified. */ }
        throw error
      }
      try {
        await writeJournal(context, 'prf-committed-cleanup')
        await removeLegacyRaw()
        let cleaned = await inspectWeb(context)
        if (cleaned.prfState !== 'matching' || !cleaned.envelope
          || !exactEnvelopeEqual(envelope, await StorageService.basic.getItem(KEYS.PRF))
          || cleaned.sensitiveLegacy || cleaned.enabledMarker || cleaned.journal?.phase !== 'prf-committed-cleanup') {
          throw new Error('Older biometric data remains after cleanup')
        }
        await commitGeneration(context)
        cleaned = await inspectWeb(context)
        if (cleaned.prfState !== 'matching' || !cleaned.envelope
          || !exactEnvelopeEqual(envelope, await StorageService.basic.getItem(KEYS.PRF))
          || cleaned.sensitiveLegacy || cleaned.enabledMarker || cleaned.journal?.phase !== 'prf-committed-cleanup') {
          throw new Error('Biometric cleanup changed before journal commit')
        }
        await clearJournal(context, 'prf-committed-cleanup')
        legacyCleanupComplete = true
      } catch (error) {
        if (error instanceof BiometricMigrationError
          && (error.code === 'BIOMETRIC_GENERATION_CHANGED' || error.code === 'BIOMETRIC_SUPERSEDED')) throw error
        // The PRF wrapper already passed a real decrypt readback. A later call to
        // enable() sees it and performs assertion-backed cleanup without create().
      }
    })
    return {
      verified,
      legacyCleanupComplete,
      ...(verified && !legacyCleanupComplete
        ? { cleanupProof: authenticationProof(envelope) }
        : {}),
    }
  },

  /** Retries cleanup after one verified ceremony without prompting the user again. */
  async retryCommittedPrfCleanup(
    password: string,
    proof: string,
    context: BiometricContext,
  ): Promise<BiometricEnrollmentResult> {
    if (BiometricUtil.getPlatform() !== 'web') {
      return { verified: true, legacyCleanupComplete: true }
    }
    await assertGeneration(context)
    const inspection = await inspectWeb(context)
    if (inspection.prfState !== 'matching' || !inspection.envelope
      || authenticationProof(inspection.envelope) !== proof) {
      throw biometricError('BIOMETRIC_SUPERSEDED', 'Biometric settings changed while migration was finishing.')
    }
    try {
      await finishPrfCleanup(inspection.envelope, password, context)
      return { verified: true, legacyCleanupComplete: true }
    } catch (error) {
      if (error instanceof BiometricMigrationError && error.code === 'BIOMETRIC_CLEANUP_PENDING') {
        return { verified: true, legacyCleanupComplete: false, cleanupProof: proof }
      }
      throw error
    }
  },

  /** The only credential-ID decryption path: explicit one-time legacy recovery. */
  async recoverLegacyForMigration(context: BiometricContext): Promise<string> {
    if (BiometricUtil.getPlatform() !== 'web') throw new Error('Legacy recovery is only available for an existing web wallet')
    await assertGeneration(context)
    const inspection = await inspectWeb(context)
    if (inspection.legacyRecoveryBlocked) {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement or damaged migration metadata must be resolved with your password or recovery phrase.')
    }
    const credentialId = await StorageService.basic.getItem<string>(KEYS.CREDENTIAL_ID)
    const encrypted = await StorageService.basic.getItem<{ iv: string; data: string }>(KEYS.ENCRYPTED_PASSWORD)
    if (!hex(credentialId) || !encrypted || !hex(encrypted.iv, 12) || !hex(encrypted.data)) throw biometricError('BIOMETRIC_MALFORMED_STATE', 'Legacy recovery is incomplete. Use your password or recovery phrase.')
    await assertion(credentialId, context)
    await assertGeneration(context)
    const confirmed = await inspectWeb(context)
    if (confirmed.legacyRecoveryBlocked) {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement or damaged migration metadata appeared during recovery. Use your password or recovery phrase.')
    }
    const confirmedCredentialId = await StorageService.basic.getItem<string>(KEYS.CREDENTIAL_ID)
    const confirmedEncrypted = await StorageService.basic.getItem<{ iv: string; data: string }>(KEYS.ENCRYPTED_PASSWORD)
    if (confirmedCredentialId !== credentialId
      || confirmedEncrypted?.iv !== encrypted.iv
      || confirmedEncrypted?.data !== encrypted.data) {
      throw biometricError('BIOMETRIC_SUPERSEDED', 'Legacy biometric access changed during recovery. Verify again.')
    }
    // Compatibility only after real user verification; never used by authenticate.
    const id = hexToBuffer(credentialId)
    const material = await window.crypto.subtle.importKey('raw', id as BufferSource, 'PBKDF2', false, ['deriveKey'])
    const key = await window.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: id.slice(0, 16) as BufferSource }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    const password = new TextDecoder().decode(await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBuffer(encrypted.iv) as BufferSource }, key, hexToBuffer(encrypted.data) as BufferSource))
    assertCurrent(context)
    return password
  },

  /** Removes biometric residue only when no encrypted wallet exists. */
  async cleanupOrphanedState(): Promise<void> {
    await withWalletMutation(scope => cleanupOrphanedWithoutWalletMutation(scope))
  },

  async cleanupOrphanedStateWithinWalletMutation(scope: WalletMutationScope): Promise<void> {
    assertWalletMutationScope(scope)
    await cleanupOrphanedWithoutWalletMutation(scope)
  },

  /**
   * Repairs only unreadable generation metadata after the already-committed PRF
   * credential proves access to the exact, address-bound current wallet.
   */
  async repairMalformedGenerationWithBiometric(
    context: BiometricContext,
  ): Promise<BiometricGenerationRepairResult> {
    if (BiometricUtil.getPlatform() !== 'web') {
      throw biometricError('BIOMETRIC_UNSUPPORTED', 'Biometric generation repair is only available for the web wallet.')
    }
    assertCurrent(context)
    const rawGeneration = await StorageService.basic.getItem(KEYS.GENERATION)
    if (rawGeneration === null || parseGeneration(rawGeneration)) {
      throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric generation state changed. Retry authentication.')
    }
    const generationSnapshot = exactStoredValue(rawGeneration)
    const initialInspection = await inspectWeb(context)
    if (!permitsMalformedGenerationBiometricRepair(initialInspection) || !initialInspection.envelope) {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Damaged biometric metadata cannot be repaired with this credential. Use your password or recovery phrase.')
    }
    const envelopeProof = authenticationProof(initialInspection.envelope)
    const initialRecord = await WalletVaultService.inspect()
    if (!initialRecord
      || initialRecord.vault.id !== context.vaultId
      || initialRecord.vault.revision !== context.vaultRevision) {
      throw biometricError('BIOMETRIC_SUPERSEDED', 'The wallet changed before biometric metadata could be repaired.')
    }
    if (!initialRecord.vault.address) {
      throw biometricError('BIOMETRIC_MALFORMED_STATE', 'A stored wallet address is required for biometric metadata repair. Use your password or recovery phrase.')
    }

    const confirmUnchangedRepairState = async (): Promise<WalletVaultRecord> => {
      assertCurrent(context)
      const confirmedGeneration = await StorageService.basic.getItem(KEYS.GENERATION)
      if (confirmedGeneration === null
        || parseGeneration(confirmedGeneration)
        || exactStoredValue(confirmedGeneration) !== generationSnapshot) {
        throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric generation state changed while it was being repaired. Retry authentication.')
      }
      const inspection = await inspectWeb(context)
      if (!permitsMalformedGenerationBiometricRepair(inspection)
        || !inspection.envelope
        || authenticationProof(inspection.envelope) !== envelopeProof) {
        throw biometricError('BIOMETRIC_SUPERSEDED', 'Biometric access or retirement intent changed while metadata was being repaired.')
      }
      const record = await WalletVaultService.inspect()
      if (!record || !sameVaultRecord(initialRecord, record)) {
        throw biometricError('BIOMETRIC_SUPERSEDED', 'The wallet changed while biometric metadata was being repaired.')
      }
      return record
    }

    // The authenticator ceremony must never run while a wallet/vault mutation lock
    // is held. Exact generation, envelope and vault snapshots are revalidated after
    // acquiring the mutation lock and before any repair write.
    const { password } = await authenticateEnvelope(initialInspection.envelope, context)
    return withWalletMutation(async () => {
      const confirmedRecord = await confirmUnchangedRepairState()
      let mnemonic: string | null
      try {
        mnemonic = await WalletVaultService.decrypt(confirmedRecord.vault, password)
      } catch (error) {
        if (isWalletVaultCorruptionError(error)) throw error
        mnemonic = null
      }
      if (!mnemonic) {
        throw biometricError('BIOMETRIC_WRONG_CREDENTIAL', 'The biometric credential no longer decrypts this wallet.')
      }
      let derivedAddress: string
      try { derivedAddress = WalletUtil.restoreFromMnemonic(mnemonic).address } catch {
        throw biometricError('BIOMETRIC_WRONG_CREDENTIAL', 'The biometric credential decrypted an invalid recovery phrase.')
      }
      if (derivedAddress.toLowerCase() !== confirmedRecord.vault.address!.toLowerCase()) {
        throw biometricError('BIOMETRIC_WRONG_CREDENTIAL', 'The biometric credential belongs to a different wallet.')
      }

      await confirmUnchangedRepairState()
      const generation = freshGeneration(rawGeneration, context)
      const repaired: GenerationRecord = { version: 1, walletId: context.vaultId, generation }
      await StorageService.basic.setItem(KEYS.GENERATION, repaired)
      const saved = parseGeneration(await StorageService.basic.getItem(KEYS.GENERATION))
      if (!saved || saved.walletId !== repaired.walletId || saved.generation !== repaired.generation) {
        throw new Error('Biometric generation repair persistence could not be verified')
      }
      const finalInspection = await inspectWeb(context)
      const finalRecord = await WalletVaultService.inspect()
      if (!permitsMalformedGenerationBiometricRepair(finalInspection)
        || !finalInspection.envelope
        || authenticationProof(finalInspection.envelope) !== envelopeProof
        || !finalRecord
        || !sameVaultRecord(initialRecord, finalRecord)) {
        throw biometricError('BIOMETRIC_SUPERSEDED', 'Biometric access or wallet state changed as metadata repair committed.')
      }
      assertCurrent(context)
      publishBiometricGeneration(context.vaultId, generation)
      return { password, mnemonic, generation }
    })
  },

  /** Password-verified fail-closed recovery for unreadable generation metadata. */
  async repairMalformedGenerationWithPassword(password: string, context: BiometricContext): Promise<number> {
    if (BiometricUtil.getPlatform() !== 'web') return 0
    return withWalletMutation(async () => {
      assertCurrent(context)
      const rawGeneration = await StorageService.basic.getItem(KEYS.GENERATION)
      if (rawGeneration === null || parseGeneration(rawGeneration)) {
        throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric generation state changed. Retry authentication.')
      }
      await verifyVault(context, password)
      const confirmedGeneration = await StorageService.basic.getItem(KEYS.GENERATION)
      if (confirmedGeneration === null || parseGeneration(confirmedGeneration)) {
        throw biometricError('BIOMETRIC_GENERATION_CHANGED', 'Biometric generation state changed while it was being repaired. Retry authentication.')
      }
      try {
        await blockCachedLegacyAccess()
        await blockCachedPrfAccess()
        await writeJournal(context, 'malformed-generation-repair')
        await removeLegacyRaw()
        await removePrfRecord()
        await verifyDestructiveCleanup(context, 'malformed-generation-repair')
        await StorageService.basic.removeItem(KEYS.GENERATION)
        if (await StorageService.basic.getItem(KEYS.GENERATION) !== null) {
          throw new Error('Malformed biometric generation state could not be removed')
        }
        await verifyDestructiveCleanup(context, 'malformed-generation-repair')
        await clearJournal(context, 'malformed-generation-repair')
        publishBiometricGeneration(context.vaultId, 0)
        return 0
      } catch (error) {
        if (error instanceof BiometricMigrationError
          && (error.code === 'BIOMETRIC_GENERATION_CHANGED' || error.code === 'BIOMETRIC_SUPERSEDED')) throw error
        throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Damaged biometric state could not be reset safely. Retry with your password.', error)
      }
    })
  },

  /**
   * Commits the secret-free intent and both cached-wrapper tombstones while the
   * caller still owns the wallet mutation. The encrypted seed is not changed.
   */
  async prepareLegacyRecoveryPasswordReplacementWithinWalletMutation(
    scope: WalletMutationScope,
    context: BiometricContext,
  ): Promise<void> {
    assertWalletMutationScope(scope)
    if (BiometricUtil.getPlatform() !== 'web') {
      throw biometricError('BIOMETRIC_UNSUPPORTED', 'Legacy password replacement preparation is only available for the web wallet.')
    }
    const assertActive = () => {
      assertWalletMutationScope(scope)
      assertCurrent(context)
    }

    await assertGeneration(context)
    assertActive()
    const initialRecord = await WalletVaultService.inspect()
    await assertGeneration(context)
    assertActive()
    if (!initialRecord
      || initialRecord.vault.id !== context.vaultId
      || initialRecord.vault.revision !== context.vaultRevision) {
      throw biometricError('BIOMETRIC_SUPERSEDED', 'The wallet changed before legacy password replacement could be prepared.')
    }
    const initialInspection = await inspectWeb(context)
    await assertGeneration(context)
    assertActive()
    if (initialInspection.legacyRecoveryBlocked) {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement or a committed migration must be resolved with your password or recovery phrase.')
    }

    // Journal first. If either tombstone fails, the old ciphertext remains and
    // current code will not begin another credential-derived recovery attempt.
    await writeJournal(context, 'legacy-recovery-prepared', true)
    await assertGeneration(context)
    assertActive()
    const journaled = await inspectWeb(context)
    await assertGeneration(context)
    assertActive()
    if (journaled.journalState !== 'matching' || journaled.journal?.phase !== 'legacy-recovery-prepared') {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Legacy password replacement intent changed before cached access could be disabled.')
    }

    await blockCachedLegacyAccess(context)
    await assertGeneration(context)
    assertActive()
    await blockCachedPrfAccess(context)
    await assertGeneration(context)
    assertActive()

    const [legacyWrapper, prfWrapper, prepared, confirmedRecord] = await Promise.all([
      StorageService.basic.getItem(KEYS.ENCRYPTED_PASSWORD),
      StorageService.basic.getItem(KEYS.PRF),
      inspectWeb(context),
      WalletVaultService.inspect(),
    ])
    await assertGeneration(context)
    assertActive()
    if (!isDisabledTombstone(legacyWrapper)
      || !isDisabledTombstone(prfWrapper)
      || prepared.journalState !== 'matching'
      || prepared.journal?.phase !== 'legacy-recovery-prepared'
      || !confirmedRecord
      || !sameVaultRecord(initialRecord, confirmedRecord)) {
      throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Cached biometric access could not be durably blocked before password replacement.')
    }
  },

  async markPasswordCommitted(password: string, context: BiometricContext): Promise<void> {
    if (BiometricUtil.getPlatform() !== 'web') return
    await withWalletMutation(async () => {
      await assertGeneration(context)
      await verifyVault(context, password)
      const inspection = await inspectWeb(context)
      await assertGeneration(context)
      const preparedCommit = isPreparedLegacyRecoveryCommit(inspection, context)
      if (inspection.legacyRecoveryBlocked && !preparedCommit) {
        throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement or damaged migration metadata cannot be replaced by enrollment.')
      }
      if (preparedCommit) {
        const [legacyWrapper, prfWrapper] = await Promise.all([
          StorageService.basic.getItem(KEYS.ENCRYPTED_PASSWORD),
          StorageService.basic.getItem(KEYS.PRF),
        ])
        await assertGeneration(context)
        if (!isDisabledTombstone(legacyWrapper) || !isDisabledTombstone(prfWrapper)) {
          throw biometricError('BIOMETRIC_CLEANUP_PENDING', 'Cached biometric access changed before the new password could be marked committed.')
        }
      }
      await writeJournal(context, 'password-committed-enrollment')
      await assertGeneration(context)
      // The prepared PRF tombstone has served its pre-commit purpose. Remove it
      // only after the replacement ciphertext and its new-revision journal exist,
      // so ordinary verified enrollment can proceed without resurrecting old data.
      if (preparedCommit) {
        await removePrfRecord()
        await assertGeneration(context)
      }
      await commitGeneration(context)
    })
  },

  async removeHarmlessMarker(context: BiometricContext): Promise<void> {
    if (BiometricUtil.getPlatform() !== 'web') return
    await withWalletMutation(async () => {
      await assertGeneration(context)
      const vault = await WalletVaultService.read()
      if (!vault || vault.id !== context.vaultId || vault.revision !== context.vaultRevision) throw new Error('Wallet changed during biometric marker cleanup')
      const inspection = await inspectWeb(context)
      if (!inspection.enabledMarker || inspection.cleanupPending) return
      await StorageService.basic.removeItem(KEYS.ENABLED)
      if (await StorageService.basic.getItem(KEYS.ENABLED) !== null) throw new Error('Older biometric marker could not be removed')
      await commitGeneration(context)
    })
  },

  async retireLegacyWithPassword(password: string, context: BiometricContext): Promise<void> {
    if (BiometricUtil.getPlatform() !== 'web') return
    await withWalletMutation(async () => {
      await assertGeneration(context)
      await verifyVault(context, password)
      // The exact-readback journal is the durable password-only authority. It
      // must precede every wrapper tombstone so interrupted retirement cannot
      // later resume as PRF authentication or enrollment.
      await writeJournal(context, 'password-only-retirement')
      await blockCachedLegacyAccess()
      await blockCachedPrfAccess()
      await removeLegacyRaw()
      await removePrfRecord()
      await verifyDestructiveCleanup(context, 'password-only-retirement')
      await commitGeneration(context)
      await verifyDestructiveCleanup(context, 'password-only-retirement')
      await clearJournal(context, 'password-only-retirement')
    })
  },

  /** Blocks cached biometric recovery before the seed-deletion commit. */
  async prepareWalletDeletionWithinWalletMutation(
    scope: WalletMutationScope,
    context: BiometricContext,
  ): Promise<void> {
    assertWalletMutationScope(scope)
    if (BiometricUtil.getPlatform() !== 'web') return
    await assertGeneration(context)
    const vault = await WalletVaultService.read()
    if (!vault || vault.id !== context.vaultId || vault.revision !== context.vaultRevision) {
      throw new Error('Wallet changed during deletion preparation')
    }
    const existing = await inspectWeb(context)
    if (existing.prfState === 'absent'
      && existing.legacyState === 'absent'
      && existing.journalState === 'absent'
      && !existing.enabledMarker) return
    await blockCachedLegacyAccess()
    await blockCachedPrfAccess()
    await writeJournal(context, 'disable-biometric')
  },

  /** Caller must pass the capability supplied by the enclosing wallet mutation. */
  async disableWithinWalletMutation(
    scope: WalletMutationScope,
    context: BiometricContext,
  ): Promise<void> {
    assertWalletMutationScope(scope)
    await disableWithoutWalletMutation(context)
  },

  async disable(context?: BiometricContext): Promise<void> {
    if (context) {
      await withWalletMutation(scope => this.disableWithinWalletMutation(scope, context))
      return
    }
    await disableWithoutWalletMutation()
  },
}
