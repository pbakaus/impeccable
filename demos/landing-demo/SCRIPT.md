# Demo Script: Impeccable

**Event:** Design Futures Assembly
**Date:** April 29, 2026
**Venue:** Four One Nine, SOMA, San Francisco
**Slot:** 2:15 PM, between Designer Fund's "2026 State of AI in Design" and Microsoft/Expedia/Google's "AI at Scale"
**Format:** 6–7 minute demo, 2–3 minute Q&A
**Audience:** ~80, invitation-only, 75% executives / founders / senior leaders

---

## The strategic frame

The whole event is built around one question: **"when execution becomes abundant, what becomes scarce?"** Your answer, said or unsaid, is **taste**. Impeccable is your attempt to package it.

The room's stated #4 concern (29.8% of registrants) is "preserving taste, coherence, human control when generation becomes cheap." Concern #6 (17.9%) is "design systems as machine-readable." Both are exactly what Impeccable addresses.

**Demo = the proof. Q&A = the thesis.** Don't pre-empt the meta in the demo. Tee it up and let Jeff pull. He's already told you he'll ask about packaging taste, the rearchitecture, and live editing.

---

## 0:00 – 1:00 — The opening (visual contrast, then the thesis)

You take the stage with the **classic page** already on screen (`http://localhost:5173/classic/`, trailing slash matters). Skip the "hi I'm Paul." Lead with the artifact. The structure is two screens, two beats, one thesis.

**Beat 1 — point at what they already recognize.** Hold on the classic page for ~10 seconds. Don't explain it yet; let the audience ID it on their own.

> *"AI slop, 2022. You'd recognize this in your sleep. Purple gradient, glassmorphism, neon glow, 🚀 Powered by AI in the eyebrow. Every AI startup landing page for about eighteen months."*

**Beat 2 — the switch (the rhetorical pivot).** Cmd-tab to the new page. This is the punchline beat. Pause for a moment before speaking; let the audience see it.

> *"And this? Looks like good design. Editorial-warm, considered, restrained. But it's also AI slop."*
>
> *"Anthropic shipped a frontend-design skill last fall and proved something important. Claude can design when you focus its attention. It also did something less talked about. It created the next monoculture. Fraunces. Warm cream. Italic display headlines. The whole industry copied. You'll start spotting it everywhere now that I've named it."*
>
> *"Slop isn't a list. It's a moving target. Every opinionated skill that gets adopted becomes the next thing to defend against."*

**Why this lands:** the audience does the work in their own heads. They identify slop visually before you tell them anything. Then the second screen, which would have read as "good design" cold, reads as "huh, also slop." The thesis lands as recognition rather than argument. No one else at this event can credibly run this contrast — you're the person who's been cataloging tells the longest.

**Tab order matters.** Tab 1 = classic, Tab 2 = new. Cmd-tab once for Beat 2. Practice the switch in rehearsal — the timing of the pause before the second beat is the hinge of the opener.

---

## 1:00 – 2:15 — The critique demo (one engine, four surfaces)

You're now on the **new page** (Tab 2). Run `/impeccable critique` against it. Sixteen detection rules light up the slop.

**Optional sharpener:** if you have a beat to spare, run `/impeccable critique` on the **classic page first** (8 anti-patterns) before the new page (3 anti-patterns). Same engine, different decade, both flagged. That's the surface-area point landing as a number, not just a sentence. Skip if you're tight on time.

**What should fire:**
- icon-tile-stack (the three feature cards)
- generic feature copy (*Lightning Fast / Enterprise Secure / Built to Scale*)
- soft-shadow / rounded-everything / center-aligned aesthetic markers
- hero superlatives (*all-in-one platform... record time... powered by AI, designed for humans*)

While the report is on screen, drop the surface-area line:

> *"This is the same 16-rule detector that ships in the CLI, the public-site overlay, and the Chrome extension you can install on any URL. One engine, four surfaces."*

That single sentence makes the surface area of the project land without a tour.

---

## 2:15 – 5:15 — The live demo (the punchline)

Run `/impeccable live`. Pick the **hero** first, then a **feature card** second, with two contrasting briefs. The contrast between the two is what lands the brand-vs-product distinction without you having to argue it.

### Pre-rehearsed brief 1 — hero (brand register)

Target the headline. Brief:

