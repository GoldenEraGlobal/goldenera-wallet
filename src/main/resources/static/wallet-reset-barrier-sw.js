(() => {
  'use strict'

  const scope = self
  const protocol = 'goldenera-wallet-reset-barrier-v1'
  const prepareType = 'GE_WALLET_RESET_PREPARE'
  const challengeType = 'GE_WALLET_RESET_CHALLENGE'
  const attestedType = 'GE_WALLET_RESET_ATTESTED'
  const barrierTimeoutMs = 8_000
  const clientEligibilityMs = 300
  const challengeCadenceMs = 150
  const pendingBarriers = new Map()

  const isMessage = (value, type) => value && typeof value === 'object'
    && value.type === type
    && value.protocol === protocol
    && typeof value.requestId === 'string'

  const sameOriginWindowClient = client => {
    try {
      return new URL(client.url).origin === scope.location.origin
    } catch {
      return false
    }
  }

  const stopped = (pending, signal) => !pending.active || signal.aborted

  // The wrapped operation may keep running in the browser after this promise is
  // fenced. Its late fulfillment/rejection is contained by `settled`, while
  // callers check the abort state before changing barrier state.
  function withinDeadline(operation, deadline, signal, timeoutMessage) {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        callback(value)
      }
      const onAbort = () => finish(reject, new Error('Wallet update barrier was cancelled.'))
      const timer = setTimeout(
        () => finish(reject, new Error(timeoutMessage)),
        Math.max(0, deadline - Date.now()),
      )

      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
      Promise.resolve()
        .then(() => {
          if (settled) return undefined
          return operation()
        })
        .then(
          value => finish(resolve, value),
          error => finish(reject, error instanceof Error ? error : new Error(String(error))),
        )
    })
  }

  function sleep(milliseconds, deadline, signal) {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        callback(value)
      }
      const onAbort = () => finish(reject, new Error('Wallet update barrier was cancelled.'))
      const timer = setTimeout(
        () => finish(resolve),
        Math.min(milliseconds, Math.max(0, deadline - Date.now())),
      )
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  // Navigation is deliberately detached from challenge rounds. A broken client
  // cannot serialize or prevent refresh attempts for every other client.
  function navigateClient(client, deadline, signal) {
    return withinDeadline(
      () => client.navigate(client.url),
      deadline,
      signal,
      'A wallet window navigation did not finish in time.',
    )
  }

  async function attestWindowClients(callerId, requestId, pending, deadline, signal) {
    const firstSeen = new Map()
    const navigated = new Set()
    let stableRounds = 0
    let unresolvedClients = 1

    while (!stopped(pending, signal) && Date.now() < deadline) {
      const observedAt = Date.now()
      const clients = (await withinDeadline(
        () => scope.clients.matchAll({ type: 'window', includeUncontrolled: true }),
        deadline,
        signal,
        'Wallet windows could not be listed before the verification deadline.',
      )).filter(sameOriginWindowClient)
      if (stopped(pending, signal)) throw new Error('Wallet update barrier was cancelled.')

      const clientIds = new Set()
      for (const client of clients) {
        clientIds.add(client.id)
        pending.observedClientIds.add(client.id)
        if (!firstSeen.has(client.id)) firstSeen.set(client.id, observedAt)
      }

      const callerPresent = clientIds.has(callerId)
      const unresolved = clients.filter(client => !pending.attestedClientIds.has(client.id))
      unresolvedClients = unresolved.length + (callerPresent ? 0 : 1)
      pending.unresolvedClients = unresolvedClients

      for (const client of unresolved) {
        if (stopped(pending, signal)) throw new Error('Wallet update barrier was cancelled.')
        try {
          client.postMessage({ type: challengeType, protocol, requestId, nonce: pending.nonce })
        } catch {
          // The client remains unresolved and the bounded protocol fails closed.
        }
      }

      if (stopped(pending, signal)) throw new Error('Wallet update barrier was cancelled.')
      if (callerPresent && unresolved.length === 0) {
        stableRounds += 1
        if (stableRounds >= 2) return { ok: true, unresolvedClients: 0 }
      } else {
        stableRounds = 0
        for (const client of unresolved) {
          const seenAt = firstSeen.get(client.id) ?? observedAt
          if (client.id === callerId || navigated.has(client.id) || observedAt - seenAt < clientEligibilityMs) continue
          // Record before invoking navigate, which can synchronously throw or
          // otherwise never settle. Each operation is independent and fenced.
          navigated.add(client.id)
          void navigateClient(client, deadline, signal).catch(() => undefined)
        }
      }

      if (Date.now() >= deadline) break
      await sleep(Math.min(challengeCadenceMs, deadline - Date.now()), deadline, signal)
    }

    return { ok: false, unresolvedClients }
  }

  function replyOnce(pending, reply, message) {
    if (pending.replySent || !pending.active) return
    pending.replySent = true
    try {
      reply.postMessage(message)
    } catch {
      // A disconnected requester must not make the barrier succeed elsewhere.
    }
  }

  scope.addEventListener('message', event => {
    const source = event.source
    if (isMessage(event.data, attestedType) && typeof event.data.nonce === 'string') {
      if (!source || typeof source.id !== 'string') return
      const pending = pendingBarriers.get(event.data.requestId)
      if (!pending
        || !pending.active
        || pending.controller.signal.aborted
        || pending.nonce !== event.data.nonce
        || !pending.observedClientIds.has(source.id)) return
      pending.attestedClientIds.add(source.id)
      return
    }

    if (!isMessage(event.data, prepareType) || !source || typeof source.id !== 'string') return
    const reply = event.ports[0]
    if (!reply) return
    const requestId = event.data.requestId
    if (pendingBarriers.has(requestId)) {
      try {
        reply.postMessage({ ok: false, protocol, reason: 'A duplicate wallet update request was rejected.' })
      } catch {
        // The duplicate port is still closed below.
      } finally {
        try {
          reply.close()
        } catch {
          // A duplicate reply port may already be disconnected.
        }
      }
      return
    }

    const controller = new AbortController()
    const pending = {
      nonce: scope.crypto.randomUUID(),
      callerId: source.id,
      attestedClientIds: new Set(),
      observedClientIds: new Set(),
      unresolvedClients: undefined,
      active: true,
      replySent: false,
      controller,
    }
    pendingBarriers.set(requestId, pending)
    const deadline = Date.now() + barrierTimeoutMs

    // This outer fence is independent of individual browser API fences: even a
    // never-settling matchAll/navigate cannot retain event.waitUntil forever.
    // Abort at the deadline before any late browser continuation can mutate the
    // pending object or emit another challenge.
    const outerFence = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()))
    const work = withinDeadline(
      () => attestWindowClients(source.id, requestId, pending, deadline, controller.signal),
      deadline,
      controller.signal,
      'Open wallet windows did not finish updating in time.',
    )
    event.waitUntil((async () => {
      try {
        const result = await work
        if (!pending.active) return
        replyOnce(pending, reply, result.ok
          ? { ok: true, protocol }
          : {
              ok: false,
              protocol,
              reason: 'Not every open wallet window is running the current reset-safe app.',
              unresolvedClients: result.unresolvedClients,
            })
      } catch {
        if (pending.active) {
          replyOnce(pending, reply, {
            ok: false,
            protocol,
            reason: 'Open wallet windows could not be verified safely. Close other wallet tabs and retry.',
            ...(typeof pending.unresolvedClients === 'number' ? { unresolvedClients: pending.unresolvedClients } : {}),
          })
        }
      } finally {
        clearTimeout(outerFence)
        pending.active = false
        controller.abort()
        if (pendingBarriers.get(requestId) === pending) pendingBarriers.delete(requestId)
        try {
          reply.close()
        } catch {
          // Closing an already-disconnected port is harmless.
        }
      }
    })())
  })
})()
