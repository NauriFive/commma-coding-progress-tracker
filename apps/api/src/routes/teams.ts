import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { zValidator } from '@hono/zod-validator'
import { z, type ZodError } from 'zod'
import {
  type KeyboardHeatmap,
  sessions,
  streaks,
  teamInvites,
  teamMembers,
  teams,
  users,
} from '@commma/db'
import { hasTeamAccess } from '@commma/shared'
import { db } from '../db.js'
import { env } from '../env.js'
import { apiError } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit, userKey } from '../middleware/rateLimit.js'
import {
  type LeaderboardPeriod,
  periodWindow,
} from '../aggregate/leaderboard.js'
import {
  canManageTeam,
  isTeamFrozen,
  isValidSlug,
  mergeHeatmaps,
  TEAM_MAX_MEMBERS,
  TEAM_MAX_OWNED,
} from '../lib/teams.js'
import { isUuid } from '../lib/uuid.js'
import { redis } from '../redis.js'
import { log } from '../logger.js'
import type { AppEnv } from '../types.js'

export const teamRoutes = new Hono<AppEnv>()

teamRoutes.use('*', requireAuth)

const read = rateLimit({ scope: 'read', limit: 300, windowS: 3600, key: userKey })
const write = rateLimit({
  scope: 'write',
  limit: 300,
  windowS: 3600,
  key: userKey,
})

const HEATMAP_CACHE_TTL_S = 600

function heatmapCacheKey(teamId: string) {
  return `team:heatmap:v1:${teamId}`
}

function parsePeriod(raw: string | undefined): LeaderboardPeriod {
  if (raw === 'month' || raw === 'alltime') return raw
  return 'week'
}

async function loadTeam(slug: string | undefined) {
  if (!slug || !isValidSlug(slug)) return null
  const rows = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1)
  return rows[0] ?? null
}

async function membershipRole(
  teamId: string,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}

async function teamFrozen(ownerId: string): Promise<boolean> {
  const rows = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1)
  return isTeamFrozen(rows[0]?.plan ?? 'free', env.FREE_MODE)
}

async function loadMembers(teamId: string) {
  return db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(teamMembers.joinedAt)
}

const createSchema = z
  .object({
    name: z.string().min(1).max(64),
    slug: z.string().min(1).max(39),
  })
  .strict()

const patchSchema = z.object({ name: z.string().min(1).max(64) }).strict()

const inviteSchema = z.object({ handle: z.string().min(1).max(39) }).strict()

function invalid(
  result: { success: boolean; error?: ZodError },
  c: Context<AppEnv>,
) {
  if (!result.success)
    return apiError(
      c,
      'VALIDATION_ERROR',
      'Invalid team data',
      result.error?.issues,
    )
}

teamRoutes.post('/', write, zValidator('json', createSchema, invalid), async (c) => {
  const userId = c.get('userId')
  const { name, slug } = c.req.valid('json')
  if (!isValidSlug(slug)) return apiError(c, 'VALIDATION_ERROR', 'Invalid slug')

  const owner = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!hasTeamAccess(owner[0]?.plan ?? 'free', env.FREE_MODE)) {
    return apiError(c, 'FORBIDDEN', 'A Team plan is required to create a team')
  }

  const owned = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teams)
    .where(eq(teams.ownerId, userId))
  if ((owned[0]?.count ?? 0) >= TEAM_MAX_OWNED) {
    return apiError(
      c,
      'CONFLICT',
      `Your Team plan includes up to ${TEAM_MAX_OWNED} teams. Delete one to create another.`,
    )
  }

  const existing = await loadTeam(slug)
  if (existing) return apiError(c, 'CONFLICT', 'That team slug is taken')

  const team = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(teams)
      .values({ slug, name, ownerId: userId })
      .returning()
    const row = inserted[0]
    await tx
      .insert(teamMembers)
      .values({ teamId: row.id, userId, role: 'owner' })
    return row
  })

  return c.json(
    { slug: team.slug, name: team.name, created_at: team.createdAt },
    201,
  )
})

teamRoutes.get('/', read, async (c) => {
  const userId = c.get('userId')
  const rows = await db
    .select({
      slug: teams.slug,
      name: teams.name,
      role: teamMembers.role,
      created_at: teams.createdAt,
      ownerPlan: users.plan,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(users, eq(users.id, teams.ownerId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(desc(teamMembers.joinedAt))
  return c.json({
    teams: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      role: r.role,
      created_at: r.created_at,
      frozen: isTeamFrozen(r.ownerPlan, env.FREE_MODE),
    })),
  })
})

teamRoutes.get('/invites', read, async (c) => {
  const userId = c.get('userId')
  const rows = await db
    .select({
      id: teamInvites.id,
      slug: teams.slug,
      name: teams.name,
      invited_by: users.handle,
      created_at: teamInvites.createdAt,
    })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .innerJoin(users, eq(users.id, teamInvites.invitedBy))
    .where(eq(teamInvites.inviteeId, userId))
    .orderBy(desc(teamInvites.createdAt))

  return c.json({
    invites: rows.map((r) => ({
      id: r.id,
      team: { slug: r.slug, name: r.name },
      invited_by: r.invited_by,
      created_at: r.created_at,
    })),
  })
})

async function loadOwnInvite(inviteId: string, userId: string) {
  if (!isUuid(inviteId)) return null
  const rows = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.inviteeId, userId)))
    .limit(1)
  return rows[0] ?? null
}

