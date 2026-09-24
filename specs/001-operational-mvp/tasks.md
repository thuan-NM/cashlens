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
| Parser-run payloads and raw sync/parser error text reach their owner unsanitized | EMAIL-011, ERR-003, SEC-008 | T045, T049 |
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
| The parser `vi_datetime` normalizer builds the instant in the server process timezone, so an email's user month depends on the host (UTC in the release image) | DASH-002, DASH-003, EMAIL-011 | T045 (strict parser-output gate), T046 fixtures |
| The parser keeps a minus sign on amounts, so a negative POSTED expense lowers totals; parsed currency codes are not normalized (`VNĐ`, `đ` form their own groups) | TX-002, TX-003, EMAIL-011 | T045 |
| Budget DTO `currency` is still `@IsString @MaxLength(3)`, and the web budget form never sends a currency (stored `VND`), so hot budgets of non-VND accounts count nothing | BUDGET-002, TX-002 | T069, T070 |
| Hot budgets without a category report 0 spent, and spend is not clipped to `startsAt`/`endsAt` | BUDGET-002 | T070 (shared spend aggregate) |
| `excludeFromAnalytics` no longer removes breakdown rows server-side (the breakdown must add up to the expense total, SC-009) | DASH-001, SC-009 | Product decision; T101 contract comparison |
| A transaction created without `currency` gets the schema default `VND`, not the account base currency | TX-002 | Product decision; T101 contract comparison |
| Duplicate links may form cycles, or point at an original that is later ignored or deleted, so an event can drop out of every total | TX-003, EMAIL-008 | Product decision; T045 layered deduplication |
| Transactions in an archived financial account still count (the documented eligibility rule is transaction-level only) | TX-003 | Product decision; T101 contract comparison |
| The web ESLint config cannot load (`eslint-plugin-react-refresh` and `typescript-eslint` are not installed for `apps/web`); this existed before US2 | ERR-005, TEST-006 | T096 (web test and tooling setup) |

---

## Phase 3: P1 — User Story 2: Trustworthy Transactions and Dashboard (Priority: P1)

**Goal**: Apply one persisted-data eligibility, period, timezone, transfer, duplicate, and currency policy across transaction and reporting flows.

**Independent Test**: A known data set produces identical hand-calculated transaction, dashboard, budget-input, and goal-input totals across edits and exclusions.

- [X] T031 [P] [US2] [TX-001, TX-002, TX-003, TX-005, DASH-001–DASH-003, BUDGET-002, DATA-004, TEST-002] Add failing golden tests for status eligibility, transfers, duplicates, timezone/month-start boundaries, and mixed currencies in `apps/api/src/common/finance/financial-period-policy.spec.ts`; depends on T030. Verify every documented edge case has an explicit expected total.
  **As built:** 53 golden cases. 43 were written first and seen failing individually against a throwing stub. 10 were added after T032 and never seen failing: 8 after an independent coverage review, with literals recomputed independently by Intl brute force, and 2 after the US2 review (month-key range, currency case). They cover every status × direction treatment, transfers, adjustments, duplicates, deleted rows, exact-decimal USD sums, per-currency groups, the savings rate, half-open month boundaries, month-start days 1/6/8/25/28, year rollover, DST (New York), skipped and doubled midnights (America/Havana, America/Santiago, Asia/Beirut), completed-month windows at the exact boundary, and settings fallbacks. Decisions the spec left open are recorded in data-model.md "Financial period policy (US2)".
- [X] T032 [US2] [TX-003, DASH-002, DASH-003, DATA-004] Implement shared Prisma predicates and UTC/user-period range helpers, including a completed-month range helper, in `apps/api/src/common/finance/financial-period-policy.ts`; depends on T031. Verify deterministic ranges across DST and non-first-day month starts.
  **As built:** pure `Intl`-based helpers (no dependency): `userMonthForKey`, `userMonthContaining`, `userMonthsEndingAt`, `recentUserMonths`, `completedUserMonths`, `completedMonthsRange`, `startOfLocalDay`, `localDateKey`, plus `eligibleTransactionWhere`/`visibleTransactionWhere`, exact-decimal `totalsByCurrency`, and `savingRatePercent`. A local day starts at its earliest instant; a month is labelled by the local month in which it starts. Results are identical with the process `TZ` set to UTC, America/Los_Angeles, or Pacific/Kiritimati. Prisma-backed aggregates shared by the consumers live in `apps/api/src/common/finance/financial-summary.query.ts`.
