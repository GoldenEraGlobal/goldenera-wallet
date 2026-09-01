import { Preferences } from '@capacitor/preferences'
import { register } from '@project/api'
import { v4 as uuidv4 } from 'uuid'
import { detectPlatform } from '../utils/PlatformUtil'

export class DeviceService {
  private static readonly CLIENT_ID_KEY = 'device_client_identifier'
  private static instance: DeviceService
  private registration: Promise<void> | null = null
  private registeredAt = 0

  private constructor() { }

  public static getInstance(): DeviceService {
    if (!DeviceService.instance) {
      DeviceService.instance = new DeviceService()
    }
    return DeviceService.instance
  }

  public async getClientIdentifier(): Promise<string> {
    const { value } = await Preferences.get({ key: DeviceService.CLIENT_ID_KEY })

    if (value) {
      return value
    }

    const newId = uuidv4()
    await Preferences.set({ key: DeviceService.CLIENT_ID_KEY, value: newId })
    return newId
  }

  public register(): Promise<void> {
    if (this.registration) return this.registration
    if (Date.now() - this.registeredAt < 5 * 60 * 1000) return Promise.resolve()
    this.registration = this.registerOnce().finally(() => { this.registration = null })
    return this.registration
  }

  private async registerOnce(): Promise<void> {
    try {
      const clientIdentifier = await this.getClientIdentifier()
      await register({
        body: { clientIdentifier, platform: detectPlatform(), appVersion: '1.0.0' },
        options: { timeout: 8000 },
      })
      this.registeredAt = Date.now()
    } catch {
      // Retried on the next wallet session, never in the local unlock path.
      console.warn('Optional device registration failed; it will be retried later.')
    }
  }
}