teamRoutes.post('/invites/:id/accept', write, async (c) => {
  const userId = c.get('userId')
  const invite = await loadOwnInvite(c.req.param('id'), userId)
  if (!invite) return apiError(c, 'NOT_FOUND', 'Invite not found')

  const teamRows = await db
    .select({ ownerId: teams.ownerId, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(eq(teams.id, invite.teamId))
    .limit(1)
  const team = teamRows[0]
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (await teamFrozen(team.ownerId)) {
    return apiError(c, 'FORBIDDEN', "This team's plan is inactive")
  }

  const outcome = await db.transaction(async (tx) => {
    await tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, invite.teamId))
      .for('update')
    const members = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, invite.teamId))
    if ((members[0]?.count ?? 0) >= TEAM_MAX_MEMBERS) return 'full'
    await tx
      .insert(teamMembers)
      .values({ teamId: invite.teamId, userId, role: 'member' })
      .onConflictDoNothing()
    await tx.delete(teamInvites).where(eq(teamInvites.id, invite.id))
    return 'joined'
  })

  if (outcome === 'full') return apiError(c, 'CONFLICT', 'Team is full')
  return c.json({ team: { slug: team.slug, name: team.name } })
})

teamRoutes.post('/invites/:id/decline', write, async (c) => {
  const userId = c.get('userId')
  const invite = await loadOwnInvite(c.req.param('id'), userId)
  if (!invite) return apiError(c, 'NOT_FOUND', 'Invite not found')
  await db.delete(teamInvites).where(eq(teamInvites.id, invite.id))
  return c.body(null, 204)
})

teamRoutes.get('/:slug', read, async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (!(await membershipRole(team.id, userId))) {
    return apiError(c, 'NOT_FOUND', 'Team not found')
  }

  const [members, frozen] = await Promise.all([
    loadMembers(team.id),
    teamFrozen(team.ownerId),
  ])
  return c.json({
    slug: team.slug,
    name: team.name,
    created_at: team.createdAt,
    frozen,
    member_count: members.length,
    max_members: TEAM_MAX_MEMBERS,
    members: members.map((m) => ({
      handle: m.handle,
      avatar_url: m.avatarUrl,
      role: m.role,
      joined_at: m.joinedAt,
    })),
  })
})

teamRoutes.patch('/:slug', write, zValidator('json', patchSchema, invalid), async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  const role = await membershipRole(team.id, userId)
  if (!role) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (!canManageTeam(role)) return apiError(c, 'FORBIDDEN', 'Owner only')
  if (await teamFrozen(team.ownerId)) {
    return apiError(c, 'FORBIDDEN', "This team's plan is inactive")
  }

  const { name } = c.req.valid('json')
  const updated = await db
    .update(teams)
    .set({ name })
    .where(eq(teams.id, team.id))
    .returning()
  const row = updated[0]
  return c.json({ slug: row.slug, name: row.name, created_at: row.createdAt })
})

teamRoutes.delete('/:slug', write, async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  const role = await membershipRole(team.id, userId)
  if (!role) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (!canManageTeam(role)) return apiError(c, 'FORBIDDEN', 'Owner only')

  await db.transaction(async (tx) => {
    await tx.delete(teamInvites).where(eq(teamInvites.teamId, team.id))
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, team.id))
    await tx.delete(teams).where(eq(teams.id, team.id))
  })
  return c.body(null, 204)
})

teamRoutes.post('/:slug/invites', write, zValidator('json', inviteSchema, invalid), async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  const role = await membershipRole(team.id, userId)
  if (!role) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (!canManageTeam(role)) return apiError(c, 'FORBIDDEN', 'Owner only')
  if (await teamFrozen(team.ownerId)) {
    return apiError(c, 'FORBIDDEN', "This team's plan is inactive")
  }

  const { handle } = c.req.valid('json')
  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.handle, handle))
    .limit(1)
  const targetId = target[0]?.id
  if (!targetId) return apiError(c, 'NOT_FOUND', 'User not found')

  if (await membershipRole(team.id, targetId)) {
    return apiError(c, 'CONFLICT', 'User is already a member')
  }

  const [memberCount, pendingCount, alreadyInvited] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, team.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(teamInvites)
      .where(eq(teamInvites.teamId, team.id)),
    db
      .select({ id: teamInvites.id })
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.teamId, team.id),
          eq(teamInvites.inviteeId, targetId),
        ),
      )
      .limit(1),
  ])

  if (alreadyInvited[0]) {
    return apiError(c, 'CONFLICT', 'User is already invited')
  }
  const projected =
    (memberCount[0]?.count ?? 0) + (pendingCount[0]?.count ?? 0)
  if (projected >= TEAM_MAX_MEMBERS) {
    return apiError(c, 'CONFLICT', 'Team is full')
  }

  const inserted = await db
    .insert(teamInvites)
    .values({ teamId: team.id, inviteeId: targetId, invitedBy: userId })
    .returning({ id: teamInvites.id })
  return c.json({ id: inserted[0].id }, 201)
})

