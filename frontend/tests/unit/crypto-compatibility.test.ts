import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PrivateKey, TxBuilder, TxType, Network, encodeTx, decodeTx, bytesToHex } from '@goldenera/cryptoj'
import { CryptoUtil, EncryptedPayloadCorruptionError } from '../../packages/core/src/utils/CryptoUtil'
import { WalletUtil } from '../../packages/core/src/utils/WalletUtil'
import golden from '../fixtures/crypto-v0.2.0.json'

const javaContract = JSON.parse(readFileSync(new URL('../../../src/test/resources/contracts/signed-transfers.json', import.meta.url), 'utf8')) as {
  addresses: string[]
  transfers: Array<Record<string, string | number>>
}

describe('public golden vectors from cryptoj 0.2.0', () => {
  it('keeps the Java 0.0.5 decoder contract synchronized with the immutable JS baseline', () => {
    expect(javaContract.addresses).toEqual(golden.seeds.map(vector => vector.address))
    expect(javaContract.transfers).toEqual(golden.transfers.map(({ name, seed, recipient, tokenAddress, amount, fee, nonce, hash, hex }) => ({
      name, seed, recipient, tokenAddress, amount, fee, nonce, hash, hex,
    })))
  })

  it.each(golden.seeds)('preserves mnemonic derivation: $name', (vector) => {
    expect(PrivateKey.fromMnemonic(vector.mnemonic, vector.passphrase, vector.index).getAddress()).toBe(vector.address)
    if (!vector.passphrase && vector.index === 0) {
      expect(WalletUtil.restoreFromMnemonic(vector.mnemonic).address).toBe(vector.address)
    }
  })

  it.each(golden.transfers)('preserves signed wire bytes and hash: $name', (vector) => {
    const seed = golden.seeds[vector.seed]
    const key = PrivateKey.fromMnemonic(seed.mnemonic, seed.passphrase, seed.index)
    const builder = TxBuilder.create()
      .type(TxType.TRANSFER)
      .network(Network.MAINNET)
      .timestamp(1700000000000)
      .recipient(vector.recipient as `0x${string}`)
      .amount(BigInt(vector.amount))
      .fee(BigInt(vector.fee))
      .nonce(BigInt(vector.nonce))
      .tokenAddress(vector.tokenAddress as `0x${string}`)
    const estimatedSignedSize = builder.estimateSize()
    const tx = builder.sign(key)
    const encoded = encodeTx(tx, true)

    expect(estimatedSignedSize).toBe(tx.size)
    expect(tx.size).toBe(encoded.length)
    expect(bytesToHex(encoded)).toBe(vector.hex)
    expect(tx.hash).toBe(vector.hash)
    const decoded = decodeTx(vector.hex as `0x${string}`)
    expect(decoded.amount).toBe(BigInt(vector.amount))
    expect(decoded.nonce).toBe(BigInt(vector.nonce))
    expect(decoded.hash).toBe(vector.hash)
  })

  it('keeps BIP-39 validation separate from the Java-compatible derivation path', () => {
    const valid12 = golden.seeds[0].mnemonic
    const valid24 = golden.seeds[1].mnemonic
    const invalidChecksum = valid12.split(' ').fill('abandon').join(' ')
    const invalidWord = valid12.replace(/about$/, 'notaword')
    const wrongLength = valid12.split(' ').slice(0, 11).join(' ')

    expect(WalletUtil.isValidMnemonic(valid12)).toBe(true)
    expect(WalletUtil.isValidMnemonic(valid24)).toBe(true)
    expect(WalletUtil.restoreFromMnemonic(valid12).address).toBe(golden.seeds[0].address)
    expect(WalletUtil.restoreFromMnemonic(valid24).address).toBe(golden.seeds[1].address)
    for (const invalid of [invalidChecksum, invalidWord, wrongLength]) {
      expect(PrivateKey.isValidMnemonic(invalid)).toBe(false)
      expect(WalletUtil.isValidMnemonic(invalid)).toBe(false)
      expect(() => PrivateKey.fromMnemonicLegacyJs(invalid, undefined, 0)).toThrow('Invalid mnemonic')
      expect(() => WalletUtil.restoreFromMnemonic(invalid)).toThrow('Invalid mnemonic')
    }
  })

  it('distinguishes the new Java raw-UTF8 Unicode passphrase from legacy JS recovery', () => {
    const mnemonic = golden.seeds[0].mnemonic
    const javaCompatible = PrivateKey.fromMnemonic(mnemonic, 'é', 0)
    const legacyJs = PrivateKey.fromMnemonicLegacyJs(mnemonic, 'é', 0)
    expect(javaCompatible.toHex()).toBe('0xdff4f0dc7ed990b6f0fa0ec17f44bc448f4f3a9809e7cb6dc426768da56c2090')
    expect(legacyJs.toHex()).toBe('0x608d0ab7caa808f5424c94c8c974e71fd31d6ff7c09692feb5208ed7362dc312')
    expect(javaCompatible.toHex()).not.toBe(legacyJs.toHex())
  })

  it('round-trips an unsafe-number timestamp as bigint in a signed transaction', () => {
    const vector = golden.transfers[0]
    const key = PrivateKey.fromMnemonic(golden.seeds[0].mnemonic, '', 0)
    const tx = TxBuilder.create()
      .type(TxType.TRANSFER)
      .network(Network.MAINNET)
      .timestamp(9_007_199_254_740_993n)
      .recipient(vector.recipient as `0x${string}`)
      .amount(BigInt(vector.amount))
      .fee(BigInt(vector.fee))
      .nonce(BigInt(vector.nonce))
      .tokenAddress(vector.tokenAddress as `0x${string}`)
      .sign(key)
    const encoded = bytesToHex(encodeTx(tx, true))
    const decoded = decodeTx(encoded)
    expect(decoded.timestamp).toBe(9_007_199_254_740_993n)
    expect(decoded.signature).not.toBeNull()
    expect(decoded.sender).toBe(golden.seeds[0].address)
    expect(bytesToHex(encodeTx(decoded, true))).toBe(encoded)
    expect(decoded.hash).toBe(tx.hash)
  })
})

