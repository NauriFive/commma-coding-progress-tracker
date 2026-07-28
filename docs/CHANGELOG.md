# Changelog

All notable, cross-cutting changes to commma are recorded here. Per-package
versions live in each `package.json`; this file tracks product-level changes and
any change that touches a privacy guarantee (ADR-006 requires a CHANGELOG
entry).

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **API** — Load-test harness (`apps/api/scripts/loadtest/`, run via the
  `loadtest:*` package scripts). Seeds tagged `loadtest-*` users, signs a JWT
  per user, and drives the real ingest → aggregate → read pipeline with ramping
  concurrency to find the saturation knee, then tears everything down
  (prefix-scoped row delete + Redis leaderboard cleanup). Round-robins all user
  tokens so per-user rate caps don't mask the server limit; a `prod` target
  sources creds from the gitignored `.env.production`, caps request volume under
  the Upstash/Neon free-tier budgets, and requires `--confirm` to delete. Closes
  the pre-launch load-test gate (backend audit check 11); results — including
  the first prod-sized run and the `DB_POOL_MAX` before/after — are recorded in
  `docs/METRICS.md`.
- **API, Web** — Account deletion. A new `DELETE /v1/me` (auth + write
  rate-limit bucket) permanently erases the caller's account and every row tied
  to it — sessions and their language/file breakdowns, raw events, streaks,
  refresh tokens, push subscriptions, recap-email records, follows in both
  directions, team memberships and invites (sent and received), and any teams
  the user owns (with their members and invites) — all inside a single
  transaction so a partial delete can't leave orphaned rows. A best-effort
  Stripe subscription cancel runs first (when billing is configured), and the
  user is removed from the current Redis leaderboard sets afterward. The web
  Edit-profile page gains a "Danger zone" with a two-step confirmation (Continue
  → Permanently delete) that signs the user out and returns home on success.
- **DB** — Indexed `teams.owner_id` and `team_invites.invited_by` (migration
  `0011_account_indexes`). Both columns are filtered on hot paths — the
  team-create owned-count check, and the account-deletion cascade — but were
  previously unindexed, forcing sequential scans. Append-only; apply with
  `drizzle-kit migrate`.
- **CLI** — New `@commma/cli` headless data source (`apps/cli`), so coding
  activity can be tracked from any editor that writes files to disk (Neovim,
  Emacs, Helix, JetBrains) without a dedicated plugin. Commands: `commma login`
  / `logout` / `watch [dir]` / `status`. `login` reuses the ADR-011 loopback
  OAuth one-time-code flow and `POST /v1/auth/cli/exchange` built CLI-first for
  the extension; the refresh token is stored in `~/.commma/credentials.json` at
  `0600`. `watch` runs a dependency-free polling file watcher that derives
  per-file keystroke and line deltas from byte changes and flushes a
  `HeartbeatEvent[]` batch every 60s, reusing the extension's offline-buffer +
  backoff ingest client. Sessions stay server-derived — no manual start/stop.
  **Privacy (ADR-006):** the same `full`/`summary`/`off` modes apply, and
  because the CLI observes the filesystem rather than keypresses it **never
  sends the `key_freq` keyboard-heatmap field**; file content is read only to
  count characters and lines, never stored or transmitted. Keystroke counts are
  an approximation from file deltas — the editor extension remains the precise
  heatmap source.

- **Infra** — CloudWatch host monitoring for the API box
  (`infra/terraform/cloudwatch.tf`). An EC2 instance profile +
  `CloudWatchAgentServerPolicy` lets the **CloudWatch Agent** (installed and
  started by `infra/provision-ec2.sh` from `infra/cloudwatch-agent-config.json`)
  publish memory, disk, and swap under the `CWAgent` namespace. Five alarms
  route to a `commma-alerts` SNS email topic: EC2 status-check, high CPU, high
  memory, root-disk fill, and a Route 53 HTTPS health check on
  `api.commma.dev/health`. This is the **infra layer only** — CloudWatch cannot
  see Neon (Postgres) or Upstash (Redis), so application SLOs (ingest/read p95,
  error rate, aggregation lag) ship to Grafana Cloud instead (see the
  observability entry below; `docs/OBSERVABILITY.md`).

- **Infra** — Self-healing, backups, and keyless access for the API box
  (`infra/terraform/cloudwatch.tf`, `dlm.tf`). Two CloudWatch alarms now **act**
  instead of only paging: `StatusCheckFailed_System` fires the EC2 `recover`
  action (rehost on healthy hardware, same id/EIP/EBS) and
  `StatusCheckFailed_Instance` fires `reboot`. A Data Lifecycle Manager policy
  snapshots the root volume daily (07:00 UTC, 7-day retention) as the restore
  path for the box's only non-reproducible state (`apps/api/.env`). The instance
  role gains `AmazonSSMManagedInstanceCore` for keyless, audited **SSM Session
  Manager** access; port 22 stays open for the SSH-based CI deploy. Applied via
  local `terraform apply`.

- **API, Infra** — Level 1 app-SLO observability via Grafana Cloud
  (`docs/OBSERVABILITY.md`, ADR-015). The API emits structured logs — a
  per-request `request` line (`method`/`path`/`status`/`ms`, replacing the Hono
  string logger) and a per-cycle `aggregation_cycle` line (`maxLagMs` + counts +
  `durationMs`, doubling as a scheduler heartbeat). **Grafana Alloy**
  (`infra/alloy/config.alloy`, provisioned by `infra/provision-ec2.sh`) tails
  the PM2 logs and ships them to **Grafana Cloud Loki** with low-cardinality
  labels; the SLOs (ingest/read p95, 5xx rate, ingest success, aggregation lag)
  are derived with LogQL on an importable dashboard
  (`infra/grafana/dashboards/api-slo.json`). Logs-first by design —
  OpenTelemetry traces are the deferred Level 2 on the same backend.

### Changed

- **API** — `DB_POOL_MAX` default raised from 10 to 25 (`apps/api/src/env.ts`),
  kept as headroom. A controlled load test (laptop API → cross-internet prod
  Neon) showed the connection pool _can_ bottleneck ingest under high DB
  latency: pool 10→25 gave ~67→153 rps (+128%) in that regime. **Re-running
  against the real co-located prod box (t4g.small + Neon in `us-east-1`) showed
  ~95 rps at both pool=10 and pool=25 — no change** — so the pool is not the
  production bottleneck (the ~95 rps was later found to be a single-client
  upload-bandwidth limit, not a server ceiling — see the ingest entry below).
  The bump is harmless headroom, not a measured prod throughput win; the live
  box `.env` was set to 25 and restarted. Details in `docs/METRICS.md`.
- **API** — Ingest hot-path optimizations. The per-request `users.privacy`
  lookup — a ~42 ms Postgres round-trip on every ingest, for a value that rarely
  changes — is now served from a Redis cache (`priv:v1:<id>`, 60 s TTL,
  invalidated on privacy change and account deletion, fail-open to Postgres),
  dropping it to ~13 ms p50 while keeping the ADR-006 privacy modes exact (a
  downgrade still takes effect immediately). `enableAutoPipelining` batches the
  per-request rate-limit Redis evals, and a new `ingest_db` log records
  per-stage lookup/insert timing. Details in `docs/METRICS.md`.
- **Web** — The About-page brand film is now a 19-second launch cut. It keeps
  the keyboard-heatmap flood and session-stats beats, adds a terminal sequence
  that shows the CLI (`commma login` → `commma watch` → a live flush line), and
  carries a cinematic voiceover synthesized with **ElevenLabs** neural
  text-to-speech. The film autoplays muted in view, pauses off-screen, and
  exposes a corner speaker button to enable the narration; reduced-motion still
  falls back to native controls. The animation source lives in
  `assets/video/commma-launch.html`, with vertical and landscape masters (1080p
  and 4K) under `assets/video/`. The original `commma-intro` masters are
  retained.

