const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

interface UuidCrypto {
  randomUUID?: Crypto['randomUUID']
  getRandomValues: Crypto['getRandomValues']
}

export function createUuid(source: UuidCrypto = globalThis.crypto): string {
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('Secure random UUID generation is unavailable.')
  }
  if (typeof source.randomUUID === 'function') {
    try {
      const native = source.randomUUID().toLowerCase()
      if (uuidV4.test(native)) return native
    } catch { /* Fall through to the getRandomValues compatibility path. */ }
  }

  const bytes = source.getRandomValues(new Uint8Array(16))
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new Error('Secure random UUID generation returned invalid bytes.')
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
