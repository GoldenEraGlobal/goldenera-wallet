import {
  bytesToHex,
  encodeTx,
  isHash,
  Network,
  TxBuilder,
  TxPayloadType,
  TxType,
  ZERO_ADDRESS,
} from '@goldenera/cryptoj'
import type { Hash, TxPayload } from '@goldenera/cryptoj'
import {
  getAuthorityStatus,
  getBalances,
  getMempoolRecommendedFees,
  getNextNonce,
  normalizeApiInteger,
  submitTransaction,
  type MempoolRecommendedFeesLevelDtoV1,
} from '@project/api'
import { useWalletStore, type WalletSessionSnapshot } from '../store/WalletStore'
import { compareAddress } from '../utils/WalletUtil'
import { solveTransferFee } from './TransferFee'
import { withWalletAuthorizationBarrier } from './WalletSessionService'

export interface GovernanceReview {
  readonly sender: string
  readonly timestamp: bigint
  readonly nonce: bigint
  readonly fee: bigint
  readonly estimatedSignedSize: number
  readonly transactionType: TxType.BIP_CREATE | TxType.BIP_VOTE
  readonly payload: TxPayload
  readonly referenceHash: Hash | null
  readonly snapshot: WalletSessionSnapshot
}

export interface GovernanceSubmissionResult {
  hash: string
  status: 'SUCCESS' | 'QUEUED'
}

function assertCurrent(snapshot: WalletSessionSnapshot): void {
  if (!useWalletStore.getState().isSessionCurrent(snapshot)) {
    throw new Error('The wallet session changed. Unlock the wallet and review the transaction again.')
  }
}

async function readPreflight(snapshot: WalletSessionSnapshot) {
  assertCurrent(snapshot)
  const [{ data: authority }, { data: nonce }, { data: balances }, { data: fees }] = await Promise.all([
    getAuthorityStatus({ query: { address: snapshot.address } }),
    getNextNonce({ query: { address: snapshot.address } }),
    getBalances({ query: { addresses: [snapshot.address], tokenAddresses: [ZERO_ADDRESS] } }),
    getMempoolRecommendedFees(),
  ])
  assertCurrent(snapshot)
  if (!authority.authority) throw new Error('This wallet address is no longer a network authority.')
  const normalizedNonce = normalizeApiInteger(nonce, 'next nonce')
  const nativeBalance = balances.find(item => compareAddress(item.tokenAddress, ZERO_ADDRESS))?.balance
  if (typeof nativeBalance !== 'string' || !/^(0|[1-9][0-9]*)$/.test(nativeBalance)) {
    throw new Error('The available native-token balance is unavailable.')
  }
  return { nonce: BigInt(normalizedNonce), nativeBalance: BigInt(nativeBalance), recommendation: fees.standard }
}

function exactTransaction(input: {
  timestamp: bigint
  nonce: bigint
  payload: TxPayload
  referenceHash: Hash | null
  recommendation: MempoolRecommendedFeesLevelDtoV1
}) {
  const transactionType: TxType.BIP_CREATE | TxType.BIP_VOTE = input.referenceHash === null
    ? TxType.BIP_CREATE
    : TxType.BIP_VOTE
  const builder = TxBuilder.create()
    .type(transactionType)
    .network(Network.MAINNET)
    .timestamp(input.timestamp)
    .nonce(input.nonce)
    .payload(input.payload)
  if (input.referenceHash !== null) builder.referenceHash(input.referenceHash)
  const solution = solveTransferFee(input.recommendation, fee => {
    builder.fee(fee)
    return builder.estimateSize()
  })
  builder.fee(solution.fee)
  return { builder, transactionType, ...solution }
}

export async function prepareGovernanceTransaction(
  payload: TxPayload,
  referenceHash?: string,
): Promise<GovernanceReview> {
  const snapshot = useWalletStore.getState().getSessionSnapshot()
  if (!snapshot) throw new Error('Unlock the wallet before preparing a governance transaction.')
  const normalizedReference = referenceHash === undefined ? null : referenceHash.toLowerCase()
  if (normalizedReference !== null && !isHash(normalizedReference)) throw new Error('Invalid BIP hash.')
  const votePayload = payload.payloadType === TxPayloadType.BIP_VOTE
  if ((normalizedReference === null) === votePayload) {
    throw new Error(votePayload ? 'A vote requires a BIP reference hash.' : 'Only vote payloads may reference a BIP.')
  }
  const immutablePayload = Object.freeze({ ...payload }) as TxPayload
  const preflight = await readPreflight(snapshot)
  const timestamp = BigInt(Date.now())
  const exact = exactTransaction({
    timestamp,
    nonce: preflight.nonce,
    payload: immutablePayload,
    referenceHash: normalizedReference as Hash | null,
    recommendation: preflight.recommendation,
  })
  if (preflight.nativeBalance < exact.fee) throw new Error('Insufficient native-token balance for the transaction fee.')
  return Object.freeze({
    sender: snapshot.address,
    timestamp,
    nonce: preflight.nonce,
    fee: exact.fee,
    estimatedSignedSize: exact.estimatedSignedSize,
    transactionType: exact.transactionType,
    payload: immutablePayload,
    referenceHash: normalizedReference as Hash | null,
    snapshot,
  })
}

export async function confirmGovernanceTransaction(review: GovernanceReview): Promise<GovernanceSubmissionResult> {
  return withWalletAuthorizationBarrier(async () => {
    assertCurrent(review.snapshot)
    const preflight = await readPreflight(review.snapshot)
    const exact = exactTransaction({
      timestamp: review.timestamp,
      nonce: preflight.nonce,
      payload: review.payload,
      referenceHash: review.referenceHash,
      recommendation: preflight.recommendation,
    })
    if (preflight.nonce !== review.nonce || exact.fee !== review.fee || exact.estimatedSignedSize !== review.estimatedSignedSize) {
      throw new Error('The nonce or recommended fee changed. Review the governance transaction again.')
    }
    if (preflight.nativeBalance < exact.fee) throw new Error('Insufficient native-token balance for the transaction fee.')
    const privateKey = useWalletStore.getState().getPrivateKeyForSnapshot(review.snapshot)
    if (!privateKey || privateKey.getAddress().toLowerCase() !== review.sender.toLowerCase()) {
      throw new Error('The wallet signing session is no longer available.')
    }
    const transaction = exact.builder.sign(privateKey)
    const encoded = encodeTx(transaction, true)
    if (transaction.sender.toLowerCase() !== review.sender.toLowerCase()
      || transaction.nonce !== review.nonce
      || transaction.fee !== review.fee
      || transaction.type !== review.transactionType
      || encoded.length !== review.estimatedSignedSize) {
      throw new Error('The signed transaction does not match the reviewed governance transaction.')
    }
    assertCurrent(review.snapshot)
    let result
    try {
      const response = await submitTransaction({ body: { hexData: bytesToHex(encoded) } })
      result = response.data
    } catch (error) {
      throw new Error('The submission outcome is unknown. Check the BIP overview before retrying.', { cause: error })
    }
    if (result.status !== 'SUCCESS' && result.status !== 'QUEUED') {
      throw new Error(result.message || 'The node rejected the governance transaction.')
    }
    return { hash: transaction.hash, status: result.status }
  })
}
