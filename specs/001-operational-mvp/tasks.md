---
description: "Dependency-ordered implementation tasks for the CashLens operational MVP"
---

# Tasks: Operational CashLens MVP

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/openapi.yaml`, and `quickstart.md` in `specs/001-operational-mvp/`

**Organization**: Brownfield-first tasks extend existing modules. Every task identifies requirements, files, dependencies, outcome, and verification.

**Parallel marker rule**: `[P]` means the task may run concurrently with any other task whose dependencies are also satisfied, **provided the two tasks share no listed file or directory**. No two tasks that share a file are both runnable without a dependency path between them. A directory entry such as `apps/api/src/modules/budgets/*` covers every file under that directory.

**Revision 2026-09-23**: This file was regenerated to remediate the analysis findings on task granularity, migration sequencing, admin bootstrap, alert semantics, secret scanning, and success-criteria verification. Task IDs were renumbered; the superseded-ID map is at the end.

**Second pass (same day)**: All existing IDs are preserved. Inserted tasks use a letter suffix so they sort directly after their predecessor: **T045a**, **T045b** (raw-body preference) and **T096a** (Playwright runner). Execution order is file order; every dependency points to a task earlier in the file, and a range such as `T041–T047` includes the suffixed tasks positioned inside it.

## Phase 1: P0 — Runtime Foundation (Shared Setup)

**Purpose**: Make configuration, startup, database readiness, secret hygiene, and container behavior safe before feature work.

- [X] T001 [P] [CFG-001, CFG-004, CFG-005, CFG-007, OPS-009, TEST-002] Add failing startup-configuration tests in `apps/api/src/config/configuration.spec.ts`; depends on none. Cover:
  - missing, empty, malformed, and known-placeholder database, JWT, encryption, Gmail, origin, and callback settings;
  - `EMAIL_TRANSPORT` cases: `disabled` valid everywhere; `smtp` with missing `SMTP_*`, `EMAIL_FROM`, or `APP_PUBLIC_URL`; `log` rejected in production;
  - production rejects `http://` values for `CORS_ORIGIN`, `APP_PUBLIC_URL`, and `GMAIL_REDIRECT_URI`, and rejects an invalid `TRUST_PROXY`.

  Verify development and production cases produce non-secret error messages.
- [X] T002 [CFG-001, CFG-004, CFG-005, CFG-007, OPS-009] Implement typed environment parsing in `apps/api/src/config/configuration.ts` and wire it through `apps/api/src/app.module.ts`; depends on T001. It includes:
  - production placeholder rejection and production `https://`-only origins/callback/public URL;
  - cookie/security settings and `TRUST_PROXY` (development default `loopback`; the production compose sets `loopback,172.28.0.1`, see plan.md "TLS boundary");
  - encryption-key length checks;
  - email transport keys;
  - the shared placeholder list in `apps/api/src/config/placeholder-secrets.ts`, reused by T009.

  Verify T001 passes and startup fails before binding a port.
- [X] T003 [P] [CFG-002, CFG-003, CFG-007, EMAIL-002] Replace usable/default secret values in `apps/api/.env.example` and the environment blocks of `docker-compose.yml` with documented placeholders, required/optional annotations, `EMAIL_TRANSPORT=disabled` plus commented SMTP keys, `TRUST_PROXY`, and the test-only `E2E_DATABASE_URL`; depends on T002. Also add `scripts/init-local-env.ps1` with two profiles. Neither prints a generated value, so SC-001 transcripts never contain secrets.
  - **Default profile:** copies the example into the ignored `apps/api/.env` and fills every secret placeholder with random values.
  - **`-Profile release-test -PublicOrigin https://<host>`:** writes the repository-root `.env.release-test` with synthetic, release-safe values for every production setting:
    - `NODE_ENV=production`;
    - random JWT, encryption, and OAuth-state secrets and database password;
    - `CORS_ORIGIN` and `APP_PUBLIC_URL` equal to the origin, and `GMAIL_REDIRECT_URI=<origin>/api/email-connections/gmail/callback`;
    - synthetic, non-functional Gmail client values;
    - `EMAIL_TRANSPORT=disabled`;
    - the `TRUST_PROXY` starting value `loopback,172.28.0.1`.

  Add `.env.release-test` to the root `.gitignore`; it is **not** ignored today, and `git check-ignore` confirmed this on 2026-09-23.

  Verify:
  - `docker compose config` works with an explicit local env file;
  - `git check-ignore -v .env.release-test` and `git check-ignore -v apps/api/.env` both match;
  - the script's output contains no generated value;
  - the release-test file passes production startup validation.
- [X] T004 [P] [OPS-004, ERR-004, TEST-004] Add failing liveness/readiness and database-outage tests in `apps/api/src/modules/health/health.controller.spec.ts` and `apps/api/test/health.e2e-spec.ts`; depends on T002. Verify liveness remains 200 while readiness returns 503 for unavailable PostgreSQL.
- [X] T005 [OPS-004, OPS-005, ERR-004] Add the minimal `HealthModule` with `/health/live` and database-backed `/health/ready`, enable Nest graceful shutdown, and register it. Files: `apps/api/src/modules/health/*`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`. Depends on T004. Verify the health tests pass and SIGTERM shuts down cleanly.
- [X] T006 [OPS-002, OPS-003, OPS-005] Harden development startup ordering and health checks in `docker-compose.yml` so migrations fail closed before API readiness and web waits for API health; depends on T003 and T005. Verify repeated `prisma migrate deploy`, restart, and persistent-volume survival.
- [X] T007 [P] [OPS-006, OPS-009, CFG-002, CFG-004] Add immutable multi-stage release images and a single-host production compose definition in `apps/api/Dockerfile`, `apps/web/Dockerfile`, and `docker-compose.prod.yml`; depends on T002 and T005. Requirements:
  - The API image must contain `dist/src/scripts/`.
  - The web image is built with the build argument `VITE_API_BASE_URL=/api`, a **relative** value, for same-origin proxy routing (plan.md "TLS boundary and same-origin routing"). Its static server provides the SPA fallback.
  - `docker-compose.prod.yml` takes every setting through `--env-file` variable interpolation. No env file is committed, and none is baked into an image.
  - A separate Dockerfile `tools` stage carries the Prisma CLI, `prisma/`, and `prisma.config.ts`. It backs a one-off `migrate` service that runs `prisma migrate deploy` inside the network. `api` depends on `migrate` with `service_completed_successfully`.
  - The API and web ports are published on `127.0.0.1` only, and PostgreSQL is not published. TLS terminates at the operator's proxy (plan.md "TLS boundary").
  - Services join `cashlens_net` with a pinned subnet `172.28.0.0/24`. The API's `TRUST_PROXY` comes from the env file; its starting value `loopback,172.28.0.1` is verified per host by T100, never assumed.

  Verify:
  - no source mount, dependency install, watcher, or embedded secret exists at runtime;
  - the built web bundle contains `/api` and no absolute API origin;
  - `docker compose --env-file <env> -f docker-compose.prod.yml config` shows loopback-only bindings and the pinned network;
  - `docker compose --env-file <env> -f docker-compose.prod.yml run --rm migrate` applies migrations against an empty volume.
- [X] T008 [OPS-001, OPS-003, TEST-007] Add an automated migration check in `apps/api/test/scripts/verify-migrations.ps1`; depends on T006. It covers four paths:
  - empty database;
  - current schema (`20260627090000_budgets_goals_alerts_dashboard`);
  - repeated deploy;
  - an **unmodified-history** check, which fails if any pre-existing folder under `apps/api/prisma/migrations/` differs from `origin/main`.

  Verify each path exits nonzero on incompatibility and zero when valid.
- [X] T009 [P] [CFG-002, CFG-006, SC-003, TEST-008] Add the deterministic secret scan exactly as specified in research.md "Secret scanning"; depends on T002 and T003.
  - **Files:** `scripts/scan-secrets.ps1`, `.gitleaks.toml`.
  - **Scanner image:** `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`, recorded once in the script.
  - **Base ref:** the historical baseline `-BaseRef` (default `80f3e0d`). If it is missing or is not an ancestor of `HEAD`, exit 2; never skip the history scan.
  - **Scan 1 (file set):** select `git ls-files -z --cached --others --exclude-standard`, which covers tracked files plus untracked files that are not ignored; skip deleted paths. Copy them into a temp staging directory outside the repository, then run gitleaks `dir` on the staging directory. Ignored files (`.env*`, `node_modules`, `dist`, `.turbo`, `coverage`, `.yarn`) are never read.
  - **Scan 2 (history):** gitleaks `git` mode over `<BaseRef>..HEAD` on the repository mounted read-only.
  - **Output:** `--redact`, `--no-banner`, `--exit-code 1`. Exit 0 when clean, 1 on findings, 2 on a prerequisite error. Print the scanned file count and the commit range.
  - **Config:** `.gitleaks.toml` extends the default rules and adds rules for OAuth client secrets, Google refresh tokens, and non-synthetic fixture email domains. Path rules match repository-relative paths.
  - **Allowlist:** exactly the values in `apps/api/src/config/placeholder-secrets.ts`.

  Verify seven cases:

  | Case | Expected exit |
  |---|---|
  | Ignored `apps/api/.env` containing a realistic synthetic secret | **0** |
  | Ignored `.env.release-test` generated by T003 | **0** |
  | Untracked, non-ignored file with a planted synthetic secret | 1 |
  | Tracked (force-added) env file with a secret | 1 |
  | Secret committed and then removed within the feature range | 1 |
  | Missing or unrelated base ref (`-BaseRef`, default `80f3e0d`) | 2 |
  | Clean tree | 0 |

  **As built (US1 closure, 2026-09-24):** the history range starts at the historical baseline `-BaseRef` (default `80f3e0d`), because the default branch predates the existing codebase; a missing or unrelated base ref exits 2. Besides the placeholder allowlist, the root `.gitleaksignore` holds exactly two reviewed, documented, commit-scoped fingerprints of synthetic fixtures in pushed commit `219f8e9`; the script refuses any broader or undocumented exception and ignores inline `gitleaks:allow`. Verified on 2026-09-23 by a 31-case synthetic harness and 5 real-repository clone cases, run from session scratch space (the harness is not committed to the repository); the real-repository scan is re-run at every gate.

**Checkpoint**: Configuration, runtime prerequisites, migration-history protection, and secret scanning are deterministic and testable.

---

## Phase 2: P0 — User Story 1: Secure Personal Data (Priority: P1)

**Goal**: Preserve current login/settings behavior while closing vertical privilege, mass-assignment, account-state, session, and horizontal ownership gaps, and provision the first administrator safely.

**Independent Test**: Two users, plus one administrator provisioned only via the bootstrap step, exercise every protected resource with valid, missing, expired, disabled, cross-user, and insufficient-role credentials without exposing private data.

### Tests for User Story 1

- [X] T010 [P] [US1] [SEC-007, TEST-003, TEST-008] Add the e2e test-database harness and the shared synthetic fixture helper; depends on T002. Apply the strategy in research.md "E2E test database strategy".
  - **Files:** `apps/api/test/helpers/test-database.ts`, `apps/api/test/jest-e2e.global-setup.ts`, `apps/api/test/jest-e2e.json` (globalSetup), `apps/api/package.json` (`test:e2e` uses `--runInBand`), `apps/api/test/helpers/auth-fixtures.ts`.
  - **Database guard:** use `E2E_DATABASE_URL`, and refuse to run unless the database name contains `test`.
  - **Global setup:** migrate the shared test schema once, and drop leftover `e2e_*` schemas older than 24 hours.
  - **Isolated databases:** `createIsolatedDatabase()` and `dropIsolatedDatabase()` run `CREATE DATABASE test_e2e_<suite>_<epochMs>`, then `prisma migrate deploy` with `DATABASE_URL` pointing at it, and drop it with `DROP DATABASE … WITH (FORCE)`. Databases rather than schemas: `PrismaPg` is built from the connection string alone, and node-postgres ignores `?schema=` (research.md). Global setup also drops leftover `test_e2e_*` databases older than 24 hours.
  - **Auth fixtures:** two users registered through the public API with run-scoped `@example.test` emails, a test-only admin promotion through Prisma (shared test database only, never in isolated databases), malformed IDs, and targeted cleanup.

  Verify:
  - a non-test database name aborts;
  - two consecutive runs leave no residual rows or schemas;
  - no real data is used.
- [X] T011 [P] [US1] [SEC-002, SEC-003, SEC-004, SEC-005, SEC-007, SC-015] Add failing role and privileged-field tests in `apps/api/test/admin-authorization.e2e-spec.ts`; depends on T010. Cover:
  - today's self-promotion via `PATCH /users/:id` and `POST /users` with `role`;
  - registration with `role` or `status` (expect 400);
  - bank-provider writes and parser-template writes (expect 403 for ordinary users).

  **As built:** parser-template writes return 403 for ordinary users; bank-provider writes have no route and are asserted as 404 for USER and ADMIN callers (the unauthenticated case is not asserted). Privileged fields sent by a non-administrator to an administrator-only route get 403 (authorization precedes body validation; only a body that is not valid JSON is rejected earlier, with 400, by the body parser); 400 applies on registration and self-service routes.
- [X] T012 [P] [US1] [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, OPS-009, TEST-004] Add failing session tests in `apps/api/test/auth-session.e2e-spec.ts`; depends on T010. Cover:
  - registration, generic login failure, access expiry, refresh rotation/reuse, logout, and logout-all;
  - **production mode**:
    - login with `X-Forwarded-Proto: https` from the trusted hop sets cookies with `Secure; HttpOnly; SameSite=Lax`;
    - login, register, and refresh without HTTPS return 403 `HTTPS_REQUIRED`;
    - `/health/ready` over HTTP returns 200.

  Verify no token or account-existence leakage.
- [X] T013 [P] [US1] [SEC-009, SC-015, AUTH-005] Add failing admin-bootstrap tests in `apps/api/test/admin-bootstrap.e2e-spec.ts`; depends on T010.
  - **Isolation:** each case runs in its **own isolated database** (T010 `createIsolatedDatabase`), so the zero-admin precondition holds regardless of other suites.
  - **Invocation:** the script is spawned as a child process with that database's `DATABASE_URL`. The concurrency case spawns two processes at once. Each case asserts that the promotion and audit row appear in the isolated database, and that the shared test database's admin rows are unchanged.
  - **Cleanup:** the database is dropped in `afterAll`.

  Cover:
  - first promotion writes one `SYSTEM` audit row (exit 0);
  - rerun for the same user is a no-op with no new audit row (exit 0);
  - a different target while an admin exists is refused (exit 3);
  - missing, disabled, pending-deletion, deleted, or passwordless (not self-registered) targets are refused (exit 2);
  - two concurrent runs produce exactly one admin;
  - `--list-admins` prints no credentials;
  - `--revoke --email` on a pre-existing self-promoted admin writes one `ADMIN_ROLE_REVOKED` audit row, after which bootstrap succeeds;
  - output contains no password, token, or `DATABASE_URL`.
- [X] T014 [P] [US1] [SEC-001, SEC-005, SEC-008, TEST-003] Add a failing two-user/admin ownership matrix for **finance core** (financial accounts, transactions, transaction categories) in `apps/api/test/ownership-finance-core.e2e-spec.ts`; depends on T010. Verify owner-safe 404 versus role-based 403.
- [X] T015 [P] [US1] [SEC-001, SEC-005, SEC-008, TEST-003] Add a failing ownership matrix for **planning and alerts** (budgets, goals, alerts, alert settings) in `apps/api/test/ownership-planning-alerts.e2e-spec.ts`; depends on T010. Verify admin gets no private access.
- [X] T016 [P] [US1] [SEC-001, SEC-005, SEC-008, TEST-003] Add a failing ownership matrix for the **email pipeline** (email connections, listen rules, email messages, parser runs, sync runs) in `apps/api/test/ownership-email-pipeline.e2e-spec.ts`; depends on T010. Verify no provider token or payload disclosure.
- [X] T017 [P] [US1] [SEC-001, SEC-002, SEC-005, TEST-003] Add a failing ownership matrix for **users and settings** (list, read, update, delete other users; `me`; `me/settings`) in `apps/api/test/ownership-users-settings.e2e-spec.ts`; depends on T010.

### Implementation for User Story 1

- [X] T018 [US1] [SEC-002, SEC-003, SEC-005] Add `@Roles()` metadata and an administrator guard that reads the **persisted** role and status, with unit tests. Files: `apps/api/src/common/decorators/roles.decorator.ts`, `apps/api/src/common/guards/roles.guard.ts`, `apps/api/src/common/guards/roles.guard.spec.ts`. Depends on T011. Verify USER, ADMIN, disabled ADMIN, absent role, and absent authentication.
- [X] T019 [US1] [SEC-002, SEC-003, SEC-008] Apply administrator authorization only to account identity/status, bank-provider/sender writes, and parser-template writes. Files: `apps/api/src/modules/users/users.controller.ts`, `apps/api/src/modules/bank-providers/bank-providers.controller.ts`, `apps/api/src/modules/parser/parser.controller.ts`. Depends on T018. Verify the T011 role expectations and that private modules have no admin bypass.
  **As built:** no bank-provider or sender write route exists, so there is nothing to guard; writes are unsupported routes (404) for every caller (SEC-003, spec Session 2026-09-24). Parser-template writes and all `/users` administration routes are administrator-only.
- [X] T020 [US1] [SEC-003, SEC-004, TX-002] Split self-service and admin DTO mappings so non-admin input cannot bind `role`, `status`, `userId`, metadata ownership, or classification provenance. Files: `apps/api/src/modules/users/dto/*`, `apps/api/src/modules/users/users.mapper.ts`, `apps/api/src/modules/users/users.controller.ts`, `apps/api/src/modules/auth/dto/register.dto.ts`, `apps/api/src/modules/transactions/dto/*`, `apps/api/src/modules/transactions/transactions.mapper.ts`. Depends on T019. Verify forbid-non-whitelisted field errors and that stored privileged fields are unchanged; T011 passes.
  **As built:** added self-service `PATCH /users/me` (full name, timezone, locale, base currency) because `/users/{id}` became administrator-only; administrator responses use an identity/status view without `settings`; transaction create/update reject `status: DELETED` (deletion only through the audited `DELETE`); empty related ids return 400.
- [X] T021 [US1] [SEC-001, SEC-005, DATA-004] Repair owner predicates for **finance core** in `apps/api/src/modules/financial-accounts/*`, `apps/api/src/modules/transactions/transactions.repository.ts`, `apps/api/src/modules/transactions/transactions.service.ts`, and `apps/api/src/modules/transaction-categories/*`; depends on T014 and T020. Verify T014 passes without duplicate repositories.
- [X] T022 [P] [US1] [SEC-001, SEC-005, SEC-008] Repair owner predicates for **planning and alerts** in `apps/api/src/modules/budgets/*`, `apps/api/src/modules/goals/*`, and `apps/api/src/modules/alerts/*`; depends on T015. Verify T015 passes.
- [X] T023 [P] [US1] [SEC-001, SEC-005, SEC-008] Repair owner predicates for the **email pipeline** in `apps/api/src/modules/email-connections/*`, `apps/api/src/modules/email-listen-rules/*`, `apps/api/src/modules/email-ingestion/*`, `apps/api/src/modules/parser/parser.service.ts`, and `apps/api/src/modules/parser/parser.repository.ts`; depends on T016. Verify T016 passes.
- [X] T024 [US1] [SEC-001, SEC-002, SEC-005] Repair self-service scoping for **users and settings** in `apps/api/src/modules/users/users.service.ts` and `apps/api/src/modules/users/users.repository.ts`; depends on T017 and T020. Verify T017 passes.
- [X] T025 [US1] [AUTH-002, SEC-005, SEC-007] Reject disabled or soft-deleted accounts during JWT validation and refresh, and load role from the database, in `apps/api/src/modules/auth/strategies/jwt.strategy.ts`, `apps/api/src/modules/auth/auth.service.ts`, and `apps/api/src/modules/users/users.repository.ts`; depends on T012 and T024. Verify old access and refresh credentials become unauthorized and promotion takes effect on the next request.
- [X] T026 [US1] [AUTH-001, AUTH-003, AUTH-005, OPS-009] Implement the application side of the TLS boundary; depends on T002, T005, T012, and T025. Scope:
  - make cookie flags and scopes configuration-driven (`Secure; HttpOnly; SameSite=Lax` in production);
  - set Express `trust proxy` from `TRUST_PROXY`;
  - add a production-only `HTTPS_REQUIRED` guard on register, login, refresh, logout, and the OAuth callback, with health exempt;
  - preserve refresh rotation and sanitize auth audit records.

  Files: `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/common/guards/https-required.guard.ts`, `apps/api/src/main.ts`. Verify all T012 cases pass.
- [X] T027 [US1] [AUTH-002, ERR-002, TEST-006] Implement a single-flight refresh attempt for safe/idempotent requests, with sign-out fallback and no automatic mutation replay, in `apps/web/src/api/client.ts` and `apps/web/src/providers/authProvider.ts`; depends on T026. Verify concurrent 401 handling and no duplicate POST/PATCH/DELETE request.
- [X] T028 [P] [US1] [SEC-003, SEC-009, AUTH-005, SC-015] Implement the operator bootstrap; depends on T002, T013, and T020.
  - **Files:** `apps/api/src/scripts/bootstrap-admin.ts`, `apps/api/src/scripts/bootstrap-admin.module.ts`, `apps/api/src/modules/users/admin-bootstrap.service.ts`, `apps/api/package.json` (script `admin:bootstrap`).
  - **Package script:** `admin:bootstrap` runs `ts-node -r tsconfig-paths/register src/scripts/bootstrap-admin.ts`, never `nest build`, because `deleteOutDir` would clear `dist/` under the dev watcher. Production runs `node dist/src/scripts/bootstrap-admin.js`.
  - **Runtime:** `NestFactory.createApplicationContext` with validated config and Prisma only. Do not reuse the `generate-openapi.ts` `JWT_SECRET` fallback or its Prisma override.
  - **Transaction:** a `pg_advisory_xact_lock` transaction per data-model.md, returning exit codes 0, 2, 3, or 1.
  - **Upgrade-review modes:** `--list-admins` (read-only) and `--revoke --email` (audited).

  Verify T013 passes and `docker compose -f docker-compose.prod.yml run --rm api node dist/src/scripts/bootstrap-admin.js --email …` works from the release image.

  **As built:** eligibility also requires the account's own password (self-registered, SEC-009(a)); passwordless accounts exit 2 like missing ones.
- [X] T029 [US1] [SEC-006, AUTH-005] Add sanitized audit writes using the existing `AuditLog` writer for privileged account changes, settings changes, email connect/disconnect/sync, category corrections, and destructive financial actions. Files: `apps/api/src/modules/users/users.repository.ts`, `apps/api/src/modules/users/users.service.ts`, `apps/api/src/modules/email-connections/email-connections.service.ts`, `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`, `apps/api/src/modules/transactions/transactions.service.ts`. Depends on T021, T023, T025, and T026. Verify actor/resource/action evidence without secrets or raw email data.
  **As built:** coverage also includes archiving a financial account or a transaction category (destructive financial actions under SEC-006), admin create/update/delete, self-service profile and settings changes, and `LOGIN_FAILED`/`LOGOUT` writes. It required importing `UsersModule` into the email, transaction, account, and category modules and passing the acting administrator from `users.controller.ts`. The action catalogue is in data-model.md "Account status and audit evidence". Test evidence: `apps/api/test/audit-evidence.e2e-spec.ts` asserts the administrator, self-service, financial, and email actions and the absence of secrets; `auth-session.e2e-spec.ts` asserts that login, refresh, and logout-all add rows without secrets; `admin-bootstrap.e2e-spec.ts` asserts the `SYSTEM` bootstrap and revoke rows. `REGISTER`, `LOGIN_FAILED`, and `LOGOUT` rows are written but not asserted by any test (follow-up below).
- [X] T030 [US1] [SEC-001–SEC-009, AUTH-001–AUTH-005, SC-002, SC-015] Run and stabilize all US1 suites (T011–T017), serially under the T010 harness, in `apps/api/test/*.e2e-spec.ts`; depends on T018–T029. Verify the independent test passes end to end.

**Checkpoint**: US1 is independently secure, the first administrator is provisionable only via SEC-009, and P0 security gates are satisfied.

### US1 closure follow-ups (deferred, not part of US1)

Found while implementing US1 and deliberately left open. Each maps to the future task or requirement that owns it; none blocks US1.

| Issue | Requirement | Owner |
|---|---|---|
| `POST /alerts` accepts any `resourceType`/`resourceId` without an ownership check | ALERT-011, SEC-001 | T066, T068 |
| The Gmail callback URL (`code`, `state`) appears in request logs | OPS-008, EMAIL-002 | T094, T095 |
| ~~Parser-run payloads and raw sync/parser error text reach their owner unsanitized~~ **Resolved for new data in T044/T045 (verified by T049):** parser runs keep match status and the deduplication decision only; failures, message errors, and sync-run errors are fixed codes or strings. Rows written before this release keep their old text; see "US3 follow-ups" | EMAIL-011, ERR-003, SEC-008 | T045, T049 (new data); legacy rows: US3 follow-ups |
| Registration returns 409 for an existing email; the contract lists 201/400/403 | AUTH-004 | T101 contract comparison (pending product decision) |
| Swagger UI and JSON are published in production | CFG-004 | T093 (it owns `main.ts`, where Swagger is mounted); T105 documents the production behavior |
| The access-token lifetime falls back to 7 days when `JWT_EXPIRES_IN` is unset (compose and `.env.example` set 15m) | AUTH-002, CFG-001 | T093 (startup in `main.ts`; require the setting or default to 15m) |
| Admin `POST /users/list` sorting or filtering by last sign-in fails (config key `lastLogin` instead of `lastLoginAt`) | ERR-001 | T092 (failing case), T093 (fix) |
| A NUL character inside a JSON request body (not an id) may still reach PostgreSQL and fail | ERR-004 | T093 |
| ~~The legacy smoke suite (`app.e2e-spec.ts`) monthly-summary case depends on the calendar month (fixture email dated June 2026)~~ **Resolved in T036:** the manual transactions use a fixed June 2026 instant and every summary names `month=2026-06`; expected values unchanged | TEST-004 | T036 (done) |
| `REGISTER`, `LOGIN_FAILED`, and `LOGOUT` audit rows are written but no test asserts them | AUTH-005, SEC-006 | T098 (requirement-to-test traceability; add the missing assertions) |
| The Gmail callback answers 200 with the enveloped connection record; the contract target is a 302 redirect back to the web app | EMAIL-001 | T101 contract comparison (pending product decision) |

### US2 follow-ups (deferred, not part of US2)

Found while implementing and reviewing US2 (T031–T036) and deliberately left open. Each maps to the future task or decision that owns it; none blocks US2.

| Issue | Requirement | Owner |
|---|---|---|
| ~~The parser `vi_datetime` normalizer builds the instant in the server process timezone~~ **Resolved in T045:** `vi_datetime` is read as wall time in `Asia/Ho_Chi_Minh` whatever the host zone. Original issue: an email's user month depended on the host (UTC in the release image) | DASH-002, DASH-003, EMAIL-011 | T045 (strict parser-output gate), T046 fixtures |
| ~~The parser keeps a minus sign on amounts; parsed currency codes are not normalized~~ **Resolved in T045:** amounts are positive, a sign may only confirm the direction, and `VNĐ`/`đ`/`₫` normalize to `VND`. Original issue: the parser kept a minus sign on amounts, so a negative POSTED expense lowered totals; parsed currency codes are not normalized (`VNĐ`, `đ` form their own groups) | TX-002, TX-003, EMAIL-011 | T045 |
| Budget DTO `currency` is still `@IsString @MaxLength(3)`, and the web budget form never sends a currency (stored `VND`), so hot budgets of non-VND accounts count nothing | BUDGET-002, TX-002 | T069, T070 |
| Hot budgets without a category report 0 spent, and spend is not clipped to `startsAt`/`endsAt` | BUDGET-002 | T070 (shared spend aggregate) |
| ~~`excludeFromAnalytics` no longer removes breakdown rows server-side~~ **Decided at US2 closure (2026-09-24):** excluded categories never appear in category breakdowns, and their transactions still count in totals; implemented and tested (spec.md Session 2026-09-24, US2 closure) | DASH-001, SC-009 | Done (US2 closure) |
| A transaction created without `currency` gets the schema default `VND`, not the account base currency | TX-002 | Product decision; T101 contract comparison |
| Duplicate links may form cycles, or point at an original that is later ignored or deleted, so an event can drop out of every total. Since T045, import only links a new or flagged row to an existing unflagged original, so import never forms a cycle; manual links still can | TX-003, EMAIL-008 | Product decision |
| Transactions in an archived financial account still count (the documented eligibility rule is transaction-level only) | TX-003 | Product decision; T101 contract comparison |
| The web ESLint config cannot load (`eslint-plugin-react-refresh` and `typescript-eslint` are not installed for `apps/web`); this existed before US2 | ERR-005, TEST-006 | T096 (web test and tooling setup) |

### US3 follow-ups (deferred, not part of US3)

These were found while implementing and reviewing US3 (T037–T049) and deliberately left open. Each row names the task or decision that owns it; none of them blocks US3.

| Issue | Requirement | Owner |
|---|---|---|
| The Gmail OAuth callback's `code` and `state` may appear in request logs | SEC-008, OPS-008 | T094, T095 |
| Snippets stored before this release stay in `EmailMessage` rows. `GET /email-messages` still returns them to their owner, and the manual parse endpoint (with the T030 smoke test) uses them. Clearing them needs a data migration that DB-M1–M5 do not plan, and a rework of the smoke test | DATA-001, EMAIL-012 | Product/data decision; T101 |
| Parser runs, message errors, and sync-run errors written before this release keep their old contents: captured values and raw error text. `GET /email-messages/{id}/parser-runs` still returns them to their owner, because `toParserRunResponse` spreads the row. New rows are sanitized. Clearing the legacy rows, or projecting the response, needs a data or contract decision | EMAIL-011, SEC-008, DATA-001 | Product/data decision; T101 |
| The web listen-rule form cannot choose a connection or a bank. A rule without a bank depends on a verified sender, and none is seeded, so its messages fail `NO_BANK_PROVIDER` | EMAIL-004 | UI follow-up (unassigned) |
| Code-less legacy `EMAIL` transactions got no fingerprint in DB-M2, because their parsed time may carry the old timezone error. Re-importing the same event is therefore not recognized as a duplicate of them | EMAIL-007, EMAIL-008 | Documented trade-off |
| Non-matching messages are not recorded (no `IGNORED` rows, to avoid storing unrelated mail metadata), so every re-read of a page fetches them again. `gmailQuery` also ORs the sender and subject clauses, so Gmail lists more than the rules need | EMAIL-006 | Efficiency follow-up (privacy trade-off) |
| The lease and the watermark use the application clock. A single host with NTP is assumed; a clock stepped far forward could skip mail | EMAIL-006, EMAIL-007 | OPS assumption (T105) |
| `POST /email-connections/{id}/sync` can take about a minute in the worst case, so the reverse proxy must allow at least 90 s | EMAIL-013, OPS-009 | T105 |
| Google revocation on disconnect may revoke the whole grant, including for a second CashLens account linked to the same mailbox (unverified) | DATA-002 | T104 (Gmail documentation) |
| A connection disconnected between the ownership check and taking the lease answers 409 `SYNC_IN_PROGRESS` instead of 404 | EMAIL-007, ERR-003 | Minor; unassigned |
| The declared parser reads a synthetic format that has not been confirmed against real Vietcombank email | FR-08, SC-005 | Operator validation; T104 |
| The web ESLint config still cannot load; this existed before US2 | ERR-005, TEST-006 | T096 |

### US4 follow-ups (deferred, not part of US4)

These were found while implementing and reviewing US4 (T050–T057) and deliberately left open. None of them blocks US4.

| Issue | Requirement | Owner |
|---|---|---|
| User rules have an API (`/classification-rules`) but no management page; the drawer only shows rule decisions | CLASS-001 | UI follow-up (unassigned) |
| System rules have no operator tooling (no seed, script, or admin route); they can only be written through `ClassificationRepository.createSystemRule` | CLASS-001, SEC-003 | Ops/product decision |
| The automatic rerun (`applyAutomatic`) has no trigger: rule changes never reclassify existing rows, and there is no "re-run rules" action or job | CLASS-006 | Product decision |
| The list shows "Chưa phân loại" for a null category, which is also the name of the seeded `sys_cat_uncategorized` category, which classification never assigns | CLASS-004 | Product/UX decision |
| Deleting a rule clears `Transaction.classificationRuleId`, while the source stays `USER_RULE` or `SYSTEM_RULE`; the event keeps the rule id | CLASS-005 | Documented trade-off |
| After the rule lock, a doubly-rare race remains: the row's reference changes between the read and the row lock while that new rule is deleted. PostgreSQL then aborts one side with a deadlock error; no data is lost. There is no global mapping of deadlocks to a retryable status | CLASS-005, ERR-003 | T064 (exception filter) |
| The legacy enum values `RULE`, `ML`, `LLM`, and `SYSTEM` remain in `ClassificationSource` (removing values is not additive); they are never written | CLASS-007 | Schema cleanup (unassigned) |
| Category corrections and imports will need `onTransactionsChanged` for budget alerts | ALERT-009, BUDGET-003 | T080, T083 |
| No component tests cover the classification drawer; evidence is the headless-browser run | TEST-006 | T096 |

### US6 follow-ups (deferred, not part of US6)

These were found while implementing and reviewing US6 (T058–T063) and deliberately left open. None of them blocks US6.

| Issue | Requirement | Owner |
|---|---|---|
| `CreateGoalDto.currency` accepts any string of up to 3 characters, not an ISO code. Feasibility is safe (a non-code observes nothing), but the value is stored. Tightening it is a write-contract change | GOAL-001, ERR-001 | Contract decision (with the budget DTO, T070) |
| The web create form sends no currency, so goals get the database default `VND` even for accounts with another base currency | GOAL-001, GOAL-003 | UI follow-up (unassigned) |
| A contribution has no sign or minimum, so `savedAmount` can go negative. Step 1 still gives a well-defined remaining amount | GOAL-001 | Contract decision |
| A goal archived with `PATCH status=ARCHIVED` (not `DELETE`) is hidden from the list but can still be read and simulated | GOAL-001 | Product decision |
| A date-only `targetDate` is stored at UTC midnight. West of UTC it falls on the previous local day, and on the previous user month when that day starts a month | GOAL-002 | Product decision (date vs instant) |
| The unit is 0.01 for every currency other than VND (data-model rule). Zero-decimal currencies such as JPY are rounded to 0.01, not to the spec's "smallest unit" | GOAL-002, GOAL-003 | Product decision |
| The dashboard's `eligibleCashflowBuckets` matches currency case-insensitively but does not trim padding. Goals use the documented case-and-padding rule, so a legacy padded code (`'VND '`) counts in goals and totals but not in the cashflow chart. `ILIKE` also treats `%` and `_` as wildcards; the base currency is validated, so this is not reachable today | TX-003, DASH-001 | US2 follow-up (HIGH-risk shared helper) |
| `apps/api/docs/swagger.json` has not been regenerated since before US1 | DOC | T101 (Swagger regeneration and contract comparison) |
| The GOAL-005 option of an explicitly labeled, user-provided planning input is not implemented (it is a MAY) | GOAL-005 | Product decision |

### US5 follow-ups (deferred, not part of US5)

These were found while implementing and reviewing US5 (T064–T091) and deliberately left open. None of them blocks US5.

| Issue | Requirement | Owner |
|---|---|---|
| Whether `POST /alerts` (user-authored alerts) is retained is still pending. It stays, with a null key and no delivery row | ALERT-011 | Product decision |
| Cashflow risk does not subtract goal commitments (research.md default, "pending confirmation") | ALERT-009, GOAL-003 | Product decision |
| Alert titles, messages, and the email text are English while the web UI is Vietnamese | ALERT-001, ALERT-007 | Localization follow-up |
| Email delivery is awaited inside the triggering request after commit, up to the 12 s budget, so an opted-in CRITICAL alert can slow that response. This is the documented design (research.md), with no queue | ALERT-006 | Accepted; revisit only with a worker decision |
| A timed-out SMTP attempt is abandoned, not cancelled, so the provider may still deliver it and a retry can send a second copy. Delivery is at-least-once within the 3-attempt cap | ALERT-006 | Known limitation |
| Evaluation errors are logged with a correlation id through the Nest logger only; structured, redacted events come with T095 | ALERT-009, OPS-008 | T095 |
| Overlapping budgets (a category budget plus an all-categories budget) both count the same expense, so the summary totals double-count spend, as they already double-count limits. The summary now adds only base-currency budgets | BUDGET-002 | Product decision (summary semantics) |
| The budget list's `month` filter still selects budgets by UTC calendar month (`buildBudgetWhere`), while usage uses the user month | BUDGET-002, DASH-002 | Budget follow-up |
| The budget create form sends no currency, so budgets get the default `VND` whatever the base currency. The same gap exists for goals | BUDGET-001 | UI follow-up |
| `CreateBudgetDto.amount` allows 0, which holds no alert (no usage %). Tightening it is a write-contract change | BUDGET-001 | Contract decision |
| `AlertSetting` rows are still created for `CATEGORY_SHIFT` and `PARSER_ISSUE`, which no evaluator produces. The settings UI hides them | ALERT-008 | Cleanup |
| `uiStore.readAlerts` and its actions are now unused (the badge uses the server count) | ALERT-004 | Cleanup |
| An expense whose date is moved into the current month without an amount, currency, direction, or eligibility change is not re-evaluated for large transaction, as the matrix defines | ALERT-009 | As specified |
| `apps/api/docs/swagger.json` has not been regenerated | DOC | T101 |

---

## Phase 3: P1 — User Story 2: Trustworthy Transactions and Dashboard (Priority: P1)

**Goal**: Apply one persisted-data eligibility, period, timezone, transfer, duplicate, and currency policy across transaction and reporting flows.

**Independent Test**: A known data set produces identical hand-calculated transaction, dashboard, budget-input, and goal-input totals across edits and exclusions.

- [X] T031 [P] [US2] [TX-001, TX-002, TX-003, TX-005, DASH-001–DASH-003, BUDGET-002, DATA-004, TEST-002] Add failing golden tests for status eligibility, transfers, duplicates, timezone/month-start boundaries, and mixed currencies in `apps/api/src/common/finance/financial-period-policy.spec.ts`; depends on T030. Verify every documented edge case has an explicit expected total.
  **As built:** 53 golden cases. 43 were written first and seen failing individually against a throwing stub. 10 were added after T032 and never seen failing: 8 after an independent coverage review, with literals recomputed independently by Intl brute force, and 2 after the US2 review (month-key range, currency case). They cover every status × direction treatment, transfers, adjustments, duplicates, deleted rows, exact-decimal USD sums, per-currency groups, the savings rate, half-open month boundaries, month-start days 1/6/8/25/28, year rollover, DST (New York), skipped and doubled midnights (America/Havana, America/Santiago, Asia/Beirut), completed-month windows at the exact boundary, and settings fallbacks. Decisions the spec left open are recorded in data-model.md "Financial period policy (US2)".
- [X] T032 [US2] [TX-003, DASH-002, DASH-003, DATA-004] Implement shared Prisma predicates and UTC/user-period range helpers, including a completed-month range helper, in `apps/api/src/common/finance/financial-period-policy.ts`; depends on T031. Verify deterministic ranges across DST and non-first-day month starts.
  **As built:** pure `Intl`-based helpers (no dependency): `userMonthForKey`, `userMonthContaining`, `userMonthsEndingAt`, `recentUserMonths`, `completedUserMonths`, `completedMonthsRange`, `startOfLocalDay`, `localDateKey`, plus `eligibleTransactionWhere`/`visibleTransactionWhere`, exact-decimal `totalsByCurrency`, and `savingRatePercent`. A local day starts at its earliest instant; a month is labelled by the local month in which it starts. Results are identical with the process `TZ` set to UTC, America/Los_Angeles, or Pacific/Kiritimati. Prisma-backed aggregates shared by the consumers live in `apps/api/src/common/finance/financial-summary.query.ts`.
- [X] T033 [US2] [TX-001–TX-003, DASH-001–DASH-003] Refactor existing transaction, analytics, and dashboard repository queries to consume the shared policy. Files: `apps/api/src/modules/transactions/transactions.repository.ts`, `apps/api/src/modules/analytics/*`, `apps/api/src/modules/dashboard/*`. Depends on T032. Verify ignored, deleted, and duplicate rows and transfers are treated consistently.
  **As built:** dashboard, analytics, and the transaction list use only the shared policy and aggregates. Money fields are the base currency with additive `currency`/`currencies`; the breakdown includes uncategorized rows, leaves out categories flagged `excludeFromAnalytics` (their transactions still count in every total; US2 closure decision), and is no longer truncated; the trend is zero-filled; hot budgets spend in the budget currency; the list gains a user-month `month` filter and additive `totals` over all matching rows. `apps/api/test/transactions-dashboard.e2e-spec.ts` (T036) verifies it: 17 cases. The first 16 were run against the pre-US2 source, and 15 of them failed; the 17th (currency-case folding) was added after the review.
- [X] T034 [US2] [TX-002, ERR-001] Tighten transaction field and related-owner validation in `apps/api/src/modules/transactions/dto/*` and `apps/api/src/modules/transactions/transactions.service.ts`; depends on T033. Verify invalid amount, currency, direction, date, account, category, and duplicate reference each produce an actionable field error or safe error.
  **As built:** shared validators in `apps/api/src/common/finance/finance-validation.ts`. Amounts are positive, with at most 2 decimals, up to 9,999,999,999,999.99; currencies are upper-case ISO 4217; instants need an explicit UTC offset; `isDuplicate`/`duplicateOfTransactionId` must agree and a transaction cannot reference itself; list `month` excludes `from`/`to` and `from` cannot be after `to`; malformed dashboard and analytics months get 400; timezones on registration, profile, and admin DTOs must be IANA. Related ids keep the US1 owner-safe 404. After the review, `IsMoney` also counts decimals exactly for exponent-notation numbers; `null` is refused for fields every transaction carries; `page` is at most 1,000,000; month keys are limited to 1900-01..2099-12. `apps/api/test/transactions-validation.e2e-spec.ts`: 48 cases pass (44, plus 4 added after the review), and the US1 suites are unchanged.
- [X] T035 [P] [US2] [TX-001, TX-005, ERR-005] Complete transaction list/filter/edit/category/ignore/duplicate/delete feedback and dashboard empty/loading/error states in `apps/web/src/features/transactions/components/TransactionsPage.tsx` and `apps/web/src/features/dashboard/components/DashboardPage.tsx`; depends on T027 and T033. Verify persisted responses replace any runtime mock fallback.
  **As built:** both pages read React Query data rather than Refine's frozen `{}` placeholder, so pending and failed requests show skeletons or an error with retry, never a crash or a false empty state. The Transactions page lists the user month taken from the dashboard overview; its summary cards come from the server `totals` (base currency, other currencies listed separately), and its rows carry status, duplicate, and transfer badges. Drawer actions (category, note, ignore, mark or clear duplicate, delete) each give feedback, refetch, and are disabled while pending. The create form shows the API's field errors. The Dashboard sends exactly the six month-less requests concurrently (the DASH-004 load), formats money in the base currency and dates in `overview.timeZone`, shows other currencies separately, and no longer has runtime mock fallbacks (fake T1–T6 months, placeholder insight, invented counts). `AreaChart` gained an optional `currency` prop. Verified by the web type check and production build, an SSR harness over pending, failed, and loaded states, and a headless-browser run against a mock API (six concurrent requests, no `/auth/me`). A headless-browser run against the real development-mode API, seeded with the benchmark fixture and served same-origin, passed 18/18 checks: rendered totals equal the API, six concurrent month-less dashboard requests, list totals equal the dashboard, one real ignore updated both views, and no page errors. The web ESLint config cannot load, which predates US2 (follow-up T096).
- [X] T036 [US2] [DASH-001–DASH-004, TEST-004, SC-009, SC-010] Add transaction-to-dashboard integration tests and the reference benchmark tooling; depends on T003 (release-test profile), T007 (the bench override extends `docker-compose.prod.yml`), and T034. Deliverables:
  - **Integration tests** in `apps/api/test/transactions-dashboard.e2e-spec.ts`: hand-calculated canonical-ledger totals.
  - **Deterministic fixture generator** in `apps/api/test/benchmark/dashboard-bench.fixture.ts`: seed `20260923`; 13 user months; 2,990 transactions (230 per month with the DASH-004 mix); 20 categories; 3 accounts; 10 MONTHLY budgets. It returns its own expected current-month totals.
  - **Runner** in `apps/api/test/benchmark/dashboard-benchmark.ts`:
    - wait for readiness, sign in, and check totals;
    - 10 warm-up loads, then 200 sequential loads, each being the six concurrent `DashboardPage.tsx` requests;
    - nearest-rank p95 is the 190th sorted duration; print min, median, p95, max, and host;
    - take `--base-url`, which on the reference release host is the proxy origin `https://<release-test-host>/api` (plan.md "Reference release host and release-test profile"), and accept a CA bundle through `NODE_EXTRA_CA_CERTS`.
  - **Benchmark-only compose override** `docker-compose.bench.yml`: used with `-p cashlens-bench`, `--env-file .env.release-test`, and its own volume, it publishes that stack's PostgreSQL on `127.0.0.1:55432` for the host-side seeder only. Production compose is unchanged.
  - **Package scripts** in `apps/api/package.json`: `bench:dashboard:seed --env-file .env.release-test`, which builds the benchmark database URL from the profile without printing it, and `bench:dashboard`.

  Verify:
  - the hand totals match;
  - the same seed yields identical records and expected totals twice;
  - a **non-gating** 20-load smoke run completes against the test API.

  The release gate is T101.
  **As built:** `transactions-dashboard.e2e-spec.ts` (17 cases: canonical ledger, list-versus-dashboard agreement, breakdown reconciliation with the excluded-from-analytics category hidden from both breakdowns but counted in totals, zero-filled trend, hot budgets, analytics, TX-005 recalculation, America/New_York month-start day 25 across DST, currency-case folding); the fixture, seeder, and runner under `apps/api/test/benchmark/` with `dashboard-bench.e2e-spec.ts` (12 cases: determinism, the DASH-004 mix for 13 months, isolated-database seeding whose API overview equals the independently computed totals, runner exit codes); `docker-compose.bench.yml` (pinned project `cashlens-bench`); package scripts. The legacy smoke suite now uses a fixed June 2026 period and passes 22/22 with unchanged expected values. Non-gating 20-load smoke run on the finished code: p95 59.2 ms, 0 failed responses, totals matched (research.md "Dashboard benchmark", As built). The gating run is T101.

**Checkpoint**: US2 is independently testable and supplies the shared calculation foundation for budgets, alerts, and goals.

---

## Phase 4: P1 — User Story 3: Safe Gmail Import (Priority: P1)

**Goal**: Finish the existing Gmail OAuth/ingestion/parser path with bounded incremental state, exclusion, retries, deduplication, privacy, observable continuation, and declared parser fixtures.

**Independent Test**: A synthetic mailbox with valid, non-matching, malformed, repeated, and cross-message duplicate events can be connected, synchronized concurrently and exactly three times repeatedly, continued, disconnected, and reconnected safely.

- [X] T037 [P] [US3] [EMAIL-001–EMAIL-003, TEST-004] Add failing Gmail OAuth tests in `apps/api/src/modules/email-connections/gmail-oauth.service.spec.ts` for state, scope, token redaction, revocation, reconnect, and **provider-auth-failure versus user-disconnect** status; depends on T030. Verify read-only scope, expiring signed state, generic provider errors, and no password/token persistence.
  **As built:** `gmail-oauth.service.spec.ts`, 18 tests: read-only consent, signed expiring browser-bound state, generic provider errors, best-effort revocation, reconnect-required versus user disconnect, a refresh racing a disconnect, a client misconfiguration, and non-JSON answers. 15 were written first; 9 of them failed against the pre-US3 code for behavioural reasons and 6 already held. 3 were added after the security review.
- [X] T038 [US3] [EMAIL-005–EMAIL-007, OPS-003] **DB-M1 (1/5)**: Add nullable cursor/backfill/lease fields, `EmailSyncStatus.EXPIRED`, `EmailSyncRun.emailsFailed` (default 0), `hasMore` (default false), and continuation evidence/indexes. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts1>_email_sync_progress/migration.sql` with `ts1 > 20260627090000`. Depends on T008. Verify T008 passes, legacy nulls are compatible, and the enum value is unused in the same migration.
  **As built:** Migration `20260924100000_email_sync_progress`. Connection: `lastFailedAt`, `syncCursor`, `backfillFrom`, `backfillCompletedAt`, `syncLeaseToken`, `syncLeaseExpiresAt`. Run: `emailsFailed`, `hasMore`, `leaseToken`, `cursorBefore`, `cursorAfter`, and the index `(emailConnectionId, status)`. `EmailSyncStatus.EXPIRED` is added but not used in the migration. The T008 verifier passes, including no drift, repeated deploy, and upgrade from the current schema.
- [X] T039 [P] [US3] [EMAIL-007–EMAIL-012, TEST-002] Add failing parser-validity and layered-deduplication fixture tests in `apps/api/src/modules/email-ingestion/email-ingestion.service.spec.ts` and `apps/api/src/modules/parser/parser-engine.service.spec.ts`; depends on T030. Verify malformed output never posts, and precedence runs provider ID → transaction ID → fallback fingerprint.
  **As built:** Parser-validity tests in `parser-engine.service.spec.ts` (65 tests) and layered-identity tests in `email-ingestion.service.spec.ts`. 33 were written first; 32 of them failed for behavioural reasons. Added later: fallback patterns and zero fractions (after an advisor review), the body-less manual parse (after the concurrency review), and 35 cases from the fuzz review.
- [X] T040 [US3] [EMAIL-007, EMAIL-008, OPS-003] **DB-M2 (2/5)**: Add a nullable transaction fingerprint, strategy evidence, and an owner-scoped collision-safe index. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts2>_transaction_deduplication/migration.sql` with `ts2 > ts1`. Depends on T038. Verify the collision audit runs before uniqueness is enforced, and T008 passes.
  **As built:** Migration `20260924100100_transaction_deduplication`: `TransactionDeduplicationStrategy`, `deduplicationFingerprint`, `deduplicationStrategy`. The backfill keys only `EMAIL` rows that have a bank and a non-blank code, as `code:v1:<bank>:<CODE>`. A key that collides within one user is reported with `RAISE NOTICE` and left null, and the migration fails if any duplicate key remains before the owner-scoped unique index is created. Proven on a scratch database (collisions left null; normalization identical to the application's) and by T008.
- [X] T041 [US3] [EMAIL-001–EMAIL-003, DATA-002, ALERT-009] Complete connection status and recovery in `apps/api/src/modules/email-connections/*`; depends on T037. Scope:
  - last success/failure and recovery action;
  - best-effort provider revocation and credential invalidation;
  - reconnect;
  - a distinct reconnect-required state for provider-auth failure versus user disconnect.

  Verify derived transactions and sanitized history survive disconnect.
  **As built:** The connection view adds `recoveryAction` (`NONE`, `RETRY`, `RECONNECT` or `CONNECT`), `reconnectRequired`, `lastFailedAt`, the backfill fields, and `syncInProgress`. It never returns credentials, the cursor, or the lease token. `EXPIRED` (reconnect required) is set only by refresh `invalid_grant`, or by a Gmail 401 or scope 403 during a run; other refusals, such as a wrong client secret, are temporary 503s that change no connection. Disconnect revokes best-effort, with the token in a form body; it clears credentials and the lease, and ends any `RUNNING` run. Token writes never overwrite a concurrent disconnect or reconnect. A connect without a refresh token is refused. T049 shows that derived transactions and sanitized history survive a disconnect.
- [X] T042 [US3] [EMAIL-004–EMAIL-007, EMAIL-013] Implement atomic connection lease acquisition/expiry (recording expired runs as `EXPIRED`), opaque cursor persistence, bounded backfill, and continuation methods in `apps/api/src/modules/email-ingestion/email-ingestion.repository.ts` and `apps/api/src/modules/email-connections/email-connections.repository.ts`; depends on T038 and T041. Verify one active lease per connection and safe stale-lease recovery.
  **As built:** `acquireLease` takes the lease with one conditional UPDATE. It records every still-`RUNNING` run as `EXPIRED`, reads the cursor under the lease, and creates the run with `leaseToken` and `cursorBefore`. `finishRun` is the only writer of the cursor, status, and progress, and writes them only while the run holds its lease; a run that lost its lease keeps its counts and ends `EXPIRED`. Window and cursor policy live in `sync-policy.ts` (7 tests). T049 verifies gated concurrency, stale-lease recovery, and takeover of a stalled run.
- [X] T043 [P] [US3] [EMAIL-009, ERR-003] Implement bounded retry/backoff with jitter in `apps/api/src/modules/email-ingestion/gmail-api.service.ts`, distinguishing 429/5xx, revoked credentials, and permanent message failures; depends on T037. Verify mocked attempt limits and sanitized failure classification.
  **As built:** At most 3 attempts, with full-jitter backoff (0.5 s base, 4 s cap, `Retry-After` honoured up to 5 s) and a 10 s timeout per attempt. Failure kinds: `RATE_LIMITED` and `TRANSIENT` are retried; `AUTH`, `REFUSED` (a project-level 403, never a reconnect), `NOT_FOUND`, and `PERMANENT` are not. Messages are fixed strings, and NUL characters are dropped from Gmail text. 19 tests. Google OAuth calls also have a 10 s timeout.
- [X] T044 [US3] [EMAIL-004–EMAIL-007, EMAIL-009, EMAIL-013] Refactor the manual sync loop in `apps/api/src/modules/email-ingestion/email-ingestion.service.ts` and `apps/api/src/modules/email-ingestion/email-ingestion.mapper.ts`; depends on T042 and T043.
  - **Loop behavior:** lease, batch bound, continuation, per-message isolation, terminal run state, and cursor commit.
  - **Response contract:** keep the existing status names `SUCCESS`, `PARTIAL_FAILED`, and `FAILED`; populate `emailsFailed` and `hasMore`.

  Verify active-sync 409, no scheduler/queue dependency, and the response matches `contracts/openapi.yaml` `EmailSyncRun` inside the envelope.
  **As built:** Batch of 50 messages and a 25 s run budget, with at least one message per run. A page token Gmail refuses restarts the window. Each message is isolated; a poison message is given up after 3 attempts, which are counted in the cursor. Run and connection messages are fixed, sanitized strings, and an explicit-field mapper keeps the lease token and cursors out of every response. `hasMore` means a non-`FAILED` run left work in its window. Sync answers 201 (the NestJS default for POST), not the contract's 200; `contracts/openapi.yaml` now documents 201, `SYNC_IN_PROGRESS`, and `RECONNECT_REQUIRED`. 15 loop unit tests: 12 were written first and all failed; 3 were added after the reviews. T049 also covers the loop.
- [X] T045 [US3] [EMAIL-007, EMAIL-008, EMAIL-010–EMAIL-012, DATA-001] Implement the normalized transaction identity/fingerprint upsert and the strict parser-output gate. Files: `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`, `apps/api/src/modules/parser/parser-engine.service.ts`, `apps/api/src/modules/parser/parser.service.ts`, `apps/api/src/modules/transactions/transactions.repository.ts`. Depends on T033, T039, T040, and T044. Verify T039 passes and the raw body exists only in transient memory.
  **As built:** The strict output gate enforces sanitized codes, the sign and direction rules, the dong spellings, ISO 4217 currencies, wall time in `Asia/Ho_Chi_Minh`, and first-match fallback patterns. After a fuzz review (120,000 parses across 6 time zones), the gate also refuses: a fact read twice with different values (`AMBIGUOUS_VALUE`); direction labels outside a whitelist; amounts with a leading zero group or text after the currency; X-codes and fund currencies; years outside 1900–2099; and over-long values. It reads the body in NFC and parses every value in linear time. The identity key is the code key or the fingerprint. The atomic import lives in `ParserRepository`, the existing owner of the parse write, so `transactions.repository.ts` needed no change. Only a code match with the same amount, direction, and currency is linked as a duplicate; every other match is kept as a flagged suspected duplicate, excluded from totals until cleared, so no real transaction is dropped. Parser runs keep match status and the deduplication decision only. The raw body is transient, and snippets are no longer written. This resolves the US2 follow-ups on the parser time zone, minus signs, and currency spellings.
- [X] T045a [P] [US3] [DATA-001, EMAIL-012, TEST-004] Add failing raw-body-preference tests in `apps/api/test/raw-body-preference.e2e-spec.ts`; depends on T030 and T045. Cover:
  - `PATCH /users/me/settings` with `storeRawEmailBody: true` returns 400 `RAW_EMAIL_BODY_UNAVAILABLE`, and the stored value is unchanged;
  - `false` returns 200;
  - responses include `rawEmailBodyAvailable: false`;
  - with a legacy stored `true` (inserted via Prisma), a fixture sync persists no raw body anywhere.
  **As built:** `raw-body-preference.e2e-spec.ts`, 4 tests; all 4 failed first. The legacy-`true` case syncs a fixture through the real pipeline, then finds no body text in any message, parser run, transaction, sync run, audit row, or the connection.
- [X] T045b [US3] [DATA-001, EMAIL-012, ERR-005] Lock the raw-body preference; depends on T020 and T045a.
  - **API:** the settings DTO accepts only `false` for `storeRawEmailBody`. Responses add `rawEmailBodyAvailable: false`. Legacy stored values are preserved and never read.
  - **UI:** the Settings page renders the control disabled with an "Unavailable in this release" label, whatever the stored value.
  - **Files:** `apps/api/src/modules/users/dto/update-user-settings.dto.ts`, `apps/api/src/modules/users/users.mapper.ts`, `apps/web/src/features/settings/components/SettingsPage.tsx`.

  Verify T045a passes and the UI shows the label for both stored `true` and `false`.
  **As built:** The service refuses `true` before any write, with 400 `RAW_EMAIL_BODY_UNAVAILABLE` and `fields.storeRawEmailBody`. Every self view carries `rawEmailBodyAvailable: false`, added in `toUserResponse`. GitNexus rates that function CRITICAL, but the change is one additive constant, and every auth, users, and settings suite passes. For both stored `true` and `false`, Settings shows the switch off and disabled with "Không khả dụng trong phiên bản này (Unavailable in this release)"; a headless-browser check confirmed that clicking it sends no request.
- [X] T046 [P] [US3] [FR-08, EMAIL-010, TEST-008, SC-005] Declare **at least one** supported MVP parser (bank, channel, version; the PRD targets 1–2 banks from the seeded providers) in a machine-readable table in `docs/operations/supported-parsers.md`, and author the synthetic fixtures; depends on T045.
  - **Fixtures:** under `apps/api/test/fixtures/email/<bank>/<channel>/<version>/{valid,malformed}/`, at least 10 valid (each with the expected normalized transaction) and at least 2 malformed per parser.
  - **Templates:** matching parser-template definitions in `apps/api/test/fixtures/parser-templates/*.json`.

  Verify only reserved test domains are used and the T009 scan is clean.
  **As built:** `docs/operations/supported-parsers.md` declares `bank_vcb` EMAIL v1, a synthetic format not yet confirmed against real Vietcombank email. It has 17 valid fixtures with hand-written expectations and 12 malformed ones; an independent recomputation confirmed the original 12 valid and 5 malformed fixtures, and the 5 valid and 7 malformed added afterwards cover the review findings. The template in `apps/api/test/fixtures/parser-templates/bank_vcb-email-v1.json` uses line-anchored, whole-line patterns that pass the safe-regex check, so no value is ever read in part. Fixtures use reserved domains and masked account numbers, and the T009 scan is clean.
- [X] T047 [P] [US3] [EMAIL-003, EMAIL-005, ERR-003, ERR-005] Expose sync counts, status, continuation, and reconnect states in `apps/web/src/features/email-connections/components/EmailPage.tsx` and `apps/web/src/features/ops/components/OpsPage.tsx`; depends on T027, T041, T044, and T045. Verify loading, partial, retry, conflict, reconnect, and continue actions.
  **As built:** EmailPage shows the connection's health and recovery action, its last success and failure, the backfill state, and loading and error states with retry. It lists run history with the status and every count, and shows outcome alerts with Continue (`hasMore`), Retry, and Reconnect; 409 and 503 are handled, and each click sends one POST. The connect button is fixed: it reads `authorizationUrl`, not `authUrl`. OpsPage shows connection health and each run's status, counts, and continuation. Verified by the type check, the production build, and a headless-Edge run against a mock API that mirrors the e2e-verified contract: 66/66 checks and no console errors. The web ESLint config still cannot load (T096).
- [X] T048 [US3] [SC-005, EMAIL-010, EMAIL-011] Add the per-parser rate gate in `apps/api/test/parser-fixture-rates.e2e-spec.ts`; depends on T046. It computes each declared parser's rate **independently** (valid fixtures producing the exact expected transaction ÷ valid fixtures), with no averaging across parsers. Verify it fails in each of these cases:
  - zero parsers declared, or an unreadable or empty declaration table;
  - any single parser below 85%;
  - any parser with fewer than 10 valid or 2 malformed fixtures;
  - any malformed fixture creates a transaction.

  Each failure mode has its own negative test using a temporary declaration. The gate prints a per-parser table for release evidence.
  **As built:** `parser-fixture-rates.e2e-spec.ts` runs each declared parser's fixtures, for a fresh user, through the real pipeline: stubbed Gmail, manual sync, parser, and import. It prints `bank_vcb EMAIL v1 | 17/17 | 100.0% | 12 | 0 | PASS`. Each failure mode has its own negative test built from a temporary declaration, and the tests do not depend on fixture counts. 9 tests.
- [X] T049 [US3] [EMAIL-001–EMAIL-013, ERR-003, TEST-004, TEST-005, SC-004] Add fixture-backed integration tests in `apps/api/test/email-ingestion.e2e-spec.ts` for OAuth-to-transaction, concurrent sync, partial failure, disconnect/reconnect, continuation, and a replay loop with `REPLAYS = 3` that asserts after each iteration; depends on T041–T047. Verify the US3 independent test and no duplicate active transaction.
  **As built:** `email-ingestion.e2e-spec.ts`, 10 tests:
    - OAuth to transaction with valid, non-matching, malformed, certain-duplicate, and suspected-duplicate messages;
    - `REPLAYS = 3`, asserting after each replay;
    - gated concurrency: exactly one lease, and 409 `SYNC_IN_PROGRESS` for the other request;
    - takeover of a stalled run: its counts are kept and it commits no progress;
    - a transient partial failure;
    - continuation by page token;
    - stale-lease recovery;
    - reconnect required;
    - disconnect and reconnect with history intact;
    - an inactive account.

**Checkpoint**: US3 provides an operational manual Gmail pipeline with declared, measured parsers and no queue or scheduler infrastructure.

---

## Phase 5: P1 — User Story 4: Deterministic Classification (Priority: P1)

**Goal**: Reuse `MerchantRule` to classify predictably and preserve an append-only explanation for automatic and manual category changes.

**Independent Test**: Overlapping system/user rules, equal priorities, no match, manual correction, ingestion replay, and explicit reclassification produce one reproducible result and event history.

- [X] T050 [US4] [CLASS-001, CLASS-005, OPS-003] **DB-M3 (3/5)**: Add nullable system-rule ownership, classification winner/manual metadata, and `TransactionCategoryEvent`. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts3>_classification_events/migration.sql` with `ts3 > ts2`. Depends on T040. Verify existing MANUAL rows remain protected, no fake history is backfilled, and T008 passes.
  **As built:** Migration `20260924120000_classification_events`:
  - adds the enums `CategoryDecisionSource`, `CategoryDecisionTrigger`, and `CategoryDecisionReason`;
  - adds `USER_RULE`, `SYSTEM_RULE`, and `FALLBACK` to `ClassificationSource`;
  - makes `MerchantRule.userId` nullable, with the target-scope trigger;
  - adds `Transaction.classificationRuleId` (FK, `SET NULL`) and `classifiedAt`;
  - creates `TransactionCategoryEvent` with a per-transaction `sequence` and triggers that refuse updates and direct deletes.

  **Protection backfill.** Rows with a category and `UNKNOWN` become `MANUAL`, with no events, so no fake history is written. Existing `MANUAL` rows are kept.

  **Verified** on a scratch database seeded with legacy rows:
  - the legacy row was protected and `updatedAt` untouched;
  - 0 events were written;
  - every trigger case behaved as specified, and cascades are allowed.

  T008 passes with 13 migrations. Schema and semantics are in data-model.md ("MerchantRule ownership", "TransactionCategoryEvent").
- [X] T051 [P] [US4] [CLASS-001–CLASS-007, TX-004, TEST-002] Add failing precedence, numeric priority, createdAt/ID tie-break, fallback, manual-lock, conflict, and explicit-reclassification tests in `apps/api/src/modules/transactions/classification.service.spec.ts`; depends on T030. Verify exactly one explained outcome for every matrix row.
  **As built:** 40 tests, written first against a stub that threw: 39 failed and 1 passed (the static ML/LLM scan). Every matrix row asserts one outcome and its explanation. The tests cover:
  - the manual lock with and without a category, and its release by an explicit request;
  - user over system (`SCOPE`);
  - ties in both scopes (`PRIORITY`, `CREATED_AT`, `ID`);
  - the fallback;
  - conflict explanations;
  - eight kinds of skipped rules, which never cause a conflict;
  - matching semantics;
  - all 120 orderings of a 5-rule fixture, giving the same winner.

  Four tests added after the review cover holding the winning rule (below). Total: 44, all passing.
- [X] T052 [US4] [CLASS-001–CLASS-004] Add owner/system rule query and validation methods around existing `MerchantRule` in `apps/api/src/modules/transactions/classification.repository.ts`; depends on T050 and T051. Verify system rules target system categories and user rules cannot target another user's category.
  **As built:** `ClassificationRepository` provides:
  - owner-scoped candidate rules (own plus system);
  - the `autoClassificationEnabled` read (a missing row means on);
  - `ruleTargetAllowed`;
  - user-rule CRUD and `createSystemRule` (no HTTP route);
  - the row lock;
  - `lockRule` (`FOR KEY SHARE`);
  - event append;
  - history and readable category names.

  The target scope is enforced twice, in the application and by the DB trigger. Rule CRUD is exposed at `/classification-rules`, because CLASS-001 needs user-owned rules and plan P1.4 lists a rules contract. `updateRule` merges the DTO field by field: with ES2023 class fields every DTO key is an own `undefined`, and T057 caught a spread that erased stored patterns.
- [X] T053 [US4] [CLASS-002–CLASS-007] Implement deterministic matching and winner explanation in `apps/api/src/modules/transactions/classification.service.ts`; depends on T052. Verify no ML/LLM path exists and all T051 tests pass.
  **As built:** `decide()` is pure.
  - **Matching:** literal and normalized (no diacritics, case, or extra spaces; `đ` read as `d`). Contains-match for merchant (falling back to the counterparty) and description, equals for bank and direction, AND across criteria, and at least one text criterion. No regular expressions.
  - **Precedence:** CLASS-002, with ids compared by code unit.
  - **Explanation:** ranked candidates, winner, runner-up, tie-break, and conflict, as ids and codes only.
  - **Winner hold (review fix):** the winning rule is held `FOR KEY SHARE` until commit, and a winner deleted after the read triggers a new decision (409 after 3 attempts). This fixes a confirmed 500 (`P2003`) when a rule was deleted during a classification.
  - **No ML/LLM:** the static-scan test checks that no ML or LLM path exists.
- [X] T054 [US4] [CLASS-005, CLASS-006, TX-004, SEC-006] Make manual category correction and explicit reclassification update current state and append events atomically in `apps/api/src/modules/transactions/transactions.service.ts` and `apps/api/src/modules/transactions/transactions.repository.ts`; depends on T034, T045, and T053. Verify automatic calls leave manual classifications unchanged.
  **As built:** One database transaction per category write. It locks the referenced rule and then the row (same order as a rule delete, so they cannot deadlock; the deadlock was a confirmed review finding). It then writes the five decision columns, appends the event, and writes the audit row.
  - **Manual correction.** `PATCH /:id/category`, and `PATCH /:id` with `categoryId`, set `MANUAL`, including a locked clear with `null`. A repeated identical choice writes nothing. `TRANSACTION_CATEGORY_CORRECTED` is written only when the category changes.
  - **Explicit reclassification.** It releases the lock and always writes `EXPLICIT_RECLASSIFY` and `TRANSACTION_RECLASSIFIED`.
  - **Automatic runs.** `ClassificationService.applyAutomatic` returns `PROTECTED` for a `MANUAL` row. Its guarded write repeats the protection, and an unchanged decision writes nothing.
  - **Audit helper.** `UsersRepository.recordAudit` gained an optional transaction client. GitNexus rated this CRITICAL because `recordAudit` is a hub, but the change is backward compatible.
- [X] T055 [US4] [CLASS-002, CLASS-006, EMAIL-010] Invoke classification from manual transaction creation and successful email parsing in `apps/api/src/modules/transactions/transactions.service.ts` and `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`, without overwriting manual decisions; depends on T054. Verify retries are idempotent.
  **As built:**
  - **Manual create.** A chosen category is a `MANUAL` `CREATE` event with actor USER. Otherwise the automatic decision applies, as a `CREATE` event with actor SYSTEM.
  - **Email import.** The hook is in `ParserRepository.importOnce` (create branch, same transaction), so a created row, including a suspected duplicate, gets an `IMPORT` event. A replay, a certain duplicate, and a repeated manual parse create nothing, and the unique-violation retry re-runs the whole transaction. Retries are therefore idempotent (T057: 3 replays with no change).
  - **Deviation.** `email-ingestion.service.ts` needed no change.
  - **Auto off.** With `autoClassificationEnabled` false, rows stay `UNKNOWN` with no event.
- [X] T056 [US4] [CLASS-005, CLASS-006, ERR-005] Add reclassify and category-history endpoints and the correction/conflict UI. Files: `apps/api/src/modules/transactions/transactions.controller.ts`, `apps/api/src/modules/transactions/dto/*`, `apps/web/src/features/transactions/components/TransactionsPage.tsx`. Depends on T035 and T055. Verify an explicit warning before reclassification and a visible decision reason.
  **As built:** `POST /transactions/:id/reclassify` answers 200 and takes an empty body; any property gets 400. `GET /transactions/:id/category-history` lists events oldest first with readable category names. `UpdateTransactionCategoryDto` now requires the key (a category or `null`).

  The drawer shows:
  - the decision source and the recorded reason (winner, tie-break, conflict);
  - a "Phân loại lại" confirmation that warns first, more strongly for a manual category;
  - the history, with loading, empty, error-and-retry, and stale-refresh-warning states.

  List rows without a category from the rules carry "Cần chọn nhóm". Settings no longer mentions a "model".

  **Verified** by:
  - the web type check, production build, and lint (approximate config, because the real one cannot load: T096);
  - a headless-Edge run against a mock API, which passed 24/24 checks, including the three review fixes: no stale history across transactions, a visible refresh failure, and no request for `none`.
- [X] T057 [US4] [CLASS-001–CLASS-007, TEST-004, TEST-005, SC-006] Add rule, correction, history, and ingestion-replay integration tests in `apps/api/test/classification.e2e-spec.ts`; depends on T052–T056. Verify the US4 independent test and append-only history.
  **As built:** 30 tests covering:
  - rule CRUD, validation, and ownership;
  - the DB target trigger;
  - precedence and the fallback;
  - auto-off;
  - equal-priority ties, with 5 reclassifications giving the same winner and 5 audits;
  - corrections, the manual lock, and the no-op;
  - refused requests writing nothing;
  - automatic reruns (`PROTECTED`, `APPLIED`, `UNCHANGED`);
  - rule deletion;
  - a Gmail import with user, system, bank-AND, and fallback rules, a suspected duplicate, and a certain duplicate;
  - 3 replays with no change;
  - the manual lock surviving a replay and a manual parse;
  - history, and 404 for others;
  - append-only triggers and cascades;
  - no transaction text in events;
  - unchanged US2 totals;
  - both concurrency races, each shown to fail without its fix.

  The finance ownership suite gained the two new routes, and alice's event count. The admin privileged-field matrix gained `classificationRuleId`, `classifiedAt`, `USER_RULE`, and `/classification-rules` (`userId`, `userId: null`, `scope`). The raw-body suite now also scans category events. Full e2e: 18 suites, 688 tests.

**Checkpoint**: US4 is deterministic, explainable, and independently releasable.

---

## Phase 6: P1 — User Story 6: Goals from Actual Data (Priority: P1)

**Goal**: Remove fixed/prototype financial assumptions and return transparent goal feasibility from the user's eligible completed-month history. This phase precedes US5 because the goal-risk and cashflow-risk evaluators consume its feasibility function.

**Independent Test**: Positive, negative, zero-required, past-deadline, and 0/1/2/3-month histories reproduce hand-calculated inputs, score, level, or insufficient-data state.

- [X] T058 [P] [US6] [GOAL-002–GOAL-007, TEST-002, SC-008] Add failing tests in `apps/api/src/modules/goals/goals.service.spec.ts` that assert the data-model worked examples **G1–G10 exactly, to the VND**; depends on T033. The examples use a controlled clock (`now = 2026-09-23T10:00+07:00`) and cover:
  - inclusive month counting, including a deadline in the current month and a past deadline (0 periods);
  - required saving rounded up;
  - available cashflow and score rounded down, including negative values;
  - band edges 99/80/79/50/49;
  - horizon precedence and `horizonSource`;
  - observation history from the earliest goal-currency transaction, with empty months counting as 0;
  - 0, 1, 2, and 3-month insufficient-data outcomes.

  Verify no fixed income, expense, interest, or free-cashflow value appears.
  **As built:** `goals.service.spec.ts` holds 49 tests.
  - **Red baseline.** Against stubs for `computeFeasibility` and `observationWindow` and the old simulation, 47 failed and 1 passed; the one pass was the owner-safe 404, behavior the old code already had.
  - **Coverage.** G1–G10 exactly, to the VND, under `now = 2026-09-23T10:00+07:00`, including G5 with H1 and every G7 band edge. Beyond the examples:
    - horizon precedence and a past `GOAL_MONTHS` deadline;
    - 0.01-unit currencies, VND stored with cents, and the largest `Decimal(18,2)` amounts;
    - insufficient history combined with a reached target or a past deadline;
    - month-start day 25, a date-only target date in a UTC−5 account, and a target date beyond 2099;
    - purity.
  - **Service path.** The service is tested through a fake repository that reuses the real `observationWindow` and the shared eligibility functions.
  - **Static scan.** A scan proves no fixed capacity (`3900000`, `assumedFreeCashflow`, `1.099`) remains in the goals module or `GoalsPage.tsx`.
- [X] T059 [US6] [GOAL-003, GOAL-005, GOAL-006] Add the shared Prisma-backed completed-month aggregation `completedMonthCashflow(prisma, userId, currency, now)` in `apps/api/src/common/finance/completed-month-cashflow.ts` and consume it from `apps/api/src/modules/goals/goals.repository.ts`; depends on T032 and T058.
  - It returns observation months from the history start with empty months as 0, keeps at most the 3 most recent completed months, and excludes the current month.
  - It lives in `common/finance`, not in the goals module, so the alert inputs query can reuse it without importing `GoalsModule`.

  Verify the current partial month and ineligible or other-currency records are excluded.
  **As built:** `completedMonthCashflow` in `common/finance/completed-month-cashflow.ts` imports nothing from the goals module.
  - **History start.** One `groupBy` on the stored currency code finds the history start: the earliest eligible record of any direction.
  - **Window.** The pure `observationWindow` keeps, of the 3 most recent completed months, those ending after the history start.
  - **Nets.** One `findMany` sums eligible income and expense per window month with exact `Prisma.Decimal`.
  - **Currency.** Codes are matched in code with `normalizeCurrency` (case and padding). A Prisma case-insensitive `equals` would become an unescaped `ILIKE`, where a free-form goal currency such as `%` matches every currency (review finding).
  - **Shared helper left alone.** The dashboard's `eligibleCashflowBuckets` (GitNexus: HIGH risk) was not changed.
  - **Verification.** `goals.e2e-spec.ts` checks each exclusion separately against real rows: the current month (boundary instants included), transfers, adjustments, suspected duplicates, ignored, deleted, pending, and needs-review records, and other currencies. It also covers timezone month assignment, the G8/G9 starts, owner isolation, exact cents, padded codes, a `%` currency, and equality with `/dashboard/cashflow` nets.
- [X] T060 [US6] [GOAL-001–GOAL-007] Replace `assumedFreeCashflow` and the installment prototype math with the data-model GOAL rules; depends on T059.
  - **Files:** `apps/api/src/modules/goals/goal-feasibility.ts` (new), `apps/api/src/modules/goals/goals.service.ts`, `apps/api/src/modules/goals/goals.mapper.ts`.
  - **Pure function:** `computeFeasibility({ goal, now, queryMonths?, observation, userMonthPolicy })` has no Nest provider and is exported from the new file. It returns `remainingAmount`, `months` (remaining periods), `horizonSource`, `pastDeadline`, `monthlyRequired`, `availableMonthlyCashflow`, `feasibilityScore`, `status`, `observationMonths`, `monthsRequired`, and `reason`.

  Verify T058 passes and contribution/goal ownership remains intact.
  **As built:** The pure `computeFeasibility` (`goal-feasibility.ts`) follows the data-model steps.
  - **Precision.** It computes in a 64-digit decimal context, rounding only at the named steps (ROUND_CEIL, ROUND_FLOOR, and floor).
  - **Month indices.** The shared policy supplies user months; a date outside 1900–2099 falls back to the local-date rule, so no horizon can fail the request.
  - **Decisions:**
    - `pastDeadline` requires a remaining amount (spec GOAL-002 and the contract; the data-model wording was corrected);
    - insufficient history wins over a reached target (step 6 precedes step 8);
    - `reason` lists every applicable code in a fixed order.
  - **Service.** `GoalsService.simulate` reads the injectable `Clock`, the account's period settings, and the goal-currency observation, and is side-effect free.
  - **Removed.** `simulateGoal`, with its `3900000` capacity, `1.099` multiplier, and `WATCH`/`RISK` statuses, is gone.
  - **Goal responses.** `toGoalResponse.remainingAmount` is now exact.
  - **Clearing the target date (review finding).** `PATCH` with `targetDate: null` now clears the date. It was silently ignored, so once US6 gave the target date precedence, a goal could never return to its planned months or the default.
  - **Ownership.** Contribution and goal ownership are unchanged: the owner-scoped predicates are untouched, and the e2e tests plus the ownership suite pass.
- [X] T061 [US6] [GOAL-002, GOAL-004, GOAL-005, GOAL-007, ERR-001] Align the goal simulation DTO and controller with `contracts/openapi.yaml` `GoalFeasibility` in `apps/api/src/modules/goals/dto/*` and `apps/api/src/modules/goals/goals.controller.ts`; depends on T060.
  - **Fields kept:** `monthlyRequired`, `feasibilityScore` (now nullable), and `months` (now the remaining periods).
  - **Fields added:** `horizonSource`, `pastDeadline`, `availableMonthlyCashflow`, `observationMonths`, `monthsRequired`, `reason`.
  - **INSTALLMENT (pending product-owner decision):** default is to accept the value, apply no inferred rate, set `totalCost = remainingAmount`, and state this in `reason`.

  Verify the response is enveloped.
  **As built:**
  - **Response.** `toGoalFeasibilityResponse` returns exactly the contract fields. `months` is the remaining periods, `feasibilityScore` and `availableMonthlyCashflow` are nullable, and the rest are additive. JSON numbers never carry -0.
  - **INSTALLMENT.** It is accepted with no inferred rate: `totalCost = remainingAmount`, and `INSTALLMENT_WITHOUT_INTEREST` is appended to `reason`.
  - **Query DTO.** Its validation was already correct: `months` is an integer of 1 or more, and `scenario` is an enum. The DTO and controller now document the semantics.
  - **Verification.** The e2e suite asserts the full envelope `{success, data, message, timestamp}`. It also asserts 400 field errors for `months=0`, `abc`, and `1.5` and for `scenario=BAD`, with the same body for an own and an absent goal.
- [X] T062 [US6] [GOAL-004, GOAL-005, ERR-005, SC-008] Render observation inputs, exact result levels, `horizonSource` and past-deadline states, and insufficient-history guidance in `apps/web/src/features/goals/components/GoalsPage.tsx` and `apps/web/src/types/goal.ts`. **Remove** the `3900000` fallback and the client-side feasibility formula. Depends on T027 and T061. Verify loading/empty/error states and no fabricated projection.
  **As built:**
  - **Removed.** The `3900000` fallback, the client-side formula, and the "Trả góp 12 tháng" scenario control, which misrepresented a model the API does not have (GOAL-007).
  - **API-only numbers.** Every number comes from the API, and a result is shown only for its own goal, because refine keeps the previous goal's data as a placeholder.
  - **Horizon.** The default view is the goal's own horizon, sent without `months` and named by `horizonSource`. The slider is a what-if that sends `months`, and a reset returns to the goal's horizon.
  - **States.** Past deadline, insufficient history (with `monthsRequired` guidance and no score), observation months, and available cashflow each have their own rendering. The list and the result each have loading, empty, error, and retry states.
  - **Create form.** It validates its fields, shows server field errors, and sends only what was entered: no fabricated `months = 6`, an optional target date.
  - **Mapper.** `mapGoal` in `api/mappers.ts` no longer fabricates `months: 6`. This file is not in the task's list (deviation).
  - **Review fixes.** Deadlines show the calendar date in the account time zone: a new `formatDate` in `utils/format.ts`, fed the time zone from the dashboard overview. A failed list refresh now warns with a retry in every state, including right after the first goal is created. The slider handle has an accessible name and value text.
  - **Verification.** Web type check, production build, and lint (approximate config, T096). A headless-Edge run against a mock API passed 37/37 checks.
- [X] T063 [US6] [GOAL-001–GOAL-007, TEST-004, TEST-005, SC-008] Add real-data goal CRUD, contribution, and recalculation E2E tests in `apps/api/test/goals.e2e-spec.ts`; depends on T059–T062. They reproduce G1, G4, G6, and G8 through the API from persisted transactions. Verify the US6 independent test.
  **As built:** `apps/api/test/goals.e2e-spec.ts` runs the application with the `Clock` provider fixed at the example instant, so the published numbers are reproduced through the API from real rows.
  - **Worked examples.** G1, G4, G5, G6, and G8 run from transactions created with `POST /transactions`, and G10(b) through the API. G10(a) needs a stored `createdAt` and is unit-tested.
  - **INSTALLMENT and validation.** INSTALLMENT and the 400 validation cases above.
  - **Recalculation (GOAL-006).** Exact new values after each of: a contribution, a goal edit, an ignored income, a deleted expense, an edited amount, and clearing the target date (back to the default horizon). A record in the current month changes nothing, and a repeat read is identical.
  - **Isolation.** Another owner's same-currency history, including an earlier record, changes nothing, and their read gets the owner-safe 404.
  - **Other checks.** A `%` goal currency observes nothing. CRUD keeps exact amounts, and an archived goal is 404. Reads create no alert.
  - **Totals.** 37 tests: 19 for T059, 18 for T061/T063.

**Checkpoint**: US6 goal output is reproducible from persisted user data and exposes a pure feasibility function for alert evaluation.

---

## Phase 7: P1 — User Story 5: Budget Alerts and Notifications (Priority: P1)

**Goal**: Turn existing budget aggregation and alert CRUD into the ALERT-009 matrix with an `ACTIVE`/`DISMISSED`/`RESOLVED` lifecycle independent of read state, and opt-in critical email fallback.

**Independent Test**: Transactions cross, remain above, fall below, and re-cross thresholds, and each other matrix row triggers and resolves, while alert status, read state, and delivery follow the exact cooldown and preference rules.

### Schema (strict migration stream continues)

- [X] T064 [US5] [ALERT-001–ALERT-004, ALERT-010, OPS-003] **DB-M4 (4/5)**: Add the `AlertStatus` enum and `status`, `conditionKey`, `thresholdValue`, `observedValue`, `periodStart`/`periodEnd`, `triggeredAt` (backfilled from `createdAt`), `resolvedAt`, `resolutionReason`, and `dismissedAt`. Add the open-key partial unique index and the cooldown lookup index as explicit SQL. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts4>_alert_lifecycle/migration.sql` with `ts4 > ts3`. Depends on T050. Verify legacy alerts read as `ACTIVE` with a null key and T008 passes.
  **As built:** `20260924130000_alert_lifecycle`.
  - **Backfill.** `triggeredAt` is added nullable, set from `createdAt`, then made `NOT NULL DEFAULT CURRENT_TIMESTAMP`, so no legacy row is stamped with the migration time. The application sets `triggeredAt` from the injectable clock, never from the default.
  - **Indexes.** The partial unique index `Alert_open_condition_key` exists only in SQL. A scratch-database check showed that Prisma 7.7's schema diff ignores it, so it causes no drift. The cooldown index `(userId, conditionKey, triggeredAt DESC)` and a list index `(userId, status, triggeredAt)` are declared in the schema.
  - **Verification.** T008 passes: empty install, upgrade from the baseline, and repeated deploy, with no drift. An upgrade proof seeded legacy alerts at DB-M3. After DB-M4 they read `ACTIVE` with a null key and `triggeredAt = createdAt`, with read state unchanged. Two open rows with the same key are rejected; any number of `RESOLVED` rows plus one open row are accepted.
- [X] T065 [US5] [ALERT-005–ALERT-007, OPS-003] **DB-M5 (5/5)**: Add `AlertDelivery` (EMAIL channel, status, skipReason, provider, `attemptCount` CHECK 0–3, timestamps, sanitized failure, unique `(alertId, channel)`) in `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts5>_alert_delivery/migration.sql` with `ts5 > ts4`. Depends on T064. **Schema-only.** It contains no `AlertSetting` data step; the final I2 decision is to preserve existing `emailEnabled` values (data-model "AlertSetting"). Verify no delivery backfill, `AlertSetting` rows byte-identical before and after, and that T008 passes.
  **As built:** `20260924130100_alert_delivery`.
  - **Schema.** The enums `AlertDeliveryChannel` (`EMAIL`, with `IN_APP` reserved) and `AlertDeliveryStatus`. `provider`, `skipReason`, and `failureCode` are text, with their values documented in the schema. The table cascades from both `Alert` and `User`, with an index on `(userId, status)`. The CHECK constraint `AlertDelivery_attemptCount_check` is SQL only and causes no drift.
  - **Verification.** T008 passes. The upgrade proof seeded `AlertSetting` rows at DB-M3, including `emailEnabled = true` with in-app off. The md5 of their ordered `row_to_json` values is identical before and after DB-M4 and DB-M5. Zero delivery rows exist after the upgrade, and an `attemptCount` of 4 is rejected by the CHECK.

### Lifecycle core and API

- [X] T066 [P] [US5] [ALERT-002, ALERT-003, ALERT-010, ALERT-011, TEST-002] Add the `AlertCondition` type contract in `apps/api/src/modules/alerts/evaluators/alert-condition.ts` (key, holds, type, severity, threshold, observed, window, target, creation-limit flag). Add failing clock-controlled lifecycle tests in `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts`; depends on T030 and T064. Cover:
  - create when the condition holds, no key is open, and 24h have passed since the last trigger;
  - no create while `DISMISSED` is open;
  - resolve from `ACTIVE` and from `DISMISSED` (keeping `dismissedAt`);
  - no create within 24h;
  - create at the first evaluation after 24h;
  - a concurrent unique violation leaves a single open row;
  - null-key rows are never touched.
  **As built:** `evaluators/alert-condition.ts` defines `AlertCondition`:
  - the identity: key, `holds`, type, severity, target;
  - the evidence: threshold, observed value, window;
  - `mayCreate`, the matrix creation limit;
  - the resolution reason;
  - a sanitized title, message, and metadata.

  It also exports `ALERT_COOLDOWN_MS` (24h).

  `alert-lifecycle.service.spec.ts` has 14 tests (19 after the review's overflow regression tests) against a fake repository that enforces the partial unique index. The red baseline, against a stub, was 14 of 14 failing. Beyond the listed cases, it covers:
  - a cooldown measured from the latest trigger, not the latest resolution;
  - a creation limit that still resolves;
  - independent warning and critical tiers;
  - `RESOLVED` being terminal;
  - another user's same key.
- [X] T067 [US5] [ALERT-001–ALERT-003, ALERT-010] Implement `applyConditions()` in `apps/api/src/modules/alerts/alert-lifecycle.service.ts` and the lifecycle repository methods in `apps/api/src/modules/alerts/alerts.repository.ts`; depends on T066. Verify T066 passes.
  **As built:** `applyConditions(tx, userId, conditions, now)` runs inside the caller's transaction.
  - **Resolution first.** Open rows whose condition no longer holds resolve, grouped by reason.
  - **Creation.** It opens a row only when the condition holds, `mayCreate` is true, no row is open, and the key's latest `triggeredAt` is at least 24h before `now`. A suppressed crossing is reported and never stored.
  - **Repository methods (`alerts.repository.ts`):**
    - `lockUserEvaluation`: `pg_advisory_xact_lock` per user;
    - `openOccurrences` and `openOccurrencesWithPrefix`;
    - `latestTriggers`;
    - `insertOccurrence`: `createManyAndReturn` with `skipDuplicates`, i.e. `ON CONFLICT DO NOTHING`, so a concurrent winner leaves the transaction usable where a caught unique violation would abort it;
    - `resolveOccurrences`: only rows that are still open.
  - **Scope.** Only keyed rows are queried, so null-key rows are never touched, and read state is never written. `triggeredAt` and `createdAt` come from the passed clock. T066 passes, 14 of 14.
- [X] T068 [US5] [ALERT-004, ALERT-005, ALERT-010, ALERT-011] Extend the alerts API. Files: `apps/api/src/modules/alerts/alerts.controller.ts`, `apps/api/src/modules/alerts/alerts.service.ts`, `apps/api/src/modules/alerts/dto/*`, `apps/api/src/modules/alerts/alerts.mapper.ts`. Depends on T022 and T067. Scope:
  - `PATCH /alerts/:id/dismiss` (409 when resolved);
  - `GET /alerts/unread-count` (`isRead = false`);
  - `status` filter and lifecycle response fields;
  - read and read-all change only `isRead`/`readAt`;
  - `POST /alerts` rows get a null `conditionKey` and no delivery row (`emailDelivery: null`);
  - `defaultAlertSettings()` sets `emailEnabled: false` for every type in newly created settings, while existing rows are untouched;
  - `emailEnabled: true` with `inAppEnabled: false` for the same type is rejected with 400;
  - the `LARGE_TRANSACTION` threshold must be greater than 0;
  - `emailAvailable` on settings.

  Verify read does not change status and dismiss does not erase history.
  **As built:**
  - **New routes.** `GET /alerts/unread-count` returns `{count}`, where the count is `isRead = false` whatever the status. `PATCH /alerts/:id/dismiss`:
    - ACTIVE → DISMISSED, setting `dismissedAt` from the clock and marking the alert read while keeping an earlier `readAt`;
    - an already-DISMISSED alert is returned unchanged;
    - RESOLVED gives 409 `ALERT_RESOLVED`;
    - the write is conditional on ACTIVE, so a concurrent resolution wins;
    - owner-safe 404.
  - **List.** It adds a `status` filter and the contract's `isRead` query name; the old `read` name is kept.
    - **Fix.** Both now parse `"false"` as false. The old `@Type(() => Boolean)` read `"false"` as true (pre-existing bug).
    - **Order.** It gains an `id` tie-break.
  - **Responses.** They carry every lifecycle field plus `emailDelivery`, which is null without a delivery row.
  - **`POST /alerts`.** It writes `conditionKey: null` explicitly.
  - **Settings.**
    - `defaultAlertSettings()` sets email off for every type in newly created settings; `createMany(skipDuplicates)` never rewrites existing rows.
    - `PATCH /alerts/settings` rejects a resulting `emailEnabled` with in-app off (400), checked whenever the request changes either flag.
    - `threshold` must be greater than 0 for every type, per the contract's `exclusiveMinimum: 0` (0 was accepted before); `null` clears it.
    - Responses carry `emailAvailable`, which is `EMAIL_TRANSPORT !== disabled`.
  - **Providers.** `AlertsService` now injects `ConfigService` and `Clock`; `AlertsModule` provides `Clock` and `AlertLifecycleService`.
  - **Verification.** Covered end to end in T091.

### Budget threshold semantics

- [X] T069 [P] [US5] [BUDGET-001, BUDGET-002, BUDGET-004, BUDGET-005, TEST-002] Add failing tests; depends on T033.
  - In `apps/api/src/modules/budgets/budget-threshold.policy.spec.ts`, for the shared pure threshold function: warning 1–99, critical at exactly 100, legacy values of 100 or more meaning no warning, and boundary equality.
  - In `apps/api/src/common/finance/budget-spend.query.spec.ts`, for the MONTHLY period instance:
    - user-month boundaries with month-start day 1 and 25; for example, 2026-09-23 with day 25 gives instance start `2026-08-25`;
    - clipping to `startsAt`/`endsAt`, and no instance outside the active range;
    - non-MONTHLY budgets return "not supported".
  **As built:**
  - `budget-threshold.policy.spec.ts`: 15 tests.
  - `budget-spend.query.spec.ts`: 19 tests (21 after the review's date-only regression tests), covering the active range (local dates, inclusive end, a zone west of UTC), instances (day 1 and day 25, the rollover instant, clipping at either end, no instance outside the range, a one-day instance, non-MONTHLY unsupported), and the spend aggregate through a fake `groupBy`.
  - **Red baseline.** Against stubs, 33 of 34 failed; the one pass was the constant 100.
- [X] T070 [US5] [BUDGET-001, BUDGET-002, BUDGET-004, BUDGET-005] Implement the threshold policy, the MONTHLY period instance, and the shared spend aggregate; depends on T069.
  - **Files:** `apps/api/src/modules/budgets/budget-threshold.policy.ts`, `apps/api/src/common/finance/budget-spend.query.ts`, `apps/api/src/modules/budgets/dto/*`, `apps/api/src/modules/budgets/budgets.mapper.ts`, `apps/api/src/modules/budgets/budgets.service.ts`, `apps/api/src/modules/dashboard/dashboard.repository.ts` (hot budgets use the same aggregate).
  - **Validation:** set DTO validation to `@Min(1) @Max(99)`. All period values stay accepted.
  - **Response fields:** add `warningThresholdActive`, `criticalThresholdPercent`, `alertsSupported` (MONTHLY only), and `usageBasis`.
  - **Projections:** recompute `isNearThreshold` and `GET /budgets/alerts` from the shared function, with no alert writes.

  Verify T069 passes, a threshold of 100 on write returns 400, and a WEEKLY budget is accepted with `alertsSupported: false`.
  **As built:**
  - **Threshold policy.** It is implemented in `common/finance/budget-threshold.policy.ts`, and the listed `budgets/budget-threshold.policy.ts` re-exports it (deviation), so the dashboard and the alert evaluator share it without a feature import. `budgetThresholdState` compares exact decimals: 79.999% is not 80%. A zero amount holds nothing. `isNearThreshold` is the warning when the warning is active, otherwise the critical.
  - **Period instance.** `budget-spend.query.ts` provides `budgetActiveRange`, `monthlyInstanceForMonth`, and `monthlyInstanceAt`.
  - **Spend aggregate.** `budgetSpend` runs one `groupBy` per distinct range, matches currency with `normalizeCurrency`, and never sums across currencies.
  - **Decision (spec silent): all-categories budgets.** A budget with no category counts every eligible expense, uncategorized included, except categories marked `excludeFromBudget`. Before this, the spend of such budgets was always 0.
  - **Budgets API.**
    - DTO threshold is 1–99.
    - Responses add `warningThresholdActive`, `criticalThresholdPercent`, `alertsSupported`, `usageBasis`, and `usage.periodStart`/`periodEnd`.
    - MONTHLY usage is the period instance: the current one from the injectable `Clock`, or the requested user month for `?month=`.
    - Other periods keep the calendar-month projection.
    - `create` and `update` now return computed usage; before, they returned 0.
  - **Dashboard.** Hot budgets use the same aggregate, instance, and threshold rule. The now-unused `budgetSpending` was removed.
  - **Read-only projections.** No read writes alerts.
  - **Verification.** T069 passes, 34 of 34. The dashboard and ownership planning/alerts e2e suites pass, 123 tests. 400 for a threshold of 100 and WEEKLY with `alertsSupported: false` are asserted in T085.

### Evaluators — one pure function and spec per matrix row (parallel files)

- [X] T071 [P] [US5] [ALERT-009 budget rows, BUDGET-002, BUDGET-003, BUDGET-005] TDD the budget-threshold evaluator in `apps/api/src/modules/alerts/evaluators/budget-threshold.evaluator.spec.ts` then `budget-threshold.evaluator.ts`; depends on T067 and T070. Cover:
  - **MONTHLY budgets only**; WEEKLY, YEARLY, and CUSTOM produce no conditions;
  - separate `WARNING` and `CRITICAL` conditions keyed `budget:{id}:{instanceStartLocalDate}:{severity}`, where the instance start is the user-month start in the user's timezone (for example, `2026-08-25` with month-start day 25);
  - clipping to the budget's `startsAt`/`endsAt`;
  - both created when a single jump crosses 80 and 100;
  - past-period instances resolve only;
  - period end resolves with `PERIOD_ENDED`;
  - currency and category scoping.
  **As built:** `evaluateBudgetThresholds({now, settings, budgets, openKeys})` is pure; its spec has 18 tests.
  - **Conditions.** Only MONTHLY budgets with an instance at `now` produce conditions, with independent tiers. Legacy thresholds of 100 or more have no WARNING tier.
  - **Evidence.** threshold = the tier percent; observed = the exact usage %; window = the clipped usage range; the metadata records currency, amount, spent, and the instance date.
  - **Open keys not produced (`budget:` prefix):**
    - another instance → `PERIOD_ENDED`;
    - a budget that is gone, inactive, or no longer MONTHLY → `TARGET_REMOVED`;
    - a warning tier that no longer exists (legacy) → `BELOW_THRESHOLD`.

    These keys are never created.
  - **Imports.** The threshold rule comes from `common/finance/budget-threshold.policy.ts`. `budgets/budget-threshold.policy.ts`, the T069/T070 path, only re-exports it, so the evaluator imports no budgets feature code.
  - **Red baseline.** All 6 evaluator suites failed on missing modules before T071–T076 were implemented.
- [X] T072 [P] [US5] [ALERT-009 large-transaction row] TDD the large-transaction evaluator in `apps/api/src/modules/alerts/evaluators/large-transaction.evaluator.spec.ts` then `large-transaction.evaluator.ts`; depends on T033 and T067. Cover:
  - fires at or above the threshold;
  - VND default of 5,000,000, and inactive for other currencies when unset;
  - base-currency only, transfers excluded;
  - creation only in the current user month;
  - resolves on delete, ignore, duplicate, or amount drop;
  - no retroactive re-evaluation when the threshold setting changes.
  **As built:** `evaluateLargeTransactions` evaluates only the ids the trigger passes: creates, and updates touching amount, currency, direction, status, or duplicate. Other updates pass none, so a threshold change never re-evaluates existing transactions.
  - **Holds.** It holds for an eligible EXPENSE in the base currency at or above the threshold: the setting, else 5,000,000 for VND, else inactive.
  - **Creation.** `mayCreate` is true only when the transaction is in the current user month.
  - **Resolution reasons.** `TARGET_REMOVED` when the transaction is deleted, ignored, a duplicate, or pending. `CONDITION_CLEARED` when it is no longer a base-currency expense. `BELOW_THRESHOLD` when the amount dropped.
  - **Tests.** 20.
- [X] T073 [P] [US5] [ALERT-009 goal-risk row, GOAL-002, GOAL-004, SC-008] TDD the goal-risk evaluator in `apps/api/src/modules/alerts/evaluators/goal-risk.evaluator.spec.ts` then `goal-risk.evaluator.ts` using `computeFeasibility()`; depends on T060 and T067. It applies the same rounding rules as the simulation to the goal's **stored** horizon (`TARGET_DATE`, then `GOAL_MONTHS`, then `DEFAULT`; never the `QUERY` what-if value the Goals page slider sends). Cover:
  - fires when required > available (G1 holds; G2, G3, and G5 do not);
  - past deadline (G4) holds when the remaining amount exceeds available;
  - `INSUFFICIENT_DATA` (G8) resolves;
  - a completed, paused, archived, or deleted goal resolves.
  **As built:** `evaluateGoalRisk` calls the pure `computeFeasibility` without `queryMonths`, so it uses the stored horizon.
  - **Holds.** It holds when the goal is ACTIVE, has a remaining amount, and the required amount exceeds the available amount. Insufficient history never holds.
  - **Evidence.** threshold = available; observed = required; window = the observation months; the metadata records score, level, horizon source, and past deadline.
  - **Resolution.** A non-ACTIVE goal, or a deleted goal's open key, resolves `TARGET_REMOVED`.
  - **Tests.** 13, covering G1, G2 (stored horizon = DEFAULT), G3, G4 and a variant, G5, G6, G8, and G10(a).
- [X] T074 [P] [US5] [ALERT-009 cashflow-risk row, GOAL-003, SC-008] TDD the cashflow-risk evaluator in `apps/api/src/modules/alerts/evaluators/cashflow-risk.evaluator.spec.ts` then `cashflow-risk.evaluator.ts`; depends on T059, T060, and T067. The evaluator uses `completedMonthCashflow` in the user's base currency with floor rounding. Cover:
  - a negative 2–3-month mean produces `CRITICAL` (G6: −1,500,001);
  - goal commitments are not subtracted (pending confirmation);
  - insufficient data resolves.
  **As built:** `evaluateCashflowRisk` takes the available amount from `computeFeasibility` itself, with an empty goal in the base currency (its step 7), so floor and unit rounding cannot drift from the simulation.
  - **Holds.** CRITICAL when the projection is below 0. Insufficient data resolves `INSUFFICIENT_DATA`.
  - **Tests.** 9: G6 = −1,500,001, the zero boundary, flooring −0.5 → −1, the USD unit, and no goal subtraction.
- [X] T075 [P] [US5] [ALERT-009 repeated-sync-failure row] TDD the sync-failure evaluator in `apps/api/src/modules/alerts/evaluators/sync-failure.evaluator.spec.ts` then `sync-failure.evaluator.ts`; depends on T044 and T067. Cover:
  - three consecutive terminal runs in `FAILED`, `EXPIRED`, or `PARTIAL_FAILED` produce `WARNING`;
  - a `SUCCESS` run resolves;
  - disconnect resolves.
  **As built:** `evaluateSyncFailures` holds for a connected connection whose three newest terminal runs (RUNNING ignored) are all FAILED, EXPIRED, or PARTIAL_FAILED.
  - **Resolution reasons.** `SYNC_SUCCEEDED` when the newest run is a SUCCESS; `DISCONNECTED` when the connection is disconnected; `TARGET_REMOVED` when it is removed.
  - **Tests.** 9.
- [X] T076 [P] [US5] [ALERT-009 reconnect-required row] TDD the reconnect-required evaluator in `apps/api/src/modules/alerts/evaluators/reconnect-required.evaluator.spec.ts` then `reconnect-required.evaluator.ts`; depends on T041 and T067. Cover:
  - a provider-auth failure produces `CRITICAL`;
  - a user disconnect never fires;
  - reconnect or removal resolves.

### Email delivery adapter

  **As built:** `evaluateReconnectRequired` holds for status `EXPIRED` with no `disconnectedAt`, which is the stored provider-auth state.
  - **Never holds.** A user disconnect is REVOKED with `disconnectedAt`. `ERROR` is a provider or project failure: a project-wide 403 is classified REFUSED by `gmail-api.service`, never AUTH.
  - **Resolution reasons.** `RECONNECTED` when ACTIVE, `DISCONNECTED` when disconnected, `TARGET_REMOVED` when removed.
  - **Tests.** 5.
- [X] T077 [P] [US5] [ALERT-005–ALERT-007, CFG-007, TEST-002] Add failing delivery tests in `apps/api/src/modules/alerts/delivery/alert-delivery.service.spec.ts` with the in-memory fake in `apps/api/test/fakes/in-memory-email-transport.ts`; depends on T065 and T067. Cover:
  - skip reasons (`NOT_CRITICAL`, `EMAIL_DISABLED`, `NOTIFICATIONS_DISABLED`, `TRANSPORT_DISABLED`);
  - no delivery row is created for user-authored or legacy alerts;
  - success on attempt 1, 2, or 3;
  - 4xx and timeout retried;
  - 5xx and auth failures not retried;
  - total budget exhaustion;
  - a stale `PENDING` row becomes `FAILED/INTERRUPTED` and is never resent;
  - the body has no amount, merchant, category, account, or token.
  **As built:** `apps/api/test/fakes/in-memory-email-transport.ts` is a scriptable fake: `ok`, a failure code, or `hang`.
  - **Service spec (26 tests after the review; 25 at the red baseline).** Covers the fake timer, the fake repository, and the fixed clock:
    - every skip reason and their fixed order: transport (with email disabled, every delivery is `TRANSPORT_DISABLED`, per CFG-007 and research.md), then severity, then the type's opt-in, then notifications;
    - no row for a null-key alert;
    - success on attempt 1, 2, or 3, with the backoff sequence;
    - retries capped at 3;
    - REJECTED and AUTH not retried;
    - a hung attempt timed out and retried;
    - total-budget exhaustion;
    - errors never thrown;
    - interruption at budget + 30 s (from `lastAttemptAt` or `createdAt`), never resent, scoped to the user;
    - privacy.
  - **Red baseline.** Against a stub, 25 of 25 failed.
- [X] T078 [US5] [ALERT-005–ALERT-007, CFG-007, ERR-004] Implement the `EmailTransport` port and the `alert-delivery.service.ts` post-commit bounded attempts; depends on T002, T036, T068, and T077. T036 is a dependency only because both tasks edit `apps/api/package.json`.
  - **Transports:** `smtp` (nodemailer) and `log` (redacted, non-production).
  - **Disabled mode:** `EMAIL_TRANSPORT=disabled` selects no transport; every delivery is recorded as `SKIPPED/TRANSPORT_DISABLED`.
  - **Files:** `apps/api/src/modules/alerts/delivery/*` and `apps/api/src/modules/alerts/alerts.module.ts` (provider binding).
  - **Dependency:** add `nodemailer` to `apps/api/package.json`.

  Verify T077 passes and no network access occurs in tests.

### Orchestration and wiring

  **As built:** `delivery/`.
  - **Port.** `email-transport.ts` defines the port and the sanitized `EmailSendError` codes: TIMEOUT, CONNECTION, and TEMPORARY are retried; REJECTED and AUTH are not.
  - **Transports.**
    - `smtp-email.transport.ts`: nodemailer 7. `requireTLS` unless `SMTP_SECURE`; nodemailer's own timeouts equal the attempt timeout. `classifySmtpError` maps 5xx to REJECTED, 4xx to TEMPORARY, EAUTH/530/535 to AUTH, and ETIMEDOUT to TIMEOUT.
    - `log-email.transport.ts`: logs the recipient's domain and the subject only.
  - **Binding.** `email-transport.provider.ts` binds null for `disabled`. `alert-delivery.repository.ts` makes every write conditional on PENDING and on the expected attempt count.
  - **Service.** `alert-delivery.service.ts`:
    - `plan` runs inside the evaluation transaction;
    - `deliver` runs after commit, persisting each attempt before it is made;
    - backoff is 500 then 1000 ms; each attempt is capped at `min(attempt timeout, remaining budget)`;
    - `sweepInterrupted`.
  - **Message.** The subject is `CashLens: new critical alert`; the body is the type label and `${APP_PUBLIC_URL}/app/alerts`.
  - **Configuration.** It already existed from T002 and is unchanged; production still rejects `log`.
  - **Dependencies.** `nodemailer ^7.0.0` and `@types/nodemailer ^7.0.12`.
  - **Verification.** T077 passes. The binding and classification spec has 14 tests. No test opens a socket.
- [X] T079 [US5] [ALERT-003, ALERT-005, ALERT-006, ALERT-008, ALERT-009] Implement the alert evaluation orchestrator in `apps/api/src/modules/alerts/alert-evaluation.service.ts` and the evaluator input reader in `apps/api/src/modules/alerts/queries/alert-inputs.query.ts`; depends on T071–T076 and T078.
  - **Dependency direction** (plan.md "Alert module dependency direction"):
    - The input reader uses only the global `PrismaService` and the `common/finance/*` helpers (`financial-period-policy`, `completed-month-cashflow`, `budget-spend.query`), plus the pure `goals/goal-feasibility.ts`.
    - `alerts.module.ts` imports **no** feature module and uses no `forwardRef`.
  - **Entry points:** `onTransactionsChanged`, `onBudgetChanged`, `onGoalChanged`, `onSyncRunFinished`, `onConnectionStatusChanged`.
  - **Behavior:** runs only **after the triggering financial write has committed**. It respects `inAppEnabled`, runs evaluators and then `applyConditions()` in its own DB transaction, and delivers email after that commit. Evaluation errors are logged with a correlation ID and never fail or roll back the triggering request; the next trigger re-evaluates the level-based conditions.
  - **Interrupted-delivery sweep:** runs on alert read and evaluation, which also edits `apps/api/src/modules/alerts/alerts.service.ts`.
  - **Export:** from `apps/api/src/modules/alerts/alerts.module.ts`.

  Verify:
  - delivery errors never propagate to the caller;
  - a unit check asserts that the `alerts.module.ts` `imports` list contains no feature module;
  - the app boots with no circular-dependency warning.
  **As built:**
  - **Inputs.** `queries/alert-inputs.query.ts` reads inside the evaluation transaction, using only the database client and the shared finance helpers:
    - context and preferences (in-app on and email off by default when no settings row exists; notifications on by default);
    - open keys by prefix;
    - budgets with instance spend, from the shared aggregate;
    - goals with a per-currency `completedMonthCashflow`;
    - the base-currency cashflow;
    - changed transactions;
    - connections, and their last 3 terminal runs ordered `finishedAt DESC NULLS LAST`.
  - **Orchestrator.** `alert-evaluation.service.ts`:
    1. sweeps interrupted deliveries;
    2. runs one `$transaction` that takes `pg_advisory_xact_lock` per user, runs the evaluators of the triggered families over the user's whole current state (level-triggered, so a move's old period and category resolve as well), withholds creation for types with in-app off, applies the lifecycle, and plans one delivery per new alert;
    3. after commit, delivers the PENDING emails.

    Errors are logged with a UUID correlation id and returned as `{ok: false}`, never thrown.
  - **`AlertsService`.** It sweeps on list, and `emailAvailable` reflects the bound transport.
  - **Verification.**
    - `alerts.architecture.spec.ts`: `AlertsModule` has no `imports`; no `forwardRef(` appears under alerts; alerts imports no feature file except the pure `goals/goal-feasibility.ts`, which itself imports no Nest code or feature.
    - `alert-evaluation.service.spec.ts`: the order plan → commit → deliver, error containment, and in-app gating.
    - The full e2e suite boots `AppModule` with every feature importing `AlertsModule` and shows no circular-dependency error.
  - **Independent review (after T091).** The review found no HIGH defects. Each finding below was fixed with a regression test, re-verified by the full gate:
    1. A threshold or observed value beyond `Decimal(18,4)`, such as a goal target near the `Decimal(18,2)` maximum, made the insert overflow. That rolled back every later evaluation for the user. It is now stored as null with the exact value in metadata. Regression tests: 5 lifecycle unit tests, and an e2e goal of 5e14 that failed without the fix.
    2. A date-only budget date (UTC midnight) fell on the previous day west of UTC. It is now read as that date. Regression: 3 unit tests.
    3. PENDING deliveries were attempted one after another, so a later one could be swept as INTERRUPTED before its first attempt. They now start together. Regression: 1 unit test.
    4. `PATCH /alerts/read-all` could deadlock with an evaluation resolving several rows. It now takes the user's evaluation lock.
    5. `GET /budgets/summary` added amounts in different currencies. It now totals base-currency budgets only and reports `currency`. Regression: 1 e2e test.

    Also from the review:
    - Checked and found correct: the partial-index drift risk (T008 shows Prisma ignores the index).
    - Recorded as US5 follow-ups: at-least-once email after a timeout, and double counting across overlapping budgets.
- [X] T080 [P] [US5] [BUDGET-003, TX-005, ALERT-009] Wire `onTransactionsChanged` for the old and new affected periods and categories in `apps/api/src/modules/transactions/transactions.service.ts` after create, update, delete, ignore, duplicate, and category mutations. `apps/api/src/modules/transactions/transactions.module.ts` imports `AlertsModule`. Depends on T055 and T079. Verify an edit that moves category or month resolves and creates the correct conditions.
  **As built:** Every mutation awaits `onTransactionsChanged` after its own commit: create, update, `PATCH /:id/category`, reclassify, duplicate, ignore, and delete.
  - **Large-transaction ids.** They are passed on create, duplicate, ignore, and delete, and on an update that sends amount, currency, direction, status, isDuplicate, or duplicateOfTransactionId.
  - **Moves.** The budget, goal, and cashflow families re-evaluate the whole current state, so a move resolves the old period or category and evaluates the new one.
  - **Module.** `TransactionsModule` imports `AlertsModule`.
  - **Test adjustment.** In the US1 ownership suite, Alice's 90% budget now opens a real WARNING. Its assertions now count her two user-authored alerts and assert that the evaluator alert also stays unread.
- [X] T081 [P] [US5] [BUDGET-003, ALERT-009] Wire `onBudgetChanged` on budget create/update and add `POST /budgets/:id/recalculate` in `apps/api/src/modules/budgets/budgets.service.ts` and `apps/api/src/modules/budgets/budgets.controller.ts`. `apps/api/src/modules/budgets/budgets.module.ts` imports `AlertsModule`. Depends on T070 and T079. Verify threshold changes re-evaluate the current period.
  **As built:**
  - **Triggers.** Create, update, and archive call `onBudgetChanged` after the write. An archived budget's open keys resolve `TARGET_REMOVED`.
  - **Recalculate.** `POST /budgets/:id/recalculate` (200, owner-safe 404) returns `{budget, alertChanges: {evaluated, created, resolved}}`.
  - **Naming.** The injected field is named `alertEvaluation` because `BudgetsService.alerts()` already exists.
  - **Module.** `BudgetsModule` imports `AlertsModule`.
- [X] T082 [P] [US5] [ALERT-009 goal-risk row] Wire `onGoalChanged` on goal create/update/contribution/status change in `apps/api/src/modules/goals/goals.service.ts`. `apps/api/src/modules/goals/goals.module.ts` imports `AlertsModule`. Depends on T060 and T079. Verify the simulation GET remains side-effect free.
  **As built:** Create, update, contribution, and archive call `onGoalChanged`; status changes go through update. `GoalsModule` imports `AlertsModule`. A new unit test asserts the simulation never calls the evaluator, and the goals e2e suite still passes.
- [X] T083 [P] [US5] [ALERT-009 system rows and imported transactions] Wire the email pipeline in `apps/api/src/modules/email-ingestion/email-ingestion.service.ts` and `apps/api/src/modules/email-connections/email-connections.service.ts`. `apps/api/src/modules/email-ingestion/email-ingestion.module.ts` and `apps/api/src/modules/email-connections/email-connections.module.ts` import `AlertsModule`. Depends on T055 and T079.
  - Call `onTransactionsChanged` **once per committed sync batch** with the imported transactions' affected periods and categories, so imported expenses reach the budget, large-transaction, goal-risk, and cashflow-risk evaluators.
  - Call `onSyncRunFinished` for every terminal state, including lease expiry.
  - Call `onConnectionStatusChanged`.

  Verify an imported expense creates the same alerts as the equivalent manual expense, and a user disconnect never alerts.

### Frontend

  **As built:**
  - **Sync.** It collects the ids of the transactions it creates. After `finishRun` and the audit, it calls `onTransactionsChanged` once with them (the batch), then `onSyncRunFinished`. That call covers the terminal run, any RUNNING run that `acquireLease` expired, and a connection that became reconnect-required mid-run.
  - **Connection status.** `validAccessToken` evaluates `onConnectionStatusChanged` before rethrowing reconnect-required. `completeGmail` (connect/reconnect) and `disconnect` do too; a disconnect only resolves.
  - **Deviation.** The manual `POST /email-messages/:id/parse` can also create an imported transaction. It now goes through `ParserService.parseRequested`, which evaluates a created transaction, so `ParserModule` imports `AlertsModule`. A sync calls `parseMessage`, which never evaluates, so a batch is evaluated once.
  - **Idempotency.** US3 idempotency is unchanged: a replay creates nothing, so there is no id to evaluate.
  - **Modules.** `EmailIngestionModule`, `EmailConnectionsModule`, and `ParserModule` import `AlertsModule`.
- [X] T084 [US5] [ALERT-004–ALERT-006, ALERT-010, BUDGET-004, BUDGET-005, CFG-007, ERR-005] Complete the alert and budget UI; depends on T027, T045b, T068, T070, and T079. Files: `apps/web/src/features/alerts/components/AlertsPage.tsx`, `apps/web/src/features/settings/components/SettingsPage.tsx`, `apps/web/src/features/budgets/components/BudgetsPage.tsx`. Scope:
  - lifecycle status filter;
  - independent unread badge;
  - dismiss;
  - delivery status and skip reason;
  - "email unavailable" when disabled;
  - an email toggle disabled while in-app is off;
  - the large-transaction threshold input;
  - budget labels for legacy thresholds (`warningThresholdActive: false`) and for non-MONTHLY budgets ("alerts available for monthly budgets only").

  Verify loading, empty, skipped, failed, and retry displays.

### Per-type integration verification (each evaluator has its own suite)

  **As built:** No mock fallback anywhere; every number, status, and outcome comes from the API.
  - **`AlertsPage.tsx`:**
    - a lifecycle filter (open, dismissed, resolved, all), sent as `status`;
    - per-alert status and resolution reason, with any earlier dismissal kept;
    - mark read, and dismiss for an open alert only;
    - the email outcome: sent, pending, skipped with its reason, failed with its attempt count and failure class, or "in-app only" when there is no delivery row;
    - an unread count taken from `GET /alerts/unread-count`, with read-all;
    - an email-unavailable notice;
    - loading, empty, error, retry, and failed-refresh states;
    - mutation errors (such as the 409) shown as messages.
  - **Settings.** A new `settings/components/AlertSettingsCard.tsx`, mounted by `SettingsPage.tsx`, covers the five ALERT-009 types:
    - in-app and email switches, the email switch disabled while in-app is off, the transport is disabled, or the type is never CRITICAL;
    - the in-app switch locked while email is on, matching the server rule;
    - a large-transaction threshold input with save;
    - loading, error, and retry states.
  - **`BudgetsPage.tsx`:**
    - usage percent and status from the API;
    - a threshold line: warning plus critical, or the legacy "Ngưỡng cũ …: chỉ cảnh báo khi đạt 100%", or for non-monthly budgets "Chỉ ngân sách tháng có cảnh báo (alerts available for monthly budgets only)";
    - a calendar-month approximation note;
    - a create form with name, category (empty means all), amount, period (MONTHLY by default), a date-only start defaulting to the first of the month, and a 1–99 threshold, plus server field errors;
    - loading, empty, error, retry, and failed-refresh states.
  - **Deviations (files not in the task list):**
    - `TopBar.tsx`: the badge and drawer now use the server's unread count and `isRead`, replacing a browser-local read list;
    - `utils/alertEvents.ts`: refreshes the count across components;
    - `api/mappers.ts` and `types/alert.ts`, `types/budget.ts`: the lifecycle and delivery fields, and the corrected type labels (`CATEGORY_SHIFT`, `PARSER_ISSUE`, `SYSTEM`);
    - `config/mockData.ts` (unused): annotations narrowed to `Pick<>` so it still type-checks.
  - **Verification.**
    - Web type check and production build.
    - A headless-Edge run against a mock API passed 52 of 52 checks with no console errors or exceptions, and sent no email.
    - A second pass against the real built API on the test database, with `EMAIL_TRANSPORT=log` (non-production; it logs only the recipient domain and the subject), passed 14 of 14 checks. It covered: a CRITICAL cashflow alert recorded as SENT, a WARNING skipped as `NOT_CRITICAL`, the unread count, dismiss, the settings opt-in and lock, and the monthly and weekly budget labels.
  - **Lint.** Approximate lint (T096) reports only 5 pre-existing `any`, all on untouched lines. The official web lint config does not run (known limitation).
- [X] T085 [P] [US5] [SC-007, BUDGET-001–BUDGET-005, ALERT-009 budget rows] Add budget-alert integration tests in `apps/api/test/alerts-budget.e2e-spec.ts`; depends on T080, T081, and T083. Cover:
  - create, update, delete, ignore, duplicate, and recategory;
  - warning/critical independence;
  - past-period no-create;
  - recalculate;
  - 24h recross with a controlled clock;
  - legacy threshold ≥100;
  - an imported expense;
  - a month-start-day-25 user;
  - a WEEKLY budget that never alerts and reports `alertsSupported: false`.
  **As built:** `apps/api/test/alerts-budget.e2e-spec.ts`, 23 tests, with a controlled clock and one budget per scenario. It covers:
  - the ALERT-001 fields and a WARNING without a CRITICAL;
  - tier independence, and a single jump opening both tiers;
  - delete, ignore, and duplicate resolving;
  - recategory moving the condition to the new budget, and a move to a past month;
  - no creation for a past period;
  - `PERIOD_ENDED` at rollover;
  - the 24h re-cross: the crossing is suppressed at +2h and +24h−1ms and created at exactly +24h;
  - recalculation after a write that ran no trigger;
  - a threshold change;
  - archive (`TARGET_REMOVED`);
  - a threshold of 100 rejected with 400 while 99 is accepted;
  - a legacy threshold of 150;
  - a WEEKLY budget: CRUD with `alertsSupported: false`, never alerting;
  - currency scope;
  - read-only projections writing no alerts (list, summary, projection, and hot budgets);
  - a month-start-day-25 account;
  - an imported expense equal to the manual one, with the replay idempotent;
  - `SKIPPED/TRANSPORT_DISABLED` with `emailAvailable: false`: this suite's app binds no transport.
- [X] T086 [P] [US5] [SC-007, ALERT-009 large-transaction row] Add large-transaction integration tests (manual and imported) in `apps/api/test/alerts-large-transaction.e2e-spec.ts`; depends on T080 and T083.
  **As built:** `alerts-large-transaction.e2e-spec.ts`, 15 tests. It covers:
  - holding at exactly 5,000,000, and nothing below;
  - never for income, transfers, another currency, or last month;
  - an amount drop resolving, with a re-raise inside 24h not stored and created after 24h;
  - delete, ignore, non-expense, and duplicate resolving;
  - a user threshold applied, and a change not re-evaluating existing transactions (description edits, other transactions);
  - a USD base currency inactive until a threshold is set;
  - in-app off: no creation, while an open alert still resolves;
  - imported and manual transactions identical, one evaluation per batch, and a replay adding nothing.
- [X] T087 [P] [US5] [SC-007, ALERT-009 goal-risk row] Add goal-risk integration tests, including a change caused by an imported transaction, in `apps/api/test/alerts-goal-risk.e2e-spec.ts`; depends on T080, T082, and T083.
  **As built:** `alerts-goal-risk.e2e-spec.ts`, 12 tests, with the example clock and H1 rows. It covers:
  - G1 with the stored-horizon evidence;
  - the simulation GET, with and without `months`, and goal reads writing no alert;
  - a contribution resolving it;
  - G4 past deadline;
  - G5 and the DEFAULT horizon never alerting;
  - paused, completed, and deleted resolving `TARGET_REMOVED`;
  - G8 never alerting;
  - manual income resolving at exactly required = available;
  - an imported August income resolving it (`BELOW_THRESHOLD`).
- [X] T088 [P] [US5] [SC-007, ALERT-009 cashflow-risk row] Add cashflow-risk integration tests, including the email-eligible `CRITICAL` path and imported transactions, in `apps/api/test/alerts-cashflow-risk.e2e-spec.ts`; depends on T080 and T083.
  **As built:** `alerts-cashflow-risk.e2e-spec.ts`, 8 tests, with the in-memory transport. It covers:
  - G6 = −1,500,001 as CRITICAL, with `SKIPPED/EMAIL_DISABLED` by default;
  - opted in, SENT exactly once after recording, with no financial detail in the message and no re-send while open;
  - `NOTIFICATIONS_DISABLED`;
  - no goal-commitment subtraction;
  - base currency only;
  - `INSUFFICIENT_DATA` resolution after deletes;
  - recovery resolving it;
  - an imported August expense opening and emailing the CRITICAL alert.
- [X] T089 [P] [US5] [SC-007, ALERT-009 repeated-sync-failure row] Add repeated-sync-failure integration tests in `apps/api/test/alerts-sync-failure.e2e-spec.ts`; depends on T083.
  **As built:** `alerts-sync-failure.e2e-spec.ts`, 4 tests, with Gmail spied. It covers:
  - the third consecutive FAILED run opening a SYSTEM WARNING, and never reconnect-required;
  - a SUCCESS run resolving it;
  - a stale RUNNING run expired by the next lease counting as EXPIRED;
  - a user disconnect resolving it (`DISCONNECTED`) with no reconnect alert.
- [X] T090 [P] [US5] [SC-007, ALERT-009 reconnect-required row] Add reconnect-required integration tests in `apps/api/test/alerts-reconnect.e2e-spec.ts`; depends on T083.
  **As built:** `alerts-reconnect.e2e-spec.ts`, 4 tests. It covers:
  - a refused renewal (503 `RECONNECT_REQUIRED`) opening a SYSTEM CRITICAL, emailed once, with no mailbox address or token in the email;
  - a repeat not duplicating it;
  - a mid-sync 401 opening it, and an OAuth reconnect resolving it (`RECONNECTED`);
  - a project-wide 403 (REFUSED) never counting;
  - a user disconnect never alerting and resolving an open alert (`DISCONNECTED`).
- [X] T091 [P] [US5] [SC-007, ALERT-001, ALERT-004–ALERT-008, ALERT-010, ALERT-011] Add lifecycle and delivery integration tests in `apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts`; depends on T068, T078, and T080. Cover:
  - every evaluator-created alert carries the ALERT-001 fields (type, severity, target, condition key, window, threshold, observed value, trigger time, sanitized explanation);
  - no evaluator ever emits `CATEGORY_SHIFT` or `PARSER_ISSUE` (ALERT-008 exclusions);
  - read versus status;
  - dismiss blocks duplicates;
  - unread count;
  - legacy and `POST /alerts` null-key rows;
  - the email skip matrix;
  - three attempts, interrupted delivery, and privacy, using the fake transport.

**Checkpoint**: US5 provides every approved P1 alert type with deterministic, independently verified evaluators and no generalized event infrastructure.

---

## Phase 8: P2 — Cross-Cutting Quality and Operability

**Purpose**: Standardize errors and logging, complete frontend and E2E evidence, and prove runtime behavior across all stories.

  **As built:** `alerts-lifecycle-delivery.e2e-spec.ts`, 20 tests, with the in-memory transport and delivery options of 200 ms per attempt and 2 s in total. It covers:
  - the ALERT-001 fields on budget, large-transaction, and cashflow alerts;
  - no CATEGORY_SHIFT or PARSER_ISSUE;
  - read versus status, and resolution keeping the read state;
  - read-all changing no status, and the unread count;
  - the status and `isRead` filters (`"false"`), with 400 for invalid values;
  - dismiss: read, idempotent, blocking re-alerting at +49h, and resolving from DISMISSED with `dismissedAt` kept;
  - 409 for a resolved alert;
  - owner-safe 404;
  - POST and legacy null-key rows untouched, with no delivery;
  - settings defaults, the email-needs-in-app 400, and thresholds of 0 or below rejected with 400;
  - the skip matrix (`TRANSPORT_DISABLED` is in T085);
  - sent on the third attempt;
  - three hung attempts: FAILED/TIMEOUT within the budget, with the trigger still 201;
  - REJECTED and AUTH not retried;
  - an interrupted PENDING row set to FAILED/INTERRUPTED on read and never resent;
  - the exact email text;
  - five concurrent triggers leaving one open row and one email;
  - a racing insert on the partial index being a no-op.
- [ ] T092 [P] [ERR-001, ERR-002, ERR-004, ERR-006] Add failing API error and envelope contract tests in `apps/api/test/error-contract.e2e-spec.ts`; depends on T030. Verify:
  - errors carry a stable code, message, fields, and `correlationId`, with no stack or secret leakage;
  - success responses, including sync and goal simulation, carry `{success, data, message, timestamp}`.
- [ ] T093 [ERR-001–ERR-006] Implement a global safe exception filter and request correlation context in `apps/api/src/common/filters/api-exception.filter.ts`, `apps/api/src/common/interceptors/base-response.interceptor.ts`, `apps/api/src/common/dto/base-response.dto.ts`, and `apps/api/src/main.ts`; depends on T005 and T092. Verify the existing success envelope remains compatible, with `correlationId` additive.
- [ ] T094 [P] [OPS-008, EMAIL-002, ALERT-007] Add failing log-redaction assertions in `apps/api/src/common/logging/logger.spec.ts` for cookies, tokens, encryption keys, SMTP password, raw bodies, parser payloads, and notification content; depends on T002. Verify correlation and resource/run IDs remain searchable.
- [ ] T095 [OPS-008, ERR-006] Configure structured Pino redaction in `apps/api/src/common/logging/*` and add contextual auth/sync/parser/classification/alert/delivery/startup events; depends on T029, T045, T079–T083, T093, and T094. The events are emitted from the same service files as T029, T045, and T080–T083, so it runs after them. Verify T094 passes without logging sensitive values.
- [ ] T096 [P] [TEST-006, ERR-005] Add the only component test runner: Vitest with `@testing-library/react` and jsdom, plus the `test` script. Files: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/test/setup.ts`. Depends on the stable P1 frontend tasks T045b, T047, T056, T062, and T084. Verify one existing page renders in headless mode.
- [ ] T096a [TEST-005, TEST-006, OPS-007] Add the only browser E2E runner: Playwright (`@playwright/test`) with headless Chromium only, as research.md "Browser E2E runner" describes; depends on T028, T046, and T096.
  - **Files:** `apps/web/package.json` (scripts `test:e2e` and `test:e2e:install`, the latter running `playwright install --with-deps chromium`), `apps/web/playwright.config.ts`, `apps/web/e2e/global-setup.ts`.
  - **Target:** the **development compose stack** (`docker compose up`, `NODE_ENV=development`). `baseURL` comes from `E2E_BASE_URL`, default `http://localhost:5173` (the Vite dev server), with the API at `http://localhost:3000/api`. Production HTTPS behavior is out of scope here; T012 and T100 cover it.
  - **Global setup:** provisions the first admin through `docker compose exec api yarn workspace api admin:bootstrap --email <run-scoped @example.test user>` and loads the T046 parser templates through the admin API.
  - **Diagnostics:** keep traces on failure.

  Verify a trivial spec that opens the sign-in page passes headlessly, and that no second browser framework is added.
- [ ] T097 [TEST-006, ERR-005] Add critical frontend tests under `apps/web/src/features/**/*.test.tsx` for auth renewal/sign-out, loading/empty/error/retry, transaction mutation/correction, sync continuation, alert lifecycle versus read state, goal insufficiency, and duplicate-submit prevention; depends on T096. Verify no runtime mock-data fallback.
- [ ] T098 [TEST-001, TEST-003, TEST-004, TEST-008, SC-011] Consolidate synthetic fixture builders in `apps/api/test/fixtures/builders/*` and write requirement-to-test traceability in `specs/001-operational-mvp/checklists/test-traceability.md`; depends on T030, T036, T048, T049, T057, T063, and T085–T091. Verify every AUTH, SEC, CFG, TX, DASH, EMAIL, CLASS, BUDGET, ALERT, and GOAL requirement names automated evidence.
- [ ] T099 [TEST-005, TEST-007, OPS-007] Add a headless clean-user smoke flow in `apps/web/e2e/operational-mvp.spec.ts`, run with the T096a Playwright configuration against the development compose stack; depends on T096a, T097, and T098. Steps:
  1. The T096a global setup provisions the admin via the bootstrap script and loads parser templates from T046 fixtures.
  2. Registration and login.
  3. Transaction to dashboard.
  4. Settings.
  5. Budget alert.
  6. Goal result.
  7. Fixture-backed email import.

  Verify that a failure blocks release. This flow is also the MVP substitute for deferred SC-012.
- [ ] T100 [OPS-001–OPS-009, AUTH-003, SEC-009, CFG-006, TEST-007, SC-013] Add a clean-checkout container verification script in `scripts/verify-release.ps1`, plus the reference proxy configuration `scripts/release/reference-proxy.nginx.conf` (illustrative, with no certificates, and documented by T105); depends on T006–T009, T026, T028, T093, and T099.
  - **Where it runs:** authoritatively on the **reference release host** (plan.md "Reference release host and release-test profile": the documented Linux Docker Engine deployment or CI host, with that proxy terminating TLS). It uses `docker compose --env-file .env.release-test -f docker-compose.prod.yml`. Results from any other host, including Docker Desktop, are recorded as informative only.

  It invokes `verify-migrations.ps1` and `scan-secrets.ps1`, then checks:
  - config, build, and migration;
  - the **TLS boundary and same-origin routing** in production mode:
    - `config` publishes the API and web on `127.0.0.1` only, leaves PostgreSQL unpublished, and pins `cashlens_net`;
    - `run --rm migrate` succeeds before `api` starts;
    - an `http://` `CORS_ORIGIN` makes startup fail;
    - `https://<release-test-host>/` serves the web app;
    - the served bundle references the relative `/api` and no absolute API origin;
    - `https://<release-test-host>/api/health/ready` returns 200 through the proxy;
    - login through the proxy returns `Set-Cookie` with `Secure; HttpOnly; SameSite=Lax`, and a following same-origin authenticated call with those cookies succeeds;
    - **TRUST_PROXY verification:** send one request through the proxy, read the peer address the API logged (`remoteAddress` in the structured request log), and **fail unless `TRUST_PROXY` covers it**. Record the observed address and the verified `TRUST_PROXY` in release evidence. No Docker gateway behavior is assumed;
    - direct `http://127.0.0.1:3000/api/auth/login` without a forwarded header returns 403 `HTTPS_REQUIRED`;
    - `/api/health/ready` over loopback HTTP returns 200;
  - the upgrade review (`--list-admins` output recorded, and unapproved admins revoked on an upgraded database);
  - admin bootstrap, including an idempotent rerun;
  - health;
  - restart and persistence, with no duplicate transactions after the restart (SC-013);
  - dependency outage;
  - graceful shutdown.

  Verify it runs without undocumented host state or volume deletion.
- [ ] T101 [DASH-004, TEST-001, TEST-007, SC-003, SC-004, SC-005, SC-010, SC-011] Run the full release check and record command evidence in `specs/001-operational-mvp/checklists/release-evidence.md`; depends on T036 and T092–T100. The run includes:
  - all API and web tests, including Playwright against the development stack (T096a);
  - regeneration of `apps/api/docs/swagger.json` and comparison with `contracts/openapi.yaml`, covering envelopes, `EmailSyncRun`, `GoalFeasibility`, `Alert`, `BudgetWrite`, and `UserSettingsWrite`;
  - typecheck, lint, and build;
  - the migration matrix;
  - the **gating dashboard benchmark**, on the **same reference release host and `.env.release-test` profile as T100**:
    - bring up the disposable `-p cashlens-bench` stack (`--env-file .env.release-test`, `docker-compose.prod.yml` plus `docker-compose.bench.yml`) in place of the release-check stack, on the same loopback ports behind the same proxy;
    - run `migrate`, then `bench:dashboard:seed --env-file .env.release-test` against `127.0.0.1:55432`, then `bench:dashboard --base-url https://<release-test-host>/api` through the proxy, with the test CA passed through `NODE_EXTRA_CA_CERTS`;
    - pass requires the 190th of 200 sorted sequential loads at 1,000 ms or less and zero failed responses;
    - record min, median, p95, max, and the host description (at least 2 vCPU and 4 GB);
  - the secret scan, recording the image digest and commit range;
  - the per-parser rate table and the exactly-3 replay result.

  Verify no critical test or configuration finding remains.

---

## Phase 9: P3 — User Story 7: Documentation and Release Readiness (Priority: P1)

**Goal**: A developer/operator can deploy and troubleshoot the validated MVP from a clean checkout using repository documentation only, within the SC-001 time limit.

**Independent Test**: A fresh operator follows the documentation, reaches healthy services, provisions the first administrator, runs migrations/tests and one smoke flow, restarts safely, and diagnoses a simulated dependency failure — timed and recorded.

- [ ] T102 [P] [US7] [DOC-001, DOC-002, SC-014] Replace the generic Turborepo landing page in `README.md` with CashLens purpose, supported MVP journeys, scope boundaries (including post-MVP SC-012 and deferred alert types), monorepo map, architecture, and principal data flow; depends on T101. Verify every command and link targets an existing file or package script.
- [ ] T103 [P] [US7] [DOC-002, OPS-001, OPS-003, SEC-009, CFG-006, SC-001, SC-014] Document local development in `docs/operations/local-development.md`; depends on T100. Cover:
  - prerequisites (Node 22 with Corepack, Docker, Git, PowerShell 7), environment setup via `scripts/init-local-env.ps1`, which writes random secrets into the ignored `apps/api/.env` without printing them and is checked with `git check-ignore`, and Docker startup/shutdown;
  - migrations in the DB-M1 to DB-M5 order;
  - development admin bootstrap and `EMAIL_TRANSPORT=disabled`;
  - the secret scan;
  - the e2e test database (`E2E_DATABASE_URL`) and Playwright browser install;
  - seed/provider fixtures, tests, build, and restart behavior;
  - a numbered **Smoke flow** section that SC-001 times: services ready, register, `admin:bootstrap`, create one transaction, and the dashboard shows it for the current month. Its last step is the SC-001 stop point.

  Verify the steps on a clean checkout.
- [ ] T104 [P] [US7] [DOC-003, EMAIL-001–EMAIL-013, DATA-001, DATA-002] Document Gmail in `docs/operations/gmail-oauth.md`: read-only consent, callback/test-account setup, listen rules, bounded manual sync, continuation, reconnect-required, rate limits, retention, the supported-parsers link, and common safe errors; depends on T049. Verify no usable credential or raw message appears.
- [ ] T105 [P] [US7] [DOC-004, CFG-001–CFG-007, OPS-002–OPS-009, SEC-009, ALERT-005, DATA-001, SC-014] Document deployment in `docs/operations/deployment.md`; depends on T007, T095, and T100. Cover:
  - the single-host **TLS boundary and same-origin routing**:
    - the operator-provided proxy or load balancer terminates TLS on **one public origin**;
    - required proxy routing: `/api/` → `http://127.0.0.1:3000` with the path preserved, and `/` → `http://127.0.0.1:8080`;
    - required proxy behavior: forward `X-Forwarded-Proto` and `Host`, redirect HTTP to HTTPS, and send HSTS. Reference `scripts/release/reference-proxy.nginx.conf` (T100) as the illustrative configuration;
    - the web image uses the relative `/api`, and cookies stay same-origin with credentials;
    - **`TRUST_PROXY` verification procedure**: start with `loopback,172.28.0.1`, or the fixed IP of a proxy container on `cashlens_net`. Confirm with `verify-release.ps1`, which reads the peer address the API logs for a proxied request. Set the verified value in the deployment env file. Never assume Docker gateway behavior;
    - loopback-only published ports, `https`-only origins, and `Secure` cookies;
    - configuration via `--env-file` kept outside the repository, and migrations via `docker compose --env-file <env> -f docker-compose.prod.yml run --rm migrate`;
  - the **reference release host** used for release verification (Linux Docker Engine deployment or CI host, at least 2 vCPU and 4 GB, reference proxy, release-test hostname and test CA) and the `init-local-env.ps1 -Profile release-test` profile;
  - required secrets and CORS/callbacks;
  - **upgrade notes**: existing `AlertSetting.emailEnabled` values are preserved, so accounts created under the previous default may receive budget CRITICAL emails once a transport is configured; stored raw-body preferences are preserved but have no effect;
  - **upgrade review of existing administrators (`--list-admins`, `--revoke`), first-administrator provisioning, and break-glass reuse**;
  - SMTP configuration versus disabled mode;
  - immutable images, health checks, and migration order;
  - backup/restore, key-rotation consequences, and rollback;
  - log redaction and secret scanning.

  Verify against the production compose configuration.
- [ ] T106 [P] [US7] [DOC-005, ERR-003, ERR-004, DATA-003, DATA-004, OPS-003, OPS-009] Document troubleshooting in `docs/operations/troubleshooting.md`; depends on T093, T095, and T100. Cover:
  - database, Gmail, parser, and sync failures;
  - bootstrap exit codes;
  - **`TRUST_PROXY` misconfiguration**:
    - symptom: every sign-in through the proxy returns 403 `HTTPS_REQUIRED`, or cookies lack `Secure`;
    - diagnosis: compare the `remoteAddress` the API logged for a proxied request with `TRUST_PROXY`, and confirm the proxy sends `X-Forwarded-Proto: https`;
    - fix: set `TRUST_PROXY` to cover the observed address and rerun `verify-release.ps1`;
  - **migration-service failure**:
    - symptom: `api` never starts because `migrate` did not complete successfully;
    - diagnosis: `docker compose … logs migrate`, which shows a failed migration, a database that cannot be reached, or an incompatible schema;
    - fix: restore from backup or roll back to the previous image, and never edit applied migrations;
  - email delivery `FAILED`/`INTERRUPTED`;
  - "alert appears only after next action", the no-scheduler limitation;
  - retention and deletion boundaries;
  - correlation-ID diagnosis.

  Verify each recovery action corresponds to an observable state.
- [ ] T107 [US7] [DOC-001–DOC-006, DATA-003, OPS-007, TEST-007, SC-001, SC-012, SC-014] Execute the **timed** US7 walkthrough per SC-001; depends on T102–T106.
  - **Performer:** an independent developer if available; otherwise the documentation author.
  - **Clean environment:** a fresh VM, OS account, or machine with no prior clone, empty Docker image and Yarn caches, and only the documented prerequisites.
  - **Clock:** starts at `git clone`. Stops when the last step of the documented Smoke flow succeeds, which is the dashboard showing the created transaction.
  - **Transcript:** record with `Start-Transcript` into `specs/001-operational-mvp/checklists/evidence/sc-001-transcript.txt`, then run `scan-secrets.ps1` over it.

  Record the following in **`specs/001-operational-mvp/checklists/release-evidence.md`** (the only release evidence file):
  - performer type, commit, host, clean-environment method, start and stop timestamps, and elapsed minutes (pass at 30 minutes or less), plus any undocumented step;
  - the SC-012 post-MVP disposition;
  - the synthetic-fixture attestation.

  Verify all links and commands, critical checks, and explicit post-MVP exclusions.

**Checkpoint**: US7 and the Operational MVP release package are complete.

---

## Dependencies and Execution Order

### Phase dependencies

1. Phase 1 runtime foundation starts immediately.
2. Phase 2 US1 depends on typed configuration (T002). T030 blocks all private feature integration.
3. Phase 3 US2 depends on US1 and creates the shared financial policy.
4. US3 and US4 may begin after T030; US4's ingestion hook (T055) waits for US3's parser/dedupe (T045).
5. US6 depends on US2 (T032/T033) and precedes US5's goal/cashflow evaluators.
6. US5 depends on US2, US3 sync/connection states, US4 correction hooks, and US6 feasibility.
7. P2 depends on the relevant P1 contracts; final smoke/release checks depend on all P1 stories.
8. P3 documentation uses validated P2 commands and completes release readiness.

### Migration stream (strict)

`T008 → T038 (DB-M1) → T040 (DB-M2) → T050 (DB-M3) → T064 (DB-M4) → T065 (DB-M5)`

Each migration task depends on the previous migration task, never on feature tests.

DB-M1 and DB-M3 touch unrelated tables but stay sequential. They share `schema.prisma`, and Prisma generates each migration from the prior migrated state. Timestamps must be strictly increasing and later than `20260627090000`. No existing migration folder may change; T008 enforces this.

### Critical path

The longest dependency chain by task count, computed mechanically from the `depends on` clauses:

`T001 → T002 → T010 → T011 → T018 → T019 → T020 → T024 → T025 → T026 → T027 → T030 → T031 → T032 → T033 → T058 → T059 → T060 → T073 → T079 → T084 → T096 → T096a → T099 → T100 → T101 → T102 → T107`

Parallel feeders must finish before their join points:

| Join point | Feeders |
|---|---|
| T054 | Gmail path: `T030 → T037 → T041 → T042 → T044 → T045` |
| T054 | Classification path: `T050 → T052 → T053` |
| T079 | Migration and lifecycle path: `T008 → T038 → T040 → T050 → T064 → T066 → T067 → T071…T076 (+T065 → T077 → T078)` |
| T080 | Transaction mutation path: `T033 → T034 → T054 → T055` |
| T098 | All per-type alert suites T085–T091 and the story suites T036, T049, T057, T063 |

### Safe parallel opportunities (file-disjoint)

- T001; then T003/T004/T009 after T002; then T006 ∥ T007 (`docker-compose.yml` versus `docker-compose.prod.yml` and Dockerfiles).
- T010 ∥ Phase 1 remainder. Then T011–T017, seven separate test files.
- Ownership fixes:
  - T022 (planning/alerts) ∥ T023 (email pipeline) ∥ T028 (bootstrap: new files and `package.json`).
  - T021 (finance core) and T024 (users) wait for T020 because they share the transactions/users DTO/mapper area.
- T031 ∥ T037 ∥ T039 ∥ T051, all test files, after T030.
- T035 (web) ∥ T034 (API). T043 ∥ T042. T046 ∥ T047. T045a (test file) ∥ T046/T047.
- T058 ∥ Phase 4 and Phase 5 work after T033.
- Evaluators T071–T076 are six separate file pairs and run fully in parallel once their inputs exist. T077 runs in parallel with the evaluators.
- Wiring T080 ∥ T081 ∥ T082 ∥ T083, one distinct host service each.
- Integration suites T085–T091 are seven separate files.
- T092 ∥ T094 ∥ T096. Docs T102–T106 are separate files.

**Not parallel (shared files, enforced by dependencies):**

| Shared file or area | Tasks, in order |
|---|---|
| `transactions.service.ts` | T021 → T029 → T034 → T054 → T055 → T080 |
| `email-ingestion.service.ts` | T023 → T029 → T044 → T045 → T055 → T083 → T095 |
| `TransactionsPage.tsx` | T035 → T056 |
| `SettingsPage.tsx` | T045b → T084 |
| `alerts.module.ts` | T078 → T079 |
| `alerts.service.ts` | T022 → T068 → T079 |
| `apps/api/src/main.ts` | T005 → T026 → T093 |
| `apps/api/package.json` | T010 → T028 → T036 → T078 |
| `apps/web/package.json` | T096 → T096a |
| `dashboard/*` | T033 → T070 (`dashboard.repository.ts`) |
| `schema.prisma` | The five migration tasks |
| `release-evidence.md` | T101 → T107 |

Implicit shared files (`yarn.lock`; each feature module's `*.module.ts` gaining an `AlertsModule` import) are also ordered:

- `yarn.lock` changes in T078 → T096 → T096a.
- T080–T083 each edit a different module file.

## Implementation Strategy

### Incremental checkpoints

1. Complete P0 runtime, the secret scan, and US1 security including bootstrap. Stop if any authorization, configuration, or scan check fails.
2. Complete US2 shared calculations before budget, goal, or alert math.
3. Deliver US3 Gmail (with declared parser fixtures) and US4 classification as independently testable increments.
4. Deliver US6 goals, then US5 alerts (lifecycle → evaluators → delivery → orchestrator → wiring → per-type suites), then align frontend contracts.
5. Complete P2 release evidence before writing final operational claims in P3 documentation.

### Requirement coverage audit

- **P0/P1 coverage**: AUTH-001–005, SEC-001–009, CFG-001–007, TX-001–005, DASH-001–004, EMAIL-001–013, CLASS-001–007, BUDGET-001–005, ALERT-001–011, GOAL-001–007, DATA-001–004, ERR-001–006, OPS-001–009, TEST-001–008, and DOC-001–006 map to tasks above. Every one of the 106 requirements is tagged on at least one task, and on at least one test, verification, or walkthrough task.
- **Success criteria**: each has a deterministic verification method.

  | Criterion | Tasks | Deterministic method |
  |---|---|---|
  | SC-001 | T103, T107 | Timed walkthrough from `git clone` to the last Smoke-flow step, in a clean environment, with a transcript; independent performer, with the author as fallback |
  | SC-002 | T011, T014–T017, T030 | Authorization matrices |
  | SC-003 | T001, T009, T101 | Config matrix plus Git-selected secret scan, exit 0 |
  | SC-004 | T049 | `REPLAYS = 3`, asserting after each replay |
  | SC-005 | T046, T048 | Per-parser independent rate at 85% or more; 0 declared parsers fails |
  | SC-006 | T051, T057 | Conflict fixtures repeated |
  | SC-007 | T085–T091 | Per-matrix-row suites |
  | SC-008 | T058, T063, T073, T074 | Worked examples G1–G10, exact to the VND |
  | SC-009 | T031, T036 | Canonical ledger totals |
  | SC-010 | T036 (tooling), T101 (gate) | 190th of 200 sorted sequential six-request loads at 1,000 ms or less; zero failures |
  | SC-011 | T098, T101 | Traceability file plus the full run |
  | SC-012 | Post-MVP | Substitute T099 |
  | SC-013 | T100 | Restart with no data loss and no duplicate transactions |
  | SC-014 | T102–T107 | Doc topics checked during the walkthrough |
  | SC-015 | T013, T028, T030 | Isolated-schema bootstrap cases |

- **Critical-rule verification**: each of the following has a dedicated automated test task:
  - session rotation, ownership (four groups), privileged-field rejection, and admin bootstrap;
  - financial eligibility;
  - Gmail lease, retry, and dedupe;
  - parser validity and per-parser rate;
  - classification precedence and manual lock;
  - alert lifecycle versus read state, each matrix row, and delivery attempts and privacy;
  - goal formula and insufficient data.
- **Technical-necessity tasks**: Migrations, health, secret scan, test fixtures, contract generation, and release scripts directly support OPS, TEST, and CFG requirements. No queue, scheduler, worker, cache, event bus, or replacement architecture task exists.
- **Remaining ambiguity**: None blocks implementation. The following use documented defaults and await product-owner confirmation:

  | Pending item | Where it is resolved |
  |---|---|
  | Cashflow-risk projection formula | T074 |
  | Large-transaction default threshold and single `WARNING` tier | T072 |
  | Sync-failure count of 3 and reconnect-required `CRITICAL` | T075, T076 |
  | SC-012 deferral | T107 |
  | INSTALLMENT scenario handling | T061 |
  | Retention of `POST /alerts` | T068 |
  | Operator review versus automatic demotion of pre-existing admins | T028, T100, T105 |

  Changing any default edits only the named task.

  The following were decided in the second pass and are **not** pending:

  | Decision | Task |
  |---|---|
  | `emailEnabled` preserved; DB-M5 is schema-only | T065 |
  | MONTHLY-only budget alert evaluation | T069–T071 |
  | TLS terminated by an external proxy | T026, T100 |
  | Git-selected secret-scan scope | T009 |

## Superseded task-ID map (pre-2026-09-23 → current)

| Old | New | Old | New | Old | New |
|---|---|---|---|---|---|
| T001–T008 | T001–T008 | T027 | T037 | T053 | T071–T076, T079 |
| — (new) | T009 secret scan | T028 | T038 | T054 | T078 |
| T009 | T011 | T029 | T039 | T055 | T084 |
| T010 | T010 helper + T014–T017 | T030 | T040 | T056 | T085–T091 |
| T011 | T012 | T031 | T041 | T057 | T058 |
| — (new) | T013 bootstrap tests | T032 | T042 | T058 | T059 |
| T012 | T018 | T033 | T043 | T059 | T060 |
| T013 | T019 | T034 | T044 | T060 | T061 (Swagger regen moved to T101) |
| T014 | T020 | T035 | T045 | T061 | T062 |
| T015 | T021–T024 | — (new) | T046 fixtures, T048 rate gate | T062 | T063 |
| T016 | T025 | T036 | T047 | T063 | T092 |
| T017 | T026 | T037 | T049 | T064 | T093 |
| T018 | T027 | T038 | T050 | T065 | T094 |
| — (new) | T028 bootstrap | T039 | T051 | T066 | T095 |
| T019 | T029 | T040 | T052 | T067 | T096 |
| T020 | T030 | T041 | T053 | T068 | T097 |
| T021 | T031 | T042 | T054 | T069 | T098 |
| T022 | T032 | T043 | T055 | T070 | T099 |
| T023 | T033 | T044 | T056 | T071 | T100 |
| T024 | T034 | T045 | T057 | T072 | T101 |
| T025 | T035 | T046 | T064 | T073–T077 | T102–T106 |
| T026 | T036 | T047 | T069, T071 | T078 | T107 |
| | | T048 | T067, T071 | | |
| | | T049 | T080, T081 | | |
| | | T050 | T068 | | |
| | | T051 | T065 | | |
| | | T052 | T066, T077 | | |

## Notes

- Tests are listed before implementation and should fail for the intended reason first.
- Preserve existing working endpoints and response fields unless the plan identifies an intentional security/concurrency/prototype correction.
- Before editing symbols, follow repository GitNexus impact-analysis requirements; before commit, run GitNexus change detection.
- Commit/review by task or cohesive migration-plus-consumer group; never rewrite existing Prisma migrations.
