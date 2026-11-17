# Bugs found

Sorted by priority (most important first). Test data comes from a fresh `npm run reset`.

**Evidence** is in [`evidence/`](evidence/): screenshots (`.png`) for UI bugs and the full request/response (`.json`) for API bugs, named by bug ID. They can be regenerated with `node evidence/capture.mjs` (see `TESTING.md`).

| Bug | Evidence |
|---|---|
| BUG-01 | `BUG-01-ana-sees-bruno-order.png`, `BUG-01-api-other-user-order.json` |
| BUG-02 | `BUG-02a-payment-failed-message.png` → `BUG-02b-payment-approved-anyway.png` |
| BUG-03 | `BUG-03-api-oversell-stock.json` (201, `stockAfter: -1`) |
| BUG-04 | `BUG-04-api-negative-quantity.json` (total -8.35, `stockAfter: 26`) |
| BUG-05 | `BUG-05-lowercase-coupon-0-percent.png`, `BUG-05-api-lowercase-coupon.json` |
| BUG-06 | `BUG-06-api-stacked-coupons.json` |
| BUG-07 | `BUG-07-two-coupons-after-reload.png` |
| BUG-08 | `BUG-08a-added-from-catalog.png` → `BUG-08b-cart-empty-after-reload.png` |
| BUG-09 | `BUG-09-cart-4-chairs-stock-2.png` |
| BUG-10 | `BUG-10-3-mugs-25.04.png` |
| BUG-11 | `BUG-11-order-2-wrong-date.png` |
| BUG-12 | `BUG-12-api-accented-name-rejected.json` |

---

## BUG-01 — Any logged-in user can read other users' orders (name, address, items)

- **Source:** found by me
- **Type:** Security
- **Severity:** Critical
- **Priority:** P1 — leaks other customers' personal data (name, shipping address, purchases). Anyone can do it by changing the id in the URL.
- **Preconditions:** logged in as Ana. Order #3 belongs to Bruno.
- **Steps to reproduce:**
  1. Log in as `ana@shopnow.test`.
  2. Open `http://localhost:4321/orders/3` (or `GET /api/orders/3`).
- **Expected result:** `404` (or `403`). Ana sees only her own orders.
- **Actual result:** `200` with Bruno's full order: "Ship to: Bruno Diaz, …", items and total.
- **Automated test:** `tests/api-checkout.spec.ts` — `[BUG-01]`
- **Root cause in the code (optional):** `app/server/api.ts` `GET /orders/:id` looks up the order by id only and never checks `order.userId === user.id`.

## BUG-02 — Payments over $100 show "payment failed" but the card is charged and the order is created (User report 1)

- **Source:** user report 1
- **Type:** Integration
- **Severity:** Critical
- **Priority:** P1 — the customer is charged while being told the payment failed. Retrying charges them again. This causes direct money loss, chargebacks and support tickets.
- **Preconditions:** logged in. Cart total over $100 (e.g. 1 × Ergonomic chair, $129).
- **Steps to reproduce:**
  1. Add 1 Ergonomic chair to the cart and go to checkout.
  2. Fill in valid shipping details and card `4242424242424242`, then click **Pay**.
  3. After ~3 s, "We couldn't process your payment. Please try again." appears.
  4. Open **My payments** / **My orders**.
- **Expected result:** the app waits for the processor (the API docs say it "may take a few seconds") and shows the order confirmation. Under no circumstances does the user see "failed" for a payment that was approved.
- **Actual result:** an error is shown, the cart is kept, and an approved $129.00 payment plus a new order exist. Clicking Pay again creates a second charge.
- **Evidence:** test output: `/api/payments` returns `{"amount":129,"status":"approved","orderId":4}` after the UI showed the error.
- **Automated test:** `tests/ui-bugs.spec.ts` — both `[BUG-02]` tests
- **Root cause in the code (optional):** `app/web/src/pages/Checkout.tsx` aborts the request after `PAYMENT_TIMEOUT_MS = 3000`. `app/server/api.ts` takes 4000 ms when `total > 100` and still commits the payment and order, because aborting the HTTP request doesn't cancel the server-side work. The server has no idempotency key either, so retries create duplicate charges.

## BUG-03 — The API sells more units than the available stock (stock goes negative)

- **Source:** found by me
- **Type:** Logic / Data
- **Severity:** Critical
- **Priority:** P1 — overselling. The spec says users can't buy more than the stock, and the docs promise `409` for out of stock, but it never happens.
- **Preconditions:** logged in. Ergonomic chair (id 8) has stock 2.
- **Steps to reproduce:**
  1. `POST /api/checkout` with `items: [{ "productId": 8, "quantity": 3 }]` and valid shipping/card.
