import { describe, expect, it, vi } from 'vitest'

const remove = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@capacitor/preferences', () => ({
  Preferences: { remove },
}))

import { DeviceService } from '../../packages/core/src/services/DeviceService'

describe('retired PWA device registration', () => {
  it('preserves the legacy identifier during the mixed-client window', async () => {
    await DeviceService.getInstance().cleanupObsoleteIdentifier()

    expect(remove).not.toHaveBeenCalled()
  })
})
