# Troubleshooting

Each entry lists the **symptom** you can observe, how to **diagnose** it, and the **fix**. Commands use the development stack; for a deployment, replace `docker compose --env-file apps/api/.env` with `docker compose --env-file <env> -f docker-compose.prod.yml`.

## Correlation-ID diagnosis

Every API response carries a correlation id:
- in the `x-correlation-id` header;
- in the body: `correlationId` in both success and error envelopes.

The API generates a fresh UUID for every request and ignores any value a client sends. Every log line written while serving that request carries the same value, as `correlationId` and `req.id`.

1. Copy the `correlationId` from the failing response. In the browser, it is in the network tab's response body or headers.
2. Find the matching log lines:

   ```powershell
   docker compose --env-file apps/api/.env logs api | Select-String <correlationId>
   ```

3. Read the `event` field:
   - `request.failed` is a 5xx, with `errorCode`, `route`, `errorName`, and `prismaCode`;
   - `request.rejected` is a request refused before routing;
   - `auth.login_failed`, `auth.refresh_rejected`;
   - `email.sync.*`, `parser.failed`, and `alert.delivery.*` cover the pipelines.

Logs never contain passwords, tokens, cookies, OAuth codes or state, SMTP credentials, request bodies, email content, or provider responses; they are redacted as `[REDACTED]`. A 500 response always has the message "Internal server error". The details are only in the `request.failed` log line.

## Startup and configuration validation

