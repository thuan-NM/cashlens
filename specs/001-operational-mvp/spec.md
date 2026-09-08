# Feature Specification: Operational CashLens MVP

**Feature Branch**: `feat/thuan/backend-mvp-modules-and-docker-compose`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Bring the existing CashLens implementation from its current MVP-development state to an operational, testable, and deployable MVP while preserving working functionality and the existing architecture where reasonable."

## Clarifications

### Session 2026-09-08

- Q: Phạm vi release “Operational MVP” nên bao gồm mức nào? → A: Bao gồm toàn bộ P1: budget, mọi alert P1, in-app notification, email fallback và financial goals.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Securely use personal financial data (Priority: P1)

As a CashLens user, I can register, sign in, maintain a session, update my own settings, and manage only my own financial records without being able to read or change another user's data or privileged account fields.

**Why this priority**: CashLens processes sensitive financial and email metadata. Authentication without strict authorization and ownership boundaries is not releasable.

**Independent Test**: Create two ordinary users and one administrator, exercise each protected operation with valid, missing, expired, and cross-user credentials, and verify data isolation and authorization responses.

**Acceptance Scenarios**:

1. **Given** a new visitor, **When** they register and sign in with valid credentials, **Then** they receive an authenticated session and can retrieve their own profile.
2. **Given** an authenticated ordinary user, **When** they attempt to read, update, or delete another user's account or financial resource, **Then** access is denied without revealing that resource's sensitive details.
3. **Given** an ordinary user, **When** they submit changes to role, status, or another privileged field, **Then** the change is rejected and the privileged values remain unchanged.
4. **Given** an expired short-lived session and a valid renewable session, **When** the user continues normal activity, **Then** the session is renewed without duplicating the action; otherwise the user is returned to sign-in with a clear message.

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

As a user, I can set a category budget and threshold, see usage calculated from my persisted transactions, and receive a non-spamming in-app alert when usage crosses the configured threshold.

**Why this priority**: Budget alerting is already represented in the application and is part of the operational-MVP definition of done, but current alert records are not yet driven by a complete evaluation lifecycle.

**Independent Test**: Create a budget and transactions immediately below and above each threshold, then edit/delete/reclassify transactions and verify recalculation, alert creation, cooldown, and resolution behavior.

**Acceptance Scenarios**:

1. **Given** an active budget at 80% warning and 100% critical thresholds, **When** eligible spending crosses 80%, **Then** one warning alert is created for that budget period.
2. **Given** the same threshold condition remains true inside its cooldown, **When** evaluation repeats, **Then** no duplicate alert is created.
3. **Given** spending later crosses 100%, **When** evaluation runs, **Then** a critical alert may be created even if the earlier warning is still in cooldown.
4. **Given** a related transaction is edited, deleted, ignored, duplicated, or recategorized, **When** totals change, **Then** budget usage and alert state are recalculated deterministically.

---

### User Story 6 - Plan a goal using real financial capacity (Priority: P1)

As a user, I can create a financial goal and receive a transparent feasibility result based on my own eligible financial history, with a clear insufficient-data state instead of fabricated assumptions.

**Why this priority**: Goal functionality exists in the current application, but a hard-coded cashflow assumption makes production results misleading.

**Independent Test**: Create goals for users with positive, negative, and insufficient transaction histories and independently verify required saving, available cashflow, feasibility, and fallback explanations.

**Acceptance Scenarios**:

