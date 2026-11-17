# Testing

## Automated regression tests (evaluated)

```bash
npm test
```

- `tests/api-checkout.spec.ts`: API-level bugs (BUG-01, 03, 04, 05, 06, 12).
- `tests/ui-bugs.spec.ts`: UI bugs (BUG-02, 05, 07, 08, 09, 10, 11).

Every `[BUG-XX]` test fails against the current app and should pass once that bug is fixed.

## Evidence capture (not part of the evaluated suite)

`evidence/capture.mjs` is a standalone Playwright script that reproduces each bug and saves a screenshot (UI) or the full request/response JSON (API) to `evidence/`.

```bash
npm run dev                  # in one terminal
node evidence/capture.mjs    # in another
```

It resets the data before each case and once more at the end.
