import {
  encodeTx,
  isAddress,
  Network,
  TxBuilder,
  TxType,
} from '@goldenera/cryptoj'
import type {
  Address,
  PrivateKey,
  SignedTx,
} from '@goldenera/cryptoj'
import z from 'zod/v4'

const MAX_UINT256 = (1n << 256n) - 1n
const MAX_SIGNED_SIZE = 1_048_576
const MAX_FEE_ITERATIONS = 32

const canonicalFeeSchema = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/)
const recommendationSchema = z.object({
  baseFee: canonicalFeeSchema,
  feePerByte: canonicalFeeSchema,
  minimumTotalFee: canonicalFeeSchema,
  miningFeePerByte: canonicalFeeSchema,
  totalForAverageTx: canonicalFeeSchema,
}).strict()

export interface TransferFeeRecommendation {
  baseFee: string
  feePerByte: string
  minimumTotalFee: string
  miningFeePerByte: string
  totalForAverageTx: string
}

export interface TransferFeeSolution {
  fee: bigint
  estimatedSignedSize: number
  iterations: number
}

export interface ExactFeeTransferInput {
  timestamp: bigint | number | Date
  sender: string
  recipient: string
  tokenAddress: string
  amount: bigint
  nonce: bigint
  recommendation: TransferFeeRecommendation
}

export interface SignedTransferResult {
  transaction: SignedTx
  encoded: Uint8Array
}

export interface ExactFeeTransfer {
  readonly timestamp: bigint
  readonly sender: Address
  readonly recipient: Address
  readonly tokenAddress: Address
  readonly amount: bigint
  readonly nonce: bigint
  readonly fee: bigint
  readonly estimatedSignedSize: number
  sign(privateKey: PrivateKey): SignedTransferResult
}

export class TransferFeeError extends Error {}

function parseUint256(value: string, field: string): bigint {
  const parsed = BigInt(canonicalFeeSchema.parse(value))
  if (parsed > MAX_UINT256) throw new TransferFeeError(`${field} exceeds the supported transaction range.`)
  return parsed
}

function checkedFee(value: bigint): bigint {
  if (value < 0n || value > MAX_UINT256) throw new TransferFeeError('The recommended transaction fee exceeds the supported range.')
  return value
}

function validateEstimatedSize(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SIGNED_SIZE) {
    throw new TransferFeeError('CryptoJ returned an invalid signed transaction size estimate.')
  }
  return value
}

/** Solves the encoded-size fee fixed point without adding a second signature allowance. */
export function solveTransferFee(
  recommendation: TransferFeeRecommendation,
  estimateSignedSize: (fee: bigint) => number,
): TransferFeeSolution {
  const parsed = recommendationSchema.parse(recommendation)
  const baseFee = parseUint256(parsed.baseFee, 'baseFee')
  const feePerByte = parseUint256(parsed.feePerByte, 'feePerByte')
  const minimumTotalFee = parseUint256(parsed.minimumTotalFee, 'minimumTotalFee')
  const miningFeePerByte = parseUint256(parsed.miningFeePerByte, 'miningFeePerByte')
  const averageTotal = parseUint256(parsed.totalForAverageTx, 'totalForAverageTx')
  let candidate = averageTotal
  const observed = new Set<bigint>()

  for (let iteration = 1; iteration <= MAX_FEE_ITERATIONS; iteration++) {
    if (observed.has(candidate)) throw new TransferFeeError('The transaction fee estimate oscillated and cannot be authorized safely.')
    observed.add(candidate)
    const estimatedSignedSize = validateEstimatedSize(estimateSignedSize(candidate))
    const sizeFee = checkedFee(baseFee + feePerByte * BigInt(estimatedSignedSize))
    const miningFee = checkedFee(miningFeePerByte * BigInt(estimatedSignedSize))
    const next = [minimumTotalFee, sizeFee, miningFee]
      .reduce((maximum, fee) => fee > maximum ? fee : maximum)
    if (next === candidate) return { fee: candidate, estimatedSignedSize, iterations: iteration }
    candidate = next
  }

  throw new TransferFeeError('The transaction fee estimate did not converge and cannot be authorized safely.')
}

