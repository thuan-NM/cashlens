import { expect, test } from "@playwright/test";

/** T096a first gate: the sign-in page opens headlessly in Chromium. */
test("the sign-in page opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Đăng nhập/ }).first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});
