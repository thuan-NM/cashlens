# Feature Specification: Operational CashLens MVP

**Feature Branch**: `feat/thuan/backend-mvp-modules-and-docker-compose`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Bring the existing CashLens implementation from its current MVP-development state to an operational, testable, and deployable MVP while preserving working functionality and the existing architecture where reasonable."

## Clarifications

### Session 2026-09-08

- Q: Phạm vi release “Operational MVP” nên bao gồm mức nào? → A: Bao gồm toàn bộ P1: budget, mọi alert P1, in-app notification, email fallback và financial goals.
- Q: Trong Operational MVP, administrator có được xem hoặc chỉnh sửa dữ liệu tài chính và nội dung email của người dùng không? → A: Admin chỉ quản lý tài khoản và cấu hình hệ thống; không được truy cập dữ liệu tài chính hoặc email của người dùng.
- Q: Operational MVP phải tự động đồng bộ Gmail theo lịch hay chỉ cần người dùng chủ động bấm đồng bộ? → A: Chỉ bắt buộc manual sync và initial backfill có giới hạn; scheduler và background worker để sau MVP.
- Q: Available cashflow dùng để đánh giá goal nên được tính từ khoảng lịch sử nào? → A: Dùng trung bình net cashflow của 3 tháng hoàn chỉnh gần nhất và yêu cầu tối thiểu 2 tháng dữ liệu.
- Q: Sau khi budget đã tạo alert cho một ngưỡng, khi nào hệ thống được phép tạo lại alert cho chính ngưỡng đó? → A: Mỗi ngưỡng chỉ tạo một alert trong một kỳ budget; chỉ cảnh báo lại sau khi usage xuống dưới ngưỡng, alert cũ được resolve, usage vượt lại, và đã qua ít nhất 24 giờ.

### Session 2026-09-23

Remediation of the unresolved HIGH findings from the latest cross-artifact analysis. Answers marked *(default — pending product-owner confirmation)* apply a PRD-grounded default so downstream work is unblocked; they are listed for confirmation in the completion report.

- Q: How is the first administrator provisioned when no public administrator path, hard-coded credential, or default password is allowed? → A: An operator with host and database access runs one documented, controlled provisioning step that promotes an existing, active, self-registered account to administrator. It succeeds only while no active administrator exists, is a no-op when rerun for the same account, refuses any other account once an administrator exists, never handles passwords, and writes a system audit record. Later administrators are managed through the administrator-only account operations. On upgraded deployments, the operator first reviews existing administrators and removes unapproved ones through the same operator-only access, because earlier releases allowed self-promotion.
- Q: How do the single stored budget threshold and the specification's warning and critical thresholds relate? → A: The existing single threshold percent is the user-configurable warning threshold (1–99, default 80); the critical threshold is fixed at 100% of the budget amount. Warning and critical are independent alert conditions with independent deduplication and lifecycle. No additional threshold records are introduced.
- Q: Without a scheduler, how are alert cooldown and re-crossing evaluated? → A: Level-triggered at each evaluation: a new occurrence is created only when the condition holds, no open occurrence exists for the same condition identity, and at least 24 hours have elapsed since the most recent occurrence of that condition was triggered. Suppressed crossings are not stored. Time-dependent effects (cooldown expiry, period or month rollover) take effect at the next evaluation trigger.
- Q: Which alert types must be operational in this release, and which are deferred? → A: Budget threshold, large transaction, goal risk, cashflow risk, repeated email-synchronization failure, and reconnect-required are operational exactly as defined in the Alert Trigger Matrix. Category spike (PRD P2), a separate parser-issue alert, notification-delivery-failure alerts, and summary emails are post-MVP.
- Q: How is cashflow risk determined when no planned-cashflow data exists? → A: *(default — pending product-owner confirmation)* Projected next-month net cashflow equals the mean monthly net cashflow of the goal observation window (up to three completed months, minimum two). A negative projection is a `CRITICAL` cashflow-risk condition. Goal saving commitments are not subtracted, so cashflow risk remains a signal distinct from goal risk.
- Q: What threshold and severity apply to large-transaction alerts? → A: *(default — pending product-owner confirmation)* A per-user amount threshold in the user's base currency. It defaults to 5,000,000 when the base currency is VND and is otherwise inactive until the user sets it. A single eligible expense at or above the threshold creates a `WARNING`. No `CRITICAL` tier exists in this release.
- Q: When does a repeated system failure produce an alert? → A: *(default — pending product-owner confirmation)* A `WARNING` is created after three consecutive terminal synchronization runs of the same connection end failed, expired, or partially failed. A `CRITICAL` is created when a connection enters a reconnect-required state because provider authorization failed. A user-initiated disconnect never alerts.
- Q: How are alert condition lifecycle and read state separated? → A: The lifecycle is `ACTIVE`, `DISMISSED`, or `RESOLVED`. Read state (read flag and read time) is independent presentation state. Reading never changes the lifecycle. A dismissed occurrence still blocks duplicates until the system resolves it.
- Q: Which email delivery behavior does the MVP use without a queue or worker? → A: One standard mail-transport adapter, a disabled mode, and a redacted non-production log mode, plus an in-memory fake for tests. Delivery runs in-process after the alert is committed, with at most three attempts inside a bounded time budget. An interrupted delivery becomes an observable failure and is never resent automatically.
- Q: Is representative-user usability acceptance (SC-012) a release gate for this MVP? → A: *(default — pending product-owner confirmation)* No. It moves to post-MVP because the release has no recruited representative participants or moderated sessions. Journey completability is verified by the automated end-to-end smoke suite.
- Q: How is the absence of committed secrets verified for release? → A: One version-pinned secret scan runs over every tracked file, every untracked file not excluded by ignore rules (scope refined in the second pass below), and every commit on the feature branch since it diverged from the default branch. The allowlist is limited to the documented placeholder values that production startup rejects. Any other finding blocks release. *(Commit range and reviewed exceptions superseded by Session 2026-09-24 below.)*
- Q: How must API contracts represent success responses that the current contract exposes directly? → A: Every success response, including synchronization results and goal feasibility, uses the application's existing standard response envelope. Existing response field and status names are retained, and new fields are additive only. The exact shape is recorded in the contract artifact.

Second remediation pass (same day), resolving the follow-up analysis findings:

- Q: Which files does the release secret scan cover, so that correctly ignored local environment files do not fail it? → A: The scan covers:
  - every tracked file;
  - every untracked file not excluded by the repository's ignore rules, selected by Git;
  - every commit on the feature branch since it diverged from the default branch *(commit range superseded by Session 2026-09-24 below)*.

  Ignored files (local environment files, dependency folders, build output) are never scanned. A tracked or committed environment file is always scanned.
- Q: What exact benchmark verifies the one-second dashboard target? → A:
  - **Data:** a deterministic synthetic data set of 13 user months, 2,990 transactions, 20 categories, 3 accounts, and 10 monthly budgets.
  - **Environment:** the production-mode application and database on one ordinary host.
  - **Runs:** 10 warm-up loads, then 200 sequential dashboard loads. Each load is the six concurrent data requests the dashboard page issues.
  - **Pass:** the 190th-fastest load (nearest-rank 95th percentile) takes 1,000 ms or less, and every response succeeds.
- Q: How are remaining periods, required monthly saving, available cashflow, and the feasibility score rounded and counted? → A:
  - **Periods:** remaining periods count user months inclusively, from the current month through the deadline month. A deadline month before the current month counts zero periods, and the whole remaining amount is then due now.
  - **Rounding:** required saving rounds up to whole VND; available cashflow and the score round down.
  - **Horizon:** the deadline comes from an explicit what-if horizon, then the target date, then the planned duration, then a visible 6-month default. The result names which source was used.
- Q: Which budget period types are evaluated for alerts? → A: Only MONTHLY budgets. The period instance is the user month, bounded by the budget's start and end. Budgets with other period types remain storable and readable, but are excluded from alert evaluation and labeled unsupported.
- Q: Where is TLS terminated for the single-host deployment? → A: By an operator-provided reverse proxy or platform load balancer in front of the host. The application and web services listen only on loopback or private interfaces. In production the application:
  - trusts the forwarded protocol only from that proxy;
  - sets `Secure` cookies;
  - refuses authentication requests not received over HTTPS;
  - requires every configured public origin to be `https`.
- Q: What happens to existing per-type email-alert preferences at upgrade? → A: They are preserved unchanged. Only newly created settings default to email off. Release notes disclose that accounts created under the previous default may have budget email alerts enabled.
- Q: Can users enable raw email body storage in this release? → A: No. User input cannot enable the preference. Existing stored values are preserved but have no effect. The settings interface shows the control disabled and labeled unavailable in this release.
- Q: Who performs the SC-001 walkthrough when no independent developer is available? → A: An independent developer when available. Otherwise the documentation author performs it in a clean environment and records a timestamped command transcript. A clean environment is a fresh machine, virtual machine, or operating-system account, with empty package and container-image caches and no prior clone.
- Q: Must at least one parser be declared for release? → A: Yes. Zero declared parsers fails release validation. Each declared parser must independently reach the 85% threshold.
- Q: Do user-created alerts get an email-delivery record? → A: No. Only evaluator-created alerts have an email-delivery record; user-created alerts are in-app only.
- Q: How do the production web interface and API relate at the proxy? → A: They share one public origin. The proxy sends the API path prefix to the application and everything else to the web service, and the web interface calls the API by relative path, so cookie authentication stays same-origin.

### Session 2026-09-24 (US1 closure)

Reconciliation of the specification with the verified US1 implementation (T009–T030). No product scope was added.