### Fixed

- **API** — GitHub sign-in no longer fails with a generic 500 when the account's
  GitHub email or username is already attached to another commma account. The
  callback upserts on `github_id`, so a colliding `users_email_unique` /
  `users_handle_unique` row raised an unhandled driver error — reachable when
  one person has two GitHub accounts sharing an email, or when a username is
  renamed or recycled. A returning user now signs in normally and simply keeps
  their existing handle/email (the conflicting field is skipped and logged); a
  brand-new account that would collide gets a `409 CONFLICT` naming the field
  instead of a crash.
- **API** — `POST /v1/teams/invites/:id/accept` and `/decline` returned
  `500 INTERNAL_ERROR` for any `:id` that is not a UUID, because the value went
  straight into a `uuid` column comparison. Both now return `404 NOT_FOUND`. The
  UUID guard already used by the session routes moved to a shared `lib/uuid.ts`
  helper.
- **API** — The shareable heatmap card could `500` on both the authed and public
  `:id/heatmap-card` routes. Card text embeds the session's top language, which
  arrives from a client as an arbitrary `lang` string; a control character in it
  produced XML the SVG rasterizer refuses to parse. `xmlEscape` now strips
  characters XML 1.0 cannot represent.
- **API** — The push-reminder scheduler could silently skip a day. It ticked
  once an hour and only acted when the tick landed in `PUSH_REMINDER_HOUR_UTC`,
  so accumulated `setInterval` drift could step over that hour entirely and send
  nothing, with no error. It now ticks every five minutes and takes a leader
  lock scoped to the target date and hour, so the window can't be missed and the
  reminder still sends exactly once per day.

## [1.0.0] — 2026-06-19

### Added

- **API, Web** — Real-time status page. A new public `GET /v1/status` probes the
  database (`SELECT 1`) and Redis (`PING`) and returns per-dependency health
  (`{ api, db, cache, ts }`); it is IP-rate-limited on the read bucket and the
  probe result is cached in Redis for ~15s so a traffic spike cannot hammer Neon
  or Upstash. The `/status` page now fetches it live and polls every 45s, with a
  loading skeleton, a "service degraded" state when a dependency is down, and an
  "API unreachable" state when the fetch fails — replacing the hand-written "all
  operational" list. The granular per-feature rows were collapsed to the
  genuinely independent components (API process, database, cache) since the API
  is a single process.
- **Extension** — The commma extension is published to two registries as
  `commma.commma` (v1.0.0): the Visual Studio Marketplace (for VS Code) and the
  Open VSX registry (for Cursor, Windsurf, VSCodium, and Gitpod, which do not
  use the Microsoft Marketplace). Built from `apps/extension` (esbuild CommonJS
  bundle, packaged with `vsce package --no-dependencies`), it captures key-label
  frequency, active file/language, keystrokes, and lines — never file content
  (ADR-006) — and flushes a `HeartbeatEvent` batch to the API every 60s.
  Publish-prep: the workspace package was renamed `@commma/extension` → `commma`
  and the monorepo root → `commma-monorepo` (Marketplace names cannot be
  scoped); the `commma.apiBaseUrl` default was corrected from
  `http://localhost:3000` to `https://api.commma.dev` so a fresh install reaches
  production; added an icon, README (the Marketplace listing), bundled LICENSE,
  and `publisher`/`repository` metadata. Dual-publish tooling: added `ovsx` plus
  `publish:openvsx` and `publish:all` scripts to the extension package.
- **Web** — Install call-to-action overhaul for the extension launch, then a
  dedicated multi-marketplace install page. Every "get notified at launch" /
  "join the waitlist" button — the landing hero, the top navigation, both
  pricing free-tier cards, the final landing CTA, and the empty state on your
  own profile — now routes to a new `/install` page (`INSTALL_PATH` in
  `lib/config`) instead of assuming VS Code and deep-linking the Marketplace.
  The install page separates the two distribution channels: VS Code via the
  Visual Studio Marketplace, and Cursor / Windsurf / VSCodium / Gitpod via Open
  VSX, each with a one-line `code`/`cursor --install-extension` command and a
  copy button, plus post-install steps. `lib/config` now exports
  `VSCODE_MARKETPLACE_URL`, `OPEN_VSX_URL`, `EXTENSION_ID`, and `INSTALL_PATH`
  (replacing the single `EXTENSION_URL`); `RootLayout` gained hash-anchor
  scrolling so the page's "get notified" link reaches the landing waitlist
  (`/#install`). The status page lists both registries. The landing
  launch-notify section (`#waitlist` → `#install`) became a "get started"
  install section, and its email capture is repurposed to notify subscribers
  when the JetBrains, Neovim, and CLI clients ship. Privacy and API-reference
  copy was updated to match (the email list is now "product updates", not an
  "early-access waitlist"). The web `LATEST_VERSION` is now `1.0.0`.
- **Web** — Client-side data caching with TanStack Query (see ADR-014). Every
  server read now flows through a centralized query layer (`lib/queries.ts`
  factories, `lib/queryClient.ts` client) instead of per-page
  `useEffect`/`useState` fetches: Profile, Leaderboard, SessionDetail, Feed,
  Recap, Teams, TeamDashboard, and the landing activity widgets. Revisiting a
  page within the 60s `staleTime` serves cached data with no network call, and a
  `localStorage` persister (`PersistQueryClientProvider`) hydrates public pages
  instantly across a hard refresh, then revalidates in the background. Only
  public queries are persisted — auth-scoped reads (feed, recap, teams, status)
  are tagged `meta.persist:false` and excluded, and the cache is cleared on
  sign-in/sign-out so one user's data never reaches another. Pagination uses
  `useInfiniteQuery`; period switches use `keepPreviousData`; team mutations
  invalidate `['teams']`/`['team', slug]`. The status page stays on its own
  poller (it always wants a fresh probe). Adds ~13 KB gzip to the main bundle.
- **Infra** — Search Console & search indexing. Verified `commma.dev` domain
  ownership in Google Search Console with an apex `TXT` record
  (`google-site-verification=…`) added to Route53 as code
  (`aws_route53_record.google_site_verification` in
  `infra/terraform/route53.tf`, applied locally under the `commma-admin` profile
  — a clean `1 to add` plan, no other drift). Submitted the public `sitemap.xml`
  (already referenced by `robots.txt`, covering the marketing and discovery
  routes plus the `docs.commma.dev` pages) so search engines crawl and index the
  site. Domain-property verification covers every subdomain in one shot.
- **Infra** — Continuous delivery across two pipelines. CI/CD runs on **GitHub
  Actions** (`.github/workflows/`) as the active pipeline: `ci.yml` runs
  `lint`/`typecheck`/`test`/markdown-lint on every push and pull request, and
  `deploy-web.yml`/`deploy-api.yml` auto-deploy on `main`, path-filtered so the
  web ships only on `apps/web`/`packages/shared` changes and the API only on
  `apps/api`/`packages/db`/`packages/shared` changes, `concurrency`-serialized
  so deploys never overlap (web via an OIDC role to S3 + CloudFront, API via SSH
  to the EC2 box). A second pipeline on **GitLab** (`.gitlab-ci.yml`) runs the
  same `lint`/`typecheck`/`test` gate as a **passive backup** — its deploy jobs
  are removed so the dual-push to GitHub and GitLab can never double-deploy. The
  EC2 security group's SSH port was opened to allow hosted CI runners (the box
  is key-only, so this is safe).