1. **Given** a goal amount, current savings, and future deadline, **When** feasibility is calculated, **Then** required periodic saving is derived from the remaining amount and remaining periods.
2. **Given** sufficient eligible financial history, **When** feasibility is calculated, **Then** available cashflow is derived from that user's persisted income and expense data using a documented observation window.
3. **Given** insufficient history, **When** feasibility is requested, **Then** no invented cashflow value is used and the user is told what additional input or history is required.
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
| Alerts | PARTIALLY_IMPLEMENTED | Alert records, list, read state, bulk read, and settings exist. | Add rule-driven creation, dismiss/resolve lifecycle where exposed, cooldown, delivery state, and recalculation. |
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
| FR-04 | Supported bank providers and senders | PARTIALLY_IMPLEMENTED | Preserve provider data and protect system-managed changes with admin authorization. |
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
| FR-16 | Category/period budget and alert threshold | IMPLEMENTED | Retain because already built and required by this feature's definition of done. |
| FR-17 | Budget, large-transaction, goal, cashflow, and system alert engine | PARTIALLY_IMPLEMENTED | Complete every P1 alert type for the operational MVP: budget threshold, large transaction, goal risk, cashflow risk, and system error. |
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
| Email processing topology | Describes worker-queue processing as the target architecture. | Synchronization and parsing currently execute in the request-triggered application flow. | A separate queue/scheduler is not mandatory if bounded execution, concurrency protection, retry, idempotency, incremental progress, and observability meet all acceptance criteria. |
| Classification persistence | Defines classification rules and classification-event history. | Contains category/classification fields and a merchant-rule record but no complete executable classification lifecycle. | Complete the minimum deterministic rule and correction-history behavior; ML/LLM remain excluded. |
| Goal simulation | Requires calculations based on available cashflow and projected data. | Uses a fixed assumed free-cashflow value in a production path. | Fixed or demo financial assumptions are prohibited in production results. |
| Alerts/notifications | Defines rule evaluation, cooldown, in-app status, delivery records, and email fallback. | Exposes alert CRUD/read/settings and budget threshold projections without the complete generation/delivery lifecycle. | Complete budget-triggered in-app alerts and critical email fallback; defer push and complex providers. |
| MVP versus P1 | Core email pipeline is MVP; budgets, alerts, notifications, and goals are P1. | P1-facing screens, services, and persistence already exist, while email delivery and several alert-generation paths are incomplete. | The Operational MVP includes all P1 capabilities: budgets, every P1 alert type, in-app notification, preference-controlled email fallback, financial goals, and feasibility calculation. |

### Functional Requirements

#### Authentication and authorization

- **AUTH-001**: The system MUST allow a visitor to register, sign in, retrieve their own identity, renew an eligible session, sign out the current session, and sign out all sessions.
- **AUTH-002**: An expired or invalid session MUST produce a consistent unauthorized outcome; the client MUST either renew once safely or return the user to sign-in without repeating a non-idempotent operation.
- **AUTH-003**: Authentication cookies or equivalent session credentials MUST use production-appropriate confidentiality, transport, scope, and cross-origin protections.
- **AUTH-004**: Authentication failure messages MUST not reveal whether an email address, token, or account exists beyond what is necessary for the user action.
- **AUTH-005**: Security-relevant authentication events MUST be auditable without recording passwords, raw tokens, or secrets.
- **SEC-001**: Every user-owned financial, email, planning, alert, and settings operation MUST derive ownership from the authenticated identity and MUST prevent cross-user read or mutation.
- **SEC-002**: Ordinary users MUST NOT list arbitrary users, create privileged users, or read/update/delete another user account.
- **SEC-003**: Only an explicitly authorized administrator MAY perform administrative user or system-managed provider operations.
- **SEC-004**: Ordinary user input MUST NOT modify role, account status, ownership identifiers, system classification provenance, or other privileged fields.
- **SEC-005**: Missing authentication MUST return an unauthorized outcome; valid authentication without sufficient permission MUST return a forbidden outcome; owner-scoped lookups MUST follow one documented non-disclosure policy.
- **SEC-006**: Sensitive actions including email connect/disconnect/sync, privileged changes, category corrections, and destructive financial-data actions MUST produce sanitized audit evidence.
- **SEC-007**: Automated authorization tests MUST cover horizontal access, vertical privilege escalation, mass assignment, deleted/disabled users, and malformed identifiers.

#### Configuration and secrets

- **CFG-001**: Production startup MUST reject missing, empty, malformed, or known-placeholder values for every required authentication, encryption, email-provider, database, origin, and callback setting.
- **CFG-002**: No real secret, token, credential, private key, or production connection string MAY be committed to the repository, examples, generated documentation, logs, or test fixtures.
- **CFG-003**: The environment example MUST enumerate every supported setting, identify whether it is required or optional, state its expected format without containing a usable secret, and distinguish development-only defaults from production requirements.
- **CFG-004**: Development and production behavior MUST be explicitly distinguishable for secure transport, session handling, allowed origins, callback URLs, diagnostics, and failure behavior.
- **CFG-005**: Token-encryption configuration MUST be validated before encrypted values are written or read, and changing key material MUST have a documented recovery/rotation consequence.

