// Captures screenshots (UI bugs) and request/response JSON (API bugs) into evidence/.
// Usage: start the app (`npm run dev`), then `node evidence/capture.mjs`.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request as apiRequest } from "@playwright/test";

const BASE = "http://localhost:4321";
const OUT = dirname(fileURLToPath(import.meta.url));
const ANA = { email: "ana@shopnow.test", password: "Ana12345" };
const CHECKOUT = { shipping: { name: "Ana Garcia", address: "1234 Corrientes Ave" }, card: { number: "4242424242424242" } };

const browser = await chromium.launch();
let api;

async function reset() {
  const r = await apiRequest.newContext({ baseURL: BASE });
  await r.post("/api/test/reset");
  await r.dispose();
}

async function newPage() {
  await reset();
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 }, timezoneId: "America/Argentina/Buenos_Aires" });
  return context.newPage();
}

async function loginUI(page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(ANA.email);
  await page.getByTestId("login-password").fill(ANA.password);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("logout").waitFor();
}

async function addFromDetail(page, id, qty) {
  await page.goto(`/product/${id}`);
  await page.getByTestId("quantity-select").selectOption(String(qty));
  await page.getByTestId("add-to-cart").click();
  await page.getByTestId("detail-message").waitFor();
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });

async function apiCase(name, method, path, data) {
  await reset();
  api = await apiRequest.newContext({ baseURL: BASE });
  await api.post("/api/login", { data: ANA });
  const res = method === "GET" ? await api.get(path) : await api.post(path, { data });
  const record = { request: { method, path, body: data ?? null, as: ANA.email }, response: { status: res.status(), body: await res.json() } };
  if (path === "/api/checkout") record.stockAfter = (await (await api.get(`/api/products/${data.items[0].productId}`)).json()).stock;
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(record, null, 2));
  await api.dispose();
  console.log(`saved ${name}.json (${res.status()})`);
}

// BUG-01: Ana opens Bruno's order #3
{
  const page = await newPage();
  await loginUI(page);
  await page.goto("/orders/3");
  await page.getByTestId("order-title").waitFor();
  await shot(page, "BUG-01-ana-sees-bruno-order");
  await page.context().close();
}
await apiCase("BUG-01-api-other-user-order", "GET", "/api/orders/3");

// BUG-02: slow payment shows error, but payment exists
{
  const page = await newPage();
  await loginUI(page);
  await addFromDetail(page, 8, 1);
  await page.goto("/checkout");
  await page.getByTestId("shipping-name").fill("Ana Garcia");
  await page.getByTestId("shipping-address").fill("1234 Corrientes Ave");
  await page.getByTestId("card-number").fill("4242424242424242");
  await page.getByTestId("pay-button").click();
  await page.getByTestId("checkout-error").waitFor({ timeout: 10_000 });
  await shot(page, "BUG-02a-payment-failed-message");
  await page.waitForTimeout(2_000);
  await page.getByTestId("nav-payments").click();
  await page.getByTestId("payment-row-4").waitFor();
  await shot(page, "BUG-02b-payment-approved-anyway");
  await page.context().close();
}

// API bugs
await apiCase("BUG-03-api-oversell-stock", "POST", "/api/checkout", { items: [{ productId: 8, quantity: 3 }], coupons: [], ...CHECKOUT });
await apiCase("BUG-04-api-negative-quantity", "POST", "/api/checkout", { items: [{ productId: 1, quantity: -1 }], coupons: [], ...CHECKOUT });
await apiCase("BUG-05-api-lowercase-coupon", "POST", "/api/coupons/validate", { code: "flock10" });
await apiCase("BUG-06-api-stacked-coupons", "POST", "/api/checkout", { items: [{ productId: 1, quantity: 1 }], coupons: ["FLOCK10", "BIENVENIDA15"], ...CHECKOUT });
await apiCase("BUG-12-api-accented-name-rejected", "POST", "/api/checkout", {
  items: [{ productId: 1, quantity: 1 }], coupons: [], shipping: { name: "Ana García Muñoz", address: "Av. Corrientes 1234, 3º B" }, card: CHECKOUT.card,
});

// BUG-05: lowercase coupon applied at 0%
{
  const page = await newPage();
  await addFromDetail(page, 3, 2);
  await page.goto("/cart");
  await page.getByTestId("coupon-input").fill("flock10");
  await page.getByTestId("coupon-apply").click();
  await page.getByTestId("coupon-applied").waitFor();
  await shot(page, "BUG-05-lowercase-coupon-0-percent");
  await page.context().close();
}

// BUG-07: two coupons after reload
{
  const page = await newPage();
  await addFromDetail(page, 3, 2);
  await page.goto("/cart");
  await page.getByTestId("coupon-input").fill("FLOCK10");
  await page.getByTestId("coupon-apply").click();
  await page.getByTestId("coupon-applied").waitFor();
  await page.reload();
  await page.getByTestId("coupon-input").fill("BIENVENIDA15");
  await page.getByTestId("coupon-apply").click();
  await page.getByTestId("coupon-applied").nth(1).waitFor();
  await shot(page, "BUG-07-two-coupons-after-reload");
  await page.context().close();
}

// BUG-08: quick add lost on reload
{
  const page = await newPage();
  await page.goto("/");
  await page.getByTestId("quick-add-5").click();
  await page.getByTestId("catalog-message").waitFor();
  await shot(page, "BUG-08a-added-from-catalog");
  await page.reload();
  await page.goto("/cart");
  await page.getByTestId("cart-empty").waitFor();
  await shot(page, "BUG-08b-cart-empty-after-reload");
  await page.context().close();
}

// BUG-09: cart above stock
{
  const page = await newPage();
  await addFromDetail(page, 8, 2);
  await addFromDetail(page, 8, 2);
  await page.goto("/cart");
  await page.getByTestId("cart-line-8").waitFor();
  await shot(page, "BUG-09-cart-4-chairs-stock-2");
  await page.context().close();
}

// BUG-10: rounding
{
  const page = await newPage();
  await addFromDetail(page, 1, 3);
  await page.goto("/cart");
  await page.getByTestId("cart-line-1").waitFor();
  await shot(page, "BUG-10-3-mugs-25.04");
  await page.context().close();
}

// BUG-11: order date
{
  const page = await newPage();
  await loginUI(page);
  await page.goto("/orders/2");
  await page.getByTestId("order-date").waitFor();
  await shot(page, "BUG-11-order-2-wrong-date");
  await page.context().close();
}

await browser.close();
await reset();
console.log("done");
