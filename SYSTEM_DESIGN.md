# System Design

Version 1.0 · May 2026

---

## 1. Overview

commma is a three-tier distributed system:

1. **VSCode Extension** — data source; captures editor activity and ships heartbeat batches
2. **API (Hono/Node)** — ingestion, aggregation, query, and auth layer
3. **Web App (React/Vite)** — presentation layer; session detail, leaderboards, profiles, heatmap export

All three tiers communicate over HTTPS/JSON. A shared package (`@commma/shared`) holds Zod schemas enforcing the data contract across the extension→API boundary.

---

## 2. Architecture Diagram

```text
┌─────────────────────────────────────────────────────────┐
│  VSCode Extension (@commma/extension)                   │
│                                                         │
│  onDidChangeTextDocument ──► in-memory buffer           │
│  onDidOpenTextDocument   ──► (HeartbeatEvent[])         │
│  window.onDidChangeActiveTextEditor                     │
│                    │                                    │
│                    │  flush every 60s                   │
│                    ▼                                    │
│            POST /v1/ingest                              │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTPS/JSON  HeartbeatBatch
                    ▼
┌─────────────────────────────────────────────────────────┐
│  API  (@commma/api  —  Hono on Node)                    │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Auth        │  │  Ingest      │  │  Read         │ │
│  │  /v1/auth/*  │  │  /v1/ingest  │  │  /v1/sessions │ │
│  │  JWT + OAuth │  │  202 + async │  │  /v1/leaderbd │ │
│  └──────────────┘  └──────┬───────┘  │  /v1/users    │ │
│                            │          └───────┬───────┘ │
│                            ▼                  │         │
│                     ┌──────────────┐          │         │
│                     │  BullMQ      │          │         │
│                     │  Worker      │          │         │
│                     │  (session    │          │         │
│                     │  aggregation │          │         │
│                     │  + heatmap   │          │         │
│                     │  merge)      │          │         │
│                     └──────┬───────┘          │         │
└────────────────────────────┼──────────────────┼─────────┘
                             │                  │
              ┌──────────────┼──────────────────┼──────────┐
              │  Data Layer  │                  │          │
              │              ▼                  ▼          │
              │  ┌────────────────┐  ┌─────────────────┐  │
              │  │  PostgreSQL    │  │  Redis          │  │
              │  │  - users       │  │  - leaderboard  │  │
              │  │  - events      │  │    sorted sets  │  │
              │  │  - sessions    │  │  - rate limits  │  │
              │  │  - streaks     │  │  - BullMQ queue │  │
              │  │  - follows     │  │  - session cache│  │
              │  └────────────────┘  └─────────────────┘  │
              └─────────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────┐
│  Web App (@commma/web)     │                            │
│                            ▼                            │
│  REST fetch ◄─── GET /v1/sessions, /leaderboard, etc.  │
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │  Canvas API — keyboard heatmap renderer        │    │
│  │  canvas.toBlob('image/png') → transparent PNG  │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow — Ingest Path

```text
Extension
  ├─ collects HeartbeatEvent every keystroke/file-change
  ├─ accumulates in-memory buffer for 60 seconds
  └─ on flush: POST /v1/ingest  { events: HeartbeatEvent[] }

API /v1/ingest
  ├─ validate with Zod (HeartbeatBatch schema)
  ├─ deduplicate by event.id (idempotency)
  ├─ bulk INSERT into events table
  ├─ enqueue aggregation job in BullMQ
  └─ return 202 Accepted

BullMQ Worker (runs every 5 min)
  ├─ SELECT unprocessed events grouped by user_id
  ├─ detect session boundaries (15-min idle gap = new session)
  ├─ for each session:
  │   ├─ sum duration, keystrokes, lines_delta
  │   ├─ merge key_freq maps → keyboard_heatmap JSONB
  │   ├─ group by lang → session_langs rows
  │   ├─ group by file → session_files rows
  │   └─ INSERT/UPSERT into sessions table
  ├─ UPDATE streaks table
  ├─ UPDATE Redis leaderboard sorted set (ZADD)
  └─ mark events as processed
```

---

## 4. Data Flow — Read Path

```text
Browser → GET /v1/sessions?cursor=...
  ├─ verify JWT
  ├─ check Redis cache (TTL 60s)
  │   ├─ HIT → return cached JSON
  │   └─ MISS → SELECT from sessions + session_langs + session_files
  │              → cache result → return JSON
  └─ return paginated SessionList

Browser → GET /v1/leaderboard?period=week
  ├─ ZREVRANGE leaderboard:week 0 99 WITHSCORES from Redis
  │   ├─ HIT → hydrate user handles → return
  │   └─ MISS → SELECT + aggregate from sessions → ZADD → return
  └─ return LeaderboardEntry[]
```

---

## 5. Database Schema

### users

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle        TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  github_id     TEXT NOT NULL UNIQUE,
  avatar_url    TEXT,
  privacy       TEXT NOT NULL DEFAULT 'full',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### events

```sql
CREATE TABLE events (
  id            UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id),
  ts            TIMESTAMPTZ NOT NULL,
  lang          TEXT,
  file          TEXT,
  project       TEXT,
  keystrokes    INT NOT NULL DEFAULT 0,
  lines         INT NOT NULL DEFAULT 0,
  key_freq      JSONB,
  processed     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

