# Data Model: Operational CashLens MVP

This document describes deltas to the existing Prisma model. Existing entities and IDs remain authoritative; migrations are additive/expand-first.

## Existing entities retained

- `User`, `UserSettings`, `RefreshToken`, `AuditLog`: identity, preferences, sessions, security evidence.
- `FinancialAccount`, `Transaction`, `TransactionCategory`: owner-scoped finance core.
- `EmailConnection`, `EmailListenRule`, `EmailSyncRun`, `EmailMessage`, `ParserTemplate`, `ParserField`, `ParserRun`: Gmail-to-transaction pipeline.
- `MerchantRule`: classification patterns and priority.
- `Budget`, `Alert`, `AlertSetting`, `Goal`: planning and notification features.

## Shared invariants

- All private records derive `userId` from authentication; request bodies cannot assign ownership.
- Admin role never bypasses private-resource ownership. Role checks read the persisted `User.role`/`User.status` on each request, not a token claim, so promotion or disablement takes effect on the next request.
- Normal calculations include only posted, non-deleted, non-ignored, non-duplicate income/expense records. Transfers are shown but excluded from income/expense/net. Currency groups are never silently summed.
- Time periods use the user's IANA timezone and month-start preference. Store timestamps in UTC.
- Raw Gmail body is transient only. Persist metadata, body hash, sanitized parser evidence, and derived transaction.

## Administrator provisioning (SEC-009) — no schema change

Uses existing `User.role` (`USER|ADMIN`), `User.status`, `User.deletedAt`, and `AuditLog`.

Provisioning transaction (one database transaction, serialized with `pg_advisory_xact_lock` on a fixed key so concurrent runs cannot both promote):

1. Load the target by normalized email; refuse if it is missing, `status != ACTIVE`, `deletedAt` is set, or it has no `passwordHash` (not self-registered, for example an account created by an administrator). All four refusals share exit code 2.
2. If the target's `role = ADMIN`, return `ALREADY_ADMIN` and write no audit row.
3. Count users with `role = ADMIN`, `status = ACTIVE`, and `deletedAt IS NULL`; if the count is above 0, refuse with `ADMIN_EXISTS`.
4. Set `role = ADMIN` and insert an `AuditLog` row with `actorType = SYSTEM`, `action = ADMIN_BOOTSTRAP_GRANTED`, `resourceType = user`, and `resourceId = <userId>`. The `metadata` is `{ "source": "cli" }` only: no email, password, host secrets, or environment values.

No password, hash, token, or default account is created, and no row is seeded by migration.

**Upgrade review of existing administrators.** Earlier releases let any user set `role = ADMIN` through `PATCH /users/:id` or `POST /users`. The same operator-only script therefore offers two more modes:

- `--list-admins` is read-only. It prints ID, email, status, `createdAt`, and `lastLoginAt`, and never credentials.
- `--revoke --email <email>` runs in the same advisory-locked transaction. It sets `role = USER` and writes an `AuditLog` row with `actorType = SYSTEM`, `action = ADMIN_ROLE_REVOKED`, and `metadata = { "source": "cli" }`.

Revoking the last active administrator returns the deployment to the zero-admin state, where bootstrap is allowed again. **Pending decision:** operator review is the default. The alternative is an automatic one-time demote-all at upgrade, written as audited rows by an explicit script and never silently inside a migration.

## Account status and audit evidence (US1) — no schema change

**Account status.** Only `status = ACTIVE` with `deletedAt IS NULL` can sign in, renew a session, or use an existing session. `DISABLED` and `PENDING_DELETE` are both treated as inactive. Setting a non-`ACTIVE` status or soft-deleting an account through the administrator API also revokes its refresh tokens.

**Audit events.** All rows use the existing `AuditLog` table. `userId` is the actor (null for `SYSTEM`), and `metadata` holds only identifiers, counts, statuses, roles, the email provider name, the change source (`cli`), and changed field names; never a password, token, cookie, mailbox address, or email content (SEC-006, AUTH-005). Request metadata is bounded: `ipAddress` at most 64 and `userAgent` at most 255 characters.

