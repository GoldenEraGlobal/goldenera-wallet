import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { BiometricUtil, type BiometricType } from '../utils/BiometricUtil'
import { bufferToHex, hexToBuffer } from '../utils/CryptoUtil'
import { StorageService } from './StorageService'
import { WalletVaultService, withWalletMutation } from './WalletVaultService'

const KEYS = { ENABLED: 'biometric_enabled', CREDENTIAL_ID: 'biometric_credential_id', ENCRYPTED_PASSWORD: 'biometric_encrypted_password', PRF: 'biometric_prf_v2' }
const SERVER_ID = 'wallet.goldenera.global'
const SCHEME = 'webauthn-prf-hkdf-sha256-aes256gcm'
const WEBAUTHN_USER_NAME = 'GoldenEra Wallet'
const WEBAUTHN_USER_DISPLAY_NAME = 'GoldenEra Wallet'

export interface BiometricContext {
  vaultId: string
  vaultRevision: number
  signal?: AbortSignal
  isCurrent?: () => boolean
}
export interface BiometricEnrollmentResult {
  verified: boolean
  legacyCleanupComplete: boolean
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
const assertCurrent = (context: BiometricContext) => {
  if (context.signal?.aborted || context.isCurrent?.() === false) throw new Error('Wallet session changed. Retry authentication.')
}
const matches = (envelope: PrfEnvelope, context: BiometricContext) => envelope.walletId === context.vaultId && envelope.vaultRevision === context.vaultRevision && envelope.rpId === window.location.hostname

function parseEnvelope(value: unknown): PrfEnvelope | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<PrfEnvelope>
  if (record.version !== 2 || record.scheme !== SCHEME || typeof record.walletId !== 'string' || typeof record.rpId !== 'string' ||
    !Number.isSafeInteger(record.vaultRevision) || !hex(record.credentialId) || !hex(record.prfInput, 32) || !hex(record.salt, 32) || !hex(record.iv, 12) || !hex(record.data)) return null
  if (record.userId !== undefined && !isBase64url(record.userId)) return null
  return record as PrfEnvelope
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
  if (!credential || bufferToHex(credential.rawId) !== credentialId.toLowerCase()) throw new Error('Wrong authenticator credential')
  validateClientData(credential, challenge, 'webauthn.get')
  const authData = new Uint8Array((credential.response as AuthenticatorAssertionResponse).authenticatorData)
  const rpHash = bufferToHex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(window.location.hostname)))
  if (authData.length < 37 || (authData[32] & 5) !== 5 || bufferToHex(authData.slice(0, 32)) !== rpHash) throw new Error('User verification was not completed')
  return credential
}

