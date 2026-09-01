import { webcrypto } from 'node:crypto'
import { vi } from 'vitest'

// Node integration tests use the real WebCrypto implementation; no authenticator.
if (typeof document === 'undefined') {
  vi.stubGlobal('window', { crypto: webcrypto, location: { hostname: 'wallet-test.invalid', origin: 'https://wallet-test.invalid' } })
}
