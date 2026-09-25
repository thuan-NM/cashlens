# CashLens

CashLens is a personal-finance web application. It records your transactions, including those imported from bank notification emails in Gmail, and turns them into dashboard totals, budgets, alerts, and goal feasibility checks.

This repository holds the **Operational MVP** (`specs/001-operational-mvp`): a small, single-host deployment for individual users. The web app and the API share one HTTPS origin.

> **Release status.** The MVP is implemented and its automated suites pass. It is **not yet release-approved**: the authoritative release verification and the dashboard benchmark still have to pass on the reference release host. See [`release-evidence.md`](specs/001-operational-mvp/checklists/release-evidence.md) for the current status.

## Supported MVP journeys

| Journey | What the user can do |
|---|---|
| Account and session | Register with email and password, sign in, stay signed in through rotating refresh sessions, and sign out. Signing out of every session is available in the API (`POST /api/auth/logout-all`). Every record is visible only to its owner. |
| Transactions and dashboard | Record, edit, ignore, mark as duplicate, and delete transactions. The dashboard shows the current month's income, expense, net cash flow, category breakdown, and recent transactions, in the user's time zone and currency. |
| Gmail import | Connect Gmail with read-only consent, choose which bank senders to listen to, and run a bounded manual sync that turns supported bank emails into transactions without duplicates. Email bodies are never stored. See [Gmail OAuth](docs/operations/gmail-oauth.md). |
| Classification | Imported and manual transactions are categorized by deterministic rules. A manual correction is never overwritten by automation, and reclassifying is explicit. |
| Budgets and alerts | Set budgets with thresholds. In-app alerts cover budget thresholds, large transactions, goal risk, cashflow risk, repeated sync failures, and Gmail reconnect-required. Critical alerts can also be emailed when the operator configures SMTP. |
| Goals | Create savings goals and see a deterministic feasibility result computed from your real completed months of cash flow. |
| Operations | A first administrator is provisioned from the host. Administrators create and update parser templates and manage users. Every user sees their own sync and parser pipeline status on the Ops page (`/app/ops`). |

## Scope boundaries

In scope for this release:
- email/password authentication and Gmail read-only OAuth;
- **manual, user-triggered** Gmail sync with a bounded initial backfill;
- the parsers declared in [supported parsers](docs/operations/supported-parsers.md), currently one synthetic Vietcombank email format (`bank_vcb` EMAIL v1);
- one single-host deployment behind an operator-provided HTTPS proxy.