describe('encrypted mnemonic compatibility', () => {
  it.each(golden.vaults)('can still decrypt the pre-upgrade vault: $name', async (vector) => {
    expect(await CryptoUtil.decrypt(vector.encrypted, vector.password)).toBe(vector.mnemonic)
  })

  it('uses independent salt and IV for successive saves', async () => {
    const vector = golden.vaults[0]
    const first = await CryptoUtil.encrypt(vector.mnemonic, vector.password)
    const second = await CryptoUtil.encrypt(vector.mnemonic, vector.password)
    expect(first).not.toBe(second)
    expect(JSON.parse(first).salt).not.toBe(JSON.parse(second).salt)
    expect(JSON.parse(first).iv).not.toBe(JSON.parse(second).iv)
    expect(await CryptoUtil.decrypt(second, vector.password)).toBe(vector.mnemonic)
  })

  it('rejects an incorrect password and modified ciphertext', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const vector = golden.vaults[0]
    expect(await CryptoUtil.decrypt(vector.encrypted, `${vector.password}-wrong`)).toBeNull()
    const corrupted = JSON.parse(vector.encrypted)
    corrupted.data = (corrupted.data.startsWith('00') ? '01' : '00') + corrupted.data.slice(2)
    expect(await CryptoUtil.decrypt(JSON.stringify(corrupted), vector.password)).toBeNull()
  })

  it.each([
    ['non-hexadecimal field', (payload: Record<string, string>) => { payload.iv = 'gg'.repeat(CryptoUtil.IV_LENGTH_BYTES) }],
    ['odd-length field', (payload: Record<string, string>) => { payload.data = '0'.repeat(CryptoUtil.AES_GCM_TAG_LENGTH_BYTES * 2 - 1) }],
    ['empty ciphertext', (payload: Record<string, string>) => { payload.data = '' }],
    ['wrong IV length', (payload: Record<string, string>) => { payload.iv = '00'.repeat(CryptoUtil.IV_LENGTH_BYTES - 1) }],
    ['wrong salt length', (payload: Record<string, string>) => { payload.salt = '00'.repeat(CryptoUtil.SALT_LENGTH_BYTES - 1) }],
    ['ciphertext shorter than the GCM tag', (payload: Record<string, string>) => { payload.data = '00'.repeat(CryptoUtil.AES_GCM_TAG_LENGTH_BYTES - 1) }],
  ])('classifies a %s envelope as storage corruption before decryption', async (_name, mutate) => {
    const payload = JSON.parse(golden.vaults[0].encrypted) as Record<string, string>
    mutate(payload)

    await expect(CryptoUtil.decrypt(JSON.stringify(payload), golden.vaults[0].password))
      .rejects.toBeInstanceOf(EncryptedPayloadCorruptionError)
  })

  it('continues accepting historic uppercase hexadecimal envelopes', async () => {
    const payload = JSON.parse(golden.vaults[0].encrypted) as Record<string, string>
    payload.iv = payload.iv.toUpperCase()
    payload.salt = payload.salt.toUpperCase()
    payload.data = payload.data.toUpperCase()

    expect(await CryptoUtil.decrypt(JSON.stringify(payload), golden.vaults[0].password)).toBe(golden.vaults[0].mnemonic)
  })
})
