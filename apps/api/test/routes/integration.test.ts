import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import {
  cleanup,
  closeClients,
  connEnv,
  getDb,
  hasDb,
  loadApp,
  mintToken,
  seedSession,
  seedUser,
} from '../helpers/integration.js'

function heartbeat(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    ts: Date.now(),
    lang: 'typescript',
    file: 'src/secret.ts',
    keystrokes: 5,
    lines: 1,
    key_freq: { a: 3, Enter: 1 },
    ...over,
  }
}

describe.skipIf(!hasDb)('route integration', () => {
  let app: Hono
  const req = (path: string, init?: RequestInit) =>
    app.request(path, init, connEnv)

  beforeAll(async () => {
    app = (await loadApp()) as unknown as Hono
  })

  afterAll(async () => {
    await cleanup()
    await closeClients()
  })

  it('serves health', async () => {
    const res = await req('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })

  it('returns the structured error shape for an unknown route', async () => {
    const res = await req('/v1/does-not-exist')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found', details: [] },
    })
  })

  it('rejects ingest without a bearer token', async () => {
    const res = await req('/v1/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [heartbeat()] }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects an invalid heartbeat batch with VALIDATION_ERROR', async () => {
    const user = await seedUser()
    const token = await mintToken(user.id)
    const res = await req('/v1/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [{ id: 'not-a-uuid', ts: 1 }] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('stores file and key_freq for a full-privacy user', async () => {
    const user = await seedUser({ privacy: 'full' })
    const token = await mintToken(user.id)
    const event = heartbeat()
    const res = await req('/v1/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [event] }),
    })
    expect(res.status).toBe(202)

    const db = await getDb()
    const { events, eq } = await loadDb()
    const [row] = await db.select().from(events).where(eq(events.id, event.id))
    expect(row.file).toBe('src/secret.ts')
    expect(row.keyFreq).toEqual({ a: 3, Enter: 1 })
  })

  it('drops file and key_freq for a summary-privacy user', async () => {
    const user = await seedUser({ privacy: 'summary' })
    const token = await mintToken(user.id)
    const event = heartbeat()
    await req('/v1/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [event] }),
    })

    const db = await getDb()
    const { events, eq } = await loadDb()
    const [row] = await db.select().from(events).where(eq(events.id, event.id))
    expect(row.file).toBeNull()
    expect(row.keyFreq).toBeNull()
    expect(row.keystrokes).toBe(5)
  })

  it('stores nothing for an off-privacy user', async () => {
    const user = await seedUser({ privacy: 'off' })
    const token = await mintToken(user.id)
    const event = heartbeat()
    const res = await req('/v1/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [event] }),
    })
    expect(res.status).toBe(202)

    const db = await getDb()
    const { events, eq } = await loadDb()
    const rows = await db.select().from(events).where(eq(events.id, event.id))
    expect(rows).toHaveLength(0)
  })

  it('suppresses files and heatmap to non-owners of a summary session', async () => {
    const owner = await seedUser({ privacy: 'summary' })
    const session = await seedSession(owner.id, { withHeatmap: true })

    const anon = await req(`/v1/sessions/${session.id}`)
    expect(anon.status).toBe(200)
    const anonBody = (await anon.json()) as {
      files: unknown[]
      keyboard_heatmap: unknown
    }
    expect(anonBody.files).toEqual([])
    expect(anonBody.keyboard_heatmap).toBeNull()

    const token = await mintToken(owner.id)
    const asOwner = await req(`/v1/sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const ownerBody = (await asOwner.json()) as {
      files: unknown[]
      keyboard_heatmap: unknown
    }
    expect(ownerBody.files).not.toEqual([])
    expect(ownerBody.keyboard_heatmap).not.toBeNull()
  })

  it('hides an off-privacy session from anonymous requests', async () => {
    const owner = await seedUser({ privacy: 'off' })
    const session = await seedSession(owner.id)
    const res = await req(`/v1/sessions/${session.id}`)
    expect(res.status).toBe(404)
  })

  it('serves a public heatmap card PNG for a full-privacy session', async () => {
    const owner = await seedUser({ privacy: 'full' })
    const session = await seedSession(owner.id, { withHeatmap: true })

    const res = await req(`/v1/sessions/${session.id}/heatmap-card?aspect=1:1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('public')
    const png = Buffer.from(await res.arrayBuffer())
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })

  it('hides the public heatmap card for a non-full owner', async () => {
    const summaryOwner = await seedUser({ privacy: 'summary' })
    const summarySession = await seedSession(summaryOwner.id, {
      withHeatmap: true,
    })
    const summaryRes = await req(
      `/v1/sessions/${summarySession.id}/heatmap-card`,
    )
    expect(summaryRes.status).toBe(404)

    const offOwner = await seedUser({ privacy: 'off' })
    const offSession = await seedSession(offOwner.id, { withHeatmap: true })
    const offRes = await req(`/v1/sessions/${offSession.id}/heatmap-card`)
    expect(offRes.status).toBe(404)
  })

  it('returns 404 for a public heatmap card with no heatmap data', async () => {
    const owner = await seedUser({ privacy: 'full' })
    const session = await seedSession(owner.id)
    const res = await req(`/v1/sessions/${session.id}/heatmap-card`)
    expect(res.status).toBe(404)
  })

  it('rejects an unsupported public heatmap card aspect', async () => {
    const owner = await seedUser({ privacy: 'full' })
    const session = await seedSession(owner.id, { withHeatmap: true })
    const res = await req(`/v1/sessions/${session.id}/heatmap-card?aspect=4:3`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('404s rather than 500s on a malformed session id', async () => {
    const res = await req('/v1/sessions/not-a-uuid')
    expect(res.status).toBe(404)
  })

  it('404s rather than 500s on a malformed invite id', async () => {
    const user = await seedUser()
    const token = await mintToken(user.id)
    const auth = { Authorization: `Bearer ${token}` }

    const accept = await req('/v1/teams/invites/not-a-uuid/accept', {
      method: 'POST',
      headers: auth,
    })
    expect(accept.status).toBe(404)
    const acceptBody = (await accept.json()) as { error: { code: string } }
    expect(acceptBody.error.code).toBe('NOT_FOUND')

    const decline = await req('/v1/teams/invites/not-a-uuid/decline', {
      method: 'POST',
      headers: auth,
    })
    expect(decline.status).toBe(404)
  })
})

async function loadDb() {
  const { events } = await import('@commma/db')
  const { eq } = await import('drizzle-orm')
  return { events, eq }
}
