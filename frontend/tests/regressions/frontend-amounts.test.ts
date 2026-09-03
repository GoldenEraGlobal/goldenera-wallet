import { describe, expect, it } from 'vitest'
import { parseTokenAmount } from '../../packages/core/src/utils/TokenAmount'
import { formatWei } from '../../packages/core/src/utils/WalletUtil'
import { stringToQrData } from '../../packages/core/src/utils/QrUtil'

const token = '0x0000000000000000000000000000000000000000'
const recipient = '0x2222222222222222222222222222222222222222'

describe('F6/F7 exact token precision', () => {
  it.each([
    ['100', 0, 100n, '100'],
    ['1.00000001', 8, 100000001n, '1.00000001'],
    ['0.000000001', 18, 1000000000n, '0.000000001000000000'],
    ['0.000000000000000001', 18, 1n, '0.000000000000000001'],
  ] as const)('uses the same units for %s at %d decimals', (value, decimals, raw, displayed) => {
    expect(parseTokenAmount(value, decimals)).toBe(raw)
    expect(formatWei(raw.toString(), decimals)).toBe(displayed)
  })
  it.each(['0', '-1', '1e3', 'Infinity', 'NaN', '1,000', ' 1', '1.', '.1'])('rejects malformed/nonpositive input %s', value => {
    expect(() => parseTokenAmount(value, 18)).toThrow()
  })
  it('never silently rounds fractional precision or accepts missing metadata', () => {
    expect(() => parseTokenAmount('1.1', 0)).toThrow('at most 0')
    expect(() => parseTokenAmount('0.000000001', 8)).toThrow('at most 8')
    expect(() => parseTokenAmount('1', undefined)).toThrow('precision is unavailable')
  })
  it('formats large raw values with exact integer powers and zero-decimal negatives', () => {
    const raw = 10n ** 28n + 1n
    expect(formatWei(raw.toString(), 28)).toBe(`1.${'0'.repeat(27)}1`)
    expect(formatWei('-100', 0)).toBe('-100')
    expect(formatWei('-1', 8)).toBe('-0.00000001')
  })
})

describe('F5 QR data validation', () => {
  it('rejects an ordinary URL, then independently accepts a wallet QR', () => {
    expect(() => stringToQrData('https://example.invalid')).toThrow()
    expect(stringToQrData(`${token}:${recipient}:0.000000001`)).toEqual({ tokenAddress: token, address: recipient, amount: '0.000000001' })
  })
  it.each(['NaN', '-1', '0', '1e3', '1:2'])('rejects invalid QR amount %s', amount => {
    expect(() => stringToQrData(`${token}:${recipient}:${amount}`)).toThrow()
  })
})
