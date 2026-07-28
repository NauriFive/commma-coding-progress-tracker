import { Hono } from 'hono'
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import sharp from 'sharp'
import { sessionFiles, sessionLangs, sessions, users } from '@commma/db'
import type { KeyboardHeatmap } from '@commma/db'
import { db } from '../db.js'
import { apiError } from '../lib/errors.js'
import { verifyAccessToken } from '../lib/jwt.js'
import {
  decodeCursor,
  encodeCursor,
  parseLimit,
  sessionKeyset,
} from '../lib/cursor.js'
import {
  heatmapCardCacheKey,
  renderHeatmapCardSvg,
  type CardAspect,
} from '../lib/heatmapCard.js'
import { toSessionSummary, topLangBySession } from '../lib/sessionSummary.js'
import { isUuid } from '../lib/uuid.js'
import { requireAuth } from '../middleware/auth.js'
import { ipKey, rateLimit, userKey } from '../middleware/rateLimit.js'
import { redis } from '../redis.js'
import { log } from '../logger.js'
import type { AppEnv } from '../types.js'

const heatmapCardSchema = z
  .object({
    layout: z.enum(['qwerty', 'dvorak', 'colemak']).default('qwerty'),
    aspect: z.enum(['9:16', '1:1', '16:9']).default('16:9'),
    show_handle: z.boolean().default(true),
    show_stats: z.boolean().default(true),
  })
  .strict()

const heatmapCardQuerySchema = z.object({
  layout: z.enum(['qwerty', 'dvorak', 'colemak']).default('qwerty'),
  aspect: z.enum(['9:16', '1:1', '16:9']).default('16:9'),
})

const CARD_CACHE_TTL_S = 600

export const sessionRoutes = new Hono<AppEnv>()

async function renderCardPng(
  sessionId: string,
  heatmap: KeyboardHeatmap,
  paceCpm: number | null,
  handle: string | null,
  aspect: CardAspect,
  showStats: boolean,
): Promise<Buffer> {
  let stats: string | undefined
  if (showStats) {
    const [topLang] = await db
      .select({ lang: sessionLangs.lang })
      .from(sessionLangs)
      .where(eq(sessionLangs.sessionId, sessionId))
      .orderBy(desc(sessionLangs.pct))
      .limit(1)
    const parts = [`${paceCpm ?? 0} cpm`]
    if (topLang) parts.push(topLang.lang)
    stats = parts.join('  ·  ')
  }

  const svg = renderHeatmapCardSvg({
    heatmap,
    aspect,
    handle: handle ? `@${handle}` : undefined,
    stats,
  })
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function cachedCardPng(
  cacheKey: string,
  render: () => Promise<Buffer>,
): Promise<Buffer> {
  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) return cached
  } catch (err) {
    log.error('card_cache_read_error', {
      message: err instanceof Error ? err.message : String(err),
    })
  }

  const png = await render()

  try {
    await redis.set(cacheKey, png, 'EX', CARD_CACHE_TTL_S)
  } catch (err) {
    log.error('card_cache_write_error', {
      message: err instanceof Error ? err.message : String(err),
    })
  }

  return png
}

sessionRoutes.get(
  '/',
  requireAuth,
  rateLimit({ scope: 'read', limit: 300, windowS: 3600, key: userKey }),
  async (c) => {
    const userId = c.get('userId')
    const limit = parseLimit(c.req.query('limit'), 20, 100)

    const conditions = [eq(sessions.userId, userId)]
    const cursorRaw = c.req.query('cursor')
    if (cursorRaw) {
      const cursor = decodeCursor(cursorRaw)
      if (!cursor) return apiError(c, 'VALIDATION_ERROR', 'Invalid cursor')
      const keyset = sessionKeyset(cursor)
      if (keyset) conditions.push(keyset)
    }

    const rows = await db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.startedAt), desc(sessions.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const topLang = await topLangBySession(page.map((s) => s.id))

    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last
        ? encodeCursor({ startedAt: last.startedAt.toISOString(), id: last.id })
        : null

    return c.json({
      sessions: page.map((s) => toSessionSummary(s, topLang.get(s.id) ?? null)),
      next_cursor: nextCursor,
    })
  },
)

sessionRoutes.get(
  '/featured',
  rateLimit({ scope: 'read', limit: 300, windowS: 3600, key: ipKey }),
  async (c) => {
    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(users.privacy, 'full'),
          isNotNull(sessions.keyboardHeatmap),
          gte(sessions.durationS, 300),
        ),
      )
      .orderBy(desc(sessions.startedAt))
      .limit(1)

    const row = rows[0]
    if (!row) return apiError(c, 'NOT_FOUND', 'No featured session available')

    const { sessions: session, users: owner } = row
    const [langRows, fileRows] = await Promise.all([
      db
        .select()
        .from(sessionLangs)
        .where(eq(sessionLangs.sessionId, session.id))
        .orderBy(desc(sessionLangs.pct)),
      db
        .select()
        .from(sessionFiles)
        .where(eq(sessionFiles.sessionId, session.id))
        .orderBy(desc(sessionFiles.changes))
        .limit(10),
    ])

    c.header('Cache-Control', 'public, max-age=300')
    return c.json({
      id: session.id,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      duration_s: session.durationS,
      lines_delta: session.linesDelta,
      pace_cpm: session.paceCpm,
      peak_cpm: session.peakCpm,
      user: { handle: owner.handle, avatar_url: owner.avatarUrl },
      langs: langRows.map((l) => ({
        lang: l.lang,
        duration_s: l.durationS,
        pct: Number(l.pct),
      })),
      files: fileRows.map((f) => ({ path: f.path, changes: f.changes })),
      keyboard_heatmap: session.keyboardHeatmap ?? null,
    })
  },
)

