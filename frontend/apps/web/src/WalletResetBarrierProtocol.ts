export const WALLET_RESET_BARRIER_PROTOCOL = 'goldenera-wallet-reset-barrier-v1'
export const WALLET_RESET_PREPARE = 'GE_WALLET_RESET_PREPARE'
export const WALLET_RESET_CHALLENGE = 'GE_WALLET_RESET_CHALLENGE'
export const WALLET_RESET_ATTESTED = 'GE_WALLET_RESET_ATTESTED'

export interface WalletResetPrepareMessage {
  type: typeof WALLET_RESET_PREPARE
  protocol: typeof WALLET_RESET_BARRIER_PROTOCOL
  requestId: string
}

export interface WalletResetChallengeMessage {
  type: typeof WALLET_RESET_CHALLENGE
  protocol: typeof WALLET_RESET_BARRIER_PROTOCOL
  requestId: string
  nonce: string
}

export interface WalletResetAttestedMessage {
  type: typeof WALLET_RESET_ATTESTED
  protocol: typeof WALLET_RESET_BARRIER_PROTOCOL
  requestId: string
  nonce: string
}

export type WalletResetBarrierResponse =
  | { ok: true; protocol: typeof WALLET_RESET_BARRIER_PROTOCOL }
  | { ok: false; protocol: typeof WALLET_RESET_BARRIER_PROTOCOL; reason: string; unresolvedClients?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isWalletResetChallenge(value: unknown): value is WalletResetChallengeMessage {
  if (!isRecord(value)) return false
  return value.type === WALLET_RESET_CHALLENGE
    && value.protocol === WALLET_RESET_BARRIER_PROTOCOL
    && typeof value.requestId === 'string'
    && typeof value.nonce === 'string'
}

export function isWalletResetAttestation(value: unknown): value is WalletResetAttestedMessage {
  if (!isRecord(value)) return false
  return value.type === WALLET_RESET_ATTESTED
    && value.protocol === WALLET_RESET_BARRIER_PROTOCOL
    && typeof value.requestId === 'string'
    && typeof value.nonce === 'string'
}

export function isWalletResetPrepare(value: unknown): value is WalletResetPrepareMessage {
  if (!isRecord(value)) return false
  return value.type === WALLET_RESET_PREPARE
    && value.protocol === WALLET_RESET_BARRIER_PROTOCOL
    && typeof value.requestId === 'string'
}

export function isWalletResetBarrierResponse(value: unknown): value is WalletResetBarrierResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || value.protocol !== WALLET_RESET_BARRIER_PROTOCOL) return false
  return value.ok || typeof value.reason === 'string'
}
