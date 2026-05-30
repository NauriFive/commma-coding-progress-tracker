import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getConnInfo } from '@hono/node-server/conninfo'
import { redis } from '../redis.js'
import { apiError } from '../lib/errors.js'
import { log } from '../logger.js'
import type { AppEnv } from '../types.js'

const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('TTL', KEYS[1])}
`

export interface RateLimitOptions {
  scope: string
  limit: number
  windowS: number
  key: (c: Context<AppEnv>) => string
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const window = Math.floor(Date.now() / 1000 / options.windowS)
    const redisKey = `rl:${options.scope}:${options.key(c)}:${window}`

    let count: number
    let ttl: number
    try {
      const result = (await redis.eval(
        FIXED_WINDOW_SCRIPT,
        1,
        redisKey,
        String(options.windowS),
      )) as [number, number]
      count = result[0]
      ttl = result[1]
    } catch (err) {
      log.error('rate_limit_redis_error', {
        scope: options.scope,
        message: err instanceof Error ? err.message : String(err),
      })
      await next()
      return
    }

    const remaining = Math.max(0, options.limit - count)
    const reset =
      Math.floor(Date.now() / 1000) + (ttl >= 0 ? ttl : options.windowS)
    c.header('X-RateLimit-Limit', String(options.limit))
    c.header('X-RateLimit-Remaining', String(remaining))
    c.header('X-RateLimit-Reset', String(reset))

    if (count > options.limit) {
      return apiError(c, 'RATE_LIMITED', 'Rate limit exceeded')
    }

    await next()
  })
}

export function userKey(c: Context<AppEnv>): string {
  return c.get('userId')
}

export function ipKey(c: Context<AppEnv>): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return getConnInfo(c).remote.address ?? 'unknown'
}