| Action | actorType | resourceType | metadata |
|---|---|---|---|
| `REGISTER`, `LOGIN` | USER | `users` | none |
| `LOGIN_FAILED` (existing accounts with a password only, including inactive ones; `userId` is the account whose sign-in failed; an unknown email writes no row) | USER | `users` | none |
| `REFRESH_TOKEN`, `LOGOUT`, `LOGOUT_ALL` | USER | `refresh_tokens` | none |
| `ADMIN_USER_CREATED` | ADMIN | `user` | `role`, `status` |
| `ADMIN_USER_UPDATED` | ADMIN | `user` | `fields` (names), new `role`/`status` when set |
| `ADMIN_USER_DELETED` | ADMIN | `user` | none |
| `USER_PROFILE_UPDATED`, `USER_SETTINGS_UPDATED` | USER | `user` | `fields` (names only) |
| `ADMIN_BOOTSTRAP_GRANTED`, `ADMIN_ROLE_REVOKED` | SYSTEM | `user` | `{ "source": "cli" }` |
| `EMAIL_CONNECTED` | USER | `email_connection` | `provider` |
| `EMAIL_DISCONNECTED` | USER | `email_connection` | none |
| `EMAIL_SYNC` | USER | `email_connection` | `syncRunId`, `status`, counts |
| `TRANSACTION_CATEGORY_CORRECTED` | USER | `transaction` | `fromCategoryId`, `toCategoryId` |
| `TRANSACTION_DELETED` | USER | `transaction` | none |
| `FINANCIAL_ACCOUNT_ARCHIVED` | USER | `financial_account` | none |
| `TRANSACTION_CATEGORY_ARCHIVED` | USER | `transaction_category` | none |

## Proposed schema deltas

### EmailConnection progress (DB-M1)

Add nullable fields such as `syncCursor`, `backfillFrom`, `backfillCompletedAt`, `syncLeaseToken`, and `syncLeaseExpiresAt`. Exact provider cursor representation stays opaque.

State: `ACTIVE -> EXPIRED|REVOKED|ERROR` using the existing `EmailConnectionStatus` enum. Reconnect returns to `ACTIVE`. Only a provider-authorization failure (expired/revoked grant, failed renewal) enters a reconnect-required state that feeds the `CRITICAL` reconnect-required alert. A user-initiated disconnect is recorded distinctly and never alerts. Acquiring a non-expired lease for an active run fails with conflict. Disconnect clears or cryptographically invalidates encrypted credentials while retaining sanitized history.

### EmailSyncRun lifecycle (DB-M1)

Retain the existing `EmailSyncStatus` values `RUNNING`, `SUCCESS`, `PARTIAL_FAILED`, and `FAILED`, and add one value, `EXPIRED`, for a run whose lease expired before it reached a terminal state. Retain the existing counters (`emailsFound`, `emailsMatched`, `emailsParsed`, `transactionsCreated`) and `errorMessage`.

Add:

- `emailsFailed Int @default(0)`
- `hasMore Boolean @default(false)`
- nullable continuation and cursor evidence
- lease association, if absent

Every started run must end `SUCCESS`, `PARTIAL_FAILED`, or `FAILED`, or be recovered as `EXPIRED`.

The repeated-sync-failure alert counts `FAILED`, `EXPIRED`, and `PARTIAL_FAILED` as failures, and only `SUCCESS` resolves it. The new enum value must not be used inside the same migration that adds it.

### Transaction deduplication (DB-M2)

Add nullable `deduplicationFingerprint` and a strategy/evidence field if existing metadata is insufficient. Owner-scoped uniqueness applies when a fingerprint exists.

Resolution order:

1. `(emailConnectionId, providerMessageId)` prevents message reprocessing.
2. `(userId, normalized externalTransactionId/transactionCode)` identifies provider transaction identity.
3. `(userId, deterministic fingerprint)` covers missing transaction identity.

Invalid parser output remains observable but cannot create a posted transaction.

### MerchantRule ownership (DB-M3)

Change `userId` from required to nullable: non-null means user rule; null means system rule. A database/application invariant requires system rules to target a system category and user rules to target an allowed user/system category. Order by scope precedence, numeric priority descending, `createdAt` ascending, then stable `id` ascending.

### TransactionCategoryEvent (new, DB-M3)