> *"Calmer, editorial, more confident. Less startup. Less gradient. The headline should feel like a magazine cover, not a launch announcement."*

Cycle 3–4 variants. Accept the one that's furthest from the new-slop default.

### Pre-rehearsed brief 2 — feature card (product register)

Target the icon-tile feature row. Brief:

> *"Drop the icon-above-h3 pattern entirely. These should read as crafted product surfaces, not feature checklists. Specific over generic, evidence over adjectives."*

Cycle 3–4 variants. Accept one.

### The mid-demo line (the "all at once" thesis, demonstrated)

The moment you accept the first variant and the source mutates in place:

> *"Notice. That just changed the source file. No canvas, no export, no design-to-engineering handoff. That's the bet."*

Have `index.html` open in a split editor next to the browser so the audience sees the file change, not just the rendered output. The "no canvas" beat is hollow without that visual proof.

---

## 5:15 – 6:15 — The close (vision, then handoff)

Tightest possible four-beat close. End on vision, not architecture.

**Beat 1 — brand vs product, one line:**
> *"Product design and brand design optimize for opposite things. Product wants intrinsic quality: safe, familiar, usable, quietly delightful. Brand wants positional quality: does it stand out from everything shipping this month? Register is the first thing the skill asks, and every command branches on the answer."*

**Beat 2 — anti-attractors and diffusion, one line:**
> *"Static opinions become tomorrow's slop. So Impeccable's anti-attractors update on a cadence, and the new craft flow uses diffusion to actively push away from current defaults rather than toward them."*

**Beat 3 — the "all at once" vision, the strongest closing note:**
> *"Bigger picture. I think we're heading somewhere where waterfall (designer hands to PM hands to engineer) gives way to everything, everywhere, all at once. You build with Claude or Codex and iterate code and design in the same place. Canvas tools weren't designed for that workflow. Impeccable is."*

**Beat 4 — handoff:**
> *"23 commands. Plain markdown. Jeff?"*

---

## Q&A prep (Jeff pre-disclosed two of these)

### 1. "What did you learn building skills?"

60-second answer. Have it ready cold.

- **Consolidation beat proliferation.** v3.0 collapsed 18 separate skills into one `/impeccable` with 23 sub-commands. The `/` menu pollution problem is real and gets worse with every plugin a user installs.
- **Prose with examples beat rules.** The skill is mostly persuasive prose with worked examples. Rule lists are easy to write and easy for the model to ignore.
- **Register is the load-bearing distinction.** Brand vs product is the first question every command asks because it shapes every downstream answer.
- **The skill survives model upgrades.** It's a markdown contract, not a fine-tune. New Claude version ships, the skill still works (and usually works better).

### 2. "Is packaging taste a broader trend?"

One sentence, then a concrete prediction.

> *"Skills are to taste what design tokens were to color: a portable, machine-readable container for judgment that used to live in someone's head. I think within two years, design studios will ship skills as deliverables. Brands will ship them alongside style guides. There will be a marketplace for them. The question won't be 'does this designer have taste,' it'll be 'whose taste are you using.'"*

### 3. Likely third question from this room: "Does this work inside a 500-person product org with an existing design system?"

30-second answer.

> *"Yes, and the register split is what makes it work. For product surfaces, the skill defers to your design system: it reads tokens, respects component boundaries, doesn't try to redesign your buttons. For brand surfaces, where uniqueness matters, the skill diffuses away from defaults including your own internal ones if they've ossified. It composes with your system rather than replacing it."*

### Other plausible questions to have a thought on

