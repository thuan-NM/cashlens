# Phase 0 Research: Operational CashLens MVP

## Brownfield modular monolith

**Decision**: Extend existing NestJS modules and React feature pages.  
**Rationale**: GitNexus shows cohesive modules and existing execution paths; gaps are policies/orchestration.  
**Alternatives considered**: New backend, microservices, event platform—rejected as duplication and operational overhead.

## Authorization

**Decision**: Add a small role guard for admin-only account/system configuration; keep mandatory repository owner scoping, with no admin bypass. As built (US1): the guard reads the persisted role and status on every request and runs after authentication and before body validation; administrator account views expose identity and status only; self-service profile edits use `PATCH /users/me`.  
**Rationale**: Current Users CRUD is JWT-only and accepts role/status, while only USER/ADMIN behavior is needed.  
**Alternatives considered**: ACL/policy framework and super-admin data access—unnecessary and contrary to SEC-008.

## Configuration and sessions

**Decision**: Validate configuration through existing ConfigModule at startup; retain rotating cookie sessions and permit one client refresh retry only for safe/idempotent requests.  
**Rationale**: Closes placeholder-secret and expiry gaps without replacing auth.  
**Alternatives considered**: Lazy service validation, localStorage tokens, external auth—later failure or needless risk.

## Gmail synchronization

**Decision**: Keep synchronous user-triggered sync; persist cursor/backfill boundary and a database lease, cap each batch, return continuation, and retry only transient failures with bounded exponential backoff/jitter.  
**Rationale**: Meets incremental/concurrent-safe requirements without a scheduler/worker.  
**Alternatives considered**: Cron, Redis queue, Gmail push, unbounded request—outside clarified MVP.

## Parsing and deduplication

**Decision**: Provider-message uniqueness first, then normalized transaction identity, then owner-scoped deterministic fingerprint; store strategy/key as sanitized evidence.  
**Rationale**: Covers retries and the same event reported by different messages, with DB uniqueness as concurrency defense.  
**Alternatives considered**: Message ID only or fuzzy/ML dedupe—insufficient or unexplainable.

## Classification

**Decision**: Extend `MerchantRule` for nullable system ownership and append `TransactionCategoryEvent`; evaluate manual protection, user priority, system priority, then fallback.  
**Rationale**: Reuses existing patterns/priority/category/provenance and adds only missing audit evidence.  
**Alternatives considered**: Second rules subsystem or JSON history—duplicate or poorly queryable.

## Financial calculations

**Decision**: Share one eligibility/period/currency query policy across dashboard, budgets, alerts, and goals. Goals average up to three completed months and require two.  
**Rationale**: Prevents contradictory totals and removes hard-coded capacity.  
**Alternatives considered**: Materialized reporting store, current-month extrapolation, inferred interest, AI advice—unnecessary or prohibited.

## Alerts and delivery

**Decision**: Run synchronous evaluators after relevant successful writes and explicit recalculation; persist condition lifecycle and delivery attempts; commit in-app before bounded email delivery.  
**Rationale**: Adequate for one host and manual activity; condition keys prevent spam.  
**Alternatives considered**: Event bus/outbox worker/scheduled scanner—excess MVP infrastructure.

## Testing and deployment

**Decision**: Retain Jest/Supertest; add at most one Vite-compatible component runner and one headless E2E tool. Keep dev compose and add immutable release images/compose with explicit migration/readiness.  
**Rationale**: Uses current tooling and separates developer convenience from production behavior.  
**Alternatives considered**: Test-stack migration or Kubernetes/cloud-specific deployment—out of scope.

## Administrator bootstrap (SEC-003, SEC-009)

**Decision**: Add one operator-run Nest standalone script, `apps/api/src/scripts/bootstrap-admin.ts`, compiled into `dist/`. It promotes an existing ACTIVE self-registered user by `--email` inside one advisory-locked transaction, only while zero active admins exist, and writes a `SYSTEM` audit row. Rerunning it for the same user is a no-op with exit 0 and no audit row.

Exit codes:

| Code | Outcome |
|---|---|
| 0 | Promoted, or already admin |
| 2 | Target missing, disabled, pending deletion, deleted, or not self-registered (no password of its own) |
| 3 | Another active admin exists |
| 1 | Configuration or database error |

How the operator runs it:

- Development: `yarn workspace api admin:bootstrap --email <email>`. The package script runs the TypeScript source through `ts-node -r tsconfig-paths/register`, both already devDependencies. It deliberately does not run `nest build`, because `deleteOutDir: true` would clear `dist/` under the running `start:dev` watcher.
- Production: `docker compose -f docker-compose.prod.yml run --rm api node dist/src/scripts/bootstrap-admin.js --email <email>`.

