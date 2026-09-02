import { Preferences } from '@capacitor/preferences'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { CryptoUtil } from '../utils/CryptoUtil'

export interface SecureStorageOptions {
    password?: string
}

export interface SecureStorageAdapter {
    save(key: string, value: string, options?: SecureStorageOptions): Promise<void>
    get(key: string, options?: SecureStorageOptions): Promise<string | null>
    exists(key: string): Promise<boolean>
    remove(key: string): Promise<void>
    clear(): Promise<void>
}

export interface BasicStorageAdapter {
    getItem<T = any>(key: string): Promise<T | null>
    setItem<T = any>(key: string, value: T): Promise<void>
    removeItem(key: string): Promise<void>
    clear(): Promise<void>
}

const SECURE_PREFIX = 'ge_secure:'
const BASIC_PREFIX = 'ge_basic:'

export const STORAGE_MNEMONIC_KEY = 'mnemonic'
export const STORAGE_PHRASE_BACKEDUP_KEY = 'backedup'

class SecureStorageServiceImpl implements SecureStorageAdapter {
    private getFullKey(key: string): string {
        return `${SECURE_PREFIX}${key}`
    }

    async save(key: string, value: string, options?: SecureStorageOptions): Promise<void> {
        let finalValue = value

        if (options?.password) {
            finalValue = await CryptoUtil.encrypt(value, options.password)
        }

        await SecureStoragePlugin.set({
            key: this.getFullKey(key),
            value: finalValue,
        })
    }

    async get(key: string, options?: SecureStorageOptions): Promise<string | null> {
        if (!await this.exists(key)) return null
        const { value } = await SecureStoragePlugin.get({ key: this.getFullKey(key) })
        // A present empty string is still persisted bytes. Return it so the
        // wallet-vault parser can classify it as corruption rather than absence.
        if (value === null) throw new Error('Stored wallet data is unreadable')
        return options?.password ? CryptoUtil.decrypt(value, options.password) : value
    }

    async exists(key: string): Promise<boolean> {
        const { value: keys } = await SecureStoragePlugin.keys()
        return keys.includes(this.getFullKey(key))
    }

    async remove(key: string): Promise<void> {
        if (!await this.exists(key)) return
        await SecureStoragePlugin.remove({ key: this.getFullKey(key) })
        if (await this.exists(key)) throw new Error('Secure storage did not remove the requested value')
    }

    async clear(): Promise<void> {
        const { value: keys } = await SecureStoragePlugin.keys()
        for (const key of keys.filter(value => value.startsWith(SECURE_PREFIX))) {
            await this.remove(key.slice(SECURE_PREFIX.length))
        }
    }

}

class BasicStorageServiceImpl implements BasicStorageAdapter {
    private getFullKey(key: string): string {
        return `${BASIC_PREFIX}${key}`
    }

    async getItem<T = any>(key: string): Promise<T | null> {
        const { value } = await Preferences.get({ key: this.getFullKey(key) })
        if (value === null) return null
        try {
            return JSON.parse(value) as T
        } catch {
            return value as unknown as T
        }
    }

    async setItem<T = any>(key: string, value: T): Promise<void> {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
        await Preferences.set({
            key: this.getFullKey(key),
            value: stringValue,
        })
    }

    async removeItem(key: string): Promise<void> {
        await Preferences.remove({ key: this.getFullKey(key) })
        const { value } = await Preferences.get({ key: this.getFullKey(key) })
        if (value !== null) throw new Error('Storage did not remove the requested value')
    }

    async clear(): Promise<void> {
        const { keys } = await Preferences.keys()
        const keysToRemove = keys.filter((k) => k.startsWith(BASIC_PREFIX))

        for (const key of keysToRemove) {
            await this.removeItem(key.slice(BASIC_PREFIX.length))
        }
    }
}

export const StorageService = {
    secure: new SecureStorageServiceImpl(),
    basic: new BasicStorageServiceImpl(),
}

export const getStorage = () => StorageService.secure
export const getBasicStorage = () => StorageService.basic
