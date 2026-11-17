# Spec analysis

## Questions for the PO (prioritized)

1. **Payment timeouts:** what should the user see if the processor takes longer than expected? Should we wait, show "processing", or check the status afterwards? Retries must never create a second charge. (Directly related to user report 1 / BUG-02.)
2. **Stock:** is stock reserved when an item is added to the cart, or only checked at payment? What happens if stock runs out between adding to the cart and paying: an error, or adjusting the quantity?
3. **Coupons:** does the percentage apply before or after shipping/taxes (there are none today)? Can a coupon be used more than once per user? Do coupons expire? Is there a minimum purchase? How should a rounded discount be handled (to the cent, half-up)?
4. **Order privacy:** confirm that a user may only see their own orders and payments (we found that's not the case, BUG-01).
5. **Shipping and card validation:** which characters are allowed in name/address (accents, ñ, º)? Is any 16-digit number valid, or should we run a Luhn check / check expiry / CVV? Is an address just one line, or do we need city, postal code and province?
6. **Confirmation email:** what does it contain, when is it sent, and how can QA verify it? It can't be checked in this local environment.
7. **Prices:** if a product's price changes while it is in the cart, which price is charged (the one shown or the current one)?
8. **Cart persistence:** "persists even if the user closes the browser": per device or per account? Should the cart follow the user across devices after login? What happens to the guest cart when they log in?
9. **Dates:** should the date format be `MM/DD/YYYY` (US) or `DD/MM/YYYY` (Argentina)? Should payments also show a date?
10. **Search/filter:** should search match descriptions or partial words, and be accent-insensitive? Can search and category be combined?

## Ambiguities found

- "Users can't buy more than the available stock" doesn't say *where* this is enforced (detail page, cart, checkout) or what message the user gets.
- "Minimum 1" for quantity: what happens if the user types 0 or clears the field (remove the item, or reset to 1)? No maximum per order is given.
- "Only one coupon per purchase" doesn't say whether the backend must enforce it or only the UI.
- "Totals are shown in dollars with two decimals" doesn't define the rounding rule (per line vs. per order, round vs. truncate).
- "The payment is processed and the order is created": the order of operations and what happens on partial failure (payment approved, order not saved) aren't defined.
- "Log in before paying": should the cart survive the redirect to login and back? (It does today.)
- "They can also see their payments": which fields? Do declined payments appear?
- "Argentina time" applies to "dates and times", but the date format isn't specified.
- No mention of logout behavior, session expiry, or what a guest sees under My orders.

## Assumptions I make to move forward

- The **backend must enforce** every business rule (stock, quantity ≥ 1 and whole, one coupon), not just the UI. The API is public (`docs/API.md`).
- A user can only access **their own** orders and payments. Anything else returns 404/403.
- An approved payment must always end in the confirmation screen. The user must never be told "failed" for a payment that was charged.
- Money is rounded half-up to the cent per line, and price × quantity must match exact decimal arithmetic.
- Coupon codes are case-insensitive **and** the discount is the same whatever case is typed.
- Real names/addresses with Spanish characters (á, ñ, º) are valid.
- Dates: `MM/DD/YYYY` stays as is (it's what the app uses), but both the date and the time must be in Argentina time.
- The confirmation email can't be verified locally. I assume it's sent after a successful order, and I didn't test it (question 6).
- Declined cards (ending `0000`) must not create a payment or an order, and keep the cart. The code returns `402` before saving anything, so this looks correct; I didn't write a test for it.
