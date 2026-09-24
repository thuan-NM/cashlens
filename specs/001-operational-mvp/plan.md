# Implementation Plan: Operational CashLens MVP

**Branch**: `feat/thuan/backend-mvp-modules-and-docker-compose` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

## Summary

Complete the current NestJS/React/Prisma modular monolith in place. Retain existing modules, API envelope, PostgreSQL schema lineage, Gmail read-only OAuth flow, Refine providers, and three-service deployment shape. Sequence work as P0 security/runtime hardening, P1 completion of financial flows, and P2 validation/operability. Do not add a queue, scheduler, microservice, ML/LLM classifier, or new state framework.

## Technical Context

**Language/Version**: TypeScript 5.7+ API, TypeScript 5.8+ web, Node.js 22 release image  
**Primary Dependencies**: NestJS 11, Prisma 7, PostgreSQL, Passport/JWT, bcrypt, class-validator, nestjs-pino; React 19, Vite 6, Refine 5, Ant Design, Zustand  
**Storage**: PostgreSQL 16; encrypted Gmail credentials; no raw email body retention  
**Testing**: Jest 30, ts-jest, and Supertest (API); Vitest with Testing Library, the only component runner (T096); Playwright with headless Chromium, the only browser E2E runner, run against the development stack (T096a)  
**Target Platform**: One Linux host behind HTTPS with API, static web, and persistent PostgreSQL services  
**Project Type**: Brownfield TypeScript monorepo web application  
**Performance Goals**: 95% of typical dashboard loads within one second; bounded sync always returns observable outcome  
**Constraints**: Strict ownership; admin cannot read private financial/email data; manual Gmail sync only; deterministic non-AI calculations; no committed secrets  
**Scale/Scope**: Personal-finance MVP; one active manual sync per connection; no horizontal coordination

## Brownfield Findings

- GitNexus identifies cohesive existing Auth, Users, Transactions, Email, Parser, Budgets, Alerts, Goals, Dashboard, and frontend areas. Extend these rather than replace them.
- Auth already has access/refresh cookies and hashed refresh-token rotation. Harden configuration and client renewal without changing protocol.
- Financial repositories mostly scope by owner; close exceptions and test them instead of introducing a policy engine.
- Gmail OAuth, encrypted tokens, listen rules, sync runs, metadata, parser invocation, and per-message isolation already exist. Add progress, exclusion, retry, and event-level dedupe.
- Reuse `MerchantRule`, transaction classification fields, budget aggregates, Alert CRUD/settings, Goal CRUD, and existing frontend API consumers.
- Replace the goal mapper's fixed `assumedFreeCashflow`; remove runtime reliance on frontend mock data.

## Constitution Check

The constitution is an unratified placeholder, so no project-specific gate can be evaluated. Provisional feature gates all pass: brownfield preservation, P0-before-P1 security, minimal infrastructure, shared deterministic financial policy, privacy by default, and requirement-mapped release evidence. Post-design re-check also passes. Ratifying a constitution later requires re-evaluating this plan.

## Project Structure

```text
specs/001-operational-mvp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/openapi.yaml
└── tasks.md                 # generated later by $speckit-tasks

apps/api/
├── prisma/{schema.prisma,migrations/}
├── src/common/
├── src/modules/{auth,users,transactions,transaction-categories,email-connections,email-listen-rules,email-ingestion,parser,budgets,alerts,goals,analytics,dashboard}/
└── test/
apps/web/src/{api,providers,stores,components,features}/
docker-compose.yml
README.md
```

**Structure Decision**: Keep the Yarn/Turbo `apps/api` + `apps/web` monorepo. Put new behavior in the nearest existing module; cross-cutting additions are limited to small guards, config, logging, error, and financial-period utilities.

## P0 — Security and Runtime Blockers

