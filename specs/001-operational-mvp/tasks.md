---
description: "Dependency-ordered implementation tasks for the CashLens operational MVP"
---

# Tasks: Operational CashLens MVP

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/openapi.yaml`, and `quickstart.md` in `specs/001-operational-mvp/`

**Organization**: Brownfield-first tasks extend existing modules. `[P]` means the task can run in parallel with adjacent tasks after its stated dependencies are complete. Every task identifies requirements, files, dependencies, outcome, and verification.

## Phase 1: P0 — Runtime Foundation (Shared Setup)

**Purpose**: Make configuration, startup, database readiness, and container behavior safe before feature work.

- [ ] T001 [P] [CFG-001, CFG-004, CFG-005, TEST-002] Add failing startup-configuration tests for missing, empty, malformed, and known-placeholder database, JWT, encryption, Gmail, origin, and callback settings in `apps/api/src/config/configuration.spec.ts`; depends on none; verify development/production cases and non-secret error messages.
- [ ] T002 [CFG-001, CFG-004, CFG-005] Implement typed environment parsing, production placeholder rejection, cookie/security settings, and encryption-key length checks in `apps/api/src/config/configuration.ts` and wire it through `apps/api/src/app.module.ts`; depends on T001; verify T001 passes and startup fails before binding a port.
- [ ] T003 [P] [CFG-002, CFG-003, EMAIL-002] Replace usable/default secret values with documented placeholders and required/optional annotations in `apps/api/.env.example` and the environment blocks of `docker-compose.yml`; depends on T002; verify repository secret scan and `docker compose config` with an explicit local env file.
- [ ] T004 [P] [OPS-004, ERR-004, TEST-004] Add failing liveness/readiness and database-outage tests in `apps/api/src/modules/health/health.controller.spec.ts` and `apps/api/test/health.e2e-spec.ts`; depends on T002; verify liveness remains 200 while readiness returns 503 for unavailable PostgreSQL.
- [ ] T005 [OPS-004, OPS-005, ERR-004] Add the minimal `HealthModule` with `/health/live` and database-backed `/health/ready`, enable Nest graceful shutdown, and register it in `apps/api/src/modules/health/*`, `apps/api/src/app.module.ts`, and `apps/api/src/main.ts`; depends on T004; verify health tests and SIGTERM shutdown.
- [ ] T006 [OPS-002, OPS-003, OPS-005] Harden development startup ordering and health checks in `docker-compose.yml` so migrations fail closed before API readiness and web waits for API health; depends on T003 and T005; verify repeated `prisma migrate deploy`, restart, and persistent-volume survival.
- [ ] T007 [P] [OPS-006, OPS-009, CFG-002, CFG-004] Add immutable multi-stage release images and a single-host production compose definition in `apps/api/Dockerfile`, `apps/web/Dockerfile`, and `docker-compose.prod.yml`; depends on T002 and T005; verify no source mount, dependency install, watcher, or embedded secret exists at runtime.
- [ ] T008 [OPS-001, OPS-003, TEST-007] Add an automated empty-database/current-schema/repeated-deploy migration check in `apps/api/test/scripts/verify-migrations.ps1`; depends on T006; verify all three paths exit nonzero on schema incompatibility and zero when valid.

**Checkpoint**: Configuration and runtime prerequisites are deterministic and testable.

---

## Phase 2: P0 — User Story 1: Secure Personal Data (Priority: P1)

**Goal**: Preserve current login/settings behavior while closing vertical privilege, mass-assignment, account-state, session, and horizontal ownership gaps.

**Independent Test**: Two users and one administrator exercise every protected resource with valid, missing, expired, disabled, cross-user, and insufficient-role credentials without exposing private data.

### Tests for User Story 1

- [ ] T009 [P] [US1] [SEC-002, SEC-003, SEC-004, SEC-005, SEC-007] Add failing role and privileged-field authorization tests for user CRUD, provider configuration, and parser templates in `apps/api/test/admin-authorization.e2e-spec.ts`; depends on T002; verify ordinary users cannot submit `role`, `status`, ownership, or system provenance fields.
- [ ] T010 [P] [US1] [SEC-001, SEC-005, SEC-007, SEC-008, TEST-003] Add a failing two-user/admin ownership matrix for accounts, transactions, categories, budgets, goals, alerts, email connections/rules/messages/parser runs/sync runs in `apps/api/test/resource-ownership.e2e-spec.ts`; depends on T002; verify owner-safe 404 versus role-based 403 policy.
- [ ] T011 [P] [US1] [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, TEST-004] Add failing session tests for registration, generic login failure, cookie flags, access expiry, refresh rotation/reuse, logout, and logout-all in `apps/api/test/auth-session.e2e-spec.ts`; depends on T002; verify no token or account-existence leakage.

### Implementation for User Story 1

- [ ] T012 [US1] [SEC-002, SEC-003, SEC-005] Add `@Roles()` metadata and an explicit administrator guard in `apps/api/src/common/decorators/roles.decorator.ts` and `apps/api/src/common/guards/roles.guard.ts`; depends on T009; verify guard unit cases for USER, ADMIN, absent role, and absent authentication.
- [ ] T013 [US1] [SEC-002, SEC-003, SEC-008] Apply administrator authorization only to account identity/status, bank-provider/sender, and parser-template management in `apps/api/src/modules/users/users.controller.ts`, `apps/api/src/modules/bank-providers/bank-providers.controller.ts`, and `apps/api/src/modules/parser/parser.controller.ts`; depends on T012; verify T009 role expectations and no admin access bypass on private modules.
- [ ] T014 [US1] [SEC-004, TX-002] Split self-service and privileged user DTO mappings so ordinary input cannot bind role, status, userId, metadata ownership, or classification provenance in `apps/api/src/modules/users/dto/*`, `apps/api/src/modules/users/users.mapper.ts`, and transaction DTO/mappers; depends on T012; verify whitelist/forbid-non-whitelisted field errors and unchanged stored privileged fields.
- [ ] T015 [US1] [SEC-001, SEC-005, SEC-008, DATA-004] Audit and repair owner predicates in existing repository/service methods under `apps/api/src/modules/{financial-accounts,transactions,transaction-categories,budgets,goals,alerts,email-connections,email-listen-rules,email-ingestion}/*`; depends on T010; verify the complete T010 matrix passes without adding duplicate repositories.
- [ ] T016 [US1] [AUTH-002, SEC-005, SEC-007] Reject disabled or soft-deleted accounts during JWT validation and refresh in `apps/api/src/modules/auth/strategies/jwt.strategy.ts`, `apps/api/src/modules/auth/auth.service.ts`, and `apps/api/src/modules/users/users.repository.ts`; depends on T011 and T015; verify old access/refresh credentials become unauthorized.
- [ ] T017 [US1] [AUTH-001, AUTH-003, AUTH-005] Make cookie flags and scopes configuration-driven, preserve refresh rotation, and sanitize auth audit records in `apps/api/src/modules/auth/auth.controller.ts` and `apps/api/src/modules/auth/auth.service.ts`; depends on T002, T011, and T016; verify all T011 cases pass.
- [ ] T018 [US1] [AUTH-002, ERR-002, TEST-006] Implement a single-flight refresh attempt for safe/idempotent requests and sign-out fallback without automatic mutation replay in `apps/web/src/api/client.ts` and `apps/web/src/providers/authProvider.ts`; depends on T017; verify concurrent 401 handling and no duplicate POST/PATCH/DELETE request.
- [ ] T019 [US1] [SEC-006, AUTH-005] Add sanitized audit writes for privileged account changes, settings changes, email connect/disconnect/sync, category corrections, and destructive financial actions using the existing audit repository in `apps/api/src/modules/users/users.repository.ts` and the affected services; depends on T013–T017; verify actor/resource/action evidence without secrets or raw email data.
- [ ] T020 [US1] [SEC-001–SEC-008, AUTH-001–AUTH-005] Run and stabilize the US1 authorization/session suites in `apps/api/test/admin-authorization.e2e-spec.ts`, `apps/api/test/resource-ownership.e2e-spec.ts`, and `apps/api/test/auth-session.e2e-spec.ts`; depends on T013–T019; verify the independent test passes end to end.

**Checkpoint**: US1 is independently secure and P0 security gates are satisfied.

---

## Phase 3: P1 — User Story 2: Trustworthy Transactions and Dashboard (Priority: P1)

**Goal**: Apply one persisted-data eligibility, period, timezone, transfer, duplicate, and currency policy across transaction and reporting flows.

**Independent Test**: A known data set produces identical hand-calculated transaction, dashboard, budget-input, and goal-input totals across edits and exclusions.

- [ ] T021 [P] [US2] [TX-001, TX-002, TX-003, TX-005, DASH-001–DASH-003, BUDGET-002, TEST-002] Add failing golden tests for status eligibility, transfers, duplicates, timezone/month-start boundaries, and mixed currencies in `apps/api/src/common/finance/financial-period-policy.spec.ts`; depends on T020; verify all documented edge cases have explicit expected totals.
- [ ] T022 [US2] [TX-003, DASH-002, DASH-003, DATA-004] Implement shared Prisma predicates and UTC/user-period range helpers in `apps/api/src/common/finance/financial-period-policy.ts`; depends on T021; verify deterministic ranges across DST and non-first-day month starts.
- [ ] T023 [US2] [TX-001–TX-003, DASH-001–DASH-003] Refactor existing transaction, analytics, and dashboard repository queries to consume the shared policy in `apps/api/src/modules/transactions/*`, `apps/api/src/modules/analytics/*`, and `apps/api/src/modules/dashboard/*`; depends on T022; verify ignored/deleted/duplicate rows and transfers are treated consistently without rebuilding modules.
- [ ] T024 [US2] [TX-002, ERR-001] Tighten transaction field and related-owner validation in `apps/api/src/modules/transactions/dto/*` and `apps/api/src/modules/transactions/transactions.service.ts`; depends on T015 and T023; verify invalid amount, currency, direction, date, account, category, and duplicate reference produce actionable field/safe errors.
- [ ] T025 [P] [US2] [TX-001, TX-005, ERR-005] Complete missing transaction list/filter/edit/category/ignore/duplicate/delete feedback and dashboard empty/loading/error states in `apps/web/src/features/transactions/components/TransactionsPage.tsx` and `apps/web/src/features/dashboard/components/DashboardPage.tsx`; depends on T018 and the stable T023 contract; verify persisted responses replace any runtime mock fallback.
- [ ] T026 [US2] [DASH-001–DASH-004, TEST-004] Add transaction-to-dashboard integration and typical-data latency checks in `apps/api/test/transactions-dashboard.e2e-spec.ts`; depends on T023–T025; verify hand totals and at least 95% of fixture requests under one second.

**Checkpoint**: US2 is independently testable and supplies the shared calculation foundation for budgets and goals.

---

## Phase 4: P1 — User Story 3: Safe Gmail Import (Priority: P1)

**Goal**: Finish the existing Gmail OAuth/ingestion/parser path with bounded incremental state, exclusion, retries, deduplication, privacy, and observable continuation.

**Independent Test**: A synthetic mailbox with valid, non-matching, malformed, repeated, and cross-message duplicate events can be connected, synchronized concurrently/repeatedly, continued, disconnected, and reconnected safely.

- [ ] T027 [P] [US3] [EMAIL-001–EMAIL-003, TEST-004] Add failing Gmail OAuth state/scope/token-redaction/revocation/reconnect tests in `apps/api/src/modules/email-connections/gmail-oauth.service.spec.ts`; depends on T002 and T020; verify read-only scope, expiring signed state, generic provider errors, and no password/token persistence.
- [ ] T028 [US3] [EMAIL-005–EMAIL-007, OPS-003] Add DB-M1 nullable cursor/backfill/lease and sync-run continuation fields/indexes in `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/*_email_sync_progress/migration.sql`; depends on T008; verify empty/upgrade/repeat migration and legacy null compatibility.
- [ ] T029 [P] [US3] [EMAIL-006, EMAIL-007–EMAIL-012, EMAIL-011, TEST-002] Add failing parser-validity and layered deduplication fixture tests in `apps/api/src/modules/email-ingestion/email-ingestion.service.spec.ts` and `apps/api/src/modules/parser/parser-engine.service.spec.ts`; depends on T020; verify malformed output never posts and provider ID → transaction ID → fallback fingerprint precedence.
- [ ] T030 [US3] [EMAIL-007, EMAIL-008, OPS-003] Add DB-M2 nullable transaction fingerprint/strategy evidence and owner-scoped collision-safe index in `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/*_transaction_deduplication/migration.sql`; depends on T008 and T029; verify collision audit before enforcing uniqueness.
- [ ] T031 [US3] [EMAIL-001–EMAIL-003, DATA-002] Complete connection status, last success/failure, recovery action, best-effort provider revocation, credential invalidation, and reconnect behavior in `apps/api/src/modules/email-connections/*`; depends on T027; verify derived transactions and sanitized history survive disconnect.
- [ ] T032 [US3] [EMAIL-004–EMAIL-007, EMAIL-013] Implement atomic connection lease acquisition/expiry, opaque cursor persistence, bounded backfill, and continuation methods in `apps/api/src/modules/email-ingestion/email-ingestion.repository.ts` and `apps/api/src/modules/email-connections/email-connections.repository.ts`; depends on T028 and T031; verify one active lease per connection and safe stale-lease recovery.
- [ ] T033 [P] [US3] [EMAIL-009, ERR-003] Implement bounded retry/backoff with jitter and distinguish 429/5xx, revoked credentials, and permanent message failures in `apps/api/src/modules/email-ingestion/gmail-api.service.ts`; depends on T027; verify mocked attempt limits and sanitized failure classification.
- [ ] T034 [US3] [EMAIL-004–EMAIL-007, EMAIL-009, EMAIL-013] Refactor the existing manual sync loop to use lease, batch bound, continuation, per-message isolation, terminal run state, and cursor commit in `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`; depends on T032 and T033; verify active-sync 409 and no scheduler/queue dependency.
- [ ] T035 [US3] [EMAIL-007, EMAIL-008, EMAIL-010–EMAIL-012, DATA-001] Implement normalized transaction identity/fingerprint upsert and strict parser-output gate in `apps/api/src/modules/email-ingestion/*`, `apps/api/src/modules/parser/*`, and transaction repository methods; depends on T030 and T034; verify T029 passes and raw body exists only in transient memory.
- [ ] T036 [US3] [EMAIL-003, EMAIL-005, ERR-003, ERR-005] Expose sync counts/status/continuation/reconnect states through existing controllers/DTOs and render them in `apps/web/src/features/email-connections/components/EmailPage.tsx` and `apps/web/src/features/ops/components/OpsPage.tsx`; depends on T018, T031, T034, and T035; verify loading, partial, retry, conflict, reconnect, and continue actions.
- [ ] T037 [US3] [EMAIL-001–EMAIL-013, TEST-004, TEST-005] Add fixture-backed OAuth-to-transaction, concurrent retry, partial-failure, disconnect/reconnect, and continuation integration tests in `apps/api/test/email-ingestion.e2e-spec.ts`; depends on T031–T036; verify the US3 independent test and no duplicate active transaction.

**Checkpoint**: US3 provides an operational manual Gmail pipeline without queue or scheduler infrastructure.

---

## Phase 5: P1 — User Story 4: Deterministic Classification (Priority: P1)

**Goal**: Reuse `MerchantRule` to classify predictably and preserve an append-only explanation for automatic and manual category changes.

**Independent Test**: Overlapping system/user rules, equal priorities, no match, manual correction, ingestion replay, and explicit reclassification produce one reproducible result and event history.

- [ ] T038 [US4] [CLASS-001, CLASS-005, OPS-003] Add DB-M3 nullable system-rule ownership, classification winner/manual metadata, and `TransactionCategoryEvent` in `apps/api/prisma/schema.prisma` plus a new `apps/api/prisma/migrations/*_classification_events/migration.sql`; depends on T008; verify existing MANUAL rows remain protected and no fake history is backfilled.
- [ ] T039 [P] [US4] [CLASS-001–CLASS-007, CLASS-003, TX-004, TEST-002] Add failing precedence, numeric priority, createdAt/ID tie-break, fallback, manual-lock, conflict, and explicit-reclassification tests in `apps/api/src/modules/transactions/classification.service.spec.ts`; depends on T020; verify exactly one explained outcome for every matrix row.
- [ ] T040 [US4] [CLASS-001–CLASS-004] Add owner/system rule query and validation methods around existing `MerchantRule` in `apps/api/src/modules/transactions/classification.repository.ts`; depends on T038 and T039; verify system rules target system categories and user rules cannot target another user's category.
- [ ] T041 [US4] [CLASS-002–CLASS-007] Implement deterministic matching and winner explanation in `apps/api/src/modules/transactions/classification.service.ts`; depends on T040; verify no ML/LLM path and all T039 priority/conflict/fallback tests pass.
- [ ] T042 [US4] [CLASS-005, CLASS-006, TX-004, SEC-006] Make manual category correction and explicit reclassification update current state and append events atomically in `apps/api/src/modules/transactions/transactions.service.ts` and repository; depends on T041; verify automatic calls return unchanged for manual classification.
- [ ] T043 [US4] [CLASS-002, CLASS-006, EMAIL-010] Invoke classification from existing manual transaction creation and successful email parsing without overwriting manual decisions in `apps/api/src/modules/transactions/*` and `apps/api/src/modules/email-ingestion/email-ingestion.service.ts`; depends on T035 and T042; verify retries are idempotent.
- [ ] T044 [US4] [CLASS-005, CLASS-006, ERR-005] Add reclassify/category-history endpoints and correction/conflict UI in `apps/api/src/modules/transactions/transactions.controller.ts`, DTOs, and `apps/web/src/features/transactions/components/TransactionsPage.tsx`; depends on T042 and T043; verify explicit warning before reclassification and visible decision reason.
- [ ] T045 [US4] [CLASS-001–CLASS-007, TEST-004, TEST-005] Add rule/correction/history/ingestion-replay integration tests in `apps/api/test/classification.e2e-spec.ts`; depends on T040–T044; verify the US4 independent test and append-only history.

**Checkpoint**: US4 is deterministic, explainable, and independently releasable.

---

## Phase 6: P1 — User Story 5: Budget Alerts and Notifications (Priority: P1)

**Goal**: Turn existing budget aggregation and alert CRUD into a non-spamming lifecycle for all approved P1 alert types and opt-in critical email fallback.

**Independent Test**: Transactions cross, remain above, fall below, and re-cross thresholds while alert status/delivery follows the exact cooldown and preference rules.

- [ ] T046 [US5] [ALERT-001–ALERT-004, OPS-003] Add DB-M4 condition key, threshold/period, status, trigger/resolve/dismiss timestamps, and lifecycle indexes to `Alert` in `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/*_alert_lifecycle/migration.sql`; depends on T008; verify legacy alerts remain readable and resolved history can coexist with a new occurrence.
- [ ] T047 [P] [US5] [BUDGET-001–BUDGET-003, BUDGET-002, ALERT-001–ALERT-003, ALERT-002, TEST-002] Add failing boundary, continuous-above, higher-threshold, resolve, 24-hour recross, category/time move, and currency tests in `apps/api/src/modules/budgets/budget-alert-evaluator.spec.ts`; depends on T023; verify clock-controlled deterministic outcomes.
- [ ] T048 [US5] [BUDGET-001–BUDGET-003, ALERT-001–ALERT-003] Implement the synchronous budget evaluator using existing budget spending queries and atomic condition lifecycle methods in `apps/api/src/modules/budgets/budget-alert-evaluator.ts` and `apps/api/src/modules/alerts/alerts.repository.ts`; depends on T046 and T047; verify all T047 tests pass.
- [ ] T049 [US5] [BUDGET-003, TX-005] Invoke evaluation for both old and new affected periods after create/update/delete/ignore/duplicate/category mutations and expose explicit budget recalculation in `apps/api/src/modules/transactions/transactions.service.ts` and `apps/api/src/modules/budgets/*`; depends on T042 and T048; verify edits moving category/month resolve and create the correct conditions.
- [ ] T050 [US5] [ALERT-004] Add owner-scoped unread count, dismiss, resolve, and lifecycle response fields to existing alert controller/service/repository/DTOs in `apps/api/src/modules/alerts/*`; depends on T046 and T048; verify read does not resolve and dismiss does not erase history.
- [ ] T051 [US5] [ALERT-005–ALERT-007, OPS-003] Add DB-M5 `AlertDelivery` channel/status/attempt/sent/failure fields in `apps/api/prisma/schema.prisma` and a new `apps/api/prisma/migrations/*_alert_delivery/migration.sql`; depends on T008; verify existing alerts require no backfill and attempt count is constrained to 0–3.
- [ ] T052 [P] [US5] [ALERT-005–ALERT-008, TEST-002] Add failing trigger/preference/skipped/redaction/three-attempt delivery tests in `apps/api/src/modules/alerts/alert-evaluation.service.spec.ts` and `alert-delivery.service.spec.ts`; depends on T046 and T051; verify in-app success is independent of email failure.
- [ ] T053 [US5] [ALERT-005–ALERT-008] Implement budget, large-transaction, goal-risk, cashflow-risk, and repeated-system-failure evaluators plus in-app default policy in `apps/api/src/modules/alerts/alert-evaluation.service.ts`; depends on T048 and T052; verify one condition key per target/type/severity/period.
- [ ] T054 [US5] [ALERT-005–ALERT-007, ERR-004] Implement a narrow configured email adapter and persisted bounded delivery attempts in `apps/api/src/modules/alerts/alert-delivery.service.ts`; depends on T002, T051, and T052; verify only opted-in CRITICAL alerts send and sensitive details are minimized.
- [ ] T055 [US5] [ALERT-004–ALERT-006, ERR-005] Complete unread/read-all/dismiss/status/delivery and alert-setting states in `apps/web/src/features/alerts/components/AlertsPage.tsx` and `apps/web/src/features/settings/components/SettingsPage.tsx`; depends on T018, T050, T053, and T054; verify loading/empty/skipped/failed/retry displays.
- [ ] T056 [US5] [BUDGET-001–BUDGET-003, ALERT-001–ALERT-008, TEST-004, TEST-005] Add threshold mutation, cooldown, all-P1-trigger, and delivery lifecycle integration tests in `apps/api/test/alerts.e2e-spec.ts`; depends on T049–T055; verify the US5 independent test and no spam under repeated evaluation.

**Checkpoint**: US5 provides complete approved P1 alerts without generalized event infrastructure.

---

## Phase 7: P1 — User Story 6: Goals from Actual Data (Priority: P1)

**Goal**: Remove fixed/prototype financial assumptions and return transparent goal feasibility from the user's eligible completed-month history.

**Independent Test**: Positive, negative, zero-required, past-deadline, and 0/1/2/3-month histories reproduce hand-calculated inputs, score, level, or insufficient-data state.

- [ ] T057 [P] [US6] [GOAL-002–GOAL-007, TEST-002] Add failing goal formula, rounding, observation-month, score-band, negative/past-deadline, and insufficient-data tests in `apps/api/src/modules/goals/goals.service.spec.ts`; depends on T023; verify no fixed income, expense, interest, or free-cashflow value appears.
- [ ] T058 [US6] [GOAL-003, GOAL-005, GOAL-006] Add owner-scoped completed-month cashflow aggregation using the shared policy in `apps/api/src/modules/goals/goals.repository.ts`; depends on T022 and T057; verify current partial month and ineligible/mixed-currency records are excluded or separated.
- [ ] T059 [US6] [GOAL-001–GOAL-007] Replace `assumedFreeCashflow` and installment prototype math with required saving, actual average cashflow, exact levels, evidence, and insufficient-data behavior in `apps/api/src/modules/goals/goals.service.ts` and `apps/api/src/modules/goals/goals.mapper.ts`; depends on T058; verify T057 passes and contribution/goal ownership remains intact.
- [ ] T060 [US6] [GOAL-004, GOAL-005, ERR-001] Align goal simulation DTO/Swagger contract with `SAFE|ACCEPTABLE|RISKY|NOT_RECOMMENDED|INSUFFICIENT_DATA` in `apps/api/src/modules/goals/dto/*`, `apps/api/src/modules/goals/goals.controller.ts`, and `apps/api/docs/swagger.json`; depends on T059; verify generated Swagger against `specs/001-operational-mvp/contracts/openapi.yaml`.
- [ ] T061 [US6] [GOAL-004, GOAL-005, ERR-005] Render observation inputs, exact result levels, and insufficient-history guidance in `apps/web/src/features/goals/components/GoalsPage.tsx` and `apps/web/src/types/goal.ts`; depends on T018 and T060; verify loading/empty/error and no fabricated projection.
- [ ] T062 [US6] [GOAL-001–GOAL-007, TEST-004, TEST-005] Add real-data goal CRUD/contribution/recalculation E2E tests in `apps/api/test/goals.e2e-spec.ts`; depends on T058–T061; verify the US6 independent test.

**Checkpoint**: US6 goal output is reproducible from persisted user data.

---

## Phase 8: P2 — Cross-Cutting Quality and Operability

**Purpose**: Standardize errors/logging, complete frontend and E2E evidence, and prove runtime behavior across all stories.

- [ ] T063 [P] [ERR-001, ERR-002, ERR-004, ERR-006] Add failing API error-envelope and correlation-ID contract tests in `apps/api/test/error-contract.e2e-spec.ts`; depends on T020; verify stable code/message/fields/correlationId with no stack or secret leakage.
- [ ] T064 [ERR-001–ERR-006] Implement a global safe exception filter and request correlation context in `apps/api/src/common/filters/api-exception.filter.ts`, `apps/api/src/common/interceptors/base-response.interceptor.ts`, and `apps/api/src/main.ts`; depends on T063; verify existing success envelope remains compatible.
- [ ] T065 [P] [OPS-008, EMAIL-002, ALERT-007] Add failing log-redaction assertions for cookies, tokens, encryption keys, raw bodies, parser payloads, and notifications in `apps/api/src/common/logging/logger.spec.ts`; depends on T002; verify correlation and resource/run IDs remain searchable.
- [ ] T066 [OPS-008, ERR-006] Configure structured Pino redaction and add contextual auth/sync/parser/classification/alert/startup events in `apps/api/src/common/logging/*` and affected services; depends on T019, T053, T064, and T065; verify T065 passes without logging sensitive values.
- [ ] T067 [P] [TEST-006, ERR-005] Add the smallest Vite-compatible component test setup and scripts in `apps/web/package.json`, `apps/web/vite.config.ts`, and `apps/web/src/test/setup.ts`; depends on stable P1 frontend contracts T036, T044, T055, and T061; verify one existing page renders in CI-like headless mode.
- [ ] T068 [TEST-006, ERR-005] Add critical frontend tests for auth renewal/sign-out, loading/empty/error/retry, transaction mutation/correction, sync continuation, alert state, goal insufficiency, and duplicate-submit prevention under `apps/web/src/features/**/*.test.tsx`; depends on T067; verify all critical UI states are covered without mock-data runtime fallback.
- [ ] T069 [TEST-001, TEST-003, TEST-004, TEST-008] Consolidate synthetic fixture builders and requirement-to-test traceability in `apps/api/test/fixtures/*` and `specs/001-operational-mvp/checklists/test-traceability.md`; depends on T020, T026, T037, T045, T056, and T062; verify every AUTH/SEC/TX/DASH/EMAIL/CLASS/BUDGET/ALERT/GOAL requirement names automated evidence.
- [ ] T070 [TEST-005, TEST-007, OPS-007] Add a headless clean-user smoke flow covering registration/login, transaction/dashboard, settings, budget alert, goal result, and fixture-backed email import in `apps/web/e2e/operational-mvp.spec.ts`; depends on T068 and all P1 E2E suites; verify failure blocks release.
- [ ] T071 [OPS-001–OPS-007, TEST-007] Add a clean-checkout container verification script for config, build, migration, health, restart, persistence, dependency outage, and graceful shutdown in `scripts/verify-release.ps1`; depends on T006–T008, T064, and T070; verify it runs without undocumented host state or volume deletion.
- [ ] T072 [DASH-004, TEST-001, TEST-007] Run all API/web tests, generated-contract comparison, typecheck, lint, build, migration matrix, dashboard benchmark, and release script; record command evidence in `specs/001-operational-mvp/checklists/release-evidence.md`; depends on T064–T071; verify no critical test or configuration finding remains.

---

## Phase 9: P3 — User Story 7: Documentation and Release Readiness (Priority: P1)

**Goal**: A developer/operator can deploy and troubleshoot the validated MVP from a clean checkout using repository documentation only.

**Independent Test**: A fresh operator follows the documentation, reaches healthy services, runs migrations/tests and one smoke flow, restarts safely, and diagnoses a simulated dependency failure.

- [ ] T073 [P] [US7] [DOC-001, DOC-002] Replace the generic Turborepo landing page with CashLens purpose, supported MVP journeys, scope boundaries, monorepo map, architecture, and principal data flow in `README.md`; depends on T072; verify every command/link targets an existing file or package script.
- [ ] T074 [P] [US7] [DOC-002, OPS-001, OPS-003] Document prerequisites, environment setup, local development, Docker startup/shutdown, migrations, seed/provider fixtures, tests, build, and restart behavior in `docs/operations/local-development.md`; depends on T071; verify steps on a clean checkout.
- [ ] T075 [P] [US7] [DOC-003, EMAIL-001–EMAIL-013, DATA-001, DATA-002] Document Gmail read-only consent, callback/test-account setup, listen rules, bounded manual sync, continuation, reconnect, rate limits, retention, and common safe errors in `docs/operations/gmail-oauth.md`; depends on T037; verify no usable credential or raw message appears.
- [ ] T076 [P] [US7] [DOC-004, CFG-001–CFG-005, OPS-002–OPS-009] Document single-host HTTPS deployment, required secrets, secure cookies/CORS/callbacks, immutable images, health checks, migration order, backup/restore, key-rotation consequence, rollback, and log redaction in `docs/operations/deployment.md`; depends on T007, T066, and T071; verify against production compose configuration.
- [ ] T077 [P] [US7] [DOC-005, ERR-003, ERR-004, DATA-003, DATA-004] Document troubleshooting for database/Gmail/parser/sync/notification failures plus retention/deletion boundaries and correlation-ID diagnosis in `docs/operations/troubleshooting.md`; depends on T064, T066, and T071; verify each recovery action corresponds to an observable state.
- [ ] T078 [US7] [DOC-001–DOC-006, OPS-007, TEST-007] Execute the US7 independent documentation walkthrough and finalize release/security checklists in `specs/001-operational-mvp/checklists/requirements.md` and `specs/001-operational-mvp/checklists/release-evidence.md`; depends on T073–T077; verify all links/commands, critical checks, and explicit post-MVP exclusions.

**Checkpoint**: US7 and the Operational MVP release package are complete.

---

## Dependencies and Execution Order

### Phase dependencies

1. Phase 1 runtime foundation starts immediately.
2. Phase 2 US1 depends on typed configuration and blocks all private feature integration.
3. Phase 3 US2 depends on US1 and creates the shared financial policy.
4. US3 and US4 may begin after US1; US4 ingestion integration waits for US3 parser/dedupe.
5. US5 depends on US2 financial policy and US4 correction hooks.
6. US6 depends on US2 financial policy; it can run parallel to most US3/US4 work, then supplies goal-risk input to US5.
7. P2 depends on the relevant P1 contracts; final smoke/release checks depend on all P1 stories.
8. P3 documentation uses validated P2 commands and completes release readiness.

### Critical path

`T001 → T002 → T004 → T005 → T009/T010/T011 → T012–T020 → T021 → T022 → T023 → T038–T045 → T046–T056 → T063–T072 → T073–T078`

Gmail's release path is `T027 → T031 → T028/T032 → T033/T034 → T030/T035 → T036 → T037 → T070`. Goal's path is `T057 → T058 → T059 → T060 → T061 → T062 → T070`.

### Safe parallel opportunities

- T001, T004, and T007 use distinct config/health/container files after their stated prerequisites.
- T009, T010, and T011 are separate failing test suites.
- T027 and T029 can run in parallel; T028 and T030 are sequential migration edits to avoid schema conflicts.
- T039 can run while DB-M3 T038 is prepared; implementation converges at T040.
- T047 and T052 are independent evaluator/delivery test files after schema prerequisites.
- US6 T057–T062 can proceed alongside US3/US4 once T023 is complete.
- T063, T065, and frontend setup T067 use separate files after P1 contracts stabilize.
- T073–T077 are parallel documentation files; T078 integrates them.

Do not run tasks marked `[P]` concurrently when they transitively edit the same listed file. Prisma migration/schema tasks T028, T030, T038, T046, and T051 must remain ordered in one migration stream.

## Implementation Strategy

### Incremental checkpoints

1. Complete P0 runtime and US1 security; stop if any authorization/configuration test fails.
2. Complete US2 shared calculations before budget or goal math.
3. Deliver US3 Gmail and US4 classification as independently testable increments.
4. Deliver US5 alerts and US6 goals, then align frontend contracts.
5. Complete P2 release evidence before writing final operational claims in P3 documentation.

### Requirement coverage audit

- **P0/P1 coverage**: AUTH-001–005, SEC-001–008, CFG-001–005, TX-001–005, DASH-001–004, EMAIL-001–013, CLASS-001–007, BUDGET-001–003, ALERT-001–008, GOAL-001–007, DATA-001–004, ERR-001–006, OPS-001–009, TEST-001–008, and DOC-001–006 map to tasks above.
- **Critical-rule verification**: Session rotation, ownership, privileged-field rejection, financial eligibility, Gmail lease/retry/dedupe/parser validity, classification precedence/manual lock, budget recross cooldown, notification attempts/privacy, and goal formula/insufficient data each have dedicated automated test tasks.
- **Technical-necessity tasks**: Migrations, health, test fixtures, contract generation, and release scripts directly support OPS/TEST requirements and the approved plan; no queue, scheduler, cache, event bus, or replacement architecture task exists.
- **Remaining ambiguity**: None blocks task generation. The concrete email transport provider remains an adapter/configuration choice in T054 and must not alter domain or API contracts.

## Notes

- Tests are listed before implementation and should fail for the intended reason first.
- Preserve existing working endpoints and response fields unless the plan identifies an intentional security/concurrency/prototype correction.
- Before editing symbols, follow repository GitNexus impact-analysis requirements; before commit, run GitNexus change detection.
- Commit/review by task or cohesive migration-plus-consumer group; never rewrite existing Prisma migrations.
