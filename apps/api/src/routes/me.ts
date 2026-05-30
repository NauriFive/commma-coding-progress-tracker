import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { streaks, users } from '@commma/db'
import { db } from '../db.js'
import { apiError } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit, userKey } from '../middleware/rateLimit.js'
import type { AppEnv } from '../types.js'

export const meRoutes = new Hono<AppEnv>()

meRoutes.get(
  '/',
  requireAuth,
  rateLimit({ scope: 'read', limit: 300, windowS: 3600, key: userKey }),
  async (c) => {
    const userId = c.get('userId')
    const rows = await db
      .select()
      .from(users)
      .leftJoin(streaks, eq(streaks.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1)

    const row = rows[0]
    if (!row) return apiError(c, 'NOT_FOUND', 'User not found')

    const { users: u, streaks: s } = row
    return c.json({
      id: u.id,
      handle: u.handle,
      email: u.email,
      avatar_url: u.avatarUrl,
      privacy: u.privacy,
      created_at: u.createdAt,
      streak: {
        current_days: s?.currentDays ?? 0,
        longest_days: s?.longestDays ?? 0,
        last_active_date: s?.lastActiveDate ?? null,
      },
    })
  },
)
