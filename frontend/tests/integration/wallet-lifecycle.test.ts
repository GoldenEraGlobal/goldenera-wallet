import { beforeEach, describe, expect, it, vi } from 'vitest'
import golden from '../fixtures/crypto-v0.2.0.json'
import previousV2 from '../fixtures/vault-v2-before-ts7.json'
import { CryptoUtil, bufferToHex } from '../../packages/core/src/utils/CryptoUtil'

const environment = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  basic: new Map<string, string>(),
  failKeys: false,
  failRemove: false,
  readGate: null as Promise<void> | null,
  failWrite: false,
  failBasicSetKey: null as string | null,
  failBasicRemoveKey: null as string | null,
  noopBasicRemoveKey: null as string | null,
  failBasicReadAfterSetKey: null as string | null,
  failBasicReadKey: null as string | null,
  basicSetCommitted: vi.fn(),
  basicRemoveStarted: vi.fn(),
  legacy: false,
  journalPending: false,
  failRead: false,
  failReadAfterWrite: false,
  failCredentialCleanup: false,
  credentialCleanupFailures: 0,
  transientPrfJournalClearFailure: false,
  biometricCleanupRetry: vi.fn(),
  noopRemove: false,
  removeGate: null as Promise<void> | null,
  removeStarted: vi.fn(),
  writeGate: null as Promise<void> | null,
  writeCommitted: vi.fn(),
  beforeWriteGate: null as Promise<void> | null,
  beforeWriteStarted: vi.fn(),
  cleanupIdentifier: vi.fn(async () => undefined),
  resetBarrier: vi.fn(async () => undefined),
  biometricGenerationListener: null as null | ((event: { walletId: string; generation: number; sourceId: string; nonce: string }) => void),
  biometricInspectGate: null as Promise<void> | null,
  biometricInspectStarted: vi.fn(),
  generationMalformed: false,
  biometricGeneration: 0,
  journalPhase: null as null | 'legacy-cleanup-required' | 'prf-committed-cleanup' | 'legacy-recovery-prepared' | 'password-committed-enrollment' | 'password-only-retirement' | 'disable-biometric' | 'malformed-generation-repair',
  journalVaultRevision: null as number | null,
  failOrphanCleanup: false,
  harmlessMarker: false,
  prfMalformed: false,
  legacyWrapperBlocked: false,
  prfWrapperBlocked: false,
  recoveryPreparationFailure: null as null | 'journal' | 'legacy-tombstone' | 'prf-tombstone',
  recoveryPreparation: vi.fn(),
  passwordCommitGate: null as Promise<void> | null,
  passwordCommitStarted: vi.fn(),
  passwordCommitFailure: false,
  biometricEnabled: false,
  biometricEnableResult: true,
  biometricEnableError: false,
  biometricCommitBeforeError: false,
  biometricEnableGate: null as Promise<void> | null,
  biometricEnableStarted: vi.fn(),
  biometricEnable: vi.fn(async () => true),
  biometricAssertion: vi.fn(),
  biometricRepair: vi.fn(),
  biometricRepairMnemonic: '',
}))

vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: vi.fn(async ({ key }: { key: string }) => {
    if (environment.failBasicReadKey === key) throw new Error(`Synthetic basic read failure for ${key}`)
    return { value: environment.basic.get(key) ?? null }
  }),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    if (environment.failBasicSetKey === key) throw new Error(`Synthetic basic write failure for ${key}`)
    environment.basic.set(key, value)
    environment.basicSetCommitted(key)
    if (environment.failBasicReadAfterSetKey === key) environment.failBasicReadKey = key
  }),
  remove: vi.fn(async ({ key }: { key: string }) => {
    environment.basicRemoveStarted(key)
    if (environment.failBasicRemoveKey === key) throw new Error(`Synthetic basic removal failure for ${key}`)
    if (environment.noopBasicRemoveKey !== key) environment.basic.delete(key)
    if (key === 'ge_basic:biometric_generation_v1') {
      environment.generationMalformed = false
      environment.biometricGeneration = 0
    }
  }),
  keys: vi.fn(async () => ({ keys: [...environment.basic.keys()] })),
} }))
vi.mock('capacitor-secure-storage-plugin', () => ({ SecureStoragePlugin: {
  get: vi.fn(async ({ key }: { key: string }) => {
    await environment.readGate
    if (environment.failRead) throw new Error('Synthetic read-back failure')
    return { value: environment.secure.get(key) ?? null }
  }),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    environment.beforeWriteStarted()
    await environment.beforeWriteGate
    if (environment.failWrite) throw new Error('Synthetic wallet write failure')
    environment.secure.set(key, value)
    environment.writeCommitted()
    await environment.writeGate
    if (environment.failReadAfterWrite) environment.failRead = true
  }),
  remove: vi.fn(async ({ key }: { key: string }) => {
    environment.removeStarted()
    await environment.removeGate
    if (environment.failRemove) throw new Error('Synthetic storage deletion failure')
    if (!environment.noopRemove) environment.secure.delete(key)
  }),
  keys: vi.fn(async () => {
    if (environment.failKeys) throw new Error('Synthetic storage unavailable')
    return { value: [...environment.secure.keys()] }
  }),
} }))
vi.mock('../../packages/core/src/services/BiometricService', () => {
  class MockBiometricMigrationError extends Error {
    code: string
    constructor(code: string, message: string) { super(message); this.code = code }
  }
  const generation = () => {
    if (environment.generationMalformed) {
      throw new MockBiometricMigrationError('BIOMETRIC_GENERATION_MALFORMED', 'Synthetic malformed biometric generation')
    }
    return environment.biometricGeneration
  }
  const assertGeneration = (context?: { biometricGeneration?: number }) => {
    const persisted = generation()
    if (context?.biometricGeneration !== undefined && context.biometricGeneration !== persisted) {
      throw new MockBiometricMigrationError('BIOMETRIC_GENERATION_CHANGED', 'Synthetic biometric generation change')
    }
  }
  return {
    BiometricMigrationError: MockBiometricMigrationError,
    BiometricService: {
      isAvailable: async () => false,
      getType: async () => 'none',
      getGeneration: async () => generation(),
      inspect: async (context?: { vaultId: string; vaultRevision?: number }) => {
        const phase = environment.journalPhase ?? 'legacy-cleanup-required'
        const journalRevision = environment.journalVaultRevision ?? 0
        const generationState = environment.generationMalformed
          ? 'malformed'
          : environment.biometricGeneration === 0
            ? 'absent'
            : context
              ? 'matching'
              : 'foreign'
        const journalState = !environment.journalPending
          ? 'absent'
          : context && (context.vaultRevision === undefined || context.vaultRevision === journalRevision)
            ? 'matching'
            : 'foreign'
        // Keep the mock's restart classification aligned with production: a
        // historical legacy tombstone with no journal is retirement intent,
        // except for the two password-replacement continuation phases.
        const passwordReplacementContinuation = journalState === 'matching'
          && (phase === 'legacy-recovery-prepared' || phase === 'password-committed-enrollment')
        const passwordOnlyLegacyTombstone = environment.legacyWrapperBlocked
          && !passwordReplacementContinuation
        const result = {
          prfState: environment.prfWrapperBlocked
            ? 'disabled'
            : environment.prfMalformed
              ? 'malformed'
              : environment.biometricEnabled
                ? context ? 'matching' : 'foreign'
                : 'absent',
          envelope: null,
          legacyState: environment.legacy ? environment.legacyWrapperBlocked ? 'partial' : 'complete' : 'absent',
          sensitiveLegacy: environment.legacy,
          enabledMarker: environment.legacy || environment.harmlessMarker,
          journal: environment.journalPending ? { version: 1, walletId: 'mock-wallet', vaultRevision: journalRevision, phase, updatedAt: 1 } : null,
          journalState,
          generation: environment.generationMalformed || environment.biometricGeneration === 0 ? null : environment.biometricGeneration,
          generationState,
          cleanupIntent: environment.prfWrapperBlocked || passwordOnlyLegacyTombstone
            ? 'password-only'
            : environment.generationMalformed || environment.prfMalformed
              ? 'blocked'
              : journalState === 'matching'
                ? phase === 'password-only-retirement' || phase === 'disable-biometric' || phase === 'malformed-generation-repair' ? 'password-only' : 'enroll'
                : journalState === 'foreign' ? 'password-only' : null,
          cleanupPending: environment.legacy || environment.journalPending || environment.generationMalformed || environment.prfMalformed || environment.prfWrapperBlocked,
          legacyRecoveryBlocked: environment.biometricEnabled
            || environment.prfWrapperBlocked
            || environment.generationMalformed
            || (environment.journalPending && phase !== 'legacy-cleanup-required'),
        }
        environment.biometricInspectStarted()
        await environment.biometricInspectGate
        return result
      },
      isEnabled: async () => environment.biometricEnabled,
      hasLegacy: async () => environment.legacy,
      authenticate: async (context: { biometricGeneration?: number }) => {
        assertGeneration(context)
        const passwordReplacementContinuation = environment.journalPending
          && (environment.journalPhase === 'legacy-recovery-prepared'
            || environment.journalPhase === 'password-committed-enrollment')
        if ((environment.legacyWrapperBlocked && !passwordReplacementContinuation)
          || (environment.journalPending
          && (environment.journalPhase === 'password-only-retirement'
            || environment.journalPhase === 'disable-biometric'))) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic biometric retirement pending')
        }
        if (environment.prfMalformed) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic malformed biometric state')
        }
        if (!environment.biometricEnabled) return { success: false }
        environment.biometricAssertion()
        return { success: true, password: 'PUBLIC-TEST-ONLY_password-123!', proof: 'public-test-biometric-proof' }
      },
      repairMalformedGenerationWithBiometric: async () => {
        if (!environment.generationMalformed) {
          throw new MockBiometricMigrationError('BIOMETRIC_GENERATION_CHANGED', 'Synthetic biometric generation change')
        }
        const passwordReplacementContinuation = environment.journalPending
          && (environment.journalPhase === 'legacy-recovery-prepared'
            || environment.journalPhase === 'password-committed-enrollment')
        if (!environment.biometricEnabled
          || environment.prfMalformed
          || (environment.legacyWrapperBlocked && !passwordReplacementContinuation)
          || (environment.journalPending
            && (environment.journalPhase === 'password-only-retirement'
              || environment.journalPhase === 'disable-biometric'))) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic biometric repair blocked')
        }
        environment.biometricRepair()
        environment.biometricAssertion()
        environment.generationMalformed = false
        environment.biometricGeneration = 17
        environment.basic.set('ge_basic:biometric_generation_v1', JSON.stringify({ version: 1, walletId: 'mock-wallet', generation: 17 }))
        return {
          password: 'PUBLIC-TEST-ONLY_password-123!',
          mnemonic: environment.biometricRepairMnemonic,
          generation: 17,
        }
      },
      cleanupOrphanedState: async () => {
        if (environment.secure.has('ge_secure:mnemonic')) return
        if (environment.failOrphanCleanup || environment.failCredentialCleanup) throw new Error('Synthetic orphan cleanup failure')
        environment.generationMalformed = false
        environment.biometricGeneration = 0
        environment.biometricEnabled = false
        environment.prfMalformed = false
        environment.legacy = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.harmlessMarker = false
        environment.basic.delete('ge_basic:biometric_generation_v1')
      },
      cleanupOrphanedStateWithinWalletMutation: async () => {
        if (environment.secure.has('ge_secure:mnemonic')) return
        if (environment.failOrphanCleanup || environment.failCredentialCleanup) throw new Error('Synthetic orphan cleanup failure')
        environment.generationMalformed = false
        environment.biometricGeneration = 0
        environment.biometricEnabled = false
        environment.prfMalformed = false
        environment.legacy = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.harmlessMarker = false
        environment.basic.delete('ge_basic:biometric_generation_v1')
      },
      prepareWalletDeletionWithinWalletMutation: async () => {
        if (environment.biometricEnabled || environment.legacy || environment.journalPending || environment.prfMalformed) {
          environment.biometricEnabled = false
          environment.prfMalformed = true
          environment.journalPending = true
          environment.journalPhase = 'disable-biometric'
        }
      },
      prepareLegacyRecoveryPasswordReplacementWithinWalletMutation: async (
        _scope: unknown,
        context: { biometricGeneration?: number; vaultRevision: number },
      ) => {
        assertGeneration(context)
        environment.recoveryPreparation()
        if (environment.recoveryPreparationFailure === 'journal') {
          throw new Error('Synthetic recovery preparation journal failure')
        }
        environment.journalPending = true
        environment.journalPhase = 'legacy-recovery-prepared'
        environment.journalVaultRevision = context.vaultRevision
        if (environment.recoveryPreparationFailure === 'legacy-tombstone') {
          throw new Error('Synthetic legacy tombstone failure')
        }
        environment.legacyWrapperBlocked = true
        if (environment.recoveryPreparationFailure === 'prf-tombstone') {
          throw new Error('Synthetic PRF tombstone failure')
        }
        environment.prfWrapperBlocked = true
        environment.prfMalformed = false
        environment.biometricEnabled = false
        assertGeneration(context)
      },
      recoverLegacyForMigration: async (context: { biometricGeneration?: number }) => {
        assertGeneration(context)
        if (environment.legacyWrapperBlocked
          || environment.prfWrapperBlocked
          || (environment.journalPending
            && environment.journalPhase !== 'legacy-cleanup-required')) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic biometric retirement or committed migration pending')
        }
        return 'PUBLIC-TEST-ONLY_password-123!'
      },
      repairMalformedGenerationWithPassword: async () => {
        if (!environment.generationMalformed) {
          throw new MockBiometricMigrationError('BIOMETRIC_GENERATION_CHANGED', 'Synthetic biometric generation change')
        }
        environment.generationMalformed = false
        environment.biometricGeneration = 0
        environment.basic.delete('ge_basic:biometric_generation_v1')
        environment.biometricEnabled = false
        environment.prfMalformed = false
        environment.legacy = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.harmlessMarker = false
        return 0
      },
      markPasswordCommitted: async (
        _password: string,
        context: { biometricGeneration?: number; vaultRevision: number },
      ) => {
        environment.passwordCommitStarted()
        await environment.passwordCommitGate
        if (environment.passwordCommitFailure) throw new Error('Synthetic hard process stop before password commit marker')
        assertGeneration(context)
        const prepared = environment.journalPending
          && environment.journalPhase === 'legacy-recovery-prepared'
          && (environment.journalVaultRevision ?? -1) + 1 === context.vaultRevision
        if (environment.journalPending
          && environment.journalPhase !== 'legacy-cleanup-required'
          && !prepared) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic biometric retirement pending')
        }
        if (prepared && (!environment.legacyWrapperBlocked || !environment.prfWrapperBlocked)) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic recovery preparation changed')
        }
        environment.journalPending = true
        environment.journalPhase = 'password-committed-enrollment'
        environment.journalVaultRevision = context.vaultRevision
        if (prepared) environment.prfWrapperBlocked = false
        environment.biometricGeneration += 1
      },
      enable: async (_password: string, context: { biometricGeneration?: number }) => {
        assertGeneration(context)
        const passwordReplacementContinuation = environment.journalPending
          && (environment.journalPhase === 'legacy-recovery-prepared'
            || environment.journalPhase === 'password-committed-enrollment')
        if (environment.prfMalformed || (environment.legacyWrapperBlocked && !passwordReplacementContinuation)) {
          throw new MockBiometricMigrationError('BIOMETRIC_CLEANUP_PENDING', 'Synthetic biometric retirement or malformed state')
        }
        environment.biometricEnable()
        environment.biometricEnableStarted()
        await environment.biometricEnableGate
        assertGeneration(context)
        if (environment.biometricCommitBeforeError) environment.biometricEnabled = true
        if (environment.biometricEnableError) throw new DOMException('Synthetic biometric enrollment cancellation', 'NotAllowedError')
        if (!environment.biometricEnableResult) return { verified: false, legacyCleanupComplete: false }
        environment.biometricEnabled = true
        if (environment.legacy && environment.transientPrfJournalClearFailure) {
          // Model the production PRF sequence: its exact envelope readback and
          // generation commit succeeded, then journal clearing failed.
          environment.transientPrfJournalClearFailure = false
          environment.biometricGeneration += 1
          environment.journalPending = true
          environment.journalPhase = 'prf-committed-cleanup'
          return {
            verified: true,
            legacyCleanupComplete: false,
            cleanupProof: 'public-test-biometric-cleanup-proof',
          }
        }
        if (environment.legacy && (environment.failCredentialCleanup || environment.credentialCleanupFailures > 0)) {
          if (environment.credentialCleanupFailures > 0) environment.credentialCleanupFailures -= 1
          return {
            verified: true,
            legacyCleanupComplete: false,
            cleanupProof: 'public-test-biometric-cleanup-proof',
          }
        }
        environment.legacy = false
        environment.legacyWrapperBlocked = false
        environment.prfWrapperBlocked = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.journalVaultRevision = null
        return { verified: true, legacyCleanupComplete: true }
      },
      retryCommittedPrfCleanup: async (
        _password: string,
        proof: string,
        context: { biometricGeneration?: number },
      ) => {
        environment.biometricCleanupRetry()
        assertGeneration(context)
        if (proof !== 'public-test-biometric-cleanup-proof') {
          throw new MockBiometricMigrationError('BIOMETRIC_SUPERSEDED', 'Synthetic cleanup proof mismatch')
        }
        if (environment.failCredentialCleanup || environment.credentialCleanupFailures > 0) {
          if (environment.credentialCleanupFailures > 0) environment.credentialCleanupFailures -= 1
          return {
            verified: true,
            legacyCleanupComplete: false,
            cleanupProof: proof,
          }
        }
        if (environment.journalPhase === 'prf-committed-cleanup') environment.biometricGeneration += 1
        environment.legacy = false
        environment.legacyWrapperBlocked = false
        environment.prfWrapperBlocked = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.journalVaultRevision = null
        return { verified: true, legacyCleanupComplete: true }
      },
      verifyAuthenticationWithinWalletMutation: async (
        _scope: unknown,
        proof: string,
        context: { biometricGeneration?: number },
      ) => {
        assertGeneration(context)
        if (proof !== 'public-test-biometric-proof' || !environment.biometricEnabled) {
          throw new MockBiometricMigrationError('BIOMETRIC_SUPERSEDED', 'Synthetic authentication proof mismatch')
        }
      },
      retireLegacyWithPassword: async (_password: string, context: { biometricGeneration?: number }) => {
        assertGeneration(context)
        environment.journalPending = true
        environment.journalPhase = 'password-only-retirement'
        if (environment.failCredentialCleanup || environment.credentialCleanupFailures > 0) {
          if (environment.credentialCleanupFailures > 0) environment.credentialCleanupFailures -= 1
          throw new Error('Synthetic credential cleanup failure')
        }
        environment.legacy = false
        environment.legacyWrapperBlocked = false
        environment.prfWrapperBlocked = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.journalVaultRevision = null
        environment.biometricEnabled = false
        environment.prfMalformed = false
        environment.biometricGeneration += 1
      },
      removeHarmlessMarker: async () => undefined,
      disableWithinWalletMutation: async (
        _scope: unknown,
        context: { biometricGeneration?: number },
      ) => {
        assertGeneration(context)
        environment.journalPending = true
        environment.journalPhase = 'disable-biometric'
        if (environment.failCredentialCleanup) throw new Error('Synthetic credential cleanup failure')
        environment.biometricEnabled = false
        environment.prfMalformed = false
        environment.legacy = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.biometricGeneration += 1
      },
      disable: async (context?: { biometricGeneration?: number }) => {
        if (context) {
          assertGeneration(context)
          environment.journalPending = true
          environment.journalPhase = 'disable-biometric'
        }
        if (environment.failCredentialCleanup) throw new Error('Synthetic credential cleanup failure')
        environment.biometricEnabled = false
        environment.prfMalformed = false
        environment.legacy = false
        environment.journalPending = false
        environment.journalPhase = null
        environment.biometricGeneration += context ? 1 : 0
      },
    },
  }
})
vi.mock('../../packages/core/src/services/DeviceService', () => ({ DeviceService: {
  getInstance: () => ({ cleanupObsoleteIdentifier: environment.cleanupIdentifier }),
} }))
vi.mock('../../packages/core/src/services/WalletResetBarrierService', () => ({
  prepareWalletResetBarrier: () => environment.resetBarrier(),
}))
vi.mock('../../packages/core/src/services/BiometricSessionService', () => ({
  subscribeBiometricGeneration: (listener: NonNullable<typeof environment.biometricGenerationListener>) => {
    environment.biometricGenerationListener = listener
    return () => {
      if (environment.biometricGenerationListener === listener) environment.biometricGenerationListener = null
    }
  },
}))