- **Web, Infra** — Documentation site at `docs.commma.dev`. A new `/docs`
  section renders curated public docs (overview, getting started, architecture,
  system design, self-hosting) with `react-markdown` through a design-token
  `Prose` renderer and a sidebar layout; it links out to the existing API
  reference and changelog. The docs are served on the `docs.commma.dev`
  subdomain off the **same** CloudFront distribution and S3 bucket — the SPA
  detects the `docs.` host and serves clean URLs (e.g.
  `docs.commma.dev/getting-started`), `commma.dev/docs` redirects there, and the
  docs nav gains a "← commma.dev" button back to the app. Infra adds
  `docs.commma.dev` as a subject alternative name on the web TLS certificate, a
  CloudFront alias, and Route53 alias records (existing distribution, no new
  bucket). Repository reference docs moved under `docs/`.
- **Web** — Pricing early-access section and a calmer landing hero. The pricing
  page gains a section above the tiers spelling out that the free plan currently
  includes the entire product during early access (full history, heatmap PNG
  export, weekly recap, team workspaces), so the $0 column does not read as
  bare; the Pro and Team tiers stay visible as the roadmap. Removed two
  landing-hero motion effects — the cursor-following light glow and the sweeping
  scan line over the keyboard — for a quieter first screen. The `/changelog` and
  `/api` pages were updated to match (early-access notes on the recap, teams,
  and billing endpoints). Site copy was swept for the free launch: the landing
  email signup is reframed from an invite waitlist to a launch-notify list, the
  landing and status pages drop the "invite-only" framing, the final CTA starts
  you free instead of linking to pricing, and the Teams at-limit notice no
  longer assumes a paid plan.
- **API, Web** — commma is free for everyone during early access. A new
  `FREE_MODE` flag (API env, default on; web `VITE_FREE_MODE`) unlocks every Pro
  and Team feature — full history, keyboard-heatmap PNG export, the weekly recap
  page, and team creation — with no payment path. Stripe checkout and the
  billing portal return `SERVICE_UNAVAILABLE` while it is on, and the live
  upgrade/plan-management UI (the Pricing checkout buttons and the edit-profile
  billing section) is hidden. `/pricing` keeps the full Pro and Team tiers and
  their prices visible as the roadmap, with the pay buttons replaced by a
  disabled "Coming later" action and a "free during early access" banner.
  `GET /v1/me` now reports `billing_enabled`. The billing code and the `users`
  Stripe columns are kept dormant, so paid plans can be re-enabled later by
  turning the flag off and restoring the Stripe keys. The scheduled weekly recap
  email stays gated to paid plans (so it sends to no one) — free mode never
  auto-sends email. Supersedes the live-Stripe cutover below for launch.
- **API, Web** — A Team plan can create up to two teams. `POST /v1/teams`
  rejects an over-limit team for the same owner with `409 CONFLICT`
  (`TEAM_MAX_OWNED`), and the web teams page swaps the create form for an
  at-limit notice once you own that many. Joining other teams as a member is
  unaffected — it stays unlimited and needs no plan.
- **Web** — Team dashboard layout pass. The members list and owner controls now
  sit in a balanced two-column block with aligned section headers and a
  first-run prompt when you are the team's only member, so a freshly created
  team no longer opens with a tall empty gap beside the controls. Brought every
  control up to the project's mobile minimums — 44px tap targets on the invite,
  rename, delete, and period-tab actions, and readable label/chip text sizes.
- **API** — Paid plans are live. Production switched from the sandbox billing
  rehearsal to live-mode Stripe: the live secret key, the four live Pro/Team
  monthly and yearly prices, and a live billing webhook endpoint. Pro and Team
  subscriptions now take real payments through Stripe Checkout, with the
  monthly/annual switch and the manage-billing portal wired end to end. The
  cutover is environment-only on the API host — no code change — and
  `apps/api/.env.production` stays blank by design.
- **Web** — Brand film on the About page. A 15-second motion teaser — keyboard
  heat flood, a session scored like a race (pace / elapsed / streak with an
  activity readout), then the wordmark reveal and `commma.dev` — tells the
  commma story in the brand palette and type. It autoplays muted when scrolled
  into view, pauses off-screen, and honors `prefers-reduced-motion` (manual
  controls instead of autoplay). Ships as a ~900 KB 1080p `commma-intro.mp4`
  with a poster frame; the deterministic HTML/canvas source and the 4K social
  masters (9:16 Instagram, 16:9 LinkedIn) live under `assets/video/`.
