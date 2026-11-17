import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const USERS = {
  ana: { email: "ana@shopnow.test", password: "Ana12345" },
  bruno: { email: "bruno@shopnow.test", password: "Bruno12345" },
};

/** Resets the app data to a fresh install (products, stock, sample orders and payments). */
export async function resetData(request: APIRequestContext) {
  const res = await request.post("/api/test/reset");
  expect(res.ok()).toBeTruthy();
}

/** Logs in through the API; the request context keeps the `sid` cookie for later calls. */
export async function apiLogin(request: APIRequestContext, user: { email: string; password: string } = USERS.ana) {
  const res = await request.post("/api/login", { data: user });
  expect(res.ok()).toBeTruthy();
}

export const VALID_CHECKOUT = {
  shipping: { name: "Ana Garcia", address: "1234 Corrientes Ave" },
  card: { number: "4242424242424242" },
};

export async function login(page: Page, user: { email: string; password: string } = USERS.ana) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("logout")).toBeVisible();
}
