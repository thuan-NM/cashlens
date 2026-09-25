# Release evidence: 001 Operational MVP (T101, T107)

**Run date:** 2026-09-25 (Asia/Ho_Chi_Minh).

**Branch:** `feat/thuan/backend-mvp-modules-and-docker-compose` at `90f9b8d`, plus the uncommitted Phase 8 working tree (T092–T101). This is not a clean checkout.

**Host:** Windows 11 (10.0.26200) with Docker Desktop 29.6.1 (12 CPU, 7.4 GB visible to Docker), Windows PowerShell 5.1, and Node 22 with Corepack/Yarn 4.

## Verdict

**The release gate has NOT passed.** This machine is not the reference release host defined in plan.md: that host runs Linux x86_64 with Docker Engine, at least 2 vCPU and 4 GB, the documented TLS proxy, and a clean checkout.

| Gate | Status |
|---|---|
| Backend and frontend tests, type checks, builds, migration matrix, secret scan, parser gate, exactly-3 replay | **PASS** on this machine (details below) |
| Official web lint | **PASS** |
| Official API lint (`yarn workspace api lint`) | **FAIL**: 31 errors and 2 warnings, all in files Phase 8 did not change (see Open findings) |
| T100 release verification | **INFORMATIVE PASS** only (33/33 checks, exit 3). The authoritative run is **PENDING** on the reference release host. |
| SC-001 documentation walkthrough (T107) | **INFORMATIVE PASS**: 3.59 minutes from `git clone` to the Smoke flow stop point, on a machine that is not a clean environment. The authoritative clean-environment walkthrough is **PENDING** (see the T107 section). |
| Dashboard benchmark (DASH-004, SC-010) | **PENDING**. It gates only on the reference release host with `.env.release-test`. It was **not run** here, and no numbers are recorded. |

Release readiness can be claimed only after these four steps:
1. `scripts/verify-release.ps1 -ReferenceHost -HostDescription "<host>"` exits 0 on the reference host from a clean checkout.
2. The gating benchmark passes on that host.
3. The official API lint passes.
4. The SC-001 walkthrough is repeated in a clean environment (T107) and finishes in 30 minutes or less.

## Backend (apps/api)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npx jest` | **669/669 passed** (28 suites) |
| Integration (e2e) tests | `E2E_DATABASE_URL=…/cashlens_test npx jest --config ./test/jest-e2e.json --runInBand` | **834/834 passed** (28 suites, about 314 s) |
| Type check (src + test) | `npx tsc -p tsconfig.json --noEmit` | **PASS** (exit 0) |
| Build | `yarn workspace api build` | **PASS** |
| Lint on the files Phase 8 changed | ESLint on every changed or new `.ts` file (35) | **0 problems** |
| Official lint | `yarn workspace api lint` | **FAIL**: 33 problems, all pre-existing (see Open findings). The script runs `eslint --fix`; the formatting changes it made to 9 untouched files were reverted. |
| Parser rate gate (T048) | in the e2e run | `bank_vcb EMAIL v1 \| 17/17 \| 100.0% \| 12 malformed \| 0 malformed posted \| PASS` |
| Exactly-3 replay (SC-004) | in the e2e run | **PASS**: "Gmail ingestion pipeline (T049) replaying the unchanged mailbox 3 times changes nothing" and "Deterministic classification (T057) replaying the unchanged mailbox 3 times changes no classification and appends no event" |
| Error contract (T092) | `test/error-contract.e2e-spec.ts` | **20/20** in the e2e run |
| Log redaction (T094) | `src/common/logging/logger.spec.ts` and `test/log-redaction.e2e-spec.ts` | **19 + 3** passed |

## Frontend (apps/web)

| Check | Command | Result |
|---|---|---|
| Component tests (Vitest) | `yarn workspace web test` | **47/47 passed** (11 files) |
| Browser E2E (Playwright, Chromium) | `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:13000/api npx playwright test` against the development compose stack | **2/2 passed**, twice in a row (39.3 s and 39.6 s): `operational-mvp.spec.ts` (T099 clean-user smoke flow) and `sign-in.spec.ts` |
| Type check | `npx tsc -p tsconfig.json --noEmit` | **PASS** |
| Official lint | `yarn workspace web lint` | **PASS** (0 problems) |
| Build | `yarn workspace web build` | **PASS**, with the known warning that the main chunk exceeds 500 kB |