**Upgrade review**: earlier releases allowed self-promotion, so the same script provides `--list-admins` (read-only) and `--revoke --email <email>` (audited `ADMIN_ROLE_REVOKED`). On an upgraded deployment, the operator removes unapproved administrators before the first bootstrap. Keeping the operator review, rather than an automatic demote-all at upgrade, is a pending product-owner decision.

**Reuse check**: The repository has no seed or bootstrap script.

- `20260620093000_seed_bank_providers` seeds data through SQL. Reusing it would mean a hard-coded admin, which is rejected.
- `src/scripts/generate-openapi.ts` is the only standalone-script precedent: a Nest context compiled to `dist/` and run via a package script. Its build and packaging pattern is reused.
- Its `process.env.JWT_SECRET ??= …` fallback and `PrismaService` `{}` override are **not** reused. The bootstrap uses `NestFactory.createApplicationContext` with a minimal module (validated `ConfigModule` + `PrismaModule`), so it fails closed on invalid configuration.

**Rationale**:

- Operator access to the host and database is already the trust boundary for migrations.
- Promoting an existing user means the CLI never handles passwords.
- The zero-active-admins guard makes the step one-shot and also usable as break-glass recovery when every admin is disabled.

**Alternatives considered**:

- An environment-seeded admin email and password: rejected as a credential in configuration.
- A first-registered-user-becomes-admin rule: rejected as a race and network-reachable.
- A SQL snippet in the docs: rejected because it has no audit, idempotency, or tests.
- A `--force` flag: rejected as unnecessary.

**Gap it depended on (closed in US1, T018–T020)**: `CreateUserDto`/`UpdateUserDto` accepted `role`/`status`, and `/users` was guarded only by JWT, so any user could self-promote. P0.1 closed this before the bootstrap was built; `/users` is now administrator-only and self-service profile changes use `PATCH /users/me`.

## Budget thresholds (BUDGET-001)

**Decision**: `Budget.thresholdPercent` is the configurable warning threshold, and critical is the constant 100.

- New writes accept 1–99.
- Legacy values of 100–200 mean no separate warning and are not rewritten.
- The read-time projection and the evaluator share one pure function.

**Rationale**:

- PRD PF-09 says "80%, 100% or a custom threshold". PRD `budgets.alert_threshold_percent` is a single column (example 80), and the `budget_threshold` severities are warning/critical at 80/100.
- One configurable threshold plus a fixed 100 satisfies all three statements without a new table.

**Alternatives considered**:

- A `BudgetThreshold` child table or a configurable critical threshold: not required by the PRD.
- Clamping legacy values to 99: rejected because it silently changes user data.

## Alert trigger semantics (ALERT-008, ALERT-009)

**Decision**: The spec's Alert Trigger Matrix is authoritative. Every evaluator is a small pure function that takes persisted inputs and returns a list of conditions, each with key, holds, severity, threshold, observed value, and window. The shared lifecycle service applies ALERT-003:

- cooldown is level-triggered: condition holds, no open occurrence, and 24h since the last `triggeredAt`;
- evaluators run only at the listed triggers, because there is no scheduler.

**PRD grounding**:

| Alert type | PRD basis |
|---|---|
| `budget_threshold` | 80%/100% → warning/critical |
| `large_transaction` | User-configured amount, example 5,000,000 VND |
| `goal_risk` | Required saving > available cashflow, warning |
| `cashflow_risk` | Projected future-month net < 0, critical |
| `system_error` | Sync/parser/delivery fails repeatedly |
| `category_spike` | P2 |

**Defaults pending confirmation**:

- **Cashflow-risk projection**: the historical mean without subtracting goal commitments. Subtracting them, which is the reading of PRD TC-07, would duplicate goal risk as a `CRITICAL` email.
- **Large transaction**:
  - it has a `WARNING` tier only, because the PRD gives no critical rule;
  - its default of 5,000,000 applies only to VND.
- **Repeated failure**: three consecutive failed runs trigger `WARNING`. Reconnect-required triggers `CRITICAL`, because it is a persisted state that requires user action.

**Alternatives considered**:

- Edge-triggered cooldown with stored suppressed crossings: needs extra state.
- A generic user-editable `alert_rules` table (PRD schema): per-user configurable rules are post-MVP, and the matrix is fixed in code.

## Alert state model (ALERT-010)

**Decision**: The lifecycle `AlertStatus` is `ACTIVE`, `DISMISSED`, or `RESOLVED`, with `RESOLVED` terminal and set only by the system. The existing `isRead`/`readAt` stay independent.

- A dismissed occurrence remains open for dedupe until resolved.
- A partial unique index enforces one open occurrence per key.

**Rationale**:

- The PRD `new/read/dismissed/resolved` enum mixes presentation with domain state; the remediation directive separates them.
- If dismissing released the key, the next evaluation would immediately re-alert.

