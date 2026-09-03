import { describe, expect, it, vi } from 'vitest'
import { bytesToHex, PrivateKey } from '@goldenera/cryptoj'
import {
  createExactFeeTransfer,
  solveTransferFee,
  TransferFeeError,
} from '../../packages/core/src/services/TransferFee'
import golden from '../fixtures/crypto-v0.2.0.json'

const recommendation = {
  baseFee: '1000',
  feePerByte: '10',
  minimumTotalFee: '0',
  miningFeePerByte: '0',
  totalForAverageTx: '2500',
}

describe('exact transfer fee calculation', () => {
  it('uses the complete CryptoJ signed-size estimate without adding 65 bytes', () => {
    const estimate = vi.fn(() => 137)

    expect(solveTransferFee(recommendation, estimate)).toEqual({
      fee: 2370n,
      estimatedSignedSize: 137,
      iterations: 2,
    })
    expect(estimate.mock.calls.map(([fee]) => fee)).toEqual([2500n, 2370n])
  })

  it('iterates until fee-dependent RLP width reaches an exact fixed point', () => {
    const estimate = vi.fn((fee: bigint) => fee < 1300n ? 130 : 131)

    expect(solveTransferFee({
      baseFee: '0',
      feePerByte: '10',
      minimumTotalFee: '0',
      miningFeePerByte: '0',
      totalForAverageTx: '1',
    }, estimate)).toEqual({
      fee: 1310n,
      estimatedSignedSize: 131,
      iterations: 3,
    })
    expect(estimate.mock.calls.map(([fee]) => fee)).toEqual([1n, 1300n, 1310n])
  })

  it('uses the maximum of the node floor, network fee and miner density for the signed size', () => {
    const estimate = vi.fn(() => 1000)

    expect(solveTransferFee({
      baseFee: '200',
      feePerByte: '5',
      minimumTotalFee: '10000',
      miningFeePerByte: '14',
      totalForAverageTx: '2100',
    }, estimate)).toEqual({
      fee: 14000n,
      estimatedSignedSize: 1000,
      iterations: 2,
    })
    expect(estimate.mock.calls.map(([fee]) => fee)).toEqual([2100n, 14000n])
  })

  it('fails closed on invalid recommendations, overflow, oscillation and non-convergence', () => {
    expect(() => solveTransferFee({ ...recommendation, baseFee: '01' }, () => 137)).toThrow()
    expect(() => solveTransferFee({ ...recommendation, feePerByte: '-1' }, () => 137)).toThrow()
    expect(() => solveTransferFee({
      baseFee: '0',
      feePerByte: '0',
      minimumTotalFee: '0',
      miningFeePerByte: `${1n << 256n}`,
      totalForAverageTx: '0',
    }, () => 137)).toThrow(TransferFeeError)
    expect(() => solveTransferFee({
      baseFee: `${1n << 256n}`,
      feePerByte: '0',
      minimumTotalFee: '0',
      miningFeePerByte: '0',
      totalForAverageTx: '0',
    }, () => 137)).toThrow(TransferFeeError)
    expect(() => solveTransferFee({
      baseFee: '0',
      feePerByte: '1',
      minimumTotalFee: '0',
      miningFeePerByte: '0',
      totalForAverageTx: '1',
    }, fee => fee === 1n ? 2 : 1)).toThrow(/oscillated/)

    let size = 1
    expect(() => solveTransferFee({
      baseFee: '0',
      feePerByte: '1',
      minimumTotalFee: '0',
      miningFeePerByte: '0',
      totalForAverageTx: '1',
    }, () => ++size)).toThrow(/did not converge/)
  })

  it('reuses one explicit-timestamp builder through sizing and golden signing', () => {
    const vector = golden.transfers[0]
    const seed = golden.seeds[vector.seed]
    const privateKey = PrivateKey.fromMnemonic(seed.mnemonic, seed.passphrase, seed.index)
    const prepared = createExactFeeTransfer({
      timestamp: 1_700_000_000_000n,
      sender: seed.address,
      recipient: vector.recipient,
      tokenAddress: vector.tokenAddress,
      amount: BigInt(vector.amount),
      nonce: BigInt(vector.nonce),
      recommendation: {
        baseFee: '0',
        feePerByte: '0',
        minimumTotalFee: vector.fee,
        miningFeePerByte: '0',
        totalForAverageTx: vector.fee,
      },
    })
    const wrongSeed = golden.seeds[1]
    const wrongKey = PrivateKey.fromMnemonic(wrongSeed.mnemonic, wrongSeed.passphrase, wrongSeed.index)
    expect(() => prepared.sign(wrongKey)).toThrow(/signing key/)
    const { transaction, encoded } = prepared.sign(privateKey)

    expect(prepared.fee).toBe(BigInt(vector.fee))
    expect(prepared.estimatedSignedSize).toBe(transaction.size)
    expect(encoded.length).toBe(transaction.size)
    expect(bytesToHex(encoded)).toBe(vector.hex)
    expect(transaction.hash).toBe(vector.hash)
  })

  it('rejects implicit, unsafe or semantically invalid transfer inputs', () => {
    const vector = golden.transfers[0]
    const valid = {
      timestamp: 1_700_000_000_000n,
      sender: golden.seeds[vector.seed].address,
      recipient: vector.recipient,
      tokenAddress: vector.tokenAddress,
      amount: BigInt(vector.amount),
      nonce: BigInt(vector.nonce),
      recommendation,
    }

    expect(() => createExactFeeTransfer({ ...valid, timestamp: Number.MAX_SAFE_INTEGER + 1 })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, timestamp: '1700000000000' as unknown as bigint })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, amount: 0n })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, amount: '100' as unknown as bigint })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, amount: 1n << 256n })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, nonce: -1n })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, nonce: '100' as unknown as bigint })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, nonce: 1n << 256n })).toThrow(TransferFeeError)
    expect(() => createExactFeeTransfer({ ...valid, recipient: '0x1234' })).toThrow(TransferFeeError)
  })
})
