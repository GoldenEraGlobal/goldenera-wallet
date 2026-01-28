import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { CryptoUtil } from '../utils/CryptoUtil';

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
        try {
            const { value } = await SecureStoragePlugin.get({ key: this.getFullKey(key) })

            if (!value) {
                return null
            }

            if (options?.password) {
                return await CryptoUtil.decrypt(value, options.password)
            }

            return value
        } catch (error) {
            return null
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            const { value: keys } = await SecureStoragePlugin.keys()
            const exists = keys.includes(this.getFullKey(key))
            return exists
        } catch (error) {
            return false
        }
    }

    async remove(key: string): Promise<void> {
        try {
            await SecureStoragePlugin.remove({ key: this.getFullKey(key) })
        } catch {
            // Ignore if key doesn't exist
        }
    }

    async clear(): Promise<void> {
        try {
            const { value: keys } = await SecureStoragePlugin.keys()
            const keysToRemove = keys.filter((k) => k.startsWith(SECURE_PREFIX))

            for (const key of keysToRemove) {
                await SecureStoragePlugin.remove({ key })
            }
        } catch (error) {
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
    }

    async clear(): Promise<void> {
        const { keys } = await Preferences.keys()
        const keysToRemove = keys.filter((k) => k.startsWith(BASIC_PREFIX))

        for (const key of keysToRemove) {
            await Preferences.remove({ key })
        }
    }
}

export const StorageService = {
    secure: new SecureStorageServiceImpl(),
    basic: new BasicStorageServiceImpl(),
}

export const getStorage = () => StorageService.secure
export const getBasicStorage = () => StorageService.basic