## Email delivery adapter (ALERT-005 to ALERT-007, CFG-007)

**Decision**: The adapter is a port, `EmailTransport.send({ to, subject, text, html? }): Promise<{ messageId }>`, selected by `EMAIL_TRANSPORT`.

| Value | Behavior | Allowed in production |
|---|---|---|
| `disabled` | Default. Deliveries are recorded `SKIPPED/TRANSPORT_DISABLED`. | Yes |
| `smtp` | `nodemailer` SMTP transport. | Yes |
| `log` | Writes only the redacted recipient domain, subject, and alert ID to the logger. | No (startup rejects it) |

Tests override the provider through Nest DI with an in-memory fake that records messages and can be scripted to fail or time out. No test uses the network.

**Configuration keys** (validated by the typed config when `EMAIL_TRANSPORT=smtp`; placeholders are rejected in production):

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE` (`true` means implicit TLS; otherwise STARTTLS is required)
- `SMTP_USER`
- `SMTP_PASSWORD`
- `EMAIL_FROM`
- `APP_PUBLIC_URL` (the link target)

Optional tuning, with defaults:

- `EMAIL_ATTEMPT_TIMEOUT_MS=5000`
- `EMAIL_TOTAL_BUDGET_MS=12000`

**Delivery flow**:

1. After the alert and its `AlertDelivery` row commit, the evaluator's caller awaits delivery in-process, after the domain write succeeds.
2. It makes up to 3 attempts with backoff of 500 ms then 1000 ms, each capped by the per-attempt timeout, and stops early when the total budget is exhausted.
3. `attemptCount` and `lastAttemptAt` are persisted before each attempt.
4. Success sets `SENT` and `sentAt`.
5. Exhaustion sets `FAILED` with a sanitized `failureCode`/`failureMessage`.
6. Delivery errors never propagate to the triggering request.

**Failure classes**:

- Retried: timeout, connection error, and SMTP 4xx.
- Not retried: SMTP 5xx rejection and authentication failure.

**Crash recovery**: a stale `PENDING` row becomes `FAILED/INTERRUPTED` on the user's next alert read or evaluation, and is never resent, which preserves the at-most-three-attempts guarantee.

**Content**:

- Subject: `CashLens: new critical alert`.
- Body: the alert type label and `${APP_PUBLIC_URL}/app/alerts`.
- The body carries no amounts, merchants, categories, accounts, or tokens.

**Rationale**:

- The PRD names "SMTP/provider đơn giản".
- SMTP works with any provider (SES, SendGrid, Mailgun, Gmail relay, local Mailpit) without vendor code, so it is the smallest portable choice.
- The project has no mail dependency today, so `nodemailer` is the only new runtime dependency.
- Awaiting delivery bounded after commit avoids a worker and un-awaited promises, and keeps tests deterministic.

**Alternatives considered**:

- An HTTP provider SDK: vendor lock-in.
- Raw `node:net` SMTP: reinvents a library.
- An outbox with a worker, or fire-and-forget: excluded by the no-queue/worker constraint, or non-deterministic.

## Secret scanning (CFG-006)

**Decision**: One pinned scanner: **gitleaks v8.30.1**, run through Docker as `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`. The digest was verified on 2026-09-23 by pulling the `v8.30.1` tag. It is recorded once in `scripts/scan-secrets.ps1`, together with the repository config `.gitleaks.toml`.

**File selection comes from Git, not from walking the directory.** gitleaks `dir` mode has no `.gitignore` support; its only ignore file, `.gitleaksignore`, suppresses findings, not files. A plain `dir` scan of the checkout would therefore scan a developer's correctly ignored `apps/api/.env`.

`scripts/scan-secrets.ps1` runs these steps and exits 0 (clean), 1 (findings), or 2 (prerequisite or configuration error):

1. **Preconditions.** Require `git` and `docker`. Resolve the historical baseline `-BaseRef` (default `80f3e0d`, the last commit of this branch that was merged into `dev` in PR #7). The default branch holds only the initial scaffold commit `a023029`, so its merge base would rescan the whole pre-feature history. The range `80f3e0d..HEAD` still covers the implementation baseline `b273f14` and every feature commit. If the ref is missing (for example in a shallow clone) or is not an ancestor of HEAD, exit **2**; never skip the history scan silently. Also exit **2** if the placeholder allowlist differs from `placeholder-secrets.ts`, if `.gitleaks.toml` holds any path, commit, or stopword allowlist, or if `.gitleaksignore` holds anything but documented exact fingerprints (see below).
2. **Select the working-tree files.** `git ls-files -z --cached --others --exclude-standard`, de-duplicated. This covers:
   - every tracked file, including a tracked file that an ignore rule would match (an accidentally committed `.env` is still scanned);
   - every untracked file that ignore rules do not exclude.

   Ignored paths never enter the set: `.env*` local files, `node_modules`, `dist`, `.turbo`, `coverage`, and `.yarn`. Tracked paths that are deleted on disk are skipped.
3. **Stage.** Copy the selected files, preserving relative paths, into a fresh temporary directory outside the repository. Remove the directory in a `finally` block.
4. **Scan 1, working tree.** Run `docker run --rm -v <staging>:/scan:ro -v <staged config>:/cfg:ro <image> dir /scan --config /cfg/.gitleaks.toml --ignore-gitleaks-allow --redact --no-banner --exit-code 1`, with the JSON report on standard output. Path-scoped rules match paths relative to `/scan`, which are the same as repository-relative paths.
5. **Scan 2, feature history.** Run `docker run --rm -v <repo>:/repo:ro -v <staged config>:/cfg:ro <image> git /repo --log-opts="<BaseRef commit>..HEAD" --config /cfg/.gitleaks.toml --ignore-gitleaks-allow --redact --no-banner --exit-code 1`, with the JSON report on standard output. The validated root `.gitleaksignore` applies its exact commit-scoped fingerprints. This covers every feature commit, including secrets that were added and later removed. Ignored files never appear in commits unless forced, in which case they are scanned. The script sets `safe.directory` for the mounted path when the container user differs from the repository owner.
6. **Result.** Exit 1 if either scan reports findings, and 2 if gitleaks produced no parsable report. Print only redacted findings, the reviewed-exception count, the scanned file count, and the commit range.

Scan options:

- Output uses `--redact`.
- `.gitleaks.toml` sets `[extend] useDefault = true`.
- Custom rules cover the Google OAuth client secret (`GOCSPX-`), Google refresh tokens (`1//0`), and **non-synthetic email addresses under `apps/*/test/**` and `**/fixtures/**`**. Allowed fixture domains are `example.com`, `example.org`, `example.test`, and `cashlens.test`.
- The allowlist contains exactly the placeholder values in `apps/api/src/config/placeholder-secrets.ts`, the same list that production startup rejects (CFG-001), for example `change-me`, `cashlens_password`, and `replace-with-…`. No path-wide allowlists are used.
- **Reviewed history exceptions** (US1 closure): the root `.gitleaksignore` may hold only exact, commit-scoped fingerprints `<40-hex commit>:<path>:<rule>:<line>` of commits in HEAD's history, each directly after a comment explaining it. gitleaks would apply a commit-less fingerprint to every commit and to the working tree, so the script refuses those, wildcards, abbreviated commits, undocumented entries, and nested `.gitleaksignore` files. Inline `gitleaks:allow` comments are ignored (`--ignore-gitleaks-allow`). The file currently holds two entries: the synthetic `JWT_SECRET` and `EMAIL_TOKEN_ENCRYPTION_KEY` fixture values committed in pushed commit `219f8e9` (`apps/api/src/config/configuration.spec.ts` lines 18 and 19), which the working tree now builds at runtime. A changed fixture, or any other secret in the same file, folder, or commit, is still reported.

