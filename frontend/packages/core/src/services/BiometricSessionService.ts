import { createUuid } from '../utils/UuidUtil'

const EVENT_KEY = 'ge_biometric_generation_event'
const CHANNEL_NAME = 'goldenera-wallet-biometric'
const sourceId = typeof window !== 'undefined' ? createUuid(window.crypto) : 'server'

export interface BiometricGenerationEvent {
  sourceId: string
  walletId: string
  generation: number
  nonce: string
}

export function publishBiometricGeneration(walletId: string, generation: number): void {
  if (typeof window === 'undefined') return
  const message: BiometricGenerationEvent = {
    sourceId,
    walletId,
    generation,
    nonce: createUuid(window.crypto),
  }
  // Generation persistence is authoritative. Notification transports are only
  // wake-up hints and must never make a committed mutation appear to fail.
  if ('BroadcastChannel' in window) {
    try {
      const publisher = new window.BroadcastChannel(CHANNEL_NAME)
      publisher.postMessage(message)
      publisher.close()
    } catch { /* The storage event remains an independent best-effort path. */ }
  }
  if ('localStorage' in window) {
    try { window.localStorage.setItem(EVENT_KEY, JSON.stringify(message)) } catch { /* Other tabs reconcile from persisted generation on their next operation. */ }
  }
}

export function subscribeBiometricGeneration(listener: (event: BiometricGenerationEvent) => void): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return () => undefined
  const accept = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const event = value as Partial<BiometricGenerationEvent>
    if (event.sourceId === sourceId || typeof event.sourceId !== 'string' || typeof event.walletId !== 'string'
      || !Number.isSafeInteger(event.generation) || Number(event.generation) < 0 || typeof event.nonce !== 'string') return
    listener(event as BiometricGenerationEvent)
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== EVENT_KEY || !event.newValue) return
    try { accept(JSON.parse(event.newValue)) } catch { /* Ignore malformed cross-tab events. */ }
  }
  window.addEventListener('storage', onStorage)
  let subscriber: BroadcastChannel | undefined
  if ('BroadcastChannel' in window) {
    try {
      subscriber = new window.BroadcastChannel(CHANNEL_NAME)
      subscriber.onmessage = event => accept(event.data)
    } catch { /* Storage events still provide an independent transport. */ }
  }
  return () => {
    window.removeEventListener('storage', onStorage)
    subscriber?.close()
  }
}
