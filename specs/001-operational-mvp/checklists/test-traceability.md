# Requirement-to-test traceability (T098)

**Scope:** every AUTH, SEC, CFG, TX, DASH, EMAIL, CLASS, BUDGET, ALERT, and GOAL requirement in `spec.md` (TEST-001, SC-011).

**How this was built:**
- A scan lists every test file, colocated unit spec, web component test, browser spec, and release script that names the requirement id in its code, including ranges such as `ALERT-004–ALERT-008`.
- A file is listed only when it actually cites the id, so no row claims evidence that does not exist.
- Four requirements whose main evidence does not cite the id text are mapped by hand: CFG-001, CFG-002, CFG-004, and TX-001. They are marked *curated*.

**Test types:**
- *unit*: Jest, `apps/api/src/**/*.spec.ts`.
- *integration*: API end-to-end against a real PostgreSQL test database, `apps/api/test/*.e2e-spec.ts`.
- *component*: Vitest with Testing Library, `apps/web/src/**/*.test.tsx`.
- *e2e*: Playwright against the development compose stack, `apps/web/e2e/*.spec.ts`.
- *release*: release scripts, whose results are recorded in `release-evidence.md`.

**Status:**
- **Covered:** at least one automated test or release check exists and passed in the latest run recorded in `release-evidence.md`.
- **Covered (release-gated):** the only evidence is a release script that must run on the reference release host.

## AUTH

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| AUTH-001 | The system MUST allow a visitor to register, sign in, retrieve their own identity, renew an eligible session, sign out the current session, and… | `apps/api/test/auth-session.e2e-spec.ts` (integration) | Covered |
| AUTH-002 | An expired or invalid session MUST produce a consistent unauthorized outcome; the client MUST either renew once safely or return the user to… | `apps/api/test/auth-session.e2e-spec.ts` (integration) | Covered |
| AUTH-003 | Authentication cookies or equivalent session credentials MUST use production-appropriate confidentiality, transport, scope, and cross-origin… | `apps/api/test/auth-session.e2e-spec.ts` (integration)<br>`scripts/verify-release.ps1` (release) | Covered |
| AUTH-004 | Authentication failure messages MUST not reveal whether an email address, token, or account exists beyond what is necessary for the user action. | `apps/api/test/auth-session.e2e-spec.ts` (integration) | Covered |
| AUTH-005 | Security-relevant authentication events MUST be auditable without recording passwords, raw tokens, or secrets. Disabled, pending-deletion, and… | `apps/api/test/admin-bootstrap.e2e-spec.ts` (integration)<br>`apps/api/test/audit-evidence.e2e-spec.ts` (integration)<br>`apps/api/test/auth-session.e2e-spec.ts` (integration) | Covered |

