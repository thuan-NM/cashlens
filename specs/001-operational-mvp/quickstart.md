# Quickstart Validation: Operational CashLens MVP

This is the release validation guide, not implementation code. Commands assume PowerShell, Yarn 4/Corepack, Node 22, Docker Compose, and synthetic test credentials.

## 1. Configure

1. Copy documented example values into an untracked local environment file.
2. Replace every secret placeholder with random non-production test values.
3. Configure a Gmail test client/callback only for the Gmail scenario.
4. Confirm no real account, email, token, or financial data is present.

Expected: production mode rejects missing, empty, malformed, and known-placeholder database/JWT/encryption/OAuth/origin settings before listening.

## 2. Static release checks

```powershell
corepack enable
yarn install --immutable
yarn check-types
yarn lint
yarn build
yarn workspace api swagger:generate
```

Expected: all commands pass; generated Swagger preserves existing APIs and implements `contracts/openapi.yaml` deltas.

## 3. Database migration checks

Against disposable synthetic databases, validate both paths:

```powershell
yarn workspace api prisma migrate deploy
yarn workspace api prisma migrate deploy
```

- Empty database reaches latest schema.
- Database at the current pre-feature migration upgrades without data loss.
- Second deployment is a no-op.
- Collision/backfill checks pass before uniqueness constraints.

## 4. Automated tests

```powershell
yarn workspace api test
yarn workspace api test:e2e
```

Run the implemented frontend component/E2E command documented in `apps/web/package.json` as well.

Expected evidence includes requirement-mapped auth/ownership, parser/dedupe, classification, budget cooldown, goal formulas, frontend states, and synthetic E2E journeys.

## 5. Container startup

```powershell
docker compose config
docker compose up --build -d
docker compose ps
```

Expected:

- PostgreSQL becomes healthy before migration/API readiness.
- `/api/health/live` reports process availability.
- `/api/health/ready` becomes ready only after PostgreSQL is usable.
- Web becomes healthy and reaches the configured API origin.
- Normal restart preserves data; graceful stop leaves no permanently active sync lease.

## 6. Security smoke

Create user A, user B, and controlled admin C.

- Missing/expired credentials return 401.
- Ordinary access to admin user/provider/parser operations returns 403.
- Cross-user private IDs return the documented owner-safe absence and never data.
- Admin C can manage identity/status and system configuration but cannot read A/B transactions, goals, budgets, alerts, connections, messages, or runs.
- Attempts to submit `userId`, `role`, `status`, classification provenance, or similar privileged fields through ordinary endpoints fail and leave values unchanged.
- Captured logs contain correlation IDs but no password, cookie/token, encryption key, raw body, or sensitive notification content.

## 7. Financial consistency smoke

For user A, create known income, expense, transfer, ignored, duplicate, and deleted records across month boundaries/currencies.

Expected: transaction list policy, dashboard, budget usage, and goal history apply the shared eligibility/period policy; transfers do not inflate net; currencies are separated; expected dashboard response meets the documented one-second fixture target.

## 8. Classification and budget smoke

- Create overlapping user/system rules and verify manual → user → system → fallback precedence and deterministic ties.
- Correct a category manually, rerun ingestion/classification, and verify no overwrite plus append-only history.
- Explicitly reclassify and verify a new event.
- Cross warning and critical budget thresholds; repeated evaluation does not spam.
- Move below, resolve, then recross: no new same-threshold alert before 24 hours; one afterward.

## 9. Goal smoke

- With fewer than two completed months, expect `INSUFFICIENT_DATA` and no invented capacity.
- With two/three completed months, hand-calculate mean net cashflow, required saving, score, and exact level.
- Verify current partial month, transfers, duplicates, ignored/deleted records, and incompatible currency do not contaminate input.

## 10. Gmail fixture and test-account smoke

- Verify OAuth requests read-only Gmail scope and signed expiring state.
- Configure owned listen rules and a bounded start date.
- Run a fixture batch containing matching, non-matching, malformed, duplicate-message, and duplicate-event cases.
- Start two syncs concurrently; exactly one acquires the connection lease.
- Retry transient 429/5xx responses within the configured bound; permanent message failure does not stop valid messages.
- Continue a bounded run when `hasMore` is true; next run resumes from persisted progress.
- Disconnect/reconnect and verify credentials are unusable while derived transactions and sanitized history remain.

## 11. Shutdown and release decision

```powershell
docker compose down
```

Do not remove volumes during a persistence test. Release approval requires all critical tests/checks, migration paths, health checks, and smoke journeys to pass with no unresolved critical authorization or secret finding. Record failures by correlation ID and follow documented backup/restore and rollback-to-previous-image procedures.
