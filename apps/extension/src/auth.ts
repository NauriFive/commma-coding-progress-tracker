import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as vscode from 'vscode'
import { getApiBaseUrl } from './privacy.js'

const REFRESH_SECRET_KEY = 'commma.refreshToken'
const ACCESS_TTL_MS = 14 * 60 * 1000
const ACCESS_SKEW_MS = 60 * 1000
const LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000

interface ExchangeResponse {
  access_token: string
  refresh_token: string
}

interface RefreshResponse {
  access_token: string
  refresh_token?: string
}

export class Auth {
  private accessToken: string | null = null
  private accessExpiresAt = 0

  constructor(private readonly context: vscode.ExtensionContext) {}

  async isSignedIn(): Promise<boolean> {
    return (await this.context.secrets.get(REFRESH_SECRET_KEY)) !== undefined
  }

  async signIn(): Promise<boolean> {
    const apiBaseUrl = getApiBaseUrl()
    const code = await this.runLoopbackFlow(apiBaseUrl)
    if (!code) return false

    const res = await fetch(`${apiBaseUrl}/v1/auth/cli/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) throw new Error(`exchange_failed_${res.status}`)

    const data = (await res.json()) as ExchangeResponse
    await this.context.secrets.store(REFRESH_SECRET_KEY, data.refresh_token)
    this.setAccess(data.access_token)
    return true
  }

  async getAccessToken(): Promise<string | null> {
    if (
      this.accessToken &&
      Date.now() < this.accessExpiresAt - ACCESS_SKEW_MS
    ) {
      return this.accessToken
    }
    return this.refresh()
  }

  async refresh(): Promise<string | null> {
    const refreshToken = await this.context.secrets.get(REFRESH_SECRET_KEY)
    if (!refreshToken) return null

    let res: Response
    try {
      res = await fetch(`${getApiBaseUrl()}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    } catch {
      return null
    }

    if (res.status === 401) {
      await this.context.secrets.delete(REFRESH_SECRET_KEY)
      this.accessToken = null
      this.accessExpiresAt = 0
      return null
    }
    if (!res.ok) return null

    const data = (await res.json()) as RefreshResponse
    if (data.refresh_token) {
      await this.context.secrets.store(REFRESH_SECRET_KEY, data.refresh_token)
    }
    this.setAccess(data.access_token)
    return data.access_token
  }

  async signOut(): Promise<void> {
    const apiBaseUrl = getApiBaseUrl()
    const accessToken = await this.getAccessToken()
    const refreshToken = await this.context.secrets.get(REFRESH_SECRET_KEY)
    if (refreshToken && accessToken) {
      try {
        await fetch(`${apiBaseUrl}/v1/auth/signout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
      } catch {
        void 0
      }
    }
    await this.context.secrets.delete(REFRESH_SECRET_KEY)
    this.accessToken = null
    this.accessExpiresAt = 0
  }

  private setAccess(token: string): void {
    this.accessToken = token
    this.accessExpiresAt = Date.now() + ACCESS_TTL_MS
  }

  private runLoopbackFlow(apiBaseUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        server.close()
        resolve(value)
      }

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const code = url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        if (!code) {
          res.end('<html><body>commma sign-in failed. You can close this tab.</body></html>')
          finish(null)
          return
        }
        res.end('<html><body>commma is connected. You can close this tab.</body></html>')
        finish(code)
      })

      const timer = setTimeout(() => finish(null), LOOPBACK_TIMEOUT_MS)
      server.on('error', () => finish(null))

      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo
        const authUrl = new URL(`${apiBaseUrl}/v1/auth/github`)
        authUrl.searchParams.set(
          'redirect_uri',
          `http://127.0.0.1:${port}/callback`,
        )
        void vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()))
      })
    })
  }
}