**Rationale**:

- A single binary, pinned, deterministic, and offline.
- Docker is already a documented prerequisite, so it adds no npm or CI infrastructure.
- Git mode is required because SC-003 concerns commits, not only the tree.
- Git-based file selection makes the working-tree scan independent of each developer's ignored local state. The same checkout yields the same file set on every machine.

**Limitation**: pattern scanning cannot prove that no private financial data is present. The release evidence therefore includes a signed synthetic-fixture attestation (TEST-008).

**Alternatives considered**:

- `secretlint` via npm: it scans only the working tree, not history.
- TruffleHog: heavier, and its network verification is non-deterministic.
- GitHub secret scanning: a platform dependency that does not cover local commits before push.

## Success-criteria measurement

| Criterion | Measurement |
|---|---|
| SC-001 | T107 timed walkthrough. See "SC-001 walkthrough" below for the performer, clean environment, and start/stop points. The transcript and record go in `checklists/release-evidence.md`. |
| SC-004 | The replay test (T049) loops exactly `REPLAYS = 3` times and asserts after each iteration. |
| SC-005 | `apps/api/test/parser-fixture-rates.e2e-spec.ts` (T048) reads `docs/operations/supported-parsers.md`. It fails when zero parsers are declared or the file is unreadable, when any parser has fewer than 10 valid or 2 malformed fixtures, or when any parser is individually under 85%. It writes a per-parser table to release evidence. |
| SC-008 | T058 and T063 assert the data-model worked examples G1–G10 exactly. T073 and T074 reuse them for the alert conditions. |
| SC-010 | The dashboard benchmark (below), run by T101 in production mode. |
| SC-012 | Deferred to post-MVP (pending confirmation). No participant pool or protocol exists; the automated smoke test (T099) proves only that the journey can be completed. |

