# WebAuthn credential labels

The PWA no longer places the internal wallet vault ID in the user-facing
WebAuthn `name`. New PRF credentials use `GoldenEra Wallet` for both `name` and
`displayName`. The WebAuthn `user.id` is a stable 32-byte opaque user handle,
derived with domain-separated SHA-256 from the internal vault identity. It is
not the vault ID itself and is not derived from the recovery phrase, address,
or credential ID. Repeated enrollment for the same wallet therefore uses the
same account handle without placing that handle in a user-facing label.

The PRF envelope now records that opaque handle in base64url form as optional
`userId` metadata. It is deliberately excluded from AES-GCM additional
authenticated data: the existing AAD field order and every cryptographic input
remain unchanged, and envelopes created by an earlier release remain valid.

WebAuthn Level 3 defines
[`PublicKeyCredential.signalCurrentUserDetails()`](https://www.w3.org/TR/webauthn-3/#sctn-signalCurrentUserDetails),
which can opportunistically update `name` and `displayName` without creating a
new credential. The signal requires the exact original user handle. Earlier
wallet releases generated that handle randomly but did not persist it, so the
PWA cannot reliably identify an already-enrolled credential by user handle.
There is no WebAuthn API to recover that missing handle from a credential ID.
An authenticator may return the handle in a successful assertion even when an
`allowCredentials` list is used; when it does, the PWA can safely send the label
signal. Authenticators are also allowed to return `null` in this flow. Existing
credentials in that common case keep their old label until the user disables
and re-enables biometrics.

For credentials enrolled after this change, the PWA sends the Level 3 signal
after a successful authentication when the browser supports it. This is a
best-effort metadata update: unsupported APIs, unavailable authenticators, and
signal failures do not block wallet authentication. A resolved signal only
confirms that the request was accepted; the specification permits an
authenticator to ignore it.

## Enrollment and upgrade postconditions

Create/import previously opened the wallet before starting WebAuthn enrollment.
The route change could unmount the form, and both a `false` PRF result and an
exception were converted into a store message that the dashboard did not show.
The overall operation still resolved. A second split outcome was possible when
the PRF envelope committed but cleanup of older metadata failed: runtime state
said disabled until the next reload even though the credential was usable.

Requested enrollment now finishes before the wallet route opens and the store
requires a structured `verified` result produced only after a real decrypt
readback. `isEnabled()` remains a structural discovery check and cannot promote
an arbitrary post-write exception to success. A structurally valid envelope
that fails decrypt verification is rolled back to the previous record. A
committed and cryptographically verified PRF envelope remains authoritative if
only later legacy cleanup fails; that cleanup is retried under the wallet
mutation lock. If the final postcondition is not a verified PRF envelope with
retired legacy metadata, the wallet remains
saved and password-accessible but locked, and the UI shows a specific error and
retry path. It never reports biometrics as enabled merely because `enable()`
returned.

Failure-state writes are also guarded by the session revision and exact storage
token captured before enrollment. If another tab invalidates the operation
during the authenticator prompt, the stale completion cannot replace the newer
wallet state.

The older recovery flow previously disabled biometrics unconditionally after
changing the wallet password, and ordinary password unlock deleted old
biometric metadata without replacing it. Both flows now attempt PRF enrollment
after password verification. Recovery releases the existing wallet Web Lock
before enrollment acquires its own lock, avoiding a nested exclusive-lock
deadlock. If reenrollment fails after the new password commits, stale legacy
access is retired, the wallet remains locked and recoverable with the new
password, and a visible message directs the user to retry from Settings. The
expired recovery ticket and both password fields are removed, so the committed
migration cannot be submitted a second time with an obsolete revision.

During an ordinary password unlock, a cancelled or unsupported PRF prompt no
longer forces the user to enter the already-verified password again. Once the
older wrapper has been successfully retired, password unlock continues and the
dashboard shows a dismissible warning that biometrics remain disabled. Unlock
is blocked only if removal of the older wrapper itself cannot be verified.
