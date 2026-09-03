import {
  WALLET_RESET_ATTESTED,
  WALLET_RESET_BARRIER_PROTOCOL,
  WALLET_RESET_PREPARE,
  isWalletResetBarrierResponse,
  isWalletResetChallenge,
  type WalletResetBarrierResponse,
} from './WalletResetBarrierProtocol'

const UPDATE_WAIT_MS = 2_500
const BARRIER_TIMEOUT_MS = 12_000
const REPLACEMENT_RESERVE_MS = 4_000
const MINIMUM_REQUEST_WINDOW_MS = 1_000
let attestationInstalled = false

function resetError(): Error {
  return new Error('Open wallet windows did not finish updating in time. Close other wallet tabs and retry.')
}

function deadlineError(message: string): Error {
  return new Error(message)
}

function remainingUntil(deadline: number): number {
  return deadline - Date.now()
}

function hasUsefulRequestWindow(deadline: number): boolean {
  return remainingUntil(deadline) >= MINIMUM_REQUEST_WINDOW_MS
}

function withinDeadline<T>(operation: () => PromiseLike<T> | T, deadline: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: (value: T | Error) => void, value: T | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => finish(reject as (value: T | Error) => void, deadlineError(message)), Math.max(0, remainingUntil(deadline)))

    Promise.resolve()
      .then(operation)
      .then(
        value => finish(resolve as (value: T | Error) => void, value),
        error => finish(reject as (value: T | Error) => void, error instanceof Error ? error : new Error(String(error))),
      )
  })
}

function authoritativeWorker(registration: ServiceWorkerRegistration): ServiceWorker | null {
  return registration.active ?? navigator.serviceWorker.controller ?? null
}

interface ReplacementWatcher {
  changed: Promise<ServiceWorker>
  stop: () => void
}

function watchForReplacement(registration: ServiceWorkerRegistration, current: ServiceWorker, deadline: number): ReplacementWatcher {
  let settled = false
  let resolveChanged!: (worker: ServiceWorker) => void
  let rejectChanged!: (error: Error) => void
  const observedWorkers = new Set<ServiceWorker>()
  const changed = new Promise<ServiceWorker>((resolve, reject) => {
    resolveChanged = resolve
    rejectChanged = reject
  })

  const finish = (worker?: ServiceWorker, error?: Error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    navigator.serviceWorker.removeEventListener('controllerchange', check)
    registration.removeEventListener('updatefound', inspect)
    for (const worker of observedWorkers) worker.removeEventListener('statechange', check)
    if (worker) resolveChanged(worker)
    else rejectChanged(error ?? deadlineError('The service worker did not change before the handoff deadline.'))
  }

  const observe = (worker: ServiceWorker | null) => {
    if (!worker || observedWorkers.has(worker)) return
    observedWorkers.add(worker)
    worker.addEventListener('statechange', check)
  }

  const inspect = () => {
    observe(registration.installing)
    observe(registration.waiting)
    observe(registration.active)
    check()
  }

  const check = () => {
    const replacement = authoritativeWorker(registration)
    if (replacement && replacement !== current) finish(replacement)
  }

  const timer = setTimeout(() => finish(undefined, deadlineError('The service worker did not change before the handoff deadline.')), Math.max(0, remainingUntil(deadline)))

  // Install listeners before looking at state so an activation between either step
  // is observed. updatefound installs a state listener for the new worker, then
  // rechecks the authoritative worker immediately.
  navigator.serviceWorker.addEventListener('controllerchange', check)
  registration.addEventListener('updatefound', inspect)
  inspect()

  return { changed, stop: () => finish(undefined, deadlineError('The service worker replacement watch was stopped.')) }
}

