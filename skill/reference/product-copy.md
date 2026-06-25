# Product copy register

When copy **serves the product**: app UI, admin consoles, dashboards, settings, onboarding, AI surfaces inside the product.

## The product copy test

Not "is every string grammatically correct." The test is: does the language help the user **complete a high-value journey** with **confidence** — and would a fluent user of the category's best tools (Linear, Notion, Stripe Dashboard, Figma) trust this product to configure, participate, or decide?

Failure mode: every micro-label is fine, but the full flow feels fragmented, anxious, or generic.

## What product COPY.md must optimize for

1. **Activation** — first value, not just first click
2. **Confidence** — consequences before and after action
3. **Trust** — AI, permissions, billing, security
4. **Momentum** — meaningful next steps, not dead ends
5. **Governed flexibility** — customer brand where allowed; platform clarity where required
6. **Decision support** — operators interpret, not just configure

Consistency is the floor. These six are the ceiling.

## Operators are not one voice

For B2B / multi-tenant products, split operator-side audiences:

| Audience | Copy optimizes for | Jargon tolerance |
|----------|-------------------|------------------|
| Workspace / program admin | Actionable interpretation, growth | Low–medium |
| Content moderator | Speed, consequence, next action | Medium |
| Analyst | Definitions, periods, caveats | Medium (precision) |
| Developer / integrator | Exact system behavior | High |
| Account owner / governance | Control, scope, risk | Low |
| Executive stakeholder | Outcomes, not implementation | Low |

Document the matrix for the product. Do not collapse an admin app into one tone row.

## Journey-first, pattern-second

Microcopy rules (buttons, errors) are necessary but insufficient. COPY.md must include **journey playbooks** for the product's highest-value flows. See [copy-journeys.md](copy-journeys.md).

## AI inside the product

If the product ships AI features, AI trust language is not a subsection — it is a first-class concern. See [copy-ai-trust.md](copy-ai-trust.md).

## White-label tension

Define **customizable copy** (customer-owned) vs **protected platform copy** (supportability, compliance, security). Multi-tenant products need this explicitly.

## Cognitive accessibility

Beyond localized `aria-label`:

- Meaningful link text out of context
- No direction-only instructions ("click below")
- Plain-language permission denials
- Disabled-state explanations
- Chart/table summaries for screen readers

## Product copy bans (on top of shared rules)

- Generic enterprise voice with no experience promise ("professional, dependable" alone)
- Empty states that only announce absence
- Success toasts that confirm without scope or effect
- AI copy that implies certainty without system support
- One operator voice for admins and developers
- String-frequency tables presented as "voice"