## SEC

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| SEC-001 | Every user-owned financial, email, planning, alert, and settings operation MUST derive ownership from the authenticated identity and MUST prevent… | `apps/api/test/ownership-email-pipeline.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-finance-core.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-planning-alerts.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-users-settings.e2e-spec.ts` (integration) | Covered |
| SEC-002 | Ordinary users MUST NOT list arbitrary users, create privileged users, or read/update/delete another user account. | `apps/api/test/admin-authorization.e2e-spec.ts` (integration)<br>`apps/api/test/app.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-users-settings.e2e-spec.ts` (integration) | Covered |
| SEC-003 | Only an explicitly authorized administrator MAY manage user account identity, role/status, supported bank providers/senders, and parser templates.… | `apps/api/test/admin-authorization.e2e-spec.ts` (integration)<br>`apps/api/test/app.e2e-spec.ts` (integration) | Covered |
| SEC-004 | Ordinary user input MUST NOT modify role, account status, ownership identifiers, system classification provenance, or other privileged fields.… | `apps/api/test/admin-authorization.e2e-spec.ts` (integration)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| SEC-005 | Missing authentication MUST return an unauthorized outcome; valid authentication without sufficient permission MUST return a forbidden outcome;… | `apps/api/test/admin-authorization.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-email-pipeline.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-finance-core.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-planning-alerts.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-users-settings.e2e-spec.ts` (integration) | Covered |
| SEC-006 | Sensitive actions including email connect/disconnect/sync, privileged changes, category corrections, and destructive financial-data actions MUST… | `apps/api/test/audit-evidence.e2e-spec.ts` (integration)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| SEC-007 | Automated authorization tests MUST cover horizontal access, vertical privilege escalation, mass assignment, deleted/disabled users, and malformed… | `apps/api/test/admin-authorization.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-email-pipeline.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-finance-core.e2e-spec.ts` (integration) | Covered |
| SEC-008 | Administrator status MUST NOT grant access to user-owned transactions, financial accounts, categories, budgets, goals, alert contents, email… | `apps/api/test/ownership-email-pipeline.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-finance-core.e2e-spec.ts` (integration)<br>`apps/api/test/ownership-planning-alerts.e2e-spec.ts` (integration) | Covered |
| SEC-009 | The first administrator MUST be provisioned only by an operator-run, non-network provisioning step that requires host and database access to the… | `apps/api/test/admin-bootstrap.e2e-spec.ts` (integration)<br>`scripts/verify-release.ps1` (release) | Covered |

