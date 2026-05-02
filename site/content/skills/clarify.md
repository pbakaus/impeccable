---
tagline: "Rewrite confusing UX copy so interfaces explain themselves."
---

## When to use it

`/impeccable clarify` is for interface text that makes people stop and think. Confusing labels, ambiguous button copy, error messages that blame the user, tooltips that repeat the label, empty states that say nothing useful. Use it when the problem is not the layout or the color, it is the words.

Good triggers: "users do not understand this field", "the error message is not helpful", "I cannot write good button copy", "this tooltip is a waste".

## How it works

The skill rewrites text across the surfaces where most UX copy problems live:

1. **Labels and field hints**: direct, specific, say what is expected.
2. **Button copy**: verb-first, describes the outcome, not the action. "Save changes" not "OK".
3. **Error messages**: explain what went wrong, whose fault it is, and what to do next. Never blame the user.
4. **Empty states**: orient the user, explain why the state is empty, offer a next step.
5. **Tooltips and helper text**: add information the label cannot carry, never restate it.
6. **Confirmation dialogs**: name the consequences, not the action.

The skill uses the audience and mental state from `PRODUCT.md` to tune voice. Technical audience gets precise language. Consumer audience gets plain speech. Rushed users get short text. Anxious users (payment, delete) get reassurance.

## Try it

```
/impeccable clarify the billing form
```

Before and after, typical:

- Label "Billing address" → "Address on your card"
- Placeholder "Enter your VAT ID" → "VAT ID (optional, for business)"
- Error "Invalid input" → "This card number is 15 digits. You entered 14."
- Button "Submit" → "Charge $29 and subscribe"
- Empty state "No transactions yet" → "Your first charge will show up here after your first order."

## Pitfalls

- **Writing cleverer, not clearer.** Clarify is not for voice upgrades. If the copy is already clear, do not reach for this skill. Use `/impeccable delight` instead when you want personality.
- **Skipping the audience question.** Clarify needs to know who is reading. If `PRODUCT.md` does not specify audience technical level, the rewrites will be generic.
- **Running clarify on marketing copy.** Clarify is for functional UX text: labels, errors, instructions. Marketing copy needs a different set of moves and a human writer.
