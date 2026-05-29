# API Reference

Version 1.0 · May 2026

**Base URL (production):** `https://api.commma.dev`  
**Base URL (local dev):** `http://localhost:3000`

All request and response bodies are JSON. All timestamps are ISO 8601 strings unless noted.

---

## Authentication

commma uses JWT bearer tokens with HTTP-only cookie refresh tokens.

```text
Authorization: Bearer <access_token>
```

Access tokens expire in 15 minutes. Use the refresh endpoint to rotate.

---

## Auth Endpoints

### `GET /v1/auth/github`

Redirects the browser to GitHub OAuth. Use from the extension or a browser-based sign-in flow.

**Auth:** None  
**Response:** `302` redirect to GitHub

---

### `GET /v1/auth/github/callback`

Exchanges the GitHub code for a user identity, issues a JWT and sets a refresh token cookie.

**Auth:** None  
**Query params:** `code` — GitHub authorization code

**Response:**

```json
{
  "access_token": "eyJ...",
  "user": {
    "id": "uuid",
    "handle": "yoursquid",
    "email": "user@example.com",
    "avatar_url": "https://avatars.githubusercontent.com/..."
  }
}
```

---

### `POST /v1/auth/refresh`

Rotates the refresh token and issues a new access token. Requires the refresh token HTTP-only cookie.

**Auth:** Refresh cookie  
**Response:**

```json
{ "access_token": "eyJ..." }
```

---

### `POST /v1/auth/signout`

Revokes the refresh token.

**Auth:** JWT  
**Response:** `204 No Content`

---

## User Endpoints

### `GET /v1/me`

Returns the authenticated user's profile.

**Auth:** Required

**Response:**

```json
{
  "id": "uuid",
  "handle": "yoursquid",
  "email": "user@example.com",
  "avatar_url": "...",
  "privacy": "full",
  "created_at": "2026-05-01T10:00:00Z",
  "streak": {
    "current_days": 12,
    "longest_days": 34,
    "last_active_date": "2026-05-27"
  }
}
```

---

### `GET /v1/users/:handle`

Returns a public profile.

**Auth:** None

**Response:**

```json
{
  "handle": "yoursquid",
  "avatar_url": "...",
  "created_at": "2026-05-01T10:00:00Z",
  "streak": { "current_days": 12, "longest_days": 34 },
  "stats": {
    "total_sessions": 142,
    "total_duration_s": 1843200,
    "top_lang": "TypeScript"
  },
  "badges": ["vim-athlete", "mouse-free"]
}
```

---

### `GET /v1/users/:handle/sessions`

Returns a public session list for a user. Paginated.

**Auth:** None  
**Query params:**

- `cursor` — opaque pagination cursor
- `limit` — items per page (default `20`, max `100`)

**Response:**

```json
{
  "sessions": [ ...SessionSummary ],
  "next_cursor": "opaque-string-or-null"
}
```

---

### `POST /v1/users/:handle/follow`

Follow a user.

**Auth:** Required  
**Response:** `204 No Content`

---

### `DELETE /v1/users/:handle/follow`

Unfollow a user.

**Auth:** Required  
**Response:** `204 No Content`

---

## Ingest Endpoint

### `POST /v1/ingest`

Ingests a batch of heartbeat events from the extension.

**Auth:** Required

**Request body:**

```json
{
  "events": [
    {
      "id": "uuid",
      "ts": 1748390400000,
      "lang": "TypeScript",
      "file": "apps/api/src/routes/ingest.ts",
      "project": "commma",
      "keystrokes": 234,
      "lines": 12,
      "key_freq": {
        "j": 14,
        "k": 11,
        "Backspace": 8,
        "Enter": 5
      }
    }
  ]
}
```

**Notes:**

