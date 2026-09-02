import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { bufferToHex, hexToBuffer } from '../../packages/core/src/utils/CryptoUtil'

const environment = vi.hoisted(() => ({
  persisted: new Map<string, unknown>(),
  supported: true,
  createOutput: true,
  verified: true,
  wrongCredential: false,
  password: 'PUBLIC-Test-Only-Password-123!',
  failPersist: false,
  failSetKey: null as string | null,
  failRemoveKey: null as string | null,
  failLegacyRemove: false,
  corruptPrfAfterWrite: false,
  mutatePrfUserIdAfterWrite: false,
  mutatePrfUserIdDuringLegacyCleanup: false,
  vaultId: 'public-test-vault',
  vaultRevision: 0,
  vaultPresent: true,
  vaultAddress: null as string | null,
  vaultCiphertext: 'public-test-encrypted-mnemonic',
  vaultCorruption: false,
  assertionUserHandle: null as Uint8Array | null,
  walletMutationDepth: 0,
  walletMutationCalls: 0,
  assertionMutationDepths: [] as number[],
}))
vi.mock('../../packages/core/src/utils/BiometricUtil', () => ({ BiometricUtil: { getPlatform: () => 'web', isWebAuthnAvailable: () => true } }))
vi.mock('../../packages/core/src/services/StorageService', () => ({ StorageService: { basic: {
  getItem: async (key: string) => environment.persisted.get(key) ?? null,
  setItem: async (key: string, value: unknown) => {
    if (environment.failPersist || environment.failSetKey === key) throw new Error(`Synthetic ${key} persistence failure`)
    const stored = structuredClone(value)
    if (key === 'biometric_prf_v2' && environment.corruptPrfAfterWrite && stored && typeof stored === 'object' && 'data' in stored) {
      const record = stored as { data: string }
      record.data = `${record.data.startsWith('00') ? '01' : '00'}${record.data.slice(2)}`
    }
    if (key === 'biometric_prf_v2' && environment.mutatePrfUserIdAfterWrite && stored && typeof stored === 'object') {
      const record = stored as { userId?: string }
      record.userId = 'mutated_opaque_user_handle'
    }
    environment.persisted.set(key, stored)
  },
  removeItem: async (key: string) => {
    if (environment.failRemoveKey === key) throw new Error(`Synthetic ${key} cleanup failure`)
    if (environment.failLegacyRemove && key === 'biometric_encrypted_password') throw new Error('Synthetic legacy cleanup failure')
    if (environment.mutatePrfUserIdDuringLegacyCleanup && key === 'biometric_encrypted_password') {
      const prf = environment.persisted.get('biometric_prf_v2')
      if (prf && typeof prf === 'object') (prf as { userId?: string }).userId = 'mutated_cleanup_user_handle'
    }
    environment.persisted.delete(key)
  },
} } }))
vi.mock('../../packages/core/src/services/WalletVaultService', () => {
  class MockWalletVaultCorruptionError extends Error {
    readonly code = 'WALLET_VAULT_CORRUPTED'
  }
  const activeScopes = new WeakSet<object>()
  const vault = () => ({
    version: 2 as const,
    id: environment.vaultId,
    revision: environment.vaultRevision,
    address: environment.vaultAddress,
    encryptedMnemonic: environment.vaultCiphertext,
    backedUp: true,
  })
  return {
    withWalletMutation: async (fn: (scope: object) => Promise<unknown>) => {
      const scope = {}
      environment.walletMutationCalls += 1
      environment.walletMutationDepth += 1
      activeScopes.add(scope)
      try { return await fn(scope) } finally {
        activeScopes.delete(scope)
        environment.walletMutationDepth -= 1
      }
    },
    assertWalletMutationScope: (scope: object) => {
      if (!activeScopes.has(scope)) throw new Error('Wallet mutation scope is not active')
    },
    isWalletVaultCorruptionError: (error: unknown): error is MockWalletVaultCorruptionError => error instanceof MockWalletVaultCorruptionError,
    WalletVaultService: {
      inspect: async () => environment.vaultPresent ? { source: 'v2' as const, vault: vault() } : null,
      read: async () => environment.vaultPresent ? vault() : null,
      decrypt: async (_vault: unknown, password: string) => {
        if (environment.vaultCorruption) throw new MockWalletVaultCorruptionError('Synthetic malformed wallet envelope')
        return password === environment.password
          ? 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
          : null
      },
    },
  }
})

import { BiometricService } from '../../packages/core/src/services/BiometricService'
import { WalletVaultService, withWalletMutation } from '../../packages/core/src/services/WalletVaultService'
import { WalletUtil } from '../../packages/core/src/utils/WalletUtil'
const walletMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const context = { vaultId: 'public-test-vault', vaultRevision: 0 }
const legacyContext = { vaultId: `legacy-${'ab'.repeat(32)}`, vaultRevision: 0 }
const credentialId = new Uint8Array(32).fill(7)
const encoder = new TextEncoder()
const signalCurrentUserDetails = vi.fn(async () => undefined)

