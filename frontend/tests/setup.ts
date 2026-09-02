import { webcrypto } from 'node:crypto'
import { vi } from 'vitest'

// Node integration tests use the real WebCrypto implementation; no authenticator.
if (typeof document === 'undefined') {
  vi.stubGlobal('window', { crypto: webcrypto, location: { hostname: 'wallet-test.invalid', origin: 'https://wallet-test.invalid' } })
}

// JSDOM intentionally leaves scrolling unimplemented. UI primitives may call
// this browser API while opening/closing overlays, so provide the browser-side
// no-op rather than allowing expected interactions to pollute test stderr.
if (typeof document !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
}
