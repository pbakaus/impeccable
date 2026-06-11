# STYLE.md

Editorial brief for impeccable.design. Read this before writing or editing user-facing copy: the homepage, sub-pages, command editorials, tutorials, and READMEs.

The bar: **for every paragraph, point to the sentence that makes it specifically yours.** If you can't, the paragraph is AI by default, even if a human typed it.

## Principles

1. **Open with the reader's wrong belief, your strongest claim, or the example.** No "in this guide", no "let's dive in".
2. **Take a position someone could disagree with.** If the paragraph could be inverted without changing meaning, it has no position. Sign your stance.
3. **Name names. Use numbers.** Real competitors, real customer names, real version numbers, real file paths, real benchmarks. Cut "lightweight"; write "54 KB".
4. **Verbs lead. Nouns follow.** Imperative is fine. Active voice. Cut nominalizations ("the implementation of" → "implementing").
5. **Vary sentence length on purpose.** Long, long, short. Smooth uniform rhythm is the deepest AI tell.
6. **Prose carries the load; structure supports it.** Bullets are for parallel options. Paragraphs are for argument. Don't bullet what would be tighter as a sentence.
7. **Plain words. Technical terms only when something specifically rests on them.** Mixing levels lets the technical terms hit harder.
8. **Allow ungrammatical fragments for rhythm.** Five words. Confidence signal.
9. **Respect the reader's competence.** No "developers should consider"; just "you might not need an effect".
10. **Read it aloud. Fix anything you stumble over.**
11. **Concrete over comprehensive.** Coverage is an AI obsession. Trade coverage for momentum. Leave things out.
12. **Close by handing off the next move.** Don't summarize. End on the strongest sentence, give a directive ("Now do this"), or just stop.

## Denylist

The build's `validateProse` step (in `scripts/build.js`) fails the build on these. The list is the editorial brief, enforced. Add a rule here when you ban a new pattern; remove a rule when the term has earned a real meaning here. **Do not silently allowlist** by working around the regex.

### Stolen-engineer diction
Engineering words that became AI flavor once they leaked into training data around late 2024.

| Banned | Why | Use instead |
|---|---|---|
| `load-bearing` | Almost always vague. The literal sense is rare. | Name the specific thing it does. "The decision that shapes the rest", "carries the brand", "matters specifically". |
| `highest-leverage` | Vague claim of impact. | Say what specifically pays off. "The change that moves the design most". |
| `biggest unlock` | Marketing-speak. | Describe the actual change. |

### Internal jargon leaking out
Words that work in a research notebook and fail in user copy.

| Banned | Why | Use instead |
|---|---|---|
| `reflex defaults` | Eval-team jargon. | "Instincts", "first guesses", "default reaches". |
| `collapses into monoculture` | Eval-paper voice. | Describe what specifically went wrong (e.g. "every model picked the same three fonts"). |
| `data-driven` | Empty marketing adjective. | Cite the data. "Validated against 15 briefs across two models". |

### Marketing voice
Adjectives and verbs that gesture at quality without doing the work.

| Banned | Why | Use instead |
|---|---|---|
| `seamless`, `seamlessly` | Hollow positive. | Say what specifically works without friction. |
| `robust`, `robustness` | Hollow positive. | Cite the failure mode handled. |
| `elevate`, `elevates` | Marketing verb. | Use the specific verb (improve, raise, sharpen). |
| `empower`, `empowers` | Marketing verb. | "Let you", "make possible". |
| `underscore`, `underscores` | AI tell. | "Show", "make clear". |
| `pivotal` | Hollow positive. | "Central", "key", or describe the role. |
| `tapestry` | AI scenery noun. | Cut. |

### Verbs
| Banned | Why | Use instead |
|---|---|---|
| `delve`, `delves`, `delved`, `delving` | The most-flagged AI tell of all. | "Look at", "explore", or just delete the throat-clearing verb. |

### Throat-clearing
Sentences that delay the point. Cut them; almost nothing of value is lost.

| Banned | Why | Use instead |
|---|---|---|
| `in today's …` | Generic opener. | Start at the actual point. |
| `gone are the days` | Cliché opener. | Make the point directly. |
| `whether you're …` | Audience-pandering; addresses no one. | Pick one reader. Write to them. |
| `let's dive in` | Throat-clearing. | Just start. |

### Closers
| Banned | Why | Use instead |
|---|---|---|
| `in summary`, `in conclusion` | Restates what was just said. | End on the strongest sentence. Trust the reader. |

### Transitions
| Banned | Why | Use instead |
|---|---|---|
| `moreover`, `furthermore` | Metronome transition crutch. | Drop, or use "also", or restructure. |

### Punctuation
| Banned | Why | Use instead |
|---|---|---|
| Em dash `—` (and HTML entities `&mdash;`, `&#8212;`, `&#x2014;`) | Decision-avoidance: writer didn't pick a relationship between the clauses. | Comma, colon, semicolon, period, parentheses. Pick the relationship. |
| ` -- ` (double hyphen as em-dash substitute) | Worse than the em dash. Signals failed cleanup. | Real punctuation. |

## Patterns the validator can't catch

The above are the easy wins. The deeper issues require human judgment on every paragraph.

- **Negation pivot.** "It's not just X, it's Y." "Less about X, more about Y." This is now a stronger AI tell than any vocabulary item. Use sparingly. Most instances should be replaced with a direct positive claim.
- **Triadic everything.** Every list exactly three items. Every adjective in groups of three ("fast, simple, and powerful"). Vary count: use 2 or 4. Use 1.
- **The five-paragraph essay shape.** Intro → 3 sections → conclusion, on every page. Mix it up. Lead with the example. Skip the conclusion. Let some sections be one sentence.
- **Uniform paragraph length.** Insert a 4-word sentence. Insert a one-line paragraph.
- **Synthetic balance.** Pros and cons of equal length when one is clearly right. Write the recommendation; note real exceptions briefly.
- **Hollow confidence.** "Powerful" without numbers. Replace with a concrete fact.
- **Hedging stacks.** "It might potentially be useful to consider..." Each hedge is fine; stacked, they sound trained.
- **Interchangeable copy.** Swap "Impeccable" for a competitor name. If nothing becomes false, the copy is generic.

## When in doubt

Read the paragraph aloud. If you stumble, rewrite. If a sentence describes nothing specific to this product, cut it.
