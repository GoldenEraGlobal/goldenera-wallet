import type { PrivateKey } from '@goldenera/cryptoj'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { BiometricService, type BiometricContext, type BiometricEnrollmentResult } from '../services/BiometricService'
import { DeviceService } from '../services/DeviceService'
import { getBasicStorage, getStorage, STORAGE_MNEMONIC_KEY } from '../services/StorageService'
import { publishWalletInvalidation, readWalletSessionToken, subscribeWalletInvalidation } from '../services/WalletSessionService'
import { WalletVaultService, withWalletMutation, type WalletVault } from '../services/WalletVaultService'
import type { BiometricType } from '../utils/BiometricUtil'
import { CryptoUtil } from '../utils/CryptoUtil'
import { WalletUtil } from '../utils/WalletUtil'

export const SESSION_TIMEOUT_MS = 2 * 60 * 1000
export type WalletStatus = 'loading' | 'no_wallet' | 'locked' | 'unlocked' | 'backup' | 'error'
export interface WalletSessionSnapshot { revision: number; vaultId: string; address: string; storageToken: string | null }
export interface LegacyRecovery { password: string; mnemonic: string; vaultId: string; vaultRevision: number; sessionRevision: number; storageToken: string | null; expiresAt: number; ticketId: string }
class BiometricEnrollmentError extends Error {
  readonly verifiedEnabled: boolean
  readonly legacy: boolean
  constructor(message: string, verifiedEnabled: boolean, legacy: boolean) {
    super(message)
    this.verifiedEnabled = verifiedEnabled
    this.legacy = legacy
  }
}
export class LegacyRecoveryEnrollmentError extends Error {}
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
  unlockWallet: (mnemonic: string) => Promise<boolean>
  unlockWithBiometric: () => Promise<void>
  resolvePasswordWithBiometric: () => Promise<string>
  lockWallet: () => void
  resetWallet: () => Promise<void>
  backupWallet: () => Promise<void>
  getPrivateKey: () => PrivateKey | null
  getSessionSnapshot: () => WalletSessionSnapshot | null
  isSessionCurrent: (snapshot: WalletSessionSnapshot | null) => boolean
  checkSessionDeadline: () => boolean
  touchSession: () => void
  clearError: () => void
  toggleBiometric: (value: boolean, password: string) => Promise<void>
  retireLegacyWithPassword: (password: string) => Promise<string | null>
  recoverLegacyAccess: () => Promise<LegacyRecovery>
  cancelLegacyRecovery: () => void
  completeLegacyRecovery: (recovery: LegacyRecovery, newPassword: string) => Promise<void>
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
  let authAbort = new AbortController()
  let legacyRecoveryTicket: string | null = null

  const invalidate = (publish: boolean) => {
    legacyRecoveryTicket = null
    authAbort.abort()
    authAbort = new AbortController()
    set(state => ({ status: 'locked', address: null, _privateKey: null, backupPhrase: null, sessionExpiresAt: null, sessionStorageToken: null, sessionRevision: state.sessionRevision + 1, error: null }))
    if (publish) {
      try { publishWalletInvalidation() } catch { set({ error: 'Wallet locked locally; other tabs could not be notified. Close other wallet tabs.' }) }
    }
  }
  const current = (revision: number, token: string | null) => {
    try { return get().sessionRevision === revision && readWalletSessionToken() === token } catch { return false }
  }
  const assertCurrent = (revision: number, token: string | null) => {
    if (!current(revision, token)) throw new Error('Wallet session changed. Retry the operation.')
  }
  const storageFailure = () => {
    invalidate(false)
    set({ status: 'error', error: 'Wallet storage is unavailable or changed. Retry to safely reload it; do not create a replacement wallet.' })
  }
  const notifyFailedMutation = () => {
    try { publishWalletInvalidation() } catch {
      set({ error: `${get().error ?? 'Wallet update failed.'} Close other wallet tabs before retrying.` })
    }
  }
  const biometricContext = (vault: WalletVault, revision: number, token: string | null): BiometricContext => ({ vaultId: vault.id, vaultRevision: vault.revision, signal: authAbort.signal, isCurrent: () => current(revision, token) })
  const readCurrentVault = async (revision: number, token: string | null) => {
    const vault = await WalletVaultService.read()
    assertCurrent(revision, token)
    if (!vault || vault.id !== get().vaultId || vault.revision !== get().vaultRevision) throw new Error('The wallet changed in another tab. Reload it safely.')
    return vault
  }
  const readBiometric = async (vault: WalletVault | null) => {
    const available = await BiometricService.isAvailable()
    return {
      available,
      type: await BiometricService.getType(),
      enabled: vault ? await BiometricService.isEnabled({ vaultId: vault.id, vaultRevision: vault.revision }) : false,
      legacy: vault ? await BiometricService.hasLegacy() : false,
    }
  }
  const persistedBiometric = async (vault: WalletVault, revision: number, token: string | null) => {
    const context = biometricContext(vault, revision, token)
    const enabled = await BiometricService.isEnabled(context)
    const legacy = await BiometricService.hasLegacy()
    assertCurrent(revision, token)
    return { enabled, legacy }
  }
  const removeLegacyForVault = async (vault: WalletVault, password: string, revision: number, token: string | null) => {
    await withWalletMutation(async () => {
      const saved = await WalletVaultService.read()
      assertCurrent(revision, token)
      if (!saved || saved.id !== vault.id || saved.revision !== vault.revision || !await WalletVaultService.decrypt(saved, password)) {
        throw new Error('The wallet changed while retiring older biometric access')
      }
      await BiometricService.removeLegacy()
      assertCurrent(revision, token)
    })
  }
  const enrollBiometric = async (vault: WalletVault, password: string, revision: number, token: string | null) => {
    let result: BiometricEnrollmentResult | null = null
    try {
      result = await BiometricService.enable(password, biometricContext(vault, revision, token))
    } catch { /* An unverified write is never accepted from structural metadata alone. */ }
    assertCurrent(revision, token)
    let persisted = await persistedBiometric(vault, revision, token)
    if (!result?.verified) {
      throw new BiometricEnrollmentError(
        'Secure biometrics could not be enabled or verified. Your wallet was saved and remains protected by its password; unlock it and retry Biometrics in Settings.',
        false,
        persisted.legacy,
      )
    }
    // A PRF envelope may have committed before cleanup failed. Keep that valid
    // credential and retry only the verified cleanup instead of reporting a
    // false disabled state or deleting the sole working biometric wrapper.
    if (persisted.enabled && (!result.legacyCleanupComplete || persisted.legacy)) {
      try { await removeLegacyForVault(vault, password, revision, token) } catch { /* Report the postcondition below. */ }
      persisted = await persistedBiometric(vault, revision, token)
    }
    if (persisted.enabled && !persisted.legacy) return persisted
    if (persisted.enabled) throw new BiometricEnrollmentError('Secure biometrics were enrolled, but older biometric access could not be retired. Retry before relying on biometrics alone.', true, true)
    throw new BiometricEnrollmentError('Secure biometric persistence could not be verified. Your wallet remains protected by its password; retry Biometrics in Settings.', false, persisted.legacy)
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
    legacyRecoveryTicket = null
    set(state => ({
      status: 'locked', address: null, _privateKey: null, backupPhrase: null,
      vaultId: vault.id, vaultRevision: vault.revision, sessionExpiresAt: null, sessionStorageToken: null,
      sessionRevision: state.sessionRevision + 1,
      biometric: { ...state.biometric, ...biometric }, error: message,
    }))
    return true
  }
  const openWallet = (vault: WalletVault, mnemonic: string, token: string | null) => {
    legacyRecoveryTicket = null
    const wallet = WalletUtil.restoreFromMnemonic(mnemonic)
    if (vault.address && vault.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Recovery phrase does not match this wallet')
    set(state => ({ status: vault.backedUp ? 'unlocked' : 'backup', address: wallet.address, _privateKey: wallet.privateKey, backupPhrase: vault.backedUp ? null : mnemonic, vaultId: vault.id, vaultRevision: vault.revision, sessionRevision: state.sessionRevision + 1, sessionExpiresAt: Date.now() + SESSION_TIMEOUT_MS, sessionStorageToken: token, error: null }))
    void DeviceService.getInstance().register().catch(() => undefined)
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
      await withWalletMutation(async () => {
        if (await WalletVaultService.read()) throw new Error('A wallet already exists. Unlock it or explicitly delete it first.')
        const revision = get().sessionRevision
        const token = publishWalletInvalidation()
        mutationAnnounced = true
        vault = await WalletVaultService.create(mnemonic, wallet.address, password, backedUp)
        assertCurrent(revision, token)
        const committedToken = publishWalletInvalidation()
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
      openWallet(vault, mnemonic, activeToken)
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
      storageFailure()
      if (mutationAnnounced) notifyFailedMutation()
      throw error
    } finally { mutationPending = false }
  }

  return {
    status: 'loading', address: null, error: null, _privateKey: null, backupPhrase: null,
    vaultId: null, vaultRevision: 0, sessionRevision: 0, sessionExpiresAt: null, sessionStorageToken: null,
    biometric: { type: 'none', enabled: false, available: false, legacy: false },

    initialize: async () => {
      if (!initializedEvents) {
        initializedEvents = true
        subscribeWalletInvalidation(() => {
          invalidate(false)
          void get().initialize()
        })
      }
      if (get().status === 'unlocked' || get().status === 'backup') return
      const revision = get().sessionRevision
      try {
        const token = readWalletSessionToken()
        const vault = await WalletVaultService.read()
        const biometric = await readBiometric(vault)
        assertCurrent(revision, token)
        set({ status: vault ? 'locked' : 'no_wallet', vaultId: vault?.id ?? null, vaultRevision: vault?.revision ?? 0, biometric, error: null })
      } catch {
        if (get().sessionRevision === revision) storageFailure()
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
        const vault = await readCurrentVault(revision, token)
        const mnemonic = await WalletVaultService.decrypt(vault, password)
        assertCurrent(revision, token)
        if (!mnemonic) return false
        const wallet = WalletUtil.restoreFromMnemonic(mnemonic)
        if (vault.address && wallet.address.toLowerCase() !== vault.address.toLowerCase()) throw new Error('Wrong wallet identity')
        return mnemonic
      } catch {
        if (get().sessionRevision === revision) storageFailure()
        return false
      }
    },

    unlockWallet: async mnemonic => {
      if (unlockPending) return false
      unlockPending = true
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      try {
        const vault = await readCurrentVault(revision, token)
        assertCurrent(revision, token)
        openWallet(vault, mnemonic, token)
        return true
      } catch {
        if (get().sessionRevision === revision) set({ error: 'Wallet changed or could not be unlocked. Retry.' })
        return false
      } finally { unlockPending = false }
    },

    resolvePasswordWithBiometric: async () => {
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      const vault = await readCurrentVault(revision, token)
      const result = await BiometricService.authenticate(biometricContext(vault, revision, token))
      assertCurrent(revision, token)
      if (!result.success || !result.password) throw new Error('Secure biometric authentication failed. Use your password.')
      return result.password
    },
    unlockWithBiometric: async () => {
      const password = await get().resolvePasswordWithBiometric()
      const mnemonic = await get().checkPassword(password)
      if (!mnemonic || !await get().unlockWallet(mnemonic)) throw new Error('Wallet could not be unlocked')
    },
    lockWallet: () => invalidate(true),

    resetWallet: async () => {
      const targetId = get().vaultId
      const targetRevision = get().vaultRevision
      invalidate(true)
      if (mutationPending) {
        notifyFailedMutation()
        throw new Error('Another wallet update is running. Retry deletion.')
      }
      mutationPending = true
      try {
        await withWalletMutation(async () => {
          const target = await WalletVaultService.read()
          if (target && (target.id !== targetId || target.revision !== targetRevision)) throw new Error('Wallet changed. Confirm deletion again.')
          // Remove optional credentials first; the encrypted seed is the final
          // authoritative deletion. Failure must leave an explicit retry state.
          await BiometricService.disable()
          await getBasicStorage().clear()
          await getStorage().remove(STORAGE_MNEMONIC_KEY)
          if (await getStorage().exists(STORAGE_MNEMONIC_KEY)) throw new Error('Wallet deletion verification failed')
          // Revoke sessions opened after the initial invalidation but before
          // deletion committed, even while their storage events are pending.
          publishWalletInvalidation()
        })
        set({ status: 'no_wallet', vaultId: null, vaultRevision: 0, error: null, biometric: { type: get().biometric.type, available: get().biometric.available, enabled: false, legacy: false } })
      } catch (error) {
        invalidate(false)
        set({ status: 'error', error: 'Wallet deletion did not finish. Retry; do not assume the seed has been removed.' })
        notifyFailedMutation()
        throw error
      } finally { mutationPending = false }
    },

    backupWallet: async () => {
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      try {
        await withWalletMutation(async () => {
          const vault = await readCurrentVault(revision, token)
          if (get().status !== 'backup' || !get().address) throw new Error('Unlock the wallet to finish backup')
          await WalletVaultService.write({ ...vault, address: get().address, backedUp: true })
          assertCurrent(revision, token)
          set({ status: 'unlocked', backupPhrase: null, error: null })
        })
      } catch (error) {
        if (current(revision, token)) set({ error: 'Backup confirmation could not be saved. Retry before continuing.' })
        throw error
      }
    },

    getPrivateKey: () => get().checkSessionDeadline() ? get()._privateKey : null,
    getSessionSnapshot: () => {
      if (get().status !== 'unlocked' || !get().checkSessionDeadline() || !get().vaultId || !get().address) return null
      try { return { revision: get().sessionRevision, vaultId: get().vaultId!, address: get().address!, storageToken: readWalletSessionToken() } } catch { invalidate(false); return null }
    },
    isSessionCurrent: snapshot => !!snapshot && get().status === 'unlocked' && get().checkSessionDeadline() && current(snapshot.revision, snapshot.storageToken) && get().vaultId === snapshot.vaultId && get().address === snapshot.address,
    checkSessionDeadline: () => {
      const deadline = get().sessionExpiresAt
      if ((get().status !== 'unlocked' && get().status !== 'backup') || deadline === null) return false
      try {
        if (readWalletSessionToken() !== get().sessionStorageToken) { invalidate(false); return false }
      } catch { invalidate(false); return false }
      if (Date.now() >= deadline) { invalidate(true); return false }
      return true
    },
    touchSession: () => { if (get().checkSessionDeadline()) set({ sessionExpiresAt: Date.now() + SESSION_TIMEOUT_MS }) },
    clearError: () => set({ error: null }),

    toggleBiometric: async (value, password) => {
      if (!await get().checkPassword(password)) throw new Error('Invalid password')
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      const vault = await readCurrentVault(revision, token)
      if (value) {
        await enrollBiometric(vault, password, revision, token)
      } else {
        await withWalletMutation(async () => { await readCurrentVault(revision, token); await BiometricService.disable() })
        const persisted = await persistedBiometric(vault, revision, token)
        if (persisted.enabled || persisted.legacy) throw new Error('Biometric removal could not be verified. Retry before assuming it is disabled.')
      }
      assertCurrent(revision, token)
      set(state => ({ biometric: { ...state.biometric, enabled: value, legacy: false } }))
    },

    retireLegacyWithPassword: async password => {
      if (!get().biometric.legacy) return null
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      const vault = await readCurrentVault(revision, token)
      if (!await WalletVaultService.decrypt(vault, password)) throw new Error('Invalid password')
      try {
        await enrollBiometric(vault, password, revision, token)
        set(state => ({ biometric: { ...state.biometric, enabled: true, legacy: false }, error: null }))
        return null
      } catch (error) {
        try { await removeLegacyForVault(vault, password, revision, token) } catch { /* Persisted status is reported below. */ }
        const persisted = await persistedBiometric(vault, revision, token)
        const verifiedEnabled = error instanceof BiometricEnrollmentError && error.verifiedEnabled && persisted.enabled
        if (verifiedEnabled && !persisted.legacy) {
          set(state => ({ biometric: { ...state.biometric, enabled: true, legacy: false }, error: null }))
          return null
        }
        const message = persisted.legacy
          ? 'Your password is valid, but older biometric access could not be retired. Retry before unlocking.'
          : 'Older biometric access was retired, but secure biometric enrollment did not finish. The wallet is unlocked with your password; retry Biometrics in Settings.'
        set(state => ({ biometric: { ...state.biometric, enabled: verifiedEnabled, legacy: persisted.legacy }, error: message }))
        if (persisted.legacy) throw new Error(message, { cause: error })
        return message
      }
    },
    cancelLegacyRecovery: () => {
      legacyRecoveryTicket = null
      authAbort.abort()
      authAbort = new AbortController()
    },
    recoverLegacyAccess: async () => {
      const ticketId = window.crypto.randomUUID()
      legacyRecoveryTicket = ticketId
      const revision = get().sessionRevision
      const token = readWalletSessionToken()
      const vault = await readCurrentVault(revision, token)
      const password = await BiometricService.recoverLegacyForMigration(biometricContext(vault, revision, token))
      const mnemonic = await WalletVaultService.decrypt(vault, password)
      assertCurrent(revision, token)
      if (legacyRecoveryTicket !== ticketId) throw new Error('Legacy recovery was cancelled')
      if (!mnemonic || !WalletUtil.isValidMnemonic(mnemonic)) throw new Error('Legacy access cannot decrypt this wallet. Use your recovery phrase.')
      return { password, mnemonic, vaultId: vault.id, vaultRevision: vault.revision, sessionRevision: revision, storageToken: token, expiresAt: Date.now() + SESSION_TIMEOUT_MS, ticketId }
    },
    completeLegacyRecovery: async (recovery, newPassword) => {
      validateNewPassword(newPassword)
      let activeToken = recovery.storageToken
      let mutationAnnounced = false
      let updated: WalletVault | null = null
      let phase: 'persist' | 'enroll' | 'open' = 'persist'
      const assertRecovery = () => {
        assertCurrent(recovery.sessionRevision, activeToken)
        if (legacyRecoveryTicket !== recovery.ticketId || !Number.isFinite(recovery.expiresAt) || Date.now() >= recovery.expiresAt) throw new Error('Legacy recovery verification expired or was cancelled. Verify again.')
      }
      try {
        await withWalletMutation(async () => {
          assertRecovery()
          const vault = await readCurrentVault(recovery.sessionRevision, recovery.storageToken)
          if (vault.id !== recovery.vaultId || vault.revision !== recovery.vaultRevision || await WalletVaultService.decrypt(vault, recovery.password) !== recovery.mnemonic) throw new Error('Legacy recovery session expired. Start again.')
          assertRecovery()
          const wallet = WalletUtil.restoreFromMnemonic(recovery.mnemonic)
          updated = { ...vault, address: wallet.address, revision: vault.revision + 1, encryptedMnemonic: await CryptoUtil.encrypt(recovery.mnemonic, newPassword) }
          assertRecovery()
          const updatedToken = publishWalletInvalidation()
          mutationAnnounced = true
          activeToken = updatedToken
          assertRecovery()
          await WalletVaultService.write(updated)
          const saved = await WalletVaultService.read()
          if (!saved || await WalletVaultService.decrypt(saved, newPassword) !== recovery.mnemonic) throw new Error('New password persistence could not be verified. Keep the new password and retry.')
          assertRecovery()
        })
        if (!updated) throw new Error('Recovery upgrade did not return the saved wallet')
        // Release the vault Web Lock before enable(), which acquires that lock
        // for its own verified PRF persistence and legacy cleanup.
        legacyRecoveryTicket = null
        phase = 'enroll'
        await enrollBiometric(updated, newPassword, recovery.sessionRevision, activeToken)
        phase = 'open'
        const updatedToken = publishWalletInvalidation()
        activeToken = updatedToken
        assertCurrent(recovery.sessionRevision, activeToken)
        openWallet(updated, recovery.mnemonic, activeToken)
        set(state => ({ biometric: { ...state.biometric, enabled: true, legacy: false }, error: null }))
      } catch (error) {
        if (updated && phase === 'enroll') {
          try { await removeLegacyForVault(updated, newPassword, recovery.sessionRevision, activeToken) } catch { /* Report persisted state below. */ }
          const persisted = await persistedBiometric(updated, recovery.sessionRevision, activeToken)
          const verifiedEnabled = error instanceof BiometricEnrollmentError && error.verifiedEnabled && persisted.enabled
          if (verifiedEnabled && !persisted.legacy) {
            const updatedToken = publishWalletInvalidation()
            activeToken = updatedToken
            assertCurrent(recovery.sessionRevision, activeToken)
            openWallet(updated, recovery.mnemonic, activeToken)
            set(state => ({ biometric: { ...state.biometric, enabled: true, legacy: false }, error: null }))
            return
          }
          const message = 'Your wallet password was upgraded, but secure biometric enrollment did not finish. Unlock with the new password and retry Biometrics in Settings.'
          const enrollment = error instanceof BiometricEnrollmentError ? error : null
          const locked = await lockAfterBiometricFailure(updated, message, recovery.sessionRevision, activeToken, enrollment?.verifiedEnabled)
          if (locked && mutationAnnounced) notifyFailedMutation()
          throw new LegacyRecoveryEnrollmentError(message, { cause: error })
        }
        storageFailure()
        set({ error: 'Recovery upgrade could not finish. Keep the new password, retry loading the wallet, and use the new password if it was saved. Your recovery phrase is unchanged.' })
        if (mutationAnnounced) notifyFailedMutation()
        throw error
      }
    },
  }
}))
