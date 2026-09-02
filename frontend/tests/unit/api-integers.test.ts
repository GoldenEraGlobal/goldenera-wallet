import { describe, expect, it } from 'vitest'
import { apiIntegerToBigInt, normalizeApiInteger } from '../../packages/api/src/integers'

describe('precision-safe API integers', () => {
  const maximumUint256 = (1n << 256n) - 1n

  it('keeps canonical decimal strings above JavaScript safe integer range exact', () => {
    const value = '90071992547409931234567890'
    expect(normalizeApiInteger(value)).toBe(value)
    expect(apiIntegerToBigInt(value)).toBe(90071992547409931234567890n)
  })

  it('accepts only safe transitional numeric values', () => {
    expect(normalizeApiInteger(42)).toBe('42')
    expect(normalizeApiInteger(42n)).toBe('42')
    expect(() => normalizeApiInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/)
  })

  it('enforces the uint256 width for decimal strings and bigints', () => {
    expect(normalizeApiInteger(maximumUint256.toString())).toBe(maximumUint256.toString())
    expect(normalizeApiInteger(maximumUint256)).toBe(maximumUint256.toString())
    expect(() => normalizeApiInteger((maximumUint256 + 1n).toString())).toThrow(TypeError)
    expect(() => normalizeApiInteger(maximumUint256 + 1n)).toThrow(TypeError)
    expect(() => normalizeApiInteger('1'.repeat(79))).toThrow(TypeError)
  })

  it.each(['01', '-1', '+1', '1.0', '', ' 1', Number.NaN, Number.POSITIVE_INFINITY, {}, null])(
    'rejects non-canonical input %p',
    value => expect(() => normalizeApiInteger(value)).toThrow(TypeError),
  )
})