## CFG

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| CFG-001 | Production startup MUST reject missing, empty, malformed, or known-placeholder values for every required authentication, encryption,… | `apps/api/src/config/configuration.spec.ts` (unit, curated): production rejects missing, empty, malformed, and known-placeholder required values, and http origins<br>`apps/api/test/log-redaction.e2e-spec.ts` (integration, curated): the real entry point with an invalid production configuration exits with one app.start_failed event naming variables, never values<br>`scripts/verify-release.ps1` (release, curated): the release image refuses to start with an http:// CORS_ORIGIN<br>`scripts/scan-secrets.ps1` (release, curated): the placeholder list equals the scanner allowlist | Covered |
| CFG-002 | No real secret, token, credential, private key, or production connection string MAY be committed to the repository, examples, generated… | `scripts/scan-secrets.ps1` (release, curated): T009 gitleaks scan (pinned image digest) of the working tree and the branch history; fails on any finding<br>`apps/api/test/log-redaction.e2e-spec.ts` (integration, curated): the production log carries no password, token, cookie, OAuth value, or configured secret (T095)<br>`apps/api/src/common/logging/logger.spec.ts` (unit, curated): the logger redacts tokens, keys, credentials, raw bodies, and payloads (T094)<br>`apps/api/src/config/env-example.spec.ts` (unit, curated): secret settings in .env.example hold only placeholders (T098) | Covered |
| CFG-003 | The environment example MUST enumerate every supported setting, identify whether it is required or optional, state its expected format without… | `apps/api/src/config/env-example.spec.ts` (unit) | Covered |
| CFG-004 | Development and production behavior MUST be explicitly distinguishable for secure transport, session handling, allowed origins, callback URLs,… | `apps/api/src/config/configuration.spec.ts` (unit, curated): development accepts documented placeholders; production rejects them, requires https origins and callbacks, and forbids insecure cookies and the log email transport<br>`apps/api/test/auth-session.e2e-spec.ts` (integration, curated): "development mode" vs "production mode" suites: HTTPS_REQUIRED, Secure cookies, TRUST_PROXY hops<br>`apps/api/test/e2e-harness.e2e-spec.ts` (integration, curated): the real entry point starts in production mode with validated settings | Covered |
| CFG-005 | Token-encryption configuration MUST be validated before encrypted values are written or read, and changing key material MUST have a documented… | `apps/api/src/config/configuration.spec.ts` (unit) | Covered |
| CFG-006 | Release verification MUST run one deterministic, version-pinned secret scan that covers: | `scripts/scan-secrets.ps1` (release): release secret scan<br>`scripts/verify-release.ps1` (release) | Covered (release-gated) |
| CFG-007 | A deployment MAY run with email delivery disabled. When email delivery is enabled, every transport setting it requires MUST be validated at… | `apps/api/src/config/configuration.spec.ts` (unit)<br>`apps/api/src/modules/alerts/delivery/alert-delivery.service.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration) | Covered |

## TX

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| TX-001 | Users MUST be able to list, search, filter, create, inspect, edit, categorize, ignore, mark duplicate, and soft-delete only their own transactions. | `apps/api/test/app.e2e-spec.ts` (integration, curated): transaction list, search, filters, create, read, edit<br>`apps/api/test/transactions-validation.e2e-spec.ts` (integration, curated): create/edit validation, ignore, duplicate, soft delete<br>`apps/api/test/ownership-finance-core.e2e-spec.ts` (integration, curated): owner-only access to every transaction route (owner-safe 404)<br>`apps/api/test/classification.e2e-spec.ts` (integration, curated): categorize, correct, reclassify<br>`apps/web/src/features/transactions/TransactionsPage.test.tsx` (component, curated): create, edit, category correction, reclassify, delete from the page | Covered |
| TX-002 | Transaction validation MUST reject invalid amounts, currencies, directions, timestamps, relationships, and ownership references with field-level… | `apps/api/test/transactions-validation.e2e-spec.ts` (integration) | Covered |
| TX-003 | Income, expense, transfer, duplicate, ignored, pending, and deleted states MUST have one documented treatment used consistently by transaction… | `apps/api/src/common/finance/financial-period-policy.spec.ts` (unit)<br>`apps/api/test/goals.e2e-spec.ts` (integration)<br>`apps/api/test/transactions-dashboard.e2e-spec.ts` (integration) | Covered |
| TX-004 | A manual category correction MUST be retained as the authoritative category until the user explicitly requests another correction or reclassification. | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| TX-005 | Mutating a transaction MUST trigger or make available deterministic recalculation of every affected current summary and budget period. | `apps/api/test/transactions-dashboard.e2e-spec.ts` (integration) | Covered |

## DASH

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| DASH-001 | Monthly dashboard results MUST derive from the authenticated user's persisted eligible records and include total income, total expense, net… | `apps/api/src/common/finance/financial-period-policy.spec.ts` (unit)<br>`apps/api/test/transactions-dashboard.e2e-spec.ts` (integration) | Covered |
| DASH-002 | Dashboard period boundaries MUST honor the user's timezone and configured month-start rule. | `apps/api/src/common/finance/financial-period-policy.spec.ts` (unit)<br>`apps/api/src/modules/goals/goals.service.spec.ts` (unit)<br>`apps/api/test/transactions-dashboard.e2e-spec.ts` (integration)<br>`apps/api/test/transactions-validation.e2e-spec.ts` (integration) | Covered |
| DASH-003 | Identical eligible source records and period settings MUST always produce identical dashboard totals independent of any AI-generated content. | `apps/api/src/common/finance/financial-period-policy.spec.ts` (unit)<br>`apps/api/test/transactions-dashboard.e2e-spec.ts` (integration) | Covered |
| DASH-004 | On the reference benchmark, at least 95% of dashboard loads MUST return complete monthly results within one second. The reference benchmark is… | `apps/api/test/benchmark/dashboard-bench.e2e-spec.ts` (integration) | Covered |

## EMAIL

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| EMAIL-001 | Gmail connection MUST use explicit read-only authorization, MUST never request or store the user's email password, and MUST allow disconnect and… | `apps/api/src/modules/email-connections/gmail-oauth.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-002 | Provider access and renewal credentials MUST be encrypted at rest and MUST never appear in user-visible errors, application logs, audit metadata,… | `apps/api/src/common/logging/logger.spec.ts` (unit)<br>`apps/api/src/modules/email-connections/gmail-oauth.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration)<br>`apps/api/test/log-redaction.e2e-spec.ts` (integration): captured production log | Covered |
| EMAIL-003 | Users MUST be able to view connection identity, status, last successful synchronization, latest failure, and required recovery action. | `apps/api/src/modules/email-connections/gmail-oauth.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-004 | Users MUST control enabled listen rules by owned connection, supported bank/sender, subject/body criteria, and synchronization start boundary;… | `apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-005 | Each sync run MUST expose a lifecycle with start/end times, trigger, status, counts found/matched/parsed/created/failed, and a sanitized failure… | `apps/api/src/modules/email-ingestion/sync-policy.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-006 | Synchronization MUST be incremental after the initial bounded import and MUST persist enough provider progress to resume without rereading the… | `apps/api/src/modules/email-ingestion/sync-policy.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-007 | Concurrent or retried synchronization for the same connection MUST be safe and MUST NOT create more than one active transaction for the same… | `apps/api/src/modules/email-ingestion/email-ingestion.service.spec.ts` (unit)<br>`apps/api/src/modules/email-ingestion/sync-policy.spec.ts` (unit)<br>`apps/api/src/modules/parser/parser-engine.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-008 | Duplicate detection MUST use stable provider identity first, transaction identity when available, and a documented deterministic fallback… | `apps/api/src/modules/email-ingestion/email-ingestion.service.spec.ts` (unit)<br>`apps/api/src/modules/parser/parser-engine.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-009 | Transient provider failures and rate limits MUST use bounded retry with backoff or an equivalent user-safe retry policy; permanent message errors… | `apps/api/src/modules/email-ingestion/gmail-api.service.spec.ts` (unit)<br>`apps/api/src/modules/parser/parser-engine.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |
| EMAIL-010 | Parser selection MUST be deterministic by supported bank, channel, active version, and effective status, and every parse attempt MUST retain a… | `apps/api/src/modules/parser/parser-engine.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration)<br>`apps/api/test/parser-fixture-rates.e2e-spec.ts` (integration) | Covered |
| EMAIL-011 | Invalid or incomplete parser output MUST NOT create a posted financial transaction and MUST leave the message in an observable failed or… | `apps/api/src/modules/parser/parser-engine.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration)<br>`apps/api/test/parser-fixture-rates.e2e-spec.ts` (integration) | Covered |
| EMAIL-012 | Operational MVP MUST NOT persist raw email bodies, even when an existing preference suggests otherwise; it MAY retain only the minimum message… | `apps/api/src/modules/parser/parser-engine.service.spec.ts` (unit)<br>`apps/api/test/email-ingestion.e2e-spec.ts` (integration)<br>`apps/api/test/raw-body-preference.e2e-spec.ts` (integration)<br>`apps/web/e2e/operational-mvp.spec.ts` (e2e) | Covered |
| EMAIL-013 | Operational MVP MUST support user-triggered manual synchronization and a bounded initial backfill; automatic scheduled synchronization, a… | `apps/api/test/email-ingestion.e2e-spec.ts` (integration) | Covered |