| Change | Existing area | Requirement IDs | Dependencies | Expected validation | API / DB behavior |
|---|---|---|---|---|---|
| P0.1a Split self-service from admin user operations; add role guard reading persisted role; remove `role`/`status`/ownership fields from register, self-service, and non-admin DTOs; add self-service `PATCH /users/me` (profile fields only); admin account views omit settings; make parser-template writes admin-only (bank providers have no write routes: unsupported, 404) | `users/*`, `auth/*`, `bank-providers/*`, `parser/parser.controller.ts`, `common/guards` | SEC-002–005, SEC-007–008, AUTH-004 | None | Guard units; two-user/admin Supertest matrix; mass-assignment tests proving today's self-promotion via `PATCH /users/:id` is closed | Security tightening: ordinary callers get 403 on admin routes whatever fields a well-formed JSON body contains (authorization precedes validation; malformed JSON is 400 for every caller); `role`/`status` on self-service and registration bodies → 400; no DB change |
| P0.1b Operator-run first-admin bootstrap script (promote existing ACTIVE user; zero-active-admin guard; advisory-locked transaction; SYSTEM audit; exit codes; `--list-admins`/`--revoke` upgrade review because earlier releases allowed self-promotion; dev runs via ts-node, prod via `node dist/…`) reusing the `generate-openapi.ts` standalone-script build pattern with validated config | `src/scripts/bootstrap-admin.ts`, `src/scripts/bootstrap-admin.module.ts`, `src/modules/users/admin-bootstrap.service.ts`, `apps/api/package.json` | SEC-003, SEC-009, AUTH-005, SC-015 | P0.1a, P0.4 | Script integration tests in an isolated e2e schema: promote, idempotent rerun, admin-exists refusal, missing/disabled/pending-deletion/deleted/passwordless refusal, concurrent runs → one admin, list/revoke, no secret output | No API/DB change; new package script `admin:bootstrap` |
| P0.2 Enforce owner-scoped reads/writes everywhere and reject disabled/deleted users in JWT validation, split by resource group (finance core; planning/alerts; email pipeline; users/settings) | all owned module repositories/services, `jwt.strategy.ts` | SEC-001, SEC-005–008, DATA-004, TEST-003 | P0.1a | Cross-user test→fix pair per resource group; malformed IDs; disabled/deleted sessions | Consistent 401/403/owner-safe 404; no expected migration |
| P0.3 Harden cookie/session policy per the TLS boundary (config-driven `Secure`/`HttpOnly`/`SameSite=Lax`, `trust proxy` = `TRUST_PROXY` hop, production `HTTPS_REQUIRED` 403 on auth/session-issuing routes, health exempt) and add one client refresh attempt without replaying unsafe mutations | auth controller/service, `main.ts`, `web/src/api/client.ts`, auth provider | AUTH-001–005, OPS-009, ERR-002, TEST-002/004/006 | P0.4 | Cookie flags, HTTPS refusal, expiry/rotation/reuse E2E, non-idempotent no-replay | Environment-dependent cookies; production-only 403 `HTTPS_REQUIRED` on plain-HTTP auth; envelope preserved; no DB change |
| P0.4 Add typed startup validation, placeholder rejection (including production `https`-only origins/callback/public URL and `TRUST_PROXY`), key-rotation guidance, and redaction | `app.module.ts`, `main.ts`, security/logger, `.env.example` | CFG-001–005, CFG-007, OPS-009, EMAIL-002, OPS-008 | None | Missing/empty/malformed/placeholder/`http://`-in-production config matrix | Startup fails early; no API/DB change |
| P0.5 Add liveness/readiness and graceful shutdown; readiness checks DB | `main.ts`, Prisma, small health module, Docker healthchecks | OPS-002–005, ERR-004 | P0.4 | Health Supertest, DB outage, SIGTERM smoke | Add `/health/live` and `/health/ready`; no migration |
| P0.6 Add immutable release images/compose with no source mounts/install/watch startup; web image built with relative `VITE_API_BASE_URL=/api` for same-origin proxy routing; config via `--env-file` only; API and web published on `127.0.0.1` only, database unpublished; pinned `cashlens_net` (`172.28.0.0/24`) with a `TRUST_PROXY` starting value that T100 verifies; one-off `migrate` service from a Dockerfile `tools` stage; keep current compose for development | Dockerfiles, compose/env docs | OPS-001–006, OPS-009, CFG-002–004 | P0.4–P0.5 | compose config (loopback-only bindings, pinned network), `run --rm migrate`, clean build/up, health, restart/persistence | Packaging only; migration deploy is the explicit `migrate` one-off run before `api` |
| P0.7 Deterministic secret scan: gitleaks `v8.30.1@sha256:c00b6bd0…abbb7f` via Docker; **Git-selected file set** (`git ls-files --cached --others --exclude-standard`) staged to a temp dir for `dir` mode, plus `git` mode over `<historical baseline>..HEAD` (default baseline `80f3e0d`, the last commit of this branch merged into `dev`; the range also covers the implementation baseline `b273f14`); `.gitleaks.toml` (default rules + OAuth/refresh-token + non-synthetic fixture email rules); allowlist = shared production placeholder list only; the only other exceptions are reviewed exact commit-scoped fingerprints in `.gitleaksignore` (currently two synthetic fixtures in pushed commit `219f8e9`); inline `gitleaks:allow` ignored; exit 0/1/2 | `scripts/scan-secrets.ps1`, `.gitleaks.toml`, `apps/api/src/config/placeholder-secrets.ts` | CFG-002, CFG-006, SC-003, TEST-008 | P0.4 (placeholder list) | Ignored `.env` with synthetic secret → 0; unignored untracked planted secret → 1; committed-then-removed secret in feature range → 1; missing or unrelated base ref → 2; clean → 0; an exception covers only its exact commit, path, rule, and line | Tooling only |

## P1 — Core Incomplete MVP Behavior