async function credential(options: CredentialCreationOptions | CredentialRequestOptions, creation: boolean): Promise<PublicKeyCredential> {
  const publicKey = options.publicKey!
  const challenge = publicKey.challenge as Uint8Array
  const extensions = publicKey.extensions as { prf?: { eval?: { first?: Uint8Array } } } | undefined
  const authData = new Uint8Array(37)
  authData.set(new Uint8Array(await webcrypto.subtle.digest('SHA-256', encoder.encode(window.location.hostname))))
  authData[32] = environment.verified ? 5 : 1
  let output: ArrayBuffer | undefined
  const input = extensions?.prf?.eval?.first
  if (environment.supported && input && (!creation || environment.createOutput)) {
    const fakeHardwareSecret = await webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(93), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    output = await webcrypto.subtle.sign('HMAC', fakeHardwareSecret, input)
  }
  const response = {
    clientDataJSON: encoder.encode(JSON.stringify({ type: creation ? 'webauthn.create' : 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: window.location.origin })).buffer,
    authenticatorData: authData.buffer,
    userHandle: creation ? null : environment.assertionUserHandle?.slice().buffer ?? null,
  }
  return {
    rawId: (environment.wrongCredential ? new Uint8Array(32).fill(8) : credentialId).slice().buffer,
    response,
    getClientExtensionResults: () => ({ prf: { ...(creation ? { enabled: environment.supported } : {}), ...(output ? { results: { first: output } } : {}) } }),
  } as unknown as PublicKeyCredential
}

beforeEach(() => {
  environment.persisted.clear()
  environment.supported = true
  environment.createOutput = true
  environment.verified = true
  environment.wrongCredential = false
  environment.password = 'PUBLIC-Test-Only-Password-123!'
  environment.failPersist = false
  environment.failSetKey = null
  environment.failRemoveKey = null
  environment.failLegacyRemove = false
  environment.corruptPrfAfterWrite = false
  environment.mutatePrfUserIdAfterWrite = false
  environment.mutatePrfUserIdDuringLegacyCleanup = false
  environment.vaultId = context.vaultId
  environment.vaultRevision = context.vaultRevision
  environment.vaultPresent = true
  environment.vaultAddress = WalletUtil.restoreFromMnemonic(walletMnemonic).address
  environment.vaultCiphertext = 'public-test-encrypted-mnemonic'
  environment.vaultCorruption = false
  environment.assertionUserHandle = null
  environment.walletMutationDepth = 0
  environment.walletMutationCalls = 0
  environment.assertionMutationDepths = []
  signalCurrentUserDetails.mockReset()
  vi.stubGlobal('PublicKeyCredential', { signalCurrentUserDetails })
  vi.stubGlobal('navigator', { credentials: {
    create: vi.fn(options => credential(options, true)),
    get: vi.fn(options => {
      environment.assertionMutationDepths.push(environment.walletMutationDepth)
      return credential(options, false)
    }),
  } })
})

