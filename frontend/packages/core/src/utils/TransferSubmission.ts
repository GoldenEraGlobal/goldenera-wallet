import { Amounts, bytesToHex, encodeTx, Network, TxBuilder, TxType, ZERO_ADDRESS } from '@goldenera/cryptoj'
import type { Address, PrivateKey } from '@goldenera/cryptoj'
import { compareAddress, isNativeToken } from './WalletUtil'

export interface ReviewedTransfer {
  recipient: string
  tokenAddress: string
  amount: bigint
  fee: bigint
}
export interface TransferBalance {
  tokenAddress?: string
  /** Backend balance already excludes locked rewards and pending debits. */
  balance?: string
}
export interface TransferSubmissionDependencies {
  isSessionCurrent: () => boolean
  getPrivateKey: () => PrivateKey | null
  fetchNonce: (signal: AbortSignal) => Promise<string | number | bigint>
  fetchBalances: (signal: AbortSignal) => Promise<TransferBalance[]>
  send: (hexData: string, signal: AbortSignal) => Promise<{ status?: string | null; message?: string | null }>
}

export class SubmissionCancelledError extends Error {
  constructor() {
    super('Transaction review was cancelled or the wallet session changed')
    this.name = 'AbortError'
  }
}

export function assertTransferBalance(transfer: ReviewedTransfer, balances: TransferBalance[]) {
  const balance = (token: string) => BigInt(balances.find(item => compareAddress(item.tokenAddress, token))?.balance ?? '0')
  if (isNativeToken(transfer.tokenAddress)) {
    if (transfer.amount + transfer.fee > balance(ZERO_ADDRESS)) throw new Error('Insufficient balance for amount + fee')
  } else {
    if (transfer.amount > balance(transfer.tokenAddress)) throw new Error('Insufficient token balance')
    if (transfer.fee > balance(ZERO_ADDRESS)) throw new Error('Insufficient native token balance for fee')
  }
}

/**
 * @deprecated Production transfer flows must use the durable TransferCoordinator.
 * This legacy implementation is retained only for source compatibility and has no
 * production callers.
 */
export class TransferSubmission {
  private pending = false
  private sent = false
  private cancelled = false
  private readonly controller = new AbortController()
  private readonly transfer: Readonly<ReviewedTransfer>
  private readonly dependencies: TransferSubmissionDependencies

  constructor(transfer: ReviewedTransfer, dependencies: TransferSubmissionDependencies) {
    if (transfer.amount <= 0n || transfer.fee < 0n) throw new Error('Invalid transaction amounts')
    this.dependencies = dependencies
    this.transfer = Object.freeze({ ...transfer })
  }

  get hasSent() { return this.sent }
  get isPending() { return this.pending }

  cancel() {
    this.cancelled = true
    this.controller.abort()
  }

  private assertCurrent() {
    if (this.cancelled || !this.dependencies.isSessionCurrent()) throw new SubmissionCancelledError()
  }

  async submit(): Promise<string | null> {
    // Set synchronously, before the first await; React render timing is irrelevant.
    if (this.pending || this.sent) return null
    this.assertCurrent()
    this.pending = true
    try {
      const [nonce, balances] = await Promise.all([
        this.dependencies.fetchNonce(this.controller.signal),
        this.dependencies.fetchBalances(this.controller.signal),
      ])
      this.assertCurrent()
      if (typeof nonce === 'number' && !Number.isSafeInteger(nonce)) throw new Error('Invalid transaction nonce')
      assertTransferBalance(this.transfer, balances)
      const privateKey = this.dependencies.getPrivateKey()
      if (!privateKey) throw new SubmissionCancelledError()
      this.assertCurrent()
      const tx = TxBuilder.create()
        .type(TxType.TRANSFER)
        .network(Network.MAINNET)
        .recipient(this.transfer.recipient as Address)
        .tokenAddress(this.transfer.tokenAddress as Address)
        .amount(Amounts.wei(this.transfer.amount))
        .fee(Amounts.wei(this.transfer.fee))
        .nonce(BigInt(nonce))
        .sign(privateKey)
      const hexData = bytesToHex(encodeTx(tx, true))
      this.assertCurrent()
      // A network error cannot authorize another transaction under the same review.
      this.sent = true
      const result = await this.dependencies.send(hexData, this.controller.signal)
      if (result.status !== 'SUCCESS') throw new Error(result.message || 'Transaction rejected')
      return tx.hash
    } finally {
      this.pending = false
    }
  }
}