- [X] T033 [US2] [TX-001–TX-003, DASH-001–DASH-003] Refactor existing transaction, analytics, and dashboard repository queries to consume the shared policy. Files: `apps/api/src/modules/transactions/transactions.repository.ts`, `apps/api/src/modules/analytics/*`, `apps/api/src/modules/dashboard/*`. Depends on T032. Verify ignored, deleted, and duplicate rows and transfers are treated consistently.
  **As built:** dashboard, analytics, and the transaction list use only the shared policy and aggregates. Money fields are the base currency with additive `currency`/`currencies`; the breakdown includes uncategorized rows and `excludeFromAnalytics` categories and is no longer truncated; the trend is zero-filled; hot budgets spend in the budget currency; the list gains a user-month `month` filter and additive `totals` over all matching rows. `apps/api/test/transactions-dashboard.e2e-spec.ts` (T036) verifies it: 17 cases. The first 16 were run against the pre-US2 source, and 15 of them failed; the 17th (currency-case folding) was added after the review.
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
  **As built:** `transactions-dashboard.e2e-spec.ts` (17 cases: canonical ledger, list-versus-dashboard agreement, breakdown reconciliation, zero-filled trend, hot budgets, analytics, TX-005 recalculation, America/New_York month-start day 25 across DST, currency-case folding); the fixture, seeder, and runner under `apps/api/test/benchmark/` with `dashboard-bench.e2e-spec.ts` (12 cases: determinism, the DASH-004 mix for 13 months, isolated-database seeding whose API overview equals the independently computed totals, runner exit codes); `docker-compose.bench.yml` (pinned project `cashlens-bench`); package scripts. The legacy smoke suite now uses a fixed June 2026 period and passes 22/22 with unchanged expected values. Non-gating 20-load smoke run on the finished code: p95 59.2 ms, 0 failed responses, totals matched (research.md "Dashboard benchmark", As built). The gating run is T101.

**Checkpoint**: US2 is independently testable and supplies the shared calculation foundation for budgets, alerts, and goals.

---

## Phase 4: P1 — User Story 3: Safe Gmail Import (Priority: P1)

**Goal**: Finish the existing Gmail OAuth/ingestion/parser path with bounded incremental state, exclusion, retries, deduplication, privacy, observable continuation, and declared parser fixtures.

**Independent Test**: A synthetic mailbox with valid, non-matching, malformed, repeated, and cross-message duplicate events can be connected, synchronized concurrently and exactly three times repeatedly, continued, disconnected, and reconnected safely.

- [ ] T037 [P] [US3] [EMAIL-001–EMAIL-003, TEST-004] Add failing Gmail OAuth tests in `apps/api/src/modules/email-connections/gmail-oauth.service.spec.ts` for state, scope, token redaction, revocation, reconnect, and **provider-auth-failure versus user-disconnect** status; depends on T030. Verify read-only scope, expiring signed state, generic provider errors, and no password/token persistence.
- [ ] T038 [US3] [EMAIL-005–EMAIL-007, OPS-003] **DB-M1 (1/5)**: Add nullable cursor/backfill/lease fields, `EmailSyncStatus.EXPIRED`, `EmailSyncRun.emailsFailed` (default 0), `hasMore` (default false), and continuation evidence/indexes. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts1>_email_sync_progress/migration.sql` with `ts1 > 20260627090000`. Depends on T008. Verify T008 passes, legacy nulls are compatible, and the enum value is unused in the same migration.
- [ ] T039 [P] [US3] [EMAIL-007–EMAIL-012, TEST-002] Add failing parser-validity and layered-deduplication fixture tests in `apps/api/src/modules/email-ingestion/email-ingestion.service.spec.ts` and `apps/api/src/modules/parser/parser-engine.service.spec.ts`; depends on T030. Verify malformed output never posts, and precedence runs provider ID → transaction ID → fallback fingerprint.
- [ ] T040 [US3] [EMAIL-007, EMAIL-008, OPS-003] **DB-M2 (2/5)**: Add a nullable transaction fingerprint, strategy evidence, and an owner-scoped collision-safe index. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts2>_transaction_deduplication/migration.sql` with `ts2 > ts1`. Depends on T038. Verify the collision audit runs before uniqueness is enforced, and T008 passes.
- [ ] T041 [US3] [EMAIL-001–EMAIL-003, DATA-002, ALERT-009] Complete connection status and recovery in `apps/api/src/modules/email-connections/*`; depends on T037. Scope:
  - last success/failure and recovery action;
  - best-effort provider revocation and credential invalidation;
  - reconnect;
  - a distinct reconnect-required state for provider-auth failure versus user disconnect.

  Verify derived transactions and sanitized history survive disconnect.
