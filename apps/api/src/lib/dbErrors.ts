const UNIQUE_VIOLATION = '23505'

export function uniqueViolationConstraint(err: unknown): string | null {
  const cause = err instanceof Error && err.cause ? err.cause : err
  if (!cause || typeof cause !== 'object') return null
  const { code, constraint_name: constraint } = cause as {
    code?: unknown
    constraint_name?: unknown
  }
  if (code !== UNIQUE_VIOLATION) return null
  return typeof constraint === 'string' && constraint.length > 0
    ? constraint
    : null
}
