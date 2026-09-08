# Implementation Plan: Operational CashLens MVP

**Branch**: `feat/thuan/backend-mvp-modules-and-docker-compose` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

## Summary

Complete the current NestJS/React/Prisma modular monolith in place. Retain existing modules, API envelope, PostgreSQL schema lineage, Gmail read-only OAuth flow, Refine providers, and three-service deployment shape. Sequence work as P0 security/runtime hardening, P1 completion of financial flows, and P2 validation/operability. Do not add a queue, scheduler, microservice, ML/LLM classifier, or new state framework.

## Technical Context

**Language/Version**: TypeScript 5.7+ API, TypeScript 5.8+ web, Node.js 22 release image  
**Primary Dependencies**: NestJS 11, Prisma 7, PostgreSQL, Passport/JWT, bcrypt, class-validator, nestjs-pino; React 19, Vite 6, Refine 5, Ant Design, Zustand  
**Storage**: PostgreSQL 16; encrypted Gmail credentials; no raw email body retention  
**Testing**: Jest 30, ts-jest, Supertest; add one Vite-compatible frontend runner only if TEST-006 requires it  
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
| P0.1 Split self-service from admin user operations; add role guard; remove privileged fields from public/self DTOs; controlled admin provisioning | `users/*`, `auth/*`, `common/guards` | SEC-002–005, SEC-007–008, AUTH-004 | None | Guard units; two-user/admin Supertest matrix; mass-assignment tests | Security tightening: ordinary callers get 403 on admin routes; no DB change |
| P0.2 Enforce owner-scoped reads/writes everywhere and reject disabled/deleted users in JWT validation | all owned module repositories/services, `jwt.strategy.ts` | SEC-001, SEC-005–008, DATA-004, TEST-003 | P0.1 | Cross-user tests for every resource, malformed IDs, disabled/deleted sessions | Consistent 401/403/owner-safe 404; no expected migration |
| P0.3 Harden cookie/session policy and add one client refresh attempt without replaying unsafe mutations | auth controller/service, `web/src/api/client.ts`, auth provider | AUTH-001–005, ERR-002, TEST-002/004/006 | P0.4 | Cookie flags, expiry/rotation/reuse E2E, non-idempotent no-replay | Environment-dependent cookies; envelope preserved; no DB change |
| P0.4 Add typed startup validation, placeholder rejection, key-rotation guidance, and redaction | `app.module.ts`, `main.ts`, security/logger, `.env.example` | CFG-001–005, EMAIL-002, OPS-008 | None | Missing/empty/malformed/placeholder config matrix | Startup fails early; no API/DB change |
| P0.5 Add liveness/readiness and graceful shutdown; readiness checks DB | `main.ts`, Prisma, small health module, Docker healthchecks | OPS-002–005, ERR-004 | P0.4 | Health Supertest, DB outage, SIGTERM smoke | Add `/health/live` and `/health/ready`; no migration |
| P0.6 Add immutable release images/compose with no source mounts/install/watch startup; keep current compose for development | Dockerfiles, compose/env docs | OPS-001–006, OPS-009, CFG-002–004 | P0.4–P0.5 | compose config, clean build/up, health, restart/persistence | Packaging only; migration deploy remains explicit/pre-start |

## P1 — Core Incomplete MVP Behavior

| Change | Existing area | Requirement IDs | Dependencies | Expected validation | API / DB behavior |
|---|---|---|---|---|---|
| P1.1 Complete Gmail status/recovery/reconnect/disconnect and best-effort provider revocation | `email-connections/*`, OAuth service, Email page | EMAIL-001–003, DATA-002, ERR-003 | P0.2, P0.4 | OAuth-state units; lifecycle fixtures; secret-redaction checks | Add recovery/status fields; reuse current status columns |
| P1.2 Add bounded incremental sync, persisted continuation, one DB-backed lease per connection, and bounded retry/backoff | `email-ingestion/*`, Gmail API, connection repository, Email/Ops pages | EMAIL-004–007, EMAIL-009, EMAIL-013, ERR-003/006 | P1.1, DB-M1 | Concurrent sync, continuation, partial-failure, retry tests | Sync returns continuation; active run yields 409; DB-M1 |
| P1.3 Add layered event dedupe and strict parser validity; retain only sanitized evidence | ingestion, parser, transaction repository/schema | EMAIL-007–012, FR-08–11, DATA-001 | P1.2, DB-M2 | Malformed/repeated/cross-message fixture tests; deterministic parser choice | Reject invalid posting; DB-M2 fingerprint/constraint |
| P1.4 Execute deterministic user/system classification, fallback, manual protection, explicit reclassify, and append-only decision history | transactions, categories, `MerchantRule`, Transactions page | CLASS-001–007, TX-004, SEC-006 | P0.2, DB-M3 | Full priority/tie matrix; correction/reprocessing integration | Add rules/reclassify/history contract; DB-M3 |
| P1.5 Centralize eligible-transaction, timezone/month-start, transfer, and currency policy across all totals | transactions, analytics, dashboard, budgets, goals queries | TX-001–005, DASH-001–004, DATA-004 | P0.2 | Golden aggregate fixtures and one-second benchmark | May add currency/period metadata; retain primary fields; no expected migration |
| P1.6 Evaluate budgets after relevant mutations and explicit recalculation; persist warning/critical lifecycle and 24h recross semantics | budgets, alerts, transaction mutation orchestration | BUDGET-001–003, ALERT-001–003 | P1.5, DB-M4 | Threshold/cooldown units; mutation integration | Add recalc/lifecycle fields; DB-M4 |
| P1.7 Complete all P1 alert triggers, read/dismiss/resolve, defaults, and opt-in critical email with max three attempts | alerts plus budget/goal/transaction/sync trigger points; Alerts/Settings/Ops pages | ALERT-004–008, SEC-006, ERR-006 | P1.5–P1.6, DB-M4/M5 | Trigger units; skipped/retry/final-failure/privacy integration | Add lifecycle/delivery fields; DB-M5; narrow mail adapter only |
| P1.8 Replace fixed goal capacity with 2–3 completed-month aggregates, exact score bands, evidence, and insufficient-data state | goals service/repository/mapper, shared period query, Goals page | GOAL-001–007 | P1.5 | Rounding; 0/1/2/3-month; negative/past-deadline tests | Intentional simulation status/evidence correction; no expected migration |
| P1.9 Complete web contracts and states: refresh, typed mapping, correction, sync continuation, alerts, goal insufficiency, loading/empty/error/retry; remove mock fallback | web API/providers/stores/all feature pages | AUTH-002, EMAIL-003/005, CLASS-005/006, ALERT-004/006, GOAL-004/005, ERR-001–005 | Corresponding backend items | Component and browser smoke tests | Consumes changed/additive API; no DB change |