- **"How does this differ from v0 / Lovable / Magic Patterns?"** — those are generators, this is a critic-and-coach. They produce; Impeccable judges and iterates. Different jobs.
- **"What's the eval story?"** — separate private repo, runs the same brief through Claude with and without the skill loaded, measures whether output crosses the slop threshold. Mention you have data; offer to share results offline.
- **"How do you keep the anti-attractors fresh?"** — manual curation right now, every couple weeks, based on what's showing up in the wild. Working on automating the trend-spotting half.
- **"Open source?"** — the skill is, the CLI is, the Chrome extension is. Eval framework is private (it's the moat).

---

## Demo-craft notes (read before rehearsal)

### Rehearse cold three times

The live demo is the part that can fail on stage. Run the full flow (Tab 1 classic-page open, Tab 2 new-page open, opener tab-switch, critique, live, two variants, accept) three times in a row without stopping. If any step takes longer than expected, troubleshoot now, not at 2:15 PM.

The opener's tab-switch is the hinge of the talk. Practice the timing — the pause after switching to Tab 2 before you speak is what makes the contrast land. Rushed switch + immediate talk-through = the punchline gets lost.

### Have a fallback

Keep a screen recording of a successful live-edit run cued in another tab. If `/impeccable live` stalls for more than 8 seconds on stage, switch to the recording and narrate over it. The audience would rather see a working flow on tape than a hung command on live.

A static `file://` version of the page is also worth keeping open. If Vite hiccups, you can still run `/impeccable critique` and recover the diagnostic half of the demo.

### Projector setup

- Editor + browser side-by-side, both legible to row 8.
- Editor font size: bumped 2–3 sizes above your daily setting.
- Browser zoom: 125% minimum.
- Terminal font: same, bumped.
- Mouse cursor: enable a "highlight cursor" tool (Cursor Pro, mouseposé, or similar) so the audience can follow your clicks.

### Things to NOT do

- A founder origin story.
- A roadmap slide.
- Reading the command list (`/impeccable polish`, `/impeccable audit`, etc.).
- Explaining the architecture during the demo (Jeff will ask in Q&A).
- Apologizing for anything. If a variant lands weak, accept it and move on. The audience is more forgiving of imperfection than of anxiety.

### The "no em dashes" rule

This is a rule you've enforced in your project copy. The script above already follows it. Don't introduce any during stage delivery either. Use commas, colons, parentheses. The rhythm reads cleaner.

---

## Context files (already scaffolded)

`PRODUCT.md` is in place at the repo root. Register is `brand`. The anti-references section explicitly names the new-slop patterns the page on screen exhibits: the Fraunces-cream-peach SaaS template, three-icon feature tile rows, hero superlatives, soft-everything aesthetic, decorative gradients. This is deliberate. When `/impeccable live` reads PRODUCT.md before generating variants, it diffuses *away* from those patterns, which means the variants land further from the current page than they otherwise would. The "static opinions become tomorrow's slop, so we diffuse" line in your close is now a thing the room is watching happen, not just a claim you make.

`DESIGN.md` is intentionally missing. The skill will nudge once per session ("Run `/impeccable document` for more on-brand output") and proceed. If it fires during the demo, deflect cleanly:

> *"Skipping that for time. The point is what happens with just the strategic context loaded."*

## Setup checklist (morning of)

- [ ] `cd ~/code/landing-demo && npm run dev` — Vite running on localhost:5173
- [ ] **Tab 1**: `http://localhost:5173/classic/` (the 2022-slop opener target). **Trailing slash is required** — Vite directory routes 404 without it. Bookmark with the slash so you don't fat-finger it on stage.
- [ ] **Tab 2**: `http://localhost:5173/` (the new-slop Lumina page). This is the page you live on for everything after Beat 2 of the opener.
- [ ] Both tabs zoomed to 125% minimum
- [ ] Test `cmd-tab` (or browser tab switch) goes Tab 1 → Tab 2 cleanly. The opener's hinge is that single switch; rehearse it
- [ ] Editor open with `index.html` visible, split with the new-page browser tab
- [ ] Claude Code session open in third pane, in `~/code/landing-demo`
- [ ] Run `/impeccable critique` on **both** pages once as a warmup; expect 8 flags on classic, 3 on new; close reports before going on stage
- [ ] Run `/impeccable live` once on the new page as a warmup; cancel before accepting (don't pollute the file)
- [ ] Verify Chrome extension is installed and toggles correctly (in case you want to demo it)
- [ ] Phone on silent. Slack quit. Notifications off.
- [ ] Backup screen recording cued in a third tab
- [ ] `git status` in `~/code/landing-demo` should be clean (so post-demo you can see exactly what the live edit changed)

---

## One last thing

The room values "demonstrations that **reveal new possibilities** rather than just accelerate existing ones." Your demo isn't faster Figma. It's a different shape of work. The live-edit moment, with the source file mutating beside the rendered output, is the most concrete possible expression of that shape.

If there's one beat to over-rehearse, it's that one.