sessionRoutes.get(
  '/:id',
  rateLimit({ scope: 'read', limit: 300, windowS: 3600, key: ipKey }),
  async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) return apiError(c, 'NOT_FOUND', 'Session not found')

    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    const requesterId = token ? await verifyAccessToken(token) : null

    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .limit(1)

    const row = rows[0]
    if (!row) return apiError(c, 'NOT_FOUND', 'Session not found')

    const { sessions: session, users: owner } = row
    const isOwner = requesterId === session.userId
    if (owner.privacy === 'off' && !isOwner) {
      return apiError(c, 'NOT_FOUND', 'Session not found')
    }
    const suppressDetail = owner.privacy === 'summary' && !isOwner

    const [langRows, fileRows] = await Promise.all([
      db
        .select()
        .from(sessionLangs)
        .where(eq(sessionLangs.sessionId, id))
        .orderBy(desc(sessionLangs.pct)),
      db
        .select()
        .from(sessionFiles)
        .where(eq(sessionFiles.sessionId, id))
        .orderBy(desc(sessionFiles.changes))
        .limit(100),
    ])

    return c.json({
      id: session.id,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      duration_s: session.durationS,
      lines_delta: session.linesDelta,
      pace_cpm: session.paceCpm,
      peak_cpm: session.peakCpm,
      peak_at: session.peakAt,
      langs: langRows.map((l) => ({
        lang: l.lang,
        duration_s: l.durationS,
        pct: Number(l.pct),
      })),
      files: suppressDetail
        ? []
        : fileRows.map((f) => ({ path: f.path, changes: f.changes })),
      keyboard_heatmap: suppressDetail
        ? null
        : (session.keyboardHeatmap ?? null),
      card_available:
        owner.privacy === 'full' && (session.keyboardHeatmap?.total ?? 0) > 0,
    })
  },
)

sessionRoutes.post(
  '/:id/heatmap-card',
  requireAuth,
  rateLimit({ scope: 'card', limit: 120, windowS: 3600, key: userKey }),
  zValidator('json', heatmapCardSchema, (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        'VALIDATION_ERROR',
        'Invalid heatmap card request',
        result.error.issues,
      )
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) return apiError(c, 'NOT_FOUND', 'Session not found')

    const opts = c.req.valid('json')
    if (opts.layout !== 'qwerty') {
      return apiError(
        c,
        'VALIDATION_ERROR',
        'Only the qwerty layout is supported',
      )
    }

    const requesterId = c.get('userId')
    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .limit(1)

    const row = rows[0]
    if (!row) return apiError(c, 'NOT_FOUND', 'Session not found')

    const { sessions: session, users: owner } = row
    const isOwner = requesterId === session.userId
    if (owner.privacy !== 'full' && !isOwner) {
      return apiError(c, 'NOT_FOUND', 'Session not found')
    }

    const heatmap = session.keyboardHeatmap
    if (!heatmap || heatmap.total === 0) {
      return apiError(c, 'NOT_FOUND', 'Session has no heatmap')
    }

    const handle = opts.show_handle ? owner.handle : null
    const cacheKey = heatmapCardCacheKey({
      sessionId: id,
      aspect: opts.aspect,
      layout: opts.layout,
      handle,
      stats: opts.show_stats,
    })
    const png = await cachedCardPng(cacheKey, () =>
      renderCardPng(
        id,
        heatmap,
        session.paceCpm,
        handle,
        opts.aspect,
        opts.show_stats,
      ),
    )

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=300',
      },
    })
  },
)

sessionRoutes.get(
  '/:id/heatmap-card',
  rateLimit({ scope: 'card', limit: 120, windowS: 3600, key: ipKey }),
  zValidator('query', heatmapCardQuerySchema, (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        'VALIDATION_ERROR',
        'Invalid heatmap card request',
        result.error.issues,
      )
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) return apiError(c, 'NOT_FOUND', 'Session not found')

    const opts = c.req.valid('query')
    if (opts.layout !== 'qwerty') {
      return apiError(
        c,
        'VALIDATION_ERROR',
        'Only the qwerty layout is supported',
      )
    }

    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .limit(1)

    const row = rows[0]
    if (!row) return apiError(c, 'NOT_FOUND', 'Session not found')

    const { sessions: session, users: owner } = row
    if (owner.privacy !== 'full') {
      return apiError(c, 'NOT_FOUND', 'Session not found')
    }

    const heatmap = session.keyboardHeatmap
    if (!heatmap || heatmap.total === 0) {
      return apiError(c, 'NOT_FOUND', 'Session has no heatmap')
    }

    const cacheKey = heatmapCardCacheKey({
      sessionId: id,
      aspect: opts.aspect,
      layout: opts.layout,
      handle: owner.handle,
      stats: true,
    })
    const png = await cachedCardPng(cacheKey, () =>
      renderCardPng(
        id,
        heatmap,
        session.paceCpm,
        owner.handle,
        opts.aspect,
        true,
      ),
    )

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=600',
      },
    })
  },
)
