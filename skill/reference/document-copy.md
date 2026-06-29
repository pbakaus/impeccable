Generate a `COPY.md` file at the project root that captures the project's **experience language system** — not a string inventory.

COPY.md answers: *What should this product feel like to use, and how does language help users succeed across high-value journeys?*

It complements `PRODUCT.md` (strategy) and `DESIGN.md` (visual). **Evidence from the repo is required; frequency counts are not sufficient alone.**

## Anti-goals (reject these outputs)

- A doc that is mostly "top 25 frequent strings"
- Generic voice ("professional, dependable") with no experience promise
- One "admin" persona when the product has multiple operator roles
- Microcopy patterns with no journey playbooks
- AI features documented in three bullets
- Empty-state formula without type decision tree

## When to run

- No `COPY.md` exists
- COPY.md reads like generated i18n metadata
- Major new journeys (AI, onboarding, billing)
- Before `/impeccable clarify` at scale

If `COPY.md` exists: ask **refresh**, **merge**, or **skip**.

## Two paths

- **Scan mode** (default): i18n files or inline UI strings exist → extract evidence, interview for ambition, write full COPY.md
- **Seed mode**: no strings yet → interview + `<!-- SEED -->`; re-run scan when code lands

Run `scan-copy.mjs` first. Empty scan → offer seed mode.

`/impeccable document-copy --seed` forces seed mode regardless of code presence.

## Scan mode

### Step 1: Run scanner (evidence, not voice)

```bash
node {{scripts_path}}/scan-copy.mjs --target <path>
```

Use output for: i18n mechanics, key conventions, samples, debt signals. **Do not treat frequent strings as voice rules.**

### Step 2: Read strategic context

1. `PRODUCT.md` — users, purpose, brand personality, anti-references
2. `DESIGN.md` — only overlapping terminology (button labels vs visual treatment)
3. Existing `COPY.md` if refreshing
4. Register reference: [product-copy.md](product-copy.md) or [brand-copy.md](brand-copy.md) per `register` in PRODUCT.md

### Step 3: Map journeys (required)

Identify **5–8** highest-value journeys from code + PRODUCT.md. Follow [copy-journeys.md](copy-journeys.md). Walk each journey's text files in sequence — not random samples.

Minimum reads per journey: first screen, primary action, error, empty/success if present.

**Generic examples** (pick what applies; do not list without evidence):
- Task app: create project → invite teammate → first task completed
- Billing SaaS: trial signup → upgrade plan → payment failure recovery
- Analytics: connect data source → build first dashboard → share report
- Marketing site: hero → pricing → signup

### Step 4: Experience interview (required unless fully documented)

Ask 2–3 questions per round. Do not skip when voice would stay generic.

**Round A — ambition**
- One-sentence **experience promise** for copy (what language must help users do/feel)
- Emotional outcomes per primary persona (operator vs end user vs buyer)
- Anti-voice: what this product must never sound like

**Round B — governance & white-label** (B2B / multi-tenant products)
- What copy can customers customize vs what stays platform-protected?
- AI disclosure and threshold language — any legal/compliance constraints?

**Round C — journeys** (if unclear from code)
- Rank top 5 journeys by business importance
- Known support-ticket or drop-off copy failures

Synthesize answers into COPY.md even when inferred — mark `<!-- CONFIRM -->` items for user validation.

### Step 5: Write COPY.md

#### Frontmatter

```yaml
---
name: <project>
register: product | brand
experiencePromise: "<one sentence — copy's job>"
copyPrinciples:
  - "<tradeoff principle, e.g. Name the consequence, not just the action>"
sourceLocale: en-US
i18n:
  detectedApi: formatMessage | useIntl | i18next | t() | unknown
  filePatterns: ["<patterns found>"]
personas:
  <id>:
    audience: operator | member | buyer | ...
    tone: <adjectives>
    formality: low | neutral | high
protectedCopy: ["security errors", "AI disclosure", ...]
customizableCopy: ["workspace display name", "welcome messages", ...]
patterns:
  error-validation: "Enter a valid email address"
  empty-first-use: "<example from repo or target>"
terminology:
  productNames: []
---
```

`patterns` = exemplar strings from repo **or** agreed targets — label which.

#### Markdown body — nine sections (exact order)

