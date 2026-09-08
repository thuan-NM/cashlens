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
- Admin role never bypasses private-resource ownership.
- Normal calculations include only posted, non-deleted, non-ignored, non-duplicate income/expense records. Transfers are shown but excluded from income/expense/net. Currency groups are never silently summed.
- Time periods use the user's IANA timezone and month-start preference. Store timestamps in UTC.
- Raw Gmail body is transient only. Persist metadata, body hash, sanitized parser evidence, and derived transaction.

## Proposed schema deltas

### EmailConnection progress

Add nullable fields such as `syncCursor`, `backfillFrom`, `backfillCompletedAt`, `syncLeaseToken`, and `syncLeaseExpiresAt`. Exact provider cursor representation stays opaque.

State: `PENDING -> ACTIVE -> ERROR|REVOKED`; reconnect returns to `ACTIVE`. Acquiring a non-expired lease for an active run fails with conflict. Disconnect clears or cryptographically invalidates encrypted credentials while retaining sanitized history.

### EmailSyncRun lifecycle

Retain existing counts/timestamps/status. Add nullable continuation/cursor evidence and lease association if absent. Terminal states are `SUCCEEDED`, `PARTIAL`, `FAILED`, `CANCELLED/EXPIRED`; every started run must become terminal or recoverably expired.

### Transaction deduplication

Add nullable `deduplicationFingerprint` and a strategy/evidence field if existing metadata is insufficient. Owner-scoped uniqueness applies when a fingerprint exists.

Resolution order:

1. `(emailConnectionId, providerMessageId)` prevents message reprocessing.
2. `(userId, normalized externalTransactionId/transactionCode)` identifies provider transaction identity.
3. `(userId, deterministic fingerprint)` covers missing transaction identity.

Invalid parser output remains observable but cannot create a posted transaction.

### MerchantRule ownership

Change `userId` from required to nullable: non-null means user rule; null means system rule. A database/application invariant requires system rules to target a system category and user rules to target an allowed user/system category. Order by scope precedence, numeric priority descending, `createdAt` ascending, then stable `id` ascending.

### TransactionCategoryEvent (new)

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

### Alert condition lifecycle

Extend `Alert` with condition evidence: `conditionKey`, optional `threshold`, `periodStart`, `periodEnd`, `status`, `triggeredAt`, `resolvedAt`, and `dismissedAt`. Metadata stores sanitized observed values only when a typed field does not exist.

State: `ACTIVE_UNREAD -> ACTIVE_READ -> DISMISSED` or `RESOLVED`. Re-crossing creates a new occurrence only after the old condition resolved, usage crossed upward again, and 24 hours elapsed. Higher threshold is a distinct condition.

### AlertDelivery (new)

| Field | Meaning |
|---|---|
| `id`, `alertId`, `userId` | Delivery identity and ownership |
| `channel` | IN_APP or EMAIL |
| `status` | PENDING, SENT, SKIPPED, FAILED |
| `attemptCount` | 0–3 |
| `lastAttemptAt`, `sentAt` | Delivery timestamps |
| `failureCode`, `failureMessage` | Sanitized terminal evidence |

In-app is enabled by default for all P1 types. Email is created as SKIPPED unless both critical and opted in. Email failure never rolls back the alert.

### Goal calculations (derived, no new table)

- `remainingAmount = max(0, targetAmount - savedAmount)`.
- `requiredMonthlySaving = rounded remainingAmount / remaining visible periods`.
- `availableMonthlyCashflow` is arithmetic mean of net cashflow for up to three most recent completed months; at least two are required.
- `score = clamp(availableMonthlyCashflow / requiredMonthlySaving * 100, 0, 100)`; zero required saving yields 100.
- Levels: 100 SAFE; 80–99 ACCEPTABLE; 50–79 RISKY; below 50 NOT_RECOMMENDED; fewer than two months INSUFFICIENT_DATA.

Return observation months and inputs; do not persist a hidden assumed capacity.

## Migration sequencing

1. Add nullable columns/tables/indexes.
2. Deploy code tolerant of legacy nulls.
3. Backfill only reconstructable fingerprint/protection state and inspect collisions.
4. Add validated uniqueness/invariants where PostgreSQL/Prisma supports them; use explicit SQL for partial indexes/checks when necessary.
5. Test empty install, current-schema upgrade, and repeated `prisma migrate deploy`.

Never rewrite existing migrations or fabricate historical category/delivery events.