const loadStore = async () => (await import('../../packages/core/src/store/WalletStore')).useWalletStore
const password = golden.vaults[0].password
const mnemonic = golden.seeds[0].mnemonic

beforeEach(() => {
  vi.resetModules()
  environment.secure.clear()
  environment.basic.clear()
  environment.failKeys = false
  environment.failRemove = false
  environment.readGate = null
  environment.failWrite = false
  environment.failBasicSetKey = null
  environment.failBasicRemoveKey = null
  environment.noopBasicRemoveKey = null
  environment.failBasicReadAfterSetKey = null
  environment.failBasicReadKey = null
  environment.basicSetCommitted.mockReset()
  environment.basicRemoveStarted.mockReset()
  environment.legacy = false
  environment.journalPending = false
  environment.failRead = false
  environment.failReadAfterWrite = false
  environment.failCredentialCleanup = false
  environment.credentialCleanupFailures = 0
  environment.transientPrfJournalClearFailure = false
  environment.biometricCleanupRetry.mockReset()
  environment.noopRemove = false
  environment.removeGate = null
  environment.removeStarted.mockClear()
  environment.writeGate = null
  environment.writeCommitted.mockClear()
  environment.beforeWriteGate = null
  environment.beforeWriteStarted.mockClear()
  environment.cleanupIdentifier.mockReset().mockResolvedValue(undefined)
  environment.resetBarrier.mockReset().mockResolvedValue(undefined)
  environment.biometricGenerationListener = null
  environment.biometricInspectGate = null
  environment.biometricInspectStarted.mockReset()
  environment.generationMalformed = false
  environment.biometricGeneration = 0
  environment.journalPhase = null
  environment.journalVaultRevision = null
  environment.failOrphanCleanup = false
  environment.harmlessMarker = false
  environment.prfMalformed = false
  environment.legacyWrapperBlocked = false
  environment.prfWrapperBlocked = false
  environment.recoveryPreparationFailure = null
  environment.recoveryPreparation.mockReset()
  environment.passwordCommitGate = null
  environment.passwordCommitStarted.mockReset()
  environment.passwordCommitFailure = false
  environment.biometricEnabled = false
  environment.biometricEnableResult = true
  environment.biometricEnableError = false
  environment.biometricCommitBeforeError = false
  environment.biometricEnableGate = null
  environment.biometricEnableStarted.mockReset()
  environment.biometricEnable.mockReset().mockResolvedValue(true)
  environment.biometricAssertion.mockReset()
  environment.biometricRepair.mockReset()
  environment.biometricRepairMnemonic = mnemonic
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('wallet lifecycle with real encryption, derivation and Zustand', () => {
  it('imports, persists, locks, reloads and unlocks the same public test wallet', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    expect(store.getState().status).toBe('no_wallet')
    await store.getState().importWallet(mnemonic, password, false)
    expect(store.getState().address).toBe(golden.seeds[0].address)
    const persisted = environment.secure.get('ge_secure:mnemonic')!
    expect(persisted).not.toContain(mnemonic)
    await store.getState().lockWallet()
    expect(store.getState().getPrivateKey()).toBeNull()
    expect(store.getState().backupPhrase).toBeNull()
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().status).toBe('locked')
    const checked = await reloaded.getState().checkPassword(password)
    expect(checked).toBe(mnemonic)
    expect(await reloaded.getState().unlockWallet(checked as string)).toBe(true)
    expect(reloaded.getState().address).toBe(golden.seeds[0].address)
  })

  it('awaits the shared authorization barrier before explicit lock completion', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    const lockRequest = vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation())
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', { locks: { request: lockRequest } })
    try {
      const store = await loadStore()
      await store.getState().importWallet(mnemonic, password, false)
      lockRequest.mockClear()

      await store.getState().lockWallet()

      expect(lockRequest).toHaveBeenCalledTimes(1)
      expect(lockRequest).toHaveBeenCalledWith(
        'goldenera-wallet-authorization-barrier',
        expect.any(Function),
      )
      expect(store.getState().getPrivateKey()).toBeNull()
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('requires backup for a newly created wallet and persists completion', async () => {
    const store = await loadStore()
    const result = await store.getState().createWallet(password, false)
    expect(store.getState().status).toBe('backup')
    expect(store.getState().backupPhrase).toBe(result.mnemonic)
    expect(await store.getState().checkPassword(password)).toBe(result.mnemonic)
    await store.getState().backupWallet()
    expect(store.getState().status).toBe('unlocked')
    expect(store.getState().backupPhrase).toBeNull()
    await store.getState().lockWallet()
    await store.getState().unlockWallet(result.mnemonic)
    expect(store.getState().status).toBe('unlocked')
  })

  it('revokes another backup tab when backup completion is committed', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() } })
    try {
      const confirming = await loadStore()
      const result = await confirming.getState().createWallet(password, false)
      vi.resetModules()
      const otherTab = await loadStore()
      await otherTab.getState().initialize()
      await otherTab.getState().unlockWallet(result.mnemonic)
      expect(otherTab.getState().status).toBe('backup')
      expect(otherTab.getState().getPrivateKey()).not.toBeNull()

      await confirming.getState().backupWallet()

      expect(otherTab.getState().getPrivateKey()).toBeNull()
      expect(otherTab.getState().status).toBe('locked')
      expect(otherTab.getState().backupPhrase).toBeNull()
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('confirms requested biometric enrollment before opening a newly created wallet', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    await store.getState().createWallet(password, true)
    expect(environment.biometricEnable).toHaveBeenCalledTimes(1)
    expect(store.getState().status).toBe('backup')
    expect(store.getState().biometric.enabled).toBe(true)
    expect(store.getState().error).toBeNull()
  })

  it('does not silently finish requested biometric enrollment when the authenticator declines it', async () => {
    environment.biometricEnableResult = false
    const store = await loadStore()
    await store.getState().initialize()
    await expect(store.getState().importWallet(mnemonic, password, true)).rejects.toThrow('could not be enabled or verified')
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(true)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().biometric.enabled).toBe(false)
    expect(store.getState().error).toContain('retry Biometrics in Settings')
  })

  it('does not accept a structurally enabled partial commit after an unverified throw', async () => {
    environment.biometricEnableError = true
    environment.biometricCommitBeforeError = true
    const store = await loadStore()
    await store.getState().initialize()
    await expect(store.getState().importWallet(mnemonic, password, true)).rejects.toThrow('could not be enabled or verified')
    expect(store.getState().status).toBe('locked')
    expect(store.getState().biometric.enabled).toBe(false)
  })

  it('allows a clear password fallback and a later enrollment retry after onboarding failure', async () => {
    environment.biometricEnableResult = false
    const store = await loadStore()
    await store.getState().initialize()
    await expect(store.getState().importWallet(mnemonic, password, true)).rejects.toThrow()
    const restored = await store.getState().checkPassword(password)
    expect(restored).toBe(mnemonic)
    await store.getState().unlockWallet(restored as string)
    environment.biometricEnableResult = true
    await store.getState().toggleBiometric(true, password)
    expect(store.getState().biometric.enabled).toBe(true)
  })

  it('does not let a stale enrollment completion overwrite a newer cross-tab wallet state', async () => {
    const previousWindow = window
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    let release!: () => void
    environment.biometricEnableGate = new Promise<void>(resolve => { release = resolve })
    try {
      const store = await loadStore()
      await store.getState().initialize()
      const pending = store.getState().importWallet(mnemonic, password, true)
      await vi.waitFor(() => expect(environment.biometricEnableStarted).toHaveBeenCalledTimes(1))
      tokens.set('ge_wallet_session_event', JSON.stringify({ sourceId: 'other-tab', nonce: 'newer-wallet' }))
      store.setState({ status: 'locked', vaultId: 'newer-vault', vaultRevision: 9, error: 'Authoritative newer state' })
      release()
      await expect(pending).rejects.toThrow('session changed')
      expect(store.getState().vaultId).toBe('newer-vault')
      expect(store.getState().vaultRevision).toBe(9)
      expect(store.getState().error).toBe('Authoritative newer state')
    } finally {
      vi.stubGlobal('window', previousWindow)
    }
  })

  it('rejects an incorrect password without exposing keys', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    expect(await store.getState().checkPassword(`${password}-incorrect`)).toBe(false)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().getPrivateKey()).toBeNull()
  })

  it('deletes the encrypted mnemonic and backup marker on a successful reset', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const publicJournal = JSON.stringify({ version: 1, records: [] })
    environment.basic.set('ge_transfer_journal:records', publicJournal)

    await store.getState().resetWallet(password)

    expect(store.getState().status).toBe('no_wallet')
    expect(store.getState().getPrivateKey()).toBeNull()
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
    expect(environment.basic.has('ge_basic:backedup')).toBe(false)
    expect(environment.basic.get('ge_transfer_journal:records')).toBe(publicJournal)
  })

  it('requires the current wallet password inside the destructive action', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const encrypted = environment.secure.get('ge_secure:mnemonic')
    environment.basic.set('ge_basic:authorization-sentinel', 'retained')
    environment.biometricEnabled = true

    await expect(store.getState().resetWallet(`${password}-incorrect`)).rejects.toThrow('Incorrect password')

    expect(store.getState().status).toBe('unlocked')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(encrypted)
    expect(environment.basic.get('ge_basic:authorization-sentinel')).toBe('retained')
    expect(environment.biometricEnabled).toBe(true)
    expect(environment.resetBarrier).not.toHaveBeenCalled()
  })

  it('keeps password access intact when open PWA clients cannot be attested', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const encrypted = environment.secure.get('ge_secure:mnemonic')
    const metadata = environment.basic.get('ge_basic:wallet_vault_v2')
    environment.biometricEnabled = true
    environment.resetBarrier.mockRejectedValue(new Error('Synthetic stale PWA client'))
    const removesBeforeReset = environment.removeStarted.mock.calls.length

    await expect(store.getState().resetWallet(password)).rejects.toThrow('stale PWA client')

    expect(environment.secure.get('ge_secure:mnemonic')).toBe(encrypted)
    expect(environment.basic.get('ge_basic:wallet_vault_v2')).toBe(metadata)
    expect(environment.removeStarted).toHaveBeenCalledTimes(removesBeforeReset)
    expect(environment.biometricEnabled).toBe(true)
    expect(store.getState().status).toBe('unlocked')
    expect(await store.getState().checkPassword(password)).toBe(mnemonic)
  })

  it('preserves a replacement ciphertext committed by a legacy client during attestation', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const replacement = await CryptoUtil.encrypt(golden.seeds[1].mnemonic, 'PUBLIC-Replacement-Password-456!')
    environment.resetBarrier.mockImplementation(async () => {
      environment.secure.set('ge_secure:mnemonic', replacement)
    })
    const removesBeforeReset = environment.removeStarted.mock.calls.length

    await expect(store.getState().resetWallet(password)).rejects.toThrow()

    expect(environment.secure.get('ge_secure:mnemonic')).toBe(replacement)
    expect(environment.removeStarted).toHaveBeenCalledTimes(removesBeforeReset)
    expect(store.getState().status).not.toBe('no_wallet')
  })

  it.each([
    { source: 'raw-v1', raw: golden.vaults[0].encrypted, expectedStatus: 'unlocked' },
    { source: 'v2', raw: JSON.stringify(previousV2.record), expectedStatus: 'unlocked' },
  ] as const)('keeps $source password access and metadata when authoritative seed removal fails', async ({ raw, expectedStatus }) => {
    environment.secure.set('ge_secure:mnemonic', raw)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.basic.set('ge_basic:reset-sentinel', 'remove-me')
    const publicJournal = JSON.stringify({ version: 1, records: [] })
    environment.basic.set('ge_transfer_journal:records', publicJournal)
    const store = await loadStore()
    await store.getState().initialize()
    environment.failRemove = true

    await expect(store.getState().resetWallet(password)).rejects.toThrow('storage deletion failure')

    expect(environment.secure.get('ge_secure:mnemonic')).toBe(raw)
    expect(environment.basic.get('ge_basic:reset-sentinel')).toBe('remove-me')
    expect(environment.basic.get('ge_basic:backedup')).toBe('true')
    expect(environment.basic.get('ge_transfer_journal:records')).toBe(publicJournal)
    expect(store.getState().status).toBe('error')

    environment.failRemove = false
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().status).toBe('locked')
    await expect(reloaded.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)
    expect(reloaded.getState().status).toBe(expectedStatus)
    expect(reloaded.getState().address).toBe(golden.seeds[0].address)
  })

  it('blocks mnemonic-only open while a wallet-bound migration journal is pending', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    environment.journalPending = true

    expect(await store.getState().unlockWallet(mnemonic)).toBe(false)
    expect(store.getState().status).toBe('locked')
    expect(environment.biometricEnable).not.toHaveBeenCalled()
  })

  it('never creates a credential while explicitly retiring or disabling biometrics', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    environment.legacy = true
    store.setState(state => ({ biometric: { ...state.biometric, legacy: true } }))

    await store.getState().retireLegacyWithPassword(password)
    environment.biometricEnabled = true
    await store.getState().toggleBiometric(false, password)

    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(environment.biometricEnabled).toBe(false)
    expect(environment.legacy).toBe(false)
  })
})