1. `## Overview`
2. `## Copy Principles`
3. `## Voice & Tone`
4. `## Terminology`
5. `## Journey Playbooks`
6. `## Patterns`
7. `## Decision Trees`
8. `## Internationalization & Accessibility`
9. `## Governance & Do's and Don'ts`

Optional subtitles OK; literal section words must appear.

##### Section guides

**Overview** — Experience promise (1–2 sentences). Who COPY.md serves. How it relates to customer branding. Explicitly state this is an experience-language system, not a string dump.

**Copy Principles** — 4–6 principles that resolve tradeoffs (activation vs brevity, trust vs enthusiasm). Pull from interview + [product-copy.md](product-copy.md).

**Voice & Tone** — Persona subsections. For admin/operator products: **audience matrix** (workspace admin, analyst, developer, etc.). Anti-voice list.

**Terminology** — Canonical terms, variants, product names. Context-variant key conventions if applicable.

**Journey Playbooks** — 5–8 journeys using [copy-journeys.md](copy-journeys.md) template. Ordered moments. Real key citations where possible.

**Patterns** — Microcopy: buttons, forms, confirmations, loading, analytics labels, navigation. Each subsection: rule + **Weak | Better | Why** table (≥3 rows per major pattern).

**Decision Trees** — Errors, empty states, success (admin). Use [copy-decision-trees.md](copy-decision-trees.md). Empty-state **types** table required.

**AI & Trust** — Include as `### AI & Trust` under Decision Trees when the product has AI features; use [copy-ai-trust.md](copy-ai-trust.md). Omit only when product has zero AI surfaces.

**Internationalization & Accessibility** — i18n file layout, APIs, ICU, locale workflow. Cognitive accessibility: link text, permissions, disabled states, chart summaries.

**Governance & Do's and Don'ts** — Who owns COPY.md updates; PR checklist for new strings; deprecated terms; known debt with targets; forceful Never/Always rules.

### Step 6: Quality gate (before finishing)

- [ ] Experience promise is specific to this product, not generic SaaS
- [ ] Operator audience matrix present (if admin UI exists)
- [ ] ≥5 journey playbooks with ordered moments
- [ ] Empty-state types documented
- [ ] AI trust section present (if AI in product)
- [ ] Customizable vs protected copy defined (if white-label)
- [ ] ≥3 Weak/Better/Why tables
- [ ] i18n rules cite detected patterns, not assumed paths
- [ ] Known debt section names actionable fixes

Fail the gate → expand weak sections; do not ship a string inventory.

### Step 7: Wrap up

Summarize: promise, principles, journeys covered, gaps needing screenshots/support data, suggested `/impeccable clarify <journey>` targets.

## Seed mode

Interview only. Write COPY.md with `<!-- SEED -->`. Sections 5–7 may be `TBD`. Re-run scan mode after strings exist.

### Step 1: Confirm seed mode

"There's no existing copy to scan. I'll ask a few questions to seed a starter COPY.md. Re-run `/impeccable document-copy` once there's code. OK?"

### Step 2: Five questions

Group into one interaction:

1. **Experience promise** — one sentence: what should language help users accomplish?
2. **Primary personas** — who reads the copy (operator, member, buyer)?
3. **Anti-voice** — what must this product never sound like? (name a category cliché)
4. **Three named references** — products whose copy feels right; what specifically?
5. **Register** — product UI vs marketing/brand surface?

### Step 3: Write seed COPY.md

Populate Overview, Copy Principles, Voice & Tone from answers. Mark unverified sections `TBD` or `<!-- SEED -->`.

## Style guidelines

- **Experience before inventory.** Journey playbooks and the experience promise are the core; string frequency is evidence only.
- **Cite PRODUCT.md anti-references by name** in Governance Do's and Don'ts.
- **Match section names exactly.** Tooling and agents parse COPY.md by header.
- **Weak | Better | Why** tables beat abstract rules. Use realistic SaaS examples (task apps, billing, analytics), not customer-specific journeys.
- **Be forceful.** "Never", "always", "required" — match PRODUCT.md's strategic tone.
- **Don't duplicate PRODUCT.md or DESIGN.md.** COPY.md is strictly how the product reads.

## Pitfalls

- Don't paste raw i18n key dumps into the body.
- Don't treat `frequentStrings` from scan-copy.mjs as voice guidance.
- Don't overwrite existing COPY.md without asking.
- Don't collapse multiple operator roles into one generic "admin" voice.
- Don't invent journeys with no code or product evidence.
