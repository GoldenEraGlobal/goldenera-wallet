const CANONICAL_NON_NEGATIVE_DECIMAL = /^(0|[1-9][0-9]*)$/
const MAX_UINT256_DECIMAL_DIGITS = 78
const MAX_UINT256 = (1n << 256n) - 1n

/** Normalize blockchain-width API integers without accepting precision-lost numbers. */
export function normalizeApiInteger(value: unknown, field = 'API integer'): string {
  if (
    typeof value === 'string' &&
    value.length <= MAX_UINT256_DECIMAL_DIGITS &&
    CANONICAL_NON_NEGATIVE_DECIMAL.test(value) &&
    BigInt(value) <= MAX_UINT256
  ) return value
  if (typeof value === 'bigint' && value >= 0n && value <= MAX_UINT256) return value.toString()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value.toString()
  throw new TypeError(`${field} must be a canonical uint256 decimal string or safe integer`)
}

export function apiIntegerToBigInt(value: unknown, field?: string): bigint {
  return BigInt(normalizeApiInteger(value, field))
}
