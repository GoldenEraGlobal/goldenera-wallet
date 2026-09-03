import { createAuthorityAddPayload, createApprovalVote, decodeTx, hexToBytes, PrivateKey, TxType, ZERO_ADDRESS } from '@goldenera/cryptoj'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import golden from '../fixtures/crypto-v0.2.0.json'

const harness = vi.hoisted(() => ({
  authority: vi.fn(),
  balances: vi.fn(),
  fees: vi.fn(),
  nonce: vi.fn(),
  submit: vi.fn(),
  walletState: {} as Record<string, unknown>,
}))

vi.mock('@project/api', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAuthorityStatus: harness.authority,
  getBalances: harness.balances,
  getMempoolRecommendedFees: harness.fees,
  getNextNonce: harness.nonce,
  submitTransaction: harness.submit,
}))
vi.mock('../../packages/core/src/store/WalletStore', () => ({
  useWalletStore: { getState: () => harness.walletState },
}))
vi.mock('../../packages/core/src/services/WalletSessionService', () => ({
  withWalletAuthorizationBarrier: (operation: () => unknown) => operation(),
}))

import {
  confirmGovernanceTransaction,
  prepareGovernanceTransaction,
} from '../../packages/core/src/services/GovernanceSubmission'

const key = PrivateKey.fromMnemonic(golden.seeds[0].mnemonic, golden.seeds[0].passphrase, golden.seeds[0].index)
const snapshot = {
  revision: 1,
  vaultId: 'vault',
  vaultRevision: 1,
  address: key.getAddress(),
  storageToken: 'token',
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.walletState = {
    getSessionSnapshot: () => snapshot,
    isSessionCurrent: () => true,
    getPrivateKeyForSnapshot: () => key,
  }
  harness.authority.mockResolvedValue({ data: { address: snapshot.address, authority: true } })
  harness.nonce.mockResolvedValue({ data: '7' })
  harness.balances.mockResolvedValue({ data: [{ tokenAddress: ZERO_ADDRESS, balance: '1000000000' }] })
  harness.fees.mockResolvedValue({
    data: {
      standard: {
        baseFee: '10', feePerByte: '1', minimumTotalFee: '100', miningFeePerByte: '0', totalForAverageTx: '100',
      },
    },
  })
  harness.submit.mockResolvedValue({ data: { status: 'SUCCESS', message: null } })
})

describe('governance transaction submission', () => {
  it('builds, reviews, signs and submits a BIP_CREATE transaction', async () => {
    const target = '0x2222222222222222222222222222222222222222'
    const review = await prepareGovernanceTransaction(createAuthorityAddPayload(target))
    const result = await confirmGovernanceTransaction(review)

    expect(review.transactionType).toBe(TxType.BIP_CREATE)
    expect(result.status).toBe('SUCCESS')
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(harness.authority).toHaveBeenCalledTimes(2)
    expect(harness.submit).toHaveBeenCalledTimes(1)
    const hexData = harness.submit.mock.calls[0]?.[0]?.body?.hexData
    const transaction = decodeTx(hexToBytes(hexData))
    expect(transaction.type).toBe(TxType.BIP_CREATE)
    expect(transaction.nonce).toBe(7n)
    expect(transaction.sender).toBe(snapshot.address)
  })

  it('builds a BIP_VOTE transaction with the proposal reference hash', async () => {
    const referenceHash = `0x${'a'.repeat(64)}`
    const review = await prepareGovernanceTransaction(createApprovalVote(), referenceHash)

    expect(review.transactionType).toBe(TxType.BIP_VOTE)
    expect(review.referenceHash).toBe(referenceHash)
  })

  it('fails closed when current authority membership is not confirmed', async () => {
    harness.authority.mockResolvedValue({ data: { address: snapshot.address, authority: false } })

    await expect(prepareGovernanceTransaction(createApprovalVote(), `0x${'b'.repeat(64)}`))
      .rejects.toThrow('no longer a network authority')
    expect(harness.submit).not.toHaveBeenCalled()
  })
})
