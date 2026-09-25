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
- **Contract:** `specs/001-operational-mvp/contracts/openapi.yaml`; the generated document is `apps/api/docs/swagger.json` (`yarn workspace api swagger:generate`).

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

## Monorepo map

| Path | Contents |
|---|---|
| `apps/api` | NestJS API, Prisma schema and migrations, API tests (`src/**/*.spec.ts` unit, `test/*.e2e-spec.ts` integration), admin bootstrap CLI (`src/scripts/bootstrap-admin.ts`) |
| `apps/web` | React web app, Vitest component tests (`src/**/*.test.tsx`), Playwright browser tests (`e2e/`) |
| `packages/eslint-config`, `packages/typescript-config` | Shared lint and TypeScript configuration |
| `docker-compose.yml` | Development stack: PostgreSQL, API (watch mode), and web (Vite) |
| `docker-compose.prod.yml` | Release stack: PostgreSQL, one-off `migrate`, API, and web images on a private network, loopback ports only |
| `docker-compose.bench.yml` | Benchmark-only override for the dashboard benchmark |
| `scripts/init-local-env.ps1` | Generates git-ignored env files with random secrets |
| `scripts/scan-secrets.ps1` | Release secret scan (pinned gitleaks) |
| `scripts/verify-release.ps1`, `scripts/release/reference-proxy.nginx.conf` | Release verification and the illustrative TLS proxy configuration |
| `docs/operations` | Operator and developer documentation |
| `specs/001-operational-mvp` | Specification, plan, data model, contract, tasks, and release checklists |

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