## Migration matrix (T008)

Command: `apps/api/test/scripts/verify-migrations.ps1` against the development PostgreSQL 16. All 10 checks **PASS**, exit 0:
- migration history is unmodified (pinned `80f3e0d`, 10 folders), and new migrations sort after the baseline;
- on an empty database, deploy applies with no drift, and a repeated deploy does nothing;
- on the baseline schema (10 of 15 migrations), the upgrade applies with no drift, and a repeated deploy does nothing.

The informative T100 run passed the same matrix against a disposable PostgreSQL container.

## Secret scan (T009)

Command: `scripts/scan-secrets.ps1`, exit 0.

| Item | Value |
|---|---|
| Scanner | `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |
| Working tree | 518 files (tracked, plus untracked files not ignored): **clean** |
| History | `80f3e0d78892887256aa52451dacc7bc8c952fbc..90f9b8d38933db0d6960c62a3121c36a73e842c0` (12 commits): **clean** |
| Reviewed exceptions | 2 (root `.gitleaksignore`) |

Fixed during T100:
- The scan reported "clean" when gitleaks could not read a file under memory pressure. Any gitleaks `ERR` line now makes it exit 2.
- The T094 test's secret-shaped literals were flagged. They are now built at runtime.

## OpenAPI (swagger.json vs contracts/openapi.yaml)

`yarn workspace api swagger:generate` regenerated `apps/api/docs/swagger.json`; the file was not edited by hand. The regenerated document differs substantially from the committed one, which was stale.

The comparison is structural: operations, and each named schema's properties and required list.

| Item | Result |
|---|---|
| Operations | All **52** contract operations are present in the generated document. The generated document has 37 more existing CRUD routes, which are outside the feature contract. |
| `BudgetWrite` (`thresholdPercent`) | **Matches** `CreateBudgetDto` and `UpdateBudgetDto` after the fix below |
| `UserSettingsWrite` (`storeRawEmailBody`) | **Matches** `UpdateUserSettingsDto` |
| Envelope (`success, data, message, timestamp, correlationId`) | **Not described** in the generated document |
| `EmailSyncRun`, `GoalFeasibility`, `Alert` | **Not described** in the generated document |

The last two rows share a cause: response schemas are documented for only 11 of 89 operations. The runtime shapes are covered by e2e tests that assert exact keys, for example `SYNC_RUN_KEYS` in `email-ingestion.e2e-spec.ts` and the enveloped `GoalFeasibility` in `goals.e2e-spec.ts`. See Open findings.

Fixed during T101: `UpdateBudgetDto` and `UpdateGoalDto` used `PartialType` from `@nestjs/mapped-types`, so their request bodies were empty in Swagger. They now use the `@nestjs/swagger` version, and `src/common/dto/mapped-types-source.spec.ts` guards against a regression.

## T100 release verification (informative)

Command: `scripts/verify-release.ps1 -ProxyAddress 127.0.0.1 -CaCert <test CA>`.

Setup on this machine:
- `.env.release-test` was generated by `init-local-env.ps1 -Profile release-test -PublicOrigin https://cashlens-release.example.test`, with `API_HOST_PORT=13100` and `WEB_HOST_PORT=18080` added. The file is git-ignored and was never staged.
- The TLS proxy was an `nginx:1.27-alpine` container using the reference configuration, reaching the published loopback ports through `host.docker.internal`.

**Result: 33/33 checks passed, exit 3 (INFORMATIVE ONLY).**
- **Mode:** the host is not Linux, it runs Docker Desktop, the tree has uncommitted changes, and `-ReferenceHost` was not given.
- **TRUST_PROXY:** observed `remoteAddress=::ffff:172.28.0.1`, with effective `TRUST_PROXY=loopback,172.28.0.1`, so it is covered.
- **Cookies:** `accessToken` and `refreshToken` are set with `Secure; HttpOnly; SameSite=Lax`.
- **Direct login:** direct loopback login returns 403 `HTTPS_REQUIRED` with no cookies.
- **Admin review:** `--list-admins` listed the bootstrap administrator and a simulated legacy administrator. The legacy administrator was revoked, and the check's own administrator was revoked afterwards.
- **Restart and persistence:** after an API restart and after a `down`/`up`, exactly one copy of the transaction remained.
- **Outage:** readiness returned 503 and a data call returned 503 `SERVICE_UNAVAILABLE`, and both recovered.
- **Shutdown:** SIGTERM stopped the API in 0.6 s (exit 143) with the graceful log line.
- **Volumes:** none were deleted (`cashlens-release-check_cashlens_prod_postgres_data` was kept).