## CLASS

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| CLASS-001 | The system MUST support active user-owned and system-owned classification rules based on documented transaction attributes, with an explicit… | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| CLASS-002 | Rule evaluation MUST protect an eligible manual correction first, then select the matching user rule with the highest numeric priority, then the… | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| CLASS-003 | Exactly one category outcome and one classification source MUST be selected per evaluation; conflicting matches MUST be explainable from the… | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| CLASS-004 | When no rule matches, the transaction MUST use an explicit uncategorized/review-required fallback rather than an arbitrary category. | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| CLASS-005 | Every applied or corrected category MUST record previous category, new category, source, matched rule when applicable, actor, reason, and time. | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| CLASS-006 | Automatic reclassification MUST NOT overwrite a manual correction; explicit user-requested reclassification MUST disclose that the manual result… | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |
| CLASS-007 | ML and LLM classification MUST NOT be required for this feature and MUST NOT influence release-critical deterministic calculations. | `apps/api/src/modules/transactions/classification.service.spec.ts` (unit)<br>`apps/api/test/classification.e2e-spec.ts` (integration) | Covered |

## BUDGET

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| BUDGET-001 | Users MUST be able to create, view, update, and archive an owned budget for one category (or all expense categories) and period with a valid… | `apps/api/src/modules/budgets/budget-threshold.policy.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration) | Covered |
| BUDGET-002 | Except for non-monthly budgets, which BUDGET-005 governs explicitly, budget usage MUST be derived from eligible persisted expense transactions… | `apps/api/src/common/finance/budget-spend.query.spec.ts` (unit)<br>`apps/api/src/common/finance/financial-period-policy.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/budget-threshold.evaluator.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration) | Covered |
| BUDGET-003 | Budget usage MUST be evaluated after relevant transaction creation, update, deletion, duplicate/ignore change, category change, budget creation or… | `apps/api/src/modules/alerts/evaluators/budget-threshold.evaluator.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration) | Covered |
| BUDGET-004 | A budget stored before this release with a threshold of 100 or more: | `apps/api/src/modules/budgets/budget-threshold.policy.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration) | Covered |
| BUDGET-005 | Budget alert evaluation in this release covers MONTHLY budgets only. Budgets with a WEEKLY, YEARLY, or CUSTOM period: | `apps/api/src/common/finance/budget-spend.query.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/budget-threshold.evaluator.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration) | Covered |

## ALERT

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| ALERT-001 | Every evaluator-created alert MUST be owned by the affected user and MUST record: | `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-002 | A condition identity consists of the user, alert type, target, severity tier, and the period instance where ALERT-009 defines one. At most one… | `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts` (unit)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-003 | At each evaluation, the system MUST: | `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts` (unit) | Covered |
| ALERT-004 | Users MUST be able to see unread count and alert list, filter alerts by lifecycle status, mark one or all alerts read, and dismiss an open alert. | `apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-005 | Delivery defaults and email eligibility: | `apps/api/src/modules/alerts/delivery/alert-delivery.service.spec.ts` (unit)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-006 | Email delivery MUST start only after the alert is durably recorded. It MUST NOT roll back or hide the in-app alert, and MUST NOT delay the… | `apps/api/src/modules/alerts/delivery/alert-delivery.service.spec.ts` (unit)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-007 | An email notification MUST only state that a new critical CashLens alert of a named type exists and link to the application. It MUST NOT contain… | `apps/api/src/common/logging/logger.spec.ts` (unit)<br>`apps/api/src/modules/alerts/delivery/alert-delivery.service.spec.ts` (unit)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-008 | The following alert types MUST be operational in this release exactly as defined in ALERT-009: | `apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-009 | Each MVP alert type MUST follow the Alert Trigger Matrix below. Common rules apply to every row: | `apps/api/src/modules/alerts/evaluators/budget-threshold.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/cashflow-risk.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/goal-risk.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/large-transaction.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/reconnect-required.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/sync-failure.evaluator.spec.ts` (unit)<br>`apps/api/test/alerts-budget.e2e-spec.ts` (integration)<br>`apps/api/test/alerts-cashflow-risk.e2e-spec.ts` (integration)<br>`apps/api/test/alerts-goal-risk.e2e-spec.ts` (integration)<br>`apps/api/test/alerts-large-transaction.e2e-spec.ts` (integration)<br>`apps/api/test/alerts-reconnect.e2e-spec.ts` (integration)<br>`apps/api/test/alerts-sync-failure.e2e-spec.ts` (integration) | Covered |
| ALERT-010 | Alert lifecycle and read state MUST be independent: | `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts` (unit)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |
| ALERT-011 | Alerts that exist before this release MUST remain readable as `ACTIVE` with no condition identity and MUST NOT be resolved by evaluators. Alerts… | `apps/api/src/modules/alerts/alert-lifecycle.service.spec.ts` (unit)<br>`apps/api/test/alerts-lifecycle-delivery.e2e-spec.ts` (integration) | Covered |

