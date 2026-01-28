import { Preferences } from '@capacitor/preferences'
import { registerHook } from '@project/api'
import { v4 as uuidv4 } from 'uuid'
import { detectPlatform } from '../utils/PlatformUtil'

export class DeviceService {
  private static readonly CLIENT_ID_KEY = 'device_client_identifier'
  private static instance: DeviceService

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

  public async register(): Promise<void> {
    try {
      const clientIdentifier = await this.getClientIdentifier()
      const platform = detectPlatform()

      // TODO: Get FCM Token if available
      const fcmToken = 'temp-fcm-token' // Placeholder
      const appVersion = '1.0.0' // Should come from app config

      console.log('Registering device:', { clientIdentifier, platform })

      await registerHook({
        clientIdentifier,
        platform,
        fcmToken,
        appVersion
      })

      console.log('Device registered successfully')
    } catch (error) {
      console.error('Failed to register device:', error)
      // Don't throw, we don't want to block app initialization
    }
  }
}
