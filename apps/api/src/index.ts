import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { env } from './env.js'
import { log } from './logger.js'
import { startAggregation } from './aggregate/scheduler.js'

const app = createApp()

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info('server_started', { port: info.port })
  if (env.RUN_AGGREGATION) startAggregation()
})
