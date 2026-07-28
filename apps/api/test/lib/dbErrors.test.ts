import { describe, expect, it } from 'vitest'
import { uniqueViolationConstraint } from '../../src/lib/dbErrors.js'

function driverError(over: Record<string, unknown> = {}) {
  return Object.assign(new Error('duplicate key value'), {
    code: '23505',
    constraint_name: 'users_email_unique',
    ...over,
  })
}

describe('uniqueViolationConstraint', () => {
  it('reads the constraint off a wrapped drizzle error', () => {
    const wrapped = new Error('Failed query', { cause: driverError() })
    expect(uniqueViolationConstraint(wrapped)).toBe('users_email_unique')
  })

  it('reads the constraint off a bare driver error', () => {
    expect(uniqueViolationConstraint(driverError())).toBe('users_email_unique')
  })

  it('ignores errors that are not unique violations', () => {
    const wrapped = new Error('Failed query', {
      cause: driverError({ code: '22P02' }),
    })
    expect(uniqueViolationConstraint(wrapped)).toBeNull()
  })

  it('ignores a unique violation with no named constraint', () => {
    expect(uniqueViolationConstraint(driverError({ constraint_name: undefined })))
      .toBeNull()
  })

  it('ignores values that are not errors at all', () => {
    expect(uniqueViolationConstraint(null)).toBeNull()
    expect(uniqueViolationConstraint(undefined)).toBeNull()
    expect(uniqueViolationConstraint('boom')).toBeNull()
    expect(uniqueViolationConstraint(new Error('plain'))).toBeNull()
  })
})