- **Expected result:** `409`, stock unchanged (2).
- **Actual result:** `201`, order created, stock becomes `-1`. Also reachable from the UI through BUG-09.
- **Automated test:** `tests/api-checkout.spec.ts` — `[BUG-03]`
- **Root cause in the code (optional):** `POST /checkout` in `app/server/api.ts` never compares `quantity` with `product.stock`.

## BUG-04 — Checkout accepts zero, negative and fractional quantities

- **Source:** found by me
- **Type:** Logic / Security
- **Severity:** High
- **Priority:** P1 — `quantity: -1` creates an order with a **negative total** and *increases* the stock. Mixing it with real items lets someone pay less than the price.
- **Preconditions:** logged in.
- **Steps to reproduce:**
  1. `POST /api/checkout` with `items: [{ "productId": 1, "quantity": -1 }]` (also try `0` and `1.5`).
- **Expected result:** `400 invalid data`. The spec says quantity is at least 1, and units are whole numbers.
- **Actual result:** `201`. With `-1` the order total is `-$8.35` and the mug stock goes from 25 to 26.
- **Automated test:** `tests/api-checkout.spec.ts` — `[BUG-04]` (×3)
- **Root cause in the code (optional):** `app/server/api.ts` does `Number(item.quantity)` without validating that it is a positive integer. The UI clamps quantity, but the server trusts the client.

## BUG-05 — Lowercase coupon code is "accepted" but gives 0% discount (User report 2)

- **Source:** user report 2
- **Type:** Logic
- **Severity:** High
- **Priority:** P2 — customers lose a promised discount, and the UI tells them the coupon was applied. Easy to hit because people type codes in lowercase.
- **Preconditions:** any product in the cart (e.g. 2 × Basic T-shirt = $28.70).
- **Steps to reproduce:**
  1. In the cart, type `flock10` and click **Apply**.
- **Expected result:** "Coupon FLOCK10 applied (10%)". Discount -$2.87, total $25.83 (the spec says codes are case-insensitive).
- **Actual result:** "Coupon flock10 applied (0%)". Discount $0.00, total unchanged. `POST /api/coupons/validate {"code":"flock10"}` → `{"code":"flock10","percent":0}`.
- **Automated test:** `tests/api-checkout.spec.ts` and `tests/ui-bugs.spec.ts` — `[BUG-05]`
- **Root cause in the code (optional):** `findCoupon` in `app/server/api.ts` finds the matching key case-insensitively but then reads `COUPONS[typed]` (the raw input) instead of `COUPONS[key]`.

## BUG-06 — The API applies several coupons (or the same one twice) to one purchase

- **Source:** found by me
- **Type:** Logic / Security
- **Severity:** High
- **Priority:** P2 — discounts stack (FLOCK10 + BIENVENIDA15 = 25%, or FLOCK10 ×10 = 100%), which costs revenue. The spec says only one coupon per purchase.
- **Preconditions:** logged in.
- **Steps to reproduce:**
  1. `POST /api/checkout` with `coupons: ["FLOCK10", "BIENVENIDA15"]` (or `["FLOCK10","FLOCK10"]`).
- **Expected result:** `400`.
- **Actual result:** `201`, discount = sum of all coupons.
- **Automated test:** `tests/api-checkout.spec.ts` — `[BUG-06]` (×2)
- **Root cause in the code (optional):** `POST /checkout` loops over all `coupons` and `cartTotals` (`app/shared/money.ts`) sums every discount. The one-coupon rule exists only in the UI.

## BUG-07 — After reloading the cart, a second coupon can be added in the UI

- **Source:** found by me
- **Type:** UI / Logic
- **Severity:** Medium
- **Priority:** P2 — the user stacks 10% + 15%, and the server accepts it (BUG-06).
- **Preconditions:** a product in the cart.
- **Steps to reproduce:**
  1. Apply `FLOCK10` → OK. Applying another one is blocked (correct).
  2. Reload the page.
  3. Apply `BIENVENIDA15`.
- **Expected result:** error "Only one coupon can be used per purchase."
- **Actual result:** both coupons are listed and both discounts are applied.
- **Automated test:** `tests/ui-bugs.spec.ts` — `[BUG-07]`
- **Root cause in the code (optional):** `app/web/src/cart.tsx` uses `couponAppliedRef` (starts `false` on every page load) instead of checking `coupons.length > 0` from the persisted cart.

## BUG-08 — Products added with "Add" from the catalog disappear on reload (User report 3)

- **Source:** user report 3
- **Type:** Logic / Data
- **Severity:** Medium
- **Priority:** P2 — lost carts mean lost sales. The spec says the cart persists even after closing the browser.
- **Preconditions:** empty cart.
- **Steps to reproduce:**
  1. On the product list, click **Add** on the Ceramic mug. The header shows "Cart (1)".
  2. Reload the page (or close and reopen the browser).
