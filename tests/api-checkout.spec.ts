import { test, expect } from "@playwright/test";
import { apiLogin, resetData, USERS, VALID_CHECKOUT } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetData(request);
});

test("[BUG-01] a user cannot read another user's order", async ({ request }) => {
  // Seed: order #3 belongs to Bruno.
  await apiLogin(request, USERS.ana);
  const res = await request.get("/api/orders/3");
  expect([403, 404]).toContain(res.status());
  const body = await res.json();
  expect(body.shipping).toBeUndefined();
});

test("[BUG-03] checkout rejects a quantity above the available stock", async ({ request }) => {
  // Seed: Ergonomic chair (id 8) has stock 2.
  await apiLogin(request);
  const res = await request.post("/api/checkout", {
    data: { items: [{ productId: 8, quantity: 3 }], coupons: [], ...VALID_CHECKOUT },
  });
  expect(res.status()).toBe(409);

  const product = await (await request.get("/api/products/8")).json();
  expect(product.stock).toBe(2);
});

for (const quantity of [0, -1, 1.5]) {
  test(`[BUG-04] checkout rejects an invalid quantity (${quantity})`, async ({ request }) => {
    await apiLogin(request);
    const res = await request.post("/api/checkout", {
      data: { items: [{ productId: 1, quantity }], coupons: [], ...VALID_CHECKOUT },
    });
    expect(res.status()).toBe(400);

    const product = await (await request.get("/api/products/1")).json();
    expect(product.stock).toBe(25);
  });
}

test("[BUG-05] the coupon code is case-insensitive in the API", async ({ request }) => {
  const res = await request.post("/api/coupons/validate", { data: { code: "flock10" } });
  expect(res.status()).toBe(200);
  expect((await res.json()).percent).toBe(10);
});

test("[BUG-06] checkout does not accept more than one coupon", async ({ request }) => {
  await apiLogin(request);
  const res = await request.post("/api/checkout", {
    data: { items: [{ productId: 1, quantity: 1 }], coupons: ["FLOCK10", "BIENVENIDA15"], ...VALID_CHECKOUT },
  });
  expect(res.status()).toBe(400);
});

test("[BUG-06] checkout does not accept the same coupon twice", async ({ request }) => {
  await apiLogin(request);
  const res = await request.post("/api/checkout", {
    data: { items: [{ productId: 1, quantity: 1 }], coupons: ["FLOCK10", "FLOCK10"], ...VALID_CHECKOUT },
  });
  expect(res.status()).toBe(400);
});

test("[BUG-12] shipping details accept Spanish names and addresses", async ({ request }) => {
  await apiLogin(request);
  const res = await request.post("/api/checkout", {
    data: {
      items: [{ productId: 1, quantity: 1 }],
      coupons: [],
      shipping: { name: "Ana García Muñoz", address: "Av. Corrientes 1234, 3º B" },
      card: VALID_CHECKOUT.card,
    },
  });
  expect(res.status()).toBe(201);
});
