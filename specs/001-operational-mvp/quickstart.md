# Quickstart Validation: Operational CashLens MVP

This is the release validation guide, not implementation code. Commands assume PowerShell, Yarn 4/Corepack, Node 22, Docker Compose, and synthetic test credentials.

## 0. SC-001 timing record

SC-001 is a separate timed walkthrough of the **repository documentation** (`README.md` → `docs/operations/local-development.md`), not of this validation guide.

- **Performer.** An independent developer when available; otherwise the documentation author.
- **Clean environment.** A fresh VM, a fresh OS user account, or a new machine, with no prior clone, an empty Docker image cache, and an empty Yarn cache. Only Node 22 with Corepack, Docker, Git, and PowerShell 7 are installed.
- **Transcript.** Start `Start-Transcript -IncludeInvocationHeader` (or `script -T`) before the first command.
- **Start.** The clock starts when `git clone` executes.
- **Stop.** The clock stops when the documented smoke flow's last step succeeds. The flow is:
  1. `/api/health/ready` returns 200 and the web app loads.
  2. A user registers.
  3. The first administrator is provisioned with `admin:bootstrap`.
  4. One transaction is created.
  5. The dashboard shows that transaction for the current month.

Record the following in `checklists/release-evidence.md`:

- performer type (independent or author), commit SHA, host OS, CPU, RAM, and a network note;
- clean-environment method;
- start and stop timestamps and elapsed minutes;
- the transcript path (`checklists/evidence/sc-001-transcript.txt`, which must pass `scan-secrets.ps1`);
- every step that needed undocumented help.

The walkthrough passes at 30 minutes or less with zero undocumented help. Dependency download, image build, and migrations count toward the time.

## 1. Configure

1. Run `./scripts/init-local-env.ps1`. It copies the example into the untracked `apps/api/.env` and fills every secret placeholder with random non-production values **without printing them**, so transcripts stay clean.
2. Confirm the file is ignored: `git check-ignore -v apps/api/.env` must print a matching `.gitignore` rule. Because the file is ignored, the release secret scan never reads it.
3. For production-mode release checks (§5b, §7b), generate the release-test profile on the reference release host:
   - Run `./scripts/init-local-env.ps1 -Profile release-test -PublicOrigin https://<release-test-host>`. It writes the git-ignored `.env.release-test` with synthetic, release-safe values for every production setting and prints none of them.
   - Confirm `git check-ignore -v .env.release-test` matches.
   - Never commit it; real deployments keep their env file outside the repository.
4. Configure a Gmail test client/callback only for the Gmail scenario.
5. Confirm no real account, email, token, or financial data is present.

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

Expected: all commands pass. Generated Swagger preserves existing APIs and implements the `contracts/openapi.yaml` deltas: every 2xx response uses the `{success, data, message, timestamp}` envelope, sync responses keep the existing `EmailSyncRun` field and status names, and goal simulation keeps `monthlyRequired` and `feasibilityScore`.

### Secret scan (CFG-006 / SC-003)

```powershell
./scripts/scan-secrets.ps1
```

The history baseline must be present (a full clone; a shallow clone needs `git fetch --unshallow`). The script uses `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` and runs two scans:

1. **Files.** It selects files with `git ls-files --cached --others --exclude-standard`, which means tracked files plus untracked files that are not ignored. It stages them in a temporary directory and scans that directory in `dir` mode. Ignored files (`.env*`, `node_modules`, `dist`, `.turbo`, `coverage`, `.yarn`) are never scanned.
2. **Commits.** It scans `<BaseRef>..HEAD` in `git` mode. The default `-BaseRef` is `80f3e0d`, the last commit of this branch that was merged into `dev`; the range also covers the implementation baseline `b273f14` and every feature commit.

| Exit code | Meaning |
|---|---|
| 0 | Clean |
| 1 | Findings |
| 2 | Prerequisite or configuration error, such as a missing or unrelated base ref, no Docker, an allowlist that differs from the placeholder list, or an invalid `.gitleaksignore` |

Expected: exit 0, printing `Reviewed history exceptions (.gitleaksignore): 2`. Only the shared production placeholder list is allowlisted; the two reviewed exceptions are exact fingerprints of synthetic fixtures in pushed commit `219f8e9` (research.md "Secret scanning"). Record the scanner digest, the scanned file count, the commit range, and the result in release evidence, together with the synthetic-fixture attestation (TEST-008).

## 3. Database migration checks

Against disposable synthetic databases, validate both paths:

```powershell
yarn workspace api prisma migrate deploy
yarn workspace api prisma migrate deploy
```

