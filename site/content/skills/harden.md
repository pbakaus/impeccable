---
tagline: "Make interfaces production-ready. Edge cases, i18n, error states, overflow."
---

## When to use it

`/impeccable harden` is for the day your interface meets reality. Real user data is messy: names that are 60 characters long, product titles in German, prices in the billions, 500 errors, offline modes, right-to-left text. Designs that only work with perfect data are not production-ready.

Reach for it before launch, before opening to a new market, or any time a bug report starts with "our user had a really long name and". For first-run flows, empty-state activation, and onboarding design, reach for `/impeccable onboard` instead.

## How it works

The skill works through four dimensions of real-world resilience:

1. **Text and data extremes**. Long text, short text, special characters, emoji, RTL, numbers in the billions, 1000-item lists.
2. **Error scenarios**. Network failures, API 4xx/5xx, validation errors, permission errors, rate limits, concurrent operations.
3. **Internationalization**. Long translations (German is often 30% longer than English), RTL languages, date and number formats, currency symbols, character sets.
4. **Device and context**. Touch targets, offline behavior, slow connections, low-power mode.

For each dimension it identifies the failure mode, then applies the concrete fix: overflow handling, informative error UI, i18n-safe layouts, pluralization, sensible fallbacks.

## Try it

Start with one page and one dimension:

```
/impeccable harden the user profile page for long names
```

Expected output:

- `.user-name` now has `text-overflow: ellipsis` with a tooltip for the full value
- `.bio` switched from fixed height to `max-height` with a "show more" disclosure
- Added an empty state for users with no bio
- Added a skeleton loader for the async avatar fetch
- Tested at name lengths 1, 20, 60, 200 characters

Run it per-page, not all at once. The first run is the biggest; subsequent runs find fewer issues as patterns solidify.

## Pitfalls

- **Waiting for a bug report.** Harden is preventative. If you find yourself fixing the same class of bug twice, run `/impeccable harden` across the feature.
- **Treating error and empty states as an afterthought.** Most hardening work is error and empty state UI. Budget time for it, not just a `catch` block.
- **Skipping i18n because "we are English-only for now".** i18n-safe layouts are still better layouts. Flexible containers, proper text wrapping, generous line-height. None of that hurts English.