| Change | Existing area | Requirement IDs | Dependencies | Expected validation | API / DB behavior |
|---|---|---|---|---|---|
| P1.1 Complete Gmail status/recovery/reconnect/disconnect and best-effort provider revocation | `email-connections/*`, OAuth service, Email page | EMAIL-001–003, DATA-002, ERR-003 | P0.2, P0.4 | OAuth-state units; lifecycle fixtures; secret-redaction checks | Add recovery/status fields; reuse current status columns |
| P1.2 Add bounded incremental sync, persisted continuation, one DB-backed lease per connection, and bounded retry/backoff | `email-ingestion/*`, Gmail API, connection repository, Email/Ops pages | EMAIL-004–007, EMAIL-009, EMAIL-013, ERR-003/006 | P1.1, DB-M1 | Concurrent sync, continuation, partial-failure, retry tests | Sync returns continuation; active run yields 409; DB-M1 |
| P1.3 Add layered event dedupe and strict parser validity; retain only sanitized evidence; declare ≥1 supported parser with fixtures; lock the raw-body preference (API rejects `storeRawEmailBody: true`, UI disabled/"unavailable") | ingestion, parser, transaction repository/schema, users settings DTO, Settings page | EMAIL-007–012, FR-08–11, DATA-001 | P1.2, DB-M2 | Malformed/repeated/cross-message fixture tests; deterministic parser choice; per-parser rate gate (0 parsers fails); raw-body preference e2e | Reject invalid posting; DB-M2 fingerprint/constraint; settings `storeRawEmailBody: true` → 400 `RAW_EMAIL_BODY_UNAVAILABLE`, additive `rawEmailBodyAvailable:false` |
| P1.4 Execute deterministic user/system classification, fallback, manual protection, explicit reclassify, and append-only decision history | transactions, categories, `MerchantRule`, Transactions page | CLASS-001–007, TX-004, SEC-006 | P0.2, DB-M3 | Full priority/tie matrix; correction/reprocessing integration | Add rules/reclassify/history contract; DB-M3 |
| P1.5 Centralize eligible-transaction, timezone/month-start, transfer, and currency policy across all totals | transactions, analytics, dashboard, budgets, goals queries | TX-001–005, DASH-001–004, DATA-004 | P0.2 | Golden aggregate fixtures and one-second benchmark | May add currency/period metadata; retain primary fields; no expected migration |
| P1.6a Alert lifecycle core: `AlertStatus` (`ACTIVE`/`DISMISSED`/`RESOLVED`) independent of `isRead`/`readAt`; open-key partial unique index; level-triggered `applyConditions()` (resolve non-holding, create when holds + no open + 24h since last `triggeredAt`); dismiss/unread-count; legacy/user-authored null-key handling (no delivery row); `defaultAlertSettings()` email `false`; email-requires-in-app on writes | `alerts/alert-lifecycle.service.ts`, `alerts.repository.ts`, alerts controller/service/DTOs/mapper | ALERT-001–005, ALERT-010, ALERT-011 | DB-M4 | Lifecycle units (clock-controlled); read≠resolve; dismissed blocks dedupe; concurrent insert → single open row | `PATCH /alerts/:id/dismiss`, `GET /alerts/unread-count`, `status` filter and fields; DB-M4 |
| P1.6b Budget threshold semantics + budget evaluator: `thresholdPercent` = warning (1–99 on write), fixed 100% critical, legacy ≥100 = no warning; **MONTHLY-only evaluation** with user-month instances clipped to `startsAt`/`endsAt`; non-MONTHLY flagged `alertsSupported:false`; shared pure threshold function and shared Prisma-backed `common/finance/budget-spend.query.ts` reused by budgets, dashboard hot-budgets, and alert inputs | budgets DTO/mapper/service, `dashboard.repository.ts`, `common/finance/budget-spend.query.ts`, `alerts/evaluators/budget-threshold.evaluator.ts` | BUDGET-001–005, ALERT-009 (budget rows) | P1.5, P1.6a | Evaluator units per row incl. month-start-day and start/end clipping; non-MONTHLY never evaluated | Write validation 1–99 (400 otherwise); additive `warningThresholdActive`, `criticalThresholdPercent`, `alertsSupported`, `usageBasis`; `POST /budgets/:id/recalculate` |
| P1.7a Remaining evaluators, one per matrix row, each an independent pure function + own spec: large transaction, goal risk, cashflow risk, repeated sync failure, reconnect required; inputs supplied by `alerts/queries/alert-inputs.query.ts` (see dependency direction below) | `alerts/evaluators/*.evaluator.ts` | ALERT-008, ALERT-009, GOAL-003/004 | P1.6a; goal/cashflow rows also P1.8 | Per-evaluator unit specs using data-model worked examples + per-row integration | No new API; evaluator outputs feed P1.6a |
| P1.7b Wire evaluators into trigger points after the triggering write commits (transaction mutations, **imported transactions once per committed sync batch**, budget writes, goal writes, sync terminal state, connection status transitions); evaluation failures are logged and never fail the request | `transactions.service.ts`, `budgets.service.ts`, `goals.service.ts`, `email-ingestion.service.ts`, `email-connections.service.ts` | BUDGET-003, ALERT-009 "Evaluated on" column | P1.6b, P1.7a, P1.2 (sync), P1.1 (connection) | Mutation→alert integration per trigger | No new API |
| P1.7c Email delivery adapter: `EmailTransport` port with `smtp` (nodemailer) / `log` (non-prod, redacted) / `disabled`; in-memory fake via DI; `AlertDelivery` rows (evaluator-created alerts only) with skip reasons; post-commit bounded 3 attempts; interrupted-PENDING sweep; privacy-minimal content | `alerts/delivery/*`, `alerts.module.ts`, config | ALERT-005–007, CFG-007, ERR-004 | P0.4, DB-M5, P1.6a | Fake-transport units: skip matrix, 1/2/3 attempts, timeout, budget exhaustion, 5xx no-retry, interrupted sweep, no sensitive content | Additive delivery fields on alert responses; DB-M5 |
| P1.8 Replace fixed goal capacity per the data-model rules: inclusive user-month periods, horizon precedence with visible `horizonSource`, ceil required saving, floor available cashflow and score, observation history from earliest goal-currency transaction; shared `common/finance/completed-month-cashflow.ts`; remove the web `3900000` fallback | goals service/repository/mapper, `goals/goal-feasibility.ts`, `common/finance/completed-month-cashflow.ts`, Goals page | GOAL-001–007, SC-008 | P1.5 | Worked examples G1–G10 exactly; band edges; 0/1/2/3-month; negative/past-deadline | Intentional simulation status/evidence correction; `targetDate` now honored; `months` = remaining periods; field names `monthlyRequired`/`feasibilityScore` kept; additive `horizonSource`, `pastDeadline`; no expected migration |
| P1.9 Complete web contracts and states: refresh, typed mapping, correction, sync continuation, alerts (lifecycle + read state + delivery), goal insufficiency, loading/empty/error/retry; remove mock fallback | web API/providers/stores/all feature pages | AUTH-002, EMAIL-003/005, CLASS-005/006, ALERT-004/006/010, GOAL-004/005, CFG-007, ERR-001–005 | Corresponding backend items | Component and browser smoke tests | Consumes changed/additive API; no DB change |

