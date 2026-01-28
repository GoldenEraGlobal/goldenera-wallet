import type { PrivateKey } from '@goldenera/cryptoj'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { BiometricService } from '../services/BiometricService'
import { DeviceService } from '../services/DeviceService'
import { getBasicStorage, getStorage, STORAGE_MNEMONIC_KEY, STORAGE_PHRASE_BACKEDUP_KEY } from '../services/StorageService'
import { BiometricType } from '../utils/BiometricUtil'
import { WalletUtil } from '../utils/WalletUtil'

export type WalletStatus = 'loading' | 'no_wallet' | 'locked' | 'unlocked' | 'backup'

export interface WalletState {
  status: WalletStatus

  // Wallet data (only available when unlocked)
  address: string | null

  // Error handling
  error: string | null

  // Internal - not exposed to components
  _privateKey: PrivateKey | null

  biometric: {
    type: BiometricType
    enabled: boolean
    available: boolean
  }

  backupPhrase: string | null
}

export interface WalletActions {
  initialize: () => Promise<void>
  createWallet: (password: string, biometric: boolean) => Promise<{ mnemonic: string; address: string }>
  importWallet: (mnemonic: string, password: string, biometric: boolean) => Promise<{ address: string }>
  unlockWallet: (mnemonic: string) => Promise<boolean>
  resolvePasswordWithBiometric: () => Promise<string>
  unlockWithBiometric: () => Promise<void>
  lockWallet: () => void
  checkPassword: (password: string) => Promise<string | false>
  resetWallet: () => Promise<void>
  getPrivateKey: () => PrivateKey | null
  clearError: () => void
  toggleBiometric: (value: boolean, password: string) => Promise<void>
  backupWallet: () => Promise<void>
}

export type WalletStore = WalletState & WalletActions

