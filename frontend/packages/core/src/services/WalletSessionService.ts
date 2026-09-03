import { createUuid } from '../utils/UuidUtil'

const EVENT_KEY = 'ge_wallet_session_event'
const AUTHORIZATION_LOCK_NAME = 'goldenera-wallet-authorization-barrier'
const sourceId = typeof window !== 'undefined' ? createUuid(window.crypto) : 'server'
let channel: BroadcastChannel | undefined
let authorizationQueue: Promise<unknown> = Promise.resolve()
const authorizationBarrierScopeKey: unique symbol = Symbol('wallet-authorization-barrier-scope')
export interface WalletAuthorizationBarrierScope { readonly [authorizationBarrierScopeKey]: true }
const activeAuthorizationBarrierScopes = new WeakSet<object>()

async function runAuthorizationBarrier<T>(
  operation: (scope: WalletAuthorizationBarrierScope) => Promise<T>,
): Promise<T> {
  const scope = Object.freeze({ [authorizationBarrierScopeKey]: true }) as WalletAuthorizationBarrierScope
  activeAuthorizationBarrierScopes.add(scope)
  try { return await operation(scope) } finally { activeAuthorizationBarrierScopes.delete(scope) }
}

/**
 * Linearizes final transfer dispatch with every authoritative session-token
 * rotation. Nested lock order is one outer sender lane OR vault mutation lock
 * (never both) -> authorization barrier -> transfer journal. Code inside this
 * barrier must not acquire a sender/vault lock, and WebAuthn ceremonies run
 * before any wallet/vault mutation lock is acquired.
 */
export function withWalletAuthorizationBarrier<T>(
  operation: (scope: WalletAuthorizationBarrierScope) => Promise<T>,
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(AUTHORIZATION_LOCK_NAME, () => runAuthorizationBarrier(operation))
  }
  if (typeof document !== 'undefined') {
    return Promise.reject(new Error(
      'This browser cannot safely coordinate wallet authorization across tabs. Update your browser and retry.',
    ))
  }
  const run = () => runAuthorizationBarrier(operation)
  const result = authorizationQueue.then(run, run)
  authorizationQueue = result.catch(() => undefined)
  return result
}

export function readWalletSessionToken(): string | null {
  if (typeof window === 'undefined' || !('localStorage' in window)) return null
  // An unreadable session token must fail closed, not silently match a stale one.
  return window.localStorage.getItem(EVENT_KEY)
}

export function publishWalletInvalidation(scope: WalletAuthorizationBarrierScope): string | null {
  if (!activeAuthorizationBarrierScopes.has(scope)) {
    throw new Error('Wallet invalidation requires the active authorization barrier.')
  }
  if (typeof window === 'undefined') return null
  const message = { sourceId, nonce: createUuid(window.crypto) }
  let token: string | null = null
  if ('localStorage' in window) {
    token = JSON.stringify(message)
    // The durable token is authoritative. BroadcastChannel is only a hint and
    // must never be able to prevent cross-tab fencing.
    window.localStorage.setItem(EVENT_KEY, token)
  }
  try { channel?.postMessage(message) } catch { /* storage events still fence other tabs */ }
  return token
}

export function subscribeWalletInvalidation(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return () => undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === EVENT_KEY || event.key.includes('ge_secure:')) listener()
  }
  window.addEventListener('storage', onStorage)
  if (typeof window.BroadcastChannel === 'function') {
    try {
      channel = new window.BroadcastChannel('goldenera-wallet-session')
      channel.onmessage = event => {
        if (event.data?.sourceId !== sourceId) listener()
      }
    } catch {
      channel = undefined
    }
  }
  return () => {
    window.removeEventListener('storage', onStorage)
    try { channel?.close() } catch { /* no-op */ }
    channel = undefined
  }
}