#### Transactions, dashboard, and data correctness

- **TX-001**: Users MUST be able to list, search, filter, create, inspect, edit, categorize, ignore, mark duplicate, and soft-delete only their own transactions.
- **TX-002**: Transaction validation MUST reject invalid amounts, currencies, directions, timestamps, relationships, and ownership references with field-level feedback.
- **TX-003**: Income, expense, transfer, duplicate, ignored, pending, and deleted states MUST have one documented treatment used consistently by transaction lists, dashboard totals, budgets, classification, and goals.
- **TX-004**: A manual category correction MUST be retained as the authoritative category until the user explicitly requests another correction or reclassification.
- **TX-005**: Mutating a transaction MUST trigger or make available deterministic recalculation of every affected current summary and budget period.
- **DASH-001**: Monthly dashboard results MUST derive from the authenticated user's persisted eligible records and include total income, total expense, net income, savings rate, category breakdown, cashflow trend, and recent transactions.
- **DASH-002**: Dashboard period boundaries MUST honor the user's timezone and configured month-start rule.
- **DASH-003**: Identical eligible source records and period settings MUST always produce identical dashboard totals independent of any AI-generated content.
- **DASH-004**: For a typical personal account data set, at least 95% of dashboard loads MUST show complete monthly results within one second under the documented release-test conditions.

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
- **EMAIL-012**: Raw email body MUST remain unpersisted by default; if explicitly enabled, consent, encryption, access restrictions, and retention/deletion behavior MUST be enforced and testable.
- **EMAIL-013**: A dedicated queue or scheduler MUST NOT be a release prerequisite if all EMAIL lifecycle requirements pass with bounded manual synchronization; it becomes required only when the chosen execution model cannot meet those outcomes.

#### Deterministic classification

- **CLASS-001**: The system MUST support active user-owned and system-owned classification rules based on documented transaction attributes, with an explicit numeric priority and enabled state.
- **CLASS-002**: Rule evaluation MUST use a stable order: eligible manual correction protection first, then highest-priority user rule, then highest-priority system rule, then the fallback state; equal-priority ties MUST resolve by a stable documented key.
- **CLASS-003**: Exactly one category outcome and one classification source MUST be selected per evaluation; conflicting matches MUST be explainable from the matched rules and tie-break result.
- **CLASS-004**: When no rule matches, the transaction MUST use an explicit uncategorized/review-required fallback rather than an arbitrary category.
- **CLASS-005**: Every applied or corrected category MUST record previous category, new category, source, matched rule when applicable, actor, reason, and time.
- **CLASS-006**: Automatic reclassification MUST NOT overwrite a manual correction; explicit user-requested reclassification MUST disclose that the manual result may change and MUST record the new event.
- **CLASS-007**: ML and LLM classification MUST NOT be required for this feature and MUST NOT influence release-critical deterministic calculations.

#### Budgets, alerts, and notifications

- **BUDGET-001**: Users MUST be able to create, view, update, and archive an owned budget for a category and period with a valid currency, amount, and one or more effective thresholds.
- **BUDGET-002**: Budget usage MUST be derived from eligible persisted expense transactions within the budget's period and category according to TX-003.
- **BUDGET-003**: Budget usage MUST be evaluated after relevant transaction creation, update, deletion, duplicate/ignore change, category change, and any explicit recalculation.
- **ALERT-001**: Crossing a configured warning or critical budget threshold MUST create an owned in-app alert containing the budget, period, threshold, observed usage, severity, and trigger time.
- **ALERT-002**: The same user, alert type, target, threshold, and budget period MUST NOT create another active alert inside its configurable cooldown unless a higher-severity threshold is newly crossed.
- **ALERT-003**: Recalculation that removes the trigger condition MUST resolve or otherwise clearly mark the prior alert without erasing its audit history.
- **ALERT-004**: Users MUST be able to see unread count and alert list, mark one or all alerts read, and dismiss an alert where dismissal is offered.
- **ALERT-005**: Notification preferences MUST control channel and minimum severity; a disabled channel MUST produce no send attempt and MUST remain explainable as skipped.
- **ALERT-006**: Eligible high-severity P1 alerts MUST use email fallback when the user has enabled that channel; delivery status, send time, bounded retry count, and sanitized failure MUST be observable.
- **ALERT-007**: Email notifications MUST minimize sensitive financial detail and MUST never contain authentication credentials, provider tokens, or raw email content.
- **ALERT-008**: Budget-threshold, large-transaction, goal-risk, cashflow-risk, and repeated system-failure alert types MUST be operational in this release; category-spike detection, push notifications, multi-provider orchestration, and generalized event infrastructure remain outside this feature.

