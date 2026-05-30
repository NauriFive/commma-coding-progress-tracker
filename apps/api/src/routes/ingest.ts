import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { heartbeatBatchSchema } from '@commma/shared'
import { events, type KeyFreq } from '@commma/db'
import { db } from '../db.js'
import { apiError } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit, userKey } from '../middleware/rateLimit.js'
import type { AppEnv } from '../types.js'

export const ingestRoutes = new Hono<AppEnv>()

ingestRoutes.post(
  '/',
  requireAuth,
  rateLimit({ scope: 'ingest', limit: 1000, windowS: 3600, key: userKey }),
  zValidator('json', heartbeatBatchSchema, (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        'VALIDATION_ERROR',
        'Invalid heartbeat batch',
        result.error.issues,
      )
    }
  }),
  async (c) => {
    const userId = c.get('userId')
    const { events: batch } = c.req.valid('json')

    const rows = batch.map((e) => ({
      id: e.id,
      userId,
      ts: new Date(e.ts),
      lang: e.lang ?? null,
      file: e.file ?? null,
      project: e.project ?? null,
      keystrokes: e.keystrokes,
      lines: e.lines,
      keyFreq: e.key_freq ? (e.key_freq as KeyFreq) : null,
    }))

    const inserted = await db
      .insert(events)
      .values(rows)
      .onConflictDoNothing({ target: [events.id, events.ts] })
      .returning({ id: events.id })

    const received = rows.length
    return c.json({ received, duplicate: received - inserted.length }, 202)
  },
)
