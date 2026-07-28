import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { streaks, users } from '@commma/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { redis } from '../redis.js'
import { exchangeCode, fetchGithubUser } from '../lib/github.js'
import { signAccessToken } from '../lib/jwt.js'
import {
  mintRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../lib/refresh.js'
import {
  clearOAuthStateCookie,
  clearRefreshCookie,
  oauthStateCookieName,
  refreshCookieName,
  setOAuthStateCookie,
  setRefreshCookie,
} from '../lib/cookies.js'
import { uniqueViolationConstraint } from '../lib/dbErrors.js'
import { apiError } from '../lib/errors.js'
import { log } from '../logger.js'
import { requireAuth } from '../middleware/auth.js'
import { ipKey, rateLimit } from '../middleware/rateLimit.js'
import type { AppEnv } from '../types.js'

const CLI_STATE_TTL_SECONDS = 600
const CLI_CODE_TTL_SECONDS = 60

const refreshBodySchema = z.object({ refresh_token: z.string().min(1) })

const CONFLICT_FIELD_BY_CONSTRAINT: Record<string, string> = {
  users_email_unique: 'email address',
  users_handle_unique: 'username',
}

function conflictingField(err: unknown): string | null {
  const constraint = uniqueViolationConstraint(err)
  if (!constraint) return null
  return CONFLICT_FIELD_BY_CONSTRAINT[constraint] ?? null
}

type GithubProfile = {
  login: string
  email: string
  githubId: string
  avatarUrl: string
}

type UpsertResult =
  | { user: typeof users.$inferSelect; conflict?: undefined }
  | { user?: undefined; conflict: string }

async function upsertGithubUser(profile: GithubProfile): Promise<UpsertResult> {
  try {
    const [user] = await db
      .insert(users)
      .values({
        handle: profile.login,
        email: profile.email,
        githubId: profile.githubId,
        avatarUrl: profile.avatarUrl,
      })
      .onConflictDoUpdate({
        target: users.githubId,
        set: {
          handle: profile.login,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
        },
      })
      .returning()
    return { user }
  } catch (err) {
    const field = conflictingField(err)
    if (!field) throw err

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.githubId, profile.githubId))
      .limit(1)
    if (!existing) return { conflict: field }

    const [user] = await db
      .update(users)
      .set({ avatarUrl: profile.avatarUrl })
      .where(eq(users.id, existing.id))
      .returning()
    log.warn('github_profile_sync_skipped', { userId: user.id, field })
    return { user }
  }
}

function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.use(
  '*',
  rateLimit({
    scope: 'auth',
    limit: env.NODE_ENV === 'production' ? 20 : 100,
    windowS: 3600,
    key: ipKey,
    failClosed: true,
  }),
)

authRoutes.get('/github', async (c) => {
  const redirectUri = c.req.query('redirect_uri')
  if (redirectUri && !isLoopbackRedirect(redirectUri)) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid redirect_uri')
  }
  const state = randomBytes(16).toString('base64url')
  setOAuthStateCookie(c, state)
  if (redirectUri) {
    await redis.set(
      `oauth:cli:state:${state}`,
      redirectUri,
      'EX',
      CLI_STATE_TTL_SECONDS,
    )
  }
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', env.GITHUB_CALLBACK_URL)
  url.searchParams.set('scope', 'read:user user:email')
  url.searchParams.set('state', state)
  return c.redirect(url.toString())
})