Deferred (post-MVP), so they are **not** part of this release:
- **scheduled or background sync:** there is no scheduler, worker, or queue. Alerts are evaluated when a user action triggers them, so a condition that becomes true only because time passed is noticed at the next qualifying action;
- **alert types:** category spike, a separate parser-issue alert, notification-delivery-failure alerts, and summary emails;
- **SC-012 usability acceptance:** moderated testing with representative first-time users; release readiness relies on automated journey evidence instead;
- account-wide export and deletion automation. Financial records and minimum email metadata stay until the user deletes them; see [Troubleshooting](docs/operations/troubleshooting.md#retention-and-deletion);
- Outlook, SMS, CSV, or direct bank APIs; ML or LLM classification; push notifications; multi-node or horizontally scaled deployment.

## Architecture

```text
Browser ── https://<public-origin> ──► reverse proxy (TLS, operator-provided)
                                          ├── /api/*  ──► api  (NestJS, 127.0.0.1:3000)
                                          └── /*      ──► web  (static React build, 127.0.0.1:8080)
api ──► PostgreSQL 16 (private network only)
api ──► Google OAuth / Gmail API (read-only, during manual sync)
api ──► SMTP relay (optional, for critical alert emails)
```

- **API** (`apps/api`): NestJS 11 with Prisma 7 on PostgreSQL 16. Its modules live in `apps/api/src/modules`:
  - `auth`, `users`: registration, sessions, the administrator bootstrap;
  - `transactions`, `transaction-categories`, `financial-accounts`;
  - `dashboard`, `analytics`;
  - `email-connections`, `email-listen-rules`, `email-ingestion`, `parser`, `bank-providers`;
  - `budgets`, `alerts`, `goals`;
  - `health`.
- **Behavior common to every endpoint:**
  - every response is enveloped: `{success, data, message, timestamp, correlationId}`;
  - errors carry `code`, `message`, and `correlationId`, plus `fields` on validation errors;
  - logs are structured and redacted pino logs.
- **Web** (`apps/web`): React 19, refine, antd, and Vite. It calls the API at the relative `/api` in production.
- **Database schema:** `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations`.
- **API contracts:** two OpenAPI artifacts with different roles (see "API contract flow" below):
  - `apps/api/docs/swagger.json` is generated from the running code. It is the source of the `@repo/api-contract` types that the web app uses.
  - `specs/001-operational-mvp/contracts/openapi.yaml` is the feature's specification contract. Requirements and release evidence are compared against it; it is written by hand and never generated.

### Principal data flow

1. **Manual entry:** the web app sends `POST /api/transactions`. The API validates it, classifies it, stores it, and evaluates the alerts it affects.
2. **Gmail import:**
   1. The user starts a sync (`POST /api/email-connections/{id}/sync`).
   2. The API lists at most one page of new messages that match the user's listen rules, reads each body **only in memory**, and parses it with the declared bank template.
   3. The resulting transaction is deduplicated by provider message id, then transaction identity, then a deterministic fingerprint.
   4. The transaction is classified and alerts are evaluated. Only metadata, a body hash, and sanitized parser evidence are stored.
   5. If more messages remain, the run reports `hasMore`, and the user continues.
3. **Read models:** the dashboard, budgets, and goal feasibility are computed from stored transactions, following the period, time-zone, and currency policy in `specs/001-operational-mvp/spec.md`.
4. **Alerts:** each qualifying action evaluates the alert conditions. An alert stays active until its condition clears or the user dismisses it. Eligible critical alerts get one email delivery record, sent through SMTP or skipped when email is disabled.

### Extension seams for post-MVP AI (not implemented)

AI Financial Insight and ML classification are **not** part of this release, and no code exists for them. When they are separately specified, they stay inside this modular monolith, not in a separate service:
- **Classification.** The existing classification domain keeps owning the policy and its orchestration (`apps/api/src/modules/transactions/classification.service.ts` and its rule model). ML would plug in as one more classification strategy behind a port in that domain, never as a second, parallel classification flow. Until then, classification stays exactly: manual lock → user rules → system rules → deterministic fallback.
- **AI Financial Insight.** A new `apps/api/src/modules/ai/` module (for example `insights/` plus `providers/` for model clients). It reads through the same owner-scoped repositories and financial period policy as the dashboard. It is distinct from today's deterministic, rule-based dashboard insights (`GET /api/dashboard/insights`, the contract's `DashboardInsight`).

## Monorepo map

| Path | Contents |
|---|---|
| `apps/api` | NestJS API, Prisma schema and migrations, API tests (`src/**/*.spec.ts` unit, `test/*.e2e-spec.ts` integration), admin bootstrap CLI (`src/scripts/bootstrap-admin.ts`) |
| `apps/web` | React web app, Vitest component tests (`src/**/*.test.tsx`), Playwright browser tests (`e2e/`) |
| `packages/api-contract` | Types-only API contract generated from the API's OpenAPI document; the web app imports response types from it |
| `packages/typescript-config` | Shared compiler settings: `base.json`, `node-nest.json` (API), `react-vite.json` (web) |
| `packages/eslint-config` | Shared ESLint building blocks: `base`, `node` (API), `react` (web) |
| `docker-compose.yml` | Development stack: PostgreSQL, API (watch mode), and web (Vite) |
| `docker-compose.prod.yml` | Release stack: PostgreSQL, one-off `migrate`, API, and web images on a private network, loopback ports only |
| `docker-compose.bench.yml` | Benchmark-only override for the dashboard benchmark |
| `scripts/init-local-env.ps1` | Generates git-ignored env files with random secrets |
| `scripts/scan-secrets.ps1` | Release secret scan (pinned gitleaks) |
| `scripts/verify-release.ps1`, `scripts/release/reference-proxy.nginx.conf` | Release verification and the illustrative TLS proxy configuration |
| `docs/operations` | Operator and developer documentation |
| `specs/001-operational-mvp` | Specification, plan, data model, contract, tasks, and release checklists |

## Workspace and quality commands

Yarn 4 workspaces (`apps/*`, `packages/*`) are orchestrated by Turborepo. Business code stays in one NestJS modular monolith (`apps/api/src/modules/*`); the shared packages hold only configuration and the generated API contract.

| Root command | Runs in every workspace that defines it |
|---|---|
| `yarn build` | `build`: API `nest build` → `apps/api/dist`, web `tsc && vite build` → `apps/web/dist` |
| `yarn lint` | `lint`: check only; `yarn workspace api lint:fix` is the explicit auto-fix |
| `yarn check-types` | `check-types`: API sources and tests, web app/Vite config/Playwright specs, and the API contract (including its staleness check) |
| `yarn test` | `test`: API unit tests (Jest) and web component tests (Vitest) |
| `yarn contract:check` | The API contract chain (below); not cached, because it needs a full `nest build` |
| `yarn quality` | **The official local quality gate:** `lint`, `check-types`, `build`, `test`, then `contract:check`. Run it before every commit or merge. |