| Symptom | Diagnosis | Fix |
|---|---|---|
| The API container restarts in a loop, or exits with code 1 | `logs api` shows one `app.start_failed` line whose `configIssues` lists `VARIABLE: reason`, never the value | Correct each listed variable in the env file, then run `up -d` |
| `must not be a known placeholder value` | Production refuses values from `.env.example` (`replace-with-…`, `change-me`, `cashlens_password`, `<…>`) | Generate real secrets (`./scripts/init-local-env.ps1 -Profile release-test -PublicOrigin … -OutFile …`) |
| `must use https in production` / `must not be disabled in production` | `CORS_ORIGIN`, `GMAIL_REDIRECT_URI`, or `APP_PUBLIC_URL` is http, or `COOKIE_SECURE=false` | Use the https public origin; leave `COOKIE_SECURE` unset or `true` |
| `the redacted log transport is not allowed in production` | `EMAIL_TRANSPORT=log` | Use `disabled` or `smtp` |
| Compose aborts with `… is required` | `docker-compose.prod.yml` requires the variable, but the env file lacks it | Add it, then compare the file with [Deployment](deployment.md#2-configuration) |

## Port conflicts

| Symptom | Diagnosis | Fix |
|---|---|---|
| `up` fails with `port is already allocated` or `address already in use` | Another program uses 3000, 5173, or 5432 (development), or 3000/8080 (production). On Windows, `Get-NetTCPConnection -LocalPort 3000 -State Listen` shows the owner. | In development, set `API_HOST_PORT` with a matching `VITE_API_BASE_URL`, or `POSTGRES_HOST_PORT`, in `apps/api/.env` (see [Local development](local-development.md#port-conflicts)). In production, set `API_HOST_PORT`/`WEB_HOST_PORT` and update the proxy upstreams. |
| `container name "/cashlens-api" is already in use` | The development containers have fixed names, so only one development stack can run per host | Stop the other stack first (`docker compose down`, run in its folder) |

## Database readiness and outages

| Symptom | Diagnosis | Fix |
|---|---|---|
| `GET /api/health/ready` returns 503 `SERVICE_UNAVAILABLE`, while `/api/health/live` returns 200 | The API runs but cannot use PostgreSQL. Readiness runs `SELECT 1` with a 2 s timeout. | `ps` for the database container; `logs postgres` |
| Data requests return 503 `SERVICE_UNAVAILABLE` "Service temporarily unavailable" | The database connection was lost; `request.failed` carries a `prismaCode` such as `P1001` | Start the database (`start postgres`). The API recovers without a restart once readiness returns 200. |
| The database container is unhealthy after a host crash | `logs postgres` shows recovery or disk errors | Free disk space. If the volume is damaged, restore from backup ([Deployment](deployment.md#6-backup-and-restore)). |

## Migration failure

| Symptom | Diagnosis | Fix |
|---|---|---|
| **Production:** `api` never starts; `ps` shows `migrate` exited non-zero | `logs migrate` shows a failed migration, an unreachable database, or an incompatible schema | Fix the cause (database reachability, disk). If a migration failed half-way, restore the pre-upgrade backup, or roll back to the previous images. **Never edit an applied migration.** |
| **Development:** `cashlens-api` stays `starting` or `unhealthy` | `logs api` shows `prisma migrate deploy` failing. The start command stops there, so the API never serves against the wrong schema. | Same as above. For a disposable local database only, `down -v` resets everything. |
| `migrate deploy` reports drift or a modified migration | Someone edited a migration folder | Restore the folder from git; `./apps/api/test/scripts/verify-migrations.ps1` shows which check fails |

## Authentication and sessions

| Symptom | Diagnosis | Fix |
|---|---|---|
| Sign-in returns 401 "Invalid email or password" | Wrong credentials, or the account is not active (disabled or deleted). The message is identical for all of these on purpose. `auth.login_failed` in the log has the reason. | Check the account |
| Every sign-in **through the proxy** returns 403 `HTTPS_REQUIRED` | See the next section | Fix `TRUST_PROXY` |
| The user is signed out unexpectedly | The refresh cookie expired (`JWT_REFRESH_EXPIRES_IN_DAYS`), `POST /api/auth/logout-all` was called, an administrator disabled the account, or a refresh token was replayed: `auth.refresh_rejected` with `ALREADY_ROTATED` | Sign in again |
| In development, the browser gets CORS errors | The web origin is not `CORS_ORIGIN` (default `http://localhost:5173`) | Open the web app on the configured origin |

### `TRUST_PROXY` misconfiguration

- **Symptom:** in production, every sign-in, registration, or refresh through the proxy returns **403 `HTTPS_REQUIRED`**, or cookies lack the `Secure` attribute.
- **Diagnosis:**
  1. Confirm the proxy sends `X-Forwarded-Proto: https`.
  2. Find the peer address the API saw for a proxied request, by searching the request log for its correlation id:

     ```powershell
     docker compose --env-file <env> -f docker-compose.prod.yml logs api | Select-String <correlationId>
     ```

     `req.remoteAddress` is the proxy peer, for example `::ffff:172.28.0.1`.
  3. Compare that address with `TRUST_PROXY`.
- **Fix:** set `TRUST_PROXY` in the env file so it covers the observed address, run `up -d`, and rerun `./scripts/verify-release.ps1`. Its "TRUST_PROXY covers the observed proxy peer" check must pass. See [Deployment](deployment.md#trust_proxy-verify-never-assume).

## Admin bootstrap exit codes

`bootstrap-admin` runs as `yarn workspace api admin:bootstrap` in development, or `node dist/src/scripts/bootstrap-admin.js` in the production image. It prints one line and exits with one of these codes:

| Exit | Output | Meaning and action |
|---|---|---|
| 0 | `Promoted to administrator; audit record written.` | Done |
| 0 | `No change: the account is already an administrator.` | Rerun; nothing to do |
| 0 | `Administrator role removed; audit record written.` / `No change: the account is not an administrator.` | `--revoke` result |
| 1 | `Usage: bootstrap-admin --email <email> \| --list-admins \| --revoke --email <email>` | Fix the arguments |
| 1 | `Configuration or database error: <ErrorName> (code <code>)` | The configuration is invalid or the database is unreachable; the code is a Prisma or SQLSTATE code, such as `P2028` for a transaction timeout. Check the env file and database health, then retry. |
| 2 | `Refused: the account is missing, disabled, deleted, or not self-registered.` | Register the account in the web app first, with a password, and make sure it is active |
| 2 | `Refused: no account with that email exists.` | `--revoke` for an unknown email |
| 3 | `Refused: an active administrator already exists.` | Only one bootstrap is allowed. Review with `--list-admins`; to replace an administrator, `--revoke` the old one first. |

## Gmail and OAuth

| Symptom | Diagnosis | Fix |
|---|---|---|
| Google shows `redirect_uri_mismatch` | The authorized redirect URI in Google Cloud differs from `GMAIL_REDIRECT_URI`, often by port or scheme | Make them identical |
| **Kết nối Gmail** fails with 503 `SERVICE_UNAVAILABLE` "GMAIL_CLIENT_ID is not configured" | The OAuth client is not configured (optional in development) | Set the `GMAIL_*` variables ([Gmail OAuth](gmail-oauth.md#2-google-cloud-setup-operator)) |
| The callback returns 401 "Invalid OAuth state" / "OAuth state expired" | The flow took more than 10 minutes, finished in another browser, or `GMAIL_OAUTH_STATE_SECRET` changed during the flow | Start connecting again |
| The callback returns 502 "…token exchange failed" or "…did not grant offline access" | Google refused the code (wrong client secret), or consent was not granted for offline access | Check `GMAIL_CLIENT_SECRET`; connect again and approve |
| After consent, the browser shows JSON instead of the app | Expected: the callback answers with the connection and does not redirect | Go back to `/app/email` |
| The connection shows **Cần kết nối lại**; sync returns 503 `RECONNECT_REQUIRED` | Google refused the stored grant (`invalid_grant`, or a 401/403 auth error), for example after the test-user token expiry or a revoked permission. `gmail.reconnect_required` is in the log. | The user clicks **Kết nối lại Gmail** |
| Sync returns 500 `INTERNAL_ERROR` for an existing connection after a key change | `EMAIL_TOKEN_ENCRYPTION_KEY` changed, so the stored tokens cannot be decrypted | Mark the connections reconnect-required ([Deployment](deployment.md#8-key-rotation)); users reconnect |

## Sync and stale sync state

| Symptom | Diagnosis | Fix |
|---|---|---|
| 400 "At least one enabled listen rule is required" | No enabled rule | Add or enable a rule ([Gmail OAuth](gmail-oauth.md#4-listen-rules)) |
| 409 `SYNC_IN_PROGRESS` "Một lượt đồng bộ khác đang chạy" | Another run holds the connection's lease | Wait. A crashed run's lease expires after 5 minutes, and the run then shows as **Bị gián đoạn** (`EXPIRED`). |
| The last run is `EXPIRED` | The run stopped before finishing (restart, crash, lost lease, or disconnect), and its progress was not saved | Sync again; it resumes from the last saved position |
| The run is `PARTIAL_FAILED` with **Còn email** | The run stopped at its bound (50 messages or about 25 s), or Gmail rate-limited it after some work | Click **Tiếp tục đồng bộ** until `hasMore` is false |
| The run is `FAILED`: "Gmail is temporarily unavailable; sync again later" | Gmail stayed rate-limited or unreachable after 3 attempts with backoff (`email.sync.finished` with a failure class) | Sync again later; the position is kept |
| A proxy returns 504 on sync | The proxy's read timeout is shorter than the sync request, which can take about a minute | Allow at least 90 s on `POST /api/email-connections/{id}/sync` |
| A repeated-sync-failure alert is shown | The last three finished runs failed or were interrupted | Fix the underlying cause; the alert resolves after a successful run |

## Parser failures

| Symptom | Diagnosis | Fix |
|---|---|---|
| A message is `FAILED` with a code such as `INVALID_AMOUNT: amount` | The template matched, but the value failed validation. Codes: `MISSING_REQUIRED_FIELDS`, `INVALID_AMOUNT`, `INVALID_CURRENCY`, `INVALID_DATETIME`, `AMBIGUOUS_DIRECTION`, `AMBIGUOUS_VALUE`, `PARSER_ERROR`. | Check the email format against [Supported parsers](supported-parsers.md). A changed bank format needs a new template version with fixtures. |
| `NO_TEMPLATE_MATCHED` / `NO_BANK_PROVIDER` | No active template for the bank, or the rule has no bank and the sender is not a verified bank sender | Load the template (administrator); set `bankProviderId` on the listen rule |
| `PROCESSING_FAILED` | The message failed 3 times for temporary reasons and was given up | Look for `email.sync.unexpected_error` in the logs |
| Re-parsing returns 409 `EMAIL_BODY_UNAVAILABLE` | Bodies are never stored, so a stored message cannot be parsed again | Expected in this release |

## Alerts and email delivery

- **No scheduler.** Alerts are evaluated only when an action triggers them:
  - creating, editing, reclassifying, ignoring, or deleting a transaction;
  - a sync that created transactions, and the end of every sync run;
  - creating or changing a budget or goal;
  - connecting, disconnecting, or losing a Gmail connection.

  A condition that becomes true only because **time passed** is noticed at the user's next qualifying action, for example a cooldown that expired or a month that completed. This is the expected "alert appears only after the next action" behavior, not a fault.
- **Delivery records.** Each eligible alert occurrence has one email delivery record:

  | Status | Meaning |
  |---|---|
  | `SKIPPED` | With a reason: `TRANSPORT_DISABLED` (email is off), `NOT_CRITICAL` (only CRITICAL alerts are emailed), `EMAIL_DISABLED` (the user turned email off for the type), or `NOTIFICATIONS_DISABLED` |
  | `SENT` | Accepted by the SMTP relay |
  | `FAILED` | The SMTP attempts failed. Failure codes: `TIMEOUT`, `CONNECTION`, `TEMPORARY` (these were retried), `REJECTED`, `AUTH`. Check the SMTP settings and `alert.delivery.failed` or `alert.delivery.attempt_failed` in the logs. |
  | `FAILED` with `INTERRUPTED` | The API stopped (restart or crash) while the delivery was pending. After the total budget plus 30 s it is marked "The delivery was interrupted and was not resent". It is **never resent automatically**, so no duplicate email is sent. |

  In every case the alert itself stays visible in the app. The records are marked on the next alert evaluation or alert list.

## Retention and deletion

- **Transactions.** Deleting one marks it deleted. It disappears from every list, total, budget, and goal, and stays protected by owner-only access.
- **Email.**
  - Email bodies are never stored.
  - Message metadata stays for duplicate prevention and troubleshooting: ids, sender, subject, received time, body hash, and status.
  - Disconnecting Gmail erases the stored tokens but keeps the imported transactions, message metadata, and sync history.
- **Accounts.** Financial records stay until the user deletes them or the account enters a future deletion workflow.
  - There is no self-service account deletion or data export in this release; both are post-MVP.
  - An administrator can disable or soft-delete an account (`PATCH`/`DELETE /api/users/{id}`), which also revokes its sessions.
  - The `dataRetentionDays` setting is stored but not enforced in this release.