function normalizeTimestamp(timestamp: bigint | number | Date): bigint {
  if (timestamp instanceof Date) {
    const milliseconds = timestamp.getTime()
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new TransferFeeError('Invalid transaction timestamp.')
    return BigInt(milliseconds)
  }
  if (typeof timestamp === 'number') {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TransferFeeError('Invalid transaction timestamp.')
    return BigInt(timestamp)
  }
  if (typeof timestamp !== 'bigint' || timestamp < 0n || timestamp > MAX_UINT256) {
    throw new TransferFeeError('Invalid transaction timestamp.')
  }
  return timestamp
}

function normalizeAddress(value: string, field: string): Address {
  if (!isAddress(value)) throw new TransferFeeError(`Invalid ${field} address.`)
  return value.toLowerCase() as Address
}

function validateTransferInteger(value: bigint, field: string, positive: boolean): bigint {
  if (typeof value !== 'bigint' || (positive ? value <= 0n : value < 0n) || value > MAX_UINT256) {
    throw new TransferFeeError(`Invalid transaction ${field}.`)
  }
  return value
}

/**
 * Creates one explicit-timestamp builder and retains it through fee iteration
 * and signing so the reviewed size, fee and final wire bytes cannot diverge.
 */
export function createExactFeeTransfer(input: ExactFeeTransferInput): ExactFeeTransfer {
  const timestamp = normalizeTimestamp(input.timestamp)
  const sender = normalizeAddress(input.sender, 'sender')
  const recipient = normalizeAddress(input.recipient, 'recipient')
  const tokenAddress = normalizeAddress(input.tokenAddress, 'token')
  const amount = validateTransferInteger(input.amount, 'amount', true)
  const nonce = validateTransferInteger(input.nonce, 'nonce', false)
  const builder = TxBuilder.create()
    .type(TxType.TRANSFER)
    .network(Network.MAINNET)
    .timestamp(timestamp)
    .recipient(recipient)
    .tokenAddress(tokenAddress)
    .amount(amount)
    .nonce(nonce)

  const solution = solveTransferFee(input.recommendation, fee => {
    builder.fee(fee)
    return builder.estimateSize()
  })
  builder.fee(solution.fee)
  if (validateEstimatedSize(builder.estimateSize()) !== solution.estimatedSignedSize) {
    throw new TransferFeeError('The transaction size estimate changed after fee convergence.')
  }

  return Object.freeze({
    timestamp,
    sender,
    recipient,
    tokenAddress,
    amount,
    nonce,
    fee: solution.fee,
    estimatedSignedSize: solution.estimatedSignedSize,
    sign(privateKey: PrivateKey): SignedTransferResult {
      if (privateKey.getAddress().toLowerCase() !== sender) {
        throw new TransferFeeError('The signing key no longer belongs to the reviewed sender.')
      }
      const transaction = builder.sign(privateKey)
      const encoded = encodeTx(transaction, true)
      if (
        transaction.sender !== sender ||
        transaction.timestamp !== timestamp ||
        transaction.network !== Network.MAINNET ||
        transaction.type !== TxType.TRANSFER ||
        transaction.nonce !== nonce ||
        transaction.recipient !== recipient ||
        transaction.tokenAddress !== tokenAddress ||
        transaction.amount !== amount ||
        transaction.fee !== solution.fee ||
        transaction.size !== solution.estimatedSignedSize ||
        encoded.length !== solution.estimatedSignedSize
      ) {
        throw new TransferFeeError('The signed transaction no longer matches the reviewed fee and transfer metadata.')
      }
      return { transaction, encoded }
    },
  })
}