async function decryptEnvelope(envelope: PrfEnvelope, key: CryptoKey): Promise<string> {
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBuffer(envelope.iv) as BufferSource, additionalData: aad(envelope) }, key, hexToBuffer(envelope.data) as BufferSource)
  return new TextDecoder().decode(decrypted)
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

  async hasLegacy(): Promise<boolean> {
    if (BiometricUtil.getPlatform() !== 'web') return false
    return await StorageService.basic.getItem(KEYS.CREDENTIAL_ID) !== null || await StorageService.basic.getItem(KEYS.ENCRYPTED_PASSWORD) !== null
  },

  async isEnabled(context: BiometricContext): Promise<boolean> {
    if (BiometricUtil.getPlatform() !== 'web') return await StorageService.basic.getItem(KEYS.ENABLED) === true
    const envelope = parseEnvelope(await StorageService.basic.getItem(KEYS.PRF))
    return !!envelope && matches(envelope, context)
  },

  async authenticate(context: BiometricContext): Promise<{ success: boolean; password?: string }> {
    assertCurrent(context)
    if (BiometricUtil.getPlatform() !== 'web') {
      await NativeBiometric.verifyIdentity({ reason: 'Authenticate to unlock your wallet', title: 'GoldenEra Wallet' })
      const credentials = await NativeBiometric.getCredentials({ server: SERVER_ID })
      assertCurrent(context)
      return { success: true, password: credentials.password }
    }
    const envelope = parseEnvelope(await StorageService.basic.getItem(KEYS.PRF))
    if (!envelope || !matches(envelope, context)) return { success: false }
    const credential = await assertion(envelope.credentialId, context, envelope.prfInput)
    const secret = prfOutput(credential)
    if (!secret) throw new Error('This authenticator cannot unlock the wallet securely. Use your password.')
    const key = await wrappingKey(secret, envelope.salt)
    const password = await decryptEnvelope(envelope, key)
    assertCurrent(context)
    const returnedUserHandle = (credential.response as AuthenticatorAssertionResponse).userHandle
    const assertedUserId = returnedUserHandle instanceof ArrayBuffer && returnedUserHandle.byteLength > 0 && returnedUserHandle.byteLength <= 64
      ? base64url(new Uint8Array(returnedUserHandle))
      : undefined
    void signalCredentialLabels(envelope, assertedUserId)
    return { success: true, password }
  },

  async enable(password: string, context: BiometricContext): Promise<BiometricEnrollmentResult> {
    assertCurrent(context)
    if (BiometricUtil.getPlatform() !== 'web') {
      await NativeBiometric.setCredentials({ username: 'goldenera-wallet', password, server: SERVER_ID })
      await StorageService.basic.setItem(KEYS.ENABLED, true)
      return { verified: true, legacyCleanupComplete: true }
    }
    if (!BiometricUtil.isWebAuthnAvailable()) return { verified: false, legacyCleanupComplete: false }
    const userId = await webauthnUserId(context.vaultId)
    assertCurrent(context)
    const challenge = random(32)
    const prfInput = random(32)
    const credential = await navigator.credentials.create({
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
    let legacyCleanupComplete = false
    await withWalletMutation(async () => {
      assertCurrent(context)
      const vault = await WalletVaultService.read()
      if (!vault || vault.id !== context.vaultId || vault.revision !== context.vaultRevision || !await WalletVaultService.decrypt(vault, password)) throw new Error('Wallet changed during biometric enrollment')
      assertCurrent(context)
      const previous = await StorageService.basic.getItem(KEYS.PRF)
      try {
        await StorageService.basic.setItem(KEYS.PRF, envelope)
        const persisted = parseEnvelope(await StorageService.basic.getItem(KEYS.PRF))
        if (!persisted || !matches(persisted, context) || await decryptEnvelope(persisted, key) !== password) throw new Error('Biometric persistence verification failed')
      } catch (error) {
        try {
          if (previous === null) await StorageService.basic.removeItem(KEYS.PRF)
          else await StorageService.basic.setItem(KEYS.PRF, previous)
        } catch { /* The caller still treats this enrollment as unverified. */ }
        throw error
      }
      assertCurrent(context)
      try {
        await this.removeLegacy()
        assertCurrent(context)
        legacyCleanupComplete = true
      } catch {
        // The PRF wrapper already passed a real decrypt readback. Its caller can
        // retry legacy cleanup without confusing this with an unverified write.
      }
    })
    return { verified: true, legacyCleanupComplete }
  },

  /** The only credential-ID decryption path: explicit one-time legacy recovery. */
  async recoverLegacyForMigration(context: BiometricContext): Promise<string> {
    if (BiometricUtil.getPlatform() !== 'web') throw new Error('Legacy recovery is only available for an existing web wallet')
    const credentialId = await StorageService.basic.getItem<string>(KEYS.CREDENTIAL_ID)
    const encrypted = await StorageService.basic.getItem<{ iv: string; data: string }>(KEYS.ENCRYPTED_PASSWORD)
    if (!hex(credentialId) || !encrypted || !hex(encrypted.iv, 12) || !hex(encrypted.data)) throw new Error('Legacy recovery is incomplete. Use your password or recovery phrase.')
    await assertion(credentialId, context)
    // Compatibility only after real user verification; never used by authenticate.
    const id = hexToBuffer(credentialId)
    const material = await window.crypto.subtle.importKey('raw', id as BufferSource, 'PBKDF2', false, ['deriveKey'])
    const key = await window.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: id.slice(0, 16) as BufferSource }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    const password = new TextDecoder().decode(await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBuffer(encrypted.iv) as BufferSource }, key, hexToBuffer(encrypted.data) as BufferSource))
    assertCurrent(context)
    return password
  },

  async removeLegacy(): Promise<void> {
    await StorageService.basic.removeItem(KEYS.ENCRYPTED_PASSWORD)
    await StorageService.basic.removeItem(KEYS.CREDENTIAL_ID)
    await StorageService.basic.removeItem(KEYS.ENABLED)
  },

  async disable(): Promise<void> {
    if (BiometricUtil.getPlatform() !== 'web') await NativeBiometric.deleteCredentials({ server: SERVER_ID })
    await StorageService.basic.removeItem(KEYS.PRF)
    await this.removeLegacy()
  },
}
