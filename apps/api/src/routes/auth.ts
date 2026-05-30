import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { streaks, users } from '@commma/db'
import { db } from '../db.js'
import { env } from '../env.js'
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
import { apiError } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { ipKey, rateLimit } from '../middleware/rateLimit.js'
import type { AppEnv } from '../types.js'

export const authRoutes = new Hono<AppEnv>()

authRoutes.use(
  '*',
  rateLimit({ scope: 'auth', limit: 20, windowS: 3600, key: ipKey }),
)

authRoutes.get('/github', (c) => {
  const state = randomBytes(16).toString('base64url')
  setOAuthStateCookie(c, state)
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

  const ghToken = await exchangeCode({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    code,
    redirectUri: env.GITHUB_CALLBACK_URL,
  })
  const ghUser = await fetchGithubUser(ghToken)
  if (!ghUser.email) {
    return apiError(c, 'VALIDATION_ERROR', 'GitHub account has no usable email')
  }

  const [user] = await db
    .insert(users)
    .values({
      handle: ghUser.login,
      email: ghUser.email,
      githubId: ghUser.githubId,
      avatarUrl: ghUser.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.githubId,
      set: {
        handle: ghUser.login,
        email: ghUser.email,
        avatarUrl: ghUser.avatarUrl,
      },
    })
    .returning()

  await db.insert(streaks).values({ userId: user.id }).onConflictDoNothing()

  const accessToken = await signAccessToken(user.id)
  const refreshToken = await mintRefreshToken(user.id)
  setRefreshCookie(c, refreshToken)

  return c.json({
    access_token: accessToken,
    user: {
      id: user.id,
      handle: user.handle,
      email: user.email,
      avatar_url: user.avatarUrl,
    },
  })
})

authRoutes.post('/refresh', async (c) => {
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
  const token = getCookie(c, refreshCookieName)
  if (token) await revokeRefreshToken(token)
  clearRefreshCookie(c)
  return c.body(null, 204)
})