#### Financial goals

- **GOAL-001**: Users MUST be able to create, view, update, contribute to, and archive only their own goals with target amount, current saved amount, currency, deadline, priority, and status.
- **GOAL-002**: Remaining amount MUST equal the greater of zero and target amount minus current saved amount; required periodic saving MUST divide remaining amount across the remaining user-visible periods using a documented rounding rule.
- **GOAL-003**: Available cashflow MUST derive from the user's eligible persisted income and expense records over a documented recent observation window and MUST use the same transaction treatment and timezone rules as the dashboard.
- **GOAL-004**: Feasibility MUST compare required periodic saving with available cashflow using published deterministic bands, and MUST expose the inputs, observation window, and reason for the resulting level.
- **GOAL-005**: If the user lacks the minimum documented history, the system MUST return an insufficient-data outcome and MAY accept explicit user-provided planning inputs; it MUST NOT substitute a hidden fixed income, expense, interest, or free-cashflow value.
- **GOAL-006**: Goal calculations MUST be reproducible from persisted/user-provided inputs and MUST recalculate when a goal, contribution, or eligible underlying transaction changes.
- **GOAL-007**: Advanced scenario comparison, inferred interest rates, and AI financial advice are outside this feature; any retained prototype MUST be clearly identified and MUST not present fabricated production results.

#### Error handling and user experience

- **ERR-001**: Validation failures MUST identify actionable field errors without exposing internal implementation or sensitive data.
- **ERR-002**: Authentication and authorization failures MUST follow AUTH-002 and SEC-005 consistently in both service responses and user-facing behavior.
- **ERR-003**: Email sync and parser failures MUST preserve completed valid work, expose run/message status, and offer retry or reconnect only when appropriate.
- **ERR-004**: Database or required dependency failures MUST return a safe unavailable outcome, prevent partial financial writes where atomicity is required, and produce operator-visible diagnostic evidence.
- **ERR-005**: Every critical frontend journey MUST provide loading, empty, success, validation, authorization, dependency-failure, and retry states appropriate to the action.
- **ERR-006**: Errors and logs MUST include a correlation reference sufficient to trace a failed request or sync run without exposing secrets or raw sensitive content.

#### Runtime and operations

- **OPS-001**: A new developer MUST be able to start the required database, application service, and web interface from a clean checkout using documented commands and example configuration.
- **OPS-002**: Runtime service definitions MUST declare required dependency ordering, health criteria, restart expectations, network exposure, and persistent storage for durable data.
- **OPS-003**: Database changes MUST apply automatically or through one documented pre-start command, be repeatable on an up-to-date database, and fail without silently starting against an incompatible schema.
- **OPS-004**: Application health MUST distinguish basic process availability from readiness to serve requests with required dependencies.
- **OPS-005**: Normal shutdown and restart MUST not corrupt durable data, leave an unobservable sync state, or require deleting persistent storage.
- **OPS-006**: A release configuration MUST not depend on source-mounted development behavior, automatic dependency mutation, or undocumented local tools.
- **OPS-007**: The release checklist MUST validate configuration, database readiness, migrations, API readiness, web readiness, authentication, one transaction flow, dashboard correctness, and one duplicate-safe email sync flow.
- **OPS-008**: Operational logs MUST cover startup validation, authentication security events, sync runs, parser failures, classification decisions, alert generation/delivery, and unexpected failures with sensitive fields redacted.

#### Testing and release evidence

