import type { Address} from '@goldenera/cryptoj'
import { NATIVE_TOKEN, PrivateKey, ZERO_ADDRESS } from '@goldenera/cryptoj'

export interface WalletData {
  mnemonic: string
  address: string
  privateKey: PrivateKey
}

function assertValidMnemonic(mnemonic: string): void {
  // CryptoJ 0.5 aligns fromMnemonic with Java's raw UTF-8 seed derivation
  // and therefore no longer performs BIP-39 checksum validation itself.
  if (!PrivateKey.isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase')
  }
}

/**
 * Pure utility functions for wallet cryptographic operations.
 * These are stateless and can be used anywhere.
 */
export const WalletUtil = {
  /**
   * Generates a new wallet with mnemonic, address, and private key.
   */
  generateWallet(): WalletData {
    const mnemonic = PrivateKey.generateMnemonic()
    const privateKey = PrivateKey.fromMnemonic(mnemonic, undefined, 0)
    return {
      mnemonic,
      address: privateKey.getAddress() as string,
      privateKey,
    }
  },

  /**
   * Restores a wallet from an existing mnemonic.
   */
  restoreFromMnemonic(mnemonic: string): WalletData {
    assertValidMnemonic(mnemonic)
    const privateKey = PrivateKey.fromMnemonic(mnemonic, undefined, 0)
    return {
      mnemonic,
      address: privateKey.getAddress() as string,
      privateKey,
    }
  },

  /**
   * Validates if a mnemonic is valid.
   */
  isValidMnemonic(mnemonic: string): boolean {
    try {
      assertValidMnemonic(mnemonic)
      return true
    } catch {
      return false
    }
  }
}


export const shortenAddress = (address: string): string => {
  return address.slice(0, 8) + '...' + address.slice(-4)
}

export const formatWei = (weiStr: string | undefined, decimals: number = 8): string => {
  if (!weiStr) return '0'
  try {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return '0'
    const value = BigInt(weiStr)
    const negative = value < 0n
    const wei = negative ? -value : value
    const divisor = 10n ** BigInt(decimals)
    const whole = wei / divisor
    const prefix = negative ? '-' : ''
    if (decimals === 0) return `${prefix}${whole.toLocaleString()}`
    const fractionStr = (wei % divisor).toString().padStart(decimals, '0')
    return `${prefix}${whole.toLocaleString()}.${fractionStr}`
  } catch {
    return '0'
  }
}

// Format transfer type for display
export const formatTransferType = (type: string | undefined): string => {
  if (!type) return 'Transfer'
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export const isNativeToken = (address?: string | null | Address): boolean => {
  return compareAddress(address, NATIVE_TOKEN)
}

export const isZeroAddress = (address?: string | null | Address): boolean => {
  return compareAddress(address, ZERO_ADDRESS)
}

export const compareAddress = (address?: string | null | Address, otherAddress?: string | null | Address): boolean => {
  if (typeof address !== 'string' || typeof otherAddress !== 'string') {
    return false
  }
  return address.toLowerCase().trim() === otherAddress.toLowerCase().trim()
}


// Format timestamp to readable date
export const formatFullTimestamp = (timestamp: string | undefined): string => {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