- `file` and `key_freq` are omitted when the user's privacy setting is `summary`
- `id` is used for idempotency — duplicate event IDs are silently dropped
- Maximum 500 events per batch
- All `key_freq` keys must be normalized key labels (see [Key Label Reference](#key-label-reference))

**Response:** `202 Accepted`

```json
{ "received": 1, "duplicate": 0 }
```

**Errors:**

- `400` — Zod validation failed
- `429` — rate limit exceeded (1,000 req/hour per user)

---

## Session Endpoints

### `GET /v1/sessions`

Returns the authenticated user's sessions, paginated.

**Auth:** Required  
**Query params:** `cursor`, `limit` (default `20`, max `100`)

**Response:**

```json
{
  "sessions": [
    {
      "id": "uuid",
      "started_at": "2026-05-26T08:42:00Z",
      "ended_at": "2026-05-26T11:00:00Z",
      "duration_s": 8280,
      "lines_delta": 1247,
      "pace_cpm": 184,
      "top_lang": "TypeScript"
    }
  ],
  "next_cursor": "..."
}
```

---

### `GET /v1/sessions/:id`

Returns full session detail including language breakdown, top files, and keyboard heatmap.

**Auth:** Required (own sessions) or None (public sessions of public users)

**Response:**

```json
{
  "id": "uuid",
  "started_at": "2026-05-26T08:42:00Z",
  "ended_at": "2026-05-26T11:00:00Z",
  "duration_s": 8280,
  "lines_delta": 1247,
  "pace_cpm": 184,
  "peak_cpm": 241,
  "peak_at": "2026-05-26T09:51:00Z",
  "langs": [
    { "lang": "TypeScript", "duration_s": 4320, "pct": 52.2 },
    { "lang": "Python",     "duration_s": 1860, "pct": 22.5 }
  ],
  "files": [
    { "path": "apps/api/src/routes/sessions.ts", "changes": 423 }
  ],
  "keyboard_heatmap": {
    "counts": { "j": 1420, "k": 980, "Backspace": 610 },
    "freq":   { "j": 0.21, "k": 0.14, "Backspace": 0.09 },
    "total":  6844
  }
}
```

---

### `POST /v1/sessions/:id/heatmap-card`

Generates a server-side PNG of the keyboard heatmap card for OG image use.

**Auth:** Required

**Request body:**

```json
{
  "layout":       "qwerty",
  "aspect":       "16:9",
  "show_handle":  true,
  "show_stats":   true
}
```

`layout`: `qwerty` | `dvorak` | `colemak`  
`aspect`: `9:16` | `1:1` | `16:9`

**Response:** `image/png` (binary)

---

## Leaderboard Endpoint

### `GET /v1/leaderboard`

Returns the top 100 users by coding time for the given period.

**Auth:** None  
**Query params:**

- `period` — `week` (default) | `month` | `alltime`
- `lang` — filter by language (e.g. `lang=TypeScript`)

**Response:**

```json
{
  "period": "week",
  "updated_at": "2026-05-26T12:00:00Z",
  "entries": [
    {
      "rank": 1,
      "handle": "falsetto",
      "avatar_url": "...",
      "duration_s": 152284,
      "top_lang": "Rust",
      "streak_days": 87,
      "delta": 0
    }
  ]
}
```

`delta` — rank change since the previous period snapshot (`+N` up, `-N` down, `0` unchanged).

---

## Feed Endpoint

### `GET /v1/feed`

Returns recent sessions from users the authenticated user follows.

**Auth:** Required  
**Query params:** `cursor`, `limit` (default `20`, max `50`)

**Response:**

```json
{
  "entries": [
    {
      "session": { "...SessionSummary": "..." },
      "user": {
        "handle": "lumen.dev",
        "avatar_url": "..."
      }
    }
  ],
  "next_cursor": "..."
}
```

---

## Error Format

All errors follow this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": []
  }
}
```

| Code | HTTP Status | Description |
| ------ | ------------- | ------------- |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `FORBIDDEN` | 403 | Valid JWT but insufficient permissions |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Request body/params failed Zod validation |
| `RATE_LIMITED` | 429 | Per-user rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limits

| Endpoint group | Limit | Window |
| ---------------- | ------- | -------- |
| `POST /v1/ingest` | 1,000 requests | 1 hour (per user) |
| All read endpoints | 300 requests | 1 hour (per user) |
| Auth endpoints | 20 requests | 1 hour (per IP) |

**Rate limit headers:**

```text
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1748394000
```

---

## Key Label Reference

`key_freq` keys must use normalized labels from this set:

| Category | Labels |
| ---------- | -------- |
| Letters | `a`–`z` (lowercase) |
| Digits | `0`–`9` |
| Editing | `Backspace`, `Delete`, `Enter`, `Tab`, `Escape` |
| Modifiers | `Shift`, `Control`, `Alt`, `Meta` |
| Navigation | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown` |
| Function | `F1`–`F12` |
| Other | Anything outside this set — omit or bucket as `Other` |
