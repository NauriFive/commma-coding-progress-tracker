import type { HeartbeatEvent } from '@commma/shared'
import type { Auth } from './auth.js'
import { getApiBaseUrl } from './privacy.js'

const MAX_BATCH = 500
const MAX_BUFFER_EVENTS = 5000

export class IngestClient {
  private buffer: HeartbeatEvent[] = []

  constructor(private readonly auth: Auth) {}

  async send(events: HeartbeatEvent[]): Promise<boolean> {
    const batch = [...this.buffer, ...events]
    this.buffer = []
    if (batch.length === 0) return true

    const token = await this.auth.getAccessToken()
    if (!token) {
      this.retain(batch)
      return false
    }

    let cursor = 0
    while (cursor < batch.length) {
      const chunk = batch.slice(cursor, cursor + MAX_BATCH)
      const ok = await this.post(chunk, token)
      if (!ok) {
        this.retain(batch.slice(cursor))
        return false
      }
      cursor += chunk.length
    }
    return true
  }

  private async post(events: HeartbeatEvent[], token: string): Promise<boolean> {
    let res: Response
    try {
      res = await fetch(`${getApiBaseUrl()}/v1/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ events }),
      })
    } catch {
      return false
    }

    if (res.status === 401) {
      const refreshed = await this.auth.refresh()
      if (!refreshed) return false
      return this.post(events, refreshed)
    }
    return res.ok
  }

  private retain(events: HeartbeatEvent[]): void {
    this.buffer = events.slice(-MAX_BUFFER_EVENTS)
  }
}