function requestBarrier(
  worker: ServiceWorker,
  deadline: number,
  signal: AbortSignal,
  isAuthoritative: () => boolean,
): Promise<WalletResetBarrierResponse> {
  return new Promise<WalletResetBarrierResponse>((resolve, reject) => {
    const channel = new MessageChannel()
    const requestId = window.crypto.randomUUID()
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      channel.port1.onmessage = null
      channel.port1.onmessageerror = null
      try {
        channel.port1.close()
      } catch {
        // A transferred or already-disconnected port is already unusable.
      }
      try {
        channel.port2.close()
      } catch {
        // A transferred or already-disconnected port is already unusable.
      }
    }
    const settle = (callback: (value: WalletResetBarrierResponse | Error) => void, value: WalletResetBarrierResponse | Error) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const rejectWith = (message: string) => settle(reject as (value: WalletResetBarrierResponse | Error) => void, new Error(message))
    const abort = () => rejectWith('The service worker changed while the wallet update gate was running.')
    const timer = setTimeout(() => rejectWith('Open wallet windows did not finish updating in time.'), Math.max(0, remainingUntil(deadline)))

    channel.port1.onmessage = event => {
      if (!isAuthoritative()) {
        rejectWith('The service worker changed while the wallet update gate was running.')
      } else if (!isWalletResetBarrierResponse(event.data)) {
        rejectWith('The wallet update gate returned an invalid response.')
      } else {
        settle(resolve as (value: WalletResetBarrierResponse | Error) => void, event.data)
      }
    }
    channel.port1.onmessageerror = () => rejectWith('The wallet update gate response could not be read.')
    signal.addEventListener('abort', abort, { once: true })

    if (signal.aborted || !isAuthoritative()) {
      abort()
      return
    }

    try {
      worker.postMessage({
        type: WALLET_RESET_PREPARE,
        protocol: WALLET_RESET_BARRIER_PROTOCOL,
        requestId,
      }, [channel.port2])
    } catch (error) {
      settle(reject as (value: WalletResetBarrierResponse | Error) => void, error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function responseError(response: WalletResetBarrierResponse): Error {
  if (response.ok) return new Error('Unexpected successful wallet reset barrier response.')
  return new Error(response.unresolvedClients
    ? `${response.unresolvedClients} open wallet window${response.unresolvedClients === 1 ? '' : 's'} could not be updated. Close other wallet tabs and retry.`
    : response.reason)
}

function settleRequest(request: Promise<WalletResetBarrierResponse>): Promise<{ kind: 'response'; response: WalletResetBarrierResponse } | { kind: 'error'; error: Error }> {
  return request.then(
    response => ({ kind: 'response' as const, response }),
    error => ({ kind: 'error' as const, error: error instanceof Error ? error : new Error(String(error)) }),
  )
}

export function installPwaWalletResetAttestation(): void {
  if (attestationInstalled || !('serviceWorker' in navigator)) return
  attestationInstalled = true
  navigator.serviceWorker.addEventListener('message', event => {
    if (!isWalletResetChallenge(event.data)) return
    const worker = event.source && 'postMessage' in event.source
      ? event.source
      : navigator.serviceWorker.controller
    worker?.postMessage({
      type: WALLET_RESET_ATTESTED,
      protocol: WALLET_RESET_BARRIER_PROTOCOL,
      requestId: event.data.requestId,
      nonce: event.data.nonce,
    })
  })
}

/**
 * Best-effort update discovery followed by a mandatory response from the active
 * barrier-aware worker. Offline deletion remains possible when that worker and
 * every open window are already current.
 */
export async function preparePwaWalletReset(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Wallet deletion requires a current production app. Reload in a supported browser and retry.')
  }
  installPwaWalletResetAttestation()

  const deadline = Date.now() + BARRIER_TIMEOUT_MS
  const handoffDeadline = deadline - REPLACEMENT_RESERVE_MS
  const registration = await withinDeadline(
    () => navigator.serviceWorker.getRegistration(),
    deadline,
    'Wallet deletion could not verify the installed app version. Reload the wallet and retry.',
  )
  if (!registration) {
    throw new Error('Wallet deletion could not verify the installed app version. Reload the wallet and retry.')
  }

  // Do not make network availability a prerequisite: a current installed PWA
  // can attest offline. Bound discovery both independently and before the
  // handoff point so a replacement still has a useful request window.
  try {
    await withinDeadline(
      () => registration.update(),
      Math.min(Date.now() + UPDATE_WAIT_MS, handoffDeadline),
      'Service worker update check timed out',
    )
  } catch {
    // The authoritative worker protocol below remains mandatory.
  }

  const initialWorker = authoritativeWorker(registration)
  if (!initialWorker) {
    throw new Error('Wallet deletion could not reach the installed app update gate. Reload and retry.')
  }
  if (!hasUsefulRequestWindow(handoffDeadline)) throw resetError()

  const firstAbort = new AbortController()
  const firstWatch = watchForReplacement(registration, initialWorker, handoffDeadline)
  const firstRequest = settleRequest(requestBarrier(
    initialWorker,
    handoffDeadline,
    firstAbort.signal,
    () => authoritativeWorker(registration) === initialWorker,
  ))
  const firstOutcome = await Promise.race([
    firstRequest,
    firstWatch.changed.then(worker => ({ kind: 'replacement' as const, worker }), error => ({ kind: 'watch-error' as const, error })),
  ])
  firstWatch.stop()

  if (firstOutcome.kind === 'response' && authoritativeWorker(registration) === initialWorker) {
    if (firstOutcome.response.ok) return
    throw responseError(firstOutcome.response)
  }

  let replacement: ServiceWorker | null = null
  if (firstOutcome.kind === 'replacement') replacement = firstOutcome.worker
  else {
    const selected = authoritativeWorker(registration)
    if (selected && selected !== initialWorker) replacement = selected
  }

  if (!replacement) {
    firstAbort.abort()
    if (firstOutcome.kind === 'error') throw firstOutcome.error
    throw resetError()
  }

  // A replacement won the race. Abort and close the old request before issuing
  // the sole allowed replacement request.
  firstAbort.abort()
  await firstRequest
  if (!hasUsefulRequestWindow(deadline) || replacement === initialWorker) throw resetError()

  const replacementAbort = new AbortController()
  const replacementWatch = watchForReplacement(registration, replacement, deadline)
  const replacementRequest = settleRequest(requestBarrier(
    replacement,
    deadline,
    replacementAbort.signal,
    () => authoritativeWorker(registration) === replacement,
  ))
  const replacementOutcome = await Promise.race([
    replacementRequest,
    replacementWatch.changed.then(worker => ({ kind: 'replacement' as const, worker }), error => ({ kind: 'watch-error' as const, error })),
  ])
  replacementWatch.stop()

  if (replacementOutcome.kind === 'response' && authoritativeWorker(registration) === replacement) {
    if (replacementOutcome.response.ok) return
    throw responseError(replacementOutcome.response)
  }

  replacementAbort.abort()
  await replacementRequest
  // Never transfer trust to a third worker: a final handoff must be retried by
  // the caller from a clean, current service-worker state.
  if (replacementOutcome.kind === 'replacement' || authoritativeWorker(registration) !== replacement) {
    throw new Error('The service worker changed again while the wallet update gate was running. Reload and retry.')
  }
  if (replacementOutcome.kind === 'error') throw replacementOutcome.error
  throw resetError()
}
