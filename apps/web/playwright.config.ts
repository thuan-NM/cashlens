import { defineConfig, devices } from "@playwright/test";

/**
 * The only browser E2E runner (T096a, research.md "Browser E2E runner"):
 * Playwright, headless Chromium only, against the DEVELOPMENT compose stack
 * (`docker compose up`, NODE_ENV=development). Production HTTPS behavior is
 * T012 (in-process) and T100 (reference release host), not this runner.
 *
 * - `E2E_BASE_URL`: the web app, default the Vite dev server.
 * - `E2E_API_URL`: the API, default http://localhost:3000/api. Set both when
 *   the stack runs on other host ports (API_HOST_PORT).
 *
 * Nothing here reaches Google or an SMTP server: the stack runs with its
 * default EMAIL_TRANSPORT=disabled, and email import uses synthetic fixtures.
 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
export const E2E_API_URL = process.env.E2E_API_URL ?? "http://localhost:3000/api";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./test-results",
  // One clean-user journey at a time against one shared stack.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: E2E_BASE_URL,
    headless: true,
    // Diagnostics on failure only; artifacts stay in git-ignored folders.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