- **TEST-001**: Every requirement in this specification MUST map to at least one automated test, release check, or documented manual acceptance check before release approval.
- **TEST-002**: Unit tests MUST cover token/session decisions, duplicate fingerprints, parser normalization, classification priority/conflicts, budget thresholds/cooldown, dashboard totals, and goal formulas/fallbacks.
- **TEST-003**: Authorization integration tests MUST cover ordinary-user/admin boundaries and cross-user access for users, accounts, transactions, categories, budgets, goals, alerts, email connections, rules, messages, parser runs, and sync runs.
- **TEST-004**: Integration tests MUST cover registration/login/renewal/logout, transaction CRUD and recalculation, Gmail OAuth state validation, sync retry/idempotency, parser failure isolation, manual category correction, and alert lifecycle.
- **TEST-005**: End-to-end smoke tests MUST cover clean-user registration/login, manual transaction to dashboard, settings persistence, budget threshold alert, real-data goal result, and a fixture-backed email-to-transaction pipeline.
- **TEST-006**: Critical frontend tests SHOULD cover authentication transition, loading/error/retry states, transaction create/edit/delete, category correction, and protection against duplicate form submissions.
- **TEST-007**: Release approval MUST require all critical tests and clean-checkout runtime checks to pass with no unresolved critical authorization or secret-management finding.
- **TEST-008**: Test data MUST use synthetic accounts, emails, tokens, and financial records and MUST contain no real personal or production credential data.

#### Documentation

- **DOC-001**: The repository landing documentation MUST describe CashLens rather than the starter template and explain its purpose, supported MVP journeys, and known scope boundaries.
- **DOC-002**: Documentation MUST include architecture and principal data flow, prerequisites, environment setup, local development, runtime startup, service endpoints, database migration/seed, tests, build/release steps, and shutdown/restart behavior.
- **DOC-003**: Gmail setup documentation MUST cover consent scope, provider configuration, callback configuration, test-account limitations, connection/reconnect, sync behavior, and common provider errors without exposing secrets.
- **DOC-004**: Deployment notes MUST cover required production configuration, secure session/origin behavior, migrations, health verification, persistent storage, backup expectations, log redaction, and rollback considerations.
- **DOC-005**: Troubleshooting MUST cover startup/config validation, port conflicts, database readiness, migration failure, authentication/session failure, OAuth callback mismatch, provider rate limits, parser failure, and stale sync state.
- **DOC-006**: Documentation MUST provide a traceable requirement-to-test/release-check index and identify any accepted limitation remaining at MVP release.

### Key Entities

- **User and User Settings**: The authenticated owner, role/status boundary, regional settings, privacy consent, and notification preferences.
- **Session and Audit Event**: Renewable authentication state and sanitized evidence of security-sensitive actions.
- **Financial Account**: A user-owned source or destination associated with transactions.
- **Transaction and Category**: The normalized financial event and its reporting classification, source trace, duplicate/ignore status, and user correction.
- **Classification Rule and Classification Event**: A prioritized deterministic matching instruction and the immutable explanation/history of a category decision.
- **Email Connection and Listen Rule**: The encrypted provider authorization state and the user's explicit processing boundary.
- **Email Sync State, Sync Run, and Email Message**: Incremental provider position, one observable synchronization attempt, and deduplicated message metadata.
- **Parser Template and Parser Run**: Versioned extraction definition and auditable normalized success/failure result.
- **Budget**: User/category/period spending limit, effective thresholds, and calculated usage.
- **Alert, Notification Preference, and Delivery**: A triggered user-visible condition, channel consent, and observable delivery result.
- **Financial Goal and Contribution**: User-owned target, saved progress, deadline, and inputs to deterministic feasibility calculation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new developer can move from clean checkout to healthy running services and complete the documented smoke flow in 30 minutes or less without undocumented assistance.
- **SC-002**: 100% of tested cross-user and ordinary-user privilege-escalation attempts are denied, with no unauthorized state change or sensitive data disclosure.
- **SC-003**: 100% of production-start checks reject missing, empty, malformed, or known-placeholder required secrets, while no real secret is present in repository history added by this feature.
- **SC-004**: Replaying the same supported email set at least three times creates exactly one active transaction per underlying financial event and preserves an observable outcome for every attempted message.
- **SC-005**: At least 85% of valid fixture emails for each declared supported MVP parser produce the expected normalized transaction; malformed fixtures create no valid-looking transaction.
- **SC-006**: 100% of classification conflict fixtures produce the same documented winner across repeated runs, and 100% of manual corrections remain unchanged during automatic reruns unless explicitly released by the user.
- **SC-007**: Budget usage and alerts match expected results for all release fixtures involving create, update, delete, ignore, duplicate, recategory, threshold escalation, cooldown, and resolution.
- **SC-008**: Goal outputs match independently calculated expected values for positive, negative, target-complete, past-deadline, and insufficient-history cases, with zero hidden fixed financial-capacity inputs.
- **SC-009**: Dashboard income, expense, net, savings rate, category breakdown, and cashflow agree with the canonical test ledger in 100% of critical release scenarios.
- **SC-010**: At least 95% of dashboard loads for the documented personal-use data volume complete within one second under release-test conditions.
- **SC-011**: 100% of critical requirements have traceable release evidence, and all critical automated suites pass before MVP approval.
- **SC-012**: In usability acceptance, at least 90% of representative first-time users complete registration, one transaction, dashboard review, and one settings change without assistance.
- **SC-013**: All required runtime services recover from a normal restart without loss of committed financial data or creation of duplicate transactions.
- **SC-014**: The repository documentation contains every topic in DOC-001 through DOC-006 and has no remaining starter-template instructions presented as CashLens setup guidance.

