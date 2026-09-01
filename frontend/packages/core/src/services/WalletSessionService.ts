const EVENT_KEY = 'ge_wallet_session_event'
const sourceId = typeof window !== 'undefined' ? window.crypto.randomUUID() : 'server'
let channel: BroadcastChannel | undefined

export function readWalletSessionToken(): string | null {
  if (typeof window === 'undefined' || !('localStorage' in window)) return null
  // An unreadable session token must fail closed, not silently match a stale one.
  return window.localStorage.getItem(EVENT_KEY)
}

export function publishWalletInvalidation(): string | null {
  if (typeof window === 'undefined') return null
  const message = { sourceId, nonce: window.crypto.randomUUID() }
  channel?.postMessage(message)
  if ('localStorage' in window) {
    const token = JSON.stringify(message)
    window.localStorage.setItem(EVENT_KEY, token)
    return token
  }
  return null
}

export function subscribeWalletInvalidation(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return () => undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === EVENT_KEY || event.key.includes('ge_secure:')) listener()
  }
  window.addEventListener('storage', onStorage)
  if ('BroadcastChannel' in window) {
    channel = new window.BroadcastChannel('goldenera-wallet-session')
    channel.onmessage = event => {
      if (event.data?.sourceId !== sourceId) listener()
    }
  }
  return () => {
    window.removeEventListener('storage', onStorage)
    channel?.close()
    channel = undefined
  }
}
