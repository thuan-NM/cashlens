# Deployment

This guide deploys the CashLens Operational MVP as **one small single-host installation**: one web container, one API container, and one PostgreSQL container, behind an HTTPS reverse proxy that you provide. Multi-node and horizontally scaled deployments are post-MVP.

Everything runs from [`docker-compose.prod.yml`](../../docker-compose.prod.yml). All commands below run from the repository root of a checkout of the release commit. Replace `<env>` with the path of your deployment env file.

```powershell
docker compose --env-file <env> -f docker-compose.prod.yml <command>
```

## 1. Topology and the TLS boundary

```text
Internet ──443──► reverse proxy (TLS, HSTS, http→https)
                     ├── /api/…  ──► http://127.0.0.1:3000   (api container; path kept, including /api)
                     └── /…      ──► http://127.0.0.1:8080   (web container)
api ──► postgres (private network cashlens_net, 172.28.0.0/24, not published)
```

- **One public origin.** The browser only ever talks to `https://<public-origin>`. The web image is built with the relative API path `/api`, so authentication cookies stay same-origin, with credentials, and need no cross-site exception.
- **Your proxy terminates TLS.** The repository ships no certificates. The proxy must:
  - route `/api/` to `http://127.0.0.1:3000` **with the path preserved**: no trailing slash on the upstream, so `/api/health/ready` reaches the API as `/api/health/ready`;
  - route every other path to `http://127.0.0.1:8080`;
  - send `X-Forwarded-Proto: https` and the original `Host`;
  - redirect plain HTTP to HTTPS and send `Strict-Transport-Security`;
  - allow **at least 90 seconds** on `POST /api/email-connections/{id}/sync`. A manual Gmail sync is one synchronous request of up to about a minute, and nginx defaults to 60 s.

  [`scripts/release/reference-proxy.nginx.conf`](../../scripts/release/reference-proxy.nginx.conf) is an illustrative nginx configuration that does all of this. It passes `nginx -t` on nginx 1.24 and current stable. Replace its `<release-test-host>`, `<certificate.pem>`, and `<private-key.pem>` placeholders, and its two upstream ports if you change `API_HOST_PORT` or `WEB_HOST_PORT`.
- **Loopback-only ports.** The compose file publishes the API on `127.0.0.1:${API_HOST_PORT:-3000}` and the web on `127.0.0.1:${WEB_HOST_PORT:-8080}`. PostgreSQL is not published at all. Only the proxy is reachable from outside.
- **HTTPS is enforced by the API.** In production:
  - every origin and callback must be `https`;
  - cookies carry `Secure; HttpOnly; SameSite=Lax`;
  - sign-in and other session-issuing requests that did not arrive over HTTPS get **403 `HTTPS_REQUIRED`**. Health endpoints are exempt, so `http://127.0.0.1:3000/api/health/ready` works locally.

- **API documentation.** The API serves Swagger UI at `/api/docs` (JSON at `/api/docs-json`) in every mode, so it is reachable through the proxy. It describes routes, not data. Block the path in your proxy if you do not want it public.

### `TRUST_PROXY`: verify, never assume

The API believes `X-Forwarded-Proto` only when the connection comes from an address listed in `TRUST_PROXY`. The value is a comma-separated list of `loopback`, `linklocal`, `uniquelocal`, IP addresses, or CIDR ranges.

1. Start with `TRUST_PROXY=loopback,172.28.0.1`: loopback plus the pinned gateway of `cashlens_net`. If your proxy is a container attached to `cashlens_net`, use its fixed IP instead.
2. Run [`scripts/verify-release.ps1`](../../scripts/verify-release.ps1) (section 7). It sends a request through the proxy, reads the `remoteAddress` the API logged for it, and fails unless `TRUST_PROXY` covers that address. It prints the observed address and the effective `TRUST_PROXY`.
3. Put the verified value in your env file.

Docker's forwarding differs between engines and hosts. On one Docker Desktop test host, for example, the API saw `::ffff:172.28.0.1`. Always use the address `verify-release.ps1` observed. When `TRUST_PROXY` is wrong, every sign-in through the proxy fails with 403 `HTTPS_REQUIRED`; see [Troubleshooting](troubleshooting.md#trust_proxy-misconfiguration).

## 2. Configuration