CREATE INDEX events_user_unprocessed ON events(user_id, ts) WHERE processed = false;
```

### sessions

```sql
CREATE TABLE sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ NOT NULL,
  duration_s        INT NOT NULL,
  lines_delta       INT NOT NULL DEFAULT 0,
  pace_cpm          INT,
  peak_cpm          INT,
  peak_at           TIMESTAMPTZ,
  keyboard_heatmap  JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_started ON sessions(user_id, started_at DESC);
```

### session_langs

```sql
CREATE TABLE session_langs (
  session_id  UUID NOT NULL REFERENCES sessions(id),
  lang        TEXT NOT NULL,
  duration_s  INT NOT NULL,
  pct         NUMERIC(5,2) NOT NULL,
  PRIMARY KEY (session_id, lang)
);
```

### session_files

```sql
CREATE TABLE session_files (
  session_id  UUID NOT NULL REFERENCES sessions(id),
  path        TEXT NOT NULL,
  changes     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, path)
);
```

### streaks

```sql
CREATE TABLE streaks (
  user_id           UUID PRIMARY KEY REFERENCES users(id),
  current_days      INT NOT NULL DEFAULT 0,
  longest_days      INT NOT NULL DEFAULT 0,
  last_active_date  DATE
);
```

### follows

```sql
CREATE TABLE follows (
  follower_id   UUID NOT NULL REFERENCES users(id),
  followee_id   UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX follows_followee ON follows(followee_id);
```

---

## 6. API Route Map

| Method | Path | Auth | Description |
| -------- | ------ | ------ | ------------- |
| GET | /v1/auth/github | None | Redirect to GitHub OAuth |
| GET | /v1/auth/github/callback | None | Exchange code → JWT + refresh |
| POST | /v1/auth/refresh | Refresh cookie | Rotate refresh token |
| POST | /v1/auth/signout | JWT | Revoke refresh token |
| GET | /v1/me | JWT | Authenticated user profile |
| POST | /v1/ingest | JWT | Ingest HeartbeatBatch |
| GET | /v1/sessions | JWT | Paginated session list (self) |
| GET | /v1/sessions/:id | JWT | Session detail + heatmap |
| POST | /v1/sessions/:id/heatmap-card | JWT | Server-side PNG for OG image |
| GET | /v1/users/:handle | None | Public profile |
| GET | /v1/users/:handle/sessions | None | Public session list |
| POST | /v1/users/:handle/follow | JWT | Follow a user |
| DELETE | /v1/users/:handle/follow | JWT | Unfollow a user |
| GET | /v1/leaderboard | None | Leaderboard |
| GET | /v1/feed | JWT | Activity feed |

---

## 7. Caching Strategy

| Data | Store | TTL | Invalidation |
| ------ | ------- | ----- | -------------- |
| Leaderboard (week) | Redis sorted set | 10 min | ZADD on session write |
| Leaderboard (month, alltime) | Redis sorted set | 1 hour | ZADD on session write |
| Session list (per user) | Redis string (JSON) | 60 sec | DEL on session write |
| Public profile stats | Redis string (JSON) | 5 min | DEL on session write |
| Rate limit counters | Redis sliding window | 1 hour | Natural expiry |

---

## 8. Background Jobs

### Session Aggregation Worker

- **Trigger:** BullMQ job enqueued on every ingest, deduplicated per user per 5-min window
- **Logic:** fetch unprocessed events → boundary detection → merge → upsert sessions → update streaks → ZADD leaderboard → mark events processed
- **Failure:** retried up to 3 times with exponential backoff; dead-letter queue for inspection

### Streak Maintenance Job

- **Trigger:** cron at 00:05 UTC daily
- **Logic:** users with `last_active_date < yesterday` → reset `current_days` to 0

### Weekly Recap Email Job

- **Trigger:** cron every Sunday 09:00 UTC
- **Logic:** compile stats for users with sessions in past 7 days → send via Resend/Postmark

---

## 9. Extension File Structure

```text
src/
  extension.ts    — activate/deactivate; registers commands + listeners
  tracker.ts      — activity tracker; buffer management; heartbeat flush
  auth.ts         — GitHub OAuth flow; SecretStorage token management
  client.ts       — HTTP client; offline queue; retry logic
  keyCounter.ts   — key-label frequency accumulator (no key content)
  statusBar.ts    — VSCode status bar item (connection state)
  privacy.ts      — reads commma.privacy setting; filters payload
```

---

## 10. Scalability Plan

- **MVP:** EC2 t3.micro free tier · Upstash Redis free · Railway $5/mo · Vercel free = ~$5/mo
- **1k DAU:** Same stack
- **5k DAU:** Upgrade to t3.small, add Railway read replica
- **10k DAU:** Migrate to ECS Fargate + ALB, move Redis to ElastiCache
- **50k DAU:** ECS auto-scaling, CloudFront, separate ingest/read services

### Deployment Secrets (GitHub Actions)

The EC2 instance is not provisioned yet, so the `deploy-api` workflow (`.github/workflows/deploy-api.yml`) is **manual-only** (`workflow_dispatch`). Once EC2 is live, switch its trigger back to `push` on `main` and set these repository secrets under **Settings → Secrets and variables → Actions**:

- `EC2_HOST` — public IP or domain of the EC2 instance
- `EC2_SSH_KEY` — contents of the `.pem` private key file

---

## 11. Security Boundaries

- **Extension → API:** HTTPS only; JWT in Authorization header
- **API → DB:** private network; no public DB port
- **API → Redis:** private network; AUTH password required
- **Web → API:** CORS restricted to `commma.dev`; CSRF not applicable (JWT not in cookies for web)
- **Refresh token:** HTTP-only cookie; `SameSite=Strict`; `Secure`; `Path=/v1/auth`