## Dashboard benchmark (DASH-004, SC-010)

**Decision**: One deterministic, repository-owned benchmark.

**Fixture: `apps/api/test/benchmark/dashboard-bench.fixture.ts`.** It uses seed `20260923` and is anchored to the run date. The user is `bench@cashlens.test` with timezone `Asia/Ho_Chi_Minh`, month-start day 1, and base currency VND.

- **Months:** 13 user months: the 12 completed months plus the current month.
- **Transactions per month:** 230, for **2,990** in total:

  | Count | Kind |
  |---|---|
  | 185 | VND expenses |
  | 5 | USD expenses |
  | 20 | incomes |
  | 10 | transfers |
  | 4 | ignored |
  | 3 | duplicates |
  | 3 | soft-deleted |

  Current-month transactions are spread over the elapsed part of the month.
- **Other data:** **20** categories (15 expense, 5 income), **3** accounts (bank, e-wallet, cash), and **10** active MONTHLY budgets on distinct expense categories.
- **Expected totals:** the generator returns the expected current-month totals (income, expense, and net per currency) computed from its own records.

**Runner: `apps/api/test/benchmark/dashboard-benchmark.ts`,** exposed as `yarn workspace api bench:dashboard --base-url <url>`.

1. Seed the fixture into a dedicated benchmark database (`bench:dashboard:seed`).
2. Wait for `/api/health/ready` to return 200.
3. Sign in once.
4. Verify that overview totals equal the generator's expected totals. Abort on a mismatch.
5. Run 10 warm-up loads.
6. Run 200 measured loads, **sequentially**.

**What one load is.** A load is the six requests `DashboardPage.tsx` issues, sent concurrently:

- `GET /dashboard/overview`
- `GET /dashboard/cashflow?months=6`
- `GET /dashboard/category-breakdown`
- `GET /dashboard/recent-transactions`
- `GET /dashboard/hot-budgets`
- `GET /dashboard/insights`

All six use the current month, the web default. A load's duration runs from the first request sent to the last response body received, measured with `performance.now()`. Requests use keep-alive.

**Pass rule.**
- Sort the 200 load durations ascending. p95 is the **190th** value (nearest rank, ⌈0.95 × 200⌉).
- The run passes when p95 ≤ 1,000 ms and all 1,200 responses are HTTP 200 with `success: true`.
- The runner prints the minimum, median, p95, maximum, and host details.

**Environment.**
- The gating run (T101) takes place on the **reference release host** (plan.md), the same host and `.env.release-test` profile as T100.
- The release image (`docker-compose.prod.yml`) runs `NODE_ENV=production`, with PostgreSQL 16 and the API on the same host (at least 2 vCPU, 4 GB RAM, SSD).
- The runner calls `https://<release-test-host>/api` through the documented reverse proxy, the same path users take. It trusts the test CA through `NODE_EXTRA_CA_CERTS`.
- The stack is disposable: `docker compose -p cashlens-bench --env-file .env.release-test -f docker-compose.prod.yml -f docker-compose.bench.yml`, with its own volume. It temporarily replaces the release-check stack on the same loopback ports behind the same proxy.
- The test-only override publishes the benchmark stack's PostgreSQL on `127.0.0.1:55432` so that `bench:dashboard:seed` can run from the host. The seeder reads the credentials from `.env.release-test` and never prints them. Production compose never publishes the database.
- No specialized hardware is required.

**Rationale**: 230 transactions per month sits at the upper end of personal use. The six-request load matches what users actually experience. Running the loads sequentially isolates latency from throughput.

**Alternatives considered**:
- Timing a single endpoint: it misses the page's real cost.
- Concurrent load testing: this is not a throughput feature.
- k6 or autocannon: an extra tool with no benefit at this scale.