## Assumptions

- The existing modular application, relational persistence model, migration history, frontend screens, and service boundaries are retained unless a requirement cannot be met safely within them.
- The operational MVP serves individual users and a small controlled deployment; enterprise multi-tenancy, high-volume distributed processing, and financial-institution certification are not implied.
- Email/password authentication and Gmail read-only OAuth remain the supported MVP authentication/integration methods; Outlook is not required for this feature.
- MVP parser support may be limited to the bank/template fixtures explicitly declared in release documentation; unsupported banks must fail safely and visibly.
- Manual, user-triggered, bounded Gmail synchronization is acceptable for MVP. Scheduled/background synchronization is optional unless required to satisfy the lifecycle outcomes in EMAIL-005 through EMAIL-009.
- All PRD P1 capabilities are included in the Operational MVP: budgets, budget/large-transaction/goal-risk/cashflow-risk/system-error alerts, in-app notification, preference-controlled email fallback, financial goals, and deterministic feasibility calculation.
- Advanced goal scenario comparison, ML classification, LLM insights, push notifications, Novu, direct bank APIs, CSV/SMS imports, trading, automated transfers, microservices, Kubernetes, Kafka, complex event-driven infrastructure, and premature generalized abstractions are out of scope.
- Financial amounts use exact decimal semantics and deterministic business rules. AI output, if retained elsewhere, cannot calculate or override release-critical financial values.
- Multi-currency aggregation is not required unless an authoritative conversion source is explicitly added; otherwise incompatible currencies remain separated or excluded with a visible explanation.
- The PRD/SRS remains a planning draft; where it conflicts with verified working behavior, the conflict table in this specification controls this feature until stakeholders approve a different resolution.

## Definition of Done

The feature is complete only when all of the following are true:

1. A new developer can configure and start CashLens from a clean checkout using documented instructions.
2. Required services, persistence, migrations, readiness checks, and normal restart behavior pass the release checklist.
3. Registration, login, renewal, logout, and own-profile/settings flows work with correct authorization outcomes.
4. Every protected resource enforces owner or administrator boundaries, and privileged-field escalation is closed.
5. Transaction create, edit, category correction, ignore/duplicate treatment, and soft deletion work and recalculate dependent views.
6. Dashboard core figures come only from eligible persisted user data and match the canonical release ledger.
7. Budget usage and all P1 alert types are deterministic, duplicate-safe, cooldown-aware, and recalculated after relevant changes; in-app and enabled email delivery states are observable.
8. Goal calculations contain no fake production financial capacity and provide reproducible results or an explicit insufficient-data state.
9. Gmail authorization is read-only, tokens are protected, sync lifecycle is observable, and retries are incremental and duplicate-safe.
10. Classification rules, conflicts, fallback, correction history, and manual-override protection behave deterministically.
11. Required secrets are externally configured, placeholders fail fast in production, and no real secret is committed.
12. API, dependency, validation, authentication, empty, loading, and retry failures have safe and actionable behavior.
13. Critical automated tests and clean-checkout smoke checks pass and are traceable to requirement IDs.
14. Runtime configuration is validated for development and release use without unnecessary infrastructure.
15. Repository documentation describes the actual CashLens application and every required operating procedure.
16. Every PRD/SRS MVP requirement is implemented or has an explicit, approved status and disposition in this specification.
