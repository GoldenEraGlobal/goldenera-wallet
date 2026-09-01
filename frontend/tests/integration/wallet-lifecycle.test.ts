import { beforeEach, describe, expect, it, vi } from 'vitest'
import golden from '../fixtures/crypto-v0.2.0.json'
import previousV2 from '../fixtures/vault-v2-before-ts7.json'

const environment = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  basic: new Map<string, string>(),
  failKeys: false,
  failRemove: false,
  readGate: null as Promise<void> | null,
  failWrite: false,
  legacy: false,
  failRead: false,
  failReadAfterWrite: false,
  failCredentialCleanup: false,
  credentialCleanupFailures: 0,
  noopRemove: false,
  removeGate: null as Promise<void> | null,
  removeStarted: vi.fn(),
  writeGate: null as Promise<void> | null,
  writeCommitted: vi.fn(),
  beforeWriteGate: null as Promise<void> | null,
  beforeWriteStarted: vi.fn(),
  register: vi.fn(async () => undefined),
  biometricEnabled: false,
  biometricEnableResult: true,
  biometricEnableError: false,
  biometricCommitBeforeError: false,
  biometricEnableGate: null as Promise<void> | null,
  biometricEnableStarted: vi.fn(),
  biometricEnable: vi.fn(async () => true),
}))

vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: vi.fn(async ({ key }: { key: string }) => ({ value: environment.basic.get(key) ?? null })),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => { environment.basic.set(key, value) }),
  remove: vi.fn(async ({ key }: { key: string }) => { environment.basic.delete(key) }),
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
vi.mock('../../packages/core/src/services/BiometricService', () => ({ BiometricService: {
  isAvailable: async () => false,
  getType: async () => 'none',
  isEnabled: async () => environment.biometricEnabled,
  hasLegacy: async () => environment.legacy,
  recoverLegacyForMigration: async () => 'PUBLIC-TEST-ONLY_password-123!',
  enable: async () => {
    environment.biometricEnable()
    environment.biometricEnableStarted()
    await environment.biometricEnableGate
    if (environment.biometricCommitBeforeError) environment.biometricEnabled = true
    if (environment.biometricEnableError) throw new DOMException('Synthetic biometric enrollment cancellation', 'NotAllowedError')
    if (!environment.biometricEnableResult) return { verified: false, legacyCleanupComplete: false }
    environment.biometricEnabled = true
    if (environment.legacy && (environment.failCredentialCleanup || environment.credentialCleanupFailures > 0)) {
      if (environment.credentialCleanupFailures > 0) environment.credentialCleanupFailures -= 1
      return { verified: true, legacyCleanupComplete: false }
    }
    environment.legacy = false
    return { verified: true, legacyCleanupComplete: true }
  },
  removeLegacy: async () => {
    if (environment.failCredentialCleanup || environment.credentialCleanupFailures > 0) {
      if (environment.credentialCleanupFailures > 0) environment.credentialCleanupFailures -= 1
      throw new Error('Synthetic credential cleanup failure')
    }
    environment.legacy = false
  },
  disable: async () => {
    if (environment.failCredentialCleanup) throw new Error('Synthetic credential cleanup failure')
    environment.biometricEnabled = false
    environment.legacy = false
  },
} }))
vi.mock('../../packages/core/src/services/DeviceService', () => ({ DeviceService: {
  getInstance: () => ({ register: environment.register }),
} }))

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
  environment.legacy = false
  environment.failRead = false
  environment.failReadAfterWrite = false
  environment.failCredentialCleanup = false
  environment.credentialCleanupFailures = 0
  environment.noopRemove = false
  environment.removeGate = null
  environment.removeStarted.mockClear()
  environment.writeGate = null
  environment.writeCommitted.mockClear()
  environment.beforeWriteGate = null
  environment.beforeWriteStarted.mockClear()
  environment.register.mockReset().mockResolvedValue(undefined)
  environment.biometricEnabled = false
  environment.biometricEnableResult = true
  environment.biometricEnableError = false
  environment.biometricCommitBeforeError = false
  environment.biometricEnableGate = null
  environment.biometricEnableStarted.mockReset()
  environment.biometricEnable.mockReset().mockResolvedValue(true)
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
    store.getState().lockWallet()
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

  it('requires backup for a newly created wallet and persists completion', async () => {
    const store = await loadStore()
    const result = await store.getState().createWallet(password, false)
    expect(store.getState().status).toBe('backup')
    expect(store.getState().backupPhrase).toBe(result.mnemonic)
    expect(await store.getState().checkPassword(password)).toBe(result.mnemonic)
    await store.getState().backupWallet()
    expect(store.getState().status).toBe('unlocked')
    expect(store.getState().backupPhrase).toBeNull()
    store.getState().lockWallet()
    await store.getState().unlockWallet(result.mnemonic)
    expect(store.getState().status).toBe('unlocked')
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
    store.getState().lockWallet()
    expect(await store.getState().checkPassword(`${password}-incorrect`)).toBe(false)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().getPrivateKey()).toBeNull()
  })

  it('deletes the encrypted mnemonic and backup marker on a successful reset', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    await store.getState().resetWallet()
    expect(store.getState().status).toBe('no_wallet')
    expect(store.getState().getPrivateKey()).toBeNull()
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(false)
    expect(environment.basic.has('ge_basic:backedup')).toBe(false)
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
    await store.getState().resetWallet().catch(() => undefined)
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(true)
    expect(store.getState().status).not.toBe('no_wallet')
  })

  it('S5: a late unlock completion must not resurrect a locked session', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    store.getState().lockWallet()
    let finish!: () => void
    environment.readGate = new Promise<void>(resolve => { finish = resolve })
    const pending = store.getState().unlockWallet(mnemonic)
    await Promise.resolve()
    store.getState().lockWallet()
    finish()
    await pending
    expect(store.getState().status).toBe('locked')
    expect(store.getState().getPrivateKey()).toBeNull()
  })

  it('S7: stalled device registration must not prevent local unlock', async () => {
    const store = await loadStore()
    await store.getState().importWallet(mnemonic, password, false)
    store.getState().lockWallet()
    environment.register.mockImplementationOnce(() => new Promise<void>(() => undefined))
    void store.getState().unlockWallet(mnemonic)
    await new Promise(resolve => setTimeout(resolve, 25))
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
    store.getState().lockWallet()
    expect(store.getState().isSessionCurrent(snapshot)).toBe(false)
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

  it('reports migration enrollment failure, retires stale legacy access, and preserves the new password', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.biometricEnableResult = false
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    const replacement = 'PUBLIC-New-Password-456!'
    await expect(store.getState().completeLegacyRecovery(recovery, replacement)).rejects.toThrow('password was upgraded')
    expect(environment.legacy).toBe(false)
    expect(store.getState().status).toBe('locked')
    expect(store.getState().biometric.enabled).toBe(false)
    expect(await store.getState().checkPassword(replacement)).toBe(mnemonic)
  })

  it('upgrades legacy biometric intent during an ordinary password unlock', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const restored = await store.getState().checkPassword(password)
    await store.getState().retireLegacyWithPassword(password)
    await store.getState().unlockWallet(restored as string)
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
    const restored = await store.getState().checkPassword(password)
    const warning = await store.getState().retireLegacyWithPassword(password)
    expect(warning).toContain('secure biometric enrollment did not finish')
    expect(environment.legacy).toBe(false)
    expect(store.getState().biometric.enabled).toBe(false)
    expect(await store.getState().unlockWallet(restored as string)).toBe(true)
    expect(store.getState().status).toBe('unlocked')
  })

  it('accepts an ordinary legacy upgrade when a final verified cleanup retry succeeds', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    environment.credentialCleanupFailures = 2
    const store = await loadStore()
    await store.getState().initialize()
    expect(await store.getState().retireLegacyWithPassword(password)).toBeNull()
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
  it('preserves the new-password seed if a write commits but read-back fails', async () => {
    environment.secure.set('ge_secure:mnemonic', golden.vaults[0].encrypted)
    environment.basic.set('ge_basic:backedup', 'true')
    environment.legacy = true
    const store = await loadStore()
    await store.getState().initialize()
    const recovery = await store.getState().recoverLegacyAccess()
    environment.failReadAfterWrite = true
    const replacement = 'PUBLIC-Recovery-Readback-456!'
    await expect(store.getState().completeLegacyRecovery(recovery, replacement)).rejects.toThrow('read-back')
    expect(environment.legacy).toBe(true)
    expect(environment.secure.get('ge_secure:mnemonic')).not.toBe(golden.vaults[0].encrypted)
    environment.failRead = false
    environment.failReadAfterWrite = false
    await store.getState().initialize()
    const restored = await store.getState().checkPassword(replacement)
    expect(restored).toBe(mnemonic)
    await store.getState().unlockWallet(restored as string)
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
    await expect(store.getState().resetWallet()).rejects.toThrow('did not remove')
    expect(store.getState().status).toBe('error')
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(true)
  })

  it('does not claim backup completion after a failed atomic metadata write', async () => {
    const store = await loadStore()
    await store.getState().createWallet(password, false)
    const previous = environment.secure.get('ge_secure:mnemonic')
    environment.failWrite = true
    await expect(store.getState().backupWallet()).rejects.toThrow('write failure')
    expect(store.getState().status).toBe('backup')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(previous)
    expect(JSON.parse(previous!).backedUp).toBe(false)
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

  it('rejects an expired recovery ticket without changing the encrypted seed', async () => {
    const { store, recovery } = await recover()
    vi.spyOn(Date, 'now').mockReturnValue(recovery.expiresAt + 1)
    await expect(store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')).rejects.toThrow('expired')
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

  it('rechecks revocation after an awaited vault read and before commit', async () => {
    const { store, recovery } = await recover()
    let release!: () => void
    environment.readGate = new Promise<void>(resolve => { release = resolve })
    const pending = store.getState().completeLegacyRecovery(recovery, 'PUBLIC-New-Password-456!')
    await Promise.resolve()
    store.getState().cancelLegacyRecovery()
    release()
    await expect(pending).rejects.toThrow('cancelled')
    expect(environment.secure.get('ge_secure:mnemonic')).toBe(golden.vaults[0].encrypted)
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
  vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() } })
  try {
    const deleting = await loadStore()
    await deleting.getState().importWallet(mnemonic, password, false)
    let finish!: () => void
    environment.removeGate = new Promise<void>(resolve => { finish = resolve })
    const deletion = deleting.getState().resetWallet()
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
    expect(environment.secure.has('ge_secure:mnemonic')).toBe(outcome === 'before-commit-failure')
    environment.failRemove = false
    environment.failKeys = false
  } finally {
    vi.stubGlobal('window', previousWindow)
    vi.stubGlobal('navigator', previousNavigator)
  }
})


it.each([['create', false], ['create', true], ['import', false], ['import', true]] as const)('S4: %s exit (readback failure=%s) revokes a reader opened during commit', async (mode, readbackFailure) => {
  const previousWindow = window
  const previousNavigator = globalThis.navigator
  const tokens = new Map<string, string>()
  vi.stubGlobal('window', { ...previousWindow, localStorage: {
    getItem: (key: string) => tokens.get(key) ?? null,
    setItem: (key: string, value: string) => { tokens.set(key, value) },
  } })
  vi.stubGlobal('navigator', { locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() } })
  try {
    const creator = await loadStore()
    let finish!: () => void
    environment.writeGate = new Promise<void>(resolve => { finish = resolve })
    const creation = mode === 'create' ? creator.getState().createWallet(password, false) : creator.getState().importWallet(mnemonic, password, false)
    await vi.waitFor(() => expect(environment.writeCommitted).toHaveBeenCalled())
    vi.resetModules()
    const anotherTab = await loadStore()
    await anotherTab.getState().initialize()
    const checked = await anotherTab.getState().checkPassword(password)
    expect(typeof checked).toBe('string')
    await anotherTab.getState().unlockWallet(checked as string)
    expect(anotherTab.getState().getPrivateKey()).not.toBeNull()
    environment.failReadAfterWrite = readbackFailure
    finish()
    if (readbackFailure) await expect(creation).rejects.toThrow('read-back')
    else await creation
    expect(anotherTab.getState().getPrivateKey()).toBeNull()
    environment.failRead = false
    environment.failReadAfterWrite = false
    await creator.getState().initialize()
    expect(await creator.getState().checkPassword(password)).toBe(checked)
  } finally {
    vi.stubGlobal('window', previousWindow)
    vi.stubGlobal('navigator', previousNavigator)
  }
})

it.each(['success', 'before-commit-failure', 'readback-failure', 'cleanup-failure'] as const)('S4: password migration exit %s revokes a session opened during its write', async outcome => {
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
    vi.resetModules()
    const anotherTab = await loadStore()
    await anotherTab.getState().initialize()
    await anotherTab.getState().unlockWallet((await anotherTab.getState().checkPassword(outcome === 'before-commit-failure' ? password : replacement)) as string)
    const duringMigration = anotherTab.getState().getSessionSnapshot()
    expect(anotherTab.getState().isSessionCurrent(duringMigration)).toBe(true)
    environment.failWrite = outcome === 'before-commit-failure'
    environment.failReadAfterWrite = outcome === 'readback-failure'
    environment.failCredentialCleanup = outcome === 'cleanup-failure'
    finish()
    if (outcome === 'success') await migration
    else await expect(migration).rejects.toThrow()
    expect(anotherTab.getState().isSessionCurrent(duringMigration)).toBe(false)
    expect(anotherTab.getState().getPrivateKey()).toBeNull()
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


describe('existing approved v2 vault forward compatibility', () => {
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