export const useWalletStore = create<WalletStore>()(
  subscribeWithSelector((set, get) => ({
    status: 'loading',
    address: null,
    error: null,
    _privateKey: null,
    backupPhrase: null,
    biometric: {
      type: 'none',
      enabled: false,
      available: false
    },

    // Initialization
    initialize: async () => {
      try {
        const currentStatus = get().status

        // Don't reinitialize if already unlocked (wallet was just created/imported)
        if (currentStatus === 'unlocked') {
          return
        }

        const storage = getStorage()
        const hasWallet = await storage.exists(STORAGE_MNEMONIC_KEY)
        const available = await BiometricService.isAvailable()
        const type = await BiometricService.getType()
        const enabled = available ? await BiometricService.isEnabled() : false

        set({
          status: hasWallet ? 'locked' : 'no_wallet',
          error: null,
          biometric: { type, available, enabled }
        })
      } catch (error) {
        console.error('Failed to initialize wallet store:', error)
        set({
          status: 'no_wallet',
          error: 'Failed to initialize storage',
          biometric: { type: 'none', available: false, enabled: false },
        })
      }
    },

    // Wallet creation & import
    createWallet: async (password: string, biometric: boolean) => {
      try {
        set({ error: null })

        const wallet = WalletUtil.generateWallet()
        const storage = getStorage()
        const basicStorage = getBasicStorage()

        // Save encrypted mnemonic
        await storage.save(STORAGE_MNEMONIC_KEY, wallet.mnemonic, { password })
        await basicStorage.setItem(STORAGE_PHRASE_BACKEDUP_KEY, false)

        let biometricEnabled = false
        if (biometric) {
          biometricEnabled = await BiometricService.enable(password)
        }

        // Register device
        await DeviceService.getInstance().register()

        set(prev => ({
          ...prev,
          status: 'backup',
          address: wallet.address,
          _privateKey: wallet.privateKey,
          backupPhrase: wallet.mnemonic,
          biometric: {
            ...prev.biometric,
            enabled: biometricEnabled
          }
        }))

        return {
          mnemonic: wallet.mnemonic,
          address: wallet.address,
        }
      } catch (error: any) {
        const message = error?.message || 'Failed to create wallet'
        set({ error: message })
        throw new Error(message)
      }
    },

    importWallet: async (mnemonic: string, password: string, biometric: boolean) => {
      try {
        set({ error: null })

        // Validate mnemonic
        if (!WalletUtil.isValidMnemonic(mnemonic)) {
          throw new Error('Invalid recovery phrase')
        }

        const storage = getStorage()
        const basicStorage = getBasicStorage()
        const wallet = WalletUtil.restoreFromMnemonic(mnemonic)

        // Save encrypted mnemonic
        await storage.save(STORAGE_MNEMONIC_KEY, mnemonic, { password })
        await basicStorage.setItem(STORAGE_PHRASE_BACKEDUP_KEY, true)

        let biometricEnabled = false
        if (biometric) {
          biometricEnabled = await BiometricService.enable(password)
        }

        // Register device
        await DeviceService.getInstance().register()

        set(prev => ({
          ...prev,
          status: 'unlocked',
          address: wallet.address,
          _privateKey: wallet.privateKey,
          biometric: {
            ...prev.biometric,
            enabled: biometricEnabled
          }
        }))

        return {
          address: wallet.address,
        }
      } catch (error: any) {
        const message = error?.message || 'Failed to import wallet'
        set({ error: message })
        throw new Error(message)
      }
    },

    // Authentication
    checkPassword: async (password: string) => {
      try {
        const storage = getStorage()
        const mnemonic = await storage.get(STORAGE_MNEMONIC_KEY, { password })
        if (!mnemonic) {
          return false
        }
        return mnemonic
      } catch (error: any) {
        return false
      }
    },

    unlockWallet: async (mnemonic: string) => {
      try {
        set({ error: null })

        if (!mnemonic) {
          set({ error: 'No wallet found' })
          return false
        }

        const wallet = WalletUtil.restoreFromMnemonic(mnemonic)
        await DeviceService.getInstance().register()
        const basicStorage = getBasicStorage()
        const backedup = await basicStorage.getItem<boolean>(STORAGE_PHRASE_BACKEDUP_KEY) || false

        set((prev) => ({
          ...prev,
          status: backedup ? 'unlocked' : 'backup',
          address: wallet.address,
          _privateKey: wallet.privateKey,
          backupPhrase: backedup ? null : mnemonic
        }))

        return true
      } catch (error: any) {
        console.error('Failed to unlock wallet:', error)
        set({ error: 'Invalid password or corrupted data' })
        return false
      }
    },

    unlockWithBiometric: async () => {
      try {
        set({ status: 'loading', error: null })
        const password = await get().resolvePasswordWithBiometric()
        await get().unlockWallet(password)
      } catch (error) {
        set({ error: (error as Error).message, status: 'locked' })
        throw error
      }
    },

    // Lock & Reset
    lockWallet: () => {
      set({
        status: 'locked',
        address: null,
        _privateKey: null,
        error: null,
        backupPhrase: null
      })
    },

    resetWallet: async () => {
      try {
        const storage = getStorage()
        await storage.clear()
        const basicStorage = getBasicStorage()
        await basicStorage.clear()
        await BiometricService.disable()

        set(prev => ({
          ...prev,
          status: 'no_wallet',
          address: null,
          _privateKey: null,
          error: null,
          backupPhrase: null,
          biometric: {
            ...prev.biometric,
            enabled: false
          }
        }))
      } catch (error: any) {
        console.error('Failed to reset wallet:', error)
        set({ error: 'Failed to reset wallet' })
      }
    },

    // Utility functions
    getPrivateKey: () => get()._privateKey,

    backupWallet: async () => {
      const basicStorage = getBasicStorage()
      await basicStorage.setItem(STORAGE_PHRASE_BACKEDUP_KEY, true)
      set((prev) => ({
        ...prev,
        status: 'unlocked',
        backupPhrase: null
      }))
    },

    clearError: () => set({ error: null }),

    // Biometric management
    toggleBiometric: async (value: boolean, password: string) => {
      const biometric = get().biometric
      if (biometric.enabled === value || !biometric.available) {
        return
      }
      const checkPassword = await get().checkPassword(password)
      if (!checkPassword) {
        throw new Error("Invalid password")
      }
      try {
        if (!value) {
          await BiometricService.disable()
        } else {
          const result = await BiometricService.enable(password)
          if (!result) {
            throw new Error("Biometric activation failed")
          }
        }
        set((prev) => ({
          ...prev,
          biometric: {
            ...prev.biometric,
            enabled: value
          }
        }))
      } catch (error) {
        console.error('Failed to toggle biometric:', error)
        throw error
      }
    },

    resolvePasswordWithBiometric: async () => {
      try {
        const { success, password } = await BiometricService.authenticate()
        if (success && password) {
          return password
        } else {
          throw new Error('Biometric authentication failed')
        }
      } catch (error) {
        set(prev => ({
          ...prev,
          biometric: {
            ...prev.biometric,
            loading: false
          }
        }))
        throw error
      }
    },
  }))
)