Configuration comes **only** from an env file passed with `--env-file`. Keep it **outside the repository**, readable only by the operator account. The API validates it at startup and refuses to start on any problem. It logs one `app.start_failed` event naming the variables and reasons, never the values.

Generate a starting file with random secrets. `-OutFile` may point anywhere outside the repository:

```powershell
./scripts/init-local-env.ps1 -Profile release-test -PublicOrigin https://<public-origin> -OutFile <path-outside-repo>/cashlens.env
```

That profile writes synthetic Gmail client values that never work against Google. Replace `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` with your real OAuth client (see [Gmail OAuth](gmail-oauth.md)). Review every other value.

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | yes | Used by the PostgreSQL container **when it first creates the volume** |
| `DATABASE_URL` | yes | `postgresql://<user>:<password>@postgres:5432/<db>?schema=public`, where the host is the compose service `postgres` |
| `JWT_SECRET` | yes | At least 32 random characters |
| `EMAIL_TOKEN_ENCRYPTION_KEY` | yes | At least 32 characters. Encrypts stored Gmail tokens. |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | yes | Google OAuth web client |
| `GMAIL_REDIRECT_URI` | yes | `https://<public-origin>/api/email-connections/gmail/callback` |
| `GMAIL_OAUTH_STATE_SECRET` | yes | At least 32 random characters |
| `CORS_ORIGIN` | yes | `https://<public-origin>` with no path, and https only |
| `APP_PUBLIC_URL` | with SMTP | `https://<public-origin>`, used for links in alert emails |
| `TRUST_PROXY` | yes (the compose default is `loopback,172.28.0.1`) | See "`TRUST_PROXY`: verify, never assume" |
| `EMAIL_TRANSPORT` | no (default `disabled`) | `disabled` or `smtp`. `log` is rejected in production. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | with `smtp` | `SMTP_SECURE=true` means implicit TLS; otherwise STARTTLS is required |
| `EMAIL_ATTEMPT_TIMEOUT_MS`, `EMAIL_TOTAL_BUDGET_MS` | no | Defaults `5000` and `12000` |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE` | no | Defaults `true` and `lax`; production rejects `COOKIE_SECURE=false` |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN_DAYS`, `LOG_LEVEL` | no | Defaults `15m`, `30`, and `info` |
| `API_HOST_PORT`, `WEB_HOST_PORT` | no | Loopback ports, defaults `3000` and `8080` |

Production also rejects every known placeholder value from `apps/api/.env.example`. The full list of variables, with their tags, is in [`apps/api/.env.example`](../../apps/api/.env.example).

### Email: SMTP or disabled

- **`EMAIL_TRANSPORT=disabled`**, the default, keeps CashLens fully operational: alerts still appear in the app, and eligible email deliveries are recorded as skipped.
- **`EMAIL_TRANSPORT=smtp`** sends eligible **CRITICAL** alerts, one email per alert occurrence, to users who enabled email for that alert type.
  - It needs `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, and `APP_PUBLIC_URL`, plus `SMTP_USER`/`SMTP_PASSWORD` if your relay authenticates.
  - Each attempt has a 5 s timeout, with up to 3 attempts inside a 12 s total budget.
  - A delivery failure never removes the in-app alert.

## 3. The reference release host and the release-test profile

Release verification is **authoritative** only on the reference release host:
- Linux x86_64 running **Docker Engine**, not Docker Desktop;
- at least 2 vCPU, 4 GB RAM, and SSD storage;
- the reference proxy terminating TLS for a release-test hostname, with a certificate from your CA or a local test CA that the check scripts trust through `NODE_EXTRA_CA_CERTS`.

Results from any other host, including Docker Desktop, are informative only.

The release-test env file comes from `./scripts/init-local-env.ps1 -Profile release-test -PublicOrigin https://<release-test-host>`. It writes `.env.release-test` at the repository root, which is **git-ignored and must never be committed**. It holds synthetic values only, and `EMAIL_TRANSPORT=disabled`.

## 4. First deployment

```powershell
# 1. Build immutable images from the release commit.
docker compose --env-file <env> -f docker-compose.prod.yml build
# 2. Apply migrations with the one-off tools container. It exits non-zero on any failure.
docker compose --env-file <env> -f docker-compose.prod.yml run --rm migrate
# 3. Start the stack. The api waits for a healthy database and a successfully completed migrate.
docker compose --env-file <env> -f docker-compose.prod.yml up -d
docker compose --env-file <env> -f docker-compose.prod.yml ps
```