- **Web** — commma is now on LinkedIn
  ([commma-dev](https://www.linkedin.com/company/commma-dev/)). Linked from the
  footer's Company column, the Contact page, and the `Organization` JSON-LD
  `sameAs` array in `index.html`.
- **Web, API** — SEO pass across the site. A generated brand `og-image.png`
  (1200×630, built from the live keyboard-heatmap layout via
  `apps/web/scripts/generate-og-image.ts`, regenerate with
  `pnpm --filter @commma/web run og:generate`) now backs Open Graph and Twitter
  Card previews (`summary_large_image`). A new `useSeo` hook
  (`apps/web/src/lib/seo.ts`) sets a per-page title, meta description, canonical
  URL, and `og:`/`twitter:` tags on every route, resetting to the site defaults
  on navigation away; private or per-account pages (sign-in, recap, teams, edit
  profile, billing success, auth callback, feed) are marked `noindex`. Added
  `apps/web/public/sitemap.xml` covering the public marketing and discovery
  routes (already referenced by `robots.txt`) and an `Organization` JSON-LD
  block in `index.html`. `GET /v1/sessions/:id` gained a `card_available`
  boolean so the session-detail page can finally point `og:image` at the
  existing public heatmap-card endpoint instead of the site default when one is
  renderable.
- **Web, API** — Join the waitlist. A new section on the landing page captures
  an email and posts it to `POST /v1/waitlist` (public, IP rate-limited, Zod
  `.strict()` validation, idempotent insert keyed on a unique email so duplicate
  signups never leak whether an address already exists). Genuinely new signups
  receive a confirmation email via the existing Resend transport; the send is
  best-effort and never blocks or fails the signup. Backed by a new `waitlist`
  table (migration `0010`).
- **Web** — Landing page reimagined around a live keyboard heatmap. The hero is
  a self-animating keyboard that floods keys with the cold-to-accent heat ramp
  as a ghost typist types, surfaced with a live keys-per-minute, top-key, and
  session readout; it scales to fit on mobile and falls back to a static board
  under `prefers-reduced-motion`. Every section is rebuilt with oversized index
  numerals, scroll-reveal choreography, and a broadcast-style live activity
  ticker, all on the existing palette, type, and API wiring. The back-to-top
  control now appears on every page, not just the landing page.
- **Web** — Visual depth + 3D motion overhaul. Every page is re-lit as raised,
  layered surfaces (top-highlit cards, recessed inputs and code/chart wells, a
  floating navbar, lifted display headlines, glowing primary CTAs) via a small
  design-system layer in `index.css` — no palette, font-size, or text-color
  changes. The landing page gains a cursor-driven 3D hero (parallax depth
  layers, a cursor-following accent spotlight, and a tilting "glass" stat panel
  with a moving glare) and an always-on, pure-CSS 3D backdrop: a perspective
  speed-grid tunnel with drifting glow-orbs that animates on mobile without a
  cursor. All motion honors `prefers-reduced-motion`, and cursor-only effects
  are disabled on touch devices.
- **Web** — `/about` page in the Company footer section. Covers the origin story
  (GitHub × Strava inspiration), a scroll-animated "insight" visualization
  showing how commma merges commit history with athletic-style session data, a
  manifesto section, and a full stack catalogue — 23 entries across 7 groups
  (Language & Tooling, API, Data, Frontend, Extension, Infrastructure,
  Services). Stack cards reveal the rationale for each choice on hover (desktop)
  or always on mobile.
- **Web, API** — Weekly recap page (`/recap`) for Pro and Team users. A new
  `GET /v1/recap` endpoint returns current-week stats (session count, total and
  best session time, top language, streak, week-over-week delta, and a prose
  headline/note) using the same logic as the Monday recap email. The web page
  shows a live week-progress bar, a stat grid, the WoW delta, and a link to the
  best session. A "Recap" nav link appears for Pro/Team users (desktop and
  mobile). Free users who navigate to `/recap` are redirected to `/pricing`.
- **Web** — The Pricing page now marks the signed-in user's current plan. The
  matching tier shows a "✓ Your plan" badge and a highlighted border, and its
  call-to-action becomes "Manage billing" (opening the Stripe Billing Portal)
  instead of an upgrade button. Driven by `MeResult.plan`; signed-out visitors
  see the standard upgrade CTAs.
- **Web** — Billing is wired to Stripe end-to-end. The Pricing page Pro and Team
  CTAs now open Stripe Checkout (auth-gated: a signed-out click stashes the
  chosen plan/interval and resumes checkout automatically after GitHub sign-in),
  and a new `/billing/success` page handles the post-payment return. The account
  page (`/profile`) gains a Billing section showing the current plan with a
  "Manage billing" button (Stripe Billing Portal) for paid users and an
  "Upgrade" link for free users. New `createCheckout`/`openBillingPortal` API
  client calls back the existing `/v1/billing/*` endpoints; a `409 CONFLICT`
  from checkout transparently redirects to the portal.
- **API** — Public crawler heatmap card + a Redis PNG cache. New unauthenticated
  `GET /v1/sessions/:id/heatmap-card` renders the same card as the existing
  `POST` for use as a literal `og:image`; it serves only `privacy: "full"`
  sessions (`404` otherwise, no existence leak), is rate-limited 120/hr per IP,
  and sends `Cache-Control: public, max-age=600`. Both endpoints now cache the
  rendered PNG in Redis for 10 minutes, keyed by session and render options
  including the drawn handle
  (`card:v1:<id>:<aspect>:<layout>:h-<handle>|H:<s|S>`), so repeated hits skip
  the `sharp` rasterization and a handle rename never serves a stale card. The
  cache stores only image bytes and is fail-open; privacy is re-checked against
  Postgres on every request before any cached image is served, so a privacy
  downgrade takes effect immediately.
- **Web** — Team pages. `/teams` lists the user's teams and any pending invites
  with one-click accept/decline; a create-team form (gated to `plan: "team"`)
  auto-derives the slug from the name. `/teams/:slug` is the team dashboard:
  member roster with leave/remove actions, period-tabbed private leaderboard
  (week/month/alltime), and a lazy-loaded aggregate keyboard heatmap powered by
  the existing `KeyboardHeatmap` canvas component. Owner-only panel: invite by
  handle, rename, and delete with confirmation. Frozen teams hide invite/rename
  but keep delete. "Teams" nav link appears only for authenticated users.
- **API / DB** — Team model for the Team tier. New `teams`, `team_members`, and
  `team_invites` tables (migration `0006`). `POST /v1/teams` creates a team
  (gated to `plan: "team"`, caller becomes `owner`); a team holds up to five
  members. Invites target an existing user by `handle`: the owner posts to
  `POST /v1/teams/:slug/invites`, the invitee sees it at `GET /v1/teams/invites`
  and accepts/declines (`/invites/:id/accept|decline`). The five-member cap is
  enforced at both invite time (members + pending) and accept time. Members-only
  reads — `GET /v1/teams/:slug` (roster), `GET /v1/teams/:slug/leaderboard`
  (members ranked by coding time over week/month/alltime), and
  `GET /v1/teams/:slug/heatmap` (members' `keyboard_heatmap` counts merged,
  Redis-cached ~10 min) — return `404` to non-members so a team's existence is
  never leaked. Owner-only management: rename (`PATCH`), delete (`DELETE`, which
  cascades members and invites), invite, and remove members; a member may leave
  via `DELETE /v1/teams/:slug/members/:handle` but the owner cannot. New
  `CONFLICT` (409) error code for taken slugs and full teams. All team endpoints
  are 300/hr per user. The five-member cap is race-safe: accept counts members
  under a `SELECT … FOR UPDATE` row lock on the team, so concurrent accepts
  cannot overshoot. If the owner's plan lapses from `team`, the team is
  **frozen** — invite, accept, and rename return `403`, while reads, leave, and
  delete stay available; `GET /v1/teams` and `GET /v1/teams/:slug` expose a
  `frozen` flag.
- **API** — Style badges on public profiles, computed server-side.
  `GET /v1/users/:handle` now returns `badges` as `{ id, name, description }[]`
  (was always `[]`), derived on read from the user's all-time `keyboard_heatmap`
  key counts summed across sessions in Postgres. Catalog: `vim-athlete` (Escape
  ≥ 2% and arrow keys ≤ 1%), `mouse-free` (arrows + Home/End/PageUp/PageDown ≥
  10%), `backspace-heavy` (Backspace + Delete ≥ 12%), `arrow-navigator` (arrow
  keys ≥ 6%), as a share of total keystrokes. A profile needs ≥ 2000 tracked
  keystrokes before any badge is awarded. Badges are computed only for
  `full`-privacy profiles (checked at request time, so a privacy downgrade hides
  them immediately) and cached per user in Redis for ~10 minutes so a hot
  profile does not re-scan its sessions each read; the cache fails open if Redis
  is unavailable. No schema change — badges are read-time only.
- **API / DB** — Stripe subscription billing for the Pro and Team tiers.
  `POST /v1/billing/checkout` (auth, 30/hr) opens a Stripe Checkout session for
  a `plan` (`pro`/`team`) × `interval` (`monthly`/`yearly`);
  `POST /v1/billing/portal` (auth, 30/hr) opens the Stripe Billing Portal for
  managing or cancelling. `POST /v1/billing/webhook` is signature-verified
  against `STRIPE_WEBHOOK_SECRET` (no JWT). `customer.subscription.*` is the
  single source of truth for `users.plan` (derived from the price + status, with
  `past_due` kept active); `checkout.session.completed` only persists the
  customer/subscription IDs. Webhook delivery is at-least-once and unordered, so
  the subscription handler is an **atomic conditional UPDATE guarded by a
  monotonic `users.stripe_event_ts` watermark** — a redelivered or out-of-order
  stale event (e.g. a retried `active` arriving after `deleted`) is a no-op and
  cannot resurrect a cancelled plan. `customers.create` uses an idempotency key
  to avoid duplicate customers on concurrent checkout. `users` gained
  `stripe_customer_id` (unique) and `stripe_subscription_id` (migration `0004`)
  and `stripe_event_ts` (migration `0005`). All Stripe env vars are optional —
  unset (or present-but-blank, e.g. the `.env.example` placeholders) is coerced
  to absent, the endpoints return `503 SERVICE_UNAVAILABLE` (new error code),
  and every account stays on `free`.
- **Web / API / DB** — User profile fields: `plan` (text, default `free`),
  `display_name` (varchar 64), `bio` (varchar 160), `website` (varchar 256),
  `location` (varchar 64), `school` (varchar 128), `field_of_study` (varchar 64)
  added to `users` via migration `0002`. `PATCH /v1/me` endpoint accepts any
  subset and returns the updated row. New `/profile` page (auth-gated) with
  About / Education / Privacy sections; form pre-fills from `GET /v1/me` on
  mount. Public `/@handle` profile hero now shows `display_name` as `h1` (with
  `@handle` subtitle), `bio`, `location`, and `website`.
- **Web / API / DB** — Extended profile fields: `company` (varchar 128),
  `job_title` (varchar 64), `pronouns` (varchar 32), `linkedin` (varchar 160),
  and `open_to_work` (boolean, default `false`) added to `users` via migration
  `0003`. `PATCH /v1/me` and the public `GET /v1/users/:handle` both accept and
  return them. The `/profile` editor gains a Work section (company, current
  role, LinkedIn) plus a pronouns field and an "open to work" toggle. The public
  `/@handle` hero now shows pronouns beside the handle, an "Open to work" badge
  (accent-2 cream), a `role · company` line, and a LinkedIn link.
- **Web** — Keyboard heatmap color themes: five built-in presets — Blaze
  (orange-red `#ff4d1a`), Arctic (blue `#60a5fa`), Jade (green `#9cf76d`), Cream
  (`#efead8`), Violet (`#c084fc`). Theme selector rendered as touch-friendly 7×7
  dot buttons; selected theme highlighted with a double-ring `box-shadow`.
  `drawHeatmap` parameterised on `hotFill`/`hotText` so all five export presets
  use the active theme.
- **Web** — Smart navbar: nav hides on scroll-down (after one nav-height of
  travel) and reveals immediately on any upward scroll at any page depth.
  Implemented with `fixed` positioning + `transition-transform duration-300`;
  `h-16` spacer preserves layout. Resets to visible on route change. Mobile menu
  open pins the nav visible.
- **Web** — PWA support: `manifest.json` (`display: standalone`, two app
  shortcuts — Leaderboard and Feed), service worker with app-shell cache and
  offline SPA fallback (API calls bypass the cache), four brand-aligned SVG
  icons (192, 512, maskable, apple-touch) using the `<,>` mark in `accent`
  orange on `accent-2` cream background, and full `<head>` wiring
  (`theme-color`, `apple-mobile-web-app-*` meta tags). App is now installable on
  Android and iOS.
- **Web** — Mobile layout audit (Phase 5): all pages verified at 375 px with no
  horizontal overflow. Fixed leaderboard period tabs (`whitespace-nowrap` +
  responsive sizing) so "Week / Month / All time" render on one row.
- **Web** — Favicon redesigned from off-brand purple Vite bolt to the `<,>`
  brand mark (angle brackets + comma) in `#ff4d1a` on `#efead8` cream
  background, consistent with the new PWA icons.
- **Web / API / DB** — Push notifications for streak reminders. New
  `push_subscriptions` table (migration `0007`, FK to `users` with
  `CASCADE DELETE`, unique on `endpoint`). Three new API routes:
  `GET /v1/push/vapid-public-key` (public, returns the VAPID public key or `503`
  if unset), `POST /v1/push/subscribe` (auth, 20/hr, upserts on `endpoint`), and
  `DELETE /v1/push/subscribe` (auth, 20/hr). A daily in-process scheduler
  queries users whose `streak.currentDays > 0` and `lastActiveDate < today`,
  sends a "Streak reminder — commma" Web Push notification to each registered
  browser, and auto-deletes expired subscriptions (410/404). VAPID vars are
  fully optional — all push endpoints return `503` when unset, so the feature is
  inert in environments without keys. Service worker (`public/sw.js`) gained
  `push` and `notificationclick` handlers; `EditProfile` gained a Notifications
  section with an Enable/Disable toggle.

### Security

- **API, Web** — Stored-XSS hardening on profile links, found in a pre-launch
  re-audit of the API surface. `PATCH /v1/me` validated `website` and `linkedin`
  with a bare `z.string().url()`, which accepts `javascript:` and `data:` URLs
  (the WHATWG URL parser treats them as valid). The public profile renders both
  as `<a href=…>`, so a crafted value would have executed script in the
  `commma.dev` origin when another visitor clicked it. The two fields are now
  constrained to `http`/`https` only at the API (the enforcement boundary) —
  anything else returns `400 VALIDATION_ERROR` — and the web profile passes both
  through a `safeExternalUrl` guard that drops any non-`http(s)` URL, so legacy
  rows already in the database also render inert. The rest of the eleven-point
  audit (auth coverage, per-route rate-limit buckets, Stripe webhook signature
  verification and event idempotency, OAuth state/redirect handling, refresh
  cookie flags, ownership checks on every mutation, parameterized SQL, and no
  secrets in the web bundle) passed with no further changes.
- **API** — Backend hardening pass from the eleven-point infra audit. Three
  fixes: (1) `POST /v1/ingest` now bounds event timestamps to a server-side
  window — a batch is rejected with `400 VALIDATION_ERROR` if any `ts` is more
  than 5 minutes in the future or more than 30 days old. Clients fully control
  `ts`, and a future-dated event would otherwise keep its session open forever
  (the idle-gap boundary is measured from now), growing the `events` table
  unbounded; the 30-day floor still clears the extension's offline-buffer flush.
  (2) The auth rate-limit bucket now reads a zod-validated `NODE_ENV` instead of
  raw `process.env.NODE_ENV`, so it cannot silently fall back to the looser
  100/hr limit when the variable is unset — production stays at 20/hr per IP.
  (3) `POST /v1/billing/checkout` and `POST /v1/billing/portal` now fail closed
  on a rate-limiter (Redis) error like the other sensitive write paths, so the
  money paths are never left unmetered during a Redis outage. No schema or
  API-shape change.

### Changed

- **Web** — Open-source launch cleanup of the landing page. The 1,028-line
  `apps/web/src/App.tsx` (the single largest source file, mixing every landing
  section with inline mock data and chart helpers) was split into a focused
  `apps/web/src/pages/Landing/` module: one file per section
  (`Hero`/`Ticker`/`Activity`/`HowItWorks`/`Leaderboard`/`Waitlist`/`Final`), a
  shared `SectionHead`, the scroll `ProgressBar`, an `index.tsx` that composes
  them, and `mocks.ts` holding the sample data the live API falls back to.
  `main.tsx` now imports `Landing` from `pages/Landing`; no UI, copy, route, or
  behavior changed. The MIT-licensed monorepo (extension, API, web) is public
  with a contributor guide, and this split makes the most-edited page far easier
  to read and review.
- **Web** — Landing behavior extracted into reusable custom hooks, with the
  repo's first web test. Three inline `useState`/`useEffect` blocks became hooks
  in `lib/`: `useScrollProgress<T>()` (the scroll-progress bar),
  `useLiveCount()` (the hero "typing right now" counter), and
  `useWaitlistForm()` (the waitlist email state machine) — the section
  components are now mostly markup, with no behavior change. The waitlist's pure
  logic (`isValidWaitlistEmail`, `waitlistErrorMessage`) moved to
  `lib/waitlist.ts` and is covered by a new `apps/web/test/waitlist.test.ts` (10
  cases) — the first test under `apps/web/`, running on the existing `node`
  Vitest with no jsdom or testing-library added. A `useMutation` rewrite of the
  waitlist POST was considered and declined: the TanStack Query layer is for
  cached reads (ADR-014), not a fire-and-forget signup with per-error copy.
- **Web** — Scroll-performance pass. Eliminated the main cause of scroll jank:
  the body's noise-texture and gradient background used
  `background-attachment: fixed`, which forced the browser to repaint a
  viewport-sized fractal-noise SVG on every scroll frame on every page. It now
  paints once on a `position: fixed` `body::before` layer instead. The landing
  page's scroll-progress bar was rAF-throttled and no longer reads
  `scrollHeight` (a forced reflow) on each scroll event — it caches the value
  and recomputes on resize. Reduced the landing backdrop orb blur from 58 px to
  40 px (cheaper to re-rasterize while animating, visually unchanged behind
  content) and dropped the permanent `will-change` from every on-screen keyboard
  key (it was promoting 60+ keys to standing compositor layers). Then the bigger
  one: the landing hero's `LiveKeyboard` ran a `requestAnimationFrame` loop that
  repainted all 60+ keyboard keys (six inline style writes each) every frame and
  never stopped — so the main thread stayed pinned painting the hero even after
  it scrolled out of view, starving the scroll. It now pauses the loop via an
  `IntersectionObserver` when the board leaves the viewport and dirty-checks
  each key so idle (cold) keys are not rewritten frame to frame. No visual
  change.
- **Web** — Pre-deploy frontend audit pass across all 13 pages and components.
  Fixes: `FeedCard` replaced `<div role="link">` with a stretched `<Link>`
  (semantic navigation); `Profile` plan gate hardened from falsy `!user?.plan`
  to explicit `!== 'pro' && !== 'team'` allowlist; `SignIn` wordmark
  `<a href="/">` replaced with `<Link to="/">` (SPA, no full reload);
  landing-page leaderboard now distinguishes loading from empty (skeleton during
  fetch, empty state only after resolve); SVG chart fills/strokes changed from
  raw hex to `var(--color-*)` CSS variables. Contrast: `text-ink-faint` replaced
  with `text-ink-mute` on all readable text (column headers, rank numbers,
  timestamps, dash bullets, separators). Font sizes: all sub-12 px labels bumped
  to minimum 12 px (`EditProfile` form labels/hints, `Feed` eyebrow,
  `KeyboardHeatmap` hint and Export label, `SessionDetail` heatmap stats). Tap
  targets: notification, billing, invite, and billing-interval toggle buttons
  raised to `h-[44px]`; mobile nav toggle `w-9` → `w-11`; heatmap layout/theme
  controls enlarged. Token discipline: `accent/40`, `accent/50`, `accent/60`
  opacity modifiers replaced with `accent-line` / `accent-soft` named tokens;
  `Pricing` inner `max-w-[1000px]` wrapper removed (Shell already constrains the
  page).

- **API, DB** — Pre-deploy reliability hardening from the backend/infra audit.
  The server now shuts down gracefully on `SIGTERM`/`SIGINT` (stop schedulers,
  drain in-flight requests, let a running aggregation transaction finish, then
  close the Postgres pool and Redis), so a rolling deploy can no longer corrupt
  a half-written session. All five background loops (aggregation, streak, token
  cleanup, push, recap) now take a per-loop Redis leader lock so exactly one
  instance runs each interval even when `RUN_AGGREGATION` is enabled on every
  replica. The rate limiter fails **closed** (`503`) for `POST /v1/ingest` and
  auth endpoints when Redis is unreachable, and stays open for read paths and
  the Stripe webhook. The cold leaderboard rebuild is now guarded by a Redis
  lock to prevent a thundering-herd of identical `sessions` scans. A new index
  migration adds a global `sessions (started_at desc)` index for the public
  homepage queries and replaces the unusable partial `events` index with a plain
  `events (user_id, ts)` the aggregator can use. The Postgres pool size is now
  explicit (`DB_POOL_MAX`, default 10). All write request bodies reject unknown
  fields (`.strict()`), and `POST /v1/billing/webhook` and
  `GET /v1/push/vapid-public-key` gained IP rate-limit buckets.
- **API** — Billing checkout is hardened against accidental double-subscribing.
  `POST /v1/billing/checkout` returns `409 CONFLICT` when the caller is already
  on a paid plan or has a subscription on file (plan changes belong in the
  portal), the Stripe session create carries an idempotency key keyed by
  `(user, plan, interval)`, and the portal `return_url` points at `/profile`
  (the real account page) instead of a nonexistent `/settings`.
- **API** — GitHub OAuth token exchange now correctly handles GitHub's
  HTTP-200-on-error response (expired/used codes return `{"error":"..."}` not a
  4xx). `exchangeCode` parses the error field and throws; the callback route
  wraps the call in try/catch and returns `VALIDATION_ERROR` with a clear
  message instead of falling through to `INTERNAL_ERROR`.
- **API** — Unhandled error logger now includes `cause` (the underlying
  PostgreSQL error message) so DB failures are diagnosable from logs without a
  debugger.
- **API** — CORS `allowMethods` now includes `PATCH` to support `PATCH /v1/me`.
- **Web** — `AuthProvider` now loads the signed-in user (`GET /v1/me`) after the
  startup token refresh, so the nav reflects the authenticated state (avatar +
  Edit profile) on reload instead of falling back to the "Sign in" link.
- **Web** — Profile route fixed for React Router v7: `/@:handle` (an unsupported
  partial dynamic segment that never matched) became `/:handle`, with `Profile`
  stripping the leading `@`. The `/@handle` links across the app now resolve
  instead of rendering "Page not found".
- **Web** — Heatmap mobile UX: canvas rendered at full logical width with an
  `overflow-x-auto` scroll container; a right-edge fade gradient and "swipe to
  explore" hint (`sm:hidden`) guide mobile users. Export buttons use `h-[44px]`
  touch targets on mobile (`sm:h-[32px]` on desktop).
- **Web** — Accessibility (Lighthouse pass): `aria-label` + `role="img"` on
  heatmap canvas; `loading="lazy"` on list avatars (Leaderboard, Feed, Profile);
  `aria-hidden="true"` on decorative language-colour swatches;
  `<meta name="description">` injected dynamically on SessionDetail and Profile
  pages alongside the existing OG tags.
- **Web** — `/terms` page: Terms of Service with seven sections (acceptance,
  data collected, data ownership, acceptable use, availability, changes,
  contact). Linked from footer Legal column.
- **Web** — `/changelog` page: versioned release history (v0.1–v0.3) styled with
  accent-2 version badge chips and dash-separated change lists.
- **Web** — Pro tier enforcement (frontend soft gates): `KeyboardHeatmap`
  accepts `isPro?: boolean`; free/unauthenticated users see a "PNG export Pro →"
  upgrade chip linking to `/pricing` instead of the three preset export buttons.
  `MeResult` gains an optional `plan?: 'free'|'pro'|'team'` field;
  `UserProfile.badges` typed as `Badge[]` (was `never[]`).
- **Web** — Badge display on profile: `BadgeRow` component renders all four
  Phase 4 badge types (vim-athlete, mouse-free, backspace-heavy,
  arrow-navigator) below the stat grid. Earned badges render in accent-2
  (cream); unearned badges are shown at 25% opacity as aspirational targets.
- **Web** — Session history gate on Profile: free-plan users viewing their own
  profile see a "Free plan · last 7 days" callout with an upgrade link at the
  bottom of the session feed.
- **Web** — OG meta fallbacks in `index.html`: `og:type`, `og:site_name`,
  `og:title`, `og:description`, `twitter:card`, `twitter:title`,
  `twitter:description` set as static defaults; dynamic pages (Profile,
  SessionDetail) continue to override them per-route.
- **Shared + Web** — Dvorak and Colemak keyboard layouts: `DVORAK_LAYOUT`,
  `COLEMAK_LAYOUT`, `KEYBOARD_LAYOUTS` record, and `LayoutName` type exported
  from `@commma/shared`. The session-detail keyboard heatmap gains a QWERTY /
  Dvorak / Colemak layout toggle so users on alternate layouts see their actual
  finger-travel patterns; export presets render the active layout. (Phase 4 —
  ROADMAP #247/#248 ✔)
- **Web** — Scroll restoration via `<ScrollRestoration />` (React Router v6):
  navigating to a new route resets scroll to top; browser back/forward restores
  the saved position. All routes wrapped in a `RootLayout` component.
- **Web** — Reading progress bar: 2 px accent stripe fixed at `top-0 z-[60]`,
  driven by a passive scroll listener with direct DOM mutation (no React
  re-renders). Landing page only.
- **Web** — Back-to-top button: floating `↑` on the landing page, fades in after
  500 px of scroll, smooth-scrolls to top on click. Also DOM-driven.
- **Web** — Nav active-link indicator: the current route renders `text-ink` with
  a full-width accent underline; inactive links retain hover-only behaviour.
  Wordmark and Activity link smooth-scroll to top when already on `/`.
- **Web** — Mobile hamburger nav: `md:hidden` icon (lines↔X) opens a dropdown
  below the sticky nav showing all four nav links with 56 px tap targets.
  Collapses automatically on route change.
- **Web** — Footer redesigned: three-column layout (Product / Company / Legal),
  `max-w-2xl mx-auto` columns centred within the container, GitHub linked to the
  real repo, `© 2026 commma · All rights reserved`.
- **Web** — Five new footer pages: `/careers` (expanding-soon placeholder),
  `/contact` (founder name + email), `/privacy` (full policy covering key-label
  collection, privacy modes, data retention), `/api` (endpoint reference with
  rate limits; all routes marked pending), `/status` (invite-only early-access
  status board). All content centred via `mx-auto`.
- **Web** — Landing page CTA: non-functional email-capture form replaced with a
  two-button row — "Get early access" (accent, links to `/pricing`) and "Install
  free" (outline, links to VSCode Marketplace). All `href='#'` placeholders
  removed site-wide; former stub CTAs now route to `/signin`, `/contact`, or
  `/leaderboard`.
- **Web** — Nav wordmark now uses `useNavigate` and always calls
  `e.preventDefault()`: from any sub-page it routes cleanly to `/`; from `/` it
  smooth-scrolls to top without adding a `#` fragment.
- **Web** — Footer column layout switched from `grid-cols-2 sm:grid-cols-3` to
  `flex flex-wrap justify-center` so the three columns remain evenly centred on
  mobile instead of orphaning the Legal column bottom-left. Footer wordmark
  (`commma.`) centred with `text-center`.
- **Web** — Footer columns updated: Changelog added to Product; Terms added to
  Legal; 404 retained in Legal.
- **Web** — Tab titles aligned: landing page sets
  `commma — every commit is a step` (was falling back to the HTML default
  "commma — pace your code"); Pricing sets `Pricing · commma`; AuthCallback sets
  `Signing in · commma`. `index.html` title updated to match.
- **Web** — Text sizes bumped across all pages for readability: 10 px→11, 10.5
  px→12, 11 px→12, 12 px→13, 12.5 px→14, 13 px→14 px. Covers App, chrome, Feed,
  Leaderboard, Pricing, Profile, SessionDetail, SignIn, and all new footer
  pages.
- **Web** — Feed unauthenticated state and Leaderboard empty state: outer
  padding increased to `py-24`, text to 15 px, sign-in button to `h-[46px] px-7`
  for clearer mobile CTAs.
- **Web** — Pricing billing-toggle buttons: `h-[34px]` → `h-[40px] px-5`.
- **Web** — Footer wordmark minimum size reduced (`clamp(52px,16vw,440px)`) to
  prevent overflow on narrow mobile viewports.

- **Web** — GitHub OAuth sign-in flow: `GET /v1/auth/github/callback` now
  redirects to `${WEB_ORIGIN}/auth/callback?code=…` (reuses the CLI one-time
  code mechanism); web `/auth/callback` route exchanges the code via
  `POST /v1/auth/cli/exchange`. `AuthProvider` context stores the refresh token
  in `localStorage` and the access token in memory; auto-refresh fires 60 s
  before JWT expiry. Nav shows avatar + sign-out when authenticated; `/signin`
  page is the entry point.
- **Web** — `/signin` page: centered full-screen layout with "Sign in with
  GitHub" button and privacy note.
- **Web** — PNG export presets on the keyboard heatmap: three buttons (1:1
  1080×1080, 9:16 1080×1920, 16:9 1920×1080) — offscreen canvas letterboxes the
  keyboard into the target dimensions with 8% margin, transparent background.
- **Web** — Profile page `/@handle`: avatar, 4-stat grid (sessions / time /
  streak / top lang), keyset-paginated session feed with "Load more".
- **Web** — Leaderboard page `/leaderboard`: period tabs (week/month/alltime),
  ranked rows, linked to `/@handle`.
- **Web** — Feed page `/feed`: auth-gated; session cards with user attribution
  and pagination; unauthenticated state links to `/signin`.
- **Web** — OG meta tags (`og:title`, `og:description`, `og:type`,
  `twitter:card`) injected dynamically on session-detail and profile pages.
- **Web** — Landing page leaderboard section wired to live
  `GET /v1/leaderboard?period=week`; self-highlight for signed-in user.
- **Infra** — `vercel.json` SPA rewrite so all react-router paths resolve to
  `index.html` on Vercel.
- **Infra** — `apps/web/.env.example` documenting `VITE_API_BASE_URL`.
- **API** — Auth rate limit raised to 100/hr outside `NODE_ENV=production` (was
  20/hr in all environments).
- **Tooling** — Vitest test runner (root `pnpm test` / `pnpm test:watch`). Unit
  tests for the pure aggregator functions (`splitIntoSessions`, `buildSession`,
  `applyActiveDate`/`streakBreakCutoff`) and the extension key counter
  (`tallyChange`, `addKeyFreq`). API build now uses `tsconfig.build.json` so
  `test/` is typechecked but excluded from `dist/`.
- **API** — expired `refresh_tokens` cleanup: an in-process daily interval
  (gated by `RUN_AGGREGATION`, started in `index.ts`) that deletes rows whose
  `expires_at` has passed, so rotated/abandoned tokens no longer accumulate.
- **API** — input-validation hardening: a 1 MB body limit on `/v1/*`
  (`413 PAYLOAD_TOO_LARGE`); the heartbeat contract now bounds `lang`/`file`/
  `project` lengths and `keystrokes`/`lines`/`ts` ranges; the `:handle` path
  param is validated before any DB lookup.
- **API** — configurable proxy trust for IP rate limiting: `TRUST_PROXY_HOPS`
  (default `0`) controls how many proxies front the API; `ipKey` now resolves
  the client IP from the trusted (right) end of `x-forwarded-for` instead of the
  spoofable leftmost hop, closing ADR-010 (B). Set `1` behind an ALB, `2` behind
  CloudFront→ALB, and restrict the security group so only the LB reaches the
  host.
- **API** — `POST /v1/sessions/:id/heatmap-card`: server-side keyboard-heatmap
  PNG via `sharp` (SVG built from `QWERTY_LAYOUT` + the cold→`accent` ramp,
  optional `@handle`/stats overlays). Auth-required, privacy-gated (non-`full`
  owners are owner-only); `aspect` 9:16/1:1/16:9; only the `qwerty` layout for
  now. Rate-limited on its own `card` bucket (120/hr/user); the `⌘` cap renders
  as `Cmd` so the card doesn't depend on a glyph missing from common Linux
  fonts. Unblocks feed heatmap thumbnails.
- **Extension** — offline queue: unsent heartbeats now persist to VSCode
  `globalState`, so a crash or window reload no longer drops buffered events.
  `IngestClient` applies exponential backoff (60s → 15min cap) on consecutive
  send failures instead of retrying every 60s flush. A single-flight guard and a
  15s request timeout stop overlapping 60s flushes and hung connections from
  racing the buffer; an oversized (413) batch is split in half and retried down
  to a single event rather than dropped, and only genuinely non-retryable 4xx
  batches are discarded so a single bad event can't wedge the queue offline.
- **Tooling** — route/integration test harness: `apps/api/test/` exercises the
  real app via `app.request()` against Postgres + Redis, gated on
  `TEST_DATABASE_URL` (skips cleanly when unset, so default `pnpm test` never
  touches a database) and self-cleaning. Covers healthz, the structured
  404/401/validation error shapes, and the ingest + `sessions/:id` privacy gates
  (full/summary/off). Confirms every error path returns the `apiError` shape.

### Docs

- Added a "Billing (Stripe, optional)" step to `DEPLOY.md` — sandbox-first
  setup, the four recurring price IDs, secret/webhook-secret env wiring, and the
  `4242` test-card end-to-end check, including the note that the webhook is
  signature-authenticated (no JWT) so nginx forwards it like any other `/v1`
  route.
- Added **ADR-012: Stripe Billing & Webhook Idempotency** — records the choice
  of Stripe + Managed Payments (merchant of record for VAT), subscription events
  as the single plan source, the `stripe_event_ts` watermark for ordering-safe
  idempotency, and optional-env graceful degradation, with rejected
  alternatives. Added the three `/v1/billing/*` routes to the `SYSTEM_DESIGN.md`
  route map and a Billing row to the `README.md` tech-stack table.
- Added `SECURITY.md` — private vulnerability reporting, supported versions,
  scope, safe harbor, and the no-keylogging privacy invariant (ADR-006) as a
  security boundary. Linked from `README.md` and `CONTRIBUTING.md`.
- Reconciled `ONBOARDING.md` with the real codebase (in-process interval
  aggregation instead of BullMQ workers, actual `aggregate/`/`maintenance/`
  paths, flat `packages/shared` layout, the gated test harness, `app.ts` route
  registration) and refreshed the `README.md` status and stack table.

### Privacy

- **API** — `privacy = summary` is now enforced server-side, not just by the
  extension. Ingest drops `file` and `key_freq` before storing for `summary`
  users and stores nothing for `off` users; `GET /v1/sessions/:id` additionally
  suppresses `files` and `keyboard_heatmap` to non-owners for `summary` owners
  (covers data captured before a switch to `summary`). Upholds ADR-006.

- **API** — streak-reset cron: an in-process hourly interval (ADR-010 style,
  gated by `RUN_AGGREGATION`, started in `index.ts`) that zeroes `current_days`
  for users whose `last_active_date` is older than yesterday (UTC), preserving
  `longest_days` and `last_active_date`. The aggregator only _bumps_ streaks on
  activity and resets lazily on the next session, so without this a broken
  streak read as stale (e.g. `/v1/me`, profiles) until the user coded again.
  Pure cutoff helper `streakBreakCutoff` in `aggregate/streak.ts`; bulk
  `UPDATE … RETURNING` in `aggregate/streakReset.ts`. Skips users with
  un-aggregated `events` (`NOT EXISTS`) so a session ending near 00:00 UTC isn't
  mis-scored as broken while aggregation is still catching up.
- **API** — social endpoints: `GET /v1/users/:handle` (public profile —
  handle/avatar/streak plus aggregated `total_sessions`/`total_duration_s`/
  all-time `top_lang`; `badges` is `[]` until the Phase 4 badge system),
  `GET /v1/users/:handle/sessions` (public, keyset-paginated session list),
  `POST`/`DELETE /v1/users/:handle/follow` (auth, idempotent `204`; self-follow
  is `400`, following a `privacy='off'` user is `404`), and `GET /v1/feed`
  (auth; sessions from followed users, newest-first, keyset-paginated, excludes
  followees now set to `privacy='off'`). Profile and session-list reads are
  privacy-gated like `GET /v1/sessions/:id` (an `off` user is `404` to
  non-owners). Shared keyset-cursor and session-summary helpers
  (`lib/cursor.ts`, `lib/sessionSummary.ts`) now back `GET /v1/sessions`, the
  user session list, and the feed.
- **API** — `GET /v1/leaderboard` (public, no auth): top 100 users by coding
  time for `period` = `week` (default) / `month` / `alltime`, read from the
  Redis sorted sets and hydrated from PostgreSQL (handle, avatar, current
  streak, top language for the period). Implements the ADR-007/ADR-010
  cold-start rebuild — if the period's sorted set is missing (Redis wiped), it
  is rebuilt by summing `sessions.duration_s` over the period window (never
  `events`, which are pruned). Users with `privacy = 'off'` are excluded. Not
  yet implemented: the `lang` filter (needs per-language sorted sets) and the
  `delta` rank-change field (needs period snapshots).
- **Extension (`@commma/extension`) 0.1.0** — real `commma: Sign in` /
  `commma: Sign out`, GitHub OAuth via a loopback redirect + one-time code
  (ADR-011), tokens stored in VSCode SecretStorage with transparent refresh, an
  activity tracker (keystrokes, lines, language, file, key-label frequency), a
  60s heartbeat flush to `POST /v1/ingest` with simple in-memory retry, privacy
  modes (`full` / `summary` / `off`), a `commma: Pause / Resume tracking`
  toggle, and a status-bar connection indicator (click to pause/resume). The
  extension now bundles with esbuild.
- **API** — `POST /v1/auth/cli/exchange` (one-time-code → tokens);
  `GET /v1/auth/github` accepts a loopback `redirect_uri`;
  `POST /v1/auth/refresh` and `POST /v1/auth/signout` accept a
  `{ refresh_token }` body in addition to the cookie. No database migration
  (OAuth state and one-time codes are Redis-only).

### Fixed

- **Web** — Long handles no longer break the Feed layout (`0.9.0`). A feed
  card's `@handle` could be up to 39 characters; without truncation it
  overflowed its row on narrow viewports and pushed the date out of place. The
  handle now gets `min-w-0`/`truncate` and the trailing date stays put, matching
  the leaderboard, team, and profile rows that already handled this.
- **Web** — Every "Install the extension" call-to-action (landing hero, final
  CTA, nav, both Pricing tiers) linked to the bare Marketplace homepage, which
  is a dead end since the extension is not published yet. They now link to the
  landing page's waitlist section and read "Get notified at launch" / "Join the
  waitlist" instead. A signed-in user's own empty profile previously said only
  "No sessions yet." with no next step; it now explains the extension is not
  public yet and links to the waitlist.
- **Web** — The API reference and Privacy Policy pages were missing the waitlist
  endpoint and its email-collection disclosure, added after the waitlist feature
  shipped.
- **Web** — Enabling streak-reminder notifications could fail to register a
  subscription. `pushManager.subscribe()` now recovers from a stale browser
  subscription bound to a previous VAPID key (unsubscribe and retry instead of
  throwing `InvalidStateError`), detects iOS Safari outside an installed PWA and
  explains that the app must be added to the Home Screen first, and reports any
  other browser refusal clearly. The toggle also surfaces a message when
  permission is dismissed or push is unavailable server-side, and rolls back a
  subscription the browser created but the server rejected.
- **API** — Streak-reminder push scheduler is now anchored to a wall-clock hour
  (`PUSH_REMINDER_HOUR_UTC`, default 17 UTC) and ticks hourly, matching the
  recap scheduler. Previously it used a 24-hour interval measured from process
  start, so every deploy or restart reset the timer and reminders could go out
  at drifting times or never fire.
- **Aggregator** — session `duration_s` is floored to
  `span + one heartbeat window` (~60s) so sub-minute sessions are no longer 0
  seconds; they now earn leaderboard credit and produce non-zero language
  splits.

### Heatmap

- **Heatmap completeness (`@commma/shared` `KEY_LABELS`).** Added `Space` and
  the eleven punctuation physical keys (`` ` `` `-` `=` `[` `]` `\` `;` `'` `,`
  `.` `/`). The extension now maps the space character to `Space` and every
  shifted symbol to its physical key (`!`→`1`, `:`→`;`, `?`→`/`, …) instead of
  collapsing them into `Other`, so the most-pressed key (Space) and the full
  board now render on the heatmap. Still an order-destroyed histogram of
  physical-key identity — ADR-006 is unchanged (a physical-key map is not
  content).
- **Privacy — ADR-006 amended.** The key-label heatmap is built by reading
  `contentChanges.text` **solely to increment a frequency counter, then
  discarding the string** — never stored, logged, or transmitted; only the final
  `Record<string, number>` histogram is retained. Content is unrecoverable from
  a frequency histogram. The no-keylogging guarantee is unchanged: an
  order-destroyed histogram is key labels; a reconstructable sequence remains
  forbidden. Extension version bumped `0.0.1 → 0.1.0` to mark the amendment.