- [ ] T042 [US3] [EMAIL-004–EMAIL-007, EMAIL-013] Implement atomic connection lease acquisition/expiry (recording expired runs as `EXPIRED`), opaque cursor persistence, bounded backfill, and continuation methods in `apps/api/src/modules/email-ingestion/email-ingestion.repository.ts` and `apps/api/src/modules/email-connections/email-connections.repository.ts`; depends on T038 and T041. Verify one active lease per connection and safe stale-lease recovery.
- [ ] T043 [P] [US3] [EMAIL-009, ERR-003] Implement bounded retry/backoff with jitter in `apps/api/src/modules/email-ingestion/gmail-api.service.ts`, distinguishing 429/5xx, revoked credentials, and permanent message failures; depends on T037. Verify mocked attempt limits and sanitized failure classification.
- [ ] T044 [US3] [EMAIL-004–EMAIL-007, EMAIL-009, EMAIL-013] Refactor the manual sync loop in `apps/api/src/modules/email-ingestion/email-ingestion.service.ts` and `apps/api/src/modules/email-ingestion/email-ingestion.mapper.ts`; depends on T042 and T043.
  - **Loop behavior:** lease, batch bound, continuation, per-message isolation, terminal run state, and cursor commit.
  - **Response contract:** keep the existing status names `SUCCESS`, `PARTIAL_FAILED`, and `FAILED`; populate `emailsFailed` and `hasMore`.

  Verify active-sync 409, no scheduler/queue dependency, and the response matches `contracts/openapi.yaml` `EmailSyncRun` inside the envelope.
- [ ] T045 [US3] [EMAIL-007, EMAIL-008, EMAIL-010–EMAIL-012, DATA-001] Implement the normalized transaction identity/fingerprint upsert and the strict parser-output gate. Files: `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`, `apps/api/src/modules/parser/parser-engine.service.ts`, `apps/api/src/modules/parser/parser.service.ts`, `apps/api/src/modules/transactions/transactions.repository.ts`. Depends on T033, T039, T040, and T044. Verify T039 passes and the raw body exists only in transient memory.
- [ ] T045a [P] [US3] [DATA-001, EMAIL-012, TEST-004] Add failing raw-body-preference tests in `apps/api/test/raw-body-preference.e2e-spec.ts`; depends on T030 and T045. Cover:
  - `PATCH /users/me/settings` with `storeRawEmailBody: true` returns 400 `RAW_EMAIL_BODY_UNAVAILABLE`, and the stored value is unchanged;
  - `false` returns 200;
  - responses include `rawEmailBodyAvailable: false`;
  - with a legacy stored `true` (inserted via Prisma), a fixture sync persists no raw body anywhere.
- [ ] T045b [US3] [DATA-001, EMAIL-012, ERR-005] Lock the raw-body preference; depends on T020 and T045a.
  - **API:** the settings DTO accepts only `false` for `storeRawEmailBody`. Responses add `rawEmailBodyAvailable: false`. Legacy stored values are preserved and never read.
  - **UI:** the Settings page renders the control disabled with an "Unavailable in this release" label, whatever the stored value.
  - **Files:** `apps/api/src/modules/users/dto/update-user-settings.dto.ts`, `apps/api/src/modules/users/users.mapper.ts`, `apps/web/src/features/settings/components/SettingsPage.tsx`.

  Verify T045a passes and the UI shows the label for both stored `true` and `false`.
- [ ] T046 [P] [US3] [FR-08, EMAIL-010, TEST-008, SC-005] Declare **at least one** supported MVP parser (bank, channel, version; the PRD targets 1–2 banks from the seeded providers) in a machine-readable table in `docs/operations/supported-parsers.md`, and author the synthetic fixtures; depends on T045.
  - **Fixtures:** under `apps/api/test/fixtures/email/<bank>/<channel>/<version>/{valid,malformed}/`, at least 10 valid (each with the expected normalized transaction) and at least 2 malformed per parser.
  - **Templates:** matching parser-template definitions in `apps/api/test/fixtures/parser-templates/*.json`.

  Verify only reserved test domains are used and the T009 scan is clean.
- [ ] T047 [P] [US3] [EMAIL-003, EMAIL-005, ERR-003, ERR-005] Expose sync counts, status, continuation, and reconnect states in `apps/web/src/features/email-connections/components/EmailPage.tsx` and `apps/web/src/features/ops/components/OpsPage.tsx`; depends on T027, T041, T044, and T045. Verify loading, partial, retry, conflict, reconnect, and continue actions.
- [ ] T048 [US3] [SC-005, EMAIL-010, EMAIL-011] Add the per-parser rate gate in `apps/api/test/parser-fixture-rates.e2e-spec.ts`; depends on T046. It computes each declared parser's rate **independently** (valid fixtures producing the exact expected transaction ÷ valid fixtures), with no averaging across parsers. Verify it fails in each of these cases:
  - zero parsers declared, or an unreadable or empty declaration table;
  - any single parser below 85%;
  - any parser with fewer than 10 valid or 2 malformed fixtures;
  - any malformed fixture creates a transaction.

  Each failure mode has its own negative test using a temporary declaration. The gate prints a per-parser table for release evidence.