**API contract flow.** There are two OpenAPI artifacts, and only one of them feeds code:

```text
Nest controllers + response DTOs (each mapper/service declares its DTO as return type)
  → apps/api/docs/swagger.json                      yarn workspace api swagger:generate
  → packages/api-contract/src/generated/openapi.ts  yarn workspace @repo/api-contract generate
  → apps/web                                        import type { … } from "@repo/api-contract"

specs/001-operational-mvp/contracts/openapi.yaml    the specification contract: written by hand,
                                                    compared against swagger.json (paths, schemas)
                                                    for requirement verification; never generated
```

- **Generated outputs:** both are committed.
- **Staleness gate:** `yarn contract:check` fails when either generated link is stale.
  - `swagger:check` rebuilds the document from code and compares it with `swagger.json`.
  - The contract check compares the generated types with `swagger.json`.
- **Where it runs:** it is part of `yarn quality`, and `scripts/verify-release.ps1` runs it as a failing release check.
- **Other guards:**
  - `apps/api/src/swagger.spec.ts` fails if a contract response schema disappears.
  - Each response DTO is its mapper's (or service method's) declared return type, so the documentation cannot drift from the runtime shape.

See [`packages/api-contract/README.md`](packages/api-contract/README.md).

**Turbo cache.**
- `build`, `lint`, `check-types`, and `test` are cached locally (`.turbo/`). Their inputs are the workspace files plus, through the `transit` task, the files of the workspaces they depend on. A web-only change therefore reuses the API results, and a change to `@repo/api-contract` or `@repo/typescript-config` re-runs its dependents.
- Declared extra inputs:
  - the API `test` hashes `apps/web/src/features/goals/components/GoalsPage.tsx`, which one API test reads;
  - the contract `check-types` hashes `apps/api/docs/swagger.json`.
- **Environment and env files:**
  - Root env files (such as `.env.release-test`) are **not** inputs of any task, so they never invalidate or enter the cache. `apps/api/.env` is git-ignored, so the API's default inputs skip it as well.
  - The web `build` is the one task that hashes env input: its own `apps/web/.env*` files (Vite reads them at build time) and the `VITE_API_BASE_URL` variable. Changing either rebuilds the web bundle.
  - Turbo runs in strict env mode: a task sees only the variables it declares, plus pass-through variables for `test:e2e`.
  - Only `dist/**` build outputs are cached and restored. Env files are never cache outputs, and no secret is stored as a build artifact.
- Deliberately **not** cached, and usually run directly with `yarn workspace …`: integration and browser tests (`test:e2e`, which need PostgreSQL or the running stack; Turbo defines them with `cache: false`), `dev`, `swagger:generate`, migrations, the migration matrix, the secret scan, and release verification.
- No remote cache is configured. It can be added later for CI (`turbo login`/`turbo link`) without changing the task graph.

## Documentation

| Document | Use it to |
|---|---|
| [Local development](docs/operations/local-development.md) | Set up a machine, run the stack, run tests, and follow the timed **Smoke flow** |
| [Gmail OAuth](docs/operations/gmail-oauth.md) | Configure Google OAuth, listen rules, and manual sync |
| [Supported parsers](docs/operations/supported-parsers.md) | See which bank email formats are supported and how they are gated |
| [Deployment](docs/operations/deployment.md) | Deploy behind HTTPS, provision the first administrator, back up, upgrade, and roll back |
| [Troubleshooting](docs/operations/troubleshooting.md) | Diagnose startup, database, proxy, Gmail, parser, sync, and alert problems |
| [Requirement traceability](specs/001-operational-mvp/checklists/test-traceability.md) | Find the automated evidence for each requirement |
| [Release evidence](specs/001-operational-mvp/checklists/release-evidence.md) | See the latest release checks and the limitations still open |

## Quick start (development)

Prerequisites: Node 22 with Corepack, Docker with Compose v2, Git, and PowerShell 7.

```powershell
git clone <repository-url> cashlens
cd cashlens
./scripts/init-local-env.ps1
docker compose --env-file apps/api/.env up -d
```

The web app is served at `http://localhost:5173` and the API at `http://localhost:3000/api`. The first start installs dependencies inside the containers and can take several minutes. The full procedure, including port overrides and the first administrator, is in [Local development](docs/operations/local-development.md).
