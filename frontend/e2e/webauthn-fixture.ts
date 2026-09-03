import type { BrowserContext } from '@playwright/test'

/** Browser API/PRF semantics fixture, not a physical or hardware authenticator. */
export async function installPrfAuthenticator(context: BrowserContext, supported = true) {
  await context.addInitScript(({ supported }) => {
    const id = new Uint8Array(32).fill(7)
    const encoder = new TextEncoder()
    let userHandle: ArrayBuffer | null = null
    Object.defineProperty(PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', { configurable: true, value: async () => true })
    const makeCredential = async (options: CredentialCreationOptions | CredentialRequestOptions, creation: boolean) => {
      const pk = options.publicKey!
      const challenge = new Uint8Array(pk.challenge as ArrayBuffer)
      const extension = pk.extensions as { prf?: { eval?: { first?: ArrayBuffer } } } | undefined
      const authData = new Uint8Array(37)
      authData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(location.hostname))))
      authData[32] = 5
      let output: ArrayBuffer | undefined
      if (supported && extension?.prf?.eval?.first) {
        const fixtureSecret = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(93), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        output = await crypto.subtle.sign('HMAC', fixtureSecret, extension.prf.eval.first)
      }
      if (creation) {
        const user = (pk as PublicKeyCredentialCreationOptions).user
        userHandle = new Uint8Array(user.id as ArrayBuffer).slice().buffer
        sessionStorage.setItem('public-webauthn-user-name', user.name)
        sessionStorage.setItem('public-webauthn-user-display-name', user.displayName)
      }
      return {
        id: btoa(String.fromCharCode(...id)), type: 'public-key', rawId: id.slice().buffer,
        response: {
          clientDataJSON: encoder.encode(JSON.stringify({ type: creation ? 'webauthn.create' : 'webauthn.get', origin: location.origin, challenge: btoa(String.fromCharCode(...challenge)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') })).buffer,
          authenticatorData: authData.buffer,
          userHandle: creation ? null : userHandle,
        },
        getClientExtensionResults: () => ({ prf: { ...(creation ? { enabled: supported } : {}), ...(output ? { results: { first: output } } : {}) } }),
      }
    }
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      create: (options: CredentialCreationOptions) => makeCredential(options, true),
      get: (options: CredentialRequestOptions) => makeCredential(options, false),
    } })
  }, { supported })
}
