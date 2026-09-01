import { describe, expect, it, vi } from 'vitest'
import { decodeTx, PrivateKey } from '@goldenera/cryptoj'
import { TransferSubmission, assertTransferBalance } from '../../packages/core/src/utils/TransferSubmission'
import type { TransferSubmissionDependencies } from '../../packages/core/src/utils/TransferSubmission'
import golden from '../fixtures/crypto-v0.2.0.json'

const native = '0x0000000000000000000000000000000000000000'
const recipient = '0x2222222222222222222222222222222222222222'
const key = PrivateKey.fromMnemonic(golden.seeds[0].mnemonic, undefined, 0)
const review = { recipient, tokenAddress: native, amount: 100000000n, fee: 2500n }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function setup(overrides: Partial<TransferSubmissionDependencies> = {}) {
  const dependencies = {
    isSessionCurrent: vi.fn(() => true),
    getPrivateKey: vi.fn(() => key),
    fetchNonce: vi.fn(async () => 7),
    fetchBalances: vi.fn(async () => [{ tokenAddress: native, balance: '100000000000' }]),
    send: vi.fn(async (_hex: string, _signal: AbortSignal) => ({ status: 'SUCCESS' })),
    ...overrides,
  }
  return { operation: new TransferSubmission(review, dependencies), dependencies }
}

describe('F1 one review / one submission across async preflight', () => {
  it('ignores concurrent confirmation before nonce arrives and never resubmits a consumed review', async () => {
    const nonce = deferred<number>()
    const { operation, dependencies } = setup({ fetchNonce: vi.fn(() => nonce.promise) })
    const first = operation.submit()
    expect(await operation.submit()).toBeNull()
    expect(dependencies.getPrivateKey).not.toHaveBeenCalled()
    nonce.resolve(7)
    expect(await first).toMatch(/^0x/)
    expect(await operation.submit()).toBeNull()
    expect(dependencies.fetchNonce).toHaveBeenCalledTimes(1)
    expect(dependencies.send).toHaveBeenCalledTimes(1)
    const tx = decodeTx(vi.mocked(dependencies.send).mock.calls[0][0] as `0x${string}`)
    expect(tx.nonce).toBe(7n)
    expect(tx.amount).toBe(review.amount)
    expect(tx.recipient.toLowerCase()).toBe(recipient)
  })
  it.each(['cancel', 'lock', 'replace-vault'])('never reads a key or sends after %s during preflight', async action => {
    const nonce = deferred<number>()
    let current = true
    const { operation, dependencies } = setup({ fetchNonce: () => nonce.promise, isSessionCurrent: () => current })
    const result = operation.submit()
    if (action === 'cancel') operation.cancel()
    else current = false
    nonce.resolve(8)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(dependencies.getPrivateKey).not.toHaveBeenCalled()
    expect(dependencies.send).not.toHaveBeenCalled()
  })
  it('checks session validity again immediately before signing', async () => {
    let current = true
    const send = vi.fn(async () => ({ status: 'SUCCESS' }))
    const { operation } = setup({ isSessionCurrent: () => current, getPrivateKey: () => { current = false; return key }, send })
    await expect(operation.submit()).rejects.toMatchObject({ name: 'AbortError' })
    expect(send).not.toHaveBeenCalled()
  })
  it('does not issue a new nonce or payment when a POST outcome is unknown', async () => {
    const send = vi.fn(async () => { throw new Error('Connection lost') })
    const { operation, dependencies } = setup({ send })
    await expect(operation.submit()).rejects.toThrow('Connection lost')
    expect(operation.hasSent).toBe(true)
    expect(await operation.submit()).toBeNull()
    expect(dependencies.fetchNonce).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('validates spendable-after-pending balance, not total locked-inclusive balance', () => {
    const balances = [{ tokenAddress: native, balance: '100', totalBalance: '1000000000000', lockedMiningReward: '999999999900' }]
    expect(() => assertTransferBalance(review, balances)).toThrow('Insufficient balance')
  })
})