describe('security regressions', () => {
  it('S2: storage enumeration failure must not expose new-wallet onboarding', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.failKeys = true
    const store = await loadStore()
    await store.getState().initialize()
    expect(store.getState().status).not.toBe('no_wallet')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
  })

  it('S3: failed deletion must not report no_wallet', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    environment.failRemove = true
    await store.getState().resetWallet(password).catch(() => undefined)
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(true)
    expect(store.getState().status).not.toBe('no_wallet')
  })

  it('reports final invalidation failure as a warning after verified seed removal', async () => {
    const previousWindow = window
    const tokens = new Map<string, string>()
    let deletionWrites = 0
    let deleting = false
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (deleting && ++deletionWrites === 3) throw new Error('Synthetic final invalidation failure')
        tokens.set(key, value)
      },
    } })
    try {
      const store = await loadStore()
      await store.getState().importWallet(mnemonic, password, false)
      deleting = true

      await expect(store.getState().resetWallet(password)).resolves.toBeUndefined()

      expect(deletionWrites).toBe(3)
      expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
      expect(store.getState().status).toBe('no_wallet')
      expect(store.getState().error).toContain('Other tabs could not be notified')

      deleting = false
      vi.resetModules()
      const reloaded = await loadStore()
      await reloaded.getState().initialize()
      expect(reloaded.getState().status).toBe('no_wallet')
      expect(reloaded.getState().vaultId).toBeNull()
    } finally {
      vi.stubGlobal('window', previousWindow)
    }
  })

  it('S3: failed post-seed biometric cleanup leaves a visible retry warning', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    environment.biometricEnabled = true
    environment.legacy = true
    environment.failCredentialCleanup = true

    await expect(store.getState().resetWallet(password)).resolves.toBeUndefined()

    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
    expect(environment.journalPending).toBe(true)
    expect(environment.journalPhase).toBe('disable-biometric')
    expect(store.getState().status).toBe('no_wallet')
    expect(store.getState().error).toContain('Biometric cleanup is pending')

    environment.failCredentialCleanup = false
    await store.getState().initialize()

    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(environment.biometricEnabled).toBe(false)
    expect(environment.legacy).toBe(false)
    expect(environment.journalPending).toBe(false)
    expect(store.getState().status).toBe('no_wallet')
  })

  it('S5: a late unlock completion must not resurrect a locked session', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    let finish!: () => void
    environment.readGate = new Promise<void>(resolve => { finish = resolve })
    const pending = store.getState().unlockWallet(mnemonic)
    await Promise.resolve()
    await store.getState().lockWallet()
    finish()
    await pending
    expect(store.getState().status).toBe('locked')
    expect(store.getState().getPrivateKey()).toBeNull()
  })

  it('S7: retries obsolete-identifier cleanup on later initialization', async () => {
    environment.cleanupIdentifier
      .mockRejectedValueOnce(new Error('Synthetic preference failure'))
      .mockResolvedValueOnce(undefined)
    const store = await loadStore()

    await store.getState().initialize()
    await store.getState().initialize()

    expect(environment.cleanupIdentifier).toHaveBeenCalledTimes(2)
  })

  it('S7: stalled obsolete-identifier cleanup must not prevent local unlock', async () => {
    environment.cleanupIdentifier.mockImplementationOnce(() => new Promise<void>(() => undefined))
    const store = await loadStore()
    await store.getState().initialize()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    await store.getState().unlockWallet(mnemonic)
    expect(store.getState().status).toBe('unlocked')
  })
})