## Dashboard benchmark (DASH-004, SC-010): PENDING

It was not run. The gate is defined only on the reference release host, with the `-p cashlens-bench` stack and `.env.release-test` behind the proxy.

**To record there:** min, median, p95, and max; the 190th of 200 sorted loads (at most 1,000 ms); zero failures; and the host description.

## SC-001 documentation walkthrough (T107): INFORMATIVE

**Result:** the documented Smoke flow succeeded **3.59 minutes** after `git clone`, well inside the 30-minute limit. The run does **not** meet T107's clean-environment rules, so it is informative only, and SC-001 is not yet evidenced authoritatively.

| Item | Value |
|---|---|
| Performer | The documentation author (Claude Code, automated), not an independent developer. Commands ran in PowerShell. The browser steps (Smoke flow 2, 4, and 5) were driven by a headless Chromium script that uses only the labels given in the guide. |
| Commit | `a93370c`, plus the uncommitted Phase 9 documentation (README files, `docs/operations/*.md`, the proxy-timeout fix), applied as a patch right after the clone |
| Host | Windows 11 (10.0.26200), Docker Desktop 29.6.1 (12 CPU, 7.4 GB), Node 22.23.1, Git 2.55, Windows PowerShell 5.1 (PowerShell 7 not installed) |
| Clean-environment method | **Not clean.** Same OS account and machine, with the `node:22-alpine` and `postgres:16-alpine` images and the host Yarn cache already present. The clone, its compose project, and every named volume (database and container dependencies) were new. |
| Start / stop | 2026-09-25T09:04:57+07:00 (`git clone`) / 2026-09-25T09:08:33+07:00 (dashboard shows the transaction) |
| Elapsed | **3.59 minutes** (pass threshold: 30) |
| Transcript | [`evidence/sc-001-transcript.txt`](evidence/sc-001-transcript.txt) (Start-Transcript); `scan-secrets.ps1` over the working tree including it: **clean** (525 files) |
| Stop-point screenshot | [`evidence/sc-001-dashboard.png`](evidence/sc-001-dashboard.png): **Dòng tiền ròng · Tháng 09/2026**, with "Smoke test" -50.000₫ among the recent transactions |

**Steps that were not in the documentation.** Each is recorded in the transcript:
1. The Phase 9 documentation was applied as a patch after the clone, because it was not yet committed.
2. The clone folder was `cashlens-sc001`, not `cashlens`, and the author's existing development stack was stopped first. The development containers have fixed names, and the folder name `cashlens` would have reused the author's existing volumes.
3. Smoke flow step 2 was run twice. The first account's generated password was lost between tool processes, which was a tooling slip, not a documentation gap.

**Documentation defects found by the walkthrough and fixed in the guide** before this record:
- **Browser tests and the Smoke-flow administrator.** The Playwright setup fails with exit 3 while the Smoke-flow administrator exists. The guide now says to revoke it first.
- **Smoke-flow amount.** An expense shows as **-50.000₫** in the recent transactions list. The guide now says so.
- **Graceful shutdown in development.** The development API does not log a graceful shutdown; only the release image does. The guide no longer claims it for development.

**Found in the same clone after the timed flow.** These were outside the Smoke flow, and were fixed in the guide and re-verified there:
- **`prisma generate`.** A host install needs `yarn workspace api prisma generate` before the API unit tests, integration tests, or build. Without it, 20 of 28 unit suites could not load the Prisma client. With it: unit tests 669/669, two integration suites 23/23, and the build pass.
- **`corepack enable` with EPERM.** It fails with `EPERM` under nvm-windows. The guide now documents `corepack yarn …` as the fallback.

