export type WalletResetBarrier = () => Promise<void>

export class WalletResetBarrierError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WalletResetBarrierError'
  }
}

let walletResetBarrier: WalletResetBarrier | null = null

/** Installed by the production web entry point before the wallet store starts. */
export function configureWalletResetBarrier(barrier: WalletResetBarrier): void {
  walletResetBarrier = barrier
}

/**
 * Fail closed in a browser when the PWA entry point did not install its
 * service-worker gate. Non-browser test/native adapters have no PWA clients.
 */
export async function prepareWalletResetBarrier(): Promise<void> {
  if (walletResetBarrier) {
    try {
      await walletResetBarrier()
      return
    } catch (error) {
      throw new WalletResetBarrierError(
        error instanceof Error ? error.message : 'Open wallet windows could not be updated safely. Close them and retry.',
        { cause: error },
      )
    }
  }
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    throw new WalletResetBarrierError('Wallet deletion cannot verify that every open app window is current. Reload the wallet and retry.')
  }
}
