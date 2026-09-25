# Local development

This guide takes a new developer from a fresh clone to a running CashLens stack, with the database, API, and web app in Docker. It also covers tests, builds, and restarts. The numbered [Smoke flow](#smoke-flow) at the end is the timed SC-001 walkthrough.

All commands run in **PowerShell 7** (`pwsh`) from the repository root, unless a step says otherwise.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Docker with Compose v2 | Docker Engine or Docker Desktop | `docker compose version` |
| Node.js with Corepack | 22.x | `node --version`, then `corepack enable` once |
| PowerShell | 7.x (`pwsh`) | `$PSVersionTable.PSVersion` |

The stack runs entirely in containers, so Node on the host is needed only for tests and builds. Corepack provides the pinned Yarn 4 (`packageManager` in `package.json`), so do not install Yarn globally.

If `corepack enable` fails with `EPERM` (common with nvm-windows or a Node installation in a protected folder), either run it once from an elevated terminal, or skip it and type `corepack yarn …` wherever this guide says `yarn …`. For example, `corepack yarn workspace api test`.

Default host ports:
- `3000`: API;
- `5173`: web;
- `5432`: PostgreSQL.

If one of them is taken, see [Port conflicts](#port-conflicts) before starting.

## 1. Clone and create the environment file

```powershell
git clone <repository-url> cashlens
cd cashlens
./scripts/init-local-env.ps1
git check-ignore -v apps/api/.env
```

1. `init-local-env.ps1` copies `apps/api/.env.example` to `apps/api/.env` and replaces `JWT_SECRET`, `EMAIL_TOKEN_ENCRYPTION_KEY`, and `GMAIL_OAUTH_STATE_SECRET` with random values.
   - It never prints a generated value.
   - It refuses to write a file that is not git-ignored, and it never overwrites an existing file without `-Force`.
2. `git check-ignore -v` must print a `.gitignore` rule for `apps/api/.env`. If it prints nothing, stop: the file could be committed.
3. `apps/api/.env` is read in two places:
   - by Docker Compose, when you pass it with `--env-file`, which is how the generated secrets reach the containers;
   - by host-side tools such as Prisma and the tests.

   Every value in it is either random or a development placeholder. See the comments in [`apps/api/.env.example`](../../apps/api/.env.example) for each variable.

### Port conflicts

Add overrides to `apps/api/.env` **before the first start**:

| Taken port | Add to `apps/api/.env` |
|---|---|
| 3000 (API) | `API_HOST_PORT="13000"` and `VITE_API_BASE_URL="http://localhost:13000/api"`, and change `GMAIL_REDIRECT_URI` to port 13000 if you use Gmail |
| 5432 (PostgreSQL) | `POSTGRES_HOST_PORT="55432"`, and change the port in `DATABASE_URL` (used by host-side tools) to `55432` |
| 5173 (web) | Free the port: the development web port is fixed at 5173, because it is also the default `CORS_ORIGIN` |

The rest of this guide uses the default ports. Replace `3000` and `5432` with your overrides.

## 2. Start and stop the stack

```powershell
docker compose --env-file apps/api/.env up -d
docker compose --env-file apps/api/.env ps
```

`docker-compose.yml` starts three containers:

| Container | Starts after | Healthy when |
|---|---|---|
| `cashlens-postgres` | nothing | `pg_isready` succeeds |
| `cashlens-api` | the database is healthy | `GET /api/health/ready` answers 200 |
| `cashlens-web` | the API is healthy | the Vite dev server answers |

On the **first start**, the containers install dependencies into named volumes, which takes several minutes; later starts are fast. The API also:
1. applies database migrations (`prisma migrate deploy`);
2. generates the Prisma client;
3. starts in watch mode.

If a migration fails, the chain stops and the API never becomes healthy (see [Troubleshooting](troubleshooting.md#migration-failure)).

Wait until `ps` shows all three as `healthy`, then check readiness:

```powershell
Invoke-RestMethod http://localhost:3000/api/health/ready
```

It answers `success: True` with `data` `{status: ready, database: up}`.

| Service | URL |
|---|---|
| Web app | `http://localhost:5173` (sign-in and registration at `/`, the app under `/app/...`) |
| API | `http://localhost:3000/api` |
| API readiness / liveness | `http://localhost:3000/api/health/ready`, `/api/health/live` |
| API documentation (Swagger UI) | `http://localhost:3000/api/docs` |
| PostgreSQL | `localhost:5432`, user `cashlens`, database `cashlens_db` (development defaults) |

Follow the logs with `docker compose --env-file apps/api/.env logs -f api`.

**Stop, restart, and reset:**

| Command | Effect |
|---|---|
| `docker compose --env-file apps/api/.env stop` / `start` | Stop and start the containers; all data is kept |
| `docker compose --env-file apps/api/.env restart api` | Restart the API. Needed after code changes when your file system does not deliver change events into the container, which is common with Docker Desktop bind mounts. Restart `web` the same way. |
| `docker compose --env-file apps/api/.env down` | Remove the containers; the **database and dependency volumes are kept** |
| `docker compose --env-file apps/api/.env down -v` | **Deletes all local data** (database and installed dependencies); the next start reinstalls everything |

In development the API runs under the Nest watch process, so `stop` and `restart` do not wait for a graceful application shutdown, and no shutdown line is logged. The release image does stop gracefully and logs `Application shut down gracefully (signal SIGTERM)`; `verify-release.ps1` checks this. A sync that was interrupted by a restart is shown as `EXPIRED` and can be run again. Data is never lost on a restart.

## 3. Database migrations

Migrations live in `apps/api/prisma/migrations` and are applied **automatically** when the API container starts. To apply them by hand, which is repeatable and does nothing when the database is up to date:

```powershell
docker compose --env-file apps/api/.env exec api yarn workspace api prisma migrate deploy
```

This release adds five migrations. They apply strictly in this order after the existing baseline, `20260627090000_budgets_goals_alerts_dashboard`:

| Order | Migration | Adds |
|---|---|---|
| DB-M1 | `20260924100000_email_sync_progress` | Sync continuation and lease fields, run counts |
| DB-M2 | `20260924100100_transaction_deduplication` | The duplicate fingerprint and its evidence |
| DB-M3 | `20260924120000_classification_events` | System rules and the append-only classification history |
| DB-M4 | `20260924130000_alert_lifecycle` | Alert status, condition keys, and the open-alert unique index |
| DB-M5 | `20260924130100_alert_delivery` | Email delivery records |

Never edit a migration that has been applied. `apps/api/test/scripts/verify-migrations.ps1` checks the history, an empty database, an upgrade from the baseline, and a repeated deploy. It uses a PostgreSQL maintenance URL, which defaults to the development database on `localhost:$env:POSTGRES_HOST_PORT` (default 5432):

```powershell
./apps/api/test/scripts/verify-migrations.ps1
```

**Seed data comes from migrations.** There is no separate seed command:
- bank providers `bank_vcb`, `bank_tcb`, `bank_mbb`, `bank_acb`;
- the system transaction categories.

Parser templates are not seeded. An administrator loads them (section 5).

## 4. First administrator (development)

No network request can grant the administrator role. Register an account in the web app, then promote it from the host:

```powershell
docker compose --env-file apps/api/.env exec api yarn workspace api admin:bootstrap --email <your-email>
```

It prints `Promoted to administrator; audit record written.` and exits 0.
- It refuses while another active administrator exists (exit 3).
- It lists administrators with `--list-admins`.
- It removes the role with `--revoke --email <email>`.

All exit codes are in [Troubleshooting](troubleshooting.md#admin-bootstrap-exit-codes).

## 5. Parser templates and email

- **Email delivery** is off by default (`EMAIL_TRANSPORT="disabled"`). Alerts still appear in the app, and eligible deliveries are recorded as skipped. For local debugging you may set `EMAIL_TRANSPORT="log"`, which logs a redacted delivery (recipient domain only) instead of sending. Production rejects `log`.
- **Parser templates.** The declared template is `apps/api/test/fixtures/parser-templates/bank_vcb-email-v1.json` (see [Supported parsers](supported-parsers.md)). Load it as an administrator:

  ```powershell
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-RestMethod -Method Post http://localhost:3000/api/auth/login -WebSession $session -ContentType 'application/json' -Body (@{ email = '<admin-email>'; password = '<admin-password>' } | ConvertTo-Json)
  Invoke-RestMethod -Method Post http://localhost:3000/api/parser-templates -WebSession $session -ContentType 'application/json' -InFile apps/api/test/fixtures/parser-templates/bank_vcb-email-v1.json
  ```

  The Playwright global setup (section 6) loads the declared templates automatically.
- **Gmail:** [Gmail OAuth](gmail-oauth.md) explains how to create a Google test client and set the `GMAIL_*` values in `apps/api/.env`.

## 6. Tests and builds

Install the dependencies on the host once. The containers have their own copy.

```powershell
corepack enable
yarn install --immutable
yarn workspace api prisma generate
```

`prisma generate` creates the database client that the API tests and build need. Rerun it after every schema change.

| What | Command | Needs |
|---|---|---|
| API unit tests | `yarn workspace api test` | nothing else |
| API integration tests | `yarn workspace api test:e2e` | `E2E_DATABASE_URL` (below) and the database container |
| Web component tests (Vitest) | `yarn workspace web test` | nothing else |
| **Everything above, in one gate** | `yarn quality` runs lint, type checks, build, unit/component tests, and `yarn contract:check` (the API contract chain). Run it before every commit. | `prisma generate` done |
| Lint (check only) | `yarn workspace api lint` and `yarn workspace web lint`; `yarn workspace api lint:fix` applies automatic fixes | nothing else |
| Browser tests (Playwright, Chromium) | `yarn workspace web test:e2e:install` once, then `yarn workspace web test:e2e` | the running development stack |
| API build | `yarn workspace api build` | output `apps/api/dist/src/main.js` |
| Web build | `yarn workspace web build` | output `apps/web/dist` |
| Type checks | `yarn check-types` (both workspaces: API sources and tests; web app, Vite config, and Playwright specs) | `prisma generate` done |

**Integration test database.**
- The integration tests use their own database, never the development one. Its name **must contain `test`**, or the tests refuse to run.
- The tests create it if it is missing and apply migrations themselves.
- Set it in the shell or in `apps/api/.env`:

```powershell
$env:E2E_DATABASE_URL = 'postgresql://cashlens:cashlens_password@localhost:5432/cashlens_test?schema=public'
yarn workspace api test:e2e
```

**Browser tests.**
- They open `E2E_BASE_URL` (default `http://localhost:5173`) and call `E2E_API_URL` (default `http://localhost:3000/api`).
- Their global setup registers a run-scoped administrator, promotes it with `docker compose exec api yarn workspace api admin:bootstrap`, and loads the declared parser templates.
- Only one administrator can be promoted. If the development database already has another one, for example the account from the Smoke flow, setup fails with `admin:bootstrap --email failed (exit 3)`. Revoke that account first (`admin:bootstrap --revoke --email <email>`) or use a fresh stack. Earlier `e2e-admin-…@example.test` accounts are revoked automatically.
- Set both variables when you use port overrides, for example `$env:E2E_API_URL = 'http://localhost:13000/api'`.
- Traces and screenshots are kept only for failures (`apps/web/test-results`, git-ignored).

**Secret scan.** Run it before you push:

```powershell
./scripts/scan-secrets.ps1
```

- It runs a pinned gitleaks image through Docker over the working tree and the feature history.
- It exits 0 when clean, 1 on findings, and 2 when it could not scan. The history scan needs a full clone, not a shallow one.
- Git-ignored files, such as `apps/api/.env`, are never read.

For release images and the production stack, see [Deployment](deployment.md).

## Smoke flow

This is the SC-001 walkthrough. The clock starts at `git clone`, and the flow ends at step 5. It assumes that sections 1 and 2 are done, with the stack started.

1. **Services ready.**
   - `docker compose --env-file apps/api/.env ps` shows `cashlens-postgres`, `cashlens-api`, and `cashlens-web` as `healthy`.
   - `Invoke-RestMethod http://localhost:3000/api/health/ready` returns `status: ready`.
2. **Register.**
   1. Open `http://localhost:5173`, choose **Tạo tài khoản**, and fill in **Họ và tên**, **Email**, and **Mật khẩu** (at least 8 characters). Submit.
   2. The page shows "Tài khoản đã được tạo. Hãy đăng nhập để tiếp tục."
   3. Sign in with the same email and password (**Đăng nhập**). You land on `/app/dashboard`.
3. **Promote the first administrator.**

   ```powershell
   docker compose --env-file apps/api/.env exec api yarn workspace api admin:bootstrap --email <the email from step 2>
   ```

   It prints `Promoted to administrator; audit record written.`
4. **Create one transaction.**
   1. Open **Giao dịch** (`/app/transactions`) and click **Thêm giao dịch**.
   2. In **Thêm giao dịch thủ công**, choose **Chi**, enter **Số tiền** `50000` and **Mô tả** `Smoke test`, and keep today's date.
   3. Click **Thêm giao dịch**. The transaction appears in the list.
5. **The dashboard shows it for the current month.** Open **Tổng quan** (`/app/dashboard`). The dashboard is headed **Dòng tiền ròng · Tháng MM/YYYY** for the current month, and **Smoke test** with **-50.000₫** (an expense) appears among the recent transactions. **This is the SC-001 stop point.**
