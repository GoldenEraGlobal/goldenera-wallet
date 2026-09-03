export class DeviceService {
  private static instance: DeviceService

  private constructor() { }

  public static getInstance(): DeviceService {
    if (!DeviceService.instance) {
      DeviceService.instance = new DeviceService()
    }
    return DeviceService.instance
  }

  /**
   * Keep the legacy identifier through the mixed-client retirement window.
   * Cached clients may still use it against an older mutating backend replica.
   */
  public async cleanupObsoleteIdentifier(): Promise<void> {
    // Removal is deferred until old PWA and backend overlap has expired.
  }
}
