import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { pushSubscriptions, streaks } from '@commma/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { log } from '../logger.js'
import { acquireLeader } from '../lib/scheduling.js'
import { isWebPushEnabled, sendPush } from '../lib/webPush.js'

const INTERVAL_MS = 5 * 60 * 1000
const SLOT_LOCK_TTL_MS = 2 * 60 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let running = false

async function tick(): Promise<void> {
  if (!isWebPushEnabled()) return
  if (running) return
  const now = new Date()
  if (now.getUTCHours() !== env.PUSH_REMINDER_HOUR_UTC) return
  const slot = `${now.toISOString().slice(0, 10)}h${now.getUTCHours()}`
  if (!(await acquireLeader(`push-reminders:${slot}`, SLOT_LOCK_TTL_MS))) return
  running = true
  try {
    const todayUTC = now.toISOString().slice(0, 10)

    const targets = await db
      .select({
        currentDays: streaks.currentDays,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(streaks)
      .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, streaks.userId))
      .where(
        and(
          gt(streaks.currentDays, 0),
          lt(streaks.lastActiveDate, sql`${todayUTC}::date`),
        ),
      )

    let sent = 0
    let expired = 0

    for (const t of targets) {
      const result = await sendPush(
        { endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth },
        {
          title: 'Streak reminder — commma',
          body: `You haven't coded today. Keep your ${t.currentDays}-day streak alive.`,
          url: '/',
        },
      ).catch(() => null)

      if (result === 'expired') {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, t.endpoint))
        expired++
      } else if (result === 'sent') {
        sent++
      }
    }

    if (sent > 0 || expired > 0) log.info('push_reminders_sent', { sent, expired })
  } catch (err) {
    log.error('push_scheduler_tick_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    running = false
  }
}

export function startPushScheduler(): void {
  if (timer) return
  log.info('push_scheduler_started', { intervalMs: INTERVAL_MS })
  timer = setInterval(() => void tick(), INTERVAL_MS)
  timer.unref()
}

export function stopPushScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
