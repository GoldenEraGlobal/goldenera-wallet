export const bipTypeLabels: Record<string, string> = {
  AUTHORITY_ADD: 'Add authority',
  AUTHORITY_REMOVE: 'Remove authority',
  ADDRESS_ALIAS_ADD: 'Add address alias',
  ADDRESS_ALIAS_REMOVE: 'Remove address alias',
  TOKEN_CREATE: 'Create token',
  TOKEN_UPDATE: 'Update token',
  TOKEN_MINT: 'Mint tokens',
  TOKEN_BURN: 'Burn tokens',
  NETWORK_PARAMS_SET: 'Update network parameters',
  VALIDATOR_ADD: 'Add validator',
  VALIDATOR_REMOVE: 'Remove validator',
  VALIDATOR_MINING_POLICY_SET: 'Update validator mining policy',
}

export const bipStatusLabels: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DISAPPROVED: 'Disapproved',
  EXPIRED: 'Expired',
  INVALID: 'Invalid',
}

export function shortenHash(value?: string): string {
  if (!value) return 'Unavailable'
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function displayPayloadKey(value: string): string {
  return value
    .replace(/^payload/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, character => character.toUpperCase())
}

export function displayPayloadValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (key === 'maxMiningShareBps' && /^(0|[1-9][0-9]*)$/.test(String(value))) {
    return `${miningShareBpsToPercentage(String(value), true)} %`
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function miningSharePercentageToBps(percentage: string): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(percentage)) {
    throw new Error('Maximum mining share must use at most two decimal places.')
  }
  const [whole, fractional = ''] = percentage.split('.')
  const bps = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'))
  if (bps < 1n || bps > 4_000n) throw new Error('Maximum mining share must be between 0.01% and 40%.')
  return bps
}

export function miningShareBpsToPercentage(value: string, fixed = false): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return ''
  const bps = BigInt(value)
  const whole = bps / 100n
  const fraction = (bps % 100n).toString().padStart(2, '0')
  return fixed ? `${whole}.${fraction}` : fraction === '00' ? whole.toString() : `${whole}.${fraction.replace(/0+$/, '')}`
}

export function displayedAmountToBaseUnits(
  value: string,
  numberOfDecimals: number,
  label: string,
  allowZero = false,
): bigint {
  if (!Number.isInteger(numberOfDecimals) || numberOfDecimals < 0 || numberOfDecimals > 255) {
    throw new Error(`${label} decimal precision is unavailable.`)
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error(`${label} must be a valid decimal amount.`)
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > numberOfDecimals) throw new Error(`${label} supports at most ${numberOfDecimals} decimal places.`)
  const amount = BigInt(whole) * 10n ** BigInt(numberOfDecimals)
    + BigInt(fraction.padEnd(numberOfDecimals, '0') || '0')
  if (amount === 0n && !allowZero) throw new Error(`${label} must be greater than zero.`)
  return amount
}