### Email delivery adapter (P1.7c)

| Aspect | Decision |
|---|---|
| Boundary | `EmailTransport` port: `send({to, subject, text}) → {messageId}`. Only `AlertDeliveryService` calls it; evaluators and controllers never do. |
| Transports | `EMAIL_TRANSPORT=disabled` (default) · `smtp` (nodemailer) · `log` (redacted, non-production only) |
| Config keys | `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `APP_PUBLIC_URL`, optional `EMAIL_ATTEMPT_TIMEOUT_MS` (5000), `EMAIL_TOTAL_BUDGET_MS` (12000) |
| Production behavior | `smtp` requires all SMTP keys + `EMAIL_FROM` + `APP_PUBLIC_URL` validated at startup, and placeholders are rejected. `log` makes startup fail. `disabled` is valid, and the UI shows email as unavailable. |
| Test transport | An in-memory fake bound through Nest DI override. It records messages, can be scripted to succeed, fail with 4xx, 5xx, or auth errors, or time out, and never touches the network. |
| Retry | Up to 3 total attempts with 500 ms and 1000 ms backoff. Each attempt is capped at `EMAIL_ATTEMPT_TIMEOUT_MS`, and all attempts stop at `EMAIL_TOTAL_BUDGET_MS`. Timeout, connection errors, and 4xx responses are retried; 5xx and auth failures are not. |
| Failure behavior | Runs after the alert and delivery row commit. The final failure is recorded as `FAILED` with a sanitized code and message. Delivery errors never propagate to the triggering request and never roll back the alert. A stale `PENDING` row is marked `FAILED/INTERRUPTED` on the next read or evaluation and is never resent. |
| Not introduced | Queue, worker, outbox poller, scheduler, or provider SDK |

### Alert module dependency direction (P1.7a/P1.7b)

```text
TransactionsModule ─┐
BudgetsModule ──────┤
GoalsModule ────────┼──> AlertsModule ──> PrismaModule (@Global) + common/finance/* (plain helpers)
EmailIngestionModule┤
EmailConnectionsModule┘
```

- **Direction.** Dependencies point one way only.
  - Feature modules import `AlertsModule` and call `AlertEvaluationService.on*()`.
  - `AlertsModule` imports **no** feature module and uses no `forwardRef`.
- **Evaluator inputs** come from `alerts/queries/alert-inputs.query.ts`, which uses the global `PrismaService` plus these shared Prisma-backed helpers:

  | Helper | Created by |
  |---|---|
  | `common/finance/financial-period-policy.ts` | T032 |
  | `common/finance/completed-month-cashflow.ts` | T059 |
  | `common/finance/budget-spend.query.ts` | T070 |
  | `goals/goal-feasibility.ts` (pure, no Nest provider) | T060 |

- **Evidence this introduces no cycle.**
  - `PrismaModule` is `@Global()`.
  - `AlertsModule` currently has no `imports`.
  - No feature module imports `AlertsModule` today.
- **Verified by T079.** The `alerts.module.ts` imports list contains no feature module, and the app boots with no circular-dependency warning.
- **As built (T079–T083).**
  - `ParserModule` also imports `AlertsModule`: `POST /email-messages/:id/parse` can create an imported transaction, which must be evaluated like any other.
  - The shared budget threshold rule is `common/finance/budget-threshold.policy.ts`. `budgets/budget-threshold.policy.ts` only re-exports it, so the alert code and the dashboard never import the budgets feature.
  - `alerts.architecture.spec.ts` asserts:
    - no module `imports`;
    - no `forwardRef(`;
    - no feature import other than `goals/goal-feasibility`;
    - that `goal-feasibility` itself imports no Nest code and no feature.
  - `AlertsModule` provides its own `Clock`. The e2e suites override it for every module at once.

### TLS boundary and same-origin routing (OPS-009, AUTH-003)

- **Where TLS terminates.** An operator-provided reverse proxy or platform load balancer outside the repository. No certificate management lives in the repository.
- **One public origin.** Web and API share one origin, for example `https://cashlens.example`. The proxy routes:

  | Path | Upstream |
  |---|---|
  | `/api/` | `http://127.0.0.1:3000`, path preserved, because the API's global prefix is already `/api` |
  | `/` (everything else) | `http://127.0.0.1:8080`, the static web container, which serves the SPA fallback |

- **Relative API path.** The release web image is built with `VITE_API_BASE_URL=/api` as a Docker build argument (T007). The bundle therefore contains no absolute API origin, and the same image works on any hostname.
- **Cookies.** Browser calls are same-origin, and `credentials: 'include'` is kept. Cookies are `Secure; HttpOnly; SameSite=Lax; Path=/`, so no cross-site cookie exception is needed.
- **Public URLs.** `CORS_ORIGIN` and `APP_PUBLIC_URL` equal the public origin. `GMAIL_REDIRECT_URI` is `<origin>/api/email-connections/gmail/callback`.
- **Production compose.**
  - The API and web are published on `127.0.0.1` only.
  - PostgreSQL is not published.
  - Services join a user-defined network `cashlens_net` with a pinned subnet `172.28.0.0/24`, for predictable addressing.
- **TRUST_PROXY is verified, not assumed.** `TRUST_PROXY` must cover the peer address the API actually observes for requests forwarded by the proxy on the reference release host.
  - The compose default `loopback,172.28.0.1` is only a starting value; no gateway behavior is assumed.
  - T100 sends a request through the proxy and reads the peer address from the API's structured request log (the `remoteAddress` field, which redaction keeps). It fails unless `TRUST_PROXY` covers that address.
  - The verified value is recorded in release evidence and set in the deployment env file.
  - A containerized proxy on `cashlens_net` gets a fixed IP, which becomes `TRUST_PROXY`.
  - The development default is `loopback`.
- **API in production.**
  - `trust proxy` is set from `TRUST_PROXY`.
  - Register, login, refresh, logout, and the OAuth callback refuse a non-`https` effective protocol with 403 `HTTPS_REQUIRED`.
  - `/api/health/*` is exempt.
- **Config in production.** Values for `CORS_ORIGIN`, `APP_PUBLIC_URL`, and `GMAIL_REDIRECT_URI` must be `https://`.
- **Direct loopback calls** (`http://127.0.0.1:3000`, no forwarded header) are used only for the health check and the negative plain-HTTP login check. Release checks and the benchmark otherwise go through the proxy's public origin.
- **Migrations in production.** The runtime image carries no Prisma CLI, and the database is unpublished.
  - A one-off `migrate` service, built from the Dockerfile `tools` stage (Prisma CLI, `prisma/`, `prisma.config.ts`), runs `prisma migrate deploy` inside `cashlens_net`.
  - `api` depends on it with `service_completed_successfully`.
  - The operator command is `docker compose --env-file <env> -f docker-compose.prod.yml run --rm migrate`.
- **Configuration input.** `docker-compose.prod.yml` takes every setting through `--env-file`, and no environment file is committed. Real deployments keep their env file outside the repository.

### Reference release host and release-test profile (M1, M3)

- **Reference release host.** This is where T100 and T101 run authoritatively; results from any other host are informative only.
  - It is the documented Linux x86_64 deployment or CI host (a VM, bare-metal server, or CI runner) running Docker Engine, not Docker Desktop.
  - It has at least 2 vCPU, 4 GB RAM, and SSD storage.
  - The documented reverse proxy (T105) terminates TLS on it for a release-test hostname. The certificate comes from the operator's CA or a local test CA, which the check scripts trust through `NODE_EXTRA_CA_CERTS`.
  - Its description is recorded in release evidence.
- **Release-test profile.** `scripts/init-local-env.ps1 -Profile release-test -PublicOrigin https://<release-test-host>` (T003) generates `.env.release-test` at the repository root.
  - The file is ignored by `.gitignore`, which T003 updates, so it is outside the CFG-006 file set, and it is never committed.
  - It holds synthetic, release-safe values for every production setting:
    - `NODE_ENV=production`;
    - random JWT, encryption, and OAuth-state secrets and database password;
    - `https` origins derived from `-PublicOrigin`;
    - synthetic Gmail client values that are not real credentials and never work against Google;
    - `EMAIL_TRANSPORT=disabled`;
    - the `TRUST_PROXY` starting value.
  - No generated value is printed.
  - T036 (benchmark override), T100, and T101 all run `docker compose --env-file .env.release-test -f docker-compose.prod.yml …`.
- **Verified by T100** on the reference release host, through the proxy:
  - `https://<host>/` serves the web app;
  - the web bundle contains no absolute API origin, only a relative `/api`;
  - `https://<host>/api/health/ready` returns 200;
  - login through the proxy sets `Secure; HttpOnly; SameSite=Lax` cookies, and an authenticated same-origin call with credentials succeeds;
  - the observed proxy peer address is covered by `TRUST_PROXY` and is recorded;
  - direct `http://127.0.0.1:3000` login without a forwarded header returns 403 `HTTPS_REQUIRED`;
  - loopback health returns 200;
  - `http://` origins are rejected at startup;
  - loopback-only bindings and the pinned network are in place.

### Dashboard benchmark (DASH-004, SC-010)

The fixture and runner are defined in research.md "Dashboard benchmark".

| Task | Role |
|---|---|
| T036 | Builds the generator, the runner, and the benchmark-only compose override `docker-compose.bench.yml` (used with `--env-file .env.release-test`), and runs a non-gating 20-load smoke check |
| T101 | Runs the gating benchmark on the **same reference release host and profile** as T100 |

**T101 procedure.** The disposable stack (`-p cashlens-bench`, own volume) temporarily replaces the release-check stack on the same loopback ports, behind the same proxy. The runner calls `https://<release-test-host>/api`, the same path users take.

`docker-compose.bench.yml` is test-only. It publishes the benchmark stack's PostgreSQL on `127.0.0.1:55432` solely so the host-side seeder can load the fixture. The seeder reads its credentials from `.env.release-test` without printing them. Production compose never publishes the database.

The gate passes when the 190th of 200 sorted sequential six-request loads is 1,000 ms or less, with zero failures.

### E2E test strategy (U3, C1)

- **Browser E2E target.** Browser E2E (T096a/T099) runs against the **development compose stack** (`NODE_ENV=development`).
  - The Vite dev server is at `http://localhost:5173` and the API at `http://localhost:3000/api`.
  - First-admin bootstrap runs through `docker compose exec api yarn workspace api admin:bootstrap`.
  - Production-mode HTTPS behavior is verified by T012 (in-process) and T100 (reference release host), not by browser tests.

- **Test database.** API e2e suites run serially (`--runInBand`) against `E2E_DATABASE_URL`. A guard requires `test` in the database name.
- **Global-state suites.** First-admin bootstrap uses a **separate database** `test_e2e_<suite>_<epochMs>`: create it, migrate it, run, then `DROP DATABASE … WITH (FORCE)`. Schema-level isolation is not used, because the runtime `PrismaPg` adapter is built from the connection string alone, and node-postgres ignores Prisma's `?schema=` parameter.
- **Shared-schema suites.** They use run-scoped identities and targeted cleanup.
- **Runners.**
  - Vitest with Testing Library is the only component runner (T096).
  - Playwright with Chromium is the only browser E2E runner (T096a).

## P2 — Quality and Operability

| Change | Existing area | Requirement IDs | Dependencies | Expected validation | API / DB behavior |
|---|---|---|---|---|---|
| P2.1 Standard safe errors, field details, correlation IDs, Pino context/redaction | common, main, logger, adapters | ERR-001–006, OPS-008 | P0/P1 | Contract snapshots and captured-log redaction | Add stable error code/correlation ID; retain message |
| P2.2 Requirement-mapped backend units/integration using synthetic fixtures and the E2E test strategy above; ≥1 declared supported parser with ≥10 valid + ≥2 malformed synthetic fixtures each and an independent per-parser rate gate (0 declared parsers fails); exactly-3 replay test; dashboard benchmark generator/runner | colocated specs, `apps/api/test`, `apps/api/test/fixtures/email/<bank>/<channel>/<version>/`, `apps/api/test/benchmark/*`, `docs/operations/supported-parsers.md` | TEST-001–005, TEST-008, SC-004, SC-005, SC-010 | P0/P1 backend | CI/coverage; empty and upgraded DB; per-parser rate table; benchmark result | Test-only |
| P2.3 Minimal frontend suite: Vitest component tests, Playwright (Chromium) browser E2E, duplicate-submit protection | web test config/specs, `apps/web/playwright.config.ts` | TEST-005–006 | P1.9 | Headless critical journeys | Test-only |
| P2.4 Validate migration/container paths: empty, upgrade, repeat, outage, restart, persistent volume | Prisma, Docker, CI scripts | OPS-001–007, TEST-007 | DB-M1–M5, P0.6 | Automated release matrix | Migration behavior release-gated |
| P2.5 Replace starter docs with architecture, setup, Gmail, migration, test, deployment (incl. admin bootstrap, email transport, secret scan), backup/restore, privacy, troubleshooting, scope | READMEs, docs | DATA-003, DOC-001–005, OPS-007, SEC-009, CFG-006/007 | P2.2–P2.4 | Timed fresh-checkout walkthrough recorded for SC-001 | Documentation only |

## Database Migrations and Compatibility

The migrations form one strictly sequential stream: **DB-M1 → DB-M2 → DB-M3 → DB-M4 → DB-M5**. Repository inspection shows that DB-M1 (email tables) and DB-M3 (classification tables) do not reference each other. They still stay sequential because every migration edits the single `schema.prisma`, and Prisma generates each migration by diffing against the previously migrated state. DB-M5 hard-depends on DB-M4 (`AlertDelivery` → `Alert`).

| Order | ID | Depends on | Minimal change | Rollout/backfill | Risk |
|---|---|---|---|---|---|
| 1 | DB-M1 | `20260627090000_budgets_goals_alerts_dashboard` (latest existing) | Nullable connection cursor/backfill/lease fields; `EmailSyncStatus.EXPIRED`; `EmailSyncRun.emailsFailed` (default 0), `hasMore` (default false), continuation evidence; indexes | Existing connections start without cursor and run bounded reconciliation; leases expire safely | New enum value unusable in same migration; API must tolerate null legacy progress |
| 2 | DB-M2 | DB-M1 | Nullable transaction `deduplicationFingerprint` plus strategy evidence and owner-scoped uniqueness | Backfill only safely reconstructable rows; inspect collisions before constraint | Historical duplicates can block uniqueness; use expand/backfill/validate |
| 3 | DB-M3 | DB-M2 | Nullable `MerchantRule.userId` for system rules plus invariant; append-only `TransactionCategoryEvent` and winning-rule/manual metadata | Protect existing `MANUAL` records without fabricating events | Null uniqueness semantics need explicit system-rule constraints |
| 4 | DB-M4 | DB-M3 | `AlertStatus` enum; `status`, `conditionKey`, `thresholdValue`, `observedValue`, `periodStart/End`, `triggeredAt`, `resolvedAt`, `resolutionReason`, `dismissedAt`; open-key partial unique index; cooldown lookup index | Legacy rows → `status=ACTIVE`, `conditionKey=NULL`, `triggeredAt=createdAt` | Partial index needs explicit SQL (Prisma cannot express it) |
| 5 | DB-M5 | DB-M4 | `AlertDelivery` (EMAIL channel) with status/skipReason/provider/attempt 0–3 CHECK/sent/failure; unique `(alertId, channel)`. **Schema-only**: no `AlertSetting` data step (I2 decision: existing `emailEnabled` values preserved; release notes disclose the previous default) | No delivery backfill | Additive; email failure must not roll back in-app alert |

Budget threshold semantics need no migration. The write-validation change (1–99) is code-only, and legacy values of 100 or more are interpreted rather than rewritten.

Rules:

- Never edit old migrations. Each new migration is created only after the previous one is applied locally, with strictly increasing timestamps later than `20260627090000`.
- Test empty DB, the current latest migration, and repeated deploy **after each migration**.
- Add non-null or destructive constraints only after validation.
- Keep IDs and existing primary response fields.
- Require backup and rollback-to-previous-image guidance, because normal Prisma migration deployment is forward-only.

## API Compatibility

- Preserve `/api`, cookie auth, and the existing `BaseResponseDto` success envelope `{success, data, message, timestamp}` for **every** success response, including sync results and goal feasibility. P2.1 adds `correlationId` additively.
- Prefer additive fields/actions. Existing list/transaction/dashboard fields remain during MVP migration.
- Sync responses keep the existing `EmailSyncRun` field names (`id`, `emailsFound`, `emailsMatched`, `emailsParsed`, `transactionsCreated`, `errorMessage`) and status values (`RUNNING|SUCCESS|PARTIAL_FAILED|FAILED`). `EXPIRED`, `emailsFailed`, and `hasMore` are additive.
- Goal simulation keeps `goalId`, `months`, `targetAmount`, `savedAmount`, `remainingAmount`, `monthlyRequired`, and `feasibilityScore` (the web reads the last two). It adds `availableMonthlyCashflow`, `observationMonths`, `monthsRequired`, and `reason`.
- Intentional behavior changes:
  - 403, owner-safe 404, disabled-account 401, and active-sync 409 are security and concurrency changes.
  - `role`/`status`/ownership fields in self-service and registration bodies now return 400. On administrator-only routes (`/users` list, create, read, update, delete; parser-template writes) a non-administrator gets 403 whatever fields a well-formed JSON body contains, because authorization precedes body validation. Three malformed requests are refused before authentication for every caller: an encoded NUL (`%00`) in the URL gets 404; undecodable percent-encoding in a path parameter (for example `%FF`) and a body that is not valid JSON get 400.
  - Self-service profile updates move to `PATCH /users/me` (full name, timezone, locale, base currency); `/users/{id}` is administrator-only, and administrator account responses omit `settings`.
  - Transaction create/update reject `classificationSource`, `classificationConfidence`, and `status: DELETED` (400); deletion is `DELETE /transactions/{id}`, an audited soft delete. Empty related ids get 400.
  - Bank-provider writes are unsupported routes (404); the seeded list stays readable.
  - `POST /email-connections/gmail/connect` also sets the `gmailOAuthNonce` cookie, and the callback refuses (401) a state that is not bound to that browser or whose account is inactive.
  - Disabled, pending-deletion, and soft-deleted accounts lose sign-in, refresh, and existing sessions (401); refresh rotation is single-use under concurrency.
  - An id containing a NUL character is answered with 404 instead of a database error.
  - Financial totals (US2, data-model.md "Financial period policy"):
    - Dashboard and analytics `month` values, and the new `month` filter on `GET /transactions`, are user months in the account timezone with its month-start day, not UTC calendar months.
    - `income`, `expense`, and `netCashflow` now cover the base currency only. The additive `currency` and `currencies` fields carry every currency group, and other currencies are no longer added in.
    - The dashboard category breakdown now includes uncategorized expense and is no longer cut to 10 rows. Categories flagged `excludeFromAnalytics` stay out of every breakdown (unchanged), but their transactions count in all totals, so a breakdown can total less than the expense. The dashboard cashflow trend returns every month of the window, zero-filled. The analytics daily cashflow groups by the user's local date. Breakdown, trend, daily, and hot-budget rows gain an additive `currency` field.
    - `GET /transactions` gains additive `totals`, computed over every row matching the filters. The dashboard cashflow gains an optional end `month`, and the overview gains additive `periodStart`, `periodEnd`, and `timeZone`.
    - Stored currency codes that differ only in case count as one currency.
  - Transaction validation tightening (T034), all returned as 400 field errors:
    - `amount` must be greater than 0, with at most 2 decimals, and at most 9,999,999,999,999.99.
    - `currency` and base currencies must be upper-case ISO 4217 codes.
    - `transactionTime`, `postedDate`, list `from`/`to`, and analytics `from`/`to` need an ISO 8601 date-time with a UTC offset.
    - `isDuplicate: true` needs a `duplicateOfTransactionId`, and a transaction cannot reference itself.
    - List `month` cannot be combined with `from`/`to`, and `from` cannot be after `to`.
    - Profile, registration, and admin timezones must be IANA zones.
    - Malformed dashboard and analytics `month` values, and month keys outside 1900-01..2099-12, return 400 instead of failing.
    - `null` for `amount`, `currency`, `direction`, `transactionTime`, `status`, `isDuplicate`, or `duplicateOfTransactionId` returns 400; `page` is at most 1,000,000.
  - Classification (US4, data-model.md "TransactionCategoryEvent"):
    - A new transaction without a category is classified by the rules. Its `classificationSource` becomes `USER_RULE`, `SYSTEM_RULE`, or `FALLBACK` (no match: `categoryId` stays null) instead of `UNKNOWN`. `UNKNOWN` remains when the owner turned automatic classification off. The same applies to rows created by an email import.
    - `PATCH /transactions/{id}` with `categoryId: null` now stores a locked manual clear (`MANUAL`) instead of `UNKNOWN`. Any `categoryId` sent there is a manual correction with a category event, exactly like `PATCH /transactions/{id}/category`.
    - `PATCH /transactions/{id}/category` now requires the `categoryId` key: a category id or null. An empty body gets 400 instead of clearing the category. The response adds a `decision` object.
    - Transactions gain the additive fields `classificationRuleId` and `classifiedAt`. The write bodies reject both (400), as they already reject the other provenance fields.
    - Legacy rows with a category and `UNKNOWN` are backfilled to `MANUAL` (protected), with no history events.
    - New: `POST /transactions/{id}/reclassify` answers 200, not the NestJS POST default of 201. `GET /transactions/{id}/category-history` and `/classification-rules` are also new.
  - Budget `thresholdPercent` of 100 or more on write now returns 400.
  - Goal statuses change to `SAFE|ACCEPTABLE|RISKY|NOT_RECOMMENDED|INSUFFICIENT_DATA`, and `feasibilityScore` becomes nullable; deploy web and API atomically.
  - Goal simulation now honors `targetDate`. `months` now reports the remaining periods used, and `horizonSource`/`pastDeadline` are additive.
  - Goal simulation (US6, as built):
    - The fixed 3,900,000 capacity and the INSTALLMENT 1.099 multiplier are gone. Available cashflow is the owner's completed-month history in the goal currency; with fewer than 2 months the result is `INSUFFICIENT_DATA` with a null score.
    - `monthlyRequired` rounds up to the unit, instead of to the nearest. `totalCost` always equals `remainingAmount`.
    - `reason`, `availableMonthlyCashflow`, `observationMonths`, and `monthsRequired` are additive.
    - Goal `remainingAmount` is computed with exact decimals.
    - Without `months` the goal's own horizon applies, instead of `goal.months ?? 6`.
    - The web page no longer offers the "12-month installment" scenario (GOAL-007).
    - `PATCH /goals/{id}` with `targetDate: null` now clears the date instead of being ignored, so a goal can return to its planned months or the default horizon (GOAL-001, GOAL-002).
  - `defaultAlertSettings` stops enabling email for new settings; existing stored settings are unchanged.
  - `PATCH /users/me/settings` with `storeRawEmailBody: true` now returns 400 `RAW_EMAIL_BODY_UNAVAILABLE`; additive `rawEmailBodyAvailable: false`.
  - In production only, authentication and session-issuing routes return 403 `HTTPS_REQUIRED` when not reached over HTTPS through the trusted proxy.
  - Budget responses gain additive `alertsSupported` and `usageBasis`; non-MONTHLY budgets are still accepted.
- Generate `apps/api/docs/swagger.json` and compare it with [contracts/openapi.yaml](./contracts/openapi.yaml).

## Dependency Order

```text
P0.4 -> P0.3, P0.5 -> P0.6
P0.4 -> P0.7
P0.1a -> P0.1b ; P0.1a -> P0.2 (four resource-group test->fix pairs) -> P1.1 -> P1.2 -> P1.3
P0.2 -> P1.4
P0.2 -> P1.5 -> P1.6b
DB-M1 -> DB-M2 -> DB-M3 -> DB-M4 -> DB-M5        (strict migration stream)
DB-M4 -> P1.6a -> P1.6b
P1.6a -> P1.7a (per-evaluator, parallel files) -> P1.7b (sequential wiring)
DB-M5 + P1.6a -> P1.7c
P1.5 -> P1.8 -> P1.7a goal/cashflow evaluators
P1 backend contracts -> P1.9 -> P2 tests/runtime/docs
```

## Complexity Tracking

No known gate violation. The only new persistent entities are category-decision evidence and alert-delivery attempts, both required by explicit audit/delivery semantics. The new dependencies are:

- `nodemailer`: one runtime library, required for PRD SMTP email fallback.
- A pinned gitleaks Docker image: release tooling only, with no CI service.
- Web dev-only test tooling: Vitest with Testing Library (components) and Playwright with Chromium (browser E2E). These are one tool per purpose, with no overlap.

Queue, scheduler, worker, cache, policy engine, event bus, and a generic alert-rule engine are deliberately excluded.
