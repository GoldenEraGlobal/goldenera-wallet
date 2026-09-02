/**
 * Converts a buffer to a hex string.
 */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Converts a hex string to a Uint8Array.
 */
export function hexToBuffer(hex: string): Uint8Array {
  const parts = hex.match(/.{1,2}/g)
  if (!parts) return new Uint8Array(0)
  return new Uint8Array(parts.map((byte) => parseInt(byte, 16)))
}

/** Thrown when persisted password-encrypted data is not a valid v1 envelope. */
export class EncryptedPayloadCorruptionError extends Error {
  readonly code = 'ENCRYPTED_PAYLOAD_CORRUPTED'

  constructor() {
    super('Encrypted wallet data is corrupted.')
    this.name = 'EncryptedPayloadCorruptionError'
  }
}

export interface PasswordEncryptedPayload {
  v: 1
  iv: string
  salt: string
  data: string
}

const canonicalHex = (value: unknown, byteLength: number): value is string =>
  typeof value === 'string'
  && value.length === byteLength * 2
  && value.length % 2 === 0
  && /^[0-9a-fA-F]+$/.test(value)

/**
 * Parses the historical password-encrypted envelope without normalizing it.
 * Existing readers accepted either hexadecimal case, so both remain supported.
 */
export function parsePasswordEncryptedPayload(encryptedData: string): PasswordEncryptedPayload {
  let parsed: unknown
  try { parsed = JSON.parse(encryptedData) } catch { throw new EncryptedPayloadCorruptionError() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new EncryptedPayloadCorruptionError()
  const payload = parsed as Partial<PasswordEncryptedPayload>
  if (payload.v !== 1
    || !canonicalHex(payload.iv, CryptoUtil.IV_LENGTH_BYTES)
    || !canonicalHex(payload.salt, CryptoUtil.SALT_LENGTH_BYTES)
    || typeof payload.data !== 'string'
    || payload.data.length % 2 !== 0
    || payload.data.length < CryptoUtil.AES_GCM_TAG_LENGTH_BYTES * 2
    || !/^[0-9a-fA-F]+$/.test(payload.data)) {
    throw new EncryptedPayloadCorruptionError()
  }
  return payload as PasswordEncryptedPayload
}

/**
 * Utility for cryptographic operations using the Web Crypto API.
 * Focuses on security and performance without external dependencies.
 */
export const CryptoUtil = {
  // NIST/OWASP recommendation for PBKDF2 iterations (v4.0.3)
  // Higher is better but slower. 600,000 is a good balance for modern devices.
  ITERATIONS: 600000,
  KEY_LENGTH: 256,
  ALGO_AES: 'AES-GCM',
  ALGO_KDF: 'PBKDF2',
  SALT_LENGTH_BYTES: 16,
  IV_LENGTH_BYTES: 12,
  AES_GCM_TAG_LENGTH_BYTES: 16,

  /**
   * Encrypts a string using a Password-derived key.
   */
  async encrypt(data: string, password: string): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH_BYTES))
    const iv = window.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH_BYTES))

    const derivedKey = await this.deriveKeyFromPassword(password, salt)
    const encodedData = new TextEncoder().encode(data)

    const encryptedContent = await window.crypto.subtle.encrypt(
      { name: this.ALGO_AES, iv },
      derivedKey,
      encodedData
    )

    const payload = {
      v: 1, // version for future migrations
      iv: bufferToHex(iv),
      salt: bufferToHex(salt),
      data: bufferToHex(encryptedContent),
    }

    return JSON.stringify(payload)
  },

  /**
   * Decrypts a string using a Password-derived key. A well-formed envelope that
   * cannot authenticate remains indistinguishable from a wrong password.
   */
  async decrypt(encryptedData: string, password: string): Promise<string | null> {
    const payload = parsePasswordEncryptedPayload(encryptedData)
    try {
      const salt = hexToBuffer(payload.salt)
      const iv = hexToBuffer(payload.iv)
      const data = hexToBuffer(payload.data)

      const derivedKey = await this.deriveKeyFromPassword(password, salt)

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: this.ALGO_AES, iv: iv as BufferSource },
        derivedKey,
        data as BufferSource
      )

      return new TextDecoder().decode(decryptedBuffer)
    } catch {
      return null
    }
  },

  /**
   * Private helper to derive a key from a Password using PBKDF2.
   */
  async deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: this.ALGO_KDF },
      false,
      ['deriveKey']
    )

    return window.crypto.subtle.deriveKey(
      {
        name: this.ALGO_KDF,
        salt: salt as BufferSource,
        iterations: this.ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.ALGO_AES, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    )
  }
}