authRoutes.get('/github/callback', async (c) => {
  const code = c.req.query('code')
  if (!code)
    return apiError(c, 'VALIDATION_ERROR', 'Missing authorization code')

  const state = c.req.query('state')
  const expectedState = getCookie(c, oauthStateCookieName)
  clearOAuthStateCookie(c)
  if (!state || !expectedState || state !== expectedState) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid OAuth state')
  }

  let ghToken: string
  try {
    ghToken = await exchangeCode({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      code,
      redirectUri: env.GITHUB_CALLBACK_URL,
    })
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'GitHub code exchange failed — try signing in again')
  }
  const ghUser = await fetchGithubUser(ghToken)
  if (!ghUser.email) {
    return apiError(c, 'VALIDATION_ERROR', 'GitHub account has no usable email')
  }

  const { user, conflict } = await upsertGithubUser({
    login: ghUser.login,
    email: ghUser.email,
    githubId: ghUser.githubId,
    avatarUrl: ghUser.avatarUrl,
  })
  if (!user) {
    return apiError(
      c,
      'CONFLICT',
      `Another commma account already uses this GitHub ${conflict}. Sign in with that account, or change it on GitHub and try again.`,
    )
  }

  await db.insert(streaks).values({ userId: user.id }).onConflictDoNothing()

  const cliStateKey = `oauth:cli:state:${state}`
  const cliRedirect = await redis.get(cliStateKey)
  if (cliRedirect) {
    await redis.del(cliStateKey)
    const oneTimeCode = randomBytes(32).toString('base64url')
    await redis.set(
      `oauth:cli:code:${oneTimeCode}`,
      user.id,
      'EX',
      CLI_CODE_TTL_SECONDS,
    )
    const target = new URL(cliRedirect)
    target.searchParams.set('code', oneTimeCode)
    return c.redirect(target.toString())
  }

  const oneTimeCode = randomBytes(32).toString('base64url')
  await redis.set(
    `oauth:cli:code:${oneTimeCode}`,
    user.id,
    'EX',
    CLI_CODE_TTL_SECONDS,
  )
  return c.redirect(`${env.WEB_ORIGIN}/auth/callback?code=${oneTimeCode}`)
})

authRoutes.post(
  '/cli/exchange',
  zValidator('json', z.object({ code: z.string().min(1) }), (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        'VALIDATION_ERROR',
        'Invalid exchange request',
        result.error.issues,
      )
    }
  }),
  async (c) => {
    const { code } = c.req.valid('json')
    const codeKey = `oauth:cli:code:${code}`
    const userId = await redis.get(codeKey)
    if (!userId) return apiError(c, 'UNAUTHORIZED', 'Invalid or expired code')
    await redis.del(codeKey)

    const [user] = await db
      .select({
        id: users.id,
        handle: users.handle,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!user) return apiError(c, 'UNAUTHORIZED', 'User not found')

    const accessToken = await signAccessToken(user.id)
    const refreshToken = await mintRefreshToken(user.id)
    return c.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        handle: user.handle,
        email: user.email,
        avatar_url: user.avatarUrl,
      },
    })
  },
)

authRoutes.post('/refresh', async (c) => {
  const parsed = refreshBodySchema.safeParse(
    await c.req.json().catch(() => null),
  )

  if (parsed.success) {
    const rotated = await rotateRefreshToken(parsed.data.refresh_token)
    if (!rotated)
      return apiError(c, 'UNAUTHORIZED', 'Invalid or expired refresh token')
    const accessToken = await signAccessToken(rotated.userId)
    return c.json({ access_token: accessToken, refresh_token: rotated.raw })
  }

  const token = getCookie(c, refreshCookieName)
  if (!token) return apiError(c, 'UNAUTHORIZED', 'Missing refresh token')
  const rotated = await rotateRefreshToken(token)
  if (!rotated)
    return apiError(c, 'UNAUTHORIZED', 'Invalid or expired refresh token')
  setRefreshCookie(c, rotated.raw)
  const accessToken = await signAccessToken(rotated.userId)
  return c.json({ access_token: accessToken })
})

authRoutes.post('/signout', requireAuth, async (c) => {
  const parsed = refreshBodySchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (parsed.success) await revokeRefreshToken(parsed.data.refresh_token)

  const token = getCookie(c, refreshCookieName)
  if (token) await revokeRefreshToken(token)
  clearRefreshCookie(c)
  return c.body(null, 204)
})