- [ ] T049 [US3] [EMAIL-001–EMAIL-013, ERR-003, TEST-004, TEST-005, SC-004] Add fixture-backed integration tests in `apps/api/test/email-ingestion.e2e-spec.ts` for OAuth-to-transaction, concurrent sync, partial failure, disconnect/reconnect, continuation, and a replay loop with `REPLAYS = 3` that asserts after each iteration; depends on T041–T047. Verify the US3 independent test and no duplicate active transaction.

**Checkpoint**: US3 provides an operational manual Gmail pipeline with declared, measured parsers and no queue or scheduler infrastructure.

---

## Phase 5: P1 — User Story 4: Deterministic Classification (Priority: P1)

**Goal**: Reuse `MerchantRule` to classify predictably and preserve an append-only explanation for automatic and manual category changes.

**Independent Test**: Overlapping system/user rules, equal priorities, no match, manual correction, ingestion replay, and explicit reclassification produce one reproducible result and event history.

- [ ] T050 [US4] [CLASS-001, CLASS-005, OPS-003] **DB-M3 (3/5)**: Add nullable system-rule ownership, classification winner/manual metadata, and `TransactionCategoryEvent`. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts3>_classification_events/migration.sql` with `ts3 > ts2`. Depends on T040. Verify existing MANUAL rows remain protected, no fake history is backfilled, and T008 passes.
- [ ] T051 [P] [US4] [CLASS-001–CLASS-007, TX-004, TEST-002] Add failing precedence, numeric priority, createdAt/ID tie-break, fallback, manual-lock, conflict, and explicit-reclassification tests in `apps/api/src/modules/transactions/classification.service.spec.ts`; depends on T030. Verify exactly one explained outcome for every matrix row.
- [ ] T052 [US4] [CLASS-001–CLASS-004] Add owner/system rule query and validation methods around existing `MerchantRule` in `apps/api/src/modules/transactions/classification.repository.ts`; depends on T050 and T051. Verify system rules target system categories and user rules cannot target another user's category.
- [ ] T053 [US4] [CLASS-002–CLASS-007] Implement deterministic matching and winner explanation in `apps/api/src/modules/transactions/classification.service.ts`; depends on T052. Verify no ML/LLM path exists and all T051 tests pass.
- [ ] T054 [US4] [CLASS-005, CLASS-006, TX-004, SEC-006] Make manual category correction and explicit reclassification update current state and append events atomically in `apps/api/src/modules/transactions/transactions.service.ts` and `apps/api/src/modules/transactions/transactions.repository.ts`; depends on T034, T045, and T053. Verify automatic calls leave manual classifications unchanged.
- [ ] T055 [US4] [CLASS-002, CLASS-006, EMAIL-010] Invoke classification from manual transaction creation and successful email parsing in `apps/api/src/modules/transactions/transactions.service.ts` and `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`, without overwriting manual decisions; depends on T054. Verify retries are idempotent.
- [ ] T056 [US4] [CLASS-005, CLASS-006, ERR-005] Add reclassify and category-history endpoints and the correction/conflict UI. Files: `apps/api/src/modules/transactions/transactions.controller.ts`, `apps/api/src/modules/transactions/dto/*`, `apps/web/src/features/transactions/components/TransactionsPage.tsx`. Depends on T035 and T055. Verify an explicit warning before reclassification and a visible decision reason.
- [ ] T057 [US4] [CLASS-001–CLASS-007, TEST-004, TEST-005, SC-006] Add rule, correction, history, and ingestion-replay integration tests in `apps/api/test/classification.e2e-spec.ts`; depends on T052–T056. Verify the US4 independent test and append-only history.

**Checkpoint**: US4 is deterministic, explainable, and independently releasable.

---

## Phase 6: P1 — User Story 6: Goals from Actual Data (Priority: P1)

**Goal**: Remove fixed/prototype financial assumptions and return transparent goal feasibility from the user's eligible completed-month history. This phase precedes US5 because the goal-risk and cashflow-risk evaluators consume its feasibility function.

**Independent Test**: Positive, negative, zero-required, past-deadline, and 0/1/2/3-month histories reproduce hand-calculated inputs, score, level, or insufficient-data state.

- [ ] T058 [P] [US6] [GOAL-002–GOAL-007, TEST-002, SC-008] Add failing tests in `apps/api/src/modules/goals/goals.service.spec.ts` that assert the data-model worked examples **G1–G10 exactly, to the VND**; depends on T033. The examples use a controlled clock (`now = 2026-09-23T10:00+07:00`) and cover:
  - inclusive month counting, including a deadline in the current month and a past deadline (0 periods);
  - required saving rounded up;
  - available cashflow and score rounded down, including negative values;
  - band edges 99/80/79/50/49;
  - horizon precedence and `horizonSource`;
  - observation history from the earliest goal-currency transaction, with empty months counting as 0;
  - 0, 1, 2, and 3-month insufficient-data outcomes.

  Verify no fixed income, expense, interest, or free-cashflow value appears.
- [ ] T059 [US6] [GOAL-003, GOAL-005, GOAL-006] Add the shared Prisma-backed completed-month aggregation `completedMonthCashflow(prisma, userId, currency, now)` in `apps/api/src/common/finance/completed-month-cashflow.ts` and consume it from `apps/api/src/modules/goals/goals.repository.ts`; depends on T032 and T058.
  - It returns observation months from the history start with empty months as 0, keeps at most the 3 most recent completed months, and excludes the current month.
  - It lives in `common/finance`, not in the goals module, so the alert inputs query can reuse it without importing `GoalsModule`.

  Verify the current partial month and ineligible or other-currency records are excluded.
- [ ] T060 [US6] [GOAL-001–GOAL-007] Replace `assumedFreeCashflow` and the installment prototype math with the data-model GOAL rules; depends on T059.
  - **Files:** `apps/api/src/modules/goals/goal-feasibility.ts` (new), `apps/api/src/modules/goals/goals.service.ts`, `apps/api/src/modules/goals/goals.mapper.ts`.
  - **Pure function:** `computeFeasibility({ goal, now, queryMonths?, observation, userMonthPolicy })` has no Nest provider and is exported from the new file. It returns `remainingAmount`, `months` (remaining periods), `horizonSource`, `pastDeadline`, `monthlyRequired`, `availableMonthlyCashflow`, `feasibilityScore`, `status`, `observationMonths`, `monthsRequired`, and `reason`.

  Verify T058 passes and contribution/goal ownership remains intact.
- [ ] T061 [US6] [GOAL-002, GOAL-004, GOAL-005, GOAL-007, ERR-001] Align the goal simulation DTO and controller with `contracts/openapi.yaml` `GoalFeasibility` in `apps/api/src/modules/goals/dto/*` and `apps/api/src/modules/goals/goals.controller.ts`; depends on T060.
  - **Fields kept:** `monthlyRequired`, `feasibilityScore` (now nullable), and `months` (now the remaining periods).
  - **Fields added:** `horizonSource`, `pastDeadline`, `availableMonthlyCashflow`, `observationMonths`, `monthsRequired`, `reason`.
  - **INSTALLMENT (pending product-owner decision):** default is to accept the value, apply no inferred rate, set `totalCost = remainingAmount`, and state this in `reason`.

  Verify the response is enveloped.
- [ ] T062 [US6] [GOAL-004, GOAL-005, ERR-005, SC-008] Render observation inputs, exact result levels, `horizonSource` and past-deadline states, and insufficient-history guidance in `apps/web/src/features/goals/components/GoalsPage.tsx` and `apps/web/src/types/goal.ts`. **Remove** the `3900000` fallback and the client-side feasibility formula. Depends on T027 and T061. Verify loading/empty/error states and no fabricated projection.
- [ ] T063 [US6] [GOAL-001–GOAL-007, TEST-004, TEST-005, SC-008] Add real-data goal CRUD, contribution, and recalculation E2E tests in `apps/api/test/goals.e2e-spec.ts`; depends on T059–T062. They reproduce G1, G4, G6, and G8 through the API from persisted transactions. Verify the US6 independent test.

**Checkpoint**: US6 goal output is reproducible from persisted user data and exposes a pure feasibility function for alert evaluation.

---

## Phase 7: P1 — User Story 5: Budget Alerts and Notifications (Priority: P1)

**Goal**: Turn existing budget aggregation and alert CRUD into the ALERT-009 matrix with an `ACTIVE`/`DISMISSED`/`RESOLVED` lifecycle independent of read state, and opt-in critical email fallback.

**Independent Test**: Transactions cross, remain above, fall below, and re-cross thresholds, and each other matrix row triggers and resolves, while alert status, read state, and delivery follow the exact cooldown and preference rules.

### Schema (strict migration stream continues)

- [ ] T064 [US5] [ALERT-001–ALERT-004, ALERT-010, OPS-003] **DB-M4 (4/5)**: Add the `AlertStatus` enum and `status`, `conditionKey`, `thresholdValue`, `observedValue`, `periodStart`/`periodEnd`, `triggeredAt` (backfilled from `createdAt`), `resolvedAt`, `resolutionReason`, and `dismissedAt`. Add the open-key partial unique index and the cooldown lookup index as explicit SQL. Files: `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts4>_alert_lifecycle/migration.sql` with `ts4 > ts3`. Depends on T050. Verify legacy alerts read as `ACTIVE` with a null key and T008 passes.
- [ ] T065 [US5] [ALERT-005–ALERT-007, OPS-003] **DB-M5 (5/5)**: Add `AlertDelivery` (EMAIL channel, status, skipReason, provider, `attemptCount` CHECK 0–3, timestamps, sanitized failure, unique `(alertId, channel)`) in `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/<ts5>_alert_delivery/migration.sql` with `ts5 > ts4`. Depends on T064. **Schema-only.** It contains no `AlertSetting` data step; the final I2 decision is to preserve existing `emailEnabled` values (data-model "AlertSetting"). Verify no delivery backfill, `AlertSetting` rows byte-identical before and after, and that T008 passes.

### Lifecycle core and API

- [ ] T066 [P] [US5] [ALERT-002, ALERT-003, ALERT-010, ALERT-011, TEST-002] Add the `AlertCondition` type contract in `apps/api/src/modules/alerts/evaluators/alert-condition.ts` (key, holds, type, severity, threshold, observed, window, target, creation-limit flag). Add failing clock-controlled lifecycle tests in `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts`; depends on T030 and T064. Cover:
  - create when the condition holds, no key is open, and 24h have passed since the last trigger;
  - no create while `DISMISSED` is open;
  - resolve from `ACTIVE` and from `DISMISSED` (keeping `dismissedAt`);
  - no create within 24h;
  - create at the first evaluation after 24h;
  - a concurrent unique violation leaves a single open row;
  - null-key rows are never touched.
- [ ] T067 [US5] [ALERT-001–ALERT-003, ALERT-010] Implement `applyConditions()` in `apps/api/src/modules/alerts/alert-lifecycle.service.ts` and the lifecycle repository methods in `apps/api/src/modules/alerts/alerts.repository.ts`; depends on T066. Verify T066 passes.
- [ ] T068 [US5] [ALERT-004, ALERT-005, ALERT-010, ALERT-011] Extend the alerts API. Files: `apps/api/src/modules/alerts/alerts.controller.ts`, `apps/api/src/modules/alerts/alerts.service.ts`, `apps/api/src/modules/alerts/dto/*`, `apps/api/src/modules/alerts/alerts.mapper.ts`. Depends on T022 and T067. Scope:
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

### Budget threshold semantics

- [ ] T069 [P] [US5] [BUDGET-001, BUDGET-002, BUDGET-004, BUDGET-005, TEST-002] Add failing tests; depends on T033.
  - In `apps/api/src/modules/budgets/budget-threshold.policy.spec.ts`, for the shared pure threshold function: warning 1–99, critical at exactly 100, legacy values of 100 or more meaning no warning, and boundary equality.
  - In `apps/api/src/common/finance/budget-spend.query.spec.ts`, for the MONTHLY period instance:
    - user-month boundaries with month-start day 1 and 25; for example, 2026-09-23 with day 25 gives instance start `2026-08-25`;
    - clipping to `startsAt`/`endsAt`, and no instance outside the active range;
    - non-MONTHLY budgets return "not supported".
- [ ] T070 [US5] [BUDGET-001, BUDGET-002, BUDGET-004, BUDGET-005] Implement the threshold policy, the MONTHLY period instance, and the shared spend aggregate; depends on T069.
  - **Files:** `apps/api/src/modules/budgets/budget-threshold.policy.ts`, `apps/api/src/common/finance/budget-spend.query.ts`, `apps/api/src/modules/budgets/dto/*`, `apps/api/src/modules/budgets/budgets.mapper.ts`, `apps/api/src/modules/budgets/budgets.service.ts`, `apps/api/src/modules/dashboard/dashboard.repository.ts` (hot budgets use the same aggregate).
  - **Validation:** set DTO validation to `@Min(1) @Max(99)`. All period values stay accepted.
  - **Response fields:** add `warningThresholdActive`, `criticalThresholdPercent`, `alertsSupported` (MONTHLY only), and `usageBasis`.
  - **Projections:** recompute `isNearThreshold` and `GET /budgets/alerts` from the shared function, with no alert writes.

  Verify T069 passes, a threshold of 100 on write returns 400, and a WEEKLY budget is accepted with `alertsSupported: false`.

### Evaluators — one pure function and spec per matrix row (parallel files)

- [ ] T071 [P] [US5] [ALERT-009 budget rows, BUDGET-002, BUDGET-003, BUDGET-005] TDD the budget-threshold evaluator in `apps/api/src/modules/alerts/evaluators/budget-threshold.evaluator.spec.ts` then `budget-threshold.evaluator.ts`; depends on T067 and T070. Cover:
  - **MONTHLY budgets only**; WEEKLY, YEARLY, and CUSTOM produce no conditions;
  - separate `WARNING` and `CRITICAL` conditions keyed `budget:{id}:{instanceStartLocalDate}:{severity}`, where the instance start is the user-month start in the user's timezone (for example, `2026-08-25` with month-start day 25);
  - clipping to the budget's `startsAt`/`endsAt`;
  - both created when a single jump crosses 80 and 100;
  - past-period instances resolve only;
  - period end resolves with `PERIOD_ENDED`;
  - currency and category scoping.
- [ ] T072 [P] [US5] [ALERT-009 large-transaction row] TDD the large-transaction evaluator in `apps/api/src/modules/alerts/evaluators/large-transaction.evaluator.spec.ts` then `large-transaction.evaluator.ts`; depends on T033 and T067. Cover:
  - fires at or above the threshold;
  - VND default of 5,000,000, and inactive for other currencies when unset;
  - base-currency only, transfers excluded;
  - creation only in the current user month;
  - resolves on delete, ignore, duplicate, or amount drop;
  - no retroactive re-evaluation when the threshold setting changes.
- [ ] T073 [P] [US5] [ALERT-009 goal-risk row, GOAL-002, GOAL-004, SC-008] TDD the goal-risk evaluator in `apps/api/src/modules/alerts/evaluators/goal-risk.evaluator.spec.ts` then `goal-risk.evaluator.ts` using `computeFeasibility()`; depends on T060 and T067. It applies the same rounding rules as the simulation to the goal's **stored** horizon (`TARGET_DATE`, then `GOAL_MONTHS`, then `DEFAULT`; never the `QUERY` what-if value the Goals page slider sends). Cover:
  - fires when required > available (G1 holds; G2, G3, and G5 do not);
  - past deadline (G4) holds when the remaining amount exceeds available;
  - `INSUFFICIENT_DATA` (G8) resolves;
  - a completed, paused, archived, or deleted goal resolves.
- [ ] T074 [P] [US5] [ALERT-009 cashflow-risk row, GOAL-003, SC-008] TDD the cashflow-risk evaluator in `apps/api/src/modules/alerts/evaluators/cashflow-risk.evaluator.spec.ts` then `cashflow-risk.evaluator.ts`; depends on T059, T060, and T067. The evaluator uses `completedMonthCashflow` in the user's base currency with floor rounding. Cover:
  - a negative 2–3-month mean produces `CRITICAL` (G6: −1,500,001);
  - goal commitments are not subtracted (pending confirmation);
  - insufficient data resolves.
- [ ] T075 [P] [US5] [ALERT-009 repeated-sync-failure row] TDD the sync-failure evaluator in `apps/api/src/modules/alerts/evaluators/sync-failure.evaluator.spec.ts` then `sync-failure.evaluator.ts`; depends on T044 and T067. Cover:
  - three consecutive terminal runs in `FAILED`, `EXPIRED`, or `PARTIAL_FAILED` produce `WARNING`;
  - a `SUCCESS` run resolves;
  - disconnect resolves.
- [ ] T076 [P] [US5] [ALERT-009 reconnect-required row] TDD the reconnect-required evaluator in `apps/api/src/modules/alerts/evaluators/reconnect-required.evaluator.spec.ts` then `reconnect-required.evaluator.ts`; depends on T041 and T067. Cover:
  - a provider-auth failure produces `CRITICAL`;
  - a user disconnect never fires;
  - reconnect or removal resolves.

### Email delivery adapter

- [ ] T077 [P] [US5] [ALERT-005–ALERT-007, CFG-007, TEST-002] Add failing delivery tests in `apps/api/src/modules/alerts/delivery/alert-delivery.service.spec.ts` with the in-memory fake in `apps/api/test/fakes/in-memory-email-transport.ts`; depends on T065 and T067. Cover:
  - skip reasons (`NOT_CRITICAL`, `EMAIL_DISABLED`, `NOTIFICATIONS_DISABLED`, `TRANSPORT_DISABLED`);
  - no delivery row is created for user-authored or legacy alerts;
  - success on attempt 1, 2, or 3;
  - 4xx and timeout retried;
  - 5xx and auth failures not retried;
  - total budget exhaustion;
  - a stale `PENDING` row becomes `FAILED/INTERRUPTED` and is never resent;
  - the body has no amount, merchant, category, account, or token.
- [ ] T078 [US5] [ALERT-005–ALERT-007, CFG-007, ERR-004] Implement the `EmailTransport` port and the `alert-delivery.service.ts` post-commit bounded attempts; depends on T002, T036, T068, and T077. T036 is a dependency only because both tasks edit `apps/api/package.json`.
  - **Transports:** `smtp` (nodemailer) and `log` (redacted, non-production).
  - **Disabled mode:** `EMAIL_TRANSPORT=disabled` selects no transport; every delivery is recorded as `SKIPPED/TRANSPORT_DISABLED`.
  - **Files:** `apps/api/src/modules/alerts/delivery/*` and `apps/api/src/modules/alerts/alerts.module.ts` (provider binding).
  - **Dependency:** add `nodemailer` to `apps/api/package.json`.

  Verify T077 passes and no network access occurs in tests.

### Orchestration and wiring

- [ ] T079 [US5] [ALERT-003, ALERT-005, ALERT-006, ALERT-008, ALERT-009] Implement the alert evaluation orchestrator in `apps/api/src/modules/alerts/alert-evaluation.service.ts` and the evaluator input reader in `apps/api/src/modules/alerts/queries/alert-inputs.query.ts`; depends on T071–T076 and T078.
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
- [ ] T080 [P] [US5] [BUDGET-003, TX-005, ALERT-009] Wire `onTransactionsChanged` for the old and new affected periods and categories in `apps/api/src/modules/transactions/transactions.service.ts` after create, update, delete, ignore, duplicate, and category mutations. `apps/api/src/modules/transactions/transactions.module.ts` imports `AlertsModule`. Depends on T055 and T079. Verify an edit that moves category or month resolves and creates the correct conditions.
- [ ] T081 [P] [US5] [BUDGET-003, ALERT-009] Wire `onBudgetChanged` on budget create/update and add `POST /budgets/:id/recalculate` in `apps/api/src/modules/budgets/budgets.service.ts` and `apps/api/src/modules/budgets/budgets.controller.ts`. `apps/api/src/modules/budgets/budgets.module.ts` imports `AlertsModule`. Depends on T070 and T079. Verify threshold changes re-evaluate the current period.
- [ ] T082 [P] [US5] [ALERT-009 goal-risk row] Wire `onGoalChanged` on goal create/update/contribution/status change in `apps/api/src/modules/goals/goals.service.ts`. `apps/api/src/modules/goals/goals.module.ts` imports `AlertsModule`. Depends on T060 and T079. Verify the simulation GET remains side-effect free.
- [ ] T083 [P] [US5] [ALERT-009 system rows and imported transactions] Wire the email pipeline in `apps/api/src/modules/email-ingestion/email-ingestion.service.ts` and `apps/api/src/modules/email-connections/email-connections.service.ts`. `apps/api/src/modules/email-ingestion/email-ingestion.module.ts` and `apps/api/src/modules/email-connections/email-connections.module.ts` import `AlertsModule`. Depends on T055 and T079.
  - Call `onTransactionsChanged` **once per committed sync batch** with the imported transactions' affected periods and categories, so imported expenses reach the budget, large-transaction, goal-risk, and cashflow-risk evaluators.
  - Call `onSyncRunFinished` for every terminal state, including lease expiry.
  - Call `onConnectionStatusChanged`.

  Verify an imported expense creates the same alerts as the equivalent manual expense, and a user disconnect never alerts.

### Frontend

- [ ] T084 [US5] [ALERT-004–ALERT-006, ALERT-010, BUDGET-004, BUDGET-005, CFG-007, ERR-005] Complete the alert and budget UI; depends on T027, T045b, T068, T070, and T079. Files: `apps/web/src/features/alerts/components/AlertsPage.tsx`, `apps/web/src/features/settings/components/SettingsPage.tsx`, `apps/web/src/features/budgets/components/BudgetsPage.tsx`. Scope:
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

- [ ] T085 [P] [US5] [SC-007, BUDGET-001–BUDGET-005, ALERT-009 budget rows] Add budget-alert integration tests in `apps/api/test/alerts-budget.e2e-spec.ts`; depends on T080, T081, and T083. Cover:
  - create, update, delete, ignore, duplicate, and recategory;
  - warning/critical independence;
  - past-period no-create;
  - recalculate;
  - 24h recross with a controlled clock;
  - legacy threshold ≥100;
  - an imported expense;
  - a month-start-day-25 user;
  - a WEEKLY budget that never alerts and reports `alertsSupported: false`.
- [ ] T086 [P] [US5] [SC-007, ALERT-009 large-transaction row] Add large-transaction integration tests (manual and imported) in `apps/api/test/alerts-large-transaction.e2e-spec.ts`; depends on T080 and T083.
- [ ] T087 [P] [US5] [SC-007, ALERT-009 goal-risk row] Add goal-risk integration tests, including a change caused by an imported transaction, in `apps/api/test/alerts-goal-risk.e2e-spec.ts`; depends on T080, T082, and T083.
- [ ] T088 [P] [US5] [SC-007, ALERT-009 cashflow-risk row] Add cashflow-risk integration tests, including the email-eligible `CRITICAL` path and imported transactions, in `apps/api/test/alerts-cashflow-risk.e2e-spec.ts`; depends on T080 and T083.
- [ ] T089 [P] [US5] [SC-007, ALERT-009 repeated-sync-failure row] Add repeated-sync-failure integration tests in `apps/api/test/alerts-sync-failure.e2e-spec.ts`; depends on T083.
- [ ] T090 [P] [US5] [SC-007, ALERT-009 reconnect-required row] Add reconnect-required integration tests in `apps/api/test/alerts-reconnect.e2e-spec.ts`; depends on T083.
- [ ] T091 [P] [US5] [SC-007, ALERT-001, ALERT-004–ALERT-008, ALERT-010, ALERT-011] Add lifecycle and delivery integration tests in `apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts`; depends on T068, T078, and T080. Cover:
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
