import { log } from '../logger.js'
import { runAggregation } from './run.js'

const INTERVAL_MS = 5 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let running = false

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    await runAggregation()
  } catch (err) {
    log.error('aggregation_tick_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    running = false
  }
}

export function startAggregation(): void {
  if (timer) return
  log.info('aggregation_started', { intervalMs: INTERVAL_MS })
  void tick()
  timer = setInterval(() => void tick(), INTERVAL_MS)
  timer.unref()
}

export function stopAggregation(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