describe('atomic wallet identity, migration and session policy', () => {
  it('S2/S4: never overwrites a persisted wallet through a second create/import', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const original = environment.secure.get('ge_secure:mnemonic')
    await expect(store.getState().importWallet(golden.seeds[1].mnemonic, password, false)).rejects.toThrow('already exists')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(original)
  })

  it('S2/S3: failed creation persistence leaves an error rather than active onboarding', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    environment.failWrite = true
    await expect(store.getState().createWallet(password, false)).rejects.toThrow('write failure')
    expect(store.getState().status).toBe('error')
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
  })

  it('S4: refuses a password for another persisted wallet while holding the old identity', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const original = JSON.parse(environment.secure.get('ge_secure:mnemonic')!)
    environment.secure.set('ge_secure:mnemonic', JSON.stringify({ ...original, id: 'different-wallet' }))
    expect(await store.getState().checkPassword(password)).toBe(false)
    expect(store.getState().getPrivateKey()).toBeNull()
    expect(store.getState().status).toBe('error')
  })

  it('S6: an elapsed deadline cannot be extended by activity after suspension', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const snapshot = store.getState().getSessionSnapshot()
    expect(snapshot).not.toBeNull()
    vi.spyOn(Date, 'now').mockReturnValue(store.getState().sessionExpiresAt! + 1)
    store.getState().touchSession()
    expect(store.getState().status).toBe('locked')
    expect(store.getState().getPrivateKey()).toBeNull()
    expect(store.getState().isSessionCurrent(snapshot)).toBe(false)
  })

  it('S5: locking invalidates a captured transaction session immediately', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const snapshot = store.getState().getSessionSnapshot()
    expect(store.getState().isSessionCurrent(snapshot)).toBe(true)
    await store.getState().lockWallet()
    expect(store.getState().isSessionCurrent(snapshot)).toBe(false)
  })

  it('binds signing access to the exact normalized wallet session snapshot', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const snapshot = store.getState().getSessionSnapshot()
    expect(snapshot).toMatchObject({
      vaultId: store.getState().vaultId,
      vaultRevision: store.getState().vaultRevision,
      revision: store.getState().sessionRevision,
      address: golden.seeds[0].address.toLowerCase(),
    })
    expect(store.getState().getPrivateKeyForSnapshot(snapshot)?.getAddress().toLowerCase())
      .toBe(snapshot?.address)
    expect(store.getState().getPrivateKeyForSnapshot({ ...snapshot!, vaultRevision: snapshot!.vaultRevision + 1 })).toBeNull()
    expect(store.getState().getPrivateKeyForSnapshot({ ...snapshot!, revision: snapshot!.revision + 1 })).toBeNull()
    expect(store.getState().getPrivateKeyForSnapshot({ ...snapshot!, address: golden.seeds[1].address.toLowerCase() })).toBeNull()
    expect(store.getState().getPrivateKeyForSnapshot({ ...snapshot!, storageToken: 'stale-token' })).toBeNull()
  })

  it('S1: legacy recovery saves a new password for the identical seed before removing old access', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    const replacement = 'PUBLIC-New-Password-456!'
    await store.getState().completeLegacyRecovery(recovery, replacement)
    expect(environment.legacy).toBe(false)
    expect(environment.biometricEnable).toHaveBeenCalledTimes(1)
    expect(store.getState().biometric.enabled).toBe(true)
    expect(store.getState().address).toBe(golden.seeds[0].address)
    expect(await store.getState().checkPassword(replacement)).toBe(mnemonic)
    expect(await store.getState().checkPassword(password)).toBe(false)
  })

  it.each(['password-only-retirement', 'disable-biometric'] as const)('does not let legacy recovery replace interrupted %s intent', async phase => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.biometricEnabled = true
    environment.journalPending = true
    environment.journalPhase = phase

    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).rejects.toMatchObject({
      code: 'PRECOMMIT_FAILED', authorityConsumed: true, passwordCommit: 'not-started', nextAction: 'verify-again',
    })

    expect(environment.biometricAssertion).not.toHaveBeenCalled()
    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(environment.biometricEnabled).toBe(true)
    expect(environment.journalPending).toBe(true)
    expect(environment.journalPhase).toBe(phase)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().error).toContain('retirement or a committed migration')
    expect(await store.getState().checkPassword(password)).toBe(mnemonic)
  })

  it('keeps explicit legacy recovery available when unrelated PRF metadata is malformed', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.prfMalformed = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    const replacement = 'PUBLIC-New-Password-456!'

    await store.getState().completeLegacyRecovery(recovery, replacement)

    expect(environment.biometricEnable).toHaveBeenCalledTimes(1)
    expect(environment.prfMalformed).toBe(false)
    expect(environment.legacy).toBe(false)
    expect(environment.biometricEnabled).toBe(true)
    expect(store.getState().status).toBe('unlocked')
    expect(await store.getState().checkPassword(replacement)).toBe(mnemonic)
  })

  it('reports migration enrollment failure, retires stale legacy access, and preserves the new password', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.biometricEnableResult = false
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    const replacement = 'PUBLIC-New-Password-456!'
    await store.getState().completeLegacyRecovery(recovery, replacement)
    expect(environment.legacy).toBe(false)
    expect(store.getState().status).toBe('unlocked')
    expect(store.getState().biometric.enabled).toBe(false)
    expect(store.getState().error?.toLowerCase()).toContain('secure biometric enrollment')
    expect(await store.getState().checkPassword(replacement)).toBe(mnemonic)
  })

  it('upgrades legacy biometric intent during an ordinary password unlock', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    expect(await store.getState().unlockWithPassword(password)).toBe(mnemonic)
    expect(environment.legacy).toBe(false)
    expect(store.getState().biometric.enabled).toBe(true)
  })

  it.each(['unsupported', 'cancelled'] as const)('continues ordinary password unlock after legacy retirement when PRF is %s', async outcome => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    if (outcome === 'unsupported') environment.biometricEnableResult = false
    else environment.biometricEnableError = true
    const store = await loadStore()
    await store.getState().initialize()
    expect(await store.getState().unlockWithPassword(password)).toBe(mnemonic)
    expect(store.getState().error?.toLowerCase()).toContain('secure biometric enrollment did not finish')
    expect(environment.legacy).toBe(false)
    expect(store.getState().biometric.enabled).toBe(false)
    expect(store.getState().status).toBe('unlocked')
  })

  it('accepts an ordinary legacy upgrade when a final verified cleanup retry succeeds', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.credentialCleanupFailures = 2
    const store = await loadStore()
    await store.getState().initialize()
    expect(await store.getState().unlockWithPassword(password)).toBe(mnemonic)
    expect(environment.credentialCleanupFailures).toBe(0)
    expect(environment.legacy).toBe(false)
    expect(store.getState().biometric.enabled).toBe(true)
    expect(store.getState().error).toBeNull()
  })

  it('opens recovery normally when a final verified cleanup retry succeeds', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.credentialCleanupFailures = 2
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    await store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')
    expect(environment.credentialCleanupFailures).toBe(0)
    expect(environment.legacy).toBe(false)
    expect(store.getState().status).toBe('unlocked')
    expect(store.getState().biometric.enabled).toBe(true)
  })

  it('refreshes redeemed recovery generation before a PRF cleanup-proof retry', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    // The mock mirrors PRF exact-readback + generation commit followed by one
    // transient journal-clear failure. Retrying cleanup must use the new
    // generation and not begin another enrollment ceremony.
    environment.transientPrfJournalClearFailure = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()

    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).resolves.toMatchObject({
      completed: true, passwordCommit: 'verified', nextAction: 'unlock-with-new-password',
    })

    expect(environment.biometricEnable).toHaveBeenCalledTimes(1)
    expect(environment.biometricCleanupRetry).toHaveBeenCalledTimes(1)
    expect(environment.biometricGeneration).toBe(3)
    expect(environment.legacy).toBe(false)
    expect(await store.getState().checkPassword('PUBLIC-New-Password-456!')).toBe(mnemonic)
  })

  it('S1: a failed legacy password replacement preserves the old vault and recovery path', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.failWrite = true
    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).rejects.toThrow()
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
    expect(environment.legacy).toBe(true)
  })
})