| Field | Meaning |
|---|---|
| `id` | Stable event ID |
| `transactionId`, `userId` | Owned transaction and owner |
| `previousCategoryId`, `newCategoryId` | Nullable before/after category |
| `source` | MANUAL, USER_RULE, SYSTEM_RULE, FALLBACK |
| `merchantRuleId` | Winning rule when applicable |
| `actorUserId` | User actor for manual/reclassification action |
| `reason` | Sanitized human/test-visible reason |
| `createdAt` | Immutable decision time |

Events are append-only. A transaction with authoritative manual classification is not automatically overwritten. Explicit reclassification appends a new event and updates current classification atomically.

### Budget thresholds (BUDGET-001, BUDGET-004): no schema change

- `Budget.thresholdPercent Int @default(80)` is the configurable **warning** threshold. The **critical** threshold is the constant 100 and is not stored. No `BudgetThreshold` table is added.
- Write validation (create/update DTO) changes from `1–200` to `1–99`. A value of 100 or more on a write returns a 400 field error. This is an intentional validation tightening.
- Legacy rows with `thresholdPercent >= 100` are not rewritten, and no CHECK constraint is added because legacy rows would violate it. For these rows the evaluator treats the warning condition as absent and evaluates only critical, and the API reports `warningThresholdActive: false`.
- `usage.isNearThreshold` and `GET /budgets/alerts` remain read-only projections. They call the same pure threshold function the evaluator uses (`percentUsed >= thresholdPercent` when `thresholdPercent <= 99`, otherwise `percentUsed >= 100`) and never write alerts.

### Budget period instances (BUDGET-002, BUDGET-005): no schema change

- **Alert evaluation covers `period = MONTHLY` only.** The period instance for an evaluated instant `t` is the user month containing `t`, computed by the shared period policy from `User.timezone` and `UserSettings.defaultMonthStartDay`.
  - `instanceStart` is the local month-start day at 00:00 in the user's timezone, stored in UTC.
  - `instanceEnd` is the next instance's start, exclusive.
  - **Budget date semantics, for every period type including `CUSTOM`.** `startsAt` and `endsAt` are **user-local calendar dates**, and the end date is inclusive. Their UTC bounds are:
    - `activeFrom` is `startsAt`'s local date at 00:00 in the user's timezone.
    - `activeUntil` is **the day after** `endsAt`'s local date, at 00:00 in the user's timezone, exclusive. It is unbounded when `endsAt` is null.

    For example, a budget with `endsAt` on 2026-09-30 in `Asia/Ho_Chi_Minh` has `activeUntil` = 2026-10-01T00:00+07:00, which is 2026-09-30T17:00Z.
  - An instance exists only if `activeFrom < instanceEnd` and `activeUntil > instanceStart`.
  - Usage counts eligible expenses with `occurredAt` in `[max(instanceStart, activeFrom), min(instanceEnd, activeUntil))`.
