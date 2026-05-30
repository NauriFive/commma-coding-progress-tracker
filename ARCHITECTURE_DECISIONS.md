# Architecture Decision Records

Version 1.0 · May 2026

An ADR documents a significant technical decision: what was decided, why, and what was rejected. New ADRs are added as decisions are made. Existing ADRs are never deleted — if a decision is reversed, a new ADR supersedes it and references the old one.

---

## ADR-001: Monorepo with pnpm Workspaces

**Status:** Accepted — 2026-05

### Context

Three distinct deployable artifacts (extension, API, web app) plus two shared packages. We need to share types and schemas without publishing to npm, run parallel dev servers from one command, and keep dependency management tractable.

### Decision

pnpm workspace monorepo at the root with Turborepo for task orchestration.

### Consequences

- Single `pnpm install` installs all packages
- `pnpm dev` starts all services in parallel
- `@commma/shared` and `@commma/db` are importable directly from source — no build step in dev
- TypeScript project references handle cross-package type checking

### Rejected Alternatives

- **Separate repos per package** — cross-package schema changes would require coordinated releases and version bumps
- **Nx** — heavier than needed; pnpm + Turborepo covers the same ground with less config

---

## ADR-002: Hono as the API Framework

**Status:** Accepted — 2026-05

### Context

We need a Node.js HTTP framework. Requirements: excellent TypeScript support, minimal overhead, compatible with edge runtimes for future flexibility.

### Decision

Hono with `@hono/node-server`. Route handlers stay close to the Hono API so migrating to an edge runtime (Cloudflare Workers, Deno Deploy) later would be low-friction.

### Consequences

- Route definitions are concise and type-safe
- Middleware is composable
- No ORM bundled — chosen separately (see ADR-003)
- Edge-compatibility means we avoid Node.js-specific APIs in route handlers

### Rejected Alternatives

- **Fastify** — more complex plugin system; heavier runtime
- **Express** — no native TypeScript types; not edge-compatible; large legacy surface area
- **tRPC** — extension client would need the tRPC client library, adding bundle weight and coupling

---

## ADR-003: Drizzle ORM for Database Access

**Status:** Accepted — 2026-05

### Context

We need type-safe database access for PostgreSQL. Requirements: no code generation at runtime, migrations-first workflow, low overhead, strong TypeScript inference.

### Decision

Drizzle ORM. Schema defined in `packages/db/src/schema.ts`. Migrations generated with `drizzle-kit generate` and applied with `drizzle-kit migrate`.

### Consequences

- Queries are type-safe at compile time with zero runtime overhead
- Migrations are plain SQL files — readable, diffable, auditable
- `@commma/db` exports the schema and a preconfigured db client
- Queries look like SQL, not a custom DSL

### Rejected Alternatives

- **Prisma** — requires a separate client generation step; Prisma Client adds bundle overhead; the query engine is a separate binary
- **Raw SQL with pg** — no type safety without significant boilerplate; hand-maintained type definitions for every query

---

## ADR-004: PostgreSQL JSONB for key_freq and keyboard_heatmap

**Status:** Accepted — 2026-05

### Context

The keyboard heatmap is a variable-length mapping of key labels to counts. The set of keys varies per session. We need to store this efficiently without performing heavy relational operations on it.

### Decision

Store `key_freq` on the events table and `keyboard_heatmap` on the sessions table as PostgreSQL JSONB columns. The aggregation worker merges `key_freq` maps in application code and writes the result to `sessions.keyboard_heatmap`.

### Consequences

- No schema migration needed when the key label set changes
- JSONB supports GIN indexing if we need to query specific key counts later
- Merge logic is simple: `Object.entries(freq).forEach(([k, v]) => merged[k] = (merged[k] ?? 0) + v)`
- Heatmap data is returned inline in the session detail response — no separate join needed

### Rejected Alternatives

- **Separate `key_counts` table (session_id, key_label, count)** — 60+ rows per session; unnecessary relational overhead for data always read as a unit
- **Application-level JSON (not JSONB)** — JSONB gives indexing capability and type validation at the DB level

---

## ADR-005: Canvas API for Client-Side Heatmap Rendering

**Status:** Accepted — 2026-05

### Context

We need to render the keyboard heatmap as a transparent PNG for export. This can be done client-side (browser Canvas) or server-side (Node + image library).

### Decision

Use the browser Canvas API as the primary rendering path. A server-side path using `sharp` is added specifically for Open Graph images.

### Consequences

- Heatmap export is instant — no network round-trip
- Works offline
- `canvas.toBlob('image/png')` produces a transparent PNG ready for download or clipboard
- Two implementations of the same rendering logic must be kept in sync (Canvas + sharp)
- Keyboard layout config must be shared between both renderers — lives in `@commma/shared`

