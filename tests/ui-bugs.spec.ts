import { test, expect, type Page } from "@playwright/test";
import { login, resetData } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetData(request);
});

async function addFromDetail(page: Page, productId: number, quantity: number) {
  await page.goto(`/product/${productId}`);
  await page.getByTestId("quantity-select").selectOption(String(quantity));
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("detail-message")).toBeVisible();
}

async function fillCheckout(page: Page) {
  await page.getByTestId("shipping-name").fill("Ana Garcia");
  await page.getByTestId("shipping-address").fill("1234 Corrientes Ave");
  await page.getByTestId("card-number").fill("4242424242424242");
}

test("[BUG-02] a slow approved payment shows the order, not an error", async ({ page }) => {
  await login(page);
  // Total above $100 makes the simulated processor slow (a few seconds, as the API docs allow).
  await addFromDetail(page, 8, 1);
  await page.goto("/checkout");
  await fillCheckout(page);
  await page.getByTestId("pay-button").click();

  await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("checkout-error")).toHaveCount(0);
});

test("[BUG-02] a payment the user is told failed must not be charged", async ({ page }) => {
  await login(page);
  await addFromDetail(page, 8, 1);
  await page.goto("/checkout");
  await fillCheckout(page);
  await page.getByTestId("pay-button").click();
  await expect(page.getByTestId("order-success").or(page.getByTestId("checkout-error"))).toBeVisible({ timeout: 15_000 });

  if (await page.getByTestId("checkout-error").isVisible()) {
    await page.waitForTimeout(3_000); // let the server finish processing
    const payments = await (await page.request.get("/api/payments")).json();
    expect(payments.filter((p: { amount: number }) => p.amount === 129)).toHaveLength(0);
  }
});

test("[BUG-05] a lowercase coupon code applies the discount", async ({ page }) => {
  await addFromDetail(page, 3, 2); // 2 × $14.35 = $28.70
  await page.goto("/cart");
  await page.getByTestId("coupon-input").fill("flock10");
  await page.getByTestId("coupon-apply").click();

  await expect(page.getByTestId("coupon-applied")).toContainText("10%");
  await expect(page.getByTestId("cart-discount")).toHaveText("-$2.87");
  await expect(page.getByTestId("cart-total")).toHaveText("$25.83");
});

test("[BUG-07] a second coupon cannot be added after reloading the cart", async ({ page }) => {
  await addFromDetail(page, 3, 2);
  await page.goto("/cart");
  await page.getByTestId("coupon-input").fill("FLOCK10");
  await page.getByTestId("coupon-apply").click();
  await expect(page.getByTestId("coupon-applied")).toHaveCount(1);

  await page.reload();
  await page.getByTestId("coupon-input").fill("BIENVENIDA15");
  await page.getByTestId("coupon-apply").click();

  await expect(page.getByTestId("coupon-error")).toBeVisible();
  await expect(page.getByTestId("coupon-applied")).toHaveCount(1);
  await expect(page.getByTestId("cart-total")).toHaveText("$25.83");
});

test("[BUG-08] a product added from the catalog stays in the cart after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("quick-add-1").click();
  await expect(page.getByTestId("catalog-message")).toBeVisible();

  await page.reload();
  await page.goto("/cart");
  await expect(page.getByTestId("cart-line-1")).toBeVisible();
  await expect(page.getByTestId("cart-qty-1")).toHaveValue("1");
});

test("[BUG-09] the cart cannot hold more units than the available stock", async ({ page }) => {
  // Ergonomic chair (id 8) has stock 2; add 2 units twice.
  await addFromDetail(page, 8, 2);
  await page.goto("/product/8");
  await page.getByTestId("quantity-select").selectOption("2");
  await page.getByTestId("add-to-cart").click();

  await page.goto("/cart");
  const quantity = Number(await page.getByTestId("cart-qty-8").inputValue());
  expect(quantity).toBeLessThanOrEqual(2);
});

test("[BUG-09] quick add from the catalog cannot exceed the available stock", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 3; i++) await page.getByTestId("quick-add-8").click();

  // Navigate in-app (no reload) so this test doesn't depend on BUG-08.
  await page.getByTestId("nav-cart").click();
  const quantity = Number(await page.getByTestId("cart-qty-8").inputValue());
  expect(quantity).toBeLessThanOrEqual(2);
});

test("[BUG-10] line totals are rounded correctly to the cent", async ({ page }) => {
  await addFromDetail(page, 1, 3); // 3 × $8.35 = $25.05
  await page.goto("/cart");
  await expect(page.getByTestId("cart-line-total-1")).toHaveText("$25.05");
  await expect(page.getByTestId("cart-subtotal")).toHaveText("$25.05");
  await expect(page.getByTestId("cart-total")).toHaveText("$25.05");
});

test("[BUG-11] order dates are shown in Argentina time", async ({ page }) => {
  // Seed: order #2 was created at 2026-10-15T02:30Z = 10/14/2026 23:30 in Buenos Aires.
  await login(page);
  await page.goto("/orders");
  await expect(page.getByTestId("order-row-2")).toContainText("10/14/2026");

  await page.goto("/orders/2");
  await expect(page.getByTestId("order-date")).toContainText("10/14/2026");
  await expect(page.getByTestId("order-date")).toContainText("23:30");
});