**As built (T036):**
- **Anchor.** The generator is pure, and the seeder and runner share one anchor date (`--anchor YYYY-MM-DD`, default today in Asia/Ho_Chi_Minh). Every month draws the same number of random values, so the current-month amounts depend on the seed alone; any anchor in the same month verifies. The "elapsed part of the month" runs through the end of the anchor day, so some rows may carry later-today timestamps. They stay inside the current month and change neither totals nor timing.
- **Sign-in password.** The bench user's password comes from `BENCH_USER_PASSWORD` (12–72 characters), which both the seeder and the runner read and never print. Generate a throwaway value in the session, as quickstart.md §7b does.
- **Seeder guards.** The seeder refuses (exit 2) when the target database holds any account other than `bench@cashlens.test`. With `BENCH_DATABASE_URL`, it also refuses a database name without "bench" or "test".
- **Runner output.** Its median is nearest-rank (the 100th of 200). Exit codes: 0 pass, 1 p95 over 1,000 ms, 2 usage error, 3 totals mismatch, 4 failed response (including warm-up, readiness, and sign-in).
- **Compose override.** `docker-compose.bench.yml` pins the project name `cashlens-bench`, so leaving out `-p` never touches the `cashlens-prod` stack.
- **Load shape.** A load is the six concurrent month-less requests of `DashboardPage.tsx`; the page issues exactly those, with no request gated on another (T035).
- **Non-gating smoke run (T036), development mode over HTTP.** It ran on a dedicated test database: 20 loads after 2 warm-ups; final re-run on the finished code: min 44.1 ms, median 47.2 ms, p95 59.2 ms, max 62.3 ms, 0 failed responses, totals matched (an earlier run gave p95 78.0 ms). Host: AMD Ryzen 5 4600H, 12 logical CPUs, 15.4 GiB, Windows, Node 22. This is not SC-010 evidence, which T101 records on the reference release host.

## Goal rounding and periods (GOAL-002 to GOAL-004)

**Decision**: Use inclusive user-month counting and a visible horizon precedence (query → `targetDate` → `goal.months` → a 6-month default, reported as `horizonSource`).

Rounding rules:

| Value | Rounding |
|---|---|
| Required saving | Up (ceil) to whole VND |
| Available cashflow | Down (floor) |
| Score | Down |

Past deadline means 0 periods, with the whole remaining amount due now. The full rules and worked examples G1–G10 are in data-model.md.

**Rationale**:
- Rounding required saving up guarantees that saving the stated amount each period reaches the target.
- Rounding available cashflow and the score down keeps the result conservative. It also makes the band edges hand-checkable, for example 79.99 → 79 → RISKY.
- Inclusive month counting matches how users talk about "from now until December".

**API compatibility**:
- Considering `targetDate` is new behavior; the existing code used only `query.months ?? goal.months ?? 6`.
- `horizonSource` makes the 6-month default visible, so no hidden assumption remains.

**Alternatives considered**:
- Round-half-even: harder to hand-calculate.
- Excluding the current month: surprising for deadlines in the current month.

## Budget period types (BUDGET-005)

**Decision**: Alert evaluation covers MONTHLY budgets only, per user month, clipped to `startsAt`/`endsAt`. WEEKLY, YEARLY, and CUSTOM budgets stay accepted and readable but are excluded from evaluation. They are flagged `alertsSupported: false` and `usageBasis: CALENDAR_MONTH_APPROXIMATION`.

**Rationale**:
- The PRD lists the period types in the data model but specifies alerts only through monthly examples (80%/100%, TC-05).
- The current code computes usage per calendar month for every budget.
- The web UI creates only monthly budgets.
- Keeping writes accepted avoids changing BUDGET-001 or breaking API clients.

**Alternatives considered**:
- Rejecting non-MONTHLY writes: this changes the API contract and needs product-owner approval.
- Defining weekly/yearly/custom instances now: this expands scope.

## Alert orchestration dependency direction (U2)

**Decision**: Dependencies point one way only: **feature modules → `AlertsModule` → global `PrismaModule` + `common/finance/*`**.

- `TransactionsModule`, `BudgetsModule`, `GoalsModule`, `EmailIngestionModule`, and `EmailConnectionsModule` import `AlertsModule` and call `AlertEvaluationService.on*()`.
- `AlertsModule` imports **no** feature module. It reads evaluator inputs through `alerts/queries/alert-inputs.query.ts`, which uses the global `PrismaService` plus shared Prisma-backed helpers in `apps/api/src/common/finance/`:
  - `financial-period-policy.ts` (T032);
  - `completed-month-cashflow.ts` (T059);
  - `budget-spend.query.ts` (T070).
- The same helpers are consumed by `goals.repository.ts`, `budgets.service.ts`, and the dashboard budget-spending query.
- `goals/goal-feasibility.ts` is a pure TypeScript function with no Nest provider, so importing it creates no module dependency.
- No `forwardRef`.

**Evidence**:
- `PrismaModule` is `@Global()`.
- `AlertsModule` currently has no `imports`.
- No feature module imports `AlertsModule` today, so this direction introduces no cycle.

**Alternatives considered**:
- `forwardRef`: hides a cycle and makes initialization order fragile.
- Injecting feature services into alerts: creates cycles.
- An event emitter or bus: excluded infrastructure.

## E2E test database strategy (U3)

**Decision**: Four rules:

