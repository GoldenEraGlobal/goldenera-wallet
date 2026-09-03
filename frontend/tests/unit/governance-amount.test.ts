import { describe, expect, it } from 'vitest'
import { displayedAmountToBaseUnits } from '../../packages/core/src/utils/GovernanceUtil'

describe('governance displayed token amounts', () => {
  it('converts mint and burn amounts using the selected token precision', () => {
    expect(displayedAmountToBaseUnits('12.34567890', 8, 'Amount')).toBe(1_234_567_890n)
    expect(displayedAmountToBaseUnits('0.000000001', 18, 'Amount')).toBe(1_000_000_000n)
  })

  it('converts token maximum supply using the newly declared decimals', () => {
    expect(displayedAmountToBaseUnits('1000000.25', 2, 'Maximum supply')).toBe(100_000_025n)
  })

  it('allows explicit zero network monetary parameters but rejects excess precision', () => {
    expect(displayedAmountToBaseUnits('0', 8, 'Minimum transaction base fee', true)).toBe(0n)
    expect(() => displayedAmountToBaseUnits('0.000000001', 8, 'Block reward')).toThrow(/at most 8 decimal places/)
    expect(() => displayedAmountToBaseUnits('0', 8, 'Amount')).toThrow(/greater than zero/)
  })
})
