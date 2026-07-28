import { describe, expect, it } from 'vitest'
import { isUuid } from '../../src/lib/uuid.js'

describe('isUuid', () => {
  it('accepts a canonical uuid in either case', () => {
    expect(isUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true)
    expect(isUuid('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(true)
  })

  it('rejects values postgres would fail to cast to uuid', () => {
    expect(isUuid('abc')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('3f2504e0-4f89-11d3-9a0c-0305e82c330')).toBe(false)
    expect(isUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301x')).toBe(false)
    expect(isUuid('3f2504e04f8911d39a0c0305e82c3301')).toBe(false)
    expect(isUuid('gggggggg-4f89-11d3-9a0c-0305e82c3301')).toBe(false)
  })

  it('rejects absent values', () => {
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})