- Release path: the runtime image has no Prisma CLI, and the database is unpublished. Run migrations with the one-off service `docker compose --env-file .env.release-test -f docker-compose.prod.yml run --rm migrate`; `api` waits for it to complete successfully.
- Empty database reaches latest schema.
- Database at the current pre-feature migration (`20260627090000_budgets_goals_alerts_dashboard`) upgrades without data loss.
- New migrations apply in the single order DB-M1 → DB-M2 → DB-M3 → DB-M4 → DB-M5, with strictly increasing timestamps, and no existing migration folder is modified (`git diff --stat origin/main -- apps/api/prisma/migrations` lists only added folders).
- Second deployment is a no-op.
- Collision/backfill checks pass before uniqueness constraints.
- Legacy alerts read as `status=ACTIVE` with a null `conditionKey`. Legacy budgets with `thresholdPercent >= 100` read `warningThresholdActive=false`.

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

### 5b. Production TLS boundary and same-origin routing (OPS-009)

Run this **on the reference release host**: the documented Linux Docker Engine deployment or CI host, running the reference proxy (`scripts/release/reference-proxy.nginx.conf`) that terminates TLS for `https://<release-test-host>`. Results from other hosts, including Docker Desktop, are informative only.

```powershell
docker compose --env-file .env.release-test -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.release-test -f docker-compose.prod.yml up -d
./scripts/verify-release.ps1
```

The proxy routes `/api/` to `127.0.0.1:3000` and `/` to `127.0.0.1:8080` on one public origin. Expected results:

- `config` shows the API and web published on `127.0.0.1` only, PostgreSQL unpublished, and `cashlens_net` pinned to `172.28.0.0/24`.
- Setting `CORS_ORIGIN=http://…` makes production startup fail.
- `https://<release-test-host>/` serves the web app, whose bundle calls the relative `/api` with no absolute API origin.
- Login through `https://<release-test-host>/api/auth/login` returns `Set-Cookie` with `Secure; HttpOnly; SameSite=Lax`, and a following same-origin authenticated call succeeds.
- **`TRUST_PROXY` check:**
  - The peer address the API logged (`remoteAddress`) for a proxied request is recorded.
  - It must be covered by `TRUST_PROXY`; otherwise the check fails, with no Docker gateway behavior assumed.
  - The observed address and the verified value go into release evidence.
- Direct `POST http://127.0.0.1:3000/api/auth/login` with no forwarded header returns 403 `HTTPS_REQUIRED`.
- `GET /api/health/ready` over loopback HTTP returns 200.

## 6. Security smoke

Register users A, B, and C through the normal public registration. Then provision C as the first administrator through the controlled step (SEC-009):

```powershell
# development compose
docker compose exec api yarn workspace api admin:bootstrap --email c@example.test
# release compose
docker compose --env-file .env.release-test -f docker-compose.prod.yml run --rm api node dist/src/scripts/bootstrap-admin.js --email c@example.test
```

On an **upgraded** database, first run `--list-admins` and `--revoke --email <unapproved>` for every administrator that was not explicitly approved; earlier releases allowed self-promotion.

Expected outcomes:

- Exit 0, and one `ADMIN_BOOTSTRAP_GRANTED` audit row with actor `SYSTEM`.
- Rerunning for C: exit 0, with no new audit row.
- Running for A: exit 3 (`ADMIN_EXISTS`), and A's role is unchanged.
- Running for an unknown email, or for an account without its own password (for example one created by an administrator): exit 2.
- No output contains a password, token, or connection string.
- `PATCH /users/{A}` with `{"role":"ADMIN"}` as A returns 403. Registration with a `role` field returns 400.

- Missing/expired credentials return 401.
- Ordinary access to administrator user and parser-template operations returns 403, whatever fields a well-formed JSON body contains (malformed JSON is 400 for every caller). Bank-provider writes do not exist in this release and return 404.
- Cross-user private IDs return the documented owner-safe absence and never data.
- Admin C can manage identity/status and system configuration but cannot read A/B transactions, goals, budgets, alerts, connections, messages, or runs; C's view of an account carries no `settings`.
- A changes their own profile through `PATCH /users/me`; `role`, `status`, or `email` there returns 400.
- Attempts to submit `userId`, `role`, `status`, classification provenance, or similar privileged fields through ordinary endpoints fail and leave values unchanged.
- `PATCH /users/me/settings` with `storeRawEmailBody: true` returns 400 `RAW_EMAIL_BODY_UNAVAILABLE`. The Settings page shows the raw-body control disabled and labeled "Unavailable in this release".
- Captured logs contain correlation IDs but no password, cookie/token, encryption key, raw body, or sensitive notification content.

## 7. Financial consistency smoke

For user A, create known income, expense, transfer, ignored, duplicate, and deleted records across month boundaries/currencies.

Expected: transaction list policy, dashboard, budget usage, and goal history apply the shared eligibility/period policy; transfers do not inflate net; currencies are separated.

### 7b. Dashboard benchmark (DASH-004 / SC-010)

Run this on the **same reference release host and `.env.release-test` profile as §5b**. Stop the §5b stack first, because the disposable benchmark stack takes over the same loopback ports behind the same proxy. The test-only override publishes the benchmark stack's PostgreSQL on `127.0.0.1:55432` for seeding; production compose never does.