describe('migration fault boundaries independently requested by final QA', () => {
  it.each(['journal', 'legacy-tombstone', 'prf-tombstone'] as const)('does not write replacement ciphertext when recovery preparation fails at %s', async failure => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    const originalCiphertext = environment.secure.get('ge_secure:mnemonic')
    environment.beforeWriteStarted.mockClear()
    environment.recoveryPreparationFailure = failure

    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-Preparation-Failure-456!')).rejects.toThrow('Synthetic')

    expect(environment.recoveryPreparation).toHaveBeenCalledTimes(1)
    expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(originalCiphertext)
    expect(await store.getState().checkPassword(password)).toBe(mnemonic)
    expect(await store.getState().checkPassword('PUBLIC-Preparation-Failure-456!')).toBe(false)
    expect(store.getState().error).toContain('ciphertext was not changed')
    expect(environment.biometricEnable).not.toHaveBeenCalled()
    if (failure === 'journal') {
      expect(environment.journalPending).toBe(false)
      expect(environment.legacyWrapperBlocked).toBe(false)
      expect(environment.prfWrapperBlocked).toBe(false)
    } else {
      expect(environment.journalPending).toBe(true)
      expect(environment.journalPhase).toBe('legacy-recovery-prepared')
      expect(environment.legacyWrapperBlocked).toBe(failure === 'prf-tombstone')
      expect(environment.prfWrapperBlocked).toBe(false)
    }
  })

  it('leaves only new-password seed access and blocked old wrappers at a hard stop before the commit marker', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() } })
    let releasePasswordMarker!: () => void
    environment.passwordCommitGate = new Promise<void>(resolve => { releasePasswordMarker = resolve })
    environment.passwordCommitFailure = true
    try {
      environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
      environment.basic.set('ge_basic:backedup', 'true')
      environment.legacy = true
      const store = await loadStore()
      await store.getState().initialize()
      const recovery = await store.getState().recoverLegacyAccess()
      const tokenBeforePreparation = tokens.get('ge_wallet_session_event') ?? null
      const replacement = 'PUBLIC-Hard-Stop-Replacement-456!'

      const migration = store.getState().completeLegacyRecovery(recovery, replacement)
      await vi.waitFor(() => expect(environment.passwordCommitStarted).toHaveBeenCalledTimes(1))

      expect(environment.writeCommitted).toHaveBeenCalled()
      expect(environment.secure.get('ge_secure:mnemonic')).not.toBe(golden.vaults[0].encrypted)
      expect(environment.legacyWrapperBlocked).toBe(true)
      expect(environment.prfWrapperBlocked).toBe(true)
      expect(environment.journalPhase).toBe('legacy-recovery-prepared')
      expect(tokens.get('ge_wallet_session_event') ?? null).not.toBe(tokenBeforePreparation)
      expect(environment.biometricEnable).not.toHaveBeenCalled()

      vi.resetModules()
      const reloaded = await loadStore()
      await reloaded.getState().initialize()
      expect(await reloaded.getState().checkPassword(replacement)).toBe(mnemonic)
      expect(await reloaded.getState().checkPassword(password)).toBe(false)
      await expect(reloaded.getState().recoverLegacyAccess()).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
      expect(environment.biometricAssertion).not.toHaveBeenCalled()
      expect(environment.biometricEnable).not.toHaveBeenCalled()

      releasePasswordMarker()
      await expect(migration).rejects.toThrow('password was upgraded')
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('tombstones wrappers before the pre-write fence, revokes a stale client, and completes normal enrollment', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() } })
    let releaseWrite!: () => void
    try {
      const staleClient = await loadStore()
      await staleClient.getState().initialize()
      await staleClient.getState().importWallet(mnemonic, password, false)
      const staleSnapshot = staleClient.getState().getSessionSnapshot()
      const staleToken = staleSnapshot?.storageToken ?? null
      expect(staleSnapshot).not.toBeNull()
      environment.beforeWriteStarted.mockClear()
      environment.beforeWriteGate = new Promise<void>(resolve => { releaseWrite = resolve })

      environment.legacy = true
      vi.resetModules()
      const migrating = await loadStore()
      await migrating.getState().initialize()
      const recovery = await migrating.getState().recoverLegacyAccess()
      const replacement = 'PUBLIC-Normal-Recovery-456!'
      const migration = migrating.getState().completeLegacyRecovery(recovery, replacement)
      await vi.waitFor(() => expect(environment.beforeWriteStarted).toHaveBeenCalled())

      expect(environment.recoveryPreparation).toHaveBeenCalledTimes(1)
      expect(environment.legacyWrapperBlocked).toBe(true)
      expect(environment.prfWrapperBlocked).toBe(true)
      expect(environment.journalPhase).toBe('legacy-recovery-prepared')
      expect(tokens.get('ge_wallet_session_event') ?? null).not.toBe(staleToken)
      expect(staleClient.getState().isSessionCurrent(staleSnapshot)).toBe(false)
      expect(staleClient.getState().getPrivateKey()).toBeNull()
      expect(environment.biometricEnable).not.toHaveBeenCalled()

      releaseWrite()
      await migration

      expect(environment.legacy).toBe(false)
      expect(environment.legacyWrapperBlocked).toBe(false)
      expect(environment.prfWrapperBlocked).toBe(false)
      expect(environment.journalPending).toBe(false)
      expect(environment.biometricEnable).toHaveBeenCalledTimes(1)
      expect(migrating.getState().status).toBe('unlocked')
      expect(await migrating.getState().checkPassword(replacement)).toBe(mnemonic)
      expect(await migrating.getState().checkPassword(password)).toBe(false)
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('preserves the new-password seed if a write commits but read-back fails', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.failReadAfterWrite = true
    const replacement = 'PUBLIC-Recovery-Readback-456!'
    await expect(store.getState().completeLegacyRecovery(recovery, replacement)).rejects.toMatchObject({
      code: 'COMMIT_UNCERTAIN', authorityConsumed: true, passwordCommit: 'uncertain', nextAction: 'reload-and-check-new-password',
    })
    expect(environment.legacy).toBe(true)
    expect(environment.secure.get('ge_secure:mnemonic')).not.toBe(golden.vaults[0].encrypted)
    environment.failRead = false
    environment.failReadAfterWrite = false
    await store.getState().initialize()
    const restored = await store.getState().checkPassword(replacement)
    expect(restored).toBe(mnemonic)
    expect(await store.getState().unlockWithPassword(replacement)).toBe(mnemonic)
    expect(store.getState().address).toBe(golden.seeds[0].address)
  })

  it('keeps new-password access when credential cleanup fails after the seed commit', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.failCredentialCleanup = true
    const replacement = 'PUBLIC-Recovery-Cleanup-456!'
    await expect(store.getState().completeLegacyRecovery(recovery, replacement)).rejects.toThrow('password was upgraded')
    expect(environment.legacy).toBe(true)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().biometric.enabled).toBe(true)
    environment.failCredentialCleanup = false
    await store.getState().initialize()
    expect(await store.getState().checkPassword(replacement)).toBe(mnemonic)
    await store.getState().retireLegacyWithPassword(replacement)
    expect(environment.legacy).toBe(false)
  })

  it('refuses successful deletion when the platform silently ignores remove', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    environment.noopRemove = true
    await expect(store.getState().resetWallet(password)).rejects.toThrow('did not remove')
    expect(store.getState().status).toBe('error')
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(true)
  })

  it('does not claim backup completion after a failed atomic metadata write', async () => {
    const store = await loadStore()
    await store.getState().createWallet(password, false)
    const previousSeed = environment.secure.get('ge_secure:mnemonic')
    const previousMetadata = environment.basic.get('ge_basic:wallet_vault_v2')
    environment.failBasicSetKey = 'ge_basic:wallet_vault_v2'

    await expect(store.getState().backupWallet()).rejects.toThrow('basic write failure')

    expect(store.getState().status).toBe('backup')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(previousSeed)
    expect(environment.basic.get('ge_basic:wallet_vault_v2')).toBe(previousMetadata)
    expect(JSON.parse(previousMetadata!).backedUp).toBe(false)
  })
})


describe('independent QA legacy-capability expiry and revocation regressions', () => {
  async function recover() {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    return { store, recovery: await store.getState().recoverLegacyAccess() }
  }

  it('exposes only immutable opaque legacy-recovery ticket metadata', async () => {
    const { recovery } = await recover()

    expect(Object.keys(recovery).sort()).toEqual(['expiresAt', 'ticketId'])
    expect(Object.isFrozen(recovery)).toBe(true)
    expect(recovery).not.toHaveProperty('password')
    expect(recovery).not.toHaveProperty('mnemonic')
  })

  it('uses private authority when caller-injected recovery fields try to redirect normal recovery', async () => {
    const { store, recovery } = await recover()
    const replacement = 'PUBLIC-New-Password-456!'
    const callerControlledClone = {
      ...recovery,
      expiresAt: 0,
      vaultId: 'attacker-wallet',
      vaultRevision: Number.MAX_SAFE_INTEGER,
      biometricGeneration: Number.MAX_SAFE_INTEGER,
      sessionRevision: Number.MAX_SAFE_INTEGER,
      storageToken: 'attacker-session',
      password: 'PUBLIC-Attacker-Password-456!',
      mnemonic: golden.seeds[1].mnemonic,
    }

    await store.getState().completeLegacyRecovery(callerControlledClone, replacement)

    expect(store.getState().address).toBe(golden.seeds[0].address)
    expect(await store.getState().checkPassword(replacement)).toBe(mnemonic)
    expect(await store.getState().checkPassword(password)).toBe(false)
    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-Another-Password-456!')).rejects.toThrow('cancelled')
  })

  it('rejects an expired recovery ticket even when a cloned object extends its visible expiry and authority fields', async () => {
    const { store, recovery } = await recover()
    const authoritativeExpiry = recovery.expiresAt
    const callerControlledClone = {
      ...recovery,
      expiresAt: Number.MAX_SAFE_INTEGER,
      vaultId: 'attacker-wallet',
      vaultRevision: Number.MAX_SAFE_INTEGER,
      biometricGeneration: Number.MAX_SAFE_INTEGER,
      sessionRevision: Number.MAX_SAFE_INTEGER,
      storageToken: 'attacker-session',
      password: 'PUBLIC-Attacker-Password-456!',
      mnemonic: golden.seeds[1].mnemonic,
    }
    vi.spyOn(Date, 'now').mockReturnValue(authoritativeExpiry + 1)

    await expect(store.getState().completeLegacyRecovery(callerControlledClone, 'PUBLIC-New-Password-456!')).rejects.toThrow('expired')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
    expect(environment.legacy).toBe(true)
    expect(store.getState().getPrivateKey()).toBeNull()
  })

  it('revokes recovery when its UI is cancelled or closed', async () => {
    const { store, recovery } = await recover()
    store.getState().cancelLegacyRecovery()
    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).rejects.toThrow('cancelled')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
  })

  it('supersedes an older ticket without letting it cancel the current private authority', async () => {
    const { store, recovery: superseded } = await recover()
    const currentRecovery = await store.getState().recoverLegacyAccess()

    await expect(store.getState().completeLegacyRecovery(superseded, 'PUBLIC-Stale-Password-456!')).rejects.toThrow('cancelled')
    await store.getState().completeLegacyRecovery(currentRecovery, 'PUBLIC-Current-Password-456!')

    expect(await store.getState().checkPassword('PUBLIC-Current-Password-456!')).toBe(mnemonic)
  })

  it('keeps a redeemed recovery authoritative when cancellation arrives during an awaited vault read', async () => {
    const { store, recovery } = await recover()
    let release!: () => void
    environment.readGate = new Promise<void>(resolve => { release = resolve })
    const pending = store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')
    await Promise.resolve()
    store.getState().cancelLegacyRecovery()
    release()
    await expect(pending).resolves.toMatchObject({
      completed: true, authorityConsumed: true, passwordCommit: 'verified', nextAction: 'unlock-with-new-password',
    })
    expect(await store.getState().checkPassword('PUBLIC-New-Password-456!')).toBe(mnemonic)
  })
})


it.each(['success', 'before-commit-failure', 'after-commit-failure'] as const)('S4: deletion exit %s revokes sessions opened during deletion before storage events', async outcome => {
  const previousWindow = window
  const previousNavigator = globalThis.navigator
  const tokens = new Map<string, string>()
  vi.stubGlobal('window', { ...previousWindow, localStorage: {
    getItem: (key: string) => tokens.get(key) ?? null,
    setItem: (key: string, value: string) => { tokens.set(key, value) },
  } })
  const lockRequest = vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation())
  vi.stubGlobal('navigator', { locks: { request: lockRequest } })
  try {
    const deleting = await loadStore()
    await deleting.getState().importWallet(mnemonic, password, false)
    lockRequest.mockClear()
    let finish!: () => void
    environment.removeGate = new Promise<void>(resolve => { finish = resolve })
    const deletion = deleting.getState().resetWallet(password)
    await vi.waitFor(() => expect(environment.removeStarted).toHaveBeenCalled())
    vi.resetModules()
    const anotherTab = await loadStore()
    await anotherTab.getState().initialize()
    await anotherTab.getState().unlockWallet(mnemonic)
    const duringDeletion = anotherTab.getState().getSessionSnapshot()
    expect(anotherTab.getState().isSessionCurrent(duringDeletion)).toBe(true)
    if (outcome === 'before-commit-failure') environment.failRemove = true
    if (outcome === 'after-commit-failure') environment.failKeys = true
    finish()
    if (outcome === 'success') await deletion
    else await expect(deletion).rejects.toThrow()
    expect(anotherTab.getState().isSessionCurrent(duringDeletion)).toBe(false)
    expect(anotherTab.getState().getPrivateKey()).toBeNull()
    expect(lockRequest.mock.calls.map(call => call[0])).toContain('goldenera-wallet-authorization-barrier')
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(outcome === 'before-commit-failure')
    environment.failRemove = false
    environment.failKeys = false
  } finally {
    vi.stubGlobal('window', previousWindow)
    vi.stubGlobal('navigator', previousNavigator)
  }
})