describe('PRF-protected password wrapper with real WebCrypto and mocked authenticator', () => {
  it('enrolls, persists only encrypted data and authenticates through PRF', async () => {
    expect((await BiometricService.enable(environment.password, context)).verified).toBe(true)
    expect(await BiometricService.isEnabled(context)).toBe(true)
    const record = environment.persisted.get('biometric_prf_v2') as Record<string, unknown>
    expect(record.version).toBe(2)
    expect(JSON.stringify(record)).not.toContain(environment.password)
    expect(record).not.toHaveProperty('key')
    expect(record).not.toHaveProperty('prfSecret')
    expect(await BiometricService.authenticate(context)).toMatchObject({
      success: true,
      password: environment.password,
      proof: expect.any(String),
    })
    expect(navigator.credentials.get).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({ userVerification: 'required' }) }))
  })

  it('uses neutral public credential labels and keeps the opaque user handle internal', async () => {
    environment.vaultId = legacyContext.vaultId
    expect((await BiometricService.enable(environment.password, legacyContext)).verified).toBe(true)
    const creation = vi.mocked(navigator.credentials.create).mock.calls[0]![0]!.publicKey!
    const userId = new Uint8Array(creation.user.id as ArrayBuffer)
    const persisted = environment.persisted.get('biometric_prf_v2') as Record<string, unknown>

    expect(creation.user.name).toBe('GoldenEra Wallet')
    expect(creation.user.displayName).toBe('GoldenEra Wallet')
    expect(creation.user.name).not.toContain('legacy-')
    expect(creation.user.displayName).not.toContain('legacy-')
    expect(JSON.stringify({ name: creation.user.name, displayName: creation.user.displayName })).not.toContain(legacyContext.vaultId)
    expect(userId).toHaveLength(32)
    expect(persisted.userId).toBe(Buffer.from(userId).toString('base64url'))
    expect(String(persisted.userId)).not.toContain(legacyContext.vaultId)
    expect(persisted.walletId).toBe(legacyContext.vaultId)
  })

  it('derives the same opaque user handle for repeated enrollment of the same vault', async () => {
    await BiometricService.enable(environment.password, context)
    const first = new Uint8Array(vi.mocked(navigator.credentials.create).mock.calls[0]![0]!.publicKey!.user.id as ArrayBuffer)
    await BiometricService.disable()
    await BiometricService.enable(environment.password, context)
    const second = new Uint8Array(vi.mocked(navigator.credentials.create).mock.calls[1]![0]!.publicKey!.user.id as ArrayBuffer)

    expect(second).toEqual(first)
  })

  it('signals neutral labels for new credentials without changing the PRF binding', async () => {
    await BiometricService.enable(environment.password, context)
    const record = environment.persisted.get('biometric_prf_v2') as Record<string, unknown>
    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
    await vi.waitFor(() => expect(signalCurrentUserDetails).toHaveBeenCalledWith({
      rpId: window.location.hostname,
      userId: record.userId,
      name: 'GoldenEra Wallet',
      displayName: 'GoldenEra Wallet',
    }))
  })

  it('keeps old envelopes working when their unrecorded user handle cannot be relabeled', async () => {
    await BiometricService.enable(environment.password, context)
    const record = environment.persisted.get('biometric_prf_v2') as Record<string, unknown>
    delete record.userId
    signalCurrentUserDetails.mockRejectedValueOnce(new Error('unsupported'))

    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
    expect(signalCurrentUserDetails).not.toHaveBeenCalled()
  })

  it('can opportunistically relabel an old envelope when its authenticator returns the user handle', async () => {
    await BiometricService.enable(environment.password, context)
    const creation = vi.mocked(navigator.credentials.create).mock.calls[0]![0]!.publicKey!
    const userId = new Uint8Array(creation.user.id as ArrayBuffer)
    const record = environment.persisted.get('biometric_prf_v2') as Record<string, unknown>
    delete record.userId
    environment.assertionUserHandle = userId

    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
    await vi.waitFor(() => expect(signalCurrentUserDetails).toHaveBeenCalledWith(expect.objectContaining({
      userId: Buffer.from(userId).toString('base64url'),
      name: 'GoldenEra Wallet',
      displayName: 'GoldenEra Wallet',
    })))
  })

  it('does not let a best-effort label update failure block authentication', async () => {
    await BiometricService.enable(environment.password, context)
    signalCurrentUserDetails.mockRejectedValueOnce(new Error('synthetic signal failure'))

    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
    await vi.waitFor(() => expect(signalCurrentUserDetails).toHaveBeenCalledTimes(1))
  })

  it('uses a subsequent assertion when create supports PRF but has no output', async () => {
    environment.createOutput = false
    expect((await BiometricService.enable(environment.password, context)).verified).toBe(true)
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1)
    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
  })

  it('leaves password-only mode when PRF is not available', async () => {
    environment.supported = false
    expect((await BiometricService.enable(environment.password, context)).verified).toBe(false)
    expect(environment.persisted.has('biometric_prf_v2')).toBe(false)
    expect(await BiometricService.isEnabled(context)).toBe(false)
  })

  it('rolls back a structurally valid envelope that fails the decrypt readback', async () => {
    environment.corruptPrfAfterWrite = true
    await expect(BiometricService.enable(environment.password, context)).rejects.toThrow()
    expect(environment.persisted.has('biometric_prf_v2')).toBe(false)
    expect(await BiometricService.isEnabled(context)).toBe(false)
    expect(await BiometricService.authenticate(context)).toEqual({ success: false })
  })

  it('rejects a user-handle mutation during exact envelope readback even though AES-GCM still decrypts', async () => {
    environment.mutatePrfUserIdAfterWrite = true
    await expect(BiometricService.enable(environment.password, context)).rejects.toThrow('persistence verification')
    expect(environment.persisted.has('biometric_prf_v2')).toBe(false)
  })

  it('rejects missing user verification, wrong credential and a changed wallet identity', async () => {
    await BiometricService.enable(environment.password, context)
    environment.verified = false
    await expect(BiometricService.authenticate(context)).rejects.toThrow('User verification')
    environment.verified = true
    environment.wrongCredential = true
    await expect(BiometricService.authenticate(context)).rejects.toThrow('Wrong authenticator')
    await expect(BiometricService.authenticate({ ...context, vaultId: 'another-wallet' })).rejects.toMatchObject({
      code: 'BIOMETRIC_CLEANUP_PENDING',
    })
  })

  it('rejects tampered ciphertext and aborted session', async () => {
    await BiometricService.enable(environment.password, context)
    const record = environment.persisted.get('biometric_prf_v2') as { data: string }
    record.data = (record.data.startsWith('00') ? '01' : '00') + record.data.slice(2)
    await expect(BiometricService.authenticate(context)).rejects.toThrow()
    await expect(BiometricService.authenticate({ ...context, isCurrent: () => false })).rejects.toThrow('session changed')
  })

  it('cannot decrypt a new wrapper with a key derived from its public credential ID', async () => {
    await BiometricService.enable(environment.password, context)
    const record = environment.persisted.get('biometric_prf_v2') as Record<string, string | number>
    const id = hexToBuffer(record.credentialId as string)
    const material = await webcrypto.subtle.importKey('raw', id, 'PBKDF2', false, ['deriveKey'])
    const oldPublicKey = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: id.slice(0, 16) }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    const aad = encoder.encode(JSON.stringify([record.version, record.scheme, record.walletId, record.vaultRevision, record.rpId, record.credentialId, record.prfInput, record.salt]))
    await expect(webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBuffer(record.iv as string), additionalData: aad }, oldPublicKey, hexToBuffer(record.data as string))).rejects.toThrow()
  })
})

async function installLegacyWrapper() {
  const material = await webcrypto.subtle.importKey('raw', credentialId, 'PBKDF2', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: credentialId.slice(0, 16) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv = new Uint8Array(12).fill(9)
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(environment.password))
  environment.persisted.set('biometric_credential_id', bufferToHex(credentialId))
  environment.persisted.set('biometric_encrypted_password', { iv: bufferToHex(iv), data: bufferToHex(encrypted) })
  environment.persisted.set('biometric_enabled', true)
}