```powershell
$c = @('-p','cashlens-bench','--env-file','.env.release-test','-f','docker-compose.prod.yml','-f','docker-compose.bench.yml')
docker compose @c run --rm migrate
docker compose @c up -d
# Throwaway password for the bench user; both steps read it, nothing prints it.
$b = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $env:BENCH_USER_PASSWORD = [Convert]::ToBase64String($b)
yarn workspace api bench:dashboard:seed --env-file .env.release-test      # reads DB credentials from the profile; prints none
$env:NODE_EXTRA_CA_CERTS = "<path-to-release-test-CA.pem>"
yarn workspace api bench:dashboard --base-url https://<release-test-host>/api
docker compose @c down -v
```

- **Fixture:** seed `20260923`; 13 user months; 2,990 transactions; 20 categories; 3 accounts; 10 MONTHLY budgets.
- **Procedure:**
  1. Wait for `/api/health/ready`, then sign in once through the proxy origin, the same path users take.
  2. Verify the current-month totals equal the generator's expected totals.
  3. Run 10 warm-up loads.
  4. Run 200 **sequential** loads. Each load is the six concurrent dashboard requests the page issues.
- **Pass:** the 190th sorted load duration is 1,000 ms or less, and all 1,200 responses are 200 with `success: true`.
- **Record:** minimum, median, p95, maximum, and the host description.

## 8. Classification and budget smoke

- Create overlapping user/system rules and verify manual → user → system → fallback precedence and deterministic ties.
- Correct a category manually, rerun ingestion/classification, and verify no overwrite plus append-only history.
- Explicitly reclassify and verify a new event.
- Create a MONTHLY budget with `thresholdPercent=80`. Saving `thresholdPercent=100` returns 400. A WEEKLY budget created through the API is accepted, shows `alertsSupported=false`, and never produces an alert.
- Reach 80%: one `WARNING`. Reach 100%: one `CRITICAL`, while the warning stays open. Repeated evaluation creates nothing new.
- Mark an alert read: only `isRead`/`readAt` change and `status` stays the same. Dismiss an open alert: `status=DISMISSED`, and no new alert appears while the condition holds.
- Move below the threshold: the open occurrence becomes `RESOLVED`. Recross within 24 hours of the previous `triggeredAt`: no new alert. Evaluate again after 24 hours, using the controlled clock in automated tests: one new alert.
- Edit an expense in a past month: past-period alerts may resolve, but no new past-period alert is created.
- Walk through the remaining ALERT-009 rows: large transaction at or above the threshold, goal risk (required > available), cashflow risk (negative 2–3-month mean), three consecutive failed syncs, and reconnect-required. Each creates one alert with its documented severity and resolves on its documented condition.
- Email: with `EMAIL_TRANSPORT=disabled`, every evaluator alert has one `SKIPPED/TRANSPORT_DISABLED` delivery. With the test fake, only opted-in `CRITICAL` alerts send, failures stop after 3 attempts, and the email body contains no amount, merchant, category, or account.

## 9. Goal smoke

- With fewer than two completed months, expect `INSUFFICIENT_DATA` and no invented capacity.
- Reproduce the data-model worked examples G1–G10 exactly: inclusive month counting, required saving rounded up to whole VND, available cashflow and score rounded down, past deadline meaning 0 periods, and a `horizonSource` in each response.
- Verify current partial month, transfers, duplicates, ignored/deleted records, and incompatible currency do not contaminate input.

## 10. Gmail fixture and test-account smoke

- Verify OAuth requests read-only Gmail scope and signed expiring state.
- Configure owned listen rules and a bounded start date.
- Run a fixture batch containing matching, non-matching, malformed, duplicate-message, and duplicate-event cases.
- SC-004: the replay suite runs the same fixture set **exactly three** consecutive times and asserts after each replay that there is one active transaction per event and an observable outcome per message.
- SC-005: `parser-fixture-rates` computes the rate per declared parser (bank, channel, version) from `docs/operations/supported-parsers.md`. Any of the following fails the check:
  - zero declared parsers, or an unreadable declaration;
  - any parser with fewer than 10 valid or 2 malformed fixtures;
  - any single parser with a rate below 85% (parsers are judged independently, not averaged);
  - a malformed fixture that produced a transaction.

  Copy the per-parser table into release evidence.
- Start two syncs concurrently; exactly one acquires the connection lease.
- Retry transient 429/5xx responses within the configured bound; permanent message failure does not stop valid messages.
- Continue a bounded run when `hasMore` is true; next run resumes from persisted progress.
- Disconnect/reconnect and verify credentials are unusable while derived transactions and sanitized history remain.

## 11. Shutdown and release decision

```powershell
docker compose down
```

Do not remove volumes during a persistence test. Release approval requires all critical tests/checks, migration paths, health checks, and smoke journeys to pass with no unresolved critical authorization or secret finding. Record failures by correlation ID and follow documented backup/restore and rollback-to-previous-image procedures.