teamRoutes.delete('/:slug/members/:handle', write, async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  const myRole = await membershipRole(team.id, userId)
  if (!myRole) return apiError(c, 'NOT_FOUND', 'Team not found')

  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.handle, c.req.param('handle')))
    .limit(1)
  const targetId = target[0]?.id
  if (!targetId) return apiError(c, 'NOT_FOUND', 'User not found')

  const targetRole = await membershipRole(team.id, targetId)
  if (!targetRole) return apiError(c, 'NOT_FOUND', 'User not found')
  if (targetRole === 'owner') {
    return apiError(c, 'VALIDATION_ERROR', 'Delete the team to remove the owner')
  }

  const isSelf = targetId === userId
  if (!isSelf && !canManageTeam(myRole)) {
    return apiError(c, 'FORBIDDEN', 'Owner only')
  }

  await db
    .delete(teamMembers)
    .where(
      and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, targetId)),
    )
  return c.body(null, 204)
})

teamRoutes.get('/:slug/leaderboard', read, async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (!(await membershipRole(team.id, userId))) {
    return apiError(c, 'NOT_FOUND', 'Team not found')
  }

  const period = parsePeriod(c.req.query('period'))
  const now = new Date()
  const members = await loadMembers(team.id)
  const memberIds = members.map((m) => m.userId)

  const window = periodWindow(period, now)
  const conditions = [inArray(sessions.userId, memberIds)]
  if (window) {
    conditions.push(gte(sessions.startedAt, window.start))
    conditions.push(lt(sessions.startedAt, window.end))
  }

  const [durationRows, streakRows] = await Promise.all([
    db
      .select({
        userId: sessions.userId,
        total: sql<number>`sum(${sessions.durationS})::int`,
      })
      .from(sessions)
      .where(and(...conditions))
      .groupBy(sessions.userId),
    db
      .select({ userId: streaks.userId, currentDays: streaks.currentDays })
      .from(streaks)
      .where(inArray(streaks.userId, memberIds)),
  ])

  const durationByUser = new Map(durationRows.map((r) => [r.userId, r.total]))
  const streakByUser = new Map(streakRows.map((r) => [r.userId, r.currentDays]))

  const ranked = members
    .map((m) => ({
      handle: m.handle,
      avatar_url: m.avatarUrl,
      role: m.role,
      duration_s: durationByUser.get(m.userId) ?? 0,
      streak_days: streakByUser.get(m.userId) ?? 0,
    }))
    .sort((a, b) => b.duration_s - a.duration_s)
    .map((entry, index) => ({ rank: index + 1, ...entry }))

  return c.json({
    slug: team.slug,
    period,
    updated_at: now.toISOString(),
    entries: ranked,
  })
})

teamRoutes.get('/:slug/heatmap', read, async (c) => {
  const userId = c.get('userId')
  const team = await loadTeam(c.req.param('slug'))
  if (!team) return apiError(c, 'NOT_FOUND', 'Team not found')
  if (!(await membershipRole(team.id, userId))) {
    return apiError(c, 'NOT_FOUND', 'Team not found')
  }

  const cacheKey = heatmapCacheKey(team.id)
  try {
    const cached = await redis.get(cacheKey)
    if (cached) return c.json(JSON.parse(cached) as KeyboardHeatmap)
  } catch (err) {
    log.error('team_heatmap_cache_read_error', {
      message: err instanceof Error ? err.message : String(err),
    })
  }

  const members = await loadMembers(team.id)
  const memberIds = members.map((m) => m.userId)
  const rows = await db
    .select({ heatmap: sessions.keyboardHeatmap })
    .from(sessions)
    .where(
      and(
        inArray(sessions.userId, memberIds),
        isNotNull(sessions.keyboardHeatmap),
      ),
    )

  const merged = mergeHeatmaps(
    rows
      .map((r) => r.heatmap)
      .filter((h): h is KeyboardHeatmap => h !== null),
  )

  try {
    await redis.set(
      cacheKey,
      JSON.stringify(merged),
      'EX',
      HEATMAP_CACHE_TTL_S,
    )
  } catch (err) {
    log.error('team_heatmap_cache_write_error', {
      message: err instanceof Error ? err.message : String(err),
    })
  }

  return c.json(merged)
})
