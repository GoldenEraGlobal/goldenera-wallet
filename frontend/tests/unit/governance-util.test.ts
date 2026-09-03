import { describe, expect, it } from 'vitest'
import {
  displayPayloadValue,
  miningShareBpsToPercentage,
  miningSharePercentageToBps,
} from '../../packages/core/src/utils/GovernanceUtil'

describe('governance mining share formatting', () => {
  it('converts percentages to exact basis points without floating-point rounding', () => {
    expect(miningSharePercentageToBps('0.01')).toBe(1n)
    expect(miningSharePercentageToBps('25.5')).toBe(2550n)
    expect(miningSharePercentageToBps('40')).toBe(4000n)
  })

  it('rejects unsupported precision and shares outside the consensus range', () => {
    expect(() => miningSharePercentageToBps('0')).toThrow(/between 0.01% and 40%/)
    expect(() => miningSharePercentageToBps('40.01')).toThrow(/between 0.01% and 40%/)
    expect(() => miningSharePercentageToBps('1.001')).toThrow(/two decimal places/)
  })

  it('formats stored basis points as percentages for forms and BIP detail', () => {
    expect(miningShareBpsToPercentage('2500')).toBe('25')
    expect(miningShareBpsToPercentage('2550')).toBe('25.5')
    expect(displayPayloadValue('2550', 'maxMiningShareBps')).toBe('25.50 %')
  })
})