## GOAL

| Requirement | Summary | Evidence (type) | Status |
|---|---|---|---|
| GOAL-001 | Users MUST be able to create, view, update, contribute to, and archive only their own goals with target amount, current saved amount, currency,… | `apps/api/test/goals.e2e-spec.ts` (integration) | Covered |
| GOAL-002 | Remaining amount and required monthly saving MUST be computed as follows, with all months being user months (DASH-002): | `apps/api/src/modules/alerts/evaluators/goal-risk.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/goals/goals.service.spec.ts` (unit)<br>`apps/api/test/alerts-goal-risk.e2e-spec.ts` (integration) | Covered |
| GOAL-003 | Available cashflow MUST be computed as follows: | `apps/api/src/common/finance/financial-period-policy.spec.ts` (unit)<br>`apps/api/src/modules/alerts/evaluators/cashflow-risk.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/goals/goals.service.spec.ts` (unit) | Covered |
| GOAL-004 | Feasibility score MUST equal available monthly cashflow multiplied by 100 and divided by required monthly saving, rounded down to an integer,… | `apps/api/src/modules/alerts/evaluators/goal-risk.evaluator.spec.ts` (unit)<br>`apps/api/src/modules/goals/goals.service.spec.ts` (unit)<br>`apps/api/test/alerts-goal-risk.e2e-spec.ts` (integration) | Covered |
| GOAL-005 | If the user has fewer than two completed months of eligible history, the system MUST return an insufficient-data outcome and MAY accept an… | `apps/api/src/modules/goals/goals.service.spec.ts` (unit) | Covered |
| GOAL-006 | Goal calculations MUST be reproducible from persisted/user-provided inputs and MUST recalculate when a goal, contribution, or eligible underlying… | `apps/api/src/modules/goals/goals.service.spec.ts` (unit)<br>`apps/api/test/goals.e2e-spec.ts` (integration) | Covered |
| GOAL-007 | Advanced scenario comparison, inferred interest rates, and AI financial advice are outside this feature; any retained prototype MUST be clearly… | `apps/api/src/modules/goals/goals.service.spec.ts` (unit) | Covered |

