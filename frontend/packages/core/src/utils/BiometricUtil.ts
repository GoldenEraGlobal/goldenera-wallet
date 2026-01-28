import { Capacitor } from '@capacitor/core'

export type BiometricType = 'face' | 'fingerprint' | 'iris' | 'none'

/**
 * Utility for biometric-related operations.
 * Handles platform-specific logic and WebAuthn checks.
 */
export const BiometricUtil = {
  /**
   * Returns current platform.
   */
  getPlatform(): 'ios' | 'android' | 'web' {
    if (Capacitor.isNativePlatform()) {
      return Capacitor.getPlatform() as 'ios' | 'android'
    }
    return 'web'
  },

  /**
   * Checks if WebAuthn is available and supported.
   */
  isWebAuthnAvailable(): boolean {
    if (typeof window === 'undefined') return false
    if (!window.PublicKeyCredential) return false
    if (!window.crypto?.subtle) {
      console.warn('BiometricUtil: crypto.subtle not available (requires HTTPS)')
      return false
    }
    return true
  }
}