it.each([['create', false], ['create', true], ['import', false], ['import', true]] as const)('S4: %s exit (readback failure=%s) revokes a token captured during commit', async (mode, readbackFailure) => {
  const previousWindow = window
  const previousNavigator = globalThis.navigator
  const tokens = new Map<string, string>()
  vi.stubGlobal('window', { ...previousWindow, localStorage: {
    getItem: (key: string) => tokens.get(key) ?? null,
    setItem: (key: string, value: string) => { tokens.set(key, value) },
  } })
  const lockRequest = vi.fn(async (_name: string, operation: () => Promise<unknown>) => operation())
  vi.stubGlobal('navigator', { locks: { request: lockRequest } })
  try {
    const creator = await loadStore()
    let finish!: () => void
    environment.writeGate = new Promise<void>(resolve => { finish = resolve })
    const creation = mode === 'create' ? creator.getState().createWallet(password, false) : creator.getState().importWallet(mnemonic, password, false)
    await vi.waitFor(() => expect(environment.writeCommitted).toHaveBeenCalled())
    const duringCommit = tokens.get('ge_wallet_session_event')
    expect(duringCommit).toBeTypeOf('string')

    environment.failReadAfterWrite = readbackFailure
    finish()
    if (readbackFailure) await expect(creation).rejects.toThrow('read-back')
    else await creation

    expect(tokens.get('ge_wallet_session_event')).not.toBe(duringCommit)
    expect(lockRequest.mock.calls.map(call => call[0])).toContain('goldenera-wallet-authorization-barrier')
    environment.failRead = false
    environment.failReadAfterWrite = false
    await creator.getState().initialize()
    expect(await creator.getState().checkPassword(password)).toBeTypeOf('string')
  } finally {
    vi.stubGlobal('window', previousWindow)
    vi.stubGlobal('navigator', previousNavigator)
  }
})

it.each(['success', 'before-commit-failure', 'readback-failure', 'cleanup-failure'] as const)('S4: password migration exit %s revokes a token captured during its write', async outcome => {
  const previousWindow = window
  const previousNavigator = globalThis.navigator
  const tokens = new Map<string, string>()
  vi.stubGlobal('window', { ...previousWindow, localStorage: {
    getItem: (key: string) => tokens.get(key) ?? null,
    setItem: (key: string, value: string) => { tokens.set(key, value) },
  } })
  vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() } })
  try {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const migrating = await loadStore()
    await migrating.getState().initialize()
    const recovery = await migrating.getState().recoverLegacyAccess()
    const replacement = 'PUBLIC-New-Password-456!'
    let finish!: () => void
    if (outcome === 'before-commit-failure') environment.beforeWriteGate = new Promise<void>(resolve => { finish = resolve })
    else environment.writeGate = new Promise<void>(resolve => { finish = resolve })
    const migration = migrating.getState().completeLegacyRecovery(recovery, replacement)
    await vi.waitFor(() => expect(outcome === 'before-commit-failure' ? environment.beforeWriteStarted : environment.writeCommitted).toHaveBeenCalled())
    const duringMigration = tokens.get('ge_wallet_session_event')
    expect(duringMigration).toBeTypeOf('string')

    environment.failWrite = outcome === 'before-commit-failure'
    environment.failReadAfterWrite = outcome === 'readback-failure'
    environment.failCredentialCleanup = outcome === 'cleanup-failure'
    finish()
    if (outcome === 'success') await migration
    else await expect(migration).rejects.toThrow()

    expect(tokens.get('ge_wallet_session_event')).not.toBe(duringMigration)
    environment.failRead = false
    environment.failReadAfterWrite = false
    environment.failWrite = false
    environment.failCredentialCleanup = false
    await migrating.getState().initialize()
    expect(await migrating.getState().checkPassword(outcome === 'before-commit-failure' ? password : replacement)).toBe(mnemonic)
  } finally {
    vi.stubGlobal('window', previousWindow)
    vi.stubGlobal('navigator', previousNavigator)
  }
})


describe('authoritative biometric generation and orphan-state recovery', () => {
  it('removes sensitive biometric residue before exposing no-wallet onboarding', async () => {
    environment.legacy = true
    environment.journalPending = true
    environment.journalPhase = 'password-only-retirement'
    environment.biometricGeneration = 4
    environment.basic.set('ge_basic:biometric_generation_v1', JSON.stringify({ version: 1, walletId: 'deleted-wallet', generation: 4 }))
    const store = await loadStore()

    await store.getState().initialize()

    expect(store.getState().status).toBe('no_wallet')
    expect(environment.legacy).toBe(false)
    expect(environment.journalPending).toBe(false)
    expect(environment.biometricGeneration).toBe(0)
    await expect(store.getState().importWallet(mnemonic, password, false)).resolves.toMatchObject({ address: golden.seeds[0].address })
  })

  it('blocks onboarding when sensitive orphan cleanup cannot be verified', async () => {
    environment.legacy = true
    environment.failOrphanCleanup = true
    const store = await loadStore()

    await store.getState().initialize()

    expect(store.getState().status).toBe('error')
    await expect(store.getState().importWallet(mnemonic, password, false)).rejects.toThrow('orphan cleanup failure')
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
  })

  it('does not let a harmless lone marker block onboarding when marker cleanup fails', async () => {
    environment.harmlessMarker = true
    environment.failOrphanCleanup = true
    const store = await loadStore()

    await store.getState().initialize()
    expect(store.getState().status).toBe('no_wallet')
    await expect(store.getState().importWallet(mnemonic, password, false)).resolves.toMatchObject({ address: golden.seeds[0].address })
  })

  it('claims wallet creation before asynchronous orphan preflight begins', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    environment.biometricInspectStarted.mockClear()
    let finishInspection!: () => void
    environment.biometricInspectGate = new Promise<void>(resolve => { finishInspection = resolve })

    const first = store.getState().importWallet(mnemonic, password, false)
    await vi.waitFor(() => expect(environment.biometricInspectStarted).toHaveBeenCalled())

    await expect(store.getState().importWallet(golden.seeds[1].mnemonic, password, false)).rejects.toThrow('Another wallet update')
    finishInspection()
    environment.biometricInspectGate = null
    await expect(first).resolves.toMatchObject({ address: golden.seeds[0].address })
    expect(store.getState().address).toBe(golden.seeds[0].address)
  })

  it('resets the cached generation before creating a biometric wallet after deletion', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    await store.getState().importWallet(mnemonic, password, false)
    const deletedWalletId = store.getState().vaultId!
    environment.biometricGeneration = 7
    environment.basic.set('ge_basic:biometric_generation_v1', JSON.stringify({ version: 1, walletId: deletedWalletId, generation: 7 }))
    environment.biometricGenerationListener?.({ sourceId: 'other-tab', walletId: deletedWalletId, generation: 7, nonce: 'generation-seven' })
    await vi.waitFor(() => expect(environment.biometricGeneration).toBe(7))
    let finishRemoval!: () => void
    environment.removeGate = new Promise<void>(resolve => { finishRemoval = resolve })
    const deletion = store.getState().resetWallet(password)
    await vi.waitFor(() => expect(environment.removeStarted).toHaveBeenCalled())
    let finishStaleRead!: () => void
    environment.readGate = new Promise<void>(resolve => { finishStaleRead = resolve })
    environment.biometricGenerationListener?.({ sourceId: 'delayed-tab', walletId: deletedWalletId, generation: 7, nonce: 'delayed-generation-seven' })
    finishRemoval()
    await deletion
    finishStaleRead()
    environment.readGate = null
    environment.removeGate = null
    await store.getState().importWallet(golden.seeds[1].mnemonic, password, true)

    expect(environment.biometricGeneration).toBe(0)
    expect(environment.biometricEnable).toHaveBeenCalledTimes(1)
    expect(store.getState().biometric.enabled).toBe(true)
  })

  it('authoritatively resynchronizes a missed generation event before password unlock', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    environment.biometricGeneration = 9

    await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

    expect(store.getState().status).toBe('unlocked')
  })

  it('retries when a generation event arrives during biometric inspection', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    environment.biometricInspectStarted.mockClear()
    let finishInspection!: () => void
    environment.biometricInspectGate = new Promise<void>(resolve => { finishInspection = resolve })

    const unlock = store.getState().unlockWithPassword(password)
    await vi.waitFor(() => expect(environment.biometricInspectStarted).toHaveBeenCalled())

    let finishListenerRead!: () => void
    environment.readGate = new Promise<void>(resolve => { finishListenerRead = resolve })
    environment.biometricEnabled = true
    environment.biometricGeneration = 1
    environment.biometricGenerationListener?.({ sourceId: 'other-tab', walletId: store.getState().vaultId!, generation: 1, nonce: 'during-inspection' })
    finishInspection()
    finishListenerRead()
    environment.readGate = null

    await expect(unlock).resolves.toBe(mnemonic)
    expect(store.getState().biometric.enabled).toBe(true)

    environment.biometricInspectGate = null
  })

  it.each(['password-only-retirement', 'disable-biometric'] as const)('resumes %s cleanup without enrolling a credential', async phase => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.journalPending = true
    environment.journalPhase = phase
    const store = await loadStore()
    await store.getState().initialize()

    await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(environment.legacy).toBe(false)
    expect(environment.journalPending).toBe(false)
    expect(store.getState().status).toBe('unlocked')
  })

  it('treats a journal-less historical legacy tombstone as password-only cleanup', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    // This models an old bundle crashing after its first cached-wrapper
    // tombstone but before it persisted a migration discriminator.
    environment.legacy = true
    environment.legacyWrapperBlocked = true
    environment.biometricEnabled = true
    environment.biometricGeneration = 1
    const store = await loadStore()
    await store.getState().initialize()

    await expect(store.getState().unlockWithBiometric()).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(environment.biometricAssertion).not.toHaveBeenCalled()
    await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(environment.biometricEnabled).toBe(false)
    expect(environment.legacy).toBe(false)
    expect(environment.journalPending).toBe(false)
    expect(store.getState().status).toBe('unlocked')
  })

  it('finishes an interrupted disable with password without biometric resurrection', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.biometricEnabled = true
    environment.biometricGeneration = 1
    environment.journalPending = true
    environment.journalPhase = 'disable-biometric'
    const store = await loadStore()
    await store.getState().initialize()

    await expect(store.getState().unlockWithBiometric()).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(environment.biometricAssertion).not.toHaveBeenCalled()
    expect(environment.biometricEnabled).toBe(true)
    expect(environment.journalPending).toBe(true)
    expect(environment.journalPhase).toBe('disable-biometric')

    await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

    expect(environment.biometricAssertion).not.toHaveBeenCalled()
    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(environment.biometricEnabled).toBe(false)
    expect(environment.legacy).toBe(false)
    expect(environment.journalPending).toBe(false)
    expect(environment.journalPhase).toBeNull()
    expect(environment.biometricGeneration).toBe(2)
    expect(store.getState().status).toBe('unlocked')
  })

  it('blocks mnemonic-only open while malformed PRF state is pending', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    environment.prfMalformed = true

    expect(await store.getState().unlockWallet(mnemonic)).toBe(false)
    expect(store.getState().status).toBe('locked')
  })

  it('retires malformed PRF state with a verified password instead of enrolling over it', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.prfMalformed = true
    const store = await loadStore()
    await store.getState().initialize()

    await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

    expect(environment.prfMalformed).toBe(false)
    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(store.getState().status).toBe('unlocked')
  })

  it('requires password repair when malformed generation coincides with a historical retirement tombstone', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.legacyWrapperBlocked = true
    environment.biometricEnabled = true
    environment.generationMalformed = true
    const store = await loadStore()
    await store.getState().initialize()

    await expect(store.getState().unlockWithBiometric())
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(environment.biometricAssertion).not.toHaveBeenCalled()
    expect(environment.biometricGeneration).toBe(0)
    expect(environment.generationMalformed).toBe(true)
    expect(environment.biometricEnable).not.toHaveBeenCalled()

    await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)
    expect(environment.generationMalformed).toBe(false)
    expect(environment.biometricEnabled).toBe(false)
    expect(environment.legacy).toBe(false)
    expect(environment.biometricEnable).not.toHaveBeenCalled()
    expect(store.getState().status).toBe('unlocked')
  })

  it('repairs malformed generation with the matching biometric envelope and opens the address-bound wallet', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().lockWallet()
    environment.basic.set('ge_basic:biometric_generation_v1', '{malformed')
    environment.generationMalformed = true
    environment.biometricEnabled = true

    await expect(store.getState().unlockWithBiometric()).resolves.toEqual({ password, mnemonic })

    expect(environment.biometricRepair).toHaveBeenCalledTimes(1)
    expect(environment.biometricAssertion).toHaveBeenCalledTimes(1)
    expect(environment.generationMalformed).toBe(false)
    expect(environment.biometricGeneration).toBe(17)
    expect(environment.biometricEnabled).toBe(true)
    expect(store.getState().status).toBe('unlocked')
    expect(store.getState().address).toBe(golden.seeds[0].address)
  })

  it('reloads a wallet with malformed generation metadata and repairs it after password verification when biometric repair is unavailable', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.basic.set('ge_basic:biometric_generation_v1', '{malformed')
    environment.generationMalformed = true
    environment.biometricEnabled = true
    const first = await loadStore()
    await first.getState().initialize()
    expect(first.getState().status).toBe('locked')
    expect(first.getState().error).toContain('metadata is damaged')

    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    await expect(reloaded.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

    expect(environment.generationMalformed).toBe(false)
    expect(environment.biometricGeneration).toBe(0)
    expect(environment.biometricEnabled).toBe(false)
    expect(reloaded.getState().status).toBe('unlocked')
    expect(reloaded.getState().error).toContain('reset safely')
    expect(environment.biometricEnable).not.toHaveBeenCalled()
  })

  it('revokes a recovered-password ticket on a delivered cross-tab generation change', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.biometricGeneration = 1
    environment.biometricGenerationListener?.({ sourceId: 'other-tab', walletId: store.getState().vaultId!, generation: 1, nonce: 'revoke-ticket' })

    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).rejects.toMatchObject({ code: 'PRECOMMIT_FAILED', authorityConsumed: true, passwordCommit: 'not-started', nextAction: 'verify-again' })
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
  })

  it('detects a missed generation event before committing a recovered password', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.biometricGeneration = 2

    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).rejects.toMatchObject({ code: 'PRECOMMIT_FAILED', authorityConsumed: true, passwordCommit: 'not-started', nextAction: 'verify-again' })
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
  })
})

