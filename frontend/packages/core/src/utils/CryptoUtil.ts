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

  /**
   * Encrypts a string using a Password-derived key.
   */
  async encrypt(data: string, password: string): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const derivedKey = await this.deriveKeyFromPassword(password, salt);
    const encodedData = new TextEncoder().encode(data);

    const encryptedContent = await window.crypto.subtle.encrypt(
      { name: this.ALGO_AES, iv },
      derivedKey,
      encodedData
    );

    const payload = {
      v: 1, // version for future migrations
      iv: bufferToHex(iv),
      salt: bufferToHex(salt),
      data: bufferToHex(encryptedContent),
    };

    return JSON.stringify(payload);
  },

  /**
   * Decrypts a string using a Password-derived key.
   */
  async decrypt(encryptedData: string, password: string): Promise<string | null> {
    try {
      const payload = JSON.parse(encryptedData);
      if (!payload.iv || !payload.salt || !payload.data) return null;

      const salt = hexToBuffer(payload.salt);
      const iv = hexToBuffer(payload.iv);
      const data = hexToBuffer(payload.data);

      const derivedKey = await this.deriveKeyFromPassword(password, salt);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: this.ALGO_AES, iv: iv as BufferSource },
        derivedKey,
        data as BufferSource
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  },

  /**
   * Private helper to derive a key from a Password using PBKDF2.
   */
  async deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: this.ALGO_KDF },
      false,
      ['deriveKey']
    );

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
    );
  }
};
