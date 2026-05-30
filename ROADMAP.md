# Roadmap

Version 1.0 · May 2026

Items move from Planned → In Progress → Done as work proceeds. The roadmap is
not date-locked beyond the current phase so it can flex with contributor
availability.

Current phase: Phase 1 — Foundation

---

## Phase 1 — Foundation (Weeks 1–2)

Goal: working ingest pipeline end-to-end.

### In Progress

- [x] PostgreSQL schema migration (users, events, sessions, streaks, follows)
- [x] GitHub OAuth flow (API ↔ GitHub)
- [x] JWT issuance and middleware
- [x] VSCode extension: SecretStorage token management (loopback one-time-code auth, ADR-011)
- [x] VSCode extension: `commma: Sign In` command (+ `Sign Out`)

### Planned

- [x] `POST /v1/ingest` with Zod validation and idempotency
- [x] Interval aggregator (ADR-010, not BullMQ): session boundary detection and aggregation
- [x] Aggregator: `keyboard_heatmap` merge from `key_freq` events
- [x] Aggregator: streak update
- [x] Leaderboard sorted-set maintenance (`ZINCRBY` on session write; read endpoint is Phase 2)
- [x] Redis fixed-window rate limiting (ingest/read/auth tiers, `429` + `X-RateLimit-*`) — built early; ROADMAP-listed in Phase 3
- [x] `GET /v1/sessions` (basic list)
- [x] Extension heartbeat flush (60s interval; simple in-memory retry — persistent offline queue w/ backoff is Phase 3)

**Definition of Done:**

- GitHub OAuth works from VSCode.
- Extension ships a real heartbeat with `key_freq`.
- API writes to DB; worker creates session row with `keyboard_heatmap` populated.
- `tsc --noEmit` passes everywhere.

---

## Phase 2 — Core Product (Weeks 3–4)

Goal: something a real user can experience end-to-end.

### Planned

- [ ] `GET /v1/sessions/:id` with lang breakdown, files, and heatmap data
- [ ] Session detail page in web app (chart, lang breakdown, file list)
- [ ] Keyboard heatmap Canvas renderer component
- [ ] PNG export (9:16, 1:1, 16:9 presets, transparent background)
- [ ] Streak calculation cron job
- [ ] Profile page at `/@handle` (live data)
- [x] Redis leaderboard sorted set (incremental `ZINCRBY` on session write — done in step 4)
- [ ] `GET /v1/leaderboard` endpoint — **must include the cold-start rebuild summing `sessions.duration_s` (events are pruned, so rebuild from `sessions`, never `events`); see ADR-007/ADR-010**
- [ ] Follow/unfollow API
- [ ] `GET /v1/feed` endpoint
- [ ] Leaderboard page in web app
- [ ] Feed page with miniature heatmap thumbnails

**Definition of Done:**

- Visit a session page, see real heatmap, export a transparent PNG.
- Visit `/@handle`, see real data and streak; leaderboard shows real data.
- p95 latency `<200ms` at 100 concurrent users.

---

## Phase 3 — Hardening (Weeks 5–6)

Goal: production-safe. No known P0/P1 bugs. Published extension.

### Planned

- [x] Redis rate limiter middleware (built early in step 4) — **follow-up: trust the correct `x-forwarded-for` hop once an ALB/CloudFront fronts the API; see ADR-010 (B)**
- [ ] Privacy mode: `key_freq` and file paths suppressed when `privacy = summary`
- [ ] Extension offline queue with exponential backoff retry
- [ ] Structured error responses across all endpoints
- [ ] Input validation hardening (edge cases, large payloads)
- [ ] `POST /v1/sessions/:id/heatmap-card` (server-side `sharp` PNG for OG images)
- [ ] Open Graph meta tags on public session and profile URLs
- [ ] Replace all mocked landing page data with live API
- [ ] Extension published to VSCode Marketplace (unlisted)
- [ ] `CONTRIBUTING.md`, `ONBOARDING.md`, `SECURITY.md` complete
- [ ] `good-first-issue` label sweep
- [ ] Load test: k6 at 1,000 concurrent users, p95 <150ms
- [ ] GitHub repo made public

**Definition of Done:**

- Rate limiting enforced; privacy=summary sends no file paths or `key_freq`.
- Extension on marketplace; load test passes.
- Repo public with complete docs.

---

## Phase 4 — Scale & Community (Weeks 7–10)

Goal: growth mechanics live. First external contributors merged.

### Planned

- [ ] Weekly recap email: session count, best session, streak, top lang
- [ ] Style badges: Vim athlete, Mouse-free, Backspace heavy, Arrow navigator
- [ ] Badge display on profile page
- [ ] Team model: create team, invite members, team role
- [ ] Private team leaderboard
- [ ] Team aggregate heatmap visualization
- [ ] Dvorak keyboard layout config
- [ ] Colemak keyboard layout config
- [ ] Contributor onboarding: Dockerfile for dev environment
- [ ] First 3 external PR merges
- [ ] Public launch: Product Hunt, social posts
- [ ] Remove early-access gate

**Definition of Done:**

- Style badges visible on profiles; team leaderboards functional.
- ≥3 external PRs merged.
- 200 GitHub stars within 72 hours of launch.

---

## Phase 5 — Growth (Weeks 11–16)

Goal: mobile, multi-editor, self-hosted.

### Planned

- [ ] Full mobile layout audit and fixes
- [ ] PWA manifest
- [ ] Push notifications for streak reminders
- [ ] Heatmap export on mobile (touch-friendly)
- [ ] JetBrains plugin scaffold (community-contributed)
- [ ] Neovim Lua plugin scaffold (community-contributed)
- [ ] Standalone CLI client (`commma login` / `commma watch`) as a headless data source — **auth is already unblocked by ADR-011** (the loopback one-time-code flow + `POST /v1/auth/cli/exchange` were built CLI-first in step 5; a CLI just reuses them). Sessions stay server-derived, so no manual "start session" command — same passive model as the extension.
- [ ] Third-party client event schema documentation (including `key_freq` spec)
- [ ] `docker-compose.yml` for full self-hosted stack
- [ ] Helm chart scaffold for Kubernetes
- [ ] Lighthouse mobile score ≥90

---

## Icebox

Ideas worth tracking but not scheduled. Open a GitHub Discussion before
picking one up.

- Commit correlation — link sessions to git commits (user opt-in)
- Project-scoped leaderboards — compete within a repo/org
- API access tokens — personal access tokens for third-party integrations
- Embed widgets — embeddable streak badge and heatmap card for READMEs
- Language achievement system — milestones per language (100h TypeScript, etc.)
- Cohort leaderboards — compete only against users who joined in the same month
- Custom heatmap themes — user-selectable color gradients for exported cards
- Browser extension — track time in browser-based editors (GitHub Codespaces, etc.)

---

## How to Influence the Roadmap

1. Open a GitHub Issue with the label `roadmap-proposal`
2. Describe the problem it solves, who it helps, and rough implementation complexity
3. Maintainers will discuss and schedule or icebox it within 2 weeks

Roadmap decisions are made in the open. No private backlog.