- **Condition-key period component.** It is the local ISO date of `instanceStart` (`YYYY-MM-DD` in the user's timezone). For example, with month-start day 25, the instance containing 2026-09-23 starts `2026-08-25`.
- **Other period types (`WEEKLY`, `YEARLY`, `CUSTOM`).**
  - They stay accepted on create/update, with no validation change.
  - They are skipped by the budget evaluator.
  - Responses carry the additive field `alertsSupported: false`, and `true` for MONTHLY budgets.
  - The `usage` object keeps the existing calendar-month projection and carries the additive field `usageBasis: "CALENDAR_MONTH_APPROXIMATION"`; MONTHLY budgets report `"PERIOD_INSTANCE"`. A CUSTOM budget's `startsAt`/`endsAt` still follow the user-local date semantics above wherever they bound a query.
  - Any open alert rows are left untouched; none can exist, because no evaluator runs for these types.
- **Shared spend aggregate.** It lives in `apps/api/src/common/finance/budget-spend.query.ts`, a Prisma-backed helper, and is consumed by both `budgets.service.ts` and the alert inputs query, so neither module imports the other.

### AlertSetting (existing; no data migration)

- `inAppEnabled` defaults to `true` per type. Setting it to `false` stops new occurrences of that type, while open occurrences are still resolved.
- `emailEnabled = true` requires `inAppEnabled = true` for the same type on **writes**. The API rejects the combination with 400, and the settings UI disables the email toggle while in-app is off. A legacy row that already combines in-app off with email on is harmless, because no alert and therefore no email is created when in-app is off.
- `emailEnabled` defaults to `false` for every type in **newly created** settings. `defaultAlertSettings()` currently sets `true` for `BUDGET_THRESHOLD` and `LARGE_TRANSACTION` and must change.
- **Final migration decision (I2):**
  - Existing `AlertSetting` rows are preserved unchanged. DB-M5 contains **no** data step touching `emailEnabled`.
  - Release notes disclose that accounts created under the previous default may have email enabled for `BUDGET_THRESHOLD` (CRITICAL at 100%) and `LARGE_TRANSACTION` (WARNING only, so never emailed). Users can switch it off in Settings.
  - Changing this later requires a new, explicitly approved migration.
- `threshold Decimal?` on the `LARGE_TRANSACTION` setting row is the large-transaction amount in the user's `baseCurrency`. When it is null, the effective threshold is 5,000,000 if `baseCurrency = 'VND'`; otherwise the rule is inactive. The threshold must be greater than 0.
- `UserSettings.notificationEnabled = false` suppresses email for all types (delivery `SKIPPED/NOTIFICATIONS_DISABLED`). In-app creation still follows `inAppEnabled`.

### UserSettings.storeRawEmailBody (DATA-001; no schema change)

- The `PATCH /users/me/settings` DTO accepts only `false` for `storeRawEmailBody`. `true` returns a 400 field error with code `RAW_EMAIL_BODY_UNAVAILABLE`.
- Stored legacy `true` values are preserved, never read by ingestion, and have no effect.
- Responses add the field `rawEmailBodyAvailable: false`. The settings UI renders the control disabled with an "Unavailable in this release" label, whatever the stored value is.

### Alert condition lifecycle (DB-M4)

New enum `AlertStatus { ACTIVE, DISMISSED, RESOLVED }`. The existing read-state fields `isRead`/`readAt` are unchanged and remain presentation state only.

| New field | Type | Meaning |
|---|---|---|
| `status` | `AlertStatus @default(ACTIVE)` | Condition lifecycle |
| `conditionKey` | `String?` | Stable condition identity; null for legacy and user-authored alerts |
| `thresholdValue` | `Decimal? @db.Decimal(18,4)` | Threshold applied (percent or amount) |
| `observedValue` | `Decimal? @db.Decimal(18,4)` | Observed usage/amount/projection at trigger |
| `periodStart`, `periodEnd` | `DateTime?` | Budget period instance or observation window |
| `triggeredAt` | `DateTime` | Occurrence start; backfilled from `createdAt` for legacy rows |
| `resolvedAt` | `DateTime?` | Set only by the system |
| `resolutionReason` | `String?` | e.g. `BELOW_THRESHOLD`, `PERIOD_ENDED`, `TARGET_REMOVED`, `INSUFFICIENT_DATA`, `RECONNECTED`, `SYNC_SUCCEEDED` |
| `dismissedAt` | `DateTime?` | Set by the user's dismiss action; retained after resolution |

Existing `resourceType`/`resourceId` identify the target, and `metadata` holds only sanitized explanation values that have no typed field.

**Transitions**

- `ACTIVE → DISMISSED` (user)
- `ACTIVE → RESOLVED` (system)
- `DISMISSED → RESOLVED` (system; `dismissedAt` kept)

`RESOLVED` is terminal. Mark-read and read-all change only `isRead`/`readAt`. Dismiss sets `status = DISMISSED`, sets `dismissedAt`, and sets `isRead = true` and `readAt` if unset. Unread count is `COUNT(*) WHERE userId = ? AND isRead = false`.

**Open occurrence and dedupe:** an occurrence is open when `status IN ('ACTIVE','DISMISSED')`. A partial unique index enforces at most one open occurrence per condition:

```sql
CREATE UNIQUE INDEX "Alert_open_condition_key"
  ON "Alert" ("userId", "conditionKey")
  WHERE "conditionKey" IS NOT NULL AND "status" IN ('ACTIVE', 'DISMISSED');
```

Also add the index `(userId, conditionKey, triggeredAt DESC)` for the cooldown lookup.

**Creation rule (level-triggered):** create an occurrence only when all of the following hold:

- the condition holds;
- no open row exists for `(userId, conditionKey)`;
- the matrix creation limits are met;
- `now - max(triggeredAt) >= 24h` for that key, or no prior row exists.

A unique-violation on insert means a concurrent evaluator won, and is treated as "already open".

**Condition key formats** (stable, ASCII, no sensitive values):

| Alert type | `type` / `severity` | `conditionKey` |
|---|---|---|
| Budget warning | `BUDGET_THRESHOLD` / `WARNING` | `budget:{budgetId}:{periodStartISODate}:WARNING` |
| Budget critical | `BUDGET_THRESHOLD` / `CRITICAL` | `budget:{budgetId}:{periodStartISODate}:CRITICAL` |
| Large transaction | `LARGE_TRANSACTION` / `WARNING` | `large-tx:{transactionId}` |
| Goal risk | `GOAL_RISK` / `WARNING` | `goal:{goalId}` |
| Cashflow risk | `CASHFLOW_RISK` / `CRITICAL` | `cashflow:{userId}` |
| Repeated sync failure | `SYSTEM` / `WARNING` | `sync-failure:{emailConnectionId}` |
| Reconnect required | `SYSTEM` / `CRITICAL` | `reconnect:{emailConnectionId}` |

`CATEGORY_SHIFT` and `PARSER_ISSUE` enum values stay in the schema but are not produced by MVP evaluators.

**Legacy and user-authored alerts:** existing rows migrate to `status = ACTIVE`, `conditionKey = NULL`, and `triggeredAt = createdAt`. Rows created through `POST /alerts` also carry `conditionKey = NULL`. Evaluators never resolve null-key rows, those rows are never email-eligible, and no `AlertDelivery` row is created for them.

### AlertDelivery (new, DB-M5)

| Field | Meaning |
|---|---|
| `id`, `alertId` (FK → `Alert`, cascade), `userId` | Delivery identity and ownership |
| `channel` | `EMAIL` in MVP. The alert record itself is the in-app delivery, so no `IN_APP` rows are written. The enum reserves `IN_APP` for later. |
| `provider` | `smtp`, `log`, or `none` |
| `status` | `PENDING`, `SENT`, `SKIPPED`, `FAILED` |
| `skipReason` | `NOT_CRITICAL`, `EMAIL_DISABLED`, `NOTIFICATIONS_DISABLED`, `TRANSPORT_DISABLED` |
| `attemptCount` | 0–3, enforced by `CHECK ("attemptCount" BETWEEN 0 AND 3)` |
| `lastAttemptAt`, `sentAt` | Delivery timestamps |
| `failureCode`, `failureMessage` | Sanitized terminal evidence, e.g. `TIMEOUT`, `AUTH`, `REJECTED`, `INTERRUPTED` |

Unique `(alertId, channel)`: exactly one email outcome per evaluator-created alert. Legacy alerts and alerts created through `POST /alerts` have **no** `AlertDelivery` row; they are in-app only, and their API `emailDelivery` is `null`. Email failure never rolls back the alert.

**Interrupted delivery:** a `PENDING` row whose `lastAttemptAt` (or `createdAt` when there are no attempts) is older than the delivery total time budget plus a 30-second margin is set to `FAILED`/`INTERRUPTED` on the next alert read or evaluation for that user. It is never resent.

### Goal calculations (GOAL-002 to GOAL-004; derived, no new table)

All arithmetic uses exact decimals and rounds only at the named steps. "Unit" means the currency's smallest unit: 1 for VND (0 decimals), 0.01 for other currencies. Months are user months: `User.timezone` plus `defaultMonthStartDay`, via the shared period policy. `monthIndex(m) = year × 12 + month` of the user month.

1. **Remaining amount:** `remainingAmount = max(0, targetAmount − savedAmount)`.
2. **Deadline month and `horizonSource`**, checked in order:

   | Precedence | Condition | `horizonSource` | Deadline month |
   |---|---|---|---|
   | 1 | Query `months = N` | `QUERY` | current month + N − 1 |
   | 2 | `targetDate` is set | `TARGET_DATE` | the user month containing `targetDate` |
   | 3 | `goal.months = M` | `GOAL_MONTHS` | user month of `createdAt` + M − 1 |
   | 4 | None of the above | `DEFAULT` | current month + 5 |

3. **Remaining periods:** `remainingPeriods = max(0, monthIndex(deadline) − monthIndex(current) + 1)`. Both the current month and the deadline month are counted. `pastDeadline = (remainingPeriods = 0)`.
4. **Required monthly saving** (`monthlyRequired`):
   - If `remainingAmount = 0`: 0.
   - Else if `remainingPeriods = 0`: `remainingAmount`, with reason `PAST_DEADLINE`.
   - Otherwise: `ceil(remainingAmount ÷ remainingPeriods)`, rounded up to the unit.
5. **Observation months:**
   - History starts in the user month of the user's earliest eligible (TX-003) transaction in the **goal's currency**.
   - Observation months are the completed months, the current month excluded, from the history start onward. Keep at most the 3 most recent.
   - A month inside the window with no eligible transactions has net 0.
6. **Insufficient data:** fewer than 2 observation months gives `status = INSUFFICIENT_DATA`, `feasibilityScore = null`, `availableMonthlyCashflow = null`, and `monthsRequired = 2 − count`.
7. **Available cashflow:** `availableMonthlyCashflow = floor(Σ monthly net ÷ count)` to the unit. `floor` rounds toward −∞, so negative values round away from zero.
8. **Score:** `feasibilityScore = 100` if `monthlyRequired = 0`. Otherwise `min(100, max(0, floor(availableMonthlyCashflow × 100 ÷ monthlyRequired)))`.
9. **Levels:**

   | Score | Level |
   |---|---|
   | 100 | `SAFE` |
   | 80–99 | `ACCEPTABLE` |
   | 50–79 | `RISKY` |
   | 0–49 | `NOT_RECOMMENDED` |

10. **Alert inputs** apply exactly these rounding rules to the goal's **stored** horizon:
    - The goal-risk condition is `monthlyRequired > availableMonthlyCashflow`, using the horizon precedence without the `QUERY` source (`TARGET_DATE` → `GOAL_MONTHS` → `DEFAULT`). The Goals page's what-if slider always sends `months`, so its displayed numbers may differ from the alert's stored-horizon numbers by design.
    - The cashflow-risk condition is `availableMonthlyCashflow < 0`, computed in the user's base currency.

API fields retained:
- `monthlyRequired`.
- `feasibilityScore`, now nullable.
- `months`, which now means `remainingPeriods`, the divisor used.

Additive fields: `horizonSource`, `pastDeadline`, `availableMonthlyCashflow`, `observationMonths`, `monthsRequired`, `reason`. No hidden assumed capacity is persisted or used.

**Worked examples.** These are the fixtures for T058, T073, and T074, and for SC-008.

- **Common context:** `now = 2026-09-23T10:00+07:00`, timezone `Asia/Ho_Chi_Minh`, `defaultMonthStartDay = 1`, VND.
- **Current month:** 2026-09.
- **Completed months:** 2026-06, 2026-07, 2026-08.
- **History H1:** starts 2025-01, with nets Jun 9,000,000; Jul 8,000,000; Aug 10,000,001, so available = floor(27,000,001 ÷ 3) = **9,000,000**.

| # | Case | Inputs | Expected output |
|---|---|---|---|
| G1 | Positive, ACCEPTABLE | target 45,000,000; saved 5,000,000; `targetDate` 2026-12-15; H1 | remaining 40,000,000; source TARGET_DATE; periods 4 (Sep to Dec); `monthlyRequired` 10,000,000; score floor(90) = **90 ACCEPTABLE**; goal-risk holds |
| G2 | Remainder rounds up | target 10,000,000; saved 0; query `months = 3`; H1 | periods 3; `monthlyRequired` ceil(3,333,333.33…) = **3,333,334**; score floor(269.99…) capped to **100 SAFE**; source QUERY |
| G3 | Deadline in current month | target 5,000,000; saved 1,000,000; `targetDate` 2026-09-30; H1 | periods **1**; `monthlyRequired` 4,000,000; score **100 SAFE** |
| G4 | Past deadline | target 20,000,000; saved 8,000,000; `targetDate` 2026-08-31; H1 | periods **0**; `pastDeadline = true`; `monthlyRequired` 12,000,000; score floor(75) = **75 RISKY**; reason `PAST_DEADLINE` |
| G5 | Target complete | target 10,000,000; saved 12,000,000; any deadline, including past | remaining 0; `monthlyRequired` 0; score **100 SAFE**; goal-risk does not hold |
| G6 | Negative cashflow | target 20,000,000; saved 0; query `months = 2`; nets Jun −2,000,000, Jul −1,000,000, Aug −1,500,001 | available floor(−1,500,000.33…) = **−1,500,001**; `monthlyRequired` 10,000,000; score max(0, floor(−15.00001)) = **0 NOT_RECOMMENDED**; cashflow-risk holds (CRITICAL) |
| G7 | Band edges | `monthlyRequired` 10,000,000 | available 9,999,999 → 99 ACCEPTABLE; 8,000,000 → 80 ACCEPTABLE; 7,999,999 → 79 RISKY; 5,000,000 → 50 RISKY; 4,999,999 → 49 NOT_RECOMMENDED |
| G8 | History length | earliest transaction 2026-09-05 / 2026-08-12 / 2026-07-01 / 2026-03-01 | 0 months → INSUFFICIENT_DATA, `monthsRequired` 2 / 1 month → INSUFFICIENT_DATA, `monthsRequired` 1 / 2 months (Jul, Aug) → mean of 2 / 3 months (Jun, Jul, Aug) → mean of 3 |
| G9 | Empty month counts as 0 | earliest 2026-06-10; nets Jun 3,000,000; Jul has no transactions; Aug 6,000,000 | observation months Jun, Jul, Aug; available floor(9,000,000 ÷ 3) = **3,000,000** |
| G10 | Horizon sources | (a) `goal.months = 6`, created 2026-07-10, no `targetDate`; (b) no `targetDate`, no months, no query | (a) deadline 2026-12, periods 4, source GOAL_MONTHS; (b) deadline 2027-02, periods 6, source DEFAULT |

## Migration sequencing

The five migrations form **one strictly sequential stream**, and each depends on the previous one:

| Order | ID | Folder name pattern | Depends on | Why sequential |
|---|---|---|---|---|
| 1 | DB-M1 | `<ts1>_email_sync_progress` | latest existing `20260627090000_budgets_goals_alerts_dashboard` | Adds `EmailSyncStatus.EXPIRED`, `emailsFailed`, `hasMore`, cursor and lease fields |
| 2 | DB-M2 | `<ts2>_transaction_deduplication` | DB-M1 | Same `schema.prisma`; Prisma diffs against the prior migrated state |
| 3 | DB-M3 | `<ts3>_classification_events` | DB-M2 | Same reason; `TransactionCategoryEvent` references `Transaction` |
| 4 | DB-M4 | `<ts4>_alert_lifecycle` | DB-M3 | Adds `AlertStatus`, lifecycle columns, and the partial unique index |
| 5 | DB-M5 | `<ts5>_alert_delivery` | DB-M4 | `AlertDelivery` references `Alert`; schema-only, with no `AlertSetting` data step (I2 decision: preserve existing preferences) |

Rules:

- Timestamps must be strictly increasing (`ts1 < ts2 < ts3 < ts4 < ts5`) and later than `20260627090000`.
- Generate each migration with `prisma migrate dev --create-only` only after the previous one is applied locally.
- Never author two migrations in parallel branches.
- Never edit, squash, or reorder existing or already-merged migrations. Fixes are new migrations.

DB-M1 and DB-M3 touch unrelated tables, but they still stay sequential. They share `schema.prisma`, and parallel authoring would produce drifting diffs and a non-linear history.

Per-migration procedure:

1. Add nullable columns/tables/indexes.
2. Deploy code tolerant of legacy nulls.
3. Backfill only reconstructable fingerprint/protection state and inspect collisions.
4. Add validated uniqueness/invariants where PostgreSQL/Prisma supports them; use explicit SQL for partial indexes/checks when necessary.
5. Test empty install, current-schema upgrade, and repeated `prisma migrate deploy` after every migration, not only after DB-M5.

Never rewrite existing migrations or fabricate historical category/delivery events.
