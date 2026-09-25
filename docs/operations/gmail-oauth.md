# Gmail OAuth and email import

CashLens imports bank notification emails from Gmail with **read-only** access. It never asks for, receives, or stores a Gmail password. This page covers the Google setup, how a user connects and syncs, what is stored, and the errors users and operators will see.

This document contains no usable credentials and no real email. Every address and value below is a placeholder.

## 1. Consent scope

CashLens requests exactly one scope, `https://www.googleapis.com/auth/gmail.readonly`. It asks for offline access (`access_type=offline`, `prompt=consent`), so it receives a refresh token and can sync later without asking again.

- Tokens are stored encrypted (AES-256-GCM with `EMAIL_TOKEN_ENCRYPTION_KEY`).
- Tokens never appear in API responses, logs, audit records, or notifications.

## 2. Google Cloud setup (operator)

1. In the Google Cloud console, create a project or choose one, and **enable the Gmail API**.
2. Configure the **OAuth consent screen** and add the `gmail.readonly` scope.
3. Create an **OAuth client ID** of type **Web application** and add one **authorized redirect URI**. It must equal `GMAIL_REDIRECT_URI` exactly:

   | Environment | Redirect URI |
   |---|---|
   | Development (default ports) | `http://localhost:3000/api/email-connections/gmail/callback` |
   | Development with `API_HOST_PORT=<port>` | `http://localhost:<port>/api/email-connections/gmail/callback` |
   | Production | `https://<public-origin>/api/email-connections/gmail/callback` (https is required) |