- Q: How do users update their own profile once account operations become administrator-only? → A: Through a self-service profile operation (`PATCH /users/me`) that accepts only full name, timezone, locale, and base currency. Role, status, email, ownership, and metadata are rejected as invalid input.
- Q: What does an ordinary user get when sending privileged fields to an administrator-only operation? → A: Forbidden (403). Authorization is evaluated before request-body validation, so a non-administrator is refused whatever fields a well-formed JSON body contains (a body that is not valid JSON is rejected earlier, with 400, for every caller). Field-level validation errors (400) apply once the caller is authorized, and on self-service and registration operations.
- Q: How are supported bank providers and senders managed in this release? → A: They are system reference data seeded by migrations. No network-reachable write operation exists; write requests are answered as unsupported routes (404) until an administrator-only write operation is explicitly introduced. Reading the supported list requires authentication only.
- Q: What does an administrator see when managing an account? → A: Identity and status only (id, email, full name, role, status, timezone, locale, base currency, last sign-in, creation and update times). The user's settings, metadata, credentials, and financial or email data are never included.
- Q: How is a transaction deleted? → A: Only through the delete operation, which soft-deletes and is audited. Creating or updating a transaction cannot set the deleted status.
- Q: Which accounts are eligible for first-administrator provisioning? → A: An existing, active, non-deleted account that was self-registered, meaning it has its own sign-in password. Accounts without a password, such as ones created by an administrator, are refused like missing accounts.
- Q: How is an account pending deletion treated? → A: Like a disabled account: it cannot sign in, renew a session, or use an existing session.
- Q: Which commit range and exceptions does the release secret scan use on this branch? → A: The commit range starts at the historical baseline `80f3e0d`, the last commit of this branch that was merged into `dev` (PR #7), because the default branch holds only the initial scaffold and predates the existing codebase. The range therefore also rescans the implementation baseline `b273f14` and every feature commit. The only exceptions besides the placeholder allowlist are reviewed, exact, commit-scoped fingerprints of two synthetic test fixtures in pushed commit `219f8e9`; each is documented in `.gitleaksignore`, and no broader exception is accepted.

### Session 2026-09-24 (US2 closure)

- Q: Do transactions in a category marked "exclude from analytics" appear in category breakdowns? → A: No. They are left out of every category breakdown (dashboard and analytics). Exclusion from analytics does not change financial eligibility: the same transactions still count in total income, total expense, net income, savings rate, the cashflow trend, transaction list totals, and budgets. A category breakdown therefore totals less than the expense total whenever such a category has spending, and the dashboard says so instead of presenting the breakdown as the whole expense.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Securely use personal financial data (Priority: P1)

As a CashLens user, I can register, sign in, maintain a session, update my own settings, and manage only my own financial records without being able to read or change another user's data or privileged account fields.

**Why this priority**: CashLens processes sensitive financial and email metadata. Authentication without strict authorization and ownership boundaries is not releasable.

**Independent Test**: Create two ordinary users, provision one administrator only through the controlled provisioning step (SEC-009), exercise each protected operation with valid, missing, expired, and cross-user credentials, and verify data isolation and authorization responses.

**Acceptance Scenarios**:

1. **Given** a new visitor, **When** they register and sign in with valid credentials, **Then** they receive an authenticated session and can retrieve their own profile.
2. **Given** an authenticated ordinary user, **When** they attempt to read, update, or delete another user's account or financial resource, **Then** access is denied without revealing that resource's sensitive details.
3. **Given** an ordinary user, **When** they submit changes to role, status, or another privileged field, **Then** the change is rejected and the privileged values remain unchanged.
4. **Given** an expired short-lived session and a valid renewable session, **When** the user continues normal activity, **Then** the session is renewed without duplicating the action; otherwise the user is returned to sign-in with a clear message.
5. **Given** an authenticated administrator, **When** they attempt to access a user's transactions, budgets, goals, email messages, provider tokens, or other private financial content, **Then** access is denied under the same ownership boundary as for an ordinary user.
6. **Given** a deployment with no active administrator and an existing active self-registered account, **When** an operator with host access runs the documented provisioning step for that account, **Then** that account becomes an administrator, one system audit record exists, and rerunning the step for the same account changes nothing and adds no audit record.
7. **Given** an active administrator already exists, **When** the provisioning step is run for a different account, or any network-reachable operation (registration, self-service profile update, or account creation/update by a non-administrator) submits an administrator role, **Then** the request is refused and no role changes.

---

### User Story 2 - Track real transactions and dashboard totals (Priority: P1)

As a user, I can create, review, filter, edit, categorize, ignore, mark as duplicate, and remove my transactions, while the dashboard and budget totals consistently reflect persisted non-ignored, non-duplicate data.

**Why this priority**: Transaction management and trustworthy monthly totals are the core value of the product even before email automation is configured.

**Independent Test**: Start with an empty account, enter a known set of income, expense, and transfer transactions, change and remove selected records, and compare all displayed totals with hand-calculated expected values.

**Acceptance Scenarios**:

1. **Given** an authenticated user with no data, **When** they create income and expense transactions, **Then** the records appear in their list and monthly dashboard with correct income, expense, net, and savings-rate values.
2. **Given** a transaction, **When** the owner changes its category or note, **Then** the persisted transaction and dependent summaries reflect the change.
3. **Given** an ignored, deleted, or confirmed duplicate transaction, **When** summaries are recalculated, **Then** the transaction is excluded according to one documented rule applied consistently across dashboard, budget, and goal calculations.
4. **Given** a transfer between accounts, **When** the user filters and reviews monthly cashflow, **Then** the transfer is distinguishable and does not incorrectly inflate income or expense.

---

### User Story 3 - Import Gmail transactions safely (Priority: P1)

As a user, I can connect Gmail with read-only consent, explicitly choose which bank messages may be processed, run a bounded synchronization, observe its progress and outcome, and safely retry it without creating duplicate transactions.

**Why this priority**: The email-to-transaction pipeline is CashLens's primary differentiator and a mandatory MVP outcome in the PRD/SRS.

**Independent Test**: Connect a test mailbox containing matching, non-matching, malformed, and duplicate bank emails; run and retry synchronization; verify consent boundaries, parse logs, sync status, and transaction results.

**Acceptance Scenarios**:

1. **Given** a user who has not granted access, **When** they start Gmail connection, **Then** they are shown read-only consent and no email password is requested or stored.
2. **Given** an active connection and enabled listen rules, **When** synchronization runs, **Then** only matching messages inside the configured range are processed.
3. **Given** the same provider message or transaction is seen again, **When** synchronization is retried, **Then** no second active transaction is created.
4. **Given** one malformed message among valid messages, **When** synchronization runs, **Then** the malformed message is recorded as failed, valid messages continue, and the final run reports a partial failure.
5. **Given** a revoked or expired connection, **When** synchronization is requested, **Then** no messages are processed and the user receives an actionable reconnect state.
6. **Given** a newly connected mailbox, **When** the user starts the initial import, **Then** the system processes only the configured bounded history and reports when that backfill is complete or requires another user-triggered continuation.

---

### User Story 4 - Classify transactions predictably (Priority: P1)

As a user, I receive deterministic automatic categories for supported patterns and can correct a category with confidence that my manual decision will not later be overwritten unexpectedly.

**Why this priority**: Rule-based classification is part of the PRD MVP and is required for useful category reports and budgets.

**Independent Test**: Apply overlapping system and user rules to known transactions, manually correct one result, then rerun classification and confirm priority, conflict, fallback, and correction-protection behavior.

**Acceptance Scenarios**:

1. **Given** several matching rules, **When** classification runs, **Then** exactly one winner is selected using the documented deterministic priority and tie-break order.
2. **Given** no matching rule, **When** classification runs, **Then** the transaction is assigned the documented fallback state and remains reviewable.
3. **Given** a user manually corrected a category, **When** automatic classification or email reprocessing runs later, **Then** the manual category remains unless the user explicitly requests reclassification.
4. **Given** a category change, **When** it is saved, **Then** the reason, source, previous category, new category, and time are available for audit and testing.

---

### User Story 5 - Receive useful budget alerts (Priority: P1)

As a user, I can set a category budget with a warning threshold, see usage calculated from my persisted transactions, and receive non-spamming in-app alerts when usage reaches the warning threshold or the fixed 100% critical threshold, as well as the other P1 alerts defined in the Alert Trigger Matrix.

**Why this priority**: Budget alerting is already represented in the application and is part of the operational-MVP definition of done, but current alert records are not yet driven by a complete evaluation lifecycle.

**Independent Test**: Create a budget and transactions immediately below and above each threshold, then edit/delete/reclassify transactions and verify recalculation, alert creation, cooldown, dismissal, read state, and resolution behavior; repeat the trigger/resolution fixtures for every other Alert Trigger Matrix row.

**Acceptance Scenarios**:

1. **Given** an active monthly budget with an 80% warning threshold (critical is always 100%), **When** eligible spending in the current budget period reaches 80%, **Then** exactly one `WARNING` budget alert is created for that budget period.
2. **Given** the same threshold condition remains true, **When** evaluation repeats during the same budget period, **Then** no duplicate alert is created regardless of elapsed time.
3. **Given** spending later reaches 100%, **When** evaluation runs, **Then** one `CRITICAL` budget alert is created independently of the warning alert's lifecycle or cooldown, and the warning alert stays open because its condition still holds.
4. **Given** a related transaction is edited, deleted, ignored, duplicated, or recategorized, **When** totals change, **Then** budget usage and alert state are recalculated deterministically for every affected budget period.
5. **Given** usage fell below a previously alerted threshold and the system resolved that alert, **When** a later evaluation finds usage at or above the same threshold, **Then** one new alert is created only if at least 24 hours have elapsed since the previous alert for that threshold and period was triggered; otherwise none is created, and the first evaluation after the 24 hours elapse creates it if the condition still holds.
6. **Given** the user dismissed an open budget alert while its condition still holds, **When** evaluation repeats, **Then** no new alert is created for that condition until the system has resolved the dismissed alert and the ALERT-003 re-creation conditions are met.
7. **Given** an open alert, **When** the user marks it read, **Then** only its read state changes and its lifecycle status is unchanged.
8. **Given** a single mutation moves usage from below the warning threshold to 100% or more, **When** evaluation runs, **Then** both the `WARNING` and `CRITICAL` conditions hold and one alert is created for each.

---

### User Story 6 - Plan a goal using real financial capacity (Priority: P1)

As a user, I can create a financial goal and receive a transparent feasibility result based on my own eligible financial history, with a clear insufficient-data state instead of fabricated assumptions.

**Why this priority**: Goal functionality exists in the current application, but a hard-coded cashflow assumption makes production results misleading.

**Independent Test**: Create goals for users with positive, negative, and insufficient transaction histories and independently verify required saving, available cashflow, feasibility, and fallback explanations.

**Acceptance Scenarios**:

1. **Given** a goal amount, current savings, and future deadline, **When** feasibility is calculated, **Then** required periodic saving is derived from the remaining amount and remaining periods.
2. **Given** at least two completed months of eligible financial history, **When** feasibility is calculated, **Then** available cashflow is the arithmetic mean of monthly net cashflow for up to the three most recent completed months.
3. **Given** fewer than two completed months of eligible history, **When** feasibility is requested, **Then** the result is `insufficient data`, no invented cashflow value is used, and the user is told how much additional history is required.
4. **Given** a goal or contributing transaction changes, **When** the result is recalculated, **Then** the updated result is reproducible from the same inputs.

---

### User Story 7 - Start and verify CashLens from a clean checkout (Priority: P1)

As a new developer or operator, I can configure, start, verify, test, and troubleshoot CashLens from a clean checkout using repository documentation without relying on undocumented machine state or committed secrets.

**Why this priority**: A feature-complete application is not operational if its runtime cannot be reproduced or safely configured.

**Independent Test**: Follow only the repository documentation in a clean environment, configure non-secret examples, start all required services, apply database changes, run release checks, and complete the critical user smoke flow.

**Acceptance Scenarios**:

1. **Given** a clean checkout and documented prerequisites, **When** a developer follows the startup guide, **Then** all required services become healthy and persistent data survives a normal restart.
2. **Given** a required production secret is absent, empty, or left at a known placeholder, **When** the application starts, **Then** startup fails early with a precise non-secret error.
3. **Given** valid configuration, **When** release verification runs, **Then** migrations, critical automated tests, application health, and frontend-to-backend smoke flows pass.
4. **Given** an expected dependency failure, **When** a user or operator encounters it, **Then** the application exposes a safe error state and the documentation provides a recovery path.

### Edge Cases

- Simultaneous sync requests for the same email connection must not process the same message concurrently or create duplicate transactions.
- A sync range containing more messages than the allowed MVP batch must stop or continue through an observable bounded lifecycle without timing out silently.
- An email may contain a provider message identifier but no transaction code, or the same transaction may be announced in more than one message; duplicate policy must cover both cases.
- Parser output with missing amount, invalid currency, ambiguous direction, or invalid time must not create a valid-looking transaction.
- Rules with equal priority or conflicting category outcomes must resolve deterministically and expose why one won.
- A deleted category referenced by a transaction, rule, or budget must not corrupt historical reports.
- Month boundaries must use the user's configured timezone and month-start preference.
- Currency mismatch must not be silently added into one total; MVP either supports a documented conversion source or clearly separates/excludes incompatible currencies.
- A transaction edit can move spending across both category and time-period boundaries; both affected budget periods must be recalculated.
- A goal deadline in the past, target below current savings, zero remaining periods, or negative available cashflow must produce a stable explained result.
- A database outage, email-provider outage, malformed response, expired token, and rate-limit response must produce distinguishable safe errors without leaking secrets.
- Empty lists, first-time dashboards, partial data, loading states, and retriable failures must be understandable and actionable in the user interface.
- A budget stored before this release with a threshold of 100% or more has no separate warning condition; only the fixed 100% critical condition applies until the user saves a valid warning threshold.
- A transaction edit or historical import that affects a past budget period, or an expense dated before the current user month, may resolve existing alerts but must never create a new budget or large-transaction alert, so bounded backfill cannot flood the user.
- If goal or cashflow history drops below two completed months, the goal-risk or cashflow-risk condition no longer holds and any open occurrence is resolved with an insufficient-data reason.
- A process stop during email delivery must not leave a delivery permanently pending or cause a later duplicate email.
- Two provisioning attempts started concurrently against a deployment with no administrator must result in exactly one administrator.
- A goal whose deadline falls in the current user month has exactly one remaining period; a deadline in an earlier month has zero, and the full remaining amount is due now.
- A WEEKLY, YEARLY, or CUSTOM budget never produces an alert and is visibly marked as unsupported for alerts.
- A developer's ignored local environment file never causes the release secret scan to fail; the same file committed or left unignored always does.
- In production, a sign-in attempt that reaches the application over plain HTTP, bypassing the TLS proxy, is refused. Health checks over the local interface still succeed.

## Requirements *(mandatory)*

### Current Capability Baseline

The following baseline was established from the PRD/SRS, the implementation at commit `b273f14`, the indexed code graph, route/service inspection, the data model, and runtime configuration validation. `IMPLEMENTED` means the required behavior is materially present in source; it does not waive the release verification requirements in this feature.

| Capability | Current status | Verified current behavior | Required operational delta |
|------------|----------------|---------------------------|----------------------------|
| Authentication | PARTIALLY_IMPLEMENTED | Registration, login, profile lookup, renewable session records, logout, and browser session cookies exist and are connected to the frontend. | Complete expiry renewal behavior, authorization response tests, secure production configuration, and release verification. |
| User profile/settings | IMPLEMENTED | The user can view profile/settings and update privacy/automation preferences through the application. | Verify persistence, error feedback, ownership, and privileged-field isolation. |
| Transactions | PARTIALLY_IMPLEMENTED | Owner-scoped list/create/read/update/category/duplicate/ignore/delete operations and frontend screens exist. | Complete correction history, deterministic transfer/duplicate treatment, and contract/E2E verification. |
| Budgets | PARTIALLY_IMPLEMENTED | Budget CRUD, persisted spending aggregation, summary, and threshold projection exist. | Add deterministic evaluation, persisted non-duplicate alerts, cooldown, and recalculation lifecycle. |
| Goals | PARTIALLY_IMPLEMENTED | Goal CRUD, contributions, and a simulation response exist. | Remove hard-coded financial capacity and define real-data formulas and insufficient-data behavior. |
| Alerts | PARTIALLY_IMPLEMENTED | Alert records, list, read state, bulk read, user-authored alert creation, and per-type settings (in-app/email flags and an amount threshold) exist; default settings currently enable email for budget-threshold and large-transaction alerts; no evaluator creates alerts. | Add matrix-driven creation, `ACTIVE`/`DISMISSED`/`RESOLVED` lifecycle separate from read state, level-triggered cooldown, email-disabled defaults, delivery state, and recalculation. |
| Email ingestion | PARTIALLY_IMPLEMENTED | Gmail OAuth, encrypted tokens, connection ownership checks, listen rules, manual sync, message metadata, sync runs, parser invocation, and per-message failure isolation exist. | Complete incremental state, bounded retry/rate-limit behavior, concurrency control, stronger transaction deduplication, and production configuration. |
| Dashboard | IMPLEMENTED | Persisted transactions and budgets feed overview, cashflow, category, recent-transaction, hot-budget, and insight views. | Verify numerical consistency, timezone boundaries, empty/error states, and target response time. |
| Classification | NOT_IMPLEMENTED | Manual category assignment and classification fields exist; a merchant-rule data structure exists. | Deliver executable rules, priority/conflict/fallback logic, correction events, and correction protection. |
| Docker services | PARTIALLY_IMPLEMENTED | Database, API, and web services are defined; dependency ordering, database health check, migrations, and persistent volumes are present; configuration parses successfully. | Remove unsafe defaults, add required application health verification, clean-checkout proof, production configuration guidance, and graceful failure behavior. |
| Persistence/database | IMPLEMENTED | Migrations and persisted entities cover users, sessions, audit logs, transactions, categories, accounts, budgets, goals, alerts, email connections/messages/syncs, and parser templates/runs. | Add only the minimum records/constraints needed for missing MVP behavior and prove migration safety. |
| Frontend/backend integration | PARTIALLY_IMPLEMENTED | Shared API and authentication providers connect all principal frontend areas to backend resources. | Validate contracts, renewal/retry behavior, loading/error feedback, and critical end-to-end flows. |

### PRD/SRS Functional Coverage

| PRD/SRS ID | Requirement summary | Current status | Operational MVP disposition |
|------------|---------------------|----------------|-----------------------------|
| FR-01 | Register, login, retrieve profile | IMPLEMENTED | Preserve and harden under AUTH/SEC requirements. |
| FR-02 | Gmail OAuth with read-only scope | PARTIALLY_IMPLEMENTED | Complete configuration, consent verification, reconnect, and release testing. |
| FR-03 | View connection state, last sync, disconnect/reconnect | PARTIALLY_IMPLEMENTED | Complete explicit state/error/reconnect behavior. |
| FR-04 | Supported bank providers and senders | PARTIALLY_IMPLEMENTED | Preserve the seeded provider data; it is readable by authenticated users. No write operation exists in this release (write requests are unsupported, 404); any future write operation must be administrator-only (SEC-003). |
| FR-05 | User-owned sender/subject/body/bank listen rules | IMPLEMENTED | Verify ownership, disabled-rule behavior, and configured sync range. |
| FR-06 | Manually trigger bounded sync | IMPLEMENTED | Harden lifecycle, concurrency, retry, and observability. |
| FR-07 | Persist email metadata and body hash | IMPLEMENTED | Preserve privacy-by-default and retention behavior. |
| FR-08 | Select versioned parser by bank/channel | IMPLEMENTED | Add release fixtures for supported MVP banks and deterministic selection tests. |
| FR-09 | Persist parser outcome and error | IMPLEMENTED | Verify complete failure evidence and safe payload handling. |
| FR-10 | Create normalized transaction with source trace | IMPLEMENTED | Verify required fields and invalid-output rejection. |
| FR-11 | Deduplicate by transaction code or fallback hash | PARTIALLY_IMPLEMENTED | Extend beyond one-email/one-transaction uniqueness to the PRD duplicate policy. |
| FR-12 | Manual transaction CRUD with soft deletion | IMPLEMENTED | Verify ownership, filtering, and summary recalculation. |
| FR-13 | Priority-based classification rules | NOT_IMPLEMENTED | Required for operational MVP. |
| FR-14 | Manual category correction with event history | PARTIALLY_IMPLEMENTED | Add correction history and protection from automatic overwrite. |
| FR-15 | Monthly summary, category breakdown, cashflow, recent transactions | IMPLEMENTED | Verify numerical consistency, boundaries, and responsiveness. |
| FR-16 | Category/period budget and alert threshold | IMPLEMENTED | Retain; the single stored threshold is the configurable warning threshold and 100% is the fixed critical threshold (BUDGET-001). |
| FR-17 | Budget, large-transaction, goal, cashflow, and system alert engine | PARTIALLY_IMPLEMENTED | Complete every P1 alert type exactly as defined by the Alert Trigger Matrix (ALERT-009): budget threshold, large transaction, goal risk, cashflow risk, and repeated sync failure plus reconnect-required (together the MVP form of system error). Category spike remains P2/post-MVP. |
| FR-18 | In-app alert list, unread count, read/dismiss | PARTIALLY_IMPLEMENTED | Complete minimum in-app lifecycle and status behavior. |
| FR-19 | Preference-controlled email fallback | NOT_IMPLEMENTED | Required for eligible high-severity P1 alerts when the user enables email delivery; broad summaries and post-MVP channels remain deferred. |
| FR-20 | Financial goal management | IMPLEMENTED | Preserve and verify ownership and persistence. |
| FR-21 | Required saving, feasibility, projected cashflow | PARTIALLY_IMPLEMENTED | Replace fake capacity with real-data calculation and explicit insufficient-data outcome. |
| FR-22 | Compare advanced goal scenarios | OUT_OF_MVP_SCOPE | Keep any prototype compatible, but do not expand advanced scenario planning in this feature. |
| FR-23 | Masked LLM insights | OUT_OF_MVP_SCOPE | No LLM dependency for MVP decisions or calculations. |
| FR-24 | Trained ML classifier | OUT_OF_MVP_SCOPE | Rule-based classification and manual correction are sufficient for this feature. |

### Recorded Conflicts and Resolutions

| Topic | PRD/SRS position | Current implementation | Operational MVP resolution |
|-------|------------------|------------------------|----------------------------|
| Goal route contract | Uses the `financial-goals` name and an explicit simulation action. | Uses the shorter `goals` name and a read-style simulation operation. | Preserve working clients; publish one canonical contract and maintain compatibility or a documented migration path. |
| Email processing topology | Describes worker-queue processing as the target architecture. | Synchronization and parsing currently execute in the request-triggered application flow. | Operational MVP requires user-triggered manual sync and a bounded initial backfill only. Scheduled sync, a scheduler, and a separate background worker/queue are post-MVP; the request-triggered flow must still provide concurrency protection, retry, idempotency, incremental progress, and observability. |
| Classification persistence | Defines classification rules and classification-event history. | Contains category/classification fields and a merchant-rule record but no complete executable classification lifecycle. | Complete the minimum deterministic rule and correction-history behavior; ML/LLM remain excluded. |
| Goal simulation | Requires calculations based on available cashflow and projected data. | Uses a fixed assumed free-cashflow value in a production path. | Fixed or demo financial assumptions are prohibited in production results. |
| Alerts/notifications | Defines rule evaluation, cooldown, `new/read/dismissed/resolved` alert status, delivery records, and email fallback. | Exposes alert CRUD/read/settings and budget threshold projections without the complete generation/delivery lifecycle. | Complete every Alert Trigger Matrix type with in-app alerts and critical-only email fallback. PRD "new/read" becomes the independent read state, and the lifecycle is `ACTIVE`/`DISMISSED`/`RESOLVED` (ALERT-010). Configurable per-user alert-rule records, push, and complex providers are deferred. |
| MVP versus P1 | Core email pipeline is MVP; budgets, alerts, notifications, and goals are P1. | P1-facing screens, services, and persistence already exist, while email delivery and several alert-generation paths are incomplete. | The Operational MVP includes all P1 capabilities: budgets, every P1 alert type, in-app notification, preference-controlled email fallback, financial goals, and feasibility calculation. |
| Administrator provisioning | Admin manages system configuration; no provisioning procedure is defined. | Account create/update accepts role and status from any authenticated caller, so any user can currently grant themselves administrator, and existing databases may already contain unapproved administrators. No bootstrap procedure exists. | Close every network-reachable role grant for non-administrators (SEC-003/SEC-004); review and remove unapproved existing administrators at upgrade; provision the first administrator only through the controlled operator step in SEC-009. |
| Budget thresholds | One `alert_threshold_percent` per budget (example 80); alerts at 80% or 100% or a custom threshold. | One stored threshold percent accepting 1–200, used only by a read-time "near threshold" projection. | Stored threshold = configurable warning threshold (1–99 for new writes); critical fixed at 100%; legacy values ≥100 mean no separate warning (BUDGET-001, BUDGET-004). |
| Email alert defaults | Email fallback is preference-controlled. | Default alert settings enable email for budget-threshold and large-transaction alerts without user action. | Newly created settings default email to disabled for every type (ALERT-005). Existing stored preferences are preserved at upgrade, with no data migration, and release notes disclose the previous default. |
| Budget period types | Budgets have weekly, monthly, yearly, or custom periods; alert examples use monthly budgets. | Usage is computed per calendar month for every budget regardless of its period type; the web interface creates monthly budgets only. | Alert evaluation covers MONTHLY budgets only (BUDGET-005). Other period types stay storable and readable, but are labeled unsupported for alerts in this release. |

### Functional Requirements

#### Authentication and authorization

- **AUTH-001**: The system MUST allow a visitor to register, sign in, retrieve their own identity, renew an eligible session, sign out the current session, and sign out all sessions.
- **AUTH-002**: An expired or invalid session MUST produce a consistent unauthorized outcome; the client MUST either renew once safely or return the user to sign-in without repeating a non-idempotent operation.
- **AUTH-003**: Authentication cookies or equivalent session credentials MUST use production-appropriate confidentiality, transport, scope, and cross-origin protections.
- **AUTH-004**: Authentication failure messages MUST not reveal whether an email address, token, or account exists beyond what is necessary for the user action.
- **AUTH-005**: Security-relevant authentication events MUST be auditable without recording passwords, raw tokens, or secrets. Disabled, pending-deletion, and soft-deleted accounts cannot sign in, renew a session, or use an existing session, and receive the same generic outcome as invalid credentials.
- **SEC-001**: Every user-owned financial, email, planning, alert, and settings operation MUST derive ownership from the authenticated identity and MUST prevent cross-user read or mutation.
- **SEC-002**: Ordinary users MUST NOT list arbitrary users, create privileged users, or read/update/delete another user account.
- **SEC-003**: Only an explicitly authorized administrator MAY manage user account identity, role/status, supported bank providers/senders, and parser templates. No network-reachable operation MAY grant the administrator role to a caller who is not already an active administrator, and the first administrator MUST be provisioned only through SEC-009. In this release, bank providers and senders are seeded reference data with no write operation; write requests are unsupported routes (404) until an administrator-only write operation is explicitly introduced.
- **SEC-004**: Ordinary user input MUST NOT modify role, account status, ownership identifiers, system classification provenance, or other privileged fields. Users change their own profile only through the self-service profile operation (full name, timezone, locale, base currency). Creating or updating a transaction MUST NOT set the deleted status; deletion uses the audited delete operation.
- **SEC-005**: Missing authentication MUST return an unauthorized outcome; valid authentication without sufficient permission MUST return a forbidden outcome; owner-scoped lookups MUST follow one documented non-disclosure policy. On administrator-only operations, authorization is evaluated before request-body validation, so a non-administrator receives the forbidden outcome whatever fields a well-formed JSON body contains. The non-disclosure policy: an absent, not-owned, or malformed identifier returns the same not-found outcome, and administrators receive the same outcome for private resources as ordinary users. Three malformed requests are refused before authentication, for every caller and without disclosing whether a resource exists: a URL containing an encoded NUL character gets the not-found outcome; a path parameter with undecodable percent-encoding, and a body that is not valid JSON, get a validation error (400).
- **SEC-006**: Sensitive actions including email connect/disconnect/sync, privileged changes, category corrections, and destructive financial-data actions MUST produce sanitized audit evidence. Destructive financial-data actions include transaction deletion and archiving a financial account or a transaction category. Audit metadata is limited to identifiers, counts, statuses, roles, the email provider name, the change source (for example the operator command line), and changed field names.
- **SEC-007**: Automated authorization tests MUST cover horizontal access, vertical privilege escalation, mass assignment, deleted/disabled users, and malformed identifiers.
- **SEC-008**: Administrator status MUST NOT grant access to user-owned transactions, financial accounts, categories, budgets, goals, alert contents, email connections, provider tokens, email messages, listen rules, parser-run payloads, or sync-run details. Administrator account views expose identity and status only, never the user's settings or metadata.
- **SEC-009**: The first administrator MUST be provisioned only by an operator-run, non-network provisioning step that requires host and database access to the deployment. The step:
  - (a) accepts only an identifier of an existing, active, non-deleted, self-registered account (one with its own sign-in password), and never creates, accepts, prints, or stores a password or other credential;
  - (b) is atomic, succeeds only while no active administrator exists, and is safe under concurrent runs;
  - (c) is a successful no-op with no new audit record when the target is already an administrator;
  - (d) refuses, without changes and with a distinct non-secret outcome, any other target when an active administrator exists, and any missing, disabled, pending-deletion, deleted, or passwordless (not self-registered) target;
  - (e) records a sanitized system-actor audit event for every promotion;
  - (f) takes effect on the promoted account's next authorized request, because role checks use the persisted account state.

  The step MUST be covered by automated verification and documented operating instructions. No hard-coded, default, or environment-supplied administrator credential may exist.

  Because releases before this feature allowed any user to grant themselves the administrator role, an upgraded deployment may already contain unapproved administrators, which would also block first-administrator provisioning. Before the first provisioning on an upgraded deployment, the operator MUST therefore:
  - list existing administrator accounts, without exposing credentials;
  - remove the administrator role from every account not explicitly approved, through the same operator-only access;
  - record a sanitized system-actor audit event for each removal.

  Whether this review stays an operator step or becomes an automatic one-time removal at upgrade is a pending product-owner decision; the default is the operator review.

#### Configuration and secrets

- **CFG-001**: Production startup MUST reject missing, empty, malformed, or known-placeholder values for every required authentication, encryption, email-provider, database, origin, and callback setting.
- **CFG-002**: No real secret, token, credential, private key, or production connection string MAY be committed to the repository, examples, generated documentation, logs, or test fixtures.
- **CFG-003**: The environment example MUST enumerate every supported setting, identify whether it is required or optional, state its expected format without containing a usable secret, and distinguish development-only defaults from production requirements.
- **CFG-004**: Development and production behavior MUST be explicitly distinguishable for secure transport, session handling, allowed origins, callback URLs, diagnostics, and failure behavior.
- **CFG-005**: Token-encryption configuration MUST be validated before encrypted values are written or read, and changing key material MUST have a documented recovery/rotation consequence.
- **CFG-006**: Release verification MUST run one deterministic, version-pinned secret scan that covers:
  - (a) every file tracked by the repository, in its current working-tree content, including tracked files that ignore rules would otherwise match;
  - (b) every untracked file that the repository's ignore rules do not exclude;
  - (c) every commit on the feature branch since the historical baseline, including secrets that were added and later removed. On this branch the baseline is commit `80f3e0d`, the last commit of this branch that was merged into `dev` (PR #7), because the default branch holds only the initial scaffold and predates the existing codebase; the range therefore also covers the implementation baseline `b273f14` and every feature commit.

  The file set MUST be selected by the version-control system, not by walking the directory. Files excluded by ignore rules (local environment files, dependency folders, build output, caches) MUST NOT be scanned, so that a developer's correctly ignored local configuration never fails release verification. A missing or unrelated baseline reference MUST fail the scan with a distinct prerequisite error rather than skip the commit-range scan. The scan's allowlist MUST be limited to the documented placeholder values that CFG-001 rejects in production. The only other permitted exceptions are reviewed, documented, exact commit-scoped fingerprints (commit, path, rule, line) of synthetic fixtures in history that can no longer be rewritten; they never apply to the working tree or to any other commit, file, line, or rule. Any other finding MUST block release. Synthetic-data rules MUST flag fixture email addresses outside the documented reserved test domains. Because private financial data cannot be reliably detected by pattern, release evidence MUST also record an explicit attestation that all fixtures are synthetic (TEST-008).
- **CFG-007**: A deployment MAY run with email delivery disabled. When email delivery is enabled, every transport setting it requires MUST be validated at startup under CFG-001. A non-production diagnostic mode that records only redacted delivery metadata MUST be rejected in production. When email delivery is disabled, email deliveries MUST be recorded as skipped, and the user interface MUST state that email notification is unavailable.

#### Transactions, dashboard, and data correctness

- **TX-001**: Users MUST be able to list, search, filter, create, inspect, edit, categorize, ignore, mark duplicate, and soft-delete only their own transactions.
- **TX-002**: Transaction validation MUST reject invalid amounts, currencies, directions, timestamps, relationships, and ownership references with field-level feedback.
- **TX-003**: Income, expense, transfer, duplicate, ignored, pending, and deleted states MUST have one documented treatment used consistently by transaction lists, dashboard totals, budgets, classification, and goals.
- **TX-004**: A manual category correction MUST be retained as the authoritative category until the user explicitly requests another correction or reclassification.
- **TX-005**: Mutating a transaction MUST trigger or make available deterministic recalculation of every affected current summary and budget period.
- **DASH-001**: Monthly dashboard results MUST derive from the authenticated user's persisted eligible records and include total income, total expense, net income, savings rate, category breakdown, cashflow trend, and recent transactions. The category breakdown MUST leave out categories marked "exclude from analytics"; those transactions still count in every total.
- **DASH-002**: Dashboard period boundaries MUST honor the user's timezone and configured month-start rule.
- **DASH-003**: Identical eligible source records and period settings MUST always produce identical dashboard totals independent of any AI-generated content.
- **DASH-004**: On the reference benchmark, at least 95% of dashboard loads MUST return complete monthly results within one second. The reference benchmark is defined as follows:
  - **Data set:** one synthetic user with a deterministic seed.
    - 13 user months: the 12 most recent completed months plus the current month.
    - 2,990 transactions: 230 per month, made up of 185 base-currency expenses, 5 foreign-currency expenses, 20 incomes, 10 transfers, 4 ignored, 3 duplicate, and 3 soft-deleted.
    - 20 categories (15 expense, 5 income), 3 financial accounts, and 10 active monthly budgets.
  - **Environment:** the production-mode application and database running on one host with at least 2 CPU cores and 4 GB of memory. Specialized hardware is not required.
  - **Load definition:** one dashboard load is the complete set of data requests the dashboard page issues for the current month, sent concurrently. It is timed from the first request sent until the last response is fully received.
  - **Procedure:**
    - Wait until the application reports readiness, then sign in once.
    - Perform 10 unmeasured warm-up loads.
    - Perform 200 measured loads sequentially, one load at a time.
  - **Pass condition:** with the 200 load durations sorted in ascending order, the 190th value (nearest-rank 95th percentile) is at most 1,000 ms, every response succeeds, and the current-month totals equal the values the fixture generator predicts.

#### Email connection, synchronization, and parsing

- **EMAIL-001**: Gmail connection MUST use explicit read-only authorization, MUST never request or store the user's email password, and MUST allow disconnect and reconnect.
- **EMAIL-002**: Provider access and renewal credentials MUST be encrypted at rest and MUST never appear in user-visible errors, application logs, audit metadata, or notification payloads.
- **EMAIL-003**: Users MUST be able to view connection identity, status, last successful synchronization, latest failure, and required recovery action.
- **EMAIL-004**: Users MUST control enabled listen rules by owned connection, supported bank/sender, subject/body criteria, and synchronization start boundary; disabled or non-matching rules MUST not create transactions.
- **EMAIL-005**: Each sync run MUST expose a lifecycle with start/end times, trigger, status, counts found/matched/parsed/created/failed, and a sanitized failure summary.
- **EMAIL-006**: Synchronization MUST be incremental after the initial bounded import and MUST persist enough provider progress to resume without rereading the entire mailbox under normal operation.
- **EMAIL-007**: Concurrent or retried synchronization for the same connection MUST be safe and MUST NOT create more than one active transaction for the same underlying event.
- **EMAIL-008**: Duplicate detection MUST use stable provider identity first, transaction identity when available, and a documented deterministic fallback fingerprint when transaction identity is absent; suspected duplicates MUST remain explainable.
- **EMAIL-009**: Transient provider failures and rate limits MUST use bounded retry with backoff or an equivalent user-safe retry policy; permanent message errors MUST not fail unrelated valid messages.
- **EMAIL-010**: Parser selection MUST be deterministic by supported bank, channel, active version, and effective status, and every parse attempt MUST retain a sanitized success/failure record.
- **EMAIL-011**: Invalid or incomplete parser output MUST NOT create a posted financial transaction and MUST leave the message in an observable failed or review-required state.
- **EMAIL-012**: Operational MVP MUST NOT persist raw email bodies, even when an existing preference suggests otherwise; it MAY retain only the minimum message metadata, body hash, sanitized parser evidence, and derived transaction needed for duplicate prevention and troubleshooting. DATA-001 defines how the raw-body preference itself behaves.
- **EMAIL-013**: Operational MVP MUST support user-triggered manual synchronization and a bounded initial backfill; automatic scheduled synchronization, a scheduler, and a separate background worker/queue are out of scope for this release.

#### Deterministic classification

- **CLASS-001**: The system MUST support active user-owned and system-owned classification rules based on documented transaction attributes, with an explicit numeric priority and enabled state.
- **CLASS-002**: Rule evaluation MUST protect an eligible manual correction first, then select the matching user rule with the highest numeric priority, then the matching system rule with the highest numeric priority, then the fallback state; equal-priority rules MUST resolve by earliest creation time and then lexicographically smallest stable identifier.
- **CLASS-003**: Exactly one category outcome and one classification source MUST be selected per evaluation; conflicting matches MUST be explainable from the matched rules and tie-break result.
- **CLASS-004**: When no rule matches, the transaction MUST use an explicit uncategorized/review-required fallback rather than an arbitrary category.
- **CLASS-005**: Every applied or corrected category MUST record previous category, new category, source, matched rule when applicable, actor, reason, and time.
- **CLASS-006**: Automatic reclassification MUST NOT overwrite a manual correction; explicit user-requested reclassification MUST disclose that the manual result may change and MUST record the new event.
- **CLASS-007**: ML and LLM classification MUST NOT be required for this feature and MUST NOT influence release-critical deterministic calculations.

#### Budgets, alerts, and notifications

- **BUDGET-001**: Users MUST be able to create, view, update, and archive an owned budget for one category (or all expense categories) and period with a valid currency, amount, and exactly one warning threshold percent. New or updated warning thresholds MUST be whole percentages from 1 to 99 (default 80). The critical threshold is fixed at 100% of the budget amount and is not configurable in this release. No additional threshold records exist.
- **BUDGET-002**: Except for non-monthly budgets, which BUDGET-005 governs explicitly, budget usage MUST be derived from eligible persisted expense transactions within the budget's period and category according to TX-003. For a MONTHLY budget, the period instance is the user month (DASH-002) containing the evaluated date, bounded by the budget's start date and optional end date. No instance exists outside the budget's active range.
- **BUDGET-003**: Budget usage MUST be evaluated after relevant transaction creation, update, deletion, duplicate/ignore change, category change, budget creation or update, and any explicit recalculation.
- **BUDGET-004**: A budget stored before this release with a threshold of 100 or more:
  - MUST keep its stored value;
  - MUST have no warning condition until the user saves a valid threshold;
  - MUST still be evaluated for the critical condition.

  Any read-time "near threshold" indicator or budget-alert projection MUST use the same threshold rule as alert evaluation and MUST NOT create, resolve, or alter alerts.
- **BUDGET-005**: Budget alert evaluation in this release covers MONTHLY budgets only. Budgets with a WEEKLY, YEARLY, or CUSTOM period:
  - remain creatable, readable, updatable, and archivable, so existing clients and records keep working;
  - are never evaluated for alerts;
  - MUST be marked in API responses as not supported for alerts;
  - MUST be labeled in the interface as "alerts available for monthly budgets only".

  Their usage figure keeps the existing calendar-month projection and MUST be labeled as such.
- **ALERT-001**: Every evaluator-created alert MUST be owned by the affected user and MUST record:
  - type, severity, target, and condition identity;
  - period or observation window, where applicable;
  - threshold and observed value;
  - trigger time;
  - a sanitized explanation sufficient to reproduce the decision from persisted data.
- **ALERT-002**: A condition identity consists of the user, alert type, target, severity tier, and the period instance where ALERT-009 defines one. At most one open occurrence (`ACTIVE` or `DISMISSED`) MAY exist per condition identity. Different severity tiers of the same target, such as budget warning and critical, are distinct conditions with independent lifecycle and cooldown.
- **ALERT-003**: At each evaluation, the system MUST:
  - (a) resolve the open occurrence of every evaluated condition that no longer holds, retaining its history and any dismissal time;
  - (b) create a new occurrence only when all of the following are true: the condition holds, no open occurrence exists for that condition identity, the ALERT-009 creation limits are met, and at least 24 hours have elapsed since the most recent occurrence of that condition identity was triggered.

  Crossings suppressed by the cooldown MUST NOT be stored. Because no scheduler exists, cooldown expiry and period or month rollover take effect at the next evaluation trigger listed in ALERT-009.
- **ALERT-004**: Users MUST be able to see unread count and alert list, filter alerts by lifecycle status, mark one or all alerts read, and dismiss an open alert.
- **ALERT-005**: Delivery defaults and email eligibility:
  - In-app delivery MUST default to enabled for every ALERT-009 alert type.
  - Disabling in-app delivery for a type MUST stop new occurrences of that type, while open occurrences continue to resolve.
  - Email delivery MUST default to disabled for every type in newly created settings. Per-type preferences stored before this release are preserved unchanged at upgrade, and release notes MUST disclose that accounts created under the previous default may have email enabled for budget-threshold alerts.
  - Email MAY be attempted only for a `CRITICAL` alert, and only when the user has enabled email for that alert type, the user's notifications are enabled, and email delivery is available (CFG-007).
  - Email for a type requires in-app delivery to be enabled for that type, because an email always refers to an existing in-app alert. The user interface MUST prevent enabling email while in-app delivery for that type is off.
  - Every evaluator-created alert MUST record exactly one email-delivery outcome: skipped with a reason, sent, or failed.
- **ALERT-006**: Email delivery MUST start only after the alert is durably recorded. It MUST NOT roll back or hide the in-app alert, and MUST NOT delay the triggering operation beyond the documented delivery time budget. Delivery MUST:
  - make at most three total attempts within a bounded per-attempt timeout and total time budget;
  - record status, attempt count, last attempt time, send time, and a sanitized failure.

  A delivery interrupted by process termination MUST become observable as failed with an interruption reason no later than the next alert read or evaluation for that user. It MUST NOT be resent automatically.
- **ALERT-007**: An email notification MUST only state that a new critical CashLens alert of a named type exists and link to the application. It MUST NOT contain amounts, merchants, categories, account identifiers, authentication credentials, provider tokens, or raw email content.
- **ALERT-008**: The following alert types MUST be operational in this release exactly as defined in ALERT-009:
  - budget threshold;
  - large transaction;
  - goal risk;
  - cashflow risk;
  - repeated synchronization failure and reconnect-required, which together are the MVP form of the PRD system-error alert.

  The following are outside this feature:
  - category-spike detection (PRD P2);
  - a separate parser-issue alert (parser failures count through partially failed runs);
  - notification-delivery-failure alerts (delivery status remains visible per ALERT-006);
  - summary emails;
  - per-user configurable alert-rule records;
  - push notifications, multi-provider orchestration, and generalized event infrastructure.
- **ALERT-009**: Each MVP alert type MUST follow the Alert Trigger Matrix below. Common rules apply to every row:
  - identity and deduplication (ALERT-002);
  - resolution and the 24-hour level-triggered cooldown (ALERT-003);
  - lifecycle (ALERT-010);
  - email eligibility (ALERT-005).

  Only transactions eligible under TX-003 count, and periods use DASH-002 boundaries. Reading goal feasibility or budget summaries never creates or resolves alerts.

  Transactions created by email import are evaluated exactly like manual transactions, once per committed synchronization batch. Evaluation runs after the triggering financial change is committed. An evaluation failure MUST be logged with a correlation reference and MUST NOT fail or roll back the triggering change; the next qualifying trigger re-evaluates the same level-based conditions.

  | Alert type (severity) | Source data | Trigger condition and threshold | Evaluation window | Condition identity | Creation limits | Resolution condition | Evaluated on | Email eligible |
  |---|---|---|---|---|---|---|---|---|
  | Budget threshold (`WARNING`) | MONTHLY budgets only (BUDGET-005): eligible expense transactions in the budget's currency and category (all expense categories when none) | Usage % = eligible spend ÷ budget amount × 100 ≥ warning threshold percent (1–99). No warning condition exists for legacy thresholds ≥100 (BUDGET-004). | The MONTHLY period instance (BUDGET-002) containing the evaluated date | Budget + period-instance start + `WARNING` | Only for the period instance containing the evaluation time; past periods can only resolve | Usage < threshold; budget archived, deactivated, or deleted; threshold changed so the condition fails; or the period instance has ended | Transaction create/update/delete/ignore/duplicate/category change affecting the budget's old or new period and category; budget create/update; explicit budget recalculation | No |
  | Budget threshold (`CRITICAL`) | Same as the warning row | Usage % ≥ 100 | Same as the warning row | Budget + period-instance start + `CRITICAL` | Same as the warning row | Usage < 100% or any other warning-row resolution cause | Same as the warning row | Yes, if opted in |
  | Large transaction (`WARNING`) | One eligible expense transaction whose currency equals the user's base currency; transfers excluded | Amount ≥ the user's large-transaction threshold. Default 5,000,000 when the base currency is VND; otherwise inactive until the user sets one. | The single transaction | Transaction | Only when the transaction date falls in the current user month; changing the threshold never re-evaluates existing transactions | Transaction deleted, ignored, marked duplicate, made non-expense, or amount changed below the threshold | Transaction create (manual or imported); update of amount, currency, direction, or eligibility | No |
  | Goal risk (`WARNING`) | GOAL-002–GOAL-004 feasibility of an `ACTIVE` goal with remaining amount > 0 | Required monthly saving > available monthly cashflow (feasibility level other than `SAFE`). `INSUFFICIENT_DATA` means the condition does not hold. | GOAL-003 observation months | Goal | None beyond ALERT-003 | Required ≤ available; insufficient data; goal completed, paused, archived, or deleted; or remaining amount = 0 | Goal create/update/contribution/status change; any eligible transaction mutation for the user | No |
  | Cashflow risk (`CRITICAL`) | Eligible income and expense in the user's base currency for completed user months; transfers excluded | Projected next-month net cashflow < 0. The projection is the mean monthly net cashflow of up to three most recent completed months, minimum two (same computation as GOAL-003, applied to the user's base currency). | GOAL-003 observation months | User | None beyond ALERT-003 | Projection ≥ 0 or insufficient data | Any eligible transaction mutation for the user | Yes, if opted in |
  | Repeated sync failure (`WARNING`) | Terminal synchronization runs of one email connection (EMAIL-005) | The three most recent terminal runs all ended failed, expired, or partially failed | The last three terminal runs of that connection | Connection + `WARNING` | None beyond ALERT-003 | A later run ends fully successful, or the connection is disconnected or removed | Every run reaching a terminal state, including stale-lease expiry | No |
  | Reconnect required (`CRITICAL`) | Email connection authorization state | Connection enters a reconnect-required state because provider authorization failed (expired or revoked grant, failed renewal). A user-initiated disconnect never qualifies. | Current connection state | Connection + `CRITICAL` | None beyond ALERT-003 | Successful reconnect, or user disconnect or removal | Sync start, credential renewal, reconnect, disconnect | Yes, if opted in |
- **ALERT-010**: Alert lifecycle and read state MUST be independent:
  - Lifecycle status is one of:
    - `ACTIVE`: the condition held when last evaluated.
    - `DISMISSED`: the user hid an open occurrence.
    - `RESOLVED`: terminal; the system found the condition no longer holds.
  - Only the system resolves, and it does so from `ACTIVE` or `DISMISSED`, keeping the dismissal time.
  - Read state is a read flag with a read time.
  - Reading never changes lifecycle status, and lifecycle transitions never clear read state.
  - Dismissing also marks the alert read.
  - Unread count equals the number of the user's alerts not yet read.
- **ALERT-011**: Alerts that exist before this release MUST remain readable as `ACTIVE` with no condition identity and MUST NOT be resolved by evaluators. Alerts authored through the existing user-facing alert-creation operation:
  - MUST carry no condition identity;
  - MUST never be evaluated or resolved automatically;
  - MUST NOT be email-eligible, and MUST have no email-delivery record, because they are in-app only.

  Whether that operation is retained is a pending product-owner decision.

#### Financial goals

- **GOAL-001**: Users MUST be able to create, view, update, contribute to, and archive only their own goals with target amount, current saved amount, currency, deadline, priority, and status.
- **GOAL-002**: Remaining amount and required monthly saving MUST be computed as follows, with all months being user months (DASH-002):
  - **Remaining amount** is the greater of zero and the target amount minus the current saved amount.
  - **Deadline month**, in this order of precedence:
    1. An explicit what-if horizon of N months supplied with the request: the deadline month is the current month plus N − 1.
    2. Otherwise, the user month containing the goal's target date.
    3. Otherwise, the goal's creation month plus its planned duration minus 1.
    4. Otherwise, a default horizon of 6 months, the current month plus 5.

    The result MUST name the source used.
  - **Remaining periods** is the number of months from the current month through the deadline month, counting both, so a deadline in the current month gives 1. It is 0 when the deadline month is before the current month (past deadline).
  - **Required monthly saving** is the remaining amount divided by the remaining periods, rounded up to the currency's smallest unit (whole VND for VND).
  - When remaining periods is 0 and the remaining amount is above 0, the required saving equals the whole remaining amount and the result is flagged past-deadline.
  - When the remaining amount is 0, the required saving is 0, whatever the deadline.
- **GOAL-003**: Available cashflow MUST be computed as follows:
  - It is the arithmetic mean of monthly net cashflow across up to the three most recent completed user months, rounded down to the currency's smallest unit.
  - At least two completed months are required, and the current incomplete month MUST be excluded.
  - Only eligible transactions in the goal's currency count, under the same eligible-transaction, timezone, and month-start rules as the dashboard.
  - Observation history starts in the user month of the user's earliest eligible transaction in that currency. A completed month after that start with no eligible transactions counts as a net cashflow of 0.
- **GOAL-004**: Feasibility score MUST equal available monthly cashflow multiplied by 100 and divided by required monthly saving, rounded down to an integer, capped to the range 0–100, and 100 when required saving is 0; `SAFE` is 100, `ACCEPTABLE` is 80–99, `RISKY` is 50–79, and `NOT_RECOMMENDED` is below 50. The result MUST expose its inputs, observation months, score, level, and reason.
- **GOAL-005**: If the user has fewer than two completed months of eligible history, the system MUST return an insufficient-data outcome and MAY accept an explicitly labeled user-provided planning input; it MUST NOT substitute a hidden fixed income, expense, interest, or free-cashflow value.
- **GOAL-006**: Goal calculations MUST be reproducible from persisted/user-provided inputs and MUST recalculate when a goal, contribution, or eligible underlying transaction changes.
- **GOAL-007**: Advanced scenario comparison, inferred interest rates, and AI financial advice are outside this feature; any retained prototype MUST be clearly identified and MUST not present fabricated production results.

#### Error handling and user experience

- **ERR-001**: Validation failures MUST identify actionable field errors without exposing internal implementation or sensitive data.
- **ERR-002**: Authentication and authorization failures MUST follow AUTH-002 and SEC-005 consistently in both service responses and user-facing behavior.
- **ERR-003**: Email sync and parser failures MUST preserve completed valid work, expose run/message status, and offer retry or reconnect only when appropriate.
- **ERR-004**: Database or required dependency failures MUST return a safe unavailable outcome, prevent partial financial writes where atomicity is required, and produce operator-visible diagnostic evidence.
- **ERR-005**: Every critical frontend journey MUST provide loading, empty, success, validation, authorization, dependency-failure, and retry states appropriate to the action.
- **ERR-006**: Errors and logs MUST include a correlation reference sufficient to trace a failed request or sync run without exposing secrets or raw sensitive content.

#### Data retention and deletion

- **DATA-001**: Raw email bodies MUST NOT be retained in the Operational MVP; raw bodies exist only transiently during parsing (the ingestion rule is EMAIL-012). The raw-body retention preference:
  - MUST NOT be enableable through any user input (a request to enable it is rejected with a field error);
  - keeps any value stored before this release unchanged, but that value has no effect;
  - MUST be shown in the settings interface as disabled and labeled unavailable in this release, whatever the stored value.
- **DATA-002**: Disconnecting Gmail MUST revoke or make unusable the stored provider credentials while retaining derived transactions and sanitized audit/sync evidence needed for financial history and troubleshooting.
- **DATA-003**: Active-account financial records and minimum email metadata MAY remain until the user removes the relevant record or the account enters a future approved deletion workflow; Operational MVP documentation MUST disclose this behavior, and account-wide export/deletion automation remains post-MVP as stated by the PRD.
- **DATA-004**: Soft-deleted financial records MUST be excluded from user calculations and normal views while remaining inaccessible to other users and protected by the same ownership rules.

#### Runtime and operations

- **OPS-001**: A new developer MUST be able to start the required database, application service, and web interface from a clean checkout using documented commands and example configuration.
- **OPS-002**: Runtime service definitions MUST declare required dependency ordering, health criteria, restart expectations, network exposure, and persistent storage for durable data.
- **OPS-003**: Database changes MUST apply automatically or through one documented pre-start command, be repeatable on an up-to-date database, and fail without silently starting against an incompatible schema.
- **OPS-004**: Application health MUST distinguish basic process availability from readiness to serve requests with required dependencies.
- **OPS-005**: Normal shutdown and restart MUST not corrupt durable data, leave an unobservable sync state, or require deleting persistent storage.
- **OPS-006**: A release configuration MUST not depend on source-mounted development behavior, automatic dependency mutation, or undocumented local tools.
- **OPS-007**: The release checklist MUST validate configuration, database readiness, migrations, API readiness, web readiness, authentication, one transaction flow, dashboard correctness, and one duplicate-safe email sync flow.
- **OPS-008**: Operational logs MUST cover startup validation, authentication security events, sync runs, parser failures, classification decisions, alert generation/delivery, and unexpected failures with sensitive fields redacted.
- **OPS-009**: The reference Operational MVP deployment MUST support one small single-host installation with one web service, one application service, and one persistent database behind HTTPS; multi-node orchestration and horizontal scaling are post-MVP. The TLS boundary is defined as follows:
  - TLS is terminated by an operator-provided reverse proxy or platform load balancer in front of the host. The repository manages no certificates.
  - The application and web services listen only on loopback or private interfaces, never on public ones.
  - In production, the application trusts the forwarded-protocol information only from the configured proxy hop.
  - In production, every configured public origin and callback address MUST use `https`, and authentication cookies MUST carry the `Secure` attribute.
  - In production, authentication and session-issuing requests not received over HTTPS MUST be refused. Health endpoints are exempt, so local health checks keep working.
  - In production, the web interface and the application API MUST share one public origin. The proxy routes the API path prefix to the application service and every other path to the web service. The web interface addresses the API by a relative path, so cookie-based authentication with credentials works same-origin, with no cross-site cookie exception.

#### Testing and release evidence

- **TEST-001**: Every requirement in this specification MUST map to at least one automated test, release check, or documented manual acceptance check before release approval.
- **TEST-002**: Unit tests MUST cover token/session decisions, duplicate fingerprints, parser normalization, classification priority/conflicts, budget thresholds/cooldown, each ALERT-009 matrix row independently, alert lifecycle versus read state, email eligibility and attempt bounds, dashboard totals, and goal formulas/fallbacks.
- **TEST-003**: Authorization integration tests MUST cover ordinary-user/admin boundaries and cross-user access for users, accounts, transactions, categories, budgets, goals, alerts, email connections, rules, messages, parser runs, and sync runs.
- **TEST-004**: Integration tests MUST cover registration/login/renewal/logout, transaction CRUD and recalculation, Gmail OAuth state validation, sync retry/idempotency, parser failure isolation, manual category correction, and alert lifecycle.
- **TEST-005**: End-to-end smoke tests MUST cover clean-user registration/login, manual transaction to dashboard, settings persistence, budget threshold alert, real-data goal result, and a fixture-backed email-to-transaction pipeline.
- **TEST-006**: Critical frontend tests SHOULD cover authentication transition, loading/error/retry states, transaction create/edit/delete, category correction, and protection against duplicate form submissions.
- **TEST-007**: Release approval MUST require all critical tests, clean-checkout runtime checks, the SEC-009 provisioning verification, and a clean CFG-006 secret scan to pass, with no unresolved critical authorization or secret-management finding.
- **TEST-008**: Test data MUST use synthetic accounts, emails, tokens, and financial records and MUST contain no real personal or production credential data.

#### Documentation

- **DOC-001**: The repository landing documentation MUST describe CashLens rather than the starter template and explain its purpose, supported MVP journeys, and known scope boundaries.
- **DOC-002**: Documentation MUST include architecture and principal data flow, prerequisites, environment setup, local development, runtime startup, service endpoints, database migration/seed, tests, build/release steps, and shutdown/restart behavior.
- **DOC-003**: Gmail setup documentation MUST cover consent scope, provider configuration, callback configuration, test-account limitations, connection/reconnect, sync behavior, and common provider errors without exposing secrets.
- **DOC-004**: Deployment notes MUST cover required production configuration, secure session/origin behavior, first-administrator provisioning (SEC-009) and its recovery use, email delivery configuration or disabled mode (CFG-007), migrations, health verification, persistent storage, backup expectations, log redaction, secret scanning (CFG-006), and rollback considerations.
- **DOC-005**: Troubleshooting MUST cover startup/config validation, port conflicts, database readiness, migration failure, authentication/session failure, OAuth callback mismatch, provider rate limits, parser failure, and stale sync state.
- **DOC-006**: Documentation MUST provide a traceable requirement-to-test/release-check index and identify any accepted limitation remaining at MVP release.

### Key Entities

- **User and User Settings**: The authenticated owner, role/status boundary, regional settings, privacy consent, and notification preferences; administrator status permits account and system-configuration management but does not transfer ownership of private user data.
- **Session and Audit Event**: Renewable authentication state and sanitized evidence of security-sensitive actions.
- **Financial Account**: A user-owned source or destination associated with transactions.
- **Transaction and Category**: The normalized financial event and its reporting classification, source trace, duplicate/ignore status, and user correction.
- **Classification Rule and Classification Event**: A prioritized deterministic matching instruction and the immutable explanation/history of a category decision.
- **Email Connection and Listen Rule**: The encrypted provider authorization state and the user's explicit processing boundary.
- **Email Sync State, Sync Run, and Email Message**: Incremental provider position, one observable synchronization attempt, and deduplicated message metadata.
- **Parser Template and Parser Run**: Versioned extraction definition and auditable normalized success/failure result.
- **Budget**: User/category/period spending limit, one configurable warning threshold percent, the fixed 100% critical threshold, and calculated usage; only MONTHLY budgets are evaluated for alerts in this release.
- **Alert, Notification Preference, and Delivery**: One occurrence of a triggered condition with a stable condition identity, a lifecycle status (`ACTIVE`/`DISMISSED`/`RESOLVED`) independent of its read state, per-type channel consent and large-transaction threshold, and the observable email-delivery outcome.
- **Financial Goal and Contribution**: User-owned target, saved progress, deadline, and inputs to deterministic feasibility calculation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a timed walkthrough using only repository documentation, the performer goes from a fresh clone to healthy running services and a completed documented smoke flow in 30 minutes or less.
  - **Performer:** a developer who did not author the setup documentation, when one is available. Otherwise the documentation author performs it. Either way it runs in a clean environment: a fresh machine, virtual machine, or operating-system account with no prior clone, empty package-manager and container-image caches, and no undocumented local state. Only the documented prerequisites are preinstalled: runtime, package manager, container engine, and version control.
  - **Start:** the clock starts when the first documented setup command (cloning the repository) is executed.
  - **Stop:** the clock stops when the last step of the documented smoke flow succeeds. The flow is: services report ready, a user registers, the first administrator is provisioned, one transaction is created, and the dashboard shows it for the current month.
  - **Included:** dependency download, image build, migrations, and provisioning all count toward the limit.
  - **Evidence:** release evidence records:
    - the performer type (independent or author) and the commit;
    - the host description and clean-environment method;
    - the start and stop timestamps and the elapsed minutes;
    - a timestamped command transcript, which must pass the CFG-006 scan;
    - every undocumented step. Any undocumented step or assistance fails the criterion.
- **SC-002**: 100% of tested cross-user and ordinary-user privilege-escalation attempts are denied, with no unauthorized state change or sensitive data disclosure.
- **SC-003**: 100% of production-start checks reject missing, empty, malformed, or known-placeholder required secrets, and the CFG-006 scan of the selected file set (tracked files plus untracked files not excluded by ignore rules) and the feature commits reports zero unallowlisted findings.
- **SC-004**: The duplicate-safety suite replays the same supported fixture email set exactly three consecutive times against the same account. After each replay it asserts that exactly one active transaction exists per underlying financial event and that every attempted message has an observable outcome. A failure on any replay fails the criterion.
- **SC-005**: Release validation computes a separate parse success rate for each declared supported MVP parser (bank, channel, and version): valid fixtures producing the exactly expected normalized transaction ÷ valid fixtures for that parser. Release validation fails if any of the following holds:
  - no supported parser is declared, or the declaration cannot be read;
  - any parser rate is below 85% (each parser is judged independently, never averaged);
  - any declared parser has fewer than 10 valid and 2 malformed fixtures;
  - any malformed fixture creates a transaction.

  Per-parser counts and rates are recorded in release evidence.
- **SC-006**: 100% of classification conflict fixtures produce the same documented winner across repeated runs, and 100% of manual corrections remain unchanged during automatic reruns unless explicitly released by the user.
- **SC-007**: Budget usage and every ALERT-009 matrix row match expected results for all release fixtures. The fixtures cover create, update, delete, ignore, duplicate, recategory, warning and critical independence, dismissal, read-state independence, resolution, 24-hour re-creation, creation limits for past periods and backfill, and email eligibility.
- **SC-008**: Goal outputs exactly match the hand-calculated worked examples published with the data model, to the VND. The examples cover:
  - positive and negative cashflow;
  - target complete;
  - deadline in the current month;
  - past deadline;
  - a remainder that rounds up;
  - score band edges;
  - each horizon source;
  - 0, 1, 2, and 3 completed-month histories.

  Zero hidden fixed financial-capacity inputs are used.
- **SC-009**: Dashboard income, expense, net, savings rate, category breakdown, and cashflow agree with the canonical test ledger in 100% of critical release scenarios.
- **SC-010**: The DASH-004 reference benchmark passes: across 200 sequential measured dashboard loads, the 190th-fastest (nearest-rank 95th percentile) takes 1,000 ms or less, with zero failed responses and generator-matching totals. The results are recorded in release evidence: minimum, median, 95th percentile, maximum, and host description.
- **SC-011**: 100% of critical requirements have traceable release evidence, and all critical automated suites pass before MVP approval.
- **SC-012**: *Post-MVP (not a release gate for this feature; pending product-owner confirmation).* In moderated usability acceptance, at least 90% of representative first-time users complete registration, one transaction, dashboard review, and one settings change without assistance.
  - **Why deferred:** this release has no recruited representative participant pool, moderator, or session protocol, so the criterion cannot be executed or objectively evidenced before release.
  - **MVP substitute:** the same journey must pass the automated end-to-end smoke suite (TEST-005). That suite proves the journey can be completed, not that it is usable.
- **SC-013**: All required runtime services recover from a normal restart without loss of committed financial data or creation of duplicate transactions.
- **SC-014**: The repository documentation contains every topic in DOC-001 through DOC-006 and has no remaining starter-template instructions presented as CashLens setup guidance.
- **SC-015**: 100% of SEC-009 provisioning verification cases pass:
  - first promotion with an audit record;
  - idempotent rerun without a new audit record;
  - refusal once an administrator exists;
  - refusal for missing, disabled, pending-deletion, deleted, or passwordless (not self-registered) accounts;
  - exactly one administrator after concurrent runs;
  - an audited operator removal of an unapproved existing administrator, after which provisioning succeeds.

  Zero network-reachable operations grant the administrator role to a non-administrator.

## Assumptions

- The existing modular application, relational persistence model, migration history, frontend screens, and service boundaries are retained unless a requirement cannot be met safely within them.
- The operational MVP serves individual users and a small controlled deployment; enterprise multi-tenancy, high-volume distributed processing, and financial-institution certification are not implied.
- Email/password authentication and Gmail read-only OAuth remain the supported MVP authentication/integration methods; Outlook is not required for this feature.
- MVP parser support may be limited to the bank/template fixtures explicitly declared in release documentation; unsupported banks must fail safely and visibly.
- Operational MVP uses manual, user-triggered, bounded Gmail synchronization plus a bounded initial backfill. Automatic schedules and separate background workers/queues are post-MVP, while EMAIL-005 through EMAIL-009 remain mandatory for every manual run.
- All PRD P1 capabilities are included in the Operational MVP: budgets, budget/large-transaction/goal-risk/cashflow-risk/system-error alerts, in-app notification, preference-controlled email fallback, financial goals, and deterministic feasibility calculation. Each alert type's behavior is the ALERT-009 matrix. Three matrix values are PRD-grounded defaults pending product-owner confirmation: the cashflow-risk projection, the large-transaction default and single tier, and the sync-failure count.
- Without a scheduler, alert evaluation happens only at the triggers listed in ALERT-009. A condition that becomes true or eligible only because time passed, such as cooldown expiry or a completed month, is recognized at the user's next qualifying action.
- The first administrator is provisioned by an operator with host and database access. Operators are trusted with the database, so the provisioning step adds no protection against a compromised host; it prevents network-reachable escalation and default credentials.
- Email fallback uses one standard mail-transport configuration supplied by the operator. A deployment without mail configuration remains fully operational with email delivery disabled.
- TLS certificates and the TLS-terminating proxy are operator-provided infrastructure outside the repository; the repository documents the proxy requirements and verifies the application-side HTTPS guarantees.
- The dashboard benchmark host is an ordinary developer machine or standard CI runner (at least 2 CPU cores and 4 GB memory); results depend on hardware, so the host description is part of the evidence.
- Representative-user usability acceptance (SC-012) is post-MVP; release readiness relies on automated journey and release evidence.
- Advanced goal scenario comparison, ML classification, LLM insights, push notifications, Novu, direct bank APIs, CSV/SMS imports, trading, automated transfers, microservices, Kubernetes, Kafka, complex event-driven infrastructure, and premature generalized abstractions are out of scope.
- Financial amounts use exact decimal semantics and deterministic business rules. AI output, if retained elsewhere, cannot calculate or override release-critical financial values.
- Goal available cashflow uses the arithmetic mean of up to three most recent completed user months, requires at least two completed months, and excludes the current incomplete month.
- Multi-currency aggregation is not required unless an authoritative conversion source is explicitly added; otherwise incompatible currencies remain separated or excluded with a visible explanation.
- Raw email bodies are never persisted in this release. Gmail disconnect invalidates provider credentials but does not silently delete derived financial history; automated account-wide export/deletion remains post-MVP and must be disclosed.
- The reference release target is a small single-host deployment behind HTTPS using the repository's existing service composition and persistent database model; managed equivalents are acceptable only if they preserve the same security and lifecycle outcomes.
- The PRD/SRS remains a planning draft; where it conflicts with verified working behavior, the conflict table in this specification controls this feature until stakeholders approve a different resolution.

## Definition of Done

The feature is complete only when all of the following are true:

1. A new developer can configure and start CashLens from a clean checkout using documented instructions.
2. Required services, persistence, migrations, readiness checks, and normal restart behavior pass the release checklist.
3. Registration, login, renewal, logout, and own-profile/settings flows work with correct authorization outcomes.
4. Every protected resource enforces owner or administrator boundaries, privileged-field escalation is closed, and the first administrator can be provisioned only through the verified controlled step.
5. Transaction create, edit, category correction, ignore/duplicate treatment, and soft deletion work and recalculate dependent views.
6. Dashboard core figures come only from eligible persisted user data and match the canonical release ledger.
7. Budget usage and all P1 alert types are deterministic, duplicate-safe, cooldown-aware, and recalculated after relevant changes; in-app and enabled email delivery states are observable.
8. Goal calculations contain no fake production financial capacity and provide reproducible results or an explicit insufficient-data state.
9. Gmail authorization is read-only, tokens are protected, sync lifecycle is observable, and retries are incremental and duplicate-safe.
10. Classification rules, conflicts, fallback, correction history, and manual-override protection behave deterministically.
11. Required secrets are externally configured, placeholders fail fast in production, and the release secret scan finds no real secret in the working tree or feature-branch commits.
12. API, dependency, validation, authentication, empty, loading, and retry failures have safe and actionable behavior.
13. Critical automated tests and clean-checkout smoke checks pass and are traceable to requirement IDs.
14. Runtime configuration is validated for development and release use without unnecessary infrastructure.
15. Repository documentation describes the actual CashLens application and every required operating procedure.
16. Every PRD/SRS MVP requirement is implemented or has an explicit, approved status and disposition in this specification.
