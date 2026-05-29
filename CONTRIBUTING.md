# Contributing

Welcome. commma is an open-source project and we take contributions seriously.

---

## Before You Start

### Prerequisites

- Node.js ≥ 20.19.0
- pnpm ≥ 10.0.0 — `npm install -g pnpm`
- Docker + Docker Compose
- VSCode (for extension development)
- A GitHub account

### Find Something to Work On

- Browse issues labelled **`good-first-issue`** — scoped, well-defined, safe to pick up without deep context
- Browse **`feature`** or **`help-wanted`** for larger work
- If you have an idea not covered by an existing issue, open one first and discuss before writing code
- Assign yourself to an issue before starting so two people don't duplicate effort

---

## Local Setup

```bash
git clone https://github.com/[org]/commma.git
cd commma
pnpm install

# start PostgreSQL and Redis
docker compose up -d

# copy env and fill in values
cp apps/api/.env.example apps/api/.env

# run migrations
pnpm --filter @commma/db migrate

# start all services
pnpm dev
```

See [ONBOARDING.md](./ONBOARDING.md) for the full setup walkthrough.

---

## Branching

Branch from `main`. Name your branch: `type/short-description`

```text
feat/keyboard-heatmap-export
fix/session-boundary-off-by-one
docs/update-contributing
chore/upgrade-hono
test/ingest-idempotency
```

---

## Commit Convention

We use **Conventional Commits**. Every commit must follow:

```text
<type>(<scope>): <short description>

[optional body]

[optional footer: Closes #123]
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`

**Scopes:** `api`, `extension`, `web`, `shared`, `db`, `infra`

**Examples:**

```text
feat(api): add keyboard heatmap endpoint
fix(extension): correct idle threshold calculation
docs(shared): document HeartbeatBatch schema fields
test(api): add ingest idempotency integration test
```

---

## Before Pushing

```bash
pnpm typecheck   # must be zero errors across all packages
pnpm lint        # ESLint across all packages
pnpm test        # all tests
```

---

## Pull Request Process

- Target branch: `main`
- PR title must follow Conventional Commits format
- Fill in the PR template fully — description, testing steps, screenshots if UI changes
- Link the issue it closes (`Closes #123` in the PR body)
- One concern per PR — do not bundle unrelated changes

### PR Self-Review Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] New code has tests where applicable
- [ ] No secrets, API keys, or `.env` files committed
- [ ] PR description explains the change and how to test it
- [ ] UI changes include a screenshot or screen recording

### Review

- A maintainer will review within 48 hours on weekdays
- Address all review comments before requesting re-review
- Do not force-push after a review has started — use new commits, squash at merge

### Merge

- Maintainers merge using **Squash and Merge**
- After merge, delete your branch

---

## Package-Specific Rules

### @commma/shared

- Consumed by both the extension and the API — schema changes are breaking if they remove or rename fields
- Keyboard layout configs live in `packages/shared/src/layouts/`

### @commma/api

- All new endpoints must have Zod validation on request body/params
- All new endpoints must have at least one integration test in `src/routes/__tests__/`
- Background jobs go in `src/workers/`

### @commma/extension

- **Hard rule:** never capture, log, or transmit key content — only key labels
- New settings must be added to `package.json` `contributes.configuration` and documented in README
- Test activation performance: the extension must not cause >50ms activation delay

### @commma/web

- Components go in `src/components/`
- The keyboard heatmap Canvas renderer lives in `src/components/KeyboardHeatmap/`
- Design tokens are defined in `src/index.css` under `@theme` — do not hardcode colors

### @commma/db

- Schema changes require a migration file in `src/migrations/`
- Never edit an existing migration — always add a new one
- Run `pnpm --filter @commma/db generate` after changing the Drizzle schema

---

## Issue Labels

| Label | Meaning |
| ------- | --------- |
| `good-first-issue` | Scoped, safe for first-time contributors |
| `help-wanted` | Maintainers want external help |
| `feature` | New functionality |
| `bug` | Something is broken |
| `docs` | Documentation only |
| `test` | Test coverage gap |
| `chore` | Dependency updates, tooling |
| `performance` | Latency or bundle size concern |
| `security` | See SECURITY.md before commenting publicly |
| `needs-discussion` | Design not settled; comment before coding |

---

## Code Style

- TypeScript strict mode enforced (`"strict": true` in all tsconfigs)
- No `any` types — use `unknown` and narrow, or define a proper type
- No commented-out code in PRs
- No `console.log` in production code — use the structured logger
- Prefer `const` over `let`; never `var`
- File names: `camelCase.ts` for modules, `PascalCase.tsx` for React components

---

## Recognition

Every merged PR is credited in `CHANGELOG.md`. Contributors with 3+ merged PRs are listed on the commma.dev contributors page.

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/). Be direct, constructive, and kind.

---

## Questions

- **GitHub Discussions** — design questions
- **GitHub Issues** — bugs or feature requests
- **Discord** — async chat (link in README)