describe('malformed encrypted vault storage', () => {
  type EnvelopeMutation = (payload: Record<string, string>) => void
  type StoredSource = 'raw-v1' | 'outer-v2' | 'sidecar-raw-v1'
  const metadataKey = 'ge_basic:wallet_vault_v2'

  const malformedEnvelope = (mutate: EnvelopeMutation) => {
    const payload = JSON.parse(golden.vaults[0].encrypted) as Record<string, string>
    mutate(payload)
    return JSON.stringify(payload)
  }
  const persist = async (source: StoredSource, encryptedMnemonic: string) => {
    if (source === 'outer-v2') {
      environment.secure.set('ge_secure:mnemonic', JSON.stringify({ ...previousV2.record, encryptedMnemonic }))
      return
    }
    environment.secure.set('ge_secure:mnemonic', encryptedMnemonic)
    if (source === 'sidecar-raw-v1') {
      environment.basic.set(metadataKey, JSON.stringify({
        version: 2,
        id: 'sidecar-corruption-test',
        revision: 0,
        address: golden.seeds[0].address,
        backedUp: true,
        ciphertextDigest: bufferToHex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptedMnemonic))),
      }))
    }
  }
  const snapshotStorage = () => ({ secure: new Map(environment.secure), basic: new Map(environment.basic) })

  it.each([
    ['empty value', ''],
    ['whitespace value', ' \n\t '],
    ['truncated JSON', '{"v":1'],
    ['JSON null', 'null'],
    ['JSON number', '17'],
    ['JSON string', '"PUBLIC-INVALID-SEED-CONTENT"'],
    ['JSON boolean', 'true'],
    ['JSON array', '[]'],
    ['wrong top-level object', JSON.stringify({ version: 2, id: 'missing-required-wallet-fields' })],
  ] as const)('classifies a present %s as typed corruption without mutating storage', async (_name, stored) => {
    environment.secure.set('ge_secure:mnemonic', stored)
    environment.basic.set(metadataKey, JSON.stringify({
      version: 2,
      id: 'corrupt-seed-metadata-must-remain',
      revision: 7,
      address: golden.seeds[0].address,
      backedUp: true,
      ciphertextDigest: '00'.repeat(32),
    }))
    environment.basic.set('ge_basic:wallet-corruption-sentinel', 'preserve-me')
    const before = snapshotStorage()
    const store = await loadStore()

    await store.getState().initialize()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toContain('Wallet storage is corrupted')
    await expect(store.getState().checkPassword(password)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    await expect(store.getState().unlockWithPassword(password)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    await expect(store.getState().resetWallet(password)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    const { WalletVaultService, withWalletMutation } = await import('../../packages/core/src/services/WalletVaultService')
    await expect(withWalletMutation(scope => WalletVaultService.removeMetadataAfterSeedDeletion(scope)))
      .rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    expect(store.getState().error).not.toContain('PUBLIC-INVALID-SEED-CONTENT')
    expect(environment.secure).toEqual(before.secure)
    expect(environment.basic).toEqual(before.basic)
    expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
    expect(environment.writeCommitted).not.toHaveBeenCalled()
    expect(environment.removeStarted).not.toHaveBeenCalled()
    expect(environment.basicSetCommitted).not.toHaveBeenCalled()
    expect(environment.basicRemoveStarted).not.toHaveBeenCalled()
  })

  it('keeps secure-storage transport failures outside the corrupt-bytes boundary', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    const before = snapshotStorage()
    environment.failRead = true
    const { WalletVaultService } = await import('../../packages/core/src/services/WalletVaultService')

    const transportError = await WalletVaultService.inspect().catch(error => error)
    expect(transportError).toBeInstanceOf(Error)
    expect(transportError).not.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    expect((transportError as Error).message).toContain('read-back failure')

    const store = await loadStore()
    await store.getState().initialize()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toContain('storage is unavailable or changed')
    expect(environment.secure).toEqual(before.secure)
    expect(environment.basic).toEqual(before.basic)
    expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
    expect(environment.removeStarted).not.toHaveBeenCalled()
    expect(environment.basicSetCommitted).not.toHaveBeenCalled()
    expect(environment.basicRemoveStarted).not.toHaveBeenCalled()
  })

  it.each([
    ['non-hexadecimal field', (payload: Record<string, string>) => { payload.iv = 'gg'.repeat(CryptoUtil.IV_LENGTH_BYTES) }],
    ['odd-length field', (payload: Record<string, string>) => { payload.data = '0'.repeat(CryptoUtil.AES_GCM_TAG_LENGTH_BYTES * 2 - 1) }],
    ['empty ciphertext', (payload: Record<string, string>) => { payload.data = '' }],
    ['wrong IV length', (payload: Record<string, string>) => { payload.iv = '00'.repeat(CryptoUtil.IV_LENGTH_BYTES - 1) }],
    ['wrong salt length', (payload: Record<string, string>) => { payload.salt = '00'.repeat(CryptoUtil.SALT_LENGTH_BYTES - 1) }],
    ['ciphertext shorter than the GCM tag', (payload: Record<string, string>) => { payload.data = '00'.repeat(CryptoUtil.AES_GCM_TAG_LENGTH_BYTES - 1) }],
  ] as const)('%s is corruption, never a wrong password, for every persisted source', async (_name, mutate) => {
    for (const source of ['raw-v1', 'outer-v2', 'sidecar-raw-v1'] as const) {
      const encryptedMnemonic = malformedEnvelope(mutate)
      await persist(source, encryptedMnemonic)
      const before = snapshotStorage()
      const store = await loadStore()

      await store.getState().initialize()
      expect(store.getState().status).toBe('error')
      expect(store.getState().error).toContain('Wallet storage is corrupted')
      await expect(store.getState().checkPassword(password)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
      expect(store.getState().error).toContain('recover this wallet with its recovery phrase')
      await expect(store.getState().unlockWithPassword(password)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
      await expect(store.getState().resetWallet(password)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
      expect(environment.secure).toEqual(before.secure)
      expect(environment.basic).toEqual(before.basic)
      expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
      expect(environment.writeCommitted).not.toHaveBeenCalled()
      expect(environment.removeStarted).not.toHaveBeenCalled()
      vi.resetModules()
      environment.secure.clear()
      environment.basic.clear()
    }
  })

  it('rejects malformed raw promotion and legacy recovery before any mutation', async () => {
    const encryptedMnemonic = malformedEnvelope(payload => { payload.data = '' })
    environment.secure.set('ge_secure:mnemonic', encryptedMnemonic)
    const before = snapshotStorage()
    const { WalletVaultService } = await import('../../packages/core/src/services/WalletVaultService')

    await expect(WalletVaultService.promoteLegacy({
      source: 'raw-v1',
      vault: {
        version: 2,
        id: 'legacy-corrupted-vault',
        revision: 0,
        address: null,
        encryptedMnemonic,
        backedUp: true,
      },
    }, password, mnemonic)).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })

    const store = await loadStore()
    await store.getState().initialize()
    await expect(store.getState().recoverLegacyAccess()).rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    expect(environment.secure).toEqual(before.secure)
    expect(environment.basic).toEqual(before.basic)
    expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
    expect(environment.writeCommitted).not.toHaveBeenCalled()
    expect(environment.removeStarted).not.toHaveBeenCalled()
  })

  it.each(['raw-v1', 'outer-v2', 'sidecar-raw-v1'] as const)('keeps a valid-shape %s wrong password as a normal credential failure', async source => {
    await persist(source, golden.vaults[0].encrypted)
    const before = snapshotStorage()
    const store = await loadStore()

    await store.getState().initialize()
    expect(store.getState().status).toBe('locked')
    expect(await store.getState().checkPassword(`${password}-wrong`)).toBe(false)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().error ?? '').not.toContain('corrupted')
    expect(environment.secure).toEqual(before.secure)
    expect(environment.basic).toEqual(before.basic)
    expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
    expect(environment.writeCommitted).not.toHaveBeenCalled()
    expect(environment.removeStarted).not.toHaveBeenCalled()
  })
})