- **Expected result:** the mug is still in the cart.
- **Actual result:** the cart is empty. Products added from the **detail page** do persist, which explains why the user wrote "*some* things disappear".
- **Automated test:** `tests/ui-bugs.spec.ts` — `[BUG-08]`
- **Root cause in the code (optional):** `app/web/src/pages/Catalog.tsx` calls `cart.setItems(...)` directly, which skips `persist()` / `localStorage`. It should use `cart.add(product, 1)`.

## BUG-09 — The cart can hold more units than the available stock

- **Source:** found by me
- **Type:** Logic
- **Severity:** Medium
- **Priority:** P2 — it is the UI path to overselling (BUG-03). The spec says users can't buy more than the stock.
- **Preconditions:** Ergonomic chair (id 8), stock 2.
- **Steps to reproduce:**
  1. On the chair's detail page, pick 2 and click **Add to cart**. Repeat.
  2. (Or click **Add** 3 times on the chair in the catalog.)
  3. Open the cart.
- **Expected result:** quantity capped at 2, or a message saying no more stock is available.
- **Actual result:** quantity 4 (detail) or 3 (catalog), and checkout proceeds.
- **Automated test:** `tests/ui-bugs.spec.ts` — `[BUG-09]` (×2)
- **Root cause in the code (optional):** `mergeItem` in `app/web/src/cart.tsx` adds quantities without capping at `product.stock`. The cap exists only in `updateQuantity`.

## BUG-10 — Line totals are rounded down, so some totals are 1 cent off

- **Source:** found by me
- **Type:** Logic
- **Severity:** Medium
- **Priority:** P3 — small amounts, but the charged amount doesn't match price × quantity, which matters for accounting and customer trust.
- **Preconditions:** none.
- **Steps to reproduce:**
  1. Add 3 × Ceramic mug ($8.35) to the cart.
- **Expected result:** line total and total $25.05.
- **Actual result:** $25.04. The same happens with 6 or 9 mugs and with 3 or 6 Urban backpacks, and the order/payment are stored with the wrong amount.
- **Automated test:** `tests/ui-bugs.spec.ts` — `[BUG-10]`
- **Root cause in the code (optional):** `lineTotal` in `app/shared/money.ts` uses `Math.floor` (8.35 × 3 = 25.049999… in floating point) instead of `Math.round`.

## BUG-11 — Order dates use the UTC day instead of Argentina time

- **Source:** found by me
- **Type:** Logic / UI
- **Severity:** Low
- **Priority:** P3 — wrong date for orders placed between 21:00 and 23:59 Argentina time. Confusing, and may matter for returns or invoices.
- **Preconditions:** logged in as Ana. Seed order #2 was created at `2026-10-15T02:30:00Z` (= 10/14/2026 23:30 in Buenos Aires).
- **Steps to reproduce:**
  1. Open **My orders**, then order #2.
- **Expected result:** `10/14/2026 · 23:30`.
- **Actual result:** `10/15/2026 · 23:30`. The time is converted to Argentina time but the date isn't.
- **Automated test:** `tests/ui-bugs.spec.ts` — `[BUG-11]`
- **Root cause in the code (optional):** `formatOrderDate` in `app/server/api.ts` takes the date from `iso.slice(0, 10)` (UTC) instead of formatting it with `timeZone: America/Argentina/Buenos_Aires`.

## BUG-12 — Checkout rejects names and addresses with accents, ñ or º (assumption)

- **Source:** found by me
- **Type:** Logic
- **Severity:** Medium
- **Priority:** P2 — an Argentine store where "García", "Muñoz" or "3º B" can't be entered blocks real customers from buying, and the error ("Please fill in the shipping details") doesn't explain why.
- **Assumption:** the spec doesn't define validation rules. I assume any real name/address must be accepted. If the PO confirms ASCII-only is intended, then this is only a misleading error message.
- **Steps to reproduce:**
  1. At checkout, enter name `Ana García Muñoz` and address `Av. Corrientes 1234, 3º B`, then pay.
- **Expected result:** the order is created.
- **Actual result:** `400 "Please fill in the shipping details."`
- **Automated test:** `tests/api-checkout.spec.ts` — `[BUG-12]`
- **Root cause in the code (optional):** `SAFE_TEXT = /^[A-Za-z0-9 .,#/-]+$/` in `app/server/api.ts`.

---

## Note on the existing tests

`tests/cart.spec.ts` ("the cart total is calculated correctly") only checks that the total is *visible*, never its value, so it passes no matter what the total is. It gives false confidence. BUG-10's test checks the actual amounts.