### Rejected Alternatives

- **Server-side only (Puppeteer/headless Chrome)** — expensive, slow, heavy dependency
- **SVG export** — inconsistent transparency handling across social platforms; PNG is universally supported for story/post sharing

---

## ADR-006: Key Label Tracking (No Key Content)

**Status:** Accepted — 2026-05

### Context

The keyboard heatmap requires knowing which keys were pressed. Two approaches:

1. Intercept the `type` command to observe what characters were typed (content)
2. Maintain a counter per keystroke that records only the key label (physical key identity)

### Decision

Track only key labels — the physical key pressed — never key content. The distinction: we count that the `j` key was pressed 142 times, not that the user typed the letter j in any specific word or context.

`contentChanges` in `onDidChangeTextDocument` is never read, stored, or transmitted.

### Consequences

- Users can verify the privacy guarantee by reading the open-source extension code
- The heatmap is slightly less precise than a content-based approach — acceptable trade-off
- **This decision is a permanent privacy guarantee.** It must never be weakened in future versions without a new ADR, a CHANGELOG entry, and a version bump.

### Rejected Alternatives

- **Content-based tracking** — rejected unconditionally. Capturing what was typed would make commma a keylogger regardless of intent. No business justification exists.

---

## ADR-007: Redis Sorted Sets for Leaderboard

**Status:** Accepted — 2026-05

### Context

The leaderboard needs to return top 100 users by coding time for week/month/alltime scopes. This query runs on every leaderboard page load and must be fast.

### Decision

Maintain Redis sorted sets (`ZADD`) updated on every session write. Keys: `leaderboard:week`, `leaderboard:month`, `leaderboard:alltime`. Score is total coding seconds. `ZREVRANGE ... WITHSCORES` returns the top N in O(log N + N) time.

Sorted sets are authoritative for ranking. User handles and metadata are hydrated from PostgreSQL after the Redis read.

### Consequences

- Leaderboard reads are O(log N + 100) regardless of total user count
- Sorted sets are updated inline during session aggregation — no separate job
- If Redis is wiped, the leaderboard is rebuilt from PostgreSQL on next read (cold start path)
- **Rebuild source (important, per ADR-010):** step-4 aggregation **prunes events** after writing sessions, so the cold-start rebuild must sum `sessions.duration_s` grouped by user (and by period for week/month from `sessions.started_at`) — **never** from `events`, which no longer holds the history. Maintenance today is incremental `ZINCRBY` on session write; the rebuild itself is not implemented yet and must land with the `GET /v1/leaderboard` endpoint (Phase 2), or a Redis flush will silently and permanently under-count rankings.

### Rejected Alternatives

- **PostgreSQL aggregate query on every request** — a `SUM(duration_s) GROUP BY user_id` over millions of session rows would be too slow; Redis sorted sets are the right abstraction
- **Materialized views in PostgreSQL** — require a refresh mechanism; don't give O(1) rank lookups

---

## ADR-008: BullMQ for Background Job Queue

**Status:** Superseded by ADR-010 — 2026-05

### Context

Session aggregation is async: ingest returns `202` immediately, then a worker processes events in the background. We need a reliable job queue with retry, dead-letter handling, and observability.

### Decision

BullMQ backed by Redis (same Redis instance as caching in MVP; separate instance at scale). Jobs are enqueued on ingest and deduplicated by `user_id` within a 5-minute window — one aggregation job per user per 5 minutes, not one per ingest call.

### Consequences

- Automatic retry with configurable backoff
- Failed jobs go to a dead-letter queue for inspection
- Redis now serves three purposes: cache, rate limiting, job queue — acceptable for MVP, should be separated at scale
- Bull Board can be added for observability

### Rejected Alternatives

- **pg-boss (PostgreSQL-backed queue)** — eliminates a dependency but adds table-polling overhead to PostgreSQL; we already have Redis for caching
- **Cron-only approach** — fixed 5-minute cron would add up to 5-minute latency to session data appearing in the UI; the queue approach gives near-real-time aggregation

---

## ADR-009: Deployment Infrastructure — EC2 + Railway + Vercel + Upstash

**Status:** Accepted — 2026-05

**Decision:**

| Layer | Provider | Cost |
|-------|----------|------|
| API | AWS EC2 t3.micro + PM2 | $0 free tier (12mo), then $8/mo |
| Redis | Upstash free tier | $0 |
| PostgreSQL | Railway Hobby | $5/mo |
| Web | Vercel Hobby | $0 |
| **Total** | | **~$5/mo** |

