# Changelog

All notable, cross-cutting changes to commma are recorded here. Per-package
versions live in each `package.json`; this file tracks product-level changes and
any change that touches a privacy guarantee (ADR-006 requires a CHANGELOG entry).

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Extension (`@commma/extension`) 0.1.0** — real `commma: Sign in` /
  `commma: Sign out`, GitHub OAuth via a loopback redirect + one-time code
  (ADR-011), tokens stored in VSCode SecretStorage with transparent refresh, an
  activity tracker (keystrokes, lines, language, file, key-label frequency), a 60s
  heartbeat flush to `POST /v1/ingest` with simple in-memory retry, privacy modes
  (`full` / `summary` / `off`), a `commma: Pause / Resume tracking` toggle, and a
  status-bar connection indicator (click to pause/resume). The extension now
  bundles with esbuild.
- **API** — `POST /v1/auth/cli/exchange` (one-time-code → tokens); `GET
  /v1/auth/github` accepts a loopback `redirect_uri`; `POST /v1/auth/refresh` and
  `POST /v1/auth/signout` accept a `{ refresh_token }` body in addition to the
  cookie. No database migration (OAuth state and one-time codes are Redis-only).

### Fixed

- **Aggregator** — session `duration_s` is floored to `span + one heartbeat
  window` (~60s) so sub-minute sessions are no longer 0 seconds; they now earn
  leaderboard credit and produce non-zero language splits.

### Changed

- **Privacy — ADR-006 amended.** The key-label heatmap is built by reading
  `contentChanges.text` **solely to increment a frequency counter, then discarding
  the string** — never stored, logged, or transmitted; only the final
  `Record<string, number>` histogram is retained. Content is unrecoverable from
  a frequency histogram. The no-keylogging guarantee is unchanged: an order-destroyed
  histogram is key labels; a reconstructable sequence remains forbidden. Extension
  version bumped `0.0.1 → 0.1.0` to mark the amendment.