1. **Dedicated test database.** API e2e suites run against a dedicated test database named by `E2E_DATABASE_URL`. A guard in `test/helpers/test-database.ts` aborts unless the database name contains `test`, so a developer or production database is never touched.
2. **Serial execution.** `test:e2e` runs Jest with `--runInBand`. The shared-schema suites (T011–T017 and later) use run-scoped unique identities (the existing `Date.now()` pattern), clean up with targeted `deleteMany` in `afterAll`, and never assert global emptiness.
3. **Isolated databases for global-state suites.**
   - Suites that assert global state, first-admin bootstrap (T013) and anything counting all admins, create a private **database** named `test_e2e_<suite>_<epochMs>` with `CREATE DATABASE`.
   - They apply `prisma migrate deploy` to it with `DATABASE_URL` pointing at it, and drop it with `DROP DATABASE … WITH (FORCE)` in `afterAll`.
   - The bootstrap suite spawns the script as child processes with that database's URL, including two processes at once for the concurrency case.
   - The T010 test-only admin promotion is never used in an isolated database.
   - The e2e role needs the `CREATEDB` privilege. The dev compose `POSTGRES_USER` is a superuser.
4. **Global setup.** It migrates the shared test database once and drops leftover `test_e2e_*` databases whose `epochMs` is older than 24 hours, left behind by crashed runs.

**Why databases, not schemas.** `PrismaService` builds `new PrismaPg({ connectionString })`, and node-postgres ignores Prisma's `?schema=` URL parameter. A child process given a `?schema=` URL would silently write to the shared `public` schema, breaking the zero-admin precondition. A separate database isolates through the connection string alone.

**Rationale**: This matches the existing `app.e2e-spec.ts` pattern while guaranteeing the zero-admin precondition without races.

## Browser E2E runner (C1)

**Decision**: **Playwright** (`@playwright/test`), headless Chromium only, is the single browser E2E tool. It is configured in `apps/web/playwright.config.ts` and run by `yarn workspace web test:e2e`.

- Browsers are installed with `yarn workspace web playwright install --with-deps chromium`.
- The runner targets the **development compose stack**: `E2E_BASE_URL=http://localhost:5173`, which is the Vite dev server, with the API at `http://localhost:3000/api` and `NODE_ENV=development`.
  - TEST-005 needs no production mode.
  - Production HTTPS behavior is covered by T012 (in-process) and T100 (reference release host).
  - The same stack backs the SC-001 smoke flow.
- Global setup runs the admin bootstrap through `docker compose exec api yarn workspace api admin:bootstrap` and loads the fixture parser templates through the admin API.
- Traces are kept on failure.

Vitest with Testing Library (T096) stays the only component runner. The two do not overlap: components versus the full browser journey.

**Alternatives considered**:
- Cypress: heavier, and it would require a second assertion style.
- Playwright component testing: experimental, and it would duplicate Vitest.

## Raw email body preference (DATA-001)

**Decision**:
- The settings DTO accepts only `false` for `storeRawEmailBody`; `true` returns 400 `RAW_EMAIL_BODY_UNAVAILABLE`.
- Legacy stored `true` is preserved and ignored.
- Responses add `rawEmailBodyAvailable: false`.
- The UI renders the control disabled and labeled "Unavailable in this release".
- Ingestion never reads the flag.

**Rationale**: This is consistent with preserving stored preferences (the I2 decision) and is the smallest change that makes the capability visibly unavailable.

## TLS boundary (OPS-009, AUTH-003)

**Decision**: TLS is terminated outside the repository by an operator-provided reverse proxy or platform load balancer. Any product works, for example nginx, Caddy, or a cloud load balancer. The repository manages no certificates.

**Same-origin routing.** The web app and API share one public origin.
- The proxy sends `/api/` to `127.0.0.1:3000` with the path preserved, and `/` to `127.0.0.1:8080`.
- The release web image is built with `VITE_API_BASE_URL=/api`. `client.ts` reads this variable at build time, so a relative value keeps the bundle origin-independent.
- Same-origin requests keep `credentials: 'include'` and `SameSite=Lax` cookies working with no cross-site cookie exception.

**Production compose.**
- The API and web ports publish on `127.0.0.1` only, for example `127.0.0.1:3000:3000` and `127.0.0.1:8080:80`.
- PostgreSQL is not published.
- Services join the network `cashlens_net`, pinned to `172.28.0.0/24`.
- A one-off `migrate` service runs `prisma migrate deploy` inside the network.
- All settings arrive through `--env-file`; no env file is committed.

**Trusted hop: verified per host, never assumed.** A 2026-09-23 check on Docker Desktop's **default bridge** showed a container seeing requests to its `127.0.0.1`-published port as coming from the bridge gateway (`172.17.0.1`), not loopback. That result is not assumed to hold for the pinned user-defined network or for Docker Engine on Linux.
- The compose value `TRUST_PROXY=loopback,172.28.0.1` is only a starting value.
- On the reference release host, T100 sends a request through the proxy and reads the peer address the API logged (`remoteAddress`). It fails unless `TRUST_PROXY` covers that address, and records the verified value in release evidence.
- A containerized proxy on `cashlens_net` gets a fixed IP, which becomes `TRUST_PROXY`.
- The development default is `loopback`.

