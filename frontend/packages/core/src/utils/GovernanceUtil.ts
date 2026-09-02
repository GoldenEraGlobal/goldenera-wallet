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

export function displayPayloadValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
