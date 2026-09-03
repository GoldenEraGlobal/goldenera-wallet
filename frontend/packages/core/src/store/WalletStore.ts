import type { PrivateKey } from '@goldenera/cryptoj'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { BiometricMigrationError, BiometricService, type BiometricContext, type BiometricEnrollmentResult, type BiometricGenerationRepairResult } from '../services/BiometricService'
import { subscribeBiometricGeneration } from '../services/BiometricSessionService'
import { DeviceService } from '../services/DeviceService'
import { getStorage, STORAGE_MNEMONIC_KEY } from '../services/StorageService'
import {
  publishWalletInvalidation,
  readWalletSessionToken,
  subscribeWalletInvalidation,
  withWalletAuthorizationBarrier,
} from '../services/WalletSessionService'
import { WalletVaultService, isWalletVaultCorruptionError, withWalletMutation, type WalletVault, type WalletVaultRecord } from '../services/WalletVaultService'
import { prepareWalletResetBarrier } from '../services/WalletResetBarrierService'
import type { BiometricType } from '../utils/BiometricUtil'
import { CryptoUtil } from '../utils/CryptoUtil'
import { createUuid } from '../utils/UuidUtil'
import { WalletUtil } from '../utils/WalletUtil'

export const SESSION_TIMEOUT_MS = 2 * 60 * 1000
export type WalletStatus = 'loading' | 'no_wallet' | 'locked' | 'unlocked' | 'backup' | 'error'
export interface WalletSessionSnapshot { revision: number; vaultId: string; vaultRevision: number; address: string; storageToken: string | null }
/** Opaque, short-lived handle. All recovery authority and secrets remain private to WalletStore. */
export interface LegacyRecovery { readonly ticketId: string; readonly expiresAt: number }
interface LegacyRecoveryIdentity {
  readonly source: WalletVaultRecord['source']
  readonly id: string
  readonly revision: number
  readonly address: string | null
  readonly encryptedMnemonic: string
  readonly backedUp: boolean
}
interface LegacyRecoveryAuthority {
  state: 'issued' | 'removed'
  readonly expiresAt: number
  readonly vaultId: string
  readonly vaultRevision: number
  readonly biometricGeneration: number
  readonly sessionRevision: number
  readonly storageToken: string | null
  readonly identity: LegacyRecoveryIdentity
  password: string
  mnemonic: string
}
interface LegacyRecoveryOperation {
  state: 'redeeming' | 'removed'
  readonly id: string
  readonly vaultId: string
  readonly vaultRevision: number
  biometricGeneration: number
  readonly sessionRevision: number
  storageToken: string | null
  readonly identity: LegacyRecoveryIdentity
  password: string
  mnemonic: string
  invalidated: boolean
  readonly biometricAbort: AbortController
}
export type LegacyRecoveryPasswordCommit = 'not-started' | 'uncertain' | 'verified'
export type LegacyRecoveryNextAction = 'edit-password' | 'verify-again' | 'reload-and-check-new-password' | 'unlock-with-new-password'
export type LegacyRecoveryCompletionCode = 'PASSWORD_INVALID' | 'AUTHORITY_UNAVAILABLE' | 'DUPLICATE' | 'PRECOMMIT_FAILED' | 'COMMIT_UNCERTAIN' | 'POSTCOMMIT_FAILED'
export interface LegacyRecoveryCompletionResult {
  completed: true
  authorityConsumed: true
  passwordCommit: 'verified'
  nextAction: 'unlock-with-new-password'
}
/** Compatibility base for callers that only need post-password-commit guidance. */
export class LegacyRecoveryEnrollmentError extends Error {}
export class LegacyRecoveryCompletionError extends LegacyRecoveryEnrollmentError {
  readonly code: LegacyRecoveryCompletionCode
  readonly authorityConsumed: boolean
  readonly passwordCommit: LegacyRecoveryPasswordCommit
  readonly nextAction: LegacyRecoveryNextAction

  constructor(
    code: LegacyRecoveryCompletionCode,
    message: string,
    authorityConsumed: boolean,
    passwordCommit: LegacyRecoveryPasswordCommit,
    nextAction: LegacyRecoveryNextAction,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LegacyRecoveryCompletionError'
    this.code = code
    this.authorityConsumed = authorityConsumed
    this.passwordCommit = passwordCommit
    this.nextAction = nextAction
  }
}
class BiometricEnrollmentError extends Error {
  readonly verifiedEnabled: boolean
  readonly legacy: boolean
  constructor(message: string, verifiedEnabled: boolean, legacy: boolean) {
    super(message)
    this.verifiedEnabled = verifiedEnabled
    this.legacy = legacy
  }
}
export interface WalletState {
  status: WalletStatus
  address: string | null
  error: string | null
  _privateKey: PrivateKey | null
  backupPhrase: string | null
  vaultId: string | null
  vaultRevision: number
  sessionRevision: number
  sessionExpiresAt: number | null
  sessionStorageToken: string | null
  biometric: { type: BiometricType; enabled: boolean; available: boolean; legacy: boolean }
}
export interface WalletActions {
  initialize: () => Promise<void>
  createWallet: (password: string, biometric: boolean) => Promise<{ mnemonic: string; address: string }>
  importWallet: (mnemonic: string, password: string, biometric: boolean) => Promise<{ address: string }>
  checkPassword: (password: string) => Promise<string | false>
  unlockWithPassword: (password: string) => Promise<string | false>
  unlockWallet: (mnemonic: string) => Promise<boolean>
  unlockWithBiometric: () => Promise<{ password: string; mnemonic: string }>
  lockWallet: () => Promise<void>
  resetWallet: (password: string) => Promise<void>
  backupWallet: () => Promise<void>
  getPrivateKey: () => PrivateKey | null
  getPrivateKeyForSnapshot: (snapshot: WalletSessionSnapshot | null) => PrivateKey | null
  getSessionSnapshot: () => WalletSessionSnapshot | null
  isSessionCurrent: (snapshot: WalletSessionSnapshot | null) => boolean
  checkSessionDeadline: () => boolean
  touchSession: () => void
  clearError: () => void
  toggleBiometric: (value: boolean, password: string) => Promise<void>
  retireLegacyWithPassword: (password: string) => Promise<string | null>
  recoverLegacyAccess: () => Promise<LegacyRecovery>
  cancelLegacyRecovery: () => void
  completeLegacyRecovery: (recovery: LegacyRecovery, newPassword: string) => Promise<LegacyRecoveryCompletionResult>
}
export type WalletStore = WalletState & WalletActions

function validateNewPassword(password: string) {
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Use at least 8 characters including uppercase, lowercase, a number and a special character')
  }
}

