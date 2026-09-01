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
}))
vi.mock('../../packages/core/src/utils/BiometricUtil', () => ({ BiometricUtil: { getPlatform: () => 'web', isWebAuthnAvailable: () => true } }))
vi.mock('../../packages/core/src/services/StorageService', () => ({ StorageService: { basic: {
  getItem: async (key: string) => environment.persisted.get(key) ?? null,
  setItem: async (key: string, value: unknown) => {
    if (environment.failPersist) throw new Error('Synthetic persistence failure')
    environment.persisted.set(key, structuredClone(value))
  },
  removeItem: async (key: string) => { environment.persisted.delete(key) },
} } }))
vi.mock('../../packages/core/src/services/WalletVaultService', () => ({
  withWalletMutation: (fn: () => Promise<unknown>) => fn(),
  WalletVaultService: {
    read: async () => ({ id: 'public-test-vault', revision: 0 }),
    decrypt: async (_vault: unknown, password: string) => password === environment.password ? 'PUBLIC mnemonic fixture' : null,
  },
}))

import { BiometricService } from '../../packages/core/src/services/BiometricService'
const context = { vaultId: 'public-test-vault', vaultRevision: 0 }
const credentialId = new Uint8Array(32).fill(7)
const encoder = new TextEncoder()

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
  environment.failPersist = false
  vi.stubGlobal('navigator', { credentials: { create: vi.fn(options => credential(options, true)), get: vi.fn(options => credential(options, false)) } })
})

describe('PRF-protected password wrapper with real WebCrypto and mocked authenticator', () => {
  it('enrolls, persists only encrypted data and authenticates through PRF', async () => {
    expect(await BiometricService.enable(environment.password, context)).toBe(true)
    expect(await BiometricService.isEnabled(context)).toBe(true)
    const record = environment.persisted.get('biometric_prf_v2') as Record<string, unknown>
    expect(record.version).toBe(2)
    expect(JSON.stringify(record)).not.toContain(environment.password)
    expect(record).not.toHaveProperty('key')
    expect(record).not.toHaveProperty('prfSecret')
    expect(await BiometricService.authenticate(context)).toEqual({ success: true, password: environment.password })
    expect(navigator.credentials.get).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({ userVerification: 'required' }) }))
  })

  it('uses a subsequent assertion when create supports PRF but has no output', async () => {
    environment.createOutput = false
    expect(await BiometricService.enable(environment.password, context)).toBe(true)
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1)
    expect((await BiometricService.authenticate(context)).password).toBe(environment.password)
  })

  it('leaves password-only mode when PRF is not available', async () => {
    environment.supported = false
    expect(await BiometricService.enable(environment.password, context)).toBe(false)
    expect(environment.persisted.has('biometric_prf_v2')).toBe(false)
    expect(await BiometricService.isEnabled(context)).toBe(false)
  })

  it('rejects missing user verification, wrong credential and a changed wallet identity', async () => {
    await BiometricService.enable(environment.password, context)
    environment.verified = false
    await expect(BiometricService.authenticate(context)).rejects.toThrow('User verification')
    environment.verified = true
    environment.wrongCredential = true
    await expect(BiometricService.authenticate(context)).rejects.toThrow('Wrong authenticator')
    expect(await BiometricService.authenticate({ ...context, vaultId: 'another-wallet' })).toEqual({ success: false })
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
    expect(await BiometricService.enable(environment.password, context)).toBe(false)
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
})
