import { describe, expect, it } from 'vitest'
import { qrToString, stringToQrData } from '../../packages/core/src/utils/QrUtil'

const address = '0x2222222222222222222222222222222222222222'
const tokenAddress = '0x0000000000000000000000000000000000000000'

describe('wallet QR wire format', () => {
  it('round-trips recipient, token and a decimal amount without numeric coercion', () => {
    const data = { address, tokenAddress, amount: '0.000000001' }
    expect(stringToQrData(qrToString(data))).toEqual(data)
  })

  it('allows a receive request with no amount', () => {
    expect(stringToQrData(qrToString({ address, tokenAddress }))).toEqual({ address, tokenAddress, amount: undefined })
  })

  it.each(['https://example.invalid', '', `${tokenAddress}:invalid`, `invalid:${address}`, `${tokenAddress}:${address}:1:extra`])('rejects malformed or unrelated content: %s', input => {
    expect(() => stringToQrData(input)).toThrow()
  })
})