## P2 — Quality and Operability

| Change | Existing area | Requirement IDs | Dependencies | Expected validation | API / DB behavior |
|---|---|---|---|---|---|
| P2.1 Standard safe errors, field details, correlation IDs, Pino context/redaction | common, main, logger, adapters | ERR-001–006, OPS-008 | P0/P1 | Contract snapshots and captured-log redaction | Add stable error code/correlation ID; retain message |
| P2.2 Requirement-mapped backend units/integration using synthetic fixtures and isolated PostgreSQL | colocated specs, `apps/api/test` | TEST-001–005, TEST-008 | P0/P1 backend | CI/coverage; empty and upgraded DB | Test-only |
| P2.3 Minimal frontend component/E2E suite and duplicate-submit protection | web test config/specs | TEST-005–006 | P1.9 | Headless critical journeys | Test-only |
| P2.4 Validate migration/container paths: empty, upgrade, repeat, outage, restart, persistent volume | Prisma, Docker, CI scripts | OPS-001–007, TEST-007 | DB-M1–M5, P0.6 | Automated release matrix | Migration behavior release-gated |
| P2.5 Replace starter docs with architecture, setup, Gmail, migration, test, deployment, backup/restore, privacy, troubleshooting, scope | READMEs, docs | DATA-003, DOC-001–005, OPS-007 | P2.2–P2.4 | Fresh-checkout walkthrough | Documentation only |

## Database Migrations and Compatibility

| ID | Minimal change | Rollout/backfill | Risk |
|---|---|---|---|
| DB-M1 | Nullable connection cursor/backfill fields and sync-run continuation/lease fields/indexes | Existing connections start without cursor and run bounded reconciliation; leases expire safely | New API must tolerate null legacy progress |
| DB-M2 | Nullable transaction `deduplicationFingerprint` plus strategy evidence and owner-scoped uniqueness | Backfill only safely reconstructable rows; inspect collisions before constraint | Historical duplicates can block uniqueness; use expand/backfill/validate |
| DB-M3 | Nullable `MerchantRule.userId` for system rules plus invariant; append-only `TransactionCategoryEvent` and winning-rule/manual metadata | Protect existing `MANUAL` records without fabricating events | Null uniqueness semantics need explicit system-rule constraints |
| DB-M4 | Alert condition key, threshold/period/status/resolved/dismissed timestamps and dedupe indexes | Legacy alerts remain readable with nullable lifecycle | Resolved history requires occurrence/partial-index design, not global unique key |
| DB-M5 | Add compact `AlertDelivery` rows for channel/status/attempt/sent/error | No backfill needed | Additive; email failure must not roll back in-app alert |

Never edit old migrations. Test new ordered migrations from empty DB and the current latest migration. Add non-null/destructive constraints only after validation. Keep IDs and existing primary response fields. Require backup and rollback-to-previous-image guidance because normal Prisma migration deployment is forward-only.

## API Compatibility

- Preserve `/api`, cookie auth, and `{success,data,...}` envelope.
- Prefer additive fields/actions. Existing list/transaction/dashboard fields remain during MVP migration.
- 403/owner-safe 404, disabled-account 401, and active-sync 409 are intentional security/concurrency changes.
- Goal prototype statuses change to `SAFE|ACCEPTABLE|RISKY|NOT_RECOMMENDED|INSUFFICIENT_DATA`; deploy web/API atomically.
- Generate `apps/api/docs/swagger.json` and compare it with [contracts/openapi.yaml](./contracts/openapi.yaml).

## Dependency Order

```text
P0.4 -> P0.3, P0.5 -> P0.6
P0.1 -> P0.2 -> P1.1 -> P1.2 -> P1.3
P0.2 -> P1.4
P0.2 -> P1.5 -> P1.6 -> P1.7
                └-----> P1.8
P1 backend contracts -> P1.9 -> P2 tests/runtime/docs
```

## Complexity Tracking

No known gate violation. The only new persistent entities are category-decision evidence and alert-delivery attempts, both required by explicit audit/delivery semantics. Queue, scheduler, cache, policy engine, and event bus are deliberately excluded.