## Totals

- Requirements: 73. With automated evidence: 73. Without: 0.
- AUTH: 5 requirements, 5 covered.
- SEC: 9 requirements, 9 covered.
- CFG: 7 requirements, 7 covered.
- TX: 5 requirements, 5 covered.
- DASH: 4 requirements, 4 covered.
- EMAIL: 13 requirements, 13 covered.
- CLASS: 7 requirements, 7 covered.
- BUDGET: 5 requirements, 5 covered.
- ALERT: 11 requirements, 11 covered.
- GOAL: 7 requirements, 7 covered.

**Gates this file depends on, all still in place:**
- the per-parser rate gate (`parser-fixture-rates.e2e-spec.ts`, `docs/operations/supported-parsers.md`);
- the exactly-3 Gmail replay (`email-ingestion.e2e-spec.ts`);
- the dashboard benchmark tooling (`apps/api/test/benchmark/*`);
- the ALERT-009 matrix suites (`alerts-*.e2e-spec.ts`, one per row);
- the T099 browser smoke flow (`apps/web/e2e/operational-mvp.spec.ts`), which runs the TEST-005 journeys end to end: registration and login, transaction to dashboard, settings, budget alert, goal feasibility, and a fixture-backed email import. Rows cite it only where the spec names the requirement id (EMAIL-012);
- the goal worked examples (`goals.service.spec.ts`, `goals.e2e-spec.ts`, shared fixtures in `apps/api/test/fixtures/builders/worked-examples.ts`).