**Reference release host.** The documented Linux x86_64 deployment or CI host (a VM, bare-metal server, or CI runner) running Docker Engine, not Docker Desktop.
- It has at least 2 vCPU, 4 GB RAM, and SSD storage.
- The documented reverse proxy terminates TLS on it for a release-test hostname, using the operator's CA or a local test CA.
- T100 and T101 run there. Results from other hosts are informative only.

**Release-test profile.** `scripts/init-local-env.ps1 -Profile release-test -PublicOrigin https://<host>` generates the git-ignored `.env.release-test`.
- It holds synthetic, release-safe values for every production setting:
  - random secrets and database password;
  - `https` origins derived from `-PublicOrigin`;
  - synthetic Gmail client values that are never real credentials;
  - `EMAIL_TRANSPORT=disabled`;
  - the `TRUST_PROXY` starting value.
- No value is printed.
- T036, T100, and T101 use it. Real deployments keep their env file outside the repository.

**API in production.**
- Express `trust proxy` is set from `TRUST_PROXY`, and `X-Forwarded-Proto` is honored only from that hop.
- Cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`; the existing `secure: NODE_ENV === 'production'` is kept and made configuration-driven.
- Authentication and session-issuing routes (register, login, refresh, logout, and the OAuth callback) reject requests whose effective protocol is not `https` with 403 `HTTPS_REQUIRED`.
- `/api/health/*` is exempt so container health checks over loopback keep working.

**Config in production.** Validation rejects non-`https` values for `CORS_ORIGIN`, `APP_PUBLIC_URL`, and `GMAIL_REDIRECT_URI`.

**Documentation.** The operator's proxy must route `/api/` and `/` as above, forward `X-Forwarded-Proto` and `Host`, redirect HTTP to HTTPS, and send HSTS. The deployment doc includes an illustrative nginx snippet.

**Release verification (T100, reference release host).** It asserts:
- the compose port bindings are loopback-only;
- config rejects `http://` origins in production;
- `https://<host>/` serves the web app, and the bundle holds only the relative `/api`;
- login through the proxy returns `Set-Cookie` with `Secure; HttpOnly; SameSite=Lax`, and a same-origin authenticated call succeeds;
- the observed proxy peer address is covered by `TRUST_PROXY` and is recorded;
- direct `http://127.0.0.1:3000` login without a forwarded header returns 403 `HTTPS_REQUIRED`;
- `/api/health/ready` over loopback HTTP returns 200.

**Rationale**:
- A single host behind HTTPS needs no in-repository certificate automation.
- Loopback binding plus trusted-hop forwarding prevents header spoofing from outside the host.

## Existing email preferences (I2)

**Decision**:
- Preserve existing `AlertSetting.emailEnabled` values; DB-M5 is schema-only.
- New settings default to `false`.
- Release notes disclose the previous default: budget CRITICAL emails may reach accounts that were created with it and have a transport configured.

**Rationale**: This preserves user preference, as directed. The migration is forward-only, so an irreversible reset without explicit approval is avoided.

## SC-001 walkthrough

**Decision**:

- **Performer.** An independent developer when available. Otherwise the documentation author, in a clean environment: a fresh VM, a fresh OS user account, or a new machine.
- **Clean environment.** No prior clone. Empty Docker image cache (`docker image ls` shows no project or base images) and empty Yarn cache. Only Node 22 with Corepack, Docker, Git, and PowerShell 7 are installed.
- **Timing.** The timer starts when `git clone` is executed and stops when the last documented smoke step (the dashboard shows the created transaction) succeeds.
- **Evidence.** The session is captured with `Start-Transcript` (or `script -T`), including timestamps. The transcript is stored at `specs/001-operational-mvp/checklists/evidence/sc-001-transcript.txt` and must pass `scan-secrets.ps1`.

## Resolved Unknowns

No `NEEDS CLARIFICATION` remains. The 2026-09-23 sessions resolved:

- administrator bootstrap;
- budget threshold semantics;
- the alert trigger matrix;
- the alert lifecycle versus read state;
- the email transport (SMTP adapter plus `disabled`/`log`/fake);
- secret scanning (Git-selected files plus gitleaks through Docker);
- success-criteria measurement;
- migration sequencing;
- the dashboard benchmark;
- goal rounding and periods;
- budget period types;
- alert dependency direction;
- the e2e database strategy;
- the browser E2E runner;
- the raw-body preference;
- the TLS boundary;
- existing email preferences;
- the SC-001 performer.

The items listed as *pending product-owner confirmation* in spec.md have working defaults and do not block tasks.
