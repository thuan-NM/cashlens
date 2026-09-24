# Supported parsers

This page declares the email parsers that the Operational MVP supports (FR-08, EMAIL-010, SC-005). The release gate reads the declaration table below. It checks each declared parser on its own and does not average across parsers.

## Declaration

The table between the two markers is machine-readable. Keep one row per parser and do not change the column order.

<!-- supported-parsers:begin -->
| Bank | Channel | Version | Template | Fixtures |
|---|---|---|---|---|
| bank_vcb | EMAIL | 1 | apps/api/test/fixtures/parser-templates/bank_vcb-email-v1.json | apps/api/test/fixtures/email/bank_vcb/EMAIL/v1 |
<!-- supported-parsers:end -->

### Columns

| Column | Meaning |
|---|---|
| Bank | A seeded `BankProvider` id, such as `bank_vcb` (Vietcombank) |
| Channel | The `ParserChannel`; only `EMAIL` exists in this release |
| Version | The parser template version |
| Template | The parser-template definition that an administrator loads through `POST /api/parser-templates` |
| Fixtures | A folder with a `valid/` and a `malformed/` subfolder |

## The declared parser: `bank_vcb` EMAIL v1

This parser reads a **synthetic** Vietcombank-style balance-change email, written in Vietnamese:

```text
Loại giao dịch: Ghi nợ
Số tiền: -1,250,000 VND
Thời gian: 20/06/2026 15:30:00
Số tham chiếu: FT26171ABC12
Nội dung: Thanh toan QR tai CIRCLE K
Số dư: 8,750,000 VND
```

> **Not yet confirmed against real bank email.** The format is our own model of a balance-change notification, not a copy of a real Vietcombank message. Before an operator relies on it for a real mailbox, compare it with a real notification. If the layout differs, publish a new template version together with matching fixtures.

The parser follows these rules. `ParserEngineService` enforces them, and the T039 unit tests pin them down.

- **Fields.**
  - Each field reads one labelled line: the pattern is anchored at the start of a line (indentation is allowed), and it never continues onto the next line.
  - The parser reads the whole value after the label and then validates it; a value it cannot read exactly is refused, never cut short.
  - If several patterns are given for one field, they are tried in order, and the first one that matches wins.
  - The body is read in composed Unicode (NFC).
  - Money, currency, direction, and time values longer than 64 characters are refused. Free text is cut to 500 characters.
- **Order of checks.** The checks run in this order:
  1. Required fields (amount, direction, and time) must be present; otherwise the parse fails as `MISSING_REQUIRED_FIELDS`.
  2. A fact (amount, currency, direction, time, transaction code, or balance) that appears twice with different values fails as `AMBIGUOUS_VALUE`; a repeat of the same value is fine.
  3. The amount must be valid.
  4. The direction must be valid.
  5. The currency must be valid.
  6. The time must be valid.

  The first check that fails decides the failure. A failure is stored as `CODE: field[, field…]`, for example `INVALID_AMOUNT: amount`, and never with the text it read.

- **Direction.** Direction comes from the `Loại giao dịch` label: `Ghi nợ` or `Debit` is an expense, and `Ghi có` or `Credit` is income.
  - The label must be a known direction label, ignoring diacritics and letter case: `Ghi nợ`, `Báo nợ`, `Nợ`, `Debit`, `DR`, `Trừ tiền`, `Chi`, or `Chi tiền` for an expense; `Ghi có`, `Báo có`, `Có`, `Credit`, `CR`, `Nhận tiền`, or `Cộng tiền` for income.
  - A label may combine forms of the same direction, such as `Ghi có (Credit)`.
  - Anything else fails as `AMBIGUOUS_DIRECTION`, including a sentence that merely contains a direction word (`Credit card payment`, `Chi nhánh Hà Nội`).
  - A sign on the amount may confirm the direction but never contradict or replace it. A contradiction also fails as `AMBIGUOUS_DIRECTION`.
- **Amount.**
  - The amount is always stored as a positive value.
  - `vnd_money` counts whole dong. Thousands separators may be `,`, `.`, or spaces (including no-break and thin spaces), as long as the same one is used throughout, and the first group is never `0`.
  - A Unicode minus sign counts as a minus.
  - One currency word may follow the number; any other text after it makes the amount unreadable.
  - An all-zero fraction such as `.00` is accepted. Any other fraction fails as `INVALID_AMOUNT`.
  - A zero amount, or an amount above the supported maximum of 9,999,999,999,999.99, also fails as `INVALID_AMOUNT`.
- **Currency.**
  - `VND`, `VNĐ`, `đ`, `Đ`, `₫`, and `đồng` are read as `VND`, in any letter case.
  - Any other value must be an ISO 4217 spending currency, such as `USD`; otherwise the parse fails as `INVALID_CURRENCY`. X-codes (`XXX`, `XTS`, precious metals) and fund codes (`BOV`, `USN`, …) are refused.
  - When the amount line names no currency, the currency is `VND`.
- **Time.** Times are read as wall-clock time in `Asia/Ho_Chi_Minh` (UTC+07:00), never in the server's time zone. A date without a time means local midnight. The value must be exactly `dd/mm/yyyy` with an optional 24-hour `hh:mm[:ss]`, in the years 1900–2099; a 12-hour time, an explicit zone, or an impossible date or time fails as `INVALID_DATETIME`.
- **Optional fields.** The transaction code must be one alphanumeric token; anything else, such as `N/A` or `FT26171-ABC12`, means no code, so two different transactions never share a truncated code. The description (`Nội dung`) and the transaction code are trimmed. A balance (`Số dư`) that cannot be read is dropped; it never fails the parse.
- **Identity.**
  - The transaction code `Số tham chiếu` identifies the transaction. Case and whitespace are ignored.
  - If there is no code, the transaction falls back to a fingerprint over bank, direction, currency, amount, the minute in UTC, and the balance.
  - Only a matching transaction code with the same amount, direction and currency proves a repeat, so nothing new is created.
  - A fingerprint match, or a reused code whose facts differ, creates the transaction flagged as a suspected duplicate of the first. It is kept out of totals until the user clears the flag, so a real transaction is never dropped. Example: two purchases in the same minute with the same amount, where the email shows no balance, share a fingerprint.

## Fixtures

A fixture is a JSON file with the following fields:

- `description`
- `message`, which holds `from`, `subject`, `receivedAt` and `body` (an array of lines)
- for a file in `valid/`: `expected`, the exact normalized transaction, written by hand;
- for a file in `malformed/`: `expectedFailure`, the sanitized failure code.

The gate requires each declared parser to have at least 10 valid fixtures and 2 malformed ones. Fixtures use only reserved test domains (`*.example.test`) and synthetic account numbers.

## Release gate

`apps/api/test/parser-fixture-rates.e2e-spec.ts` (T048) runs every declared parser through the real parse pipeline. It fails in these cases:

- no parser is declared, or the declaration table is unreadable or empty;
- any single parser's rate falls below 85%, where the rate is the number of valid fixtures that produce exactly the expected transaction, divided by the number of valid fixtures;
- a parser has fewer than 10 valid fixtures or fewer than 2 malformed ones;
- any malformed fixture creates a transaction.

The gate prints one row per parser as release evidence.