**Rationale:** Zero users at launch — no need for load balancers or containers. EC2 t3.micro free tier runs PM2 + Hono/Node with plenty of headroom. Upstash serverless Redis is free at MVP scale. Railway gives zero-config managed Postgres. Vercel handles the frontend with native Vite/React support, PR preview deploys, and a global CDN.

**Migration path:** At 10k DAU or when the free tier expires, migrate API to ECS Fargate + ALB. App code stays identical — only the deploy target changes.

**Rejected:** ECS Fargate at launch — ALB costs $18/mo fixed regardless of traffic. ElastiCache at launch — Upstash free tier is sufficient.

---

## ADR-010: Interval-Based Aggregation (supersedes ADR-008)

**Status:** Accepted — 2026-05 (supersedes ADR-008)

### Context

ADR-008 chose BullMQ for session aggregation. In implementation a cost problem surfaced against the ADR-009 stack: a BullMQ worker **blocking-polls Redis continuously even when idle** (`BRPOPLPUSH`/`BZPOPMIN` loops, scheduler ticks). On the Upstash free tier — billed per command (~500K/month) — a single always-on idle worker would exhaust the budget on polling alone, before processing a single real job. At zero/low users that is pure waste.

### Decision

Replace the BullMQ queue with an **in-process interval scan**. A `setInterval` (5 min) inside the API Node process runs the aggregator: `SELECT DISTINCT user_id FROM events` → per user, fetch events ordered by `ts` → split on the 15-min idle gap → finalize only **closed** sessions (a trailing in-progress group is left for the next tick) → write `sessions` + `session_langs` + `session_files` + `keyboard_heatmap`, update `streaks`, `ZINCRBY` the leaderboard, and **delete** the finalized events, all in one transaction per user. An in-process guard prevents overlapping runs; `RUN_AGGREGATION` env gates the loop so only one instance runs it if ever scaled horizontally.

### Consequences

- **Zero idle Redis commands** — Redis is touched only on session write (a few `ZINCRBY`) and per request (one rate-limit command). Comfortably within the Upstash free tier.
- Finalizing only closed sessions makes re-runs **idempotent** — a session is written exactly once and never rewritten, which also makes deleting its events safe (strong Railway storage discipline).
- No external queue dependency, no separate worker process to deploy (pure backend code; PM2/EC2 setup is unchanged).
- **Lost:** BullMQ's automatic retry, dead-letter queue, and Bull Board observability. Mitigated because failed users are logged and simply retried on the next tick (their events stay in the table until successfully finalized). Acceptable for a single-instance MVP.
- Latency is up to one interval (~5 min) before closed sessions appear — and a session cannot be known to have ended until the 15-min idle gap exists anyway, so this is not a practical regression.

### Rejected Alternatives

- **BullMQ as in ADR-008** — rejected on Upstash command-budget grounds (idle polling), not on correctness.
- **Tuning BullMQ poll intervals** — reduces but does not eliminate idle commands, and adds tuning complexity for no benefit at MVP scale.

### Scale notes & migration path

These are the tweaks this design will need as load grows. None are needed at MVP; they are recorded so they are not rediscovered later.

- **(A) Trigger → queue + dedicated worker.** The interval scan (one `setInterval` in the web process, sequential per user, `SELECT DISTINCT user_id` each tick) caps out as active users grow — the scan widens and per-user work serializes on the request event loop. At the horizontal-scale / ElastiCache tier (where Redis is no longer billed per command, so the ADR-010 cost objection disappears), move aggregation to a separate worker process behind a real queue. This also dissolves the multi-instance duplication risk (today only an in-process guard + `RUN_AGGREGATION` prevent two instances aggregating the same users). **Pre-seamed:** `run.ts` already exposes `aggregateUser(userId)` as a standalone unit and the logic lives in pure modules (`boundaries`/`build`/`streak`), so this swap replaces `scheduler.ts` and enqueues one job per user — `aggregateUser` becomes the job processor unchanged. No work now.
- **(B) Rate-limit client IP behind a proxy.** `ipKey` takes the first `x-forwarded-for` hop. Once an ALB/CloudFront fronts the API (the 10k-DAU tier), that hop is the proxy's view and is spoofable unless the chain is trusted. When the LB lands, trust the correct XFF index / the proxy's real-client header.
- **(C) Leaderboard rebuild source.** Because this step **prunes (deletes) events** after aggregating, the Redis-wipe rebuild promised in ADR-007 must sum from the `sessions` table, not `events`. Fine to mid-scale; at large session volume, rebuild from a periodic user-rollup table rather than scanning all sessions. See ADR-007.

**Not scale issues (do not tweak for scale):** `duration_s` idle inflation (accuracy — fixed by the extension's heartbeat cadence in step 5), event pruning (already the scale win — keeps `events` tiny regardless of history), streak UTC day boundaries (correctness/UX, scale-invariant).