With the fixes applied, these guide commands were run in the clone and **passed**:
- web tests 47/47, lint, and build;
- Playwright 2/2;
- `scan-secrets.ps1`, clean;
- `verify-migrations.ps1`, 10/10.

The backup/restore commands in `deployment.md` and the key-rotation SQL in `deployment.md` were run against a disposable release-check database and worked. The restore brought back the deleted audit rows (16 → 0 → 16).

**Remaining for an authoritative SC-001:**
- repeat the walkthrough on a fresh VM or OS account, with empty Docker image and Yarn caches, PowerShell 7, and ideally an independent developer;
- clone the committed documentation from the repository URL, with no patch step;
- record the transcript with `Start-Transcript` into `evidence/sc-001-transcript.txt`, then run `scan-secrets.ps1`.

### SC-012 disposition

SC-012 (moderated usability acceptance with representative first-time users) is **post-MVP** and not a release gate for this feature, as `spec.md` records, pending product-owner confirmation. No representative participant pool, moderator, or protocol exists. Journey completability is evidenced by the automated T099 clean-user browser flow and by the SC-001 Smoke flow.

### Synthetic-fixture attestation

Every test and walkthrough fixture is synthetic. That covers:
- the `bank_vcb` EMAIL v1 template and its valid and malformed emails in `apps/api/test/fixtures`, which follow our own model of a balance-change email, not a real Vietcombank message;
- sender addresses on `example.test`;
- the run-scoped `@example.test` accounts created by the tests and the walkthrough;
- the generated passwords and secrets, never printed;
- the Gmail client values in `.env.release-test`, which never work against Google.

No real email content, bank data, or usable credential appears in the repository, the transcript, or this file.

## Open findings

1. **Official API lint fails:** 31 errors and 2 warnings, all in files Phase 8 did not change:
   - `common/decorators/current-user.decorator.ts`: unsafe `any`;
   - `common/utils/prisma-list-query-builder.ts`: `no-base-to-string`;
   - `modules/auth/auth.controller.ts`: unsafe-argument warnings;
   - `modules/goals/dto/goal-contribution.dto.ts`: unused `Min`;
   - Prettier formatting in several other files.

   It blocks a release that requires the official lint.
2. **The generated Swagger describes few responses.** The envelope, `EmailSyncRun`, `GoalFeasibility`, and `Alert` are only in `contracts/openapi.yaml`, not in `swagger.json`. This is documentation only; runtime shapes are asserted by e2e tests.
3. **Occasional Playwright setup failure.** Once in about 6 development runs under heavy parallel load, `admin:bootstrap --revoke` in the global setup exited 1 with `PrismaClientKnownRequestError`. The cause is unconfirmed; the CLI now prints the error's non-secret code for diagnosis. The final runs passed twice in a row.
4. **The authoritative T100 run and the benchmark are pending** on the reference release host.
5. **The informative T100 run used slightly older images.** The release images were built before two later changes: the `bootstrap-admin` error-code change, which affects error output only, and the `DonutChart` fix. Both changes are covered by the API e2e run (834/834) and the web runs above.
6. **`verify-release.ps1` has run only under Windows PowerShell 5.1.** It was written for pwsh 7 on Linux as well, but its first run there will be the authoritative run on the reference host.
7. **T101's own check is not met.** T101 requires that no critical test or configuration finding remains; items 1 and 4 remain.
8. **Accepted limitations disclosed by the Phase 9 documentation.** These are not fixed in this release:
   - after Gmail consent, the OAuth callback answers with JSON and does not redirect back to the app;
   - the web app has no Gmail disconnect button (use the API), and its listen-rule switch does not save;
   - rotating `EMAIL_TOKEN_ENCRYPTION_KEY` makes existing connections fail with 500 until an operator marks them reconnect-required, using the SQL in `deployment.md`;
   - the development API does not shut down gracefully (only the release image does);
   - there is no login throttling;
   - `dataRetentionDays` is stored but not enforced.
9. **Broken or empty helper scripts, not used by any document:**
   - `yarn workspace api start:prod` runs `node dist/main`, but the build writes `dist/src/main.js`;
   - the root `yarn check-types` does nothing, because no workspace defines `check-types`.
