import { describe, expect, it, vi } from 'vitest'
import { createUuid } from '../../packages/core/src/utils/UuidUtil'

function fallbackSource(native?: () => string) {
  return {
    randomUUID: native,
    getRandomValues: vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index))
      return bytes
    }),
  }
}

describe('createUuid', () => {
  it('uses a valid native UUID when available', () => {
    const source = fallbackSource(() => '00000000-0000-4000-8000-000000000001')

    expect(createUuid(source)).toBe('00000000-0000-4000-8000-000000000001')
    expect(source.getRandomValues).not.toHaveBeenCalled()
  })

  it('generates an RFC4122 version-4 UUID with getRandomValues when randomUUID is absent', () => {
    const source = fallbackSource()

    expect(createUuid(source)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(source.getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('falls back when a randomUUID compatibility shim returns malformed data', () => {
    const source = fallbackSource(() => 'not-a-uuid')

    expect(createUuid(source)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(source.getRandomValues).toHaveBeenCalledTimes(1)
  })
})
