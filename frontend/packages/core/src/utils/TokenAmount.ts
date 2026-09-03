/** Parse displayed token units without rounding or floating point arithmetic. */
export function parseTokenAmount(value: string, decimals: number | undefined): bigint {
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Token decimal precision is unavailable')
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error('Enter a valid decimal amount')
  }
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`)
  }
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (amount <= 0n) throw new Error('Amount must be greater than 0')
  return amount
}
