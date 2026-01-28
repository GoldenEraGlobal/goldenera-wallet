import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { BiometricUtil, type BiometricType } from '../utils/BiometricUtil'
import { bufferToHex, hexToBuffer } from '../utils/CryptoUtil'
import { StorageService } from './StorageService'

const KEYS = {
  ENABLED: 'biometric_enabled',
  CREDENTIAL_ID: 'biometric_credential_id',
  ENCRYPTED_PASSWORD: 'biometric_encrypted_password',
}

const SERVER_ID = 'wallet.goldenera.global'

/**
 * BiometricService - Unified biometric authentication service.
 * Handles Native (Android/iOS) and Web (WebAuthn) platforms.
 */
export const BiometricService = {
  /**
   * Checks if biometric authentication is available.
   */
  async isAvailable(): Promise<boolean> {
    const platform = BiometricUtil.getPlatform()

    if (platform !== 'web') {
      try {
        const result = await NativeBiometric.isAvailable()
        return result.isAvailable
      } catch {
        return false
      }
    }

    if (!BiometricUtil.isWebAuthnAvailable()) return false

    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    } catch {
      return false
    }
  },

  /**
   * Gets the specific type of biometry supported by the device.
   */
  async getType(): Promise<BiometricType> {
    const platform = BiometricUtil.getPlatform()

    if (platform !== 'web') {
      try {
        const result = await NativeBiometric.isAvailable()
        if (!result.isAvailable || !result.biometryType) return 'none'

        switch (result.biometryType) {
          case 1: // TOUCH_ID
          case 3: // FINGERPRINT
            return 'fingerprint'
          case 2: // FACE_ID
          case 4: // FACE_AUTHENTICATION
            return 'face'
          case 5: // IRIS_AUTHENTICATION
            return 'iris'
          default:
            return 'fingerprint'
        }
      } catch {
        return 'none'
      }
    }

    const available = await this.isAvailable()
    return available ? 'fingerprint' : 'none'
  },

  /**
   * Authenticates user and retrieves stored password.
   */
  async authenticate(): Promise<{ success: boolean; password?: string }> {
    const platform = BiometricUtil.getPlatform()
    const basicStorage = StorageService.basic

    if (platform !== 'web') {
      try {
        console.log('[BiometricService] verifyIdentity starting')
        await NativeBiometric.verifyIdentity({
          reason: 'Authenticate to unlock your wallet',
          title: 'GoldenEra Wallet',
          subtitle: 'Use biometrics to unlock',
          description: 'Place your finger on the sensor or look at the camera',
        })
        console.log('[BiometricService] verifyIdentity success')

        const credentials = await NativeBiometric.getCredentials({
          server: SERVER_ID,
        })
        console.log('[BiometricService] getCredentials success', { hasPassword: !!credentials.password })

        return { success: true, password: credentials.password }
      } catch (error) {
        console.error('[BiometricService] Native biometric auth failed:', error)
        return { success: false }
      }
    }

    if (!BiometricUtil.isWebAuthnAvailable()) return { success: false }

    try {
      const storedCredentialId = await basicStorage.getItem<string>(KEYS.CREDENTIAL_ID)
      const encryptedPasswordData = await basicStorage.getItem<any>(KEYS.ENCRYPTED_PASSWORD)

      if (!storedCredentialId || !encryptedPasswordData) return { success: false }

      const challenge = window.crypto.getRandomValues(new Uint8Array(32))
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'required',
          rpId: window.location.hostname,
          allowCredentials: [{
            id: hexToBuffer(storedCredentialId) as any,
            type: 'public-key',
          }],
        }
      }) as PublicKeyCredential | null

      if (!credential) return { success: false }

      const key = await this.deriveKeyFromCredential(credential.rawId)

      const iv = hexToBuffer(encryptedPasswordData.iv)
      const data = hexToBuffer(encryptedPasswordData.data)

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as any },
        key,
        data as any
      )

      return { success: true, password: new TextDecoder().decode(decrypted) }
    } catch (error) {
      console.error('Web biometric auth failed:', error)
      return { success: false }
    }
  },

  /**
   * Enables biometrics by creating a credential and storing redacted password.
   */
  async enable(password: string): Promise<boolean> {
    const platform = BiometricUtil.getPlatform()
    const basicStorage = StorageService.basic

    if (platform !== 'web') {
      try {
        const randomId = bufferToHex(window.crypto.getRandomValues(new Uint8Array(4)))
        await NativeBiometric.setCredentials({
          username: `ge_wallet_user_${randomId}`,
          password: password,
          server: SERVER_ID,
        })

        await basicStorage.setItem(KEYS.ENABLED, true)
        return true
      } catch (error) {
        console.error('Failed to set native credentials:', error)
        return false
      }
    }

    if (!BiometricUtil.isWebAuthnAvailable()) return false

    try {
      const challenge = window.crypto.getRandomValues(new Uint8Array(32))
      const userId = window.crypto.getRandomValues(new Uint8Array(16))

      const randomId = bufferToHex(window.crypto.getRandomValues(new Uint8Array(4)))
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'GoldenEra Wallet', id: window.location.hostname },
          user: { id: userId, name: `ge_wallet_user_${randomId}`, displayName: `GoldenEra Wallet User (${randomId})` },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },  // ES256
            { alg: -257, type: 'public-key' }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 60000,
        }
      }) as PublicKeyCredential | null

      if (!credential) return false

      const key = await this.deriveKeyFromCredential(credential.rawId)

      const iv = window.crypto.getRandomValues(new Uint8Array(12))
      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as any },
        key,
        new TextEncoder().encode(password)
      )

      const encryptedPasswordData = {
        iv: bufferToHex(iv),
        data: bufferToHex(encrypted),
      }

      await basicStorage.setItem(KEYS.CREDENTIAL_ID, bufferToHex(credential.rawId))
      await basicStorage.setItem(KEYS.ENCRYPTED_PASSWORD, encryptedPasswordData)
      await basicStorage.setItem(KEYS.ENABLED, true)

      return true
    } catch (error) {
      console.error('Failed to enable web biometrics:', error)
      return false
    }
  },

  /**
   * Disables biometrics and wipes stored data.
   */
  async disable(): Promise<void> {
    const platform = BiometricUtil.getPlatform()
    const basicStorage = StorageService.basic

    if (platform !== 'web') {
      try {
        await NativeBiometric.deleteCredentials({ server: SERVER_ID })
      } catch { }
    }

    await basicStorage.removeItem(KEYS.ENABLED)
    await basicStorage.removeItem(KEYS.CREDENTIAL_ID)
    await basicStorage.removeItem(KEYS.ENCRYPTED_PASSWORD)
  },

  /**
   * Checks if biometric is currently active for this wallet.
   */
  async isEnabled(): Promise<boolean> {
    const basicStorage = StorageService.basic
    const enabled = await basicStorage.getItem<boolean>(KEYS.ENABLED)

    if (BiometricUtil.getPlatform() === 'web') {
      const credentialId = await basicStorage.getItem<string>(KEYS.CREDENTIAL_ID)
      return enabled === true && !!credentialId
    }

    return enabled === true
  },

  /**
   * Internal helper to derive key from credential ID with 600,000 PBKDF2 iterations.
   */
  async deriveKeyFromCredential(credentialId: ArrayBuffer): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      credentialId,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    )

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(credentialId.slice(0, 16)) as any,
        iterations: 600000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }
}
