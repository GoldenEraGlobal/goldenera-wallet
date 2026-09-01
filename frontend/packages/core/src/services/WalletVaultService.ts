import { CryptoUtil, bufferToHex } from '../utils/CryptoUtil'
import { getBasicStorage, getStorage, STORAGE_MNEMONIC_KEY, STORAGE_PHRASE_BACKEDUP_KEY } from './StorageService'

export interface WalletVault {
  version: 2
  id: string
  revision: number
  address: string | null
  encryptedMnemonic: string
  backedUp: boolean
}

let mutationQueue: Promise<unknown> = Promise.resolve()

/** Serializes the read/check/write across tabs; never use a localStorage lease. */
export function withWalletMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('goldenera-wallet-vault-mutation', operation)
  }
  // Modern PWA browsers support Web Locks. Without it, reading/unlocking is
  // still safe, but silently permitting competing browser writes is not.
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    return Promise.reject(new Error('This browser cannot safely update a wallet across tabs. Update your browser and retry.'))
  }
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.catch(() => undefined)
  return result
}

export const WalletVaultService = {
  async read(): Promise<WalletVault | null> {
    const storage = getStorage()
    if (!await storage.exists(STORAGE_MNEMONIC_KEY)) return null
    const raw = await storage.get(STORAGE_MNEMONIC_KEY)
    if (!raw) throw new Error('The stored wallet is unreadable. Retry without creating another wallet.')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid wallet data')
    const value = parsed as Record<string, unknown>
    if (value.version === 2) {
      if (typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
        typeof value.encryptedMnemonic !== 'string' || typeof value.backedUp !== 'boolean' ||
        (value.address !== null && (typeof value.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value.address)))) {
        throw new Error('Invalid wallet metadata')
      }
      return value as unknown as WalletVault
    }
    // Keep legacy ciphertext unchanged. Its digest gives all tabs the same ID
    // without storing or deriving anything from the plaintext recovery phrase.
    if (value.v !== 1 || typeof value.iv !== 'string' || typeof value.salt !== 'string' || typeof value.data !== 'string') {
      throw new Error('Unsupported wallet format')
    }
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
    return {
      version: 2,
      id: `legacy-${bufferToHex(digest)}`,
      revision: 0,
      address: null,
      encryptedMnemonic: raw,
      backedUp: await getBasicStorage().getItem<boolean>(STORAGE_PHRASE_BACKEDUP_KEY) === true,
    }
  },

  async write(vault: WalletVault): Promise<void> {
    const raw = JSON.stringify(vault)
    await getStorage().save(STORAGE_MNEMONIC_KEY, raw)
    if (await getStorage().get(STORAGE_MNEMONIC_KEY) !== raw) throw new Error('Wallet persistence verification failed')
  },

  async decrypt(vault: WalletVault, password: string): Promise<string | null> {
    if (!password) return null
    return CryptoUtil.decrypt(vault.encryptedMnemonic, password)
  },

  async create(mnemonic: string, address: string, password: string, backedUp: boolean): Promise<WalletVault> {
    if (!password) throw new Error('A password is required')
    if (await this.read()) throw new Error('A wallet already exists. Unlock it or explicitly delete it first.')
    const vault: WalletVault = {
      version: 2,
      id: window.crypto.randomUUID(),
      revision: 0,
      address,
      encryptedMnemonic: await CryptoUtil.encrypt(mnemonic, password),
      backedUp,
    }
    await this.write(vault)
    if (await this.decrypt(vault, password) !== mnemonic) throw new Error('Wallet encryption verification failed')
    return vault
  },
}