describe('digest-bound wallet sidecar recovery', () => {
  const metadataKey = 'ge_basic:wallet_vault_v2'
  const digest = async (value: string) => bufferToHex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

  it('never removes metadata when secure-storage transport cannot prove seed absence', async () => {
    const orphan = JSON.stringify({
      version: 2,
      id: 'unknown-seed-presence-wallet',
      revision: 0,
      address: golden.seeds[0].address,
      backedUp: true,
      ciphertextDigest: '00'.repeat(32),
    })
    environment.basic.set(metadataKey, orphan)
    environment.failKeys = true
    const store = await loadStore()

    await store.getState().initialize()

    expect(store.getState().status).toBe('error')
    expect(environment.basic.get(metadataKey)).toBe(orphan)
    expect(environment.basicRemoveStarted).not.toHaveBeenCalled()
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)

    environment.failKeys = false
    await store.getState().initialize()
    expect(store.getState().status).toBe('no_wallet')
    expect(environment.basic.has(metadataKey)).toBe(false)
  })

  it.each(['throw', 'ignore'] as const)('refuses onboarding when orphan sidecar removal must not %s', async failure => {
    environment.basic.set(metadataKey, JSON.stringify({
      version: 2,
      id: 'orphan-wallet',
      revision: 0,
      address: null,
      backedUp: false,
      ciphertextDigest: '00'.repeat(32),
    }))
    if (failure === 'throw') environment.failBasicRemoveKey = metadataKey
    else environment.noopBasicRemoveKey = metadataKey
    const store = await loadStore()
    await store.getState().initialize()

    await expect(store.getState().importWallet(mnemonic, password, false)).rejects.toThrow()

    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
    expect(store.getState().status).toBe('error')
  })

  it.each(['write', 'readback'] as const)('never commits a seed when initial metadata %s fails and safely cleans any orphan', async failure => {
    const store = await loadStore()
    await store.getState().initialize()
    if (failure === 'write') environment.failBasicSetKey = metadataKey
    else environment.failBasicReadAfterSetKey = metadataKey

    await expect(store.getState().importWallet(mnemonic, password, false)).rejects.toThrow()

    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
    expect(store.getState().status).toBe('error')
    expect(environment.beforeWriteStarted).not.toHaveBeenCalled()
    expect(environment.basic.has(metadataKey)).toBe(failure === 'readback')

    environment.failBasicSetKey = null
    environment.failBasicReadAfterSetKey = null
    environment.failBasicReadKey = null
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()

    expect(reloaded.getState().status).toBe('no_wallet')
    expect(reloaded.getState().vaultId).toBeNull()
    expect(environment.basic.has(metadataKey)).toBe(false)
    await expect(reloaded.getState().importWallet(mnemonic, password, false))
      .resolves.toMatchObject({ address: golden.seeds[0].address })
    expect(reloaded.getState().status).toBe('unlocked')
    expect(reloaded.getState().backupPhrase).toBeNull()
  })

  it('writes and verifies imported identity metadata before attempting the initial seed commit', async () => {
    const store = await loadStore()
    await store.getState().initialize()

    await store.getState().importWallet(mnemonic, password, false)

    const ciphertext = environment.secure.get('ge_secure:mnemonic')!
    const metadata = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    expect(metadata).toEqual({
      version: 2,
      id: `legacy-${await digest(ciphertext)}`,
      revision: 0,
      address: golden.seeds[0].address,
      backedUp: true,
      ciphertextDigest: await digest(ciphertext),
    })
    const metadataSetCall = environment.basicSetCommitted.mock.calls.findIndex(call => call[0] === metadataKey)
    expect(metadataSetCall).toBeGreaterThanOrEqual(0)
    expect(environment.basicSetCommitted.mock.invocationCallOrder[metadataSetCall])
      .toBeLessThan(environment.beforeWriteStarted.mock.invocationCallOrder[0])
    expect(store.getState().status).toBe('unlocked')
    expect(store.getState().backupPhrase).toBeNull()
  })

  it('cleans verified initial metadata after a pre-seed write failure, then permits an idempotent retry', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    environment.failWrite = true

    await expect(store.getState().importWallet(mnemonic, password, false)).rejects.toThrow('wallet write failure')

    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
    const orphan = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    expect(orphan).toMatchObject({
      version: 2,
      id: `legacy-${String(orphan.ciphertextDigest)}`,
      revision: 0,
      address: golden.seeds[0].address,
      backedUp: true,
    })
    expect(environment.basicSetCommitted.mock.invocationCallOrder[0])
      .toBeLessThan(environment.beforeWriteStarted.mock.invocationCallOrder[0])

    environment.failWrite = false
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().status).toBe('no_wallet')
    expect(environment.basic.has(metadataKey)).toBe(false)
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)

    await expect(reloaded.getState().importWallet(mnemonic, password, false))
      .resolves.toMatchObject({ address: golden.seeds[0].address })
    expect(reloaded.getState().status).toBe('unlocked')
    expect(reloaded.getState().backupPhrase).toBeNull()
  })

  it('reloads a committed imported seed with its authoritative backup state after pre-verification failure', async () => {
    const store = await loadStore()
    await store.getState().initialize()
    environment.failReadAfterWrite = true

    await expect(store.getState().importWallet(mnemonic, password, false)).rejects.toThrow('read-back failure')

    const ciphertext = environment.secure.get('ge_secure:mnemonic')!
    const committedMetadata = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    expect(committedMetadata).toEqual({
      version: 2,
      id: `legacy-${await digest(ciphertext)}`,
      revision: 0,
      address: golden.seeds[0].address,
      backedUp: true,
      ciphertextDigest: await digest(ciphertext),
    })
    expect(store.getState().status).toBe('error')

    environment.failRead = false
    environment.failReadAfterWrite = false
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().status).toBe('locked')
    expect(reloaded.getState().vaultId).toBe(committedMetadata.id)
    expect(reloaded.getState().vaultRevision).toBe(0)
    const { WalletVaultService } = await import('../../packages/core/src/services/WalletVaultService')
    expect(await WalletVaultService.inspect()).toMatchObject({
      source: 'v2',
      vault: {
        id: committedMetadata.id,
        revision: 0,
        address: golden.seeds[0].address,
        backedUp: true,
      },
    })
    expect(await reloaded.getState().checkPassword(`${password}-wrong`)).toBe(false)
    await expect(reloaded.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)
    expect(reloaded.getState().status).toBe('unlocked')
    expect(reloaded.getState().backupPhrase).toBeNull()
    expect(reloaded.getState().address).toBe(golden.seeds[0].address)
    expect(environment.basic.get(metadataKey)).toBe(JSON.stringify(committedMetadata))
  })

  it('keeps backedUp=false authoritative for a created-wallet control at the same crash boundary', async () => {
    const { WalletVaultService, withWalletMutation } = await import('../../packages/core/src/services/WalletVaultService')
    environment.failReadAfterWrite = true

    await expect(withWalletMutation(scope => WalletVaultService.create(
      mnemonic,
      golden.seeds[0].address,
      password,
      false,
      scope,
    ))).rejects.toThrow('read-back failure')

    const committedMetadata = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    expect(committedMetadata).toMatchObject({
      version: 2,
      revision: 0,
      address: golden.seeds[0].address,
      backedUp: false,
    })
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(true)

    environment.failRead = false
    environment.failReadAfterWrite = false
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().status).toBe('locked')
    await expect(reloaded.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)
    expect(reloaded.getState().status).toBe('backup')
    expect(reloaded.getState().backupPhrase).toBe(mnemonic)
    expect(reloaded.getState().vaultId).toBe(committedMetadata.id)
    expect(reloaded.getState().vaultRevision).toBe(0)
    expect(reloaded.getState().address).toBe(golden.seeds[0].address)
  })

  it('recovers the pending sidecar snapshot after ciphertext commit', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const committed = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    const replacement = 'PUBLIC-Pending-Sidecar-456!'
    const replacementCiphertext = await CryptoUtil.encrypt(mnemonic, replacement)
    const pending = {
      id: committed.id,
      revision: Number(committed.revision) + 1,
      address: committed.address,
      backedUp: committed.backedUp,
      ciphertextDigest: await digest(replacementCiphertext),
    }
    environment.basic.set(metadataKey, JSON.stringify({ ...committed, pending }))
    environment.secure.set('ge_secure:mnemonic', replacementCiphertext)

    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().vaultId).toBe(committed.id)
    expect(reloaded.getState().vaultRevision).toBe(pending.revision)
    await expect(reloaded.getState().unlockWithPassword(replacement)).resolves.toBe(mnemonic)

    const recovered = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    expect(recovered.id).toBe(committed.id)
    expect(recovered.revision).toBe(pending.revision)
    expect(recovered).not.toHaveProperty('pending')
  })

  it.each([
    null,
    { id: 'missing-fields' },
    {
      id: 'foreign-wallet',
      revision: 1,
      address: golden.seeds[0].address,
      backedUp: false,
      ciphertextDigest: '11'.repeat(32),
    },
  ])('keeps a matching committed snapshot when optional pending metadata is malformed', async malformedPending => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const committed = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    environment.basic.set(metadataKey, JSON.stringify({ ...committed, pending: malformedPending }))

    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()

    expect(reloaded.getState().vaultId).toBe(committed.id)
    expect(reloaded.getState().vaultRevision).toBe(committed.revision)
    await expect(reloaded.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)
    expect(reloaded.getState().status).toBe('unlocked')
  })

  it('fails closed when committed metadata does not match and pending metadata is malformed', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const committed = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    environment.basic.set(metadataKey, JSON.stringify({
      ...committed,
      ciphertextDigest: '22'.repeat(32),
      pending: { id: committed.id },
    }))

    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()

    expect(reloaded.getState().status).toBe('error')
    expect(reloaded.getState().error).toContain('storage is unavailable or changed')
    await expect(reloaded.getState().unlockWithPassword(password)).rejects.toThrow()
  })

  it('keeps sidecar identity when a cached bundle wraps its raw ciphertext', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    const ciphertext = environment.secure.get('ge_secure:mnemonic')!
    const metadata = JSON.parse(environment.basic.get(metadataKey)!) as Record<string, unknown>
    environment.secure.set('ge_secure:mnemonic', JSON.stringify({
      version: 2,
      id: metadata.id,
      revision: 0,
      address: golden.seeds[0].address,
      encryptedMnemonic: ciphertext,
      backedUp: true,
    }))

    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    expect(reloaded.getState().vaultId).toBe(metadata.id)
    expect(reloaded.getState().vaultRevision).toBe(metadata.revision)
    await expect(reloaded.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)
    expect(reloaded.getState().status).toBe('unlocked')
    expect(JSON.parse(environment.basic.get(metadataKey)!).id).toBe(metadata.id)
  })
})


describe('existing approved v2 vault forward compatibility', () => {
  it('keeps raw-v1 password access in read-only recovery mode without Web Locks', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', {})
    try {
      const raw = golden.vaults[0].encrypted
      environment.secure.set('ge_secure:mnemonic', raw)
      environment.basic.set('ge_basic:backedup', 'true')
      const store = await loadStore()
      await store.getState().initialize()

      await expect(store.getState().unlockWithPassword(password)).resolves.toBe(mnemonic)

      expect(store.getState().status).toBe('unlocked')
      expect(store.getState().address).toBe(golden.seeds[0].address)
      expect(store.getState().error).toContain('read-only recovery mode')
      expect(environment.secure.get('ge_secure:mnemonic')).toBe(raw)
      expect(environment.basic.has('ge_basic:wallet_vault_v2')).toBe(false)
      await expect(store.getState().resetWallet(password)).rejects.toThrow('cannot safely update')
      expect(environment.secure.get('ge_secure:mnemonic')).toBe(raw)
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('rejects biometric unlock before an authenticator ceremony when Web Locks are unavailable', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', {})
    try {
      environment.secure.set('ge_secure:mnemonic', JSON.stringify(previousV2.record))
      environment.biometricEnabled = true
      const store = await loadStore()
      await store.getState().initialize()

      await expect(store.getState().unlockWithBiometric()).rejects.toThrow('cannot safely use Biometrics')

      expect(environment.biometricAssertion).not.toHaveBeenCalled()
      expect(store.getState().status).toBe('locked')
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('opens a clean v2 wallet read-only when localStorage exists without Web Locks', async () => {
    const previousWindow = window
    const previousNavigator = globalThis.navigator
    const tokens = new Map<string, string>()
    vi.stubGlobal('window', { ...previousWindow, localStorage: {
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => { tokens.set(key, value) },
    } })
    vi.stubGlobal('navigator', {})
    try {
      const raw = JSON.stringify(previousV2.record)
      environment.secure.set('ge_secure:mnemonic', raw)
      const store = await loadStore()
      await store.getState().initialize()

      await expect(store.getState().unlockWithPassword(previousV2.password)).resolves.toBe(mnemonic)

      expect(store.getState().status).toBe('unlocked')
      expect(store.getState().address).toBe(previousV2.address)
      expect(environment.secure.get('ge_secure:mnemonic')).toBe(raw)
    } finally {
      vi.stubGlobal('window', previousWindow)
      vi.stubGlobal('navigator', previousNavigator)
    }
  })

  it('opens the record captured from the previous production build without rewriting it', async () => {
    const raw = JSON.stringify(previousV2.record)
    environment.secure.set('ge_secure:mnemonic', raw)
    const store = await loadStore()
    await store.getState().initialize()
    expect(store.getState().status).toBe('locked')
    const seed = await store.getState().checkPassword(previousV2.password)
    expect(seed).toBe(mnemonic)
    await store.getState().unlockWallet(seed as string)
    expect(store.getState().address).toBe(previousV2.address)
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(raw)
  })

  it('retains v2 access and identity after a failed password and a fresh app instance', async () => {
    const raw = JSON.stringify(previousV2.record)
    environment.secure.set('ge_secure:mnemonic', raw)
    const first = await loadStore()
    await first.getState().initialize()
    expect(await first.getState().checkPassword('incorrect-password')).toBe(false)
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(raw)
    vi.resetModules()
    const reloaded = await loadStore()
    await reloaded.getState().initialize()
    await reloaded.getState().unlockWallet((await reloaded.getState().checkPassword(previousV2.password)) as string)
    expect(reloaded.getState().address).toBe(previousV2.address)
    expect(reloaded.getState().vaultId).toBe(previousV2.record.id)
    expect(reloaded.getState().vaultRevision).toBe(previousV2.record.revision)
  })
})
