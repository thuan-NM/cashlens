import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * T099: the headless clean-user smoke flow, a release blocker. One run-scoped
 * user (`e2e-user-<run id>@example.test`) walks the operational MVP through
 * the UI against the development compose stack, with the T096a global setup
 * (run-scoped admin, declared parser templates). Nothing is mocked: there is
 * no `page.route` stubbing, no Google, and no SMTP. Every expectation about
 * computed values (month, totals, feasibility) is read from the real API.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const FIXTURE = join(REPO_ROOT, "apps", "api", "test", "fixtures", "email", "bank_vcb", "EMAIL", "v1", "valid", "01-debit-qr-payment.json");

type Envelope<T> = { success: boolean; data: T };
type Overview = { month: string; currency: string; transactionCount: number; expense: number; timeZone?: string | null };
type Feasibility = {
  goalId: string;
  status: string;
  months: number;
  monthsRequired?: number | null;
  feasibilityScore?: number | null;
  reason: string;
};
type EmailFixture = {
  message: { from: string; subject: string; receivedAt: string; body: string[] };
  expected: { amount: number; currency: string; direction: string; transactionTime: string; description: string };
};

/** The web app's VND format (`formatMoney`): vi-VN digit grouping, then "₫". */
const vnd = (value: number) => `${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}₫`;
/** "2026-09" -> "09/2026", as `formatMonthKey` shows it. */
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

const apiUrl = () => {
  const url = process.env.E2E_API_URL;
  if (!url) throw new Error("E2E_API_URL is not set: the T096a global setup did not run");
  return url.replace(/\/$/, "");
};

/** GET an API resource with the page's session cookies and unwrap the envelope. */
const apiGet = async <T>(request: APIRequestContext, path: string): Promise<T> => {
  const response = await request.get(`${apiUrl()}/${path}`);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as Envelope<T>).data;
};

/** Runs SQL against the development database; values must already be quoted. */
const psql = (sql: string): string => {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "cashlens", "-d", "cashlens_db", "-v", "ON_ERROR_STOP=1", "-qtAX"],
    { cwd: REPO_ROOT, encoding: "utf8", input: sql, timeout: 60_000 },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed (exit ${result.status}): ${(result.stderr || result.stdout || "").slice(-1000)}`);
  }
  return result.stdout.trim();
};

/** A PostgreSQL dollar-quoted literal whose tag cannot occur in the value. */
const literal = (value: string) => {
  let tag = "e2e";
  while (value.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${value}$${tag}$`;
};

/**
 * The "Tổng chi" summary block. Only HTML labels: the dashboard's donut chart
 * also carries a hidden SVG `<text>` with that label.
 */
const totalExpense = (page: Page) => page.getByText("Tổng chi", { exact: true }).and(page.locator("div")).locator("..");

/** Adds a manual transaction through the transactions page modal. */
const addTransaction = async (page: Page, amount: number, description: string) => {
  await page.getByRole("button", { name: "Thêm giao dịch" }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm giao dịch thủ công" });
  await expect(dialog).toBeVisible();
  await dialog.getByText("Chi", { exact: true }).click();
  await dialog.getByLabel("Số tiền").fill(String(amount));
  await dialog.getByLabel("Mô tả").fill(description);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/transactions$/.test(response.url()));
  await dialog.getByRole("button", { name: "Thêm giao dịch" }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(description) })).toBeVisible();
};