**Migration order.** `up -d` also runs `migrate` and starts `api` only if `migrate` completed successfully, so the API never starts against an incompatible schema. Migrations are applied in folder order from `apps/api/prisma/migrations`, and a repeated deploy is a no-op.

**Health.**
- `GET /api/health/live` checks that the process is up.
- `GET /api/health/ready` returns 200 only when PostgreSQL is usable, and 503 otherwise.
- The compose health checks use readiness for `api` and `/` for `web`.
- Check both locally and through the proxy:

```powershell
curl.exe -fsS http://127.0.0.1:3000/api/health/ready
curl.exe -fsS https://<public-origin>/api/health/ready
```

### First administrator (SEC-009)

No network request can create an administrator. An operator with host access promotes an existing, active, **self-registered** account:

1. Register the account in the web app at `https://<public-origin>`.
2. Promote it from the host:

   ```powershell
   docker compose --env-file <env> -f docker-compose.prod.yml exec api node dist/src/scripts/bootstrap-admin.js --email <email>
   ```

The command refuses (exit 3) while another active administrator exists, and rerunning it for the same account changes nothing (exit 0). All exit codes are in [Troubleshooting](troubleshooting.md#admin-bootstrap-exit-codes).

**Break-glass reuse.** If every administrator is lost (disabled, deleted, or credentials unknown), run the same command for another self-registered account. It succeeds whenever no **active** administrator remains. Every promotion and revocation writes an audit record.

## 5. Upgrades

1. Take a backup (section 6).
2. Check out the new release commit and `build`.
3. Run `run --rm migrate`, then `up -d`.
4. Verify health.

Existing data is kept, because the named volume `cashlens_prod_postgres_data` survives `down`. Never run `down -v` on a deployment.

**Upgrade notes for this release:**
- **Administrator review.** Before this release, an administrator could have been created in other ways. After upgrading, list the administrators and revoke any you did not approve:

  ```powershell
  docker compose --env-file <env> -f docker-compose.prod.yml exec api node dist/src/scripts/bootstrap-admin.js --list-admins
  docker compose --env-file <env> -f docker-compose.prod.yml exec api node dist/src/scripts/bootstrap-admin.js --revoke --email <email>
  ```

- **Email alert preferences are preserved.** Newly created alert settings default to email **off**. Settings stored before this release keep their values. Accounts created under the previous default may therefore have email enabled for **budget** alerts, and will receive budget CRITICAL emails as soon as you configure `EMAIL_TRANSPORT=smtp`.
- **Raw email bodies.** Raw bodies are never stored in this release. A stored "keep raw email body" preference is kept as it is, has no effect, and is shown as unavailable in Settings.
- **New migrations in this release** (applied in this order): `20260924100000_email_sync_progress`, `20260924100100_transaction_deduplication`, `20260924120000_classification_events`, `20260924130000_alert_lifecycle`, `20260924130100_alert_delivery`.

## 6. Backup and restore

PostgreSQL holds all durable state, in the `cashlens_prod_postgres_data` volume. Back it up with `pg_dump` inside the database container, then copy the dump out. The container's own `POSTGRES_USER`/`POSTGRES_DB` variables are used, so no credentials appear on the command line. The dump is written inside the container, so this works the same in any shell:

```powershell
docker compose --env-file <env> -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/cashlens.dump'
docker compose --env-file <env> -f docker-compose.prod.yml cp postgres:/tmp/cashlens.dump ./cashlens-<date>.dump
docker compose --env-file <env> -f docker-compose.prod.yml exec -T postgres rm /tmp/cashlens.dump
```

Restore into a stopped application, so nothing writes during the restore:

```powershell
docker compose --env-file <env> -f docker-compose.prod.yml stop api web
docker compose --env-file <env> -f docker-compose.prod.yml cp ./cashlens-<date>.dump postgres:/tmp/cashlens.dump
docker compose --env-file <env> -f docker-compose.prod.yml exec -T postgres sh -c 'pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner /tmp/cashlens.dump'
docker compose --env-file <env> -f docker-compose.prod.yml exec -T postgres rm /tmp/cashlens.dump
docker compose --env-file <env> -f docker-compose.prod.yml start api web
```

Keep the dump together with the env file that belongs to it. Stored Gmail tokens can be read only with the same `EMAIL_TOKEN_ENCRYPTION_KEY` (see section 8). Test a restore on a scratch host before you rely on it.

## 7. Release verification and rollback

`./scripts/verify-release.ps1` checks a clean checkout end to end with the release-test profile:
- the secret scan, the migration matrix, and the API contract chain (`yarn contract:check`);
- the compose configuration and the build;
- migrate before the API starts, and rejection of an `http://` origin;
- through the proxy: the web app and bundle, health, `Secure` cookies, and `TRUST_PROXY`;
- direct-HTTP refusal;
- the admin bootstrap and review;
- restart persistence, dependency outage, and graceful shutdown.

It never deletes volumes, and it refuses to run against a project that already has containers.

```powershell
./scripts/verify-release.ps1 -ReferenceHost -HostDescription "<host, OS, vCPU, RAM, disk>"
```

| Exit code | Meaning |
|---|---|
| 0 | Every check passed on the reference host (authoritative) |
| 3 | Every check passed on another host (**informative only**, not a release gate) |
| 1 | A check failed |
| 2 | A prerequisite is missing |

Use `-ProxyAddress <ip>` when the release-test hostname has no DNS, and `-CaCert <pem>` to trust a test CA.

**Rollback.** Migrations only move forward; never edit or delete an applied migration.
- **The new release added no migration:** start the previous images again, or check out and build the previous commit, then run `up -d`.
- **The new release added migrations:** restore the backup taken before the upgrade (section 6), then start the previous release.

Tag the images you deploy, for example `docker tag cashlens-api:release cashlens-api:<commit>`, so that the previous images stay available.

## 8. Key rotation

| Secret | What happens when it changes |
|---|---|
| `JWT_SECRET` | Current access tokens (15 minutes) stop verifying. Refresh sessions are random tokens stored hashed, independent of this secret, so the web app renews access automatically. A write that fails during the switch returns 401 and must be repeated. |
| `EMAIL_TOKEN_ENCRYPTION_KEY` | Stored Gmail tokens become unreadable, and sync on an existing connection fails with 500 `INTERNAL_ERROR`. The API does not detect this by itself. After rotating the key, mark every live connection as needing reconnection (the SQL below). Its user then sees **Kết nối lại Gmail** and reconnects. Imported transactions are not affected. |
| `GMAIL_OAUTH_STATE_SECRET` | Gmail connect flows that are in progress fail; the user starts connecting again. |
| `GMAIL_CLIENT_SECRET` | Rotate it in Google Cloud and in the env file together. Existing refresh tokens stay valid for the same client. |
| Database password | PostgreSQL reads `POSTGRES_PASSWORD` only when it creates the volume. Change the role's password inside the database (`ALTER ROLE`), then update both `POSTGRES_PASSWORD` and `DATABASE_URL`. |

After rotating `EMAIL_TOKEN_ENCRYPTION_KEY`, mark live Gmail connections as reconnect-required:

```powershell
'UPDATE "EmailConnection" SET status = ''EXPIRED'', "updatedAt" = now() WHERE status IN (''ACTIVE'', ''ERROR'') AND "disconnectedAt" IS NULL;' |
  docker compose --env-file <env> -f docker-compose.prod.yml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB'
```

After any change, restart the affected services with `up -d`. Compose recreates containers whose configuration changed.

## 9. Logs, redaction, and the secret scan

- **Logs:** `docker compose --env-file <env> -f docker-compose.prod.yml logs api` shows structured JSON (pino).
  - Every request line and every event carries a `correlationId`; the same value is returned in the `x-correlation-id` header and in every response body.
  - Passwords, tokens, cookies, authorization headers, OAuth codes and state, SMTP credentials, request bodies, email content, and provider responses are redacted or never logged.
  - Use `LOG_LEVEL` to change verbosity.
- **Secret scan:** before a release, run `./scripts/scan-secrets.ps1`.
  - It uses a pinned gitleaks image to scan the working tree and the feature history, and exits 0 when clean, 1 on findings, and 2 when the scan could not complete.
  - Your deployment env file lives outside the repository, and `.env.release-test` is git-ignored.