4. Put the client values in the API configuration: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REDIRECT_URI`, plus `GMAIL_OAUTH_STATE_SECRET` (at least 32 random characters) and `EMAIL_TOKEN_ENCRYPTION_KEY`.
   - **Development:** `docker-compose.yml` reads these from the env file you pass with `--env-file`. They are optional; without a client, **Kết nối Gmail** fails with 503 `SERVICE_UNAVAILABLE` ("GMAIL_CLIENT_ID is not configured").
   - **Production:** see [Deployment](deployment.md#2-configuration). All five are required, and placeholders are rejected at startup.

### Test accounts and limitations

- While the consent screen's publishing status is **Testing**, only the Google accounts you list as **test users** can connect.
- `gmail.readonly` is a restricted scope. Google documents that refresh tokens issued to an app with an external user type in **Testing** status expire after 7 days. When that happens, the next sync reports **reconnect required** (section 5), and the user reconnects. Publishing the app for real users requires Google's verification of the restricted scope.
- Use a dedicated test mailbox for development. The only declared parser reads a **synthetic** Vietcombank-style format; see [Supported parsers](supported-parsers.md).

## 3. Connecting (user)

On the **Email** page (`/app/email`):
1. Click **Kết nối Gmail**. The API returns a Google authorization URL, and the browser opens Google's consent screen.
2. Approve read-only access. Google redirects the browser to the API callback, `/api/email-connections/gmail/callback`.
3. The callback checks the signed `state` and a nonce cookie, both valid for 10 minutes, and stores the connection.
4. The browser returns to the **Email** page, which shows **Đã kết nối Gmail**; the connection is listed as **Đang hoạt động**.
   - The callback redirects to the web origin from configuration (the first `CORS_ORIGIN`), never to an address taken from the request.
   - The address carries only a fixed outcome: `?gmail=connected`, or `?gmail=failed&reason=STATE_INVALID|GOOGLE_REFUSED|GOOGLE_UNAVAILABLE|FAILED`. It never carries a token, the code, the state, or an error message. The page shows a fixed message for the outcome and removes it from the address.
   - An API client that does not ask for HTML (no `Accept: text/html`) still gets the enveloped connection as JSON, or the error body.

For the callback to succeed:
- Finish the flow in the **same browser** within 10 minutes. The nonce cookie is scoped to the callback path.
- In production the callback must arrive over HTTPS, or it returns 403 `HTTPS_REQUIRED`.
- Reconnecting the same Gmail address reuses its connection record.

**Disconnect** with **Ngắt kết nối** on the Email page, then confirm with **Ngắt kết nối Gmail** (API: `DELETE /api/email-connections/{id}`).
- It revokes the refresh token at Google on a best-effort basis, then always erases the stored tokens and marks the connection disconnected. A running sync is marked expired.
- Imported transactions and sanitized sync and parse history are **kept**.

## 4. Listen rules

A sync imports only messages that match at least one **enabled** listen rule. Without an enabled rule, sync is refused with 400 "At least one enabled listen rule is required".

| Field | Meaning |
|---|---|
| `name` | Required label (up to 120 characters) |
| `emailConnectionId` | Limits the rule to one connection; empty means every connection of the user |
| `bankProviderId` | The seeded bank, such as `bank_vcb`, whose parser templates apply |
| `senderEmail` / `senderDomain` | Exact sender address, or sender domain (lowercased) |
| `subjectContains` / `bodyContains` | Case-insensitive text filters |
| `syncFromDate` | Earliest message date to import |
| `isEnabled`, `priority` | Rules are tried in ascending `priority` (default 100); the first rule whose criteria all hold wins |

- **The Email page** creates rules with a name, a sender address, and a sender domain. Every other field is available through the API: `GET/POST /api/email-listen-rules` and `PATCH/DELETE /api/email-listen-rules/{id}`.
- The rule switch on the page saves `isEnabled` immediately (`PATCH /api/email-listen-rules/{id}`). If saving fails, the page shows **Không thể lưu rule** and the switch returns to the stored value.
- A message that matches no rule is not stored at all.

## 5. Manual sync, continuation, and reconnect

There is **no scheduler**: every sync is started by the user with **Đồng bộ ngay** (`POST /api/email-connections/{id}/sync`).

**Bounds of one run:**
- **Initial backfill:** messages from the earliest `syncFromDate` of the enabled rules, or the last **30 days** when no rule sets one. The boundary is fixed on the first run.
- **One run** processes at most **50** messages, and stops taking new ones after about **25 seconds**. At least one message is always attempted, and the whole request finishes in about a minute. Production proxies must allow 90 s on this route; see [Deployment](deployment.md#1-topology-and-the-tls-boundary).
- **Continuation:**
  - When more messages remain, the run reports `hasMore`. The page shows **Còn email** and **Tiếp tục đồng bộ**; each click continues from the saved position.
  - Later syncs are incremental from the last completed window, overlapping it by 10 minutes, and provider ids prevent duplicates.
  - Changing the rules starts a new window.
- **One run at a time per connection:** a second request gets 409 `SYNC_IN_PROGRESS` ("Một lượt đồng bộ khác đang chạy"). A run that crashes releases its lease after 5 minutes and is then shown as **Bị gián đoạn** (`EXPIRED`); its progress was not saved.

**Run results** are listed at `GET /api/email-connections/{id}/sync-runs`, newest first, up to 50:

| Status | Page label | Meaning |
|---|---|---|
| `RUNNING` | Đang chạy | In progress |
| `SUCCESS` | Thành công | Every processed message was handled |
| `PARTIAL_FAILED` | Thành công một phần | Some messages failed, or the run stopped early for a provider reason after handling some |
| `FAILED` | Thất bại | The run failed before handling any message |
| `EXPIRED` | Bị gián đoạn | The run lost its lease (crash, restart, or disconnect) |

Each run records its found, matched, parsed, created, and failed counts, and a sanitized failure summary.

**Connection states** and what the user does:

| Status | Page shows | Recovery |
|---|---|---|
| `ACTIVE` | Đang hoạt động | Nothing to do |
| `ERROR` | Lần đồng bộ trước thất bại | **Thử đồng bộ lại** |
| `EXPIRED` | Cần kết nối lại | **Kết nối lại Gmail**. Google refused the stored grant (`invalid_grant`, or a 401/403 auth error). Sync is refused with 503 `RECONNECT_REQUIRED` until the user reconnects. A reconnect-required alert is also raised. |
| `REVOKED` | Đã ngắt kết nối | Connect again |

**Rate limits and provider errors.**
- A Gmail rate limit (429, or 403 `rateLimitExceeded`/`userRateLimitExceeded`/`quotaExceeded`) or a server error is retried up to **3 times per request**. The retries use exponential backoff from 500 ms up to 4 s and honour `Retry-After` up to 5 s.
- If Gmail still refuses, the run stops with "Gmail is temporarily unavailable; sync again later", keeps its position, and the next sync resumes the same page.
- A message that keeps failing for temporary reasons is given up after **3** attempts and marked `FAILED` (`PROCESSING_FAILED`), so it cannot block its page forever.
- Three consecutive failed or interrupted runs raise a repeated-sync-failure alert.

## 6. Parsing and duplicates

- **Parsing.** Each matched message is parsed with the active template of its bank; templates are loaded by an administrator (see [Supported parsers](supported-parsers.md)).
  - Only a complete, valid result becomes a posted transaction.
  - Otherwise the message is marked `FAILED` with a code and field names only, such as `INVALID_AMOUNT: amount`. The codes are `MISSING_REQUIRED_FIELDS`, `INVALID_AMOUNT`, `INVALID_CURRENCY`, `INVALID_DATETIME`, `AMBIGUOUS_DIRECTION`, `AMBIGUOUS_VALUE`, `NO_BANK_PROVIDER`, `NO_TEMPLATE_MATCHED`, and `PARSER_ERROR`.
- **Duplicates.** An event that was already imported is linked to its existing transaction, never duplicated. The check uses, in order, the provider message id, the bank transaction identity, and a deterministic fingerprint.
- **Messages:** `GET /api/email-messages` (filter by `emailConnectionId` or `processingStatus`: `PENDING`, `PARSED`, `FAILED`) and `GET /api/email-messages/{id}/parser-runs`.

## 7. What is stored and retention

| Stored | Not stored |
|---|---|
| Provider message/thread/history ids, the Message-ID header, sender, subject, received time, a SHA-256 hash of the body, processing status, matched rule, bank, sanitized error code, and the derived transaction | **The email body.** It is read only in memory during parsing (EMAIL-012). Parser runs keep sanitized evidence only. |

- **Raw email bodies:** the "keep raw email body" setting cannot be turned on in this release. `PATCH /api/users/me/settings` with `storeRawEmailBody: true` is rejected with 400 `RAW_EMAIL_BODY_UNAVAILABLE`, and Settings shows the option as unavailable.
- **Re-parsing:** because bodies are not stored, a stored message cannot be re-parsed later. `POST /api/email-messages/{id}/parse` answers 409 `EMAIL_BODY_UNAVAILABLE` unless the message already has a transaction. A message fixed by a new template version must arrive through a new sync.
- **Retention:** message metadata and imported transactions stay until the user deletes the transaction or the account enters a future deletion workflow; account-wide export and deletion are post-MVP. Disconnecting Gmail erases the tokens but keeps this history.

## 8. Common errors

| What the user sees | Code | Meaning and action |
|---|---|---|
| "Không thể bắt đầu kết nối Gmail" | 503 `SERVICE_UNAVAILABLE` | The OAuth client is not configured; the operator sets the `GMAIL_*` variables |
| Google shows `redirect_uri_mismatch` | none (from Google) | The authorized redirect URI differs from `GMAIL_REDIRECT_URI`; make them identical, including the port and https |
| Callback: "Invalid OAuth state" / "OAuth state expired" (browser: **Không thể kết nối Gmail**, `reason=STATE_INVALID`) | 401 `UNAUTHORIZED` | The flow took more than 10 minutes or changed browsers; start connecting again |
| Callback: "Gmail did not grant offline access…" | 502 | Connect again and approve access |
| Callback: "Gmail OAuth token exchange failed" | 502 | Google refused the code; check the client secret, then connect again |
| "Gmail tạm thời không khả dụng" | 503 `SERVICE_UNAVAILABLE` | Google was unreachable or rate-limited; sync again later |
| "Cần kết nối lại Gmail" | 503 `RECONNECT_REQUIRED` | Reconnect Gmail |
| "Một lượt đồng bộ khác đang chạy" | 409 `SYNC_IN_PROGRESS` | Wait for the running sync to finish |
| "At least one enabled listen rule is required" | 400 `BAD_REQUEST` | Add or enable a listen rule |

Every error response carries a `correlationId`. Operators can find the matching log lines with it; see [Troubleshooting](troubleshooting.md#correlation-id-diagnosis).