describe('explicit one-time legacy biometric migration', () => {
  it('requires an already-active wallet mutation for password-replacement preparation', async () => {
    await expect(BiometricService.prepareLegacyRecoveryPasswordReplacementWithinWalletMutation(
      {} as never,
      context,
    )).rejects.toThrow('scope is not active')
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it.each([
    { failure: 'journal', key: 'biometric_migration_v1' },
    { failure: 'legacy tombstone', key: 'biometric_encrypted_password' },
    { failure: 'PRF tombstone', key: 'biometric_prf_v2' },
  ] as const)('keeps old-password seed access when pre-commit $failure persistence fails', async ({ failure, key }) => {
    const originalPassword = environment.password
    environment.persisted.set('biometric_generation_v1', { version: 1, walletId: context.vaultId, generation: 1 })
    await installLegacyWrapper()
    const originalLegacy = structuredClone(environment.persisted.get('biometric_encrypted_password'))
    const originalPrf = structuredClone(environment.persisted.get('biometric_prf_v2'))
    const originalCiphertext = environment.vaultCiphertext
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()
    environment.failSetKey = key

    await expect(withWalletMutation(scope =>
      BiometricService.prepareLegacyRecoveryPasswordReplacementWithinWalletMutation(
        scope,
        { ...context, biometricGeneration: 1 },
      ))).rejects.toThrow('Synthetic')

    expect(environment.vaultCiphertext).toBe(originalCiphertext)
    const vault = await WalletVaultService.read()
    expect(vault && await WalletVaultService.decrypt(vault, originalPassword)).toBe(walletMnemonic)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    if (failure === 'journal') {
      expect(environment.persisted.has('biometric_migration_v1')).toBe(false)
      expect(environment.persisted.get('biometric_encrypted_password')).toEqual(originalLegacy)
      expect(environment.persisted.get('biometric_prf_v2')).toEqual(originalPrf)
    } else {
      const journal = environment.persisted.get('biometric_migration_v1') as Record<string, unknown>
      expect(journal).toMatchObject({
        version: 1,
        walletId: context.vaultId,
        vaultRevision: context.vaultRevision,
        phase: 'legacy-recovery-prepared',
      })
      expect(JSON.stringify(journal)).not.toContain(originalPassword)
      expect(JSON.stringify(journal)).not.toContain(walletMnemonic)
      if (failure === 'legacy tombstone') {
        expect(environment.persisted.get('biometric_encrypted_password')).toEqual(originalLegacy)
        expect(environment.persisted.get('biometric_prf_v2')).toEqual(originalPrf)
      } else {
        expect(environment.persisted.get('biometric_encrypted_password')).toEqual({ version: 0, state: 'disabled' })
        expect(environment.persisted.get('biometric_prf_v2')).toEqual(originalPrf)
      }
      await expect(BiometricService.recoverLegacyForMigration({ ...context, biometricGeneration: 1 }))
        .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
      expect(navigator.credentials.get).not.toHaveBeenCalled()
    }
  })

  it('prepares both wrapper tombstones without a credential ceremony and preserves normal post-commit enrollment', async () => {
    const originalPassword = environment.password
    const replacement = 'PUBLIC-Replacement-Password-456!'
    environment.persisted.set('biometric_generation_v1', { version: 1, walletId: context.vaultId, generation: 1 })
    await installLegacyWrapper()
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()

    await withWalletMutation(scope =>
      BiometricService.prepareLegacyRecoveryPasswordReplacementWithinWalletMutation(
        scope,
        { ...context, biometricGeneration: 1 },
      ))

    const preparedJournal = environment.persisted.get('biometric_migration_v1') as Record<string, unknown>
    expect(Object.keys(preparedJournal).sort()).toEqual(['phase', 'updatedAt', 'vaultRevision', 'version', 'walletId'])
    expect(preparedJournal).toMatchObject({
      version: 1,
      walletId: context.vaultId,
      vaultRevision: context.vaultRevision,
      phase: 'legacy-recovery-prepared',
    })
    expect(JSON.stringify(preparedJournal)).not.toContain(originalPassword)
    expect(JSON.stringify(preparedJournal)).not.toContain(walletMnemonic)
    expect(environment.persisted.get('biometric_encrypted_password')).toEqual({ version: 0, state: 'disabled' })
    expect(environment.persisted.get('biometric_prf_v2')).toEqual({ version: 0, state: 'disabled' })
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    await expect(BiometricService.recoverLegacyForMigration({ ...context, biometricGeneration: 1 }))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()

    environment.vaultRevision = 1
    environment.password = replacement
    const committedContext = { ...context, vaultRevision: 1, biometricGeneration: 1 }
    await BiometricService.markPasswordCommitted(replacement, committedContext)

    expect(environment.persisted.get('biometric_migration_v1')).toMatchObject({
      walletId: context.vaultId,
      vaultRevision: 1,
      phase: 'password-committed-enrollment',
    })
    expect(environment.persisted.has('biometric_prf_v2')).toBe(false)
    expect(environment.persisted.get('biometric_encrypted_password')).toEqual({ version: 0, state: 'disabled' })
    expect(await BiometricService.getGeneration(context.vaultId)).toBe(2)

    expect(await BiometricService.enable(replacement, { ...committedContext, biometricGeneration: 2 }))
      .toMatchObject({ verified: true, legacyCleanupComplete: true })
    expect(navigator.credentials.create).toHaveBeenCalledTimes(1)
    expect(await BiometricService.inspect({ ...committedContext, biometricGeneration: 3 })).toMatchObject({
      prfState: 'matching',
      legacyState: 'absent',
      journalState: 'absent',
      cleanupPending: false,
    })
  })

  it('never accepts the old public-ID wrapper in normal authenticate', async () => {
    await installLegacyWrapper()
    expect(await BiometricService.hasLegacy()).toBe(true)
    expect(await BiometricService.isEnabled(context)).toBe(false)
    expect(await BiometricService.authenticate(context)).toEqual({ success: false })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
  })

  it('requires actual user-verification flags before returning a legacy recovery password', async () => {
    await installLegacyWrapper()
    environment.verified = false
    await expect(BiometricService.recoverLegacyForMigration(context)).rejects.toThrow('User verification')
    environment.verified = true
    expect(await BiometricService.recoverLegacyForMigration(context)).toBe(environment.password)
  })

  it('preserves legacy access if PRF enrollment or persistence fails', async () => {
    await installLegacyWrapper()
    environment.supported = false
    expect((await BiometricService.enable(environment.password, context)).verified).toBe(false)
    expect(await BiometricService.hasLegacy()).toBe(true)
    environment.supported = true
    environment.failPersist = true
    await expect(BiometricService.enable(environment.password, context)).rejects.toThrow('persistence failure')
    expect(await BiometricService.hasLegacy()).toBe(true)
  })

  it('removes legacy data only after a verified new PRF wrapper is persisted', async () => {
    await installLegacyWrapper()
    await BiometricService.enable(environment.password, context)
    expect(await BiometricService.hasLegacy()).toBe(false)
    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
  })

  it.each([
    'legacy-cleanup-required journal',
    'no journal after legacy residue is reintroduced',
  ])('blocks credential-ID legacy recovery when a matching PRF has %s', async scenario => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    if (scenario === 'legacy-cleanup-required journal') {
      environment.persisted.set('biometric_migration_v1', {
        version: 1, walletId: context.vaultId, vaultRevision: context.vaultRevision,
        phase: 'legacy-cleanup-required', updatedAt: 1,
      })
    }
    vi.mocked(navigator.credentials.get).mockClear()

    await expect(BiometricService.recoverLegacyForMigration({ ...context, biometricGeneration: 1 }))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
  })

  it('reuses a matching committed PRF for cleanup without creating another credential', async () => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    vi.mocked(navigator.credentials.create).mockClear()

    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(navigator.credentials.get).toHaveBeenCalled()
    expect(await BiometricService.hasLegacy()).toBe(false)
    expect(environment.persisted.has('biometric_migration_v1')).toBe(false)
  })

  it('rejects every envelope-field mutation during cleanup readback without creating another credential', async () => {
    await installLegacyWrapper()
    environment.mutatePrfUserIdDuringLegacyCleanup = true
    const result = await BiometricService.enable(environment.password, context)

    expect(result).toMatchObject({ verified: true, legacyCleanupComplete: false })
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'matching', legacyRecoveryBlocked: true,
    })
    expect(navigator.credentials.create).toHaveBeenCalledTimes(1)
    vi.mocked(navigator.credentials.create).mockClear()
    await BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 0 })
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('persists only a secret-free journal when cleanup must be retried', async () => {
    await installLegacyWrapper()
    environment.failLegacyRemove = true

    expect(await BiometricService.enable(environment.password, context)).toMatchObject({
      verified: true,
      legacyCleanupComplete: false,
      cleanupProof: expect.any(String),
    })
    const journal = environment.persisted.get('biometric_migration_v1') as Record<string, unknown>
    expect(Object.keys(journal).sort()).toEqual(['phase', 'updatedAt', 'vaultRevision', 'version', 'walletId'])
    expect(journal.phase).toBe('prf-committed-cleanup')
    expect(JSON.stringify(journal)).not.toContain(environment.password)
    expect(JSON.stringify(journal)).not.toContain('PUBLIC mnemonic fixture')
    expect(JSON.stringify(journal)).not.toContain('prfSecret')
  })

  it('classifies partial legacy records, malformed journals, and harmless lone markers', async () => {
    environment.persisted.set('biometric_enabled', true)
    expect(await BiometricService.inspect(context)).toMatchObject({ legacyState: 'absent', enabledMarker: true, cleanupPending: false })

    environment.persisted.set('biometric_credential_id', 'not-hex')
    expect(await BiometricService.inspect(context)).toMatchObject({ legacyState: 'partial', sensitiveLegacy: true, cleanupPending: true })

    environment.persisted.clear()
    environment.persisted.set('biometric_migration_v1', { version: 1, walletId: context.vaultId })
    expect(await BiometricService.inspect(context)).toMatchObject({ journalState: 'malformed', cleanupPending: true })
  })

  it('fences stale generations before changing committed biometric state', async () => {
    const initial = { ...context, biometricGeneration: 0 }
    expect((await BiometricService.enable(environment.password, initial)).verified).toBe(true)
    expect(await BiometricService.getGeneration(context.vaultId)).toBe(1)

    await expect(BiometricService.disable(initial)).rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_CHANGED' })
    expect(await BiometricService.isEnabled(context)).toBe(true)

    await BiometricService.disable({ ...context, biometricGeneration: 1 })
    expect(await BiometricService.isEnabled(context)).toBe(false)
    expect(await BiometricService.getGeneration(context.vaultId)).toBe(2)
  })

  it('removes a harmless lone marker without enrolling a credential', async () => {
    environment.persisted.set('biometric_enabled', true)
    await BiometricService.removeHarmlessMarker({ ...context, biometricGeneration: 0 })
    expect(environment.persisted.has('biometric_enabled')).toBe(false)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('allows explicit legacy recovery despite unrelated malformed PRF metadata', async () => {
    await installLegacyWrapper()
    environment.persisted.set('biometric_prf_v2', { version: 2, walletId: context.vaultId, data: 'invalid' })

    await expect(BiometricService.recoverLegacyForMigration(context)).resolves.toBe(environment.password)
    await BiometricService.markPasswordCommitted(environment.password, { ...context, biometricGeneration: 0 })
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'malformed',
      journal: expect.objectContaining({ phase: 'password-committed-enrollment' }),
    })
    await BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 1 })

    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'absent',
      legacyState: 'absent',
      journalState: 'absent',
      cleanupPending: false,
    })
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('blocks identity-foreign biometric state until verified password retirement', async () => {
    await BiometricService.enable(environment.password, context)
    const foreignContext = { ...context, vaultId: 'another-wallet' }

    expect(await BiometricService.inspect(foreignContext)).toMatchObject({
      prfState: 'foreign',
      generationState: 'foreign',
      cleanupIntent: 'password-only',
      cleanupPending: true,
    })
    await expect(BiometricService.authenticate(foreignContext)).rejects.toMatchObject({
      code: 'BIOMETRIC_CLEANUP_PENDING',
    })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
  })

  it.each([
    ['journal', 'biometric_migration_v1', {
      version: 1,
      walletId: 'foreign-wallet',
      vaultRevision: 0,
      phase: 'legacy-cleanup-required',
      updatedAt: 1,
    }],
    ['generation', 'biometric_generation_v1', {
      version: 1,
      walletId: 'foreign-wallet',
      generation: 7,
    }],
  ] as const)('treats a foreign %s record as password-only cleanup', async (_kind, key, value) => {
    environment.persisted.set(key, value)

    expect(await BiometricService.inspect(context)).toMatchObject({
      cleanupIntent: 'password-only',
      cleanupPending: true,
    })
  })

  it('gates malformed PRF state and retires it only after password verification', async () => {
    environment.persisted.set('biometric_prf_v2', { version: 2, walletId: context.vaultId, data: 'invalid' })
    expect(await BiometricService.inspect(context)).toMatchObject({ prfState: 'malformed', cleanupIntent: 'blocked', cleanupPending: true })

    await BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 0 })

    expect(await BiometricService.inspect(context)).toMatchObject({ prfState: 'absent', cleanupPending: false })
    expect(await BiometricService.getGeneration(context.vaultId)).toBe(1)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it.each([
    { walletId: '', vaultRevision: 0 },
    { walletId: '   ', vaultRevision: 0 },
    { walletId: context.vaultId, vaultRevision: -1 },
  ])('classifies invalid journal bindings as malformed and blocking: $walletId/$vaultRevision', async binding => {
    environment.persisted.set('biometric_migration_v1', {
      version: 1,
      ...binding,
      phase: 'legacy-cleanup-required',
      updatedAt: 1,
    })

    expect(await BiometricService.inspect(context)).toMatchObject({ journalState: 'malformed', cleanupIntent: 'blocked', cleanupPending: true })
  })

  it.each(['password-only-retirement', 'disable-biometric'] as const)('does not let legacy recovery replace %s intent with enrollment', async phase => {
    await installLegacyWrapper()
    environment.persisted.set('biometric_migration_v1', {
      version: 1,
      walletId: context.vaultId,
      vaultRevision: context.vaultRevision,
      phase,
      updatedAt: 1,
    })

    await expect(BiometricService.recoverLegacyForMigration(context)).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    await expect(BiometricService.markPasswordCommitted(environment.password, context)).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })

    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(await BiometricService.inspect(context)).toMatchObject({
      journal: expect.objectContaining({ phase }),
      cleanupIntent: 'password-only',
    })
  })

  it('keeps disable intent authoritative when malformed PRF metadata masks cleanupIntent', async () => {
    await installLegacyWrapper()
    environment.persisted.set('biometric_prf_v2', { malformed: true })
    environment.persisted.set('biometric_migration_v1', {
      version: 1,
      walletId: context.vaultId,
      vaultRevision: context.vaultRevision,
      phase: 'disable-biometric',
      updatedAt: 1,
    })

    expect(await BiometricService.inspect(context)).toMatchObject({ cleanupIntent: 'blocked' })
    await expect(BiometricService.recoverLegacyForMigration(context)).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    await expect(BiometricService.markPasswordCommitted(environment.password, context)).rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })

    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'malformed',
      journal: expect.objectContaining({ phase: 'disable-biometric' }),
    })
  })

  it.each([
    { phase: 'password-only-retirement', failure: 'PRF removal', failRemoveKey: 'biometric_prf_v2', failSetKey: null },
    { phase: 'password-only-retirement', failure: 'legacy removal', failRemoveKey: 'biometric_encrypted_password', failSetKey: null },
    { phase: 'password-only-retirement', failure: 'generation commit', failRemoveKey: null, failSetKey: 'biometric_generation_v1' },
    { phase: 'password-only-retirement', failure: 'journal clear', failRemoveKey: 'biometric_migration_v1', failSetKey: null },
    { phase: 'disable-biometric', failure: 'PRF removal', failRemoveKey: 'biometric_prf_v2', failSetKey: null },
    { phase: 'disable-biometric', failure: 'legacy removal', failRemoveKey: 'biometric_encrypted_password', failSetKey: null },
    { phase: 'disable-biometric', failure: 'generation commit', failRemoveKey: null, failSetKey: 'biometric_generation_v1' },
    { phase: 'disable-biometric', failure: 'journal clear', failRemoveKey: 'biometric_migration_v1', failSetKey: null },
  ] as const)('preserves $phase intent after $failure fails', async ({ phase, failRemoveKey, failSetKey }) => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    vi.mocked(navigator.credentials.create).mockClear()
    environment.failRemoveKey = failRemoveKey
    environment.failSetKey = failSetKey

    const operation = phase === 'password-only-retirement'
      ? BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 1 })
      : BiometricService.disable({ ...context, biometricGeneration: 1 })
    await expect(operation).rejects.toThrow('Synthetic')

    expect(await BiometricService.inspect(context)).toMatchObject({
      journal: expect.objectContaining({ phase }),
      cleanupIntent: 'password-only',
      cleanupPending: true,
    })
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it.each(['password-only-retirement', 'disable-biometric'] as const)('does not tombstone wrappers when %s cannot first journal intent', async phase => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    const originalPrf = structuredClone(environment.persisted.get('biometric_prf_v2'))
    const originalLegacy = structuredClone(environment.persisted.get('biometric_encrypted_password'))
    environment.failSetKey = 'biometric_migration_v1'

    const operation = phase === 'password-only-retirement'
      ? BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 1 })
      : BiometricService.disable({ ...context, biometricGeneration: 1 })
    await expect(operation).rejects.toThrow('Synthetic biometric_migration_v1 persistence failure')

    expect(environment.persisted.has('biometric_migration_v1')).toBe(false)
    expect(environment.persisted.get('biometric_prf_v2')).toEqual(originalPrf)
    expect(environment.persisted.get('biometric_encrypted_password')).toEqual(originalLegacy)
  })

  it.each([
    { phase: 'password-only-retirement', boundary: 'the PRF tombstone', failSetKey: 'biometric_prf_v2', failRemoveKey: null },
    { phase: 'disable-biometric', boundary: 'the PRF tombstone', failSetKey: 'biometric_prf_v2', failRemoveKey: null },
    { phase: 'password-only-retirement', boundary: 'legacy removal after both tombstones', failSetKey: null, failRemoveKey: 'biometric_encrypted_password' },
    { phase: 'disable-biometric', boundary: 'legacy removal after both tombstones', failSetKey: null, failRemoveKey: 'biometric_encrypted_password' },
  ] as const)('keeps $phase authoritative when retirement fails at $boundary', async ({ phase, failSetKey, failRemoveKey }) => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    environment.failSetKey = failSetKey
    environment.failRemoveKey = failRemoveKey

    const operation = phase === 'password-only-retirement'
      ? BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 1 })
      : BiometricService.disable({ ...context, biometricGeneration: 1 })
    await expect(operation).rejects.toThrow('Synthetic')

    expect(await BiometricService.inspect({ ...context, biometricGeneration: 1 })).toMatchObject({
      journal: expect.objectContaining({ phase }),
      cleanupIntent: 'password-only',
      cleanupPending: true,
    })
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()
    await expect(BiometricService.authenticate({ ...context, biometricGeneration: 1 }))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    await expect(BiometricService.enable(environment.password, { ...context, biometricGeneration: 1 }))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()

    environment.failSetKey = null
    environment.failRemoveKey = null
    await BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 1 })

    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'absent',
      legacyState: 'absent',
      journalState: 'absent',
      cleanupPending: false,
    })
    expect(await BiometricService.getGeneration(context.vaultId)).toBe(2)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(navigator.credentials.get).not.toHaveBeenCalled()
  })

  it('treats an old journal-less legacy tombstone as password-only retirement intent', async () => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    // This reproduces the historical crash window: legacy cached access was
    // tombstoned before the intent journal had been persisted.
    environment.persisted.set('biometric_encrypted_password', { version: 0, state: 'disabled' })
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()

    expect(await BiometricService.inspect({ ...context, biometricGeneration: 1 })).toMatchObject({
      prfState: 'matching',
      cleanupIntent: 'password-only',
      cleanupPending: true,
    })
    await expect(BiometricService.authenticate({ ...context, biometricGeneration: 1 }))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    await expect(BiometricService.enable(environment.password, { ...context, biometricGeneration: 1 }))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()

    await BiometricService.retireLegacyWithPassword(environment.password, { ...context, biometricGeneration: 1 })
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'absent',
      legacyState: 'absent',
      journalState: 'absent',
      cleanupPending: false,
    })
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('fails biometrics closed on malformed generation metadata and repairs it after password verification', async () => {
    await BiometricService.enable(environment.password, context)
    environment.persisted.set('biometric_generation_v1', { version: 1, walletId: '', generation: -1 })
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()

    await expect(BiometricService.getGeneration(context.vaultId)).rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_MALFORMED' })
    await expect(BiometricService.authenticate(context)).rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_MALFORMED' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    await expect(BiometricService.repairMalformedGenerationWithPassword('wrong-password', context)).rejects.toThrow('Wallet changed')
    expect(environment.persisted.has('biometric_prf_v2')).toBe(true)
    await expect(BiometricService.getGeneration(context.vaultId)).rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_MALFORMED' })

    expect(await BiometricService.repairMalformedGenerationWithPassword(environment.password, context)).toBe(0)
    expect(await BiometricService.getGeneration(context.vaultId)).toBe(0)
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'absent',
      legacyState: 'absent',
      journalState: 'absent',
      generationState: 'absent',
      cleanupPending: false,
    })
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(navigator.credentials.get).not.toHaveBeenCalled()
  })

  it('repairs unchanged malformed generation through the matching PRF and preserves the address-bound envelope', async () => {
    await BiometricService.enable(environment.password, context)
    const envelope = structuredClone(environment.persisted.get('biometric_prf_v2'))
    environment.persisted.set('biometric_generation_v1', { version: 1, walletId: '', generation: 1 })
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()
    environment.assertionMutationDepths = []
    const mutationsBeforeRepair = environment.walletMutationCalls

    const repaired = await BiometricService.repairMalformedGenerationWithBiometric(context)

    expect(environment.vaultAddress).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(repaired).toMatchObject({ password: environment.password, mnemonic: walletMnemonic, generation: expect.any(Number) })
    expect(repaired.generation).toBeGreaterThan(0)
    expect(repaired.generation).not.toBe(1)
    expect(environment.persisted.get('biometric_prf_v2')).toEqual(envelope)
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'matching',
      generationState: 'matching',
      generation: repaired.generation,
      cleanupPending: false,
    })
    expect(navigator.credentials.create).not.toHaveBeenCalled()
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1)
    expect(environment.assertionMutationDepths).toEqual([0])
    expect(environment.walletMutationCalls).toBeGreaterThan(mutationsBeforeRepair)
    expect(environment.walletMutationDepth).toBe(0)
  })

  it('propagates vault corruption rather than reporting the biometric credential as wrong', async () => {
    await BiometricService.enable(environment.password, context)
    const malformedGeneration = { version: 1, walletId: '', generation: 1 }
    const envelope = structuredClone(environment.persisted.get('biometric_prf_v2'))
    environment.persisted.set('biometric_generation_v1', malformedGeneration)
    environment.vaultCorruption = true

    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'WALLET_VAULT_CORRUPTED' })
    expect(environment.persisted.get('biometric_generation_v1')).toEqual(malformedGeneration)
    expect(environment.persisted.get('biometric_prf_v2')).toEqual(envelope)
  })

  it('does not repair when the authenticator returns the wrong credential or the stored address is foreign', async () => {
    await BiometricService.enable(environment.password, context)
    const envelope = structuredClone(environment.persisted.get('biometric_prf_v2'))
    const malformed = { version: 1, walletId: '', generation: 1 }
    environment.persisted.set('biometric_generation_v1', malformed)
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()
    environment.wrongCredential = true

    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_WRONG_CREDENTIAL' })
    expect(environment.persisted.get('biometric_generation_v1')).toEqual(malformed)
    expect(environment.persisted.get('biometric_prf_v2')).toEqual(envelope)

    environment.wrongCredential = false
    environment.vaultAddress = `0x${'12'.repeat(20)}`
    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_WRONG_CREDENTIAL' })
    expect(environment.persisted.get('biometric_generation_v1')).toEqual(malformed)
    expect(environment.persisted.get('biometric_prf_v2')).toEqual(envelope)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('rejects a foreign PRF envelope and retirement intent before any assertion', async () => {
    await BiometricService.enable(environment.password, context)
    const foreignEnvelope = environment.persisted.get('biometric_prf_v2') as { walletId: string }
    foreignEnvelope.walletId = 'foreign-wallet'
    environment.persisted.set('biometric_generation_v1', { malformed: true })
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()

    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()

    foreignEnvelope.walletId = context.vaultId
    environment.persisted.set('biometric_migration_v1', {
      version: 1,
      walletId: context.vaultId,
      vaultRevision: context.vaultRevision,
      phase: 'disable-biometric',
      updatedAt: 1,
    })
    vi.mocked(navigator.credentials.get).mockClear()
    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('rejects malformed-generation biometric repair for a historical password-only tombstone', async () => {
    await BiometricService.enable(environment.password, context)
    await installLegacyWrapper()
    // Historical crash state: a matching PRF remains, but the old legacy
    // wrapper was disabled before any retirement journal was recorded.
    environment.persisted.set('biometric_encrypted_password', { version: 0, state: 'disabled' })
    const malformedGeneration = { version: 1, walletId: '', generation: -1 }
    environment.persisted.set('biometric_generation_v1', malformedGeneration)
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockClear()

    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'matching',
      generationState: 'malformed',
      journalState: 'absent',
      cleanupIntent: 'password-only',
    })
    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_CLEANUP_PENDING' })
    await expect(BiometricService.authenticate(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_MALFORMED' })
    expect(environment.persisted.get('biometric_generation_v1')).toEqual(malformedGeneration)
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()

    expect(await BiometricService.repairMalformedGenerationWithPassword(environment.password, context)).toBe(0)
    expect(await BiometricService.inspect(context)).toMatchObject({
      prfState: 'absent',
      legacyState: 'absent',
      journalState: 'absent',
      generationState: 'absent',
      cleanupPending: false,
    })
    expect(navigator.credentials.get).not.toHaveBeenCalled()
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('does not overwrite generation metadata that changes during the PRF assertion', async () => {
    await BiometricService.enable(environment.password, context)
    const initialMalformed = { malformed: 'initial' }
    const changedMalformed = { malformed: 'changed' }
    environment.persisted.set('biometric_generation_v1', initialMalformed)
    vi.mocked(navigator.credentials.create).mockClear()
    vi.mocked(navigator.credentials.get).mockImplementationOnce(async options => {
      const asserted = await credential(options, false)
      environment.persisted.set('biometric_generation_v1', changedMalformed)
      return asserted
    })

    await expect(BiometricService.repairMalformedGenerationWithBiometric(context))
      .rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_CHANGED' })
    expect(environment.persisted.get('biometric_generation_v1')).toEqual(changedMalformed)
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('never resets a structurally valid generation record through malformed-state recovery', async () => {
    await BiometricService.enable(environment.password, context)

    await expect(BiometricService.repairMalformedGenerationWithPassword(environment.password, context)).rejects.toMatchObject({ code: 'BIOMETRIC_GENERATION_CHANGED' })

    expect(await BiometricService.getGeneration(context.vaultId)).toBe(1)
    expect(await BiometricService.isEnabled(context)).toBe(true)
  })

  it('removes sensitive biometric residue under the wallet lock when no encrypted wallet exists', async () => {
    environment.vaultPresent = false
    await installLegacyWrapper()
    environment.persisted.set('biometric_prf_v2', { malformed: true })
    environment.persisted.set('biometric_migration_v1', { malformed: true })
    environment.persisted.set('biometric_generation_v1', { malformed: true })

    await BiometricService.cleanupOrphanedState()

    expect(await BiometricService.inspect()).toMatchObject({
      prfState: 'absent',
      legacyState: 'absent',
      journalState: 'absent',
      generationState: 'absent',
      enabledMarker: false,
      cleanupPending: false,
    })
  })
})