export const useWalletStore = create<WalletStore>()(subscribeWithSelector((set, get) => {
  let mutationPending = false
  let unlockPending = false
  let initializedEvents = false
  let biometricAbort = new AbortController()
  let biometricGeneration = 0
  let activeLegacyRecoveryTicketId: string | null = null
  let activeLegacyRecoveryOperation: LegacyRecoveryOperation | null = null
  const legacyRecoveryAuthorities = new Map<string, LegacyRecoveryAuthority>()

  const resetBiometricOperation = () => {
    biometricAbort.abort()
    biometricAbort = new AbortController()
  }
  /** Revokes only issued tickets. A redeemed operation owns its copied secrets. */
  const clearLegacyRecovery = (ticketId?: string, authority?: LegacyRecoveryAuthority) => {
    if (ticketId !== undefined && authority !== undefined) {
      if (legacyRecoveryAuthorities.get(ticketId) === authority) legacyRecoveryAuthorities.delete(ticketId)
      if (activeLegacyRecoveryTicketId === ticketId) activeLegacyRecoveryTicketId = null
      authority.state = 'removed'
      authority.password = ''
      authority.mnemonic = ''
      return
    }
    for (const issued of legacyRecoveryAuthorities.values()) {
      issued.state = 'removed'
      issued.password = ''
      issued.mnemonic = ''
    }
    legacyRecoveryAuthorities.clear()
    activeLegacyRecoveryTicketId = null
  }
  const invalidateRedeemedLegacyRecovery = () => {
    if (activeLegacyRecoveryOperation) activeLegacyRecoveryOperation.invalidated = true
  }
  const releaseLegacyRecoveryOperation = (operation: LegacyRecoveryOperation) => {
    if (activeLegacyRecoveryOperation === operation) activeLegacyRecoveryOperation = null
    operation.state = 'removed'
    operation.password = ''
    operation.mnemonic = ''
  }
  const invalidate = () => {
    clearLegacyRecovery()
    invalidateRedeemedLegacyRecovery()
    resetBiometricOperation()
    set(state => ({ status: 'locked', address: null, _privateKey: null, backupPhrase: null, sessionExpiresAt: null, sessionStorageToken: null, sessionRevision: state.sessionRevision + 1, error: null }))
  }
  const invalidateGlobally = async () => {
    let invalidated = false
    try {
      await withWalletAuthorizationBarrier(async scope => {
        let publicationError: unknown = null
        try { publishWalletInvalidation(scope) } catch (error) { publicationError = error }
        invalidate()
        invalidated = true
        if (publicationError) throw publicationError
      })
    } catch (error) {
      if (!invalidated) invalidate()
      set({ error: 'Wallet locked locally; other tabs could not be fenced safely. Close other wallet tabs.' })
      throw error
    }
  }
  const current = (revision: number, token: string | null) => {
    try { return get().sessionRevision === revision && readWalletSessionToken() === token } catch { return false }
  }
  const hasWalletMutationLock = () => typeof navigator !== 'undefined' && !!navigator.locks
    || typeof window === 'undefined'
    || !('localStorage' in window)
  const assertCurrent = (revision: number, token: string | null) => {
    if (!current(revision, token)) throw new Error('Wallet session changed. Retry the operation.')
  }
  const fenceCachedWalletOperations = (
    revision: number,
    token: string | null,
  ): Promise<string | null> => withWalletAuthorizationBarrier(async scope => {
    assertCurrent(revision, token)
    const nextToken = publishWalletInvalidation(scope)
    if (typeof window !== 'undefined' && 'localStorage' in window && nextToken === null) {
      throw new Error('Other wallet tabs could not be fenced safely. Close them and retry.')
    }
    clearLegacyRecovery()
    resetBiometricOperation()
    if (get().status === 'unlocked' || get().status === 'backup') {
      set({ sessionStorageToken: nextToken })
    }
    assertCurrent(revision, nextToken)
    return nextToken
  })
  const publishGlobalWalletInvalidation = (): Promise<string | null> =>
    withWalletAuthorizationBarrier(async scope => publishWalletInvalidation(scope))
  const storageFailure = (error?: unknown) => {
    invalidate()
    set({
      status: 'error',
      error: isWalletVaultCorruptionError(error)
        ? error.message
        : 'Wallet storage is unavailable or changed. Retry to safely reload it; do not create a replacement wallet.',
    })
  }
  const notifyFailedMutation = async () => {
    try { await publishGlobalWalletInvalidation() } catch {
      set({ error: `${get().error ?? 'Wallet update failed.'} Close other wallet tabs before retrying.` })
    }
  }
  const biometricContext = (vault: WalletVault, revision: number, token: string | null): BiometricContext => {
    const generation = biometricGeneration
    const controller = biometricAbort
    return {
      vaultId: vault.id,
      vaultRevision: vault.revision,
      biometricGeneration: generation,
      signal: controller.signal,
      isCurrent: () => current(revision, token),
      isBiometricCurrent: () => biometricGeneration === generation && !controller.signal.aborted,
    }
  }
  const recoveryBiometricContext = (vault: WalletVault, operation: LegacyRecoveryOperation): BiometricContext => ({
    vaultId: vault.id,
    vaultRevision: vault.revision,
    biometricGeneration: operation.biometricGeneration,
    signal: operation.biometricAbort.signal,
    isCurrent: () => !operation.invalidated && current(operation.sessionRevision, operation.storageToken),
    isBiometricCurrent: () => biometricGeneration === operation.biometricGeneration && !operation.biometricAbort.signal.aborted,
  })
  const sameLegacyRecoveryIdentity = (identity: LegacyRecoveryIdentity, record: WalletVaultRecord): boolean =>
    identity.source === record.source
      && identity.id === record.vault.id
      && identity.revision === record.vault.revision
      && identity.address === record.vault.address
      && identity.encryptedMnemonic === record.vault.encryptedMnemonic
      && identity.backedUp === record.vault.backedUp
  const readCurrentVault = async (revision: number, token: string | null) => {
    const vault = await WalletVaultService.read()
    assertCurrent(revision, token)
    if (!vault || vault.id !== get().vaultId || vault.revision !== get().vaultRevision) throw new Error('The wallet changed in another tab. Reload it safely.')
    return vault
  }
  const verifyPassword = async (password: string, revision: number, token: string | null) => {
    const record = await WalletVaultService.inspect()
    assertCurrent(revision, token)
    if (!record || record.vault.id !== get().vaultId || record.vault.revision !== get().vaultRevision) {
      throw new Error('The wallet changed in another tab. Reload it safely.')
    }
    let mnemonic: string | null
    try {
      mnemonic = await WalletVaultService.decrypt(record.vault, password)
    } catch (error) {
      if (isWalletVaultCorruptionError(error)) throw error
      return null
    }
    assertCurrent(revision, token)
    if (!mnemonic) return null
    let wallet
    try { wallet = WalletUtil.restoreFromMnemonic(mnemonic) } catch { return null }
    if (record.vault.address && wallet.address.toLowerCase() !== record.vault.address.toLowerCase()) throw new Error('Wrong wallet identity')
    return { record, mnemonic, wallet }
  }
  const inspectBiometric = async (vault: WalletVault, revision: number, token: string | null) => {
    const inspection = await BiometricService.inspect(biometricContext(vault, revision, token))
    assertCurrent(revision, token)
    return {
      enabled: inspection.prfState === 'matching',
      legacy: inspection.sensitiveLegacy,
      cleanupPending: inspection.cleanupPending,
    }
  }
  const synchronizeBiometric = async (vault: WalletVault, revision: number, token: string | null): Promise<{ enabled: boolean; legacy: boolean; cleanupPending: boolean }> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const observedGeneration = await BiometricService.getGeneration(vault.id)
      assertCurrent(revision, token)
      if (observedGeneration !== biometricGeneration) {
        biometricGeneration = observedGeneration
        resetBiometricOperation()
      }
      const persisted = await inspectBiometric(vault, revision, token)
      const confirmedGeneration = await BiometricService.getGeneration(vault.id)
      assertCurrent(revision, token)
      if (confirmedGeneration === observedGeneration) {
        if (biometricGeneration !== confirmedGeneration) {
          biometricGeneration = confirmedGeneration
          resetBiometricOperation()
        }
        set(state => ({ biometric: { ...state.biometric, enabled: persisted.enabled, legacy: persisted.legacy } }))
        return persisted
      }
      biometricGeneration = confirmedGeneration
      resetBiometricOperation()
    }
    throw new Error('Biometric settings changed repeatedly. Retry after other wallet tabs finish updating them.')
  }
  const readBiometric = async (vault: WalletVault | null, revision: number, token: string | null) => {
    const available = await BiometricService.isAvailable()
    const type = await BiometricService.getType()
    if (!vault) {
      const orphaned = await BiometricService.inspect()
      const sensitiveResidue = orphaned.prfState !== 'absent'
        || orphaned.legacyState !== 'absent'
        || orphaned.journalState !== 'absent'
        || orphaned.generationState !== 'absent'
      if (sensitiveResidue) {
        try {
          await BiometricService.cleanupOrphanedState()
        } catch {
          return { available, type, enabled: false, legacy: false, generationMalformed: false, onboardingBlocked: true }
        }
      } else if (orphaned.enabledMarker) {
        try { await BiometricService.cleanupOrphanedState() } catch { /* A marker alone cannot grant wallet access. */ }
      }
      if (biometricGeneration !== 0) {
        biometricGeneration = 0
        resetBiometricOperation()
      }
      return { available, type, enabled: false, legacy: false, generationMalformed: false, onboardingBlocked: false }
    }
    try {
      const persisted = await synchronizeBiometric(vault, revision, token)
      return { available, type, enabled: persisted.enabled, legacy: persisted.legacy, generationMalformed: false, onboardingBlocked: false }
    } catch (error) {
      if (!(error instanceof BiometricMigrationError) || error.code !== 'BIOMETRIC_GENERATION_MALFORMED') throw error
      const inspection = await BiometricService.inspect(biometricContext(vault, revision, token))
      assertCurrent(revision, token)
      // A matching PRF remains eligible for the narrowly fenced biometric repair;
      // exact snapshots are repeated under mutation after the WebAuthn ceremony.
      return { available, type, enabled: inspection.prfState === 'matching', legacy: inspection.sensitiveLegacy, generationMalformed: true, onboardingBlocked: false }
    }
  }
  const persistedBiometric = async (vault: WalletVault, revision: number, token: string | null) => synchronizeBiometric(vault, revision, token)
  const repairMalformedBiometricGenerationWithBiometric = async (
    initialRecord: WalletVaultRecord,
    revision: number,
    token: string | null,
  ) => {
    let activeToken = await fenceCachedWalletOperations(revision, token)
    let repair: BiometricGenerationRepairResult
    let opened = false
    try {
      assertCurrent(revision, activeToken)
      const repaired = await BiometricService.repairMalformedGenerationWithBiometric(
        biometricContext(initialRecord.vault, revision, activeToken),
      )
      biometricGeneration = repaired.generation
      resetBiometricOperation()
      const persisted = await synchronizeBiometric(initialRecord.vault, revision, activeToken)
      if (!persisted.enabled || persisted.cleanupPending) {
        throw new BiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Biometric metadata was repaired, but migration cleanup is still pending. Use your password or retry Biometrics.')
      }
      const confirmed = await WalletVaultService.inspect()
      if (!confirmed
        || confirmed.source !== initialRecord.source
        || confirmed.vault.id !== initialRecord.vault.id
        || confirmed.vault.revision !== initialRecord.vault.revision
        || confirmed.vault.address !== initialRecord.vault.address
        || confirmed.vault.encryptedMnemonic !== initialRecord.vault.encryptedMnemonic
        || confirmed.vault.backedUp !== initialRecord.vault.backedUp) {
        throw new BiometricMigrationError('BIOMETRIC_SUPERSEDED', 'The wallet changed before repaired biometric access could open it.')
      }
      activeToken = await fenceCachedWalletOperations(revision, activeToken)
      openWallet(confirmed.vault, repaired.mnemonic, activeToken)
      opened = true
      repair = repaired
    } finally {
      if (!opened && current(revision, activeToken)) {
        await fenceCachedWalletOperations(revision, activeToken)
      }
    }
    return { password: repair.password, mnemonic: repair.mnemonic }
  }
  const repairMalformedBiometricGeneration = async (vault: WalletVault, password: string, revision: number, token: string | null) => {
    try {
      await synchronizeBiometric(vault, revision, token)
      return { warning: null, token }
    } catch (error) {
      if (!(error instanceof BiometricMigrationError) || error.code !== 'BIOMETRIC_GENERATION_MALFORMED') throw error
    }
    let activeToken = await fenceCachedWalletOperations(revision, token)
    let repaired: number
    try {
      repaired = await BiometricService.repairMalformedGenerationWithPassword(password, biometricContext(vault, revision, activeToken))
    } finally {
      if (current(revision, activeToken)) {
        activeToken = await fenceCachedWalletOperations(revision, activeToken)
      }
    }
    assertCurrent(revision, activeToken)
    biometricGeneration = repaired
    resetBiometricOperation()
    await synchronizeBiometric(vault, revision, activeToken)
    set(state => ({ biometric: { ...state.biometric, enabled: false, legacy: false } }))
    return {
      warning: 'Damaged biometric metadata was reset safely after password verification. This wallet remains protected by its password; enable Biometrics again later in Settings.',
      token: activeToken,
    }
  }
  const enrollBiometric = async (
    vault: WalletVault,
    password: string,
    revision: number,
    token: string | null,
    operationContextFactory?: () => BiometricContext,
    afterPersistedBiometric?: () => void,
  ) => {
    const context = operationContextFactory ?? (() => biometricContext(vault, revision, token))
    let result: BiometricEnrollmentResult | null = null
    let failure: unknown
    try {
      result = await BiometricService.enable(password, context())
    } catch (error) { failure = error }
    assertCurrent(revision, token)
    let persisted = await persistedBiometric(vault, revision, token)
    afterPersistedBiometric?.()
    if (failure instanceof BiometricMigrationError
      && (failure.code === 'BIOMETRIC_GENERATION_CHANGED' || failure.code === 'BIOMETRIC_SUPERSEDED')) throw failure
    if (!result?.verified) {
      throw new BiometricEnrollmentError(
        'Secure biometrics could not be enabled or verified. Your wallet was saved and remains protected by its password; unlock it and retry Biometrics in Settings.',
        false,
        persisted.legacy,
      )
    }
    // Once a credential was verified, cleanup retries use only the in-memory
    // envelope proof. They must not trigger repeated user-verification prompts.
    for (let cleanupAttempt = 0;
      result.cleanupProof && persisted.enabled && persisted.cleanupPending && cleanupAttempt < 2;
      cleanupAttempt += 1) {
      try {
        result = await BiometricService.retryCommittedPrfCleanup(
          password,
          result.cleanupProof,
          context(),
        )
      } catch (error) {
        if (error instanceof BiometricMigrationError
          && (error.code === 'BIOMETRIC_GENERATION_CHANGED' || error.code === 'BIOMETRIC_SUPERSEDED')) throw error
      }
      persisted = await persistedBiometric(vault, revision, token)
      afterPersistedBiometric?.()
    }
    if (persisted.enabled && !persisted.cleanupPending) return persisted
    if (persisted.enabled) throw new BiometricEnrollmentError('Secure biometrics were enrolled, but older biometric access could not be retired. Retry before relying on biometrics alone.', true, persisted.legacy)
    throw new BiometricEnrollmentError('Secure biometric persistence could not be verified. Your wallet remains protected by its password; retry Biometrics in Settings.', false, persisted.legacy)
  }
  const retireToPasswordOnly = async (vault: WalletVault, password: string, revision: number, token: string | null) => {
    await BiometricService.retireLegacyWithPassword(password, biometricContext(vault, revision, token))
    const persisted = await persistedBiometric(vault, revision, token)
    if (persisted.cleanupPending || persisted.legacy) throw new Error('Older biometric access could not be retired. Retry migration before unlocking.')
    return persisted
  }
  const migrateVerifiedPassword = async (vault: WalletVault, password: string, revision: number, token: string | null) => {
    const inspection = await BiometricService.inspect(biometricContext(vault, revision, token))
    assertCurrent(revision, token)
    if (!inspection.cleanupPending) {
      if (inspection.enabledMarker) {
        try {
          await BiometricService.removeHarmlessMarker(biometricContext(vault, revision, token))
          await persistedBiometric(vault, revision, token)
        } catch { /* A lone compatibility marker is harmless and must not block unlock. */ }
      }
      return { warning: null, token }
    }
    if (inspection.generationState === 'malformed') {
      throw new BiometricMigrationError('BIOMETRIC_GENERATION_MALFORMED', 'Biometric generation state must be reset with the verified wallet password.')
    }
    // Cached production bundles do not re-read PRF/legacy records after their
    // WebAuthn ceremony. Rotate the wallet-session token before retiring them.
    let activeToken = await fenceCachedWalletOperations(revision, token)
    const fenceCommittedCleanup = async () => {
      if (current(revision, activeToken)) {
        activeToken = await fenceCachedWalletOperations(revision, activeToken)
      }
    }
    if (inspection.cleanupIntent === 'password-only'
      || inspection.prfState === 'malformed'
      || inspection.journalState === 'malformed') {
      let persisted
      try {
        persisted = await retireToPasswordOnly(vault, password, revision, activeToken)
      } finally {
        await fenceCommittedCleanup()
      }
      return {
        warning: persisted.enabled
          ? null
          : 'Incomplete or damaged biometric state was retired safely. The wallet remains protected by its password; enable Biometrics again later in Settings.',
        token: activeToken,
      }
    }
    let enrollmentError: unknown = null
    try {
      await enrollBiometric(vault, password, revision, activeToken)
    } catch (error) {
      enrollmentError = error
    }
    await fenceCommittedCleanup()
    if (enrollmentError === null) return { warning: null, token: activeToken }
    if (enrollmentError instanceof BiometricMigrationError
      && (enrollmentError.code === 'BIOMETRIC_GENERATION_CHANGED' || enrollmentError.code === 'BIOMETRIC_SUPERSEDED')) throw enrollmentError
    let persisted
    try {
      persisted = await retireToPasswordOnly(vault, password, revision, activeToken)
    } catch (cleanupError) {
      throw new Error('Your password is valid, but older biometric access could not be retired safely. Retry before unlocking.', { cause: cleanupError })
    } finally {
      await fenceCommittedCleanup()
    }
    return {
      warning: persisted.enabled
        ? null
        : 'Older biometric access was retired safely, but secure biometric enrollment did not finish because it was cancelled or unavailable. The wallet remains protected by its password and Biometrics can be enabled later in Settings.',
      token: activeToken,
    }
  }
  const lockAfterBiometricFailure = async (vault: WalletVault, message: string, revision: number, token: string | null, verifiedEnabled = false, legacyOverride?: boolean) => {
    if (!current(revision, token)) return false
    let biometric = { enabled: false, legacy: false }
    try {
      const persisted = await persistedBiometric(vault, revision, token)
      biometric = { enabled: verifiedEnabled && persisted.enabled, legacy: legacyOverride ?? persisted.legacy }
    } catch {
      if (!current(revision, token)) return false
      biometric = { enabled: verifiedEnabled, legacy: legacyOverride ?? false }
    }
    if (!current(revision, token)) return false
    clearLegacyRecovery()
    set(state => ({
      status: 'locked', address: null, _privateKey: null, backupPhrase: null,
      vaultId: vault.id, vaultRevision: vault.revision, sessionExpiresAt: null, sessionStorageToken: null,
      sessionRevision: state.sessionRevision + 1,
      biometric: { ...state.biometric, ...biometric }, error: message,
    }))
    return true
  }
  const openWallet = (vault: WalletVault, mnemonic: string, token: string | null) => {
    clearLegacyRecovery()
    const wallet = WalletUtil.restoreFromMnemonic(mnemonic)
    if (vault.address && vault.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Recovery phrase does not match this wallet')
    set(state => ({ status: vault.backedUp ? 'unlocked' : 'backup', address: wallet.address, _privateKey: wallet.privateKey, backupPhrase: vault.backedUp ? null : mnemonic, vaultId: vault.id, vaultRevision: vault.revision, sessionRevision: state.sessionRevision + 1, sessionExpiresAt: Date.now() + SESSION_TIMEOUT_MS, sessionStorageToken: token, error: null }))
  }
  const openPersistedWallet = async (
    expected: WalletVault,
    mnemonic: string,
    revision: number,
    token: string | null,
    verify?: (record: WalletVaultRecord) => Promise<void>,
  ) => {
    const verifyAndOpen = async () => {
      assertCurrent(revision, token)
      const record = await WalletVaultService.inspect()
      if (!record || record.vault.id !== expected.id || record.vault.revision !== expected.revision
        || record.vault.encryptedMnemonic !== expected.encryptedMnemonic || record.vault.address !== expected.address) {
        throw new Error('The wallet changed before it could be opened. Reload it safely.')
      }
      await verify?.(record)
      assertCurrent(revision, token)
      openWallet(record.vault, mnemonic, token)
    }

    if (hasWalletMutationLock()) {
      await withWalletMutation(verifyAndOpen)
      return
    }

    // Current-code writes fail closed without Web Locks. A clean v2/outer-v2
    // wallet can therefore still perform the final read-only verification and
    // open on an older browser; raw promotion and cleanup already failed earlier.
    await verifyAndOpen()
  }
  const createOrImport = async (mnemonic: string, password: string, biometric: boolean, backedUp: boolean) => {
    if (mutationPending) throw new Error('Another wallet update is already running')
    validateNewPassword(password)
    const wallet = WalletUtil.restoreFromMnemonic(mnemonic)
    mutationPending = true
    let mutationAnnounced = false
    let vault: WalletVault | null = null
    let activeRevision = get().sessionRevision
    let activeToken: string | null = null
    let phase: 'persist' | 'enroll' | 'open' = 'persist'
    try {
      const orphaned = await BiometricService.inspect()
      const sensitiveResidue = orphaned.prfState !== 'absent'
        || orphaned.legacyState !== 'absent'
        || orphaned.journalState !== 'absent'
        || orphaned.generationState !== 'absent'
      if (sensitiveResidue) {
        await BiometricService.cleanupOrphanedState()
      } else if (orphaned.enabledMarker) {
        try { await BiometricService.cleanupOrphanedState() } catch { /* A marker alone cannot authorize wallet access. */ }
      }
      await withWalletMutation(async scope => {
        if (await WalletVaultService.read(scope)) throw new Error('A wallet already exists. Unlock it or explicitly delete it first.')
        const confirmedOrphaned = await BiometricService.inspect()
        if (confirmedOrphaned.prfState !== 'absent'
          || confirmedOrphaned.legacyState !== 'absent'
          || confirmedOrphaned.journalState !== 'absent'
          || confirmedOrphaned.generationState !== 'absent') {
          throw new Error('Older biometric residue must be removed before creating or importing a wallet.')
        }
        biometricGeneration = 0
        resetBiometricOperation()
        const revision = get().sessionRevision
        const token = await fenceCachedWalletOperations(revision, readWalletSessionToken())
        mutationAnnounced = true
        vault = await WalletVaultService.create(mnemonic, wallet.address, password, backedUp, scope)
        assertCurrent(revision, token)
        const committedToken = await fenceCachedWalletOperations(revision, token)
        assertCurrent(revision, committedToken)
        activeRevision = revision
        activeToken = committedToken
      })
      if (!vault) throw new Error('Wallet persistence did not return the saved wallet')
      if (biometric) {
        phase = 'enroll'
        await enrollBiometric(vault, password, activeRevision, activeToken)
      }
      phase = 'open'
      await openPersistedWallet(vault, mnemonic, activeRevision, activeToken)
      if (biometric) set(state => ({ biometric: { ...state.biometric, enabled: true, legacy: false }, error: null }))
      return wallet
    } catch (error) {
      if (vault && phase === 'enroll') {
        const message = error instanceof Error ? error.message : 'Secure biometrics could not be enabled. Unlock with your password and retry in Settings.'
        const enrollment = error instanceof BiometricEnrollmentError ? error : null
        await lockAfterBiometricFailure(vault, message, activeRevision, activeToken, enrollment?.verifiedEnabled, enrollment?.legacy)
        throw new Error(message, { cause: error })
      }
      // A write may have succeeded before read-back failed. Never leave create
      // controls active after an uncertain persistence result.
      storageFailure(error)
      if (mutationAnnounced) await notifyFailedMutation()
      throw error
    } finally { mutationPending = false }
  }

  return {
    status: 'loading', address: null, error: null, _privateKey: null, backupPhrase: null,
    vaultId: null, vaultRevision: 0, sessionRevision: 0, sessionExpiresAt: null, sessionStorageToken: null,
    biometric: { type: 'none', enabled: false, available: false, legacy: false },

    initialize: async () => {
      // Removal is idempotent and intentionally retried on later initialization
      // if a previous best-effort Preferences operation stalled or failed.
      void DeviceService.getInstance().cleanupObsoleteIdentifier().catch(() => undefined)
      if (!initializedEvents) {
        initializedEvents = true
        subscribeWalletInvalidation(() => {
          invalidate()
          void get().initialize()
        })
        subscribeBiometricGeneration(event => {
          if (event.walletId !== get().vaultId) return
          const vaultId = get().vaultId
          const revision = get().sessionRevision
          let token: string | null
          try { token = readWalletSessionToken() } catch { return }
          // Broadcast/storage events are hints and may arrive out of order. Only
          // the double-checked persisted generation may revoke live operations.
          void WalletVaultService.read().then(async vault => {
            if (!vault || vault.id !== vaultId || !current(revision, token)) return
            const before = biometricGeneration
            await synchronizeBiometric(vault, revision, token)
            if (biometricGeneration !== before) clearLegacyRecovery()
          }).catch(() => undefined)
        })
      }
      if (get().status === 'unlocked' || get().status === 'backup') return
      const revision = get().sessionRevision
      try {
        const token = readWalletSessionToken()
        const vault = await WalletVaultService.read()
        const { generationMalformed, onboardingBlocked, ...biometric } = await readBiometric(vault, revision, token)
        assertCurrent(revision, token)
        set({
          status: onboardingBlocked ? 'error' : vault ? 'locked' : 'no_wallet',
          vaultId: vault?.id ?? null,
          vaultRevision: vault?.revision ?? 0,
          biometric,
          error: onboardingBlocked
            ? 'Older biometric residue could not be removed safely. Retry before creating or importing a wallet.'
            : generationMalformed
              ? 'Biometric metadata is damaged. Try Biometrics to repair a matching credential safely, or unlock with your password to reset biometric access.'
              : null,
        })
      } catch (error) {
        if (get().sessionRevision === revision) storageFailure(error)
      }
    },

    createWallet: async (password, biometric) => {
      const mnemonic = WalletUtil.generateWallet().mnemonic
      const wallet = await createOrImport(mnemonic, password, biometric, false)
      return { mnemonic, address: wallet.address }
    },
    importWallet: async (mnemonic, password, biometric) => {
      const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!WalletUtil.isValidMnemonic(normalized)) throw new Error('Invalid recovery phrase')
      const wallet = await createOrImport(normalized, password, biometric, true)
      return { address: wallet.address }
    },

    checkPassword: async password => {
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      try {
        return (await verifyPassword(password, revision, token))?.mnemonic ?? false
      } catch (error) {
        if (get().sessionRevision === revision) storageFailure(error)
        if (isWalletVaultCorruptionError(error)) throw error
        return false
      }
    },

    unlockWithPassword: async password => {
      if (unlockPending) return false
      unlockPending = true
      const revision = get().sessionRevision
      let token = readWalletSessionToken()
      try {
        const verified = await verifyPassword(password, revision, token)
        if (!verified) return false
        let vault = verified.record.vault
        if (verified.record.source === 'raw-v1' && !hasWalletMutationLock()) {
          await openPersistedWallet(vault, verified.mnemonic, revision, token)
          set({ error: 'Wallet opened in read-only recovery mode. Update this browser to finish secure migration and enable wallet changes.' })
          return verified.mnemonic
        }
        if (verified.record.source === 'raw-v1') {
          vault = await withWalletMutation(async () => {
            assertCurrent(revision, token)
            return WalletVaultService.promoteLegacy(verified.record, password, verified.mnemonic)
          })
          assertCurrent(revision, token)
        }
        const generationRepair = await repairMalformedBiometricGeneration(vault, password, revision, token)
        token = generationRepair.token
        const migration = await migrateVerifiedPassword(vault, password, revision, token)
        token = migration.token
        const warning = [generationRepair.warning, migration.warning].filter((value): value is string => value !== null).join(' ') || null
        await openPersistedWallet(vault, verified.mnemonic, revision, token, async currentRecord => {
          const inspection = await BiometricService.inspect(biometricContext(currentRecord.vault, revision, token))
          assertCurrent(revision, token)
          if (inspection.cleanupPending) throw new Error('Biometric migration is still pending. Retry before unlocking this wallet.')
        })
        if (warning) set({ error: warning })
        return verified.mnemonic
      } catch (error) {
        if (get().sessionRevision === revision) set({ error: error instanceof Error ? error.message : 'Wallet changed or could not be unlocked. Retry.' })
        throw error
      } finally { unlockPending = false }
    },

    unlockWallet: async mnemonic => {
      if (unlockPending) return false
      unlockPending = true
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      try {
        const record = await WalletVaultService.inspect()
        assertCurrent(revision, token)
        if (!record || record.vault.id !== get().vaultId || record.vault.revision !== get().vaultRevision) throw new Error('The wallet changed in another tab. Reload it safely.')
        await synchronizeBiometric(record.vault, revision, token)
        const biometric = await BiometricService.inspect(biometricContext(record.vault, revision, token))
        assertCurrent(revision, token)
        if (record.source === 'raw-v1' || !record.vault.address || biometric.cleanupPending) throw new Error('A verified password migration must finish before mnemonic-only unlock can open this wallet.')
        await openPersistedWallet(record.vault, mnemonic, revision, token, async currentRecord => {
          if (currentRecord.source === 'raw-v1' || !currentRecord.vault.address) {
            throw new Error('A verified password migration must finish before mnemonic-only unlock can open this wallet.')
          }
          const currentBiometric = await BiometricService.inspect(biometricContext(currentRecord.vault, revision, token))
          assertCurrent(revision, token)
          if (currentBiometric.cleanupPending) throw new Error('Biometric migration is still pending. Retry before unlocking this wallet.')
        })
        return true
      } catch (error) {
        if (get().sessionRevision === revision) set({ error: error instanceof Error ? error.message : 'Wallet changed or could not be unlocked. Retry.' })
        return false
      } finally { unlockPending = false }
    },

    unlockWithBiometric: async () => {
      if (unlockPending) throw new Error('Another wallet unlock is already running. Retry.')
      unlockPending = true
      const revision = get().sessionRevision
      let token = readWalletSessionToken()
      try {
        if (!hasWalletMutationLock()) {
          throw new Error('This browser cannot safely use Biometrics across tabs. Update it or unlock with your password.')
        }
        const initialRecord = await WalletVaultService.inspect()
        assertCurrent(revision, token)
        if (!initialRecord || initialRecord.vault.id !== get().vaultId || initialRecord.vault.revision !== get().vaultRevision) {
          throw new Error('The wallet changed in another tab. Reload it safely.')
        }
        let synchronized
        try {
          synchronized = await synchronizeBiometric(initialRecord.vault, revision, token)
        } catch (error) {
          if (error instanceof BiometricMigrationError && error.code === 'BIOMETRIC_GENERATION_MALFORMED') {
            return await repairMalformedBiometricGenerationWithBiometric(initialRecord, revision, token)
          }
          throw error
        }
        if (synchronized.cleanupPending) {
          token = await fenceCachedWalletOperations(revision, token)
        }
        const authentication = await (async () => {
          try {
            return await BiometricService.authenticate(biometricContext(initialRecord.vault, revision, token))
          } finally {
            if (synchronized.cleanupPending && current(revision, token)) {
              token = await fenceCachedWalletOperations(revision, token)
            }
          }
        })()
        assertCurrent(revision, token)
        if (!authentication.success) throw new Error('Secure biometric authentication failed. Use your password.')
        const persisted = await persistedBiometric(initialRecord.vault, revision, token)
        if (!persisted.enabled || persisted.cleanupPending) {
          throw new BiometricMigrationError('BIOMETRIC_SUPERSEDED', 'Biometric access was disabled or changed before the wallet could open. Retry or use your password.')
        }

        let mnemonic = ''
        await withWalletMutation(async scope => {
          assertCurrent(revision, token)
          const record = await WalletVaultService.inspect()
          if (!record || record.vault.id !== initialRecord.vault.id || record.vault.revision !== initialRecord.vault.revision) {
            throw new Error('The wallet changed before biometric unlock could finish.')
          }
          await BiometricService.verifyAuthenticationWithinWalletMutation(
            scope,
            authentication.proof,
            biometricContext(record.vault, revision, token),
          )
          const decrypted = await WalletVaultService.decrypt(record.vault, authentication.password)
          if (!decrypted) throw new BiometricMigrationError('BIOMETRIC_WRONG_CREDENTIAL', 'The biometric credential no longer decrypts this wallet.')
          const wallet = WalletUtil.restoreFromMnemonic(decrypted)
          if (record.vault.address && wallet.address.toLowerCase() !== record.vault.address.toLowerCase()) {
            throw new BiometricMigrationError('BIOMETRIC_WRONG_CREDENTIAL', 'The biometric credential belongs to a different wallet.')
          }
          const vault = record.source === 'raw-v1'
            ? await WalletVaultService.promoteLegacy(record, authentication.password, decrypted)
            : record.vault
          assertCurrent(revision, token)
          openWallet(vault, decrypted, token)
          mnemonic = decrypted
        })
        return { password: authentication.password, mnemonic }
      } catch (error) {
        if (get().sessionRevision === revision) set({ error: error instanceof Error ? error.message : 'Biometric authentication failed. Use your password.' })
        throw error
      } finally { unlockPending = false }
    },
    lockWallet: invalidateGlobally,

    resetWallet: async password => {
      const targetId = get().vaultId
      const targetRevision = get().vaultRevision
      const operationRevision = get().sessionRevision
      let operationToken = readWalletSessionToken()
      if (mutationPending) throw new Error('Another wallet update is running. Retry deletion.')
      mutationPending = true
      const deletion = {
        started: false,
        seedOutcome: 'present' as 'present' | 'absent' | 'unknown',
      }
      try {
        await withWalletMutation(async scope => {
          assertCurrent(operationRevision, operationToken)
          const targetRecord = await WalletVaultService.inspect()
          const target = targetRecord?.vault
          if (!target || target.id !== targetId || target.revision !== targetRevision) {
            throw new Error('Wallet changed. Confirm deletion again.')
          }
          const mnemonic = await WalletVaultService.decrypt(target, password)
          if (!mnemonic) throw new Error('Incorrect password')
          let authorizedAddress: string
          try { authorizedAddress = WalletUtil.restoreFromMnemonic(mnemonic).address } catch {
            throw new Error('Stored recovery phrase could not authorize wallet deletion.')
          }
          if (target.address && authorizedAddress.toLowerCase() !== target.address.toLowerCase()) {
            throw new Error('Wallet identity verification failed. Deletion was not authorized.')
          }

          // Session tokens and Web Locks are invisible to cached production
          // bundles. Before changing any credential or seed, require the active
          // worker to attest every same-origin window or force it through the
          // current cache. The gate is bounded and fails without persistent
          // mutation, so password/mnemonic access remains available.
          await prepareWalletResetBarrier()
          const attestedTarget = await WalletVaultService.inspect()
          if (!attestedTarget
            || attestedTarget.vault.id !== target.id
            || attestedTarget.vault.revision !== target.revision
            || attestedTarget.vault.address !== target.address
            || attestedTarget.vault.backedUp !== target.backedUp
            || attestedTarget.vault.encryptedMnemonic !== target.encryptedMnemonic) {
            // Never overwrite a ciphertext committed by a legacy client. It may
            // be a replacement wallet; preserve it and require explicit review.
            throw new Error('Wallet data changed while open app windows were updating. Nothing was deleted; reload and confirm the active wallet.')
          }
          assertCurrent(operationRevision, operationToken)

          // Fence current sessions, then make both old biometric formats
          // unreadable before the irreversible seed commit. If preparation
          // fails, the seed remains available through the verified password.
          operationToken = await fenceCachedWalletOperations(operationRevision, operationToken)
          await BiometricService.prepareWalletDeletionWithinWalletMutation(
            scope,
            biometricContext(target, operationRevision, operationToken),
          )
          // A cached bundle may begin a legacy assertion after the first fence
          // but before the durable tombstones. Rotate again after commit so it
          // cannot finish with the token it captured in that interval.
          operationToken = await fenceCachedWalletOperations(operationRevision, operationToken)
          invalidate()
          deletion.started = true
          deletion.seedOutcome = 'unknown'

          // The encrypted seed is authoritative. Delete it before ancillary
          // credentials/metadata so a crash never reports an intact wallet as deleted.
          await getStorage().remove(STORAGE_MNEMONIC_KEY)
          if (await getStorage().exists(STORAGE_MNEMONIC_KEY)) {
            deletion.seedOutcome = 'present'
            throw new Error('Wallet deletion verification failed')
          }
          deletion.seedOutcome = 'absent'

          const warnings: string[] = []
          try { await BiometricService.cleanupOrphanedStateWithinWalletMutation(scope) } catch {
            warnings.push('Biometric cleanup is pending and will retry before another wallet can be added.')
          }
          try { await WalletVaultService.removeMetadataAfterSeedDeletion(scope) } catch {
            warnings.push('Wallet metadata cleanup is pending and will retry before another wallet can be added.')
          }
          try {
            const finalToken = await publishGlobalWalletInvalidation()
            if (typeof window !== 'undefined' && 'localStorage' in window && finalToken === null) {
              throw new Error('Missing invalidation token')
            }
          } catch {
            warnings.push('Other tabs could not be notified after deletion. Close any other wallet tabs.')
          }

          biometricGeneration = 0
          resetBiometricOperation()
          set({
            status: 'no_wallet', vaultId: null, vaultRevision: 0,
            error: warnings.join(' ') || null,
            biometric: { type: get().biometric.type, available: get().biometric.available, enabled: false, legacy: false },
          })
        })
      } catch (error) {
        if (isWalletVaultCorruptionError(error)) {
          storageFailure(error)
        } else if (deletion.started && deletion.seedOutcome !== 'absent') {
          invalidate()
          set({
            status: 'error',
            error: deletion.seedOutcome === 'present'
              ? 'Wallet deletion did not finish. The encrypted seed remains; retry with your password.'
              : 'Wallet deletion could not be verified. Do not create or import another wallet; reload and retry recovery checks.',
          })
          await notifyFailedMutation()
        }
        throw error
      } finally { mutationPending = false }
    },

    backupWallet: async () => {
      const revision = get().sessionRevision
      let token = readWalletSessionToken()
      try {
        await withWalletMutation(async () => {
          const vault = await readCurrentVault(revision, token)
          if (get().status !== 'backup' || !get().address) throw new Error('Unlock the wallet to finish backup')
          token = await fenceCachedWalletOperations(revision, token)
          await WalletVaultService.write({ ...vault, address: get().address, backedUp: true })
          token = await fenceCachedWalletOperations(revision, token)
          set({ status: 'unlocked', backupPhrase: null, error: null })
        })
      } catch (error) {
        if (current(revision, token)) set({ error: 'Backup confirmation could not be saved. Retry before continuing.' })
        throw error
      }
    },

    getPrivateKey: () => get().checkSessionDeadline() ? get()._privateKey : null,
    getPrivateKeyForSnapshot: snapshot => {
      if (!get().isSessionCurrent(snapshot)) return null
      const privateKey = get()._privateKey
      if (!privateKey || privateKey.getAddress().toLowerCase() !== snapshot!.address.toLowerCase()) return null
      return privateKey
    },
    getSessionSnapshot: () => {
      if (get().status !== 'unlocked' || !get().checkSessionDeadline() || !get().vaultId || !get().address) return null
      try {
        return {
          revision: get().sessionRevision,
          vaultId: get().vaultId!,
          vaultRevision: get().vaultRevision,
          address: get().address!.toLowerCase(),
          storageToken: readWalletSessionToken(),
        }
      } catch { invalidate(); return null }
    },
    isSessionCurrent: snapshot => !!snapshot && get().status === 'unlocked' && get().checkSessionDeadline() &&
      current(snapshot.revision, snapshot.storageToken) && get().vaultId === snapshot.vaultId &&
      get().vaultRevision === snapshot.vaultRevision && get().address?.toLowerCase() === snapshot.address.toLowerCase(),
    checkSessionDeadline: () => {
      const deadline = get().sessionExpiresAt
      if ((get().status !== 'unlocked' && get().status !== 'backup') || deadline === null) return false
      try {
        if (readWalletSessionToken() !== get().sessionStorageToken) { invalidate(); return false }
      } catch { invalidate(); return false }
      if (Date.now() >= deadline) { invalidate(); return false }
      return true
    },
    touchSession: () => { if (get().checkSessionDeadline()) set({ sessionExpiresAt: Date.now() + SESSION_TIMEOUT_MS }) },
    clearError: () => set({ error: null }),

    toggleBiometric: async (value, password) => {
      const revision = get().sessionRevision
      let token = readWalletSessionToken()
      const verified = await verifyPassword(password, revision, token)
      if (!verified) throw new Error('Invalid password')
      const vault = verified.record.vault
      const synchronized = await synchronizeBiometric(vault, revision, token)
      if (!value || synchronized.cleanupPending) {
        token = await fenceCachedWalletOperations(revision, token)
      }
      if (value) {
        // Enrollment performs another vault/password verification inside its
        // wallet mutation before committing a credential.
        try {
          await enrollBiometric(vault, password, revision, token)
        } finally {
          if (synchronized.cleanupPending && current(revision, token)) {
            token = await fenceCachedWalletOperations(revision, token)
          }
        }
      } else {
        try {
          await withWalletMutation(async scope => {
            assertCurrent(revision, token)
            const currentRecord = await WalletVaultService.inspect()
            if (!currentRecord || currentRecord.vault.id !== vault.id || currentRecord.vault.revision !== vault.revision
              || await WalletVaultService.decrypt(currentRecord.vault, password) !== verified.mnemonic) {
              throw new Error('Wallet changed before biometric removal. Retry.')
            }
            await BiometricService.disableWithinWalletMutation(scope, biometricContext(currentRecord.vault, revision, token))
          })
        } finally {
          if (current(revision, token)) {
            token = await fenceCachedWalletOperations(revision, token)
          }
        }
        const persisted = await persistedBiometric(vault, revision, token)
        if (persisted.enabled || persisted.cleanupPending) throw new Error('Biometric removal could not be verified. Retry before assuming it is disabled.')
      }
      assertCurrent(revision, token)
      set(state => ({ biometric: { ...state.biometric, enabled: value, legacy: false } }))
    },

    retireLegacyWithPassword: async password => {
      const revision = get().sessionRevision
      let token = readWalletSessionToken()
      if (!await verifyPassword(password, revision, token)) throw new Error('Invalid password')
      const vault = await readCurrentVault(revision, token)
      const persisted = await persistedBiometric(vault, revision, token)
      if (!persisted.cleanupPending) return null
      token = await fenceCachedWalletOperations(revision, token)
      try {
        await retireToPasswordOnly(vault, password, revision, token)
      } finally {
        if (current(revision, token)) {
          await fenceCachedWalletOperations(revision, token)
        }
      }
      const warning = 'Older biometric access was retired safely. The wallet remains protected by its password; enable secure Biometrics later in Settings if wanted.'
      set({ error: warning })
      return warning
    },
    cancelLegacyRecovery: () => {
      // Cancellation only revokes an unredeemed ticket. A completion winner owns
      // a separate operation snapshot and must run to a typed outcome.
      clearLegacyRecovery()
      resetBiometricOperation()
    },
    recoverLegacyAccess: async () => {
      if (activeLegacyRecoveryOperation) {
        throw new Error('A legacy recovery password replacement is already running. Wait for its result.')
      }
      clearLegacyRecovery()
      resetBiometricOperation()
      const ticketId = createUuid(window.crypto)
      activeLegacyRecoveryTicketId = ticketId
      const assertAttempt = () => {
        if (activeLegacyRecoveryTicketId !== ticketId) throw new Error('Legacy recovery was cancelled')
      }
      try {
        const revision = get().sessionRevision
        const token = readWalletSessionToken()
        const initial = await WalletVaultService.inspect()
        assertCurrent(revision, token)
        assertAttempt()
        if (!initial || initial.vault.id !== get().vaultId || initial.vault.revision !== get().vaultRevision) {
          throw new Error('The wallet changed in another tab. Reload it safely.')
        }
        await synchronizeBiometric(initial.vault, revision, token)
        assertAttempt()
        const generation = biometricGeneration
        const password = await BiometricService.recoverLegacyForMigration(biometricContext(initial.vault, revision, token))
        assertAttempt()
        const confirmed = await WalletVaultService.inspect()
        assertCurrent(revision, token)
        assertAttempt()
        if (!confirmed || confirmed.source !== initial.source
          || confirmed.vault.id !== initial.vault.id
          || confirmed.vault.revision !== initial.vault.revision
          || confirmed.vault.address !== initial.vault.address
          || confirmed.vault.encryptedMnemonic !== initial.vault.encryptedMnemonic
          || confirmed.vault.backedUp !== initial.vault.backedUp) {
          throw new Error('The wallet changed during legacy recovery. Verify again.')
        }
        const mnemonic = await WalletVaultService.decrypt(confirmed.vault, password)
        assertAttempt()
        const confirmedGeneration = await BiometricService.getGeneration(confirmed.vault.id)
        assertCurrent(revision, token)
        assertAttempt()
        if (confirmedGeneration !== generation || biometricGeneration !== generation) {
          biometricGeneration = confirmedGeneration
          resetBiometricOperation()
          throw new BiometricMigrationError('BIOMETRIC_GENERATION_CHANGED', 'Biometric settings changed during legacy recovery. Verify again.')
        }
        if (!mnemonic || !WalletUtil.isValidMnemonic(mnemonic)) {
          throw new Error('Legacy access cannot decrypt this wallet. Use your recovery phrase.')
        }
        const derivedAddress = WalletUtil.restoreFromMnemonic(mnemonic).address
        if (confirmed.vault.address && confirmed.vault.address.toLowerCase() !== derivedAddress.toLowerCase()) {
          throw new Error('Legacy access belongs to a different wallet. Use your password or recovery phrase.')
        }
        const expiresAt = Date.now() + SESSION_TIMEOUT_MS
        legacyRecoveryAuthorities.set(ticketId, {
          state: 'issued',
          expiresAt,
          vaultId: confirmed.vault.id,
          vaultRevision: confirmed.vault.revision,
          biometricGeneration: generation,
          sessionRevision: revision,
          storageToken: token,
          identity: {
            source: confirmed.source,
            id: confirmed.vault.id,
            revision: confirmed.vault.revision,
            address: confirmed.vault.address,
            encryptedMnemonic: confirmed.vault.encryptedMnemonic,
            backedUp: confirmed.vault.backedUp,
          },
          password,
          mnemonic,
        })
        return Object.freeze({ ticketId, expiresAt })
      } catch (error) {
        const authority = legacyRecoveryAuthorities.get(ticketId)
        if (authority) clearLegacyRecovery(ticketId, authority)
        else if (activeLegacyRecoveryTicketId === ticketId) activeLegacyRecoveryTicketId = null
        throw error
      }
    },
    completeLegacyRecovery: async (recovery, newPassword) => {
      try {
        validateNewPassword(newPassword)
      } catch (error) {
        throw new LegacyRecoveryCompletionError(
          'PASSWORD_INVALID',
          error instanceof Error ? error.message : 'Choose a valid new password.',
          false,
          'not-started',
          'edit-password',
          { cause: error },
        )
      }
      const ticketId = typeof recovery?.ticketId === 'string' ? recovery.ticketId : ''
      if (activeLegacyRecoveryOperation) {
        throw new LegacyRecoveryCompletionError('DUPLICATE', 'This legacy recovery is already being completed. Wait for its result.', false, 'not-started', 'verify-again')
      }
      const authority = legacyRecoveryAuthorities.get(ticketId)
      if (!authority || activeLegacyRecoveryTicketId !== ticketId || authority.state !== 'issued') {
        throw new LegacyRecoveryCompletionError('AUTHORITY_UNAVAILABLE', 'Legacy recovery verification expired or was cancelled. Verify again.', false, 'not-started', 'verify-again')
      }
      if (!Number.isFinite(authority.expiresAt) || Date.now() >= authority.expiresAt) {
        clearLegacyRecovery(ticketId, authority)
        throw new LegacyRecoveryCompletionError('AUTHORITY_UNAVAILABLE', 'Legacy recovery verification expired or was cancelled. Verify again.', false, 'not-started', 'verify-again')
      }

      // Redemption deliberately has no await: cancellation/unmount may revoke an
      // issued ticket, but cannot steal this operation's copied authority.
      const operation: LegacyRecoveryOperation = {
        state: 'redeeming',
        id: createUuid(window.crypto),
        vaultId: authority.vaultId,
        vaultRevision: authority.vaultRevision,
        biometricGeneration: authority.biometricGeneration,
        sessionRevision: authority.sessionRevision,
        storageToken: authority.storageToken,
        identity: authority.identity,
        password: authority.password,
        mnemonic: authority.mnemonic,
        invalidated: false,
        biometricAbort: new AbortController(),
      }
      authority.state = 'removed'
      authority.password = ''
      authority.mnemonic = ''
      legacyRecoveryAuthorities.delete(ticketId)
      activeLegacyRecoveryTicketId = null
      activeLegacyRecoveryOperation = operation

      let replacementPassword = newPassword
      let mutationAnnounced = false
      let replacementWriteStarted = false
      let replacementReadbackVerified = false
      let updated: WalletVault | null = null
      let phase: 'persist' | 'enroll' | 'open' = 'persist'
      const assertOperation = () => {
        if (activeLegacyRecoveryOperation !== operation || operation.state !== 'redeeming' || operation.invalidated) {
          throw new Error('Legacy recovery session changed. Verify again.')
        }
        assertCurrent(operation.sessionRevision, operation.storageToken)
        if (get().vaultId !== operation.vaultId || get().vaultRevision !== operation.vaultRevision) {
          throw new Error('The wallet changed after legacy verification. Verify again.')
        }
        if (biometricGeneration !== operation.biometricGeneration) {
          throw new BiometricMigrationError('BIOMETRIC_GENERATION_CHANGED', 'Biometric settings changed after legacy verification. Verify again.')
        }
      }
      const assertOperationGeneration = async () => {
        assertOperation()
        const persisted = await BiometricService.getGeneration(operation.vaultId)
        assertOperation()
        if (persisted !== operation.biometricGeneration) {
          biometricGeneration = persisted
          resetBiometricOperation()
          throw new BiometricMigrationError('BIOMETRIC_GENERATION_CHANGED', 'Biometric settings changed after legacy verification. Verify again.')
        }
      }
      try {
        await assertOperationGeneration()
        await withWalletMutation(async scope => {
          await assertOperationGeneration()
          const record = await WalletVaultService.inspect()
          assertOperation()
          // No journal, tombstone, generation, or biometric rewrite may happen
          // until the entire authoritative record still matches issuance.
          if (!record || !sameLegacyRecoveryIdentity(operation.identity, record)) {
            throw new Error('The wallet changed after legacy verification. Verify again.')
          }
          const recoveredMnemonic = await WalletVaultService.decrypt(record.vault, operation.password)
          assertOperation()
          if (recoveredMnemonic !== operation.mnemonic) {
            throw new Error('Legacy recovery password authority no longer matches this wallet. Verify again.')
          }
          let derivedAddress: string
          try { derivedAddress = WalletUtil.restoreFromMnemonic(recoveredMnemonic).address } catch {
            throw new Error('Stored recovery phrase is invalid. Verify again.')
          }
          if (record.vault.address && record.vault.address.toLowerCase() !== derivedAddress.toLowerCase()) {
            throw new Error('Wallet identity changed after legacy verification. Verify again.')
          }
          const biometric = await BiometricService.inspect(recoveryBiometricContext(record.vault, operation))
          assertOperation()
          if (biometric.legacyRecoveryBlocked) {
            throw new BiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Biometric retirement or a committed migration appeared after legacy verification. Use your password or recovery phrase.')
          }
          await assertOperationGeneration()
          updated = {
            ...record.vault,
            // A bound v2/sidecar address is authoritative byte-for-byte.
            address: record.vault.address ?? derivedAddress,
            revision: record.vault.revision + 1,
            encryptedMnemonic: await CryptoUtil.encrypt(operation.mnemonic, replacementPassword),
          }
          await assertOperationGeneration()

          await BiometricService.prepareLegacyRecoveryPasswordReplacementWithinWalletMutation(
            scope,
            recoveryBiometricContext(record.vault, operation),
          )
          await assertOperationGeneration()
          operation.storageToken = await fenceCachedWalletOperations(operation.sessionRevision, operation.storageToken)
          mutationAnnounced = true
          assertOperation()

          replacementWriteStarted = true
          await WalletVaultService.write(updated)
          const saved = await WalletVaultService.read()
          if (!saved
            || saved.version !== updated.version
            || saved.id !== updated.id
            || saved.revision !== updated.revision
            || saved.address !== updated.address
            || saved.encryptedMnemonic !== updated.encryptedMnemonic
            || saved.backedUp !== updated.backedUp) {
            throw new Error('New password persistence could not be verified. Keep the new password and retry.')
          }
          const savedMnemonic = await WalletVaultService.decrypt(saved, replacementPassword)
          assertOperation()
          if (savedMnemonic !== operation.mnemonic) {
            throw new Error('New password persistence could not be verified. Keep the new password and retry.')
          }
          replacementReadbackVerified = true
          // The old password has no remaining ownership after the new vault's
          // exact decrypt-readback. Drop this single private reference early.
          operation.password = ''
          operation.storageToken = await fenceCachedWalletOperations(operation.sessionRevision, operation.storageToken)
          assertOperation()
        })
        if (!updated) throw new Error('Recovery upgrade did not return the saved wallet')
        const committedVault = updated
        phase = 'enroll'
        await BiometricService.markPasswordCommitted(replacementPassword, recoveryBiometricContext(committedVault, operation))
        await persistedBiometric(updated, operation.sessionRevision, operation.storageToken)
        // markPasswordCommitted owns a generation increment; subsequent
        // operation-owned biometric calls must use that committed generation.
        operation.biometricGeneration = biometricGeneration
        let warning: string | null = null
        try {
          await enrollBiometric(
            updated,
            replacementPassword,
            operation.sessionRevision,
            operation.storageToken,
            () => recoveryBiometricContext(committedVault, operation),
            () => { operation.biometricGeneration = biometricGeneration },
          )
        } catch (enrollmentError) {
          if (enrollmentError instanceof BiometricMigrationError
            && (enrollmentError.code === 'BIOMETRIC_GENERATION_CHANGED' || enrollmentError.code === 'BIOMETRIC_SUPERSEDED')) {
            throw new Error('Your new password is saved, but biometric settings changed in another tab. Unlock with the new password and retry migration.', { cause: enrollmentError })
          }
          try {
            await retireToPasswordOnly(updated, replacementPassword, operation.sessionRevision, operation.storageToken)
            warning = 'Your new password is saved and older biometric access was retired. Secure biometric enrollment was cancelled or unavailable; enable it later in Settings.'
          } catch (cleanupError) {
            throw new Error('Your wallet password was upgraded and saved, but older biometric cleanup did not finish. Unlock with the new password and retry migration.', { cause: cleanupError })
          }
        }
        const persisted = await persistedBiometric(updated, operation.sessionRevision, operation.storageToken)
        operation.biometricGeneration = biometricGeneration
        if (persisted.cleanupPending) {
          throw new Error('Your new password is saved, but biometric migration is still pending. Unlock with the new password and retry migration.')
        }
        phase = 'open'
        operation.storageToken = await fenceCachedWalletOperations(operation.sessionRevision, operation.storageToken)
        assertOperation()
        let finalPersisted = persisted
        await openPersistedWallet(updated, operation.mnemonic, operation.sessionRevision, operation.storageToken, async currentRecord => {
          finalPersisted = await persistedBiometric(currentRecord.vault, operation.sessionRevision, operation.storageToken)
          if (finalPersisted.cleanupPending) {
            throw new Error('Your new password is saved, but biometric migration is still pending. Unlock with the new password and retry migration.')
          }
        })
        set(state => ({ biometric: { ...state.biometric, enabled: finalPersisted.enabled, legacy: false }, error: warning }))
        return { completed: true, authorityConsumed: true, passwordCommit: 'verified', nextAction: 'unlock-with-new-password' }
      } catch (error) {
        if (isWalletVaultCorruptionError(error)) {
          storageFailure(error)
          throw error
        }
        if (replacementReadbackVerified && updated) {
          const message = phase === 'open'
            ? 'Your new password is saved, but the wallet changed before it could be opened. Reload and unlock with the new password.'
            : 'Your wallet password was upgraded, but biometric migration did not finish. Unlock with the new password and retry in Settings.'
          const persisted = await persistedBiometric(updated, operation.sessionRevision, operation.storageToken).catch(() => ({ enabled: false, legacy: true, cleanupPending: true }))
          const locked = await lockAfterBiometricFailure(updated, message, operation.sessionRevision, operation.storageToken, persisted.enabled, persisted.legacy)
          if (locked && mutationAnnounced) await notifyFailedMutation()
          throw new LegacyRecoveryCompletionError('POSTCOMMIT_FAILED', message, true, 'verified', 'unlock-with-new-password', { cause: error })
        }
        if (!replacementWriteStarted) {
          const detail = error instanceof Error ? error.message : 'Recovery preparation could not finish.'
          set({ error: `${detail} The wallet ciphertext was not changed; unlock with the old password to finish cleanup or retry recovery.` })
          throw new LegacyRecoveryCompletionError('PRECOMMIT_FAILED', detail, true, 'not-started', 'verify-again', { cause: error })
        }
        storageFailure(error)
        const message = 'Recovery upgrade could not finish. Keep the new password, reload the wallet, and check it before retrying.'
        set({ error: message })
        if (mutationAnnounced) await notifyFailedMutation()
        throw new LegacyRecoveryCompletionError('COMMIT_UNCERTAIN', message, true, 'uncertain', 'reload-and-check-new-password', { cause: error })
      } finally {
        replacementPassword = ''
        releaseLegacyRecoveryOperation(operation)
      }
    },
  }
}))
