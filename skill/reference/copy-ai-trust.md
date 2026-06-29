# AI trust language

Use when the product ships AI-assisted features (smart suggestions, summaries, drafting, classification, etc.).

## Principles

1. **Transparency** — users know when content is AI-generated
2. **Bounded confidence** — never imply certainty the system cannot support
3. **Governability** — operators understand what thresholds and settings affect output
4. **Fallback clarity** — no-answer, low-confidence, and human-escalation paths are explicit
5. **Non-anthropomorphic default** — no fake personality unless customer-configured

## Operator configuration copy

Must explain:
- What the feature does for end users
- What changes when enabled (visibility, load, moderation)
- What thresholds trade off (coverage vs precision)
- Prerequisites (API keys, data sources, models)
- Where to audit (logs, review queues)

**Weak:** "Turn on AI magic"  
**Better:** "Enable smart suggestions. Users see AI-generated drafts when confidence meets your threshold."

## End-user disclosure

- Use customer-configured display name when set; default to neutral ("AI suggestion", "Generated summary")
- Prefer "AI-generated" or "suggested" when review/uncertainty matters
- Citation/source language when sources exist
- Feedback affordances (helpful / not helpful) without guilt-tripping

## Failure and no-answer

| Weak | Better |
|------|--------|
| Error | Could not generate a reliable suggestion |
| AI unavailable | No suggestion met your workspace confidence threshold |
| Something went wrong | Unable to load AI activity. Try again. |

## Protected AI copy

These must stay platform-consistent (not customer-rewritten without review):
- Disclosure that content is AI-generated
- Data/privacy boundaries where legally required
- Confidence/threshold semantics
- Moderation and audit terminology

Customizable: display name, citation heading, tone previews (demo content only).
