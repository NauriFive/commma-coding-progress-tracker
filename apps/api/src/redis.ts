import { Redis } from 'ioredis'
import { env } from './env.js'
import { log } from './logger.js'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
})

redis.on('error', (err) => {
  log.error('redis_error', { message: err.message })
})

redis.on('ready', () => {
  log.info('redis_ready')
})