test("clean user: register, record, configure, budget alert, goal, email import", async ({ page }) => {
  test.setTimeout(300_000);
  const runId = process.env.E2E_RUN_ID;
  if (!runId) throw new Error("E2E_RUN_ID is not set: the T096a global setup did not run");
  const user = {
    email: `e2e-user-${runId}@example.test`,
    password: `E2e-${randomBytes(12).toString("base64url")}!9`,
    name: `E2E User ${runId}`,
  };

  await test.step("2. register and log in through the UI", async () => {
    await page.goto("/");
    const form = page.locator("form");
    await page.locator(".ant-segmented").getByText("Tạo tài khoản").click();
    await form.getByLabel("Họ và tên").fill(user.name);
    await form.getByLabel("Email").fill(user.email);
    await form.getByLabel("Mật khẩu").fill(user.password);
    const registered = page.waitForResponse((response) => response.url().endsWith("/auth/register"));
    await form.locator("button[type=submit]").click();
    expect((await registered).status()).toBe(201);
    await expect(page.getByText("Tài khoản đã được tạo. Hãy đăng nhập để tiếp tục.")).toBeVisible();

    // Back in login mode: sign in with what was just registered.
    await expect(form.getByLabel("Họ và tên")).toHaveCount(0);
    await form.getByLabel("Email").fill(user.email);
    await form.getByLabel("Mật khẩu").fill(user.password);
    await form.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByText(user.email).first()).toBeVisible();
  });

  const description = `E2E cà phê ${runId}`;
  const firstAmount = 50_000;
  await test.step("3. create a transaction; the dashboard shows it for the current month", async () => {
    await page.goto("/app/transactions");
    await addTransaction(page, firstAmount, description);

    await page.goto("/app/dashboard");
    const overview = await apiGet<Overview>(page.request, "dashboard/overview");
    expect(overview.transactionCount).toBe(1);
    expect(overview.expense).toBe(firstAmount);
    await expect(page.getByText(`Dòng tiền ròng · Tháng ${monthLabel(overview.month)}`)).toBeVisible();
    // The innermost block holding both the description and the amount: its row.
    const recent = page
      .locator("div")
      .filter({ has: page.getByText(description, { exact: true }) })
      .filter({ hasText: vnd(firstAmount) })
      .last();
    await expect(recent).toBeVisible();
    await expect(recent).toContainText(vnd(firstAmount));
    const counted = page.getByText("Giao dịch được tính tháng này").locator("..");
    await expect(counted).toContainText(String(overview.transactionCount));
    await expect(totalExpense(page)).toContainText(vnd(overview.expense));
  });

  await test.step("4. a settings change persists after reload", async () => {
    const threshold = 20_000_000;
    await page.goto("/app/settings");
    const input = page.getByRole("spinbutton", { name: "Ngưỡng giao dịch lớn" });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("");
    await input.fill(String(threshold));
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/alerts/settings"));
    await page.getByRole("button", { name: "Lưu ngưỡng" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByText("Đã lưu cài đặt cảnh báo")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("spinbutton", { name: "Ngưỡng giao dịch lớn" })).toHaveValue(/^20[.,]?000[.,]?000$/);
  });

  const budgetName = `E2E ngân sách ${runId}`;
  const criticalTitle = `Budget "${budgetName}" reached its limit`;
  await test.step("5. a budget created in the UI; a transaction pushes it over; an alert appears", async () => {
    await page.goto("/app/budgets");
    await page.getByRole("button", { name: "Tạo ngân sách" }).click();
    const dialog = page.getByRole("dialog", { name: "Tạo ngân sách mới" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Tên ngân sách").fill(budgetName);
    await dialog.getByLabel("Hạn mức").fill("100000");
    await dialog.getByLabel("Ngưỡng cảnh báo").fill("80");
    const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/budgets$/.test(response.url()));
    await dialog.getByRole("button", { name: "Tạo ngân sách" }).click();
    expect((await created).status()).toBe(201);
    await expect(dialog).toBeHidden();
    // All expense categories: the step 3 expense already uses half of it.
    const card = page.getByTestId(/^budget-/).filter({ hasText: budgetName });
    await expect(card).toContainText("50%");
    await expect(card.getByTestId("budget-threshold")).toHaveText("Cảnh báo ở 80% · nghiêm trọng ở 100%");

    // Below the threshold: no alert for this budget yet.
    const before = await page.request.get(`${apiUrl()}/alerts?status=ACTIVE`);
    expect(before.status()).toBe(200);
    expect(JSON.stringify(await before.json())).not.toContain(budgetName);

    await page.goto("/app/transactions");
    await addTransaction(page, 60_000, `E2E ăn trưa ${runId}`);

    await page.goto("/app/budgets");
    await expect(page.getByTestId(/^budget-/).filter({ hasText: budgetName })).toContainText("110%");

    await page.goto("/app/alerts");
    const alert = page.getByTestId(/^alert-/).filter({ hasText: criticalTitle });
    await expect(alert).toBeVisible();
    await expect(alert.getByTestId("alert-status")).toHaveText("Đang mở");
    await expect(alert).toContainText("Ngân sách");
    await expect(alert).toContainText("110");
    await expect(page.getByTestId("unread-count")).not.toHaveText(/^(0|…|-)$/);
  });

  const goalName = `E2E mục tiêu ${runId}`;
  await test.step("6. a goal created in the UI shows its real feasibility result", async () => {
    await page.goto("/app/goals");
    await page.getByRole("button", { name: "Tạo mục tiêu" }).click();
    const dialog = page.getByRole("dialog", { name: "Tạo mục tiêu tài chính" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Tên mục tiêu").fill(goalName);
    await dialog.getByLabel("Số tiền mục tiêu").fill("12000000");
    await dialog.getByLabel("Hoặc số tháng (không bắt buộc)").fill("6");
    const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/goals$/.test(response.url()));
    await dialog.getByRole("button", { name: "Tạo mục tiêu" }).click();
    expect((await created).status()).toBe(201);
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Khả năng hoàn thành · ${goalName}`)).toBeVisible();

    const goals = await apiGet<{ id: string; name: string }[]>(page.request, "goals");
    const goal = goals.find((item) => item.name === goalName);
    expect(goal, "the created goal is listed by the API").toBeTruthy();
    const result = await apiGet<Feasibility>(page.request, `goals/${goal!.id}/simulation`);
    expect(result.goalId).toBe(goal!.id);

    await expect(page.getByText(`Cần tiết kiệm mỗi tháng trong ${result.months} tháng`)).toBeVisible();
    if (result.status === "INSUFFICIENT_DATA") {
      // A fresh ledger has no completed month: the API refuses to guess.
      await expect(page.getByText("Chưa đủ dữ liệu để đánh giá")).toBeVisible();
      await expect(page.getByText(`Cần thêm ${result.monthsRequired} tháng hoàn chỉnh`)).toBeVisible();
      await expect(page.getByText("Chưa đủ lịch sử giao dịch để đánh giá khả năng tích lũy.")).toBeVisible();
    } else {
      await expect(page.getByText(new RegExp(`Điểm khả thi ${result.feasibilityScore}/100`))).toBeVisible();
    }
  });

  await test.step("7. fixture-backed email import", async () => {
    /*
     * Stand-in for the Gmail fetch only. The Gmail client talks to Google's
     * hardcoded URLs, so the development stack cannot sync a real mailbox.
     * Instead this step writes, straight into the development database, the
     * same two rows a sync writes for one matched bank email: an ACTIVE GMAIL
     * `EmailConnection` and a PENDING `EmailMessage`. Raw bodies are never
     * stored (EMAIL-012), so the declared fixture's body goes into the legacy
     * `snippet` column, which is the only stored text the parser reads
     * without a sync. The tokens are obvious non-secret placeholders: this
     * connection must never be synced (no "Đồng bộ ngay" click below). The
     * parse itself is the real API (`POST /email-messages/:id/parse`) with
     * the real declared VCB template loaded by the global setup.
     */
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as EmailFixture;
    const mailbox = `e2e-mailbox-${runId}@example.test`;
    const messageId = psql(`
SET client_encoding = 'UTF8';
SET TIME ZONE 'UTC';
WITH u AS (
  SELECT id FROM "User" WHERE email = ${literal(user.email)}
), c AS (
  INSERT INTO "EmailConnection" (id, "userId", provider, "emailAddress", "accessTokenEncrypted", "refreshTokenEncrypted", "tokenExpiresAt", status, "updatedAt")
  SELECT 'e2e_' || md5(random()::text), u.id, 'GMAIL'::"EmailProvider", ${literal(mailbox)},
         'e2e-fixture-not-a-token', 'e2e-fixture-not-a-token', now() + interval '30 days', 'ACTIVE'::"EmailConnectionStatus", now()
  FROM u
  RETURNING id, "userId"
)
INSERT INTO "EmailMessage" (id, "userId", "emailConnectionId", "providerMessageId", "senderEmail", "senderName", subject, snippet, "receivedAt", "bankProviderId", "processingStatus", "updatedAt")
SELECT 'e2e_' || md5(random()::text), c."userId", c.id, ${literal(`e2e-msg-${runId}`)}, 'notify@vcb.example.test', 'Vietcombank',
       ${literal(fixture.message.subject)}, ${literal(fixture.message.body.join("\n"))}, ${literal(fixture.message.receivedAt)}::timestamptz,
       'bank_vcb', 'PENDING'::"EmailProcessingStatus", now()
FROM c
RETURNING id;
`);
    expect(messageId, "the seeded email message id (empty: the smoke user was not found)").toMatch(/^e2e_[0-9a-f]{32}$/);

    const parse = () => page.request.post(`${apiUrl()}/email-messages/${messageId}/parse`, { data: {} });
    const first = await parse();
    expect(first.ok(), `parse status ${first.status()}`).toBe(true);
    const parsed = ((await first.json()) as Envelope<{ transactionId?: string; created: boolean }>).data;
    expect(parsed.transactionId, `parse result ${JSON.stringify(parsed)}`).toBeTruthy();
    expect(parsed.created).toBe(true);
    // Idempotent: a repeated parse links to the same transaction.
    const again = ((await (await parse()).json()) as Envelope<{ transactionId?: string; created: boolean }>).data;
    expect(again).toEqual({ transactionId: parsed.transactionId, created: false });

    const imported = await apiGet<{ amount: number | string; direction: string; description: string; currency: string }>(
      page.request,
      `transactions/${parsed.transactionId}`,
    );
    expect(Number(imported.amount)).toBe(fixture.expected.amount);
    expect(imported.direction).toBe(fixture.expected.direction);
    expect(imported.currency).toBe(fixture.expected.currency);
    expect(imported.description).toBe(fixture.expected.description);

    // The imported row is dated in the fixture's month: pick it in the list.
    const overview = await apiGet<Overview>(page.request, "dashboard/overview");
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: overview.timeZone ?? "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date(fixture.expected.transactionTime));
    const monthKey = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;

    await page.goto("/app/transactions");
    await page.locator(".ant-select").filter({ has: page.getByRole("combobox", { name: "Tháng" }) }).click();
    await page.locator(".ant-select-dropdown:visible").getByTitle(`Tháng ${monthLabel(monthKey)}`).click();
    const row = page.getByRole("button", { name: new RegExp(fixture.expected.description) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(vnd(fixture.expected.amount));
    await expect(totalExpense(page)).toContainText(vnd(fixture.expected.amount));

    // The email page has no message list; it shows the (seeded) connection.
    await page.goto("/app/email");
    await expect(page.getByText(mailbox)).toBeVisible();
    const messages = await page.request.get(`${apiUrl()}/email-messages`);
    expect(messages.status()).toBe(200);
    const payload = ((await messages.json()) as Envelope<unknown>).data;
    const rows = (Array.isArray(payload) ? payload : (payload as { data: unknown[] }).data) as { id: string; processingStatus: string }[];
    expect(rows.find((item) => item.id === messageId)?.processingStatus).toBe("PARSED");
  });
});
