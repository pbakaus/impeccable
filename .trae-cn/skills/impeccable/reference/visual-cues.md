# Visual Cues Pipeline

Loaded by `/impeccable document` seed mode (Step 4) on the questionnaire path. Input: the seed interview's three named references and one anti-reference, the asset observations from seed Step 2, and PRODUCT.md. The chat interview asks no color, typography, or motion question on this path; the questionnaire and this pipeline own those decisions. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

Tell the user once, before starting: *"Generating visual cues; this can take a minute or two."* Then work without narration. Chat carries no per-image commentary, no palette tables, no prompt dumps; the folder is the deliverable.

## The image

Each cue is **one generation**: the hero.

```text
HERO  [slug].png (1500x1500)
+---------------------------+
|   one close-framed scene, |
|   the product's world,    |
|   four scene objects      |
|   carrying the palette,   |
|   every surface in frame  |
|   one of the four colors, |
|   everything in crisp     |
|   deep focus, no blur     |
+---------------------------+
     saved as-is, NO crop
```

The **hero** is the visual cue: one close-framed scene from the product's world, its four objects carrying the palette as large color fields. This is what the user will pick between, so the colors get the real estate, and the frame has exactly two known thieves. **Blur**: an out-of-focus background is frame spent on mush, so everything renders in crisp, deep focus, front to back. **Undressed space**: every surface in frame is set-dressed to carry one of the four colors; the ground and backdrop belong to the neutral's material, and there is no bare wall, empty room, or whole person spending frame on colors nobody chose (hands mid-work belong to the scene; a face and outfit donate skin, hair, and clothing to the palette).

Example, hero = a flower atelier's worktable, framed close: unbleached linen spread as the ground and backdrop (neutral), a massed bank of wine-plum blooms in a ceramic vessel as the subject (primary), a band of dusty-rose petals beside it (secondary), one persimmon bloom set apart (tertiary), a florist's hands mid-arrangement, everything sharp.

## The studio

Palettes come from **six competing specialists**, not from you. One mind composing six palettes converges on one taste, and six versions of one mood defeat the pick round. Each specialist is a subagent locked to a **persona**: a different method of searching color space (object association, cultural reframing, remote analogy, self-imposed constraint, audience perspective-taking, emotional sequencing). Same brief, same output format, different search method; the separation is what makes the six palettes genuinely different.

The studio runs as **one parallel wave**. You carve six territories from the brief (Step 2), then all six personas spawn at once (Step 3), each composing a palette inside its own territory and staging it in its hero. No chained reviews, no revision loops: distinctness is settled upfront by the territory assignments, and speed comes from doing everything in one wave.

Subagents start without your context, so everything a specialist needs must reach it whole. The invariant material (brief packet, persona methods, territory map, craft rules, prompt skeleton, work steps) travels as one **brief file** every spawn reads; only the per-persona slots (persona number and name, territory line) ride in the spawn task itself. Copy shared blocks into the brief file **verbatim**; a summarized rule is a dropped rule, and retyping the full set into six long tasks costs minutes of pure prompt-typing per wave.

## Step 1: Assemble the brief packet

Write one self-contained text block that a specialist with zero context can design from. Include, in full:

- **The product**: from PRODUCT.md, what it is, sells, or shows; the audience; the positioning; the personality words.
- **The interview**: the three named references and the anti-reference. State that the anti-reference is a hard constraint on every palette. There is no chat color strategy or hue anchor on this path; the territories (Step 2) own the color search.
- **The assets**: the seed Step 2 observations (logo colors, recurring materials, photo moods).

Label it `BRIEF PACKET`; it goes into the brief file once (Step 3), so every specialist designs from the identical packet. Do **not** add your own palette leanings to it: the personas do the leaning.

## The six personas

The numbers only name the personas; Step 2 pairs each with a territory.

1. **The Ecological Naturalist**: derive every color from real materials, organisms, weather, or landscapes in the product's world. Name the physical source of each hex. No abstract "brand blue" thinking; the palette must feel materially plausible, textural, grounded.
2. **The Cross-Cultural Anthropologist**: treat color as cultural meaning. Compare at least two cultural lenses relevant to this audience, find where the meanings align and where they diverge, and turn that tension into the palette. Do not stereotype or flatten into cliché.
3. **The Analogy Hacker**: never start from the product category. Choose one distant domain (a jazz progression, a thermal camera, a medieval manuscript, a subway map, a laboratory stain chart) and translate its structure into color logic. The palette should never emerge from category convention, yet feel coherent once explained.
4. **The Constraint Poet**: before composing, invent three to five severe but fruitful constraints ("one accent only", "every color must survive dusk", "mineral tones plus one synthetic intruder"), then compose the strongest palette inside them. Do not relax the rules; tension is the point.
5. **The Audience Empath**: design from the audience's exact emotional and cognitive state at their first critical encounter with the product: what they need to feel, notice, and trust in that moment. The brand's ego does not vote.
6. **The Emotion Dramaturge**: build the palette as an emotional arc, not a static board. Define the felt sequence of using this product (invitation, curiosity, tension, confidence, release) and assign hue, lightness, and saturation to its beats.

Accessibility and implementation stay **out** of the personas: the PALETTE RULES block carries the contrast requirements for everyone. A persona whose identity is "the contrast checker" composes cautious mud.

## Shared blocks

These go into the brief file (Step 3) in the order its assembly list names. They are the single source of the craft rules; never restate them loosely.

### PALETTE RULES

```text
Compose exactly four hex values with a 60-30-10 balance. These are
website/app colors, headed for design tokens, not scene colors:

- neutral (~60%, the dominant): the surface, what most of a screen will
  be. An off-white or near-white with a temperature tint, at least as
  pale as #ECEAE6: a mid-tone neutral that reads fine as a scene material
  turns into a gray slab once it is a screen background. Near-black is
  the one alternative, when the mood calls for dark; there is no
  in-between. Never pure #FFFFFF or #000000.
- primary (~30%): the brand color, the mood's main carrier. Must read
  clearly against the neutral.
- secondary: structure and support: an adjacent hue, or the primary
  shifted in lightness and chroma. Visibly a different swatch, not a
  darker copy of primary.
- tertiary (~10%, the accent): the most saturated of the four and used
  smallest; distinct in hue from primary so it keeps signal value.

Hard rules:
- Write one mood phrase specific enough to compose from. Good: "dawn
  delivery run, cut stems in cold water, the city still gray". Bad:
  "modern and clean"; a phrase that fits any brand composes nothing.
- Every color earns its place: for each role, one line on what it does
  and why it fits this product. A color you cannot justify in one line
  gets replaced, not kept because it looks nice.
- Contrast is non-negotiable: primary must read clearly on the neutral;
  tertiary must pop against both. A palette that fails either is not done.
- Any two roles must be nameable apart at a glance. A dark green primary
  next to a dark green neutral is one color, not two.
- The brief's anti-reference is a hard constraint.
```

### CONCEPT RULES

```text
Attach one one-line cue concept to the palette; the hero image stages it.

- The concept lives in the product's own world, named with the brief's
  own nouns. A concept that could belong to any other product is not
  done; sharpen it until it could only be this brand.
- Give it a material world (botanical, ceramic, paper, textile, metal,
  glass, stone, food) as the supporting cast around the product's
  subject, never a replacement for it.
- Name four scene objects, the palette's physical carriers, each passing
  three tests: it lives inside the scene, so it plausibly sits in the
  hero composition; it can carry its color as one large unbroken field
  at close framing (a massed bank of blooms, a draped cloth, a glazed
  vessel; a single bud or a thin ribbon cannot, and a color whose
  carrier is one small object ships as an unjudgeable sliver); and it
  is plain and unprinted (no tags, labels, packaging, printed cards,
  or stationery), because text on an object ruins the cue.
- Name the concept with a two-word slug (amber-dusk, coastal-glass).
```

### HERO PROMPT skeleton

Written like screenplay direction, not a keyword list: subject doing something, in a place, in a light. The scene stays the product's world; the palette's real estate is won inside it, by set dressing and by focus, never by deleting the scene. **Never ask for shallow depth of field, bokeh, or a soft background**: an out-of-focus stretch of frame is real estate spent on mush, so the prompt demands crisp, deep focus front to back. And every surface in frame is dressed to carry one of the four colors: the ground and backdrop belong to the neutral's material, and no bare wall, empty room, or whole person appears (hands mid-work belong to the scene; a face and outfit donate skin, hair, and clothing to the frame).

Name every color in plain language only, as a rich material description ("deep wine-plum, the color of reduced port"), tied to its carrier. **Never put a hex code, or any number, in an image prompt**: image models that render text well will paint it onto the image as a label or a swatch strip, and even one stray numeral fails the wordless check below. The hexes already travel in the PALETTE report line, and the compile step snaps them to rendered pixels; the prompt's job is the color's look, not its code. For the same reason, say what fills the frame instead of listing what to omit; a bare "no text" line is the weakest form of the instruction and the wordless sentence below is the strong form. Keep both.

Light the scene to reveal color, not to set a mood. In a dim, dusky, or nocturnal rendering every color sinks into one warm-brown murk the user cannot sample from, so bright, generous light is a hard rule even when the concept's moment is dark: an "after hours" or "dawn" concept keeps its props and story but is lit like a studio still, not like the hour. Dark palettes are welcome; dark renderings are not; a near-black primary should read as a rich, clearly-lit surface, not as underexposure.

The neutral's ground pays the highest price for shading. The compile step snaps each role to the pixels the hero actually rendered, and the picker shows the snapped value, so a nominally off-white linen that renders in mid-gray shadow ships a mid-gray surface color to the user. Describe the neutral's material as pale in the prompt ("pale unbleached linen, near-white in even light") and keep its field lit edge to edge, so the rendered ground stays as pale as the composed hex. Fill every `[bracketed]` slot; never leave template language in the prompt.

```text
One full-bleed photograph, square format, framed close: [one scene from
the product's world: subject and what it is doing, setting], the subject
filling most of the frame, not a wide view of the room. The scene
contains [object A], [object B], [object C], and [object D], all plainly
visible. The scene is art-directed as bold color blocking in a strict
four-color story: every surface in frame carries one of the four colors,
each color one large unbroken field, none reduced to a sliver, no
stretch of frame left to a color outside the four: [the neutral's
carrier], [plain-language color with a material-world comparison], as
the ground and backdrop, about half the frame, evenly lit edge to edge
with no shadow gradient across it; [the primary's carrier],
[color description], one continuous mass over roughly a third of the
frame, carried by the main subject; [the secondary's carrier], [color
description], a clear supporting field beside it; [the tertiary's
carrier], [color description], one small vivid accent, big enough to
read at a glance. Focus: deep and even, every object and surface in
crisp sharp focus from front to back; no blur, no bokeh, no soft
out-of-focus background anywhere in the frame. Camera: [tight still-life
framing and angle, e.g. "straight-on still life at table height" or
"high overhead of the worktable"]. Lighting: bright, even, generous
studio daylight; every color fully lit, true, and saturated, no area
lost to shadow. Mood: [two or three adjectives from the brief's
personality]. The image is completely wordless: every material is plain
and unprinted, a world with no lettering, numerals, tags, labels, or
graphics anywhere in it. Rich, saturated, editorial color; not a dim,
dusky, nocturnal, or candlelit image. Photorealistic, real texture. No
text, no watermark.
```

## Step 2: Carve the territories

Split the brief's color space into six **territories**, one per persona. Each is a one-line claim with two halves: a scene ground (a mood, a moment, a positioning angle) and, always, a **hue ground** it closes on (a named hue register). A hue-silent territory does not constrain color: give six specialists scenic territories and one shared brief, and every one of them will resolve to the product's one obvious hue; the hue ground is what makes the palettes diverge, the scene ground is what makes the stories diverge. Example set for a florist: "the delivery run before the city wakes: cold blue-teal dawn", "the atelier after hours: lacquer near-black with amber", "the potting bench: warm terracotta and unbleached paper", "gallery restraint: paper-white with one ink accent", "market-stall abundance: saturated market greens", "the drying room: muted botanical earth and rose".

Hard rules:

- **No two hue grounds share a hue family.** Six registers, six families.
- **A hue anchor exists only when an asset fixes one** (a logo's sampled color, a recurring moodboard hue from the seed Step 2 observations). When one exists it belongs to exactly one territory (two only when the brief argues for it). Name its owner; Step 3 tells everyone else the anchor is off-limits. An anchor left unassigned is an anchor every persona obeys. No asset anchor: no owner, and the map's anchor sentence is dropped.
- **A territory claims colors, not lighting.** "Lacquer near-black with amber" means those hues, staged in bright, clear light like every other palette; the HERO PROMPT skeleton forbids dim renderings, and a dark-moment territory ("after hours", "dawn") does not override it.
- The anti-reference rules all six.

Assign each territory to the persona whose method suits it best (the Naturalist takes the most material ground, the Dramaturge the most emotional, the Empath the one closest to the audience's state).

Done when: six one-line territories exist, each closing on a hue ground, no two hue grounds in one family, any asset-fixed anchor owned by exactly one, each assigned to a persona.

## Step 3: The wave (parallel)

**Pick the generation path first.** The harness's native image-generation tool is the path whenever one exists and works; a native tool that **cannot generate** (zero credits, failed auth) counts as absent: fall through without asking the user, and mention the swap in the final report. The keyless path is [image-api.md](image-api.md): its shipped wrapper and pre-answered setup are canonical, so a key in `.impeccable/.env` or a leftover project-local wrapper never outranks a working native tool, and never needs re-deriving when it is the path.

**Do not smoke-test the path.** Presence is the whole check: a tool the harness lists works, and the image-api.md wrapper already retries transient failures internally, so a preflight generation buys nothing the first persona's report would not carry, and it costs a generation call and half a minute on every clean run. Instead, fill the brief file's tool slot with the exact call the spawns will make: the tool or wrapper command, the square-size parameter to pass, where it writes output files (some native tools ignore directory paths and save to a fixed folder of their own; say so in the slot, so no specialist rediscovers it alone), and whether the output is already guaranteed square (the shipped wrapper's is), so no specialist burns a tool call measuring it.

If the harness exposes any subagent/spawn tool (Task, spawn_agent, agents, or similar), parallel is **required**, not preferred: emit all six spawns as **one tool-call batch, a single message carrying six spawn calls**, one persona per subagent, each doing the full job (palette, concept, hero), and only then wait for the reports. Spawning one, waiting for its report, then spawning the next is a serial loop and a failure even though every spawn "used a subagent"; so is generating any image yourself while a subagent tool exists. The whole run must take only as long as the slowest single persona. Attach the harness's image-generation skill to each spawn when the harness expects that (Codex: the `imagegen` skill). (No subagent tool at all: Step 4.)

### The brief file

Write `.impeccable/visual-cues/brief.md` once, before spawning: the SPECIALIST BRIEF body below with its tool slot filled, then, appended in this order, the BRIEF PACKET, **The six personas** list verbatim from this document, the TERRITORIES block from Step 2's carve, then PALETTE RULES, CONCEPT RULES, and the HERO PROMPT skeleton with its framing paragraphs, verbatim from this document. One byte-exact file read by all six replaces six retyped copies of the same several-thousand-word block: the spawn tasks stay a few lines long, the wave starts in seconds instead of minutes, and retries reread the identical rules. **If the harness's subagents cannot read files**, paste the brief file's full contents into each task instead; the file stays the single source either way.

The TERRITORIES block is the wave's off-limits map, written once here instead of five off-limits lines retyped into every spawn:

```text
TERRITORIES (your task names your row; every other row is off-limits)
1. [persona name]: [territory line]
2. [persona name]: [territory line]
3. [persona name]: [territory line]
4. [persona name]: [territory line]
5. [persona name]: [territory line]
6. [persona name]: [territory line]
The hue anchor ([the asset-fixed anchor]) belongs to row [N] alone. If
that row is yours, carry it; otherwise your primary must live in a
different hue family.
```

The block's closing anchor sentence appears only when Step 2 named an asset-fixed anchor and its owner; with no anchor, end the block after row 6.

SPECIALIST BRIEF body:

```text
You are a color specialist. You compose one brand palette inside an
assigned territory, then stage it in one hero image. Your spawn task
names your persona and your territory; this file carries everything
else: the brief packet, your persona's method, the territory map, the
craft rules, the prompt skeleton, and the steps below.

This file is your only read. Do not open PRODUCT.md, DESIGN.md, or any
other repo file: the BRIEF PACKET already carries everything they would
tell you, and every extra read costs the wave time.

Generate the image with [the exact tool or command for the chosen
generation path, the square-size parameter to pass, and where it
writes output files]. Use only that; do not edit repo files.

The hero gets a hard budget of three generation calls, all reasons
combined (failed calls, timeouts, and the retry checks below). A call
that fails with a network, API, or timeout error may be re-run as-is
within that budget; when the budget is spent, stop and report per step
5. The failure is the parent's problem, not yours: never debug DNS or
connectivity, never install packages, and never edit or rewrite the
generation tooling.

1. Compose your palette, in your persona's method, inside your
   territory, following the PALETTE RULES section below.

2. Draft the concept for the palette, following the CONCEPT RULES
   section below.

3. Critique your own work before touching the image. Check the palette
   against every PALETTE RULES line, against your territory's hue
   ground, and against every other row of the TERRITORIES block; check
   the concept against every CONCEPT RULES line. Name each failure and
   fix it. A primary that drifted into another territory's hue family,
   or into an anchor you do not own, is a failure to fix now, not one
   to ship.

4. Build the hero prompt from the HERO PROMPT skeleton below and
   generate the HERO image at 1500x1500 or the nearest supported
   square. The image must be square: a size line inside the prompt
   does not pin the canvas, so whenever the tool accepts a size or
   aspect-ratio parameter, pass square (1:1) explicitly; the compile
   step rejects non-square images, and the fix is regenerating with
   that parameter actually set, not editing the file. Five sibling
   specialists share the generation tool's output folder, so a default
   output name is a race that hands you a sibling's image: if the tool
   accepts an output filename, pass [slug]-hero.png, and work only with
   the exact file path the tool reports back for YOUR generation. A
   tool that ignores directory paths and saves to its own fixed folder
   is normal, not an error: after the inspection below, copy the
   reported file to [visual-cues dir]/[slug]-hero.png and report the
   copy's path.

   Open the result and inspect it once, four checks, each with at most
   one retry, all inside the three-call budget; keep the last result
   regardless.
   - Ownership: the scene is yours, staging your palette; a wrong
     subject or palette means you picked up a sibling's file from the
     race above, so regenerate once with the [slug] filename.
   - Wordless: any lettering, numeral, label, or swatch strip anywhere
     in the frame fails the cue; regenerate once, same prompt, plus
     "The image contains no lettering, numerals, or graphic marks of
     any kind; every surface is plain and unprinted."
   - Real estate: if the palette's fields read as slivers, with frame
     spent on a blurred background, a bare wall, an empty room, or a
     whole person instead of the four colors, regenerate once, same
     prompt, plus "Frame tighter on the scene's four color carriers;
     every surface in frame carries one of the four colors, and
     everything is in crisp sharp focus, no blur anywhere."
   - Light: if the image is dim, dusky, or nocturnal, with palette
     colors sinking into shadow, or the neutral's ground renders
     visibly darker than its composed color (off-white linen reading
     as mid-gray), regenerate once, same prompt, plus "Render the
     scene in bright, generous daylight-quality studio light; every
     color fully lit and clearly readable, the ground pale and evenly
     lit edge to edge, no darkness anywhere in the frame."

5. Reply with exactly these three lines and nothing else, the path
   being the file you verified in step 4:

COMPLETED [slug]
HERO [absolute path to the hero PNG]
PALETTE primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB

If the budget runs out first, reply instead with the ERROR line plus
one line for each thing you finished before the failure, so a retry
can start where you stopped:

ERROR [persona number] [short reason]
PALETTE primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB
HERO-PROMPT [the finished hero prompt, on one line]
```

### The spawn task

Each spawn task is a few lines; the brief file carries the weight. The persona's method, the off-limits map, and the anchor rule all live in the brief; do **not** paste them back into the tasks, that is the retyping the brief file exists to kill:

```text
You are a color specialist. Read [absolute path to
.impeccable/visual-cues/brief.md] now, before anything else, and follow
it exactly: it carries your brief, your persona's method, the territory
map, craft rules, prompt skeleton, work steps, generation budget, and
report format.

You are persona [N], [persona name].
YOUR TERRITORY: [this persona's one-line territory]

Your answer is unsuccessful if it occupies the same visual, emotional,
or strategic territory as another specialist, or if your primary lands
in a hue family another territory claims. Stay inside your own.
```

Six spawns fit the observed Codex ceiling of 6 concurrent subagents, so the wave normally runs whole. If a spawn is rejected with a thread-limit error, collect the accepted spawns, close those agents to release their slots, then run a second pass for the rejects. If every spawn ERRORs because subagents lack the image tool, fall back to Step 4's loop using the territories you already carved. Close every agent after collecting its report. If two reports share a slug, rename one before Step 5 (the compile `--slug` flag controls the filenames).

Retry an ERROR persona at most once, and never from scratch: the retry task is the original spawn task plus the ERROR report's PALETTE / HERO-PROMPT lines and one added instruction, "these lines are finished work from your first attempt; skip the steps they cover and resume at the first uncovered step." An ERROR persona that fails its retry is dropped; five good cues beat a stalled pipeline.

Done when: every persona has either a three-line COMPLETED report or an ERROR report.

## Step 4: Serial path (no subagents)

Only when the harness has no subagent tool at all: pick the generation path by the same precedence rule, keep the same six territories, and play all **six** personas yourself, one at a time and honestly in-method (the Naturalist names physical sources; the Constraint Poet writes its constraints before composing), following the SPECIALIST BRIEF body from its step 1 (palette inside the territory, concept, hero, look-and-retry) and recording the same facts a subagent would report (slug, hero path, palette). No brief file needed: this document is already in your context. The user still gets six cues; only the clock differs.

Same done-condition as Step 3, over all six personas.

## Step 5: Compile

Before anything else, two gates on the reported heroes:

- **Unique**: hash every reported hero (`md5 [paths]`); each must be unique. Two identical heroes mean two subagents raced on a shared default output filename; re-spawn one of the pair and take its fresh file before compiling.
- **Square**: check every reported hero's dimensions (`sips -g pixelWidth -g pixelHeight [paths]` on macOS); width must equal height. The compile script rejects non-square inputs, and squaring after the fact is off the table (cropping eats scene, padding invents background), so a non-square hero is a failed generation: re-spawn that persona once and take the fresh file. Still non-square after the re-spawn: drop the cue.

A gate re-spawn follows Step 3's retry pattern: the original spawn task plus the report's PALETTE line (its palette was fine; only the image failed the gate) and the resume instruction, so the retry regenerates the hero without recomposing.

For each COMPLETED report, run one command, carrying the report's slug and its `PALETTE` line:

```text
node .trae-cn/skills/impeccable/scripts/visual-cues.mjs compile [hero.png] \
  --slug [slug] \
  --palette "primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB" \
  --out .impeccable/visual-cues
```

The script copies the hero untouched to `[slug].png` (removing a `[slug]-hero.png` intermediate inside the out dir, so the folder holds one file per cue, not a byte-identical pair); for each palette role it searches the hero for the closest rendered pixel (`snapped`, with its hero position), then updates `cues.json`:

```json
{
  "cues": ["amber-dusk", "coastal-glass"],
  "palette": {
    "amber-dusk": { "primary": { "hex": "#B8422E", "snapped": "#B4402F", "at": [312, 540] } }
  }
}
```

Done when: `cues.json` lists one entry per completed palette and every listed slug has its hero PNG on disk.

## Step 6: Compose the font pairs

Run this pass yourself after compiling the cues and before launching the picker. Do not spawn specialists; six pairs need one editor holding the same brand facts and ranking them together.

Build the composition context from exactly these inputs:

- **The surface modes** this step names below. The interview asks no typography direction on this path, so the modes, the references, and the assets are the anchor; compose from them instead of asking for a direction.
- **The three named references** and **the anti-reference** from the seed interview. The anti-reference is a hard constraint on every pair.
- From PRODUCT.md, only `## Users`, `## Product Purpose`, `## Positioning`, and `## Brand Commitments`.
- The seed Step 2 asset observations when they exist, with the logo's letterforms as the strongest evidence.

Do **not** read PRODUCT.md wholesale into this task or add any other section to the composition context. The chosen palette does not exist yet; the picker joins it to the pairs later.

### Name the surfaces before composing

A pair that carries a landing page can fail a dashboard outright. The landing page asks the heading face for a six-word line at 40px and up; the dashboard asks the body face for a 12px column label sitting next to a number. Suggest fonts without knowing which of those is on the table and you are guessing at the only question that separates the shortlists.

So decide first what this product is made of, from PRODUCT.md and the codebase, using the four surface kinds the picker's first question offers: `persuade` (landing, marketing, pricing), `operate` (app UI, dashboards, admin, settings), `read` (docs, articles, guides, changelogs), `experience` (portfolios, galleries, showcases). Name every kind the product already implies, not the one it leads with: a tool with a marketing site and a documentation site is `operate, read, persuade`. This is the same set Step 7 writes into `context.json` as `modes`, so make the judgment once, here, and carry it. No clear signal anywhere leaves the set at `persuade` alone.

What each surface asks of a pair:

- **persuade**: the heading face is the page. It has to hold a short line at display size, where counters, joins, and one badly drawn character are all visible at a glance. The body face sets a paragraph and two button labels, so it is asked for less. This is the surface where a face with a point of view earns its place.
- **operate**: the body face is also the interface face, and it works between 11px and 14px on column headings, form labels, menu items, and numbers in a row. Ask it for a 1, l, and I that stay apart, a 0 that does not read as O, lining figures, and a medium or semibold that the family actually draws rather than one the browser fakes. Headings here are 16px to 24px panel titles set many times per screen, so a face that only comes alive at poster size is the wrong heading for this surface.
- **read**: the body face carries hundreds of words at 16px to 18px across a 60 to 75 character line, which is the hardest job on this list. Ask it for a generous x-height, an italic the family drew rather than sloped, and a bold that still reads inline. The heading face sits inside running text at 1.2 to 1.6 times the body, close enough that a mismatch in proportion shows immediately.
- **experience**: the work is the subject and the type is the room around it. The heading face can be the most expressive of the six pairs. The body face sets captions, credits, and index metadata at 11px to 13px, often tracked out in caps, so it has to stay even when letter-spaced and survive at those sizes.

Rank against the strictest surface in the set, never the loudest. Operate and read set the floor the body face has to clear; persuade and experience set how far the heading is allowed to go. Every pair still has to serve every named surface: the user picks one pair for the whole product, and one type system comes out the other end. A pair that only holds up on one surface belongs at the bottom of the list, or off it. None of this loosens [new-work.md](new-work.md)'s `rule:skill-typo-reflex-faces`, which rules all six pairs whatever the surfaces are.

Compose six distinct territories, then resolve each into one heading and body pair:

- Spread the six across type directions that serve the surface set (serif display + sans body, single sans, display + mono, and their neighbours), each pair's voice argued from a named reference, an asset letterform, or a PRODUCT.md brand fact. No two pairs may share a heading family or read as the same voice.
- Apply [new-work.md](new-work.md)'s `rule:skill-typo-reflex-faces` as the canonical denylist and subject-world test. A family the user named in the interview or supplied assets is the only exception.
- Follow [typeset.md](typeset.md)'s workhorse discipline. Give the heading a point of view; give the body a real text face that stays legible at 15px and provides regular and bold weights. A display face in the body slot fails the pair. Where the surface set names `operate` or `read`, that 15px floor is not the test the body face has to pass: the sizes in those two entries above are.
- Verify every family exists on Google Fonts under the exact current name. Spelling is part of correctness; use `Source Sans 3`, never a retired family name.
- Every pair uses Latin-script faces, and the specimen headline and preview copy are written in English, even when the product's own language is not. Multilingual and CJK support is not built yet: a non-Latin face renders the picker's previews and scale sheets wrong, so English stands in for now. TODO: language-aware pairs that match PRODUCT.md's language and load the right Google Fonts subsets, once the picker's previews support them.
- Write `why` as three to five words naming the pair's voice, not a sentence about the brand. The picker sets it in tracked caps under the two family names, so anything longer wraps and stops scanning. `Considered and editorial`, not `Source Serif 4 gives the questionnaire an editorial voice while Source Sans 3 keeps guidance easy to scan`.
- Order the pairs best-first, judged on the strictest surface in the set. `pairs[0]` is the recommendation and reaches the picker pre-selected.

Choose the headline and every wireframe label from the product's own world. Do not invent claims or use placeholder prose that could describe any brand.

- **Hero**: a headline of at most six words (`specimen.headline`).
- **Wireframe**: every other label the type-preview artboard shows (`preview`): a short brand mark, four nav labels, nav and menu actions, two CTA labels, four proof chips, a section title, one section link, three gallery cards (`title` + `meta`), four footer links, and a footer mark. Pull each string from PRODUCT.md, the interview, or supplied assets. Keep labels short enough to fit the artboard.

**Running text is not yours to write.** The picker sets every paragraph in lorem, because a body face is judged on texture and real prose pulls the eye into reading it instead. Leave `specimen.body` and `preview.sectionBody` out of the file.

Write `.impeccable/visual-cues/fonts.json` with this shape:

```json
{
  "version": 1,
  "specimen": {
    "headline": "Six words from the product's world"
  },
  "preview": {
    "brand": "Ab",
    "nav": ["Shop", "Stories", "Visit", "About"],
    "navAction": "Order",
    "menuAction": "Menu",
    "ctaPrimary": "Primary action",
    "ctaSecondary": "Secondary action",
    "proof": ["Proof one", "Proof two", "Proof three", "Proof four"],
    "sectionTitle": "Section title",
    "sectionLink": "Section link",
    "gallery": [
      { "title": "Card one", "meta": "Detail one" },
      { "title": "Card two", "meta": "Detail two" },
      { "title": "Card three", "meta": "Detail three" }
    ],
    "footerLinks": ["Link one", "Link two", "Link three", "Link four"],
    "footerMark": "© Brand"
  },
  "pairs": [
    {
      "id": "kebab-slug",
      "name": "Short human label",
      "heading": { "family": "Exact Google Fonts Name", "weight": 600 },
      "body": { "family": "Exact Google Fonts Name", "weight": 400 },
      "why": "One sentence tying this pair to a named brand fact."
    }
  ]
}
```

Write exactly six pair entries. Each role carries the single weight it needs; the picker also loads weight 700 for each body family. A per-pair `specimen` or `preview` override may replace the shared strings when the brand evidence warrants it.

If the references are missing because the interview was skipped, say in one line that the typography set is composed from product truth alone, then compose all six from the four allowed PRODUCT.md sections. Still write the file.

Parse the finished file as JSON and verify its version, specimen, preview (every field above), six unique ids, six unique heading families, role names, weights, and short `why` fields before continuing.

Done when: `fonts.json` is parseable, contains exactly six ranked pairs, every family name has been checked against Google Fonts, and the preview copy reads as this product, not generic SaaS filler.

## Step 7: Launch the picker

Before launching, write the surface set from Step 6 into `.impeccable/design-context/context.json` as a top-level `modes` array: any of `persuade`, `operate`, `read`, `experience`. Do not re-derive it; the font pairs were composed against that reading, and a second judgment here would hand the user tiles the shortlist never answered to. The picker's first question pre-checks those tiles as its starting point; the user corrects the set by hand, and the final selection returns in the answers as `surface-modes`. Omit the field when the product gave no clear signal; the picker then starts from `persuade` alone.

In the same write, add a top-level `context` object carrying the chat half of the run. The whole file is `{ "schemaVersion": 1, "modes": [...], "context": {...} }`, and it is the store's copy of what chat learned, because after the last question the picker shows the user a design context document assembled from everything the interview learned, and the browser only knows what it asked itself. Every field is optional and the document renders whatever arrives, so fill what the run actually established and leave out the rest:

```json
"context": {
  "product": {
    "name": "[product name]",
    "purpose": "[one-sentence purpose from PRODUCT.md]",
    "success": "[the success definition from PRODUCT.md Product Purpose, one line]",
    "platform": "[bare value from PRODUCT.md Platform: web, ios, android, or adaptive]",
    "positioning": { "not": "[what it is not, from PRODUCT.md Positioning]", "this": "[what it is instead]" },
    "clarities": ["[one line per item of PRODUCT.md's what-must-be-clear-first list]"],
    "conversion": "[primary conversion from PRODUCT.md Product Purpose, one sentence-case action phrase: Book a consultation]",
    "principles": [{ "title": "[principle name from PRODUCT.md Design Principles]", "detail": "[one clause: what it means for design]" }],
    "surfaces": { "persuade": "[what this surface is for this product, one line]", "operate": "[...]", "read": "[...]", "experience": "[...]" },
    "operatingContext": "[one line from PRODUCT.md Operating Context]"
  },
  "audience": {
    "primary": "[who]", "secondary": "[who]",
    "emotion": "[emotional goal on landing]",
    "leaving": "[what they should leave with, from the purpose and success definition]",
    "needs": ["[need]"],
    "trust": ["[trust trigger, from PRODUCT.md Evidence on Hand and Users]"],
    "inclusion": ["[who must not be excluded, from PRODUCT.md Accessibility and Inclusion]"]
  },
  "brand": {
    "words": ["[word]"],
    "personality": "[one sentence from PRODUCT.md Brand Personality]",
    "principles": ["[one line per principle from PRODUCT.md Product Principles, or the legacy Design Principles heading]"],
    "voice": [{ "say": "[a concrete line the product would write; 2 to 4 pairs, wording examples, never adjectives]", "not": "[the same message written the way the product refuses to sound]" }],
    "commitments": ["[one line per commitment from PRODUCT.md Brand Commitments]"]
  },
  "assets": [
    "[asset name: what Step 2 read off it; a plain string when no file was provided]",
    { "file": "[filename staged in .impeccable/design-context/assets/]", "kind": "[logo, moodboard, or reference]", "note": "[the one-line Step 2 observation for this file]" }
  ],
  "color": { "assetLocks": ["[one short color fact an asset fixes, e.g. Primary locked from the logo mark; only when an asset names one]"] },
  "interview": {
    "references": [{ "name": "[interview reference, one entry per name]", "takeaway": "[one clause: what this reference lends the design]" }],
    "antiReference": { "name": "[the interview's anti-reference]", "why": "[one clause: why this is the wrong direction]" }
  }
}
```

Quote the user's answers, not paraphrases of them; the document labels interview fields as the questions they answered. A missing block renders as a pointer to where that truth lives (PRODUCT.md), so a run with no `context.json` at all still produces a complete document. The document reads each field from `context.json` first and falls back to a legacy `cues.json` that still carries it.

The optionality is field by field, and the document omits the block of any field that does not arrive, so fill a field only when its PRODUCT.md section or interview answer exists. A legacy PRODUCT.md without Positioning, Platform, Operating Context, or Brand Commitments yields a context without those fields, never an invented value. `product.clarities` carries PRODUCT.md's "What must be clear first" list under a shorter key. `product.conversion` names the single action the product most wants. `product.principles` carries PRODUCT.md's Design Principles, one `{ title, detail }` entry per line. `product.surfaces` maps each mode the run might choose to what that surface is for this product, not the generic tile copy. Only include keys for surfaces that exist in the product; the document reads the map for whichever surfaces the questionnaire chose. `interview.references` and `interview.antiReference` also accept their older shapes, plain strings, which render as the bare pills and single-name callout they always did. Never write `interview.colorStrategy`, `interview.hueAnchor`, `interview.typeDirection`, or `interview.motionEnergy`: the chat interview does not ask those questions on this path, `answers.json` owns color, typography, and motion, and the document already renders its interview-direction blocks only when those keys arrive, so their absence reads as chat silence, not as a gap. `assets` mixes both shapes in one list: a file the user actually provided is staged under `.impeccable/design-context/assets/` (seed Step 2 owns the copy) and written as the object form, which the document renders as an image (a `logo` proofed on the committed primary and neutral grounds, a `moodboard` or `reference` in a wide frame, the note under it); a words-only observation stays the plain string it always was.

Three of the additions are derived at write time rather than asked: `brand.principles` copies the PRODUCT.md principles list (the current Product Principles heading or the legacy Design Principles one), `brand.voice` distills Brand Personality and Brand Commitments into two to four say / not pairs, each half a concrete line of wording the product would or would not publish, never an adjective, and `color.assetLocks` records color facts the provided assets fix (one short line each, written only when Step 2 actually read such a fact off an asset). None of the three adds an interview question, and all three are omitted rather than invented when their source is missing.

Five of the questions are then answered per surface rather than once for the whole run, because the answer that suits a marketing page rarely suits the tool it sells: `color-strategy`, `motion-energy` (how much movement there is), `boundary-style` (how sections are separated), `corner-style` (how round shapes are), and `depth-style` (how far off the page things sit). Each of the five comes back twice over. The bare key holds the leading surface's answer, which is the first chosen tile in tile order and the one every later screen previews. Alongside it is one `<key>-<mode>` key for every surface chosen, `<mode>` being `persuade`, `operate`, `read`, or `experience`. Surfaces the user never opened are included too, holding the default for their kind; a surface nobody chose returns nothing at all.

`motion-energy` is the one exception to that shape, because the question is only put to two of the four surfaces. A landing page and a portfolio are watched, so how much they move is a house decision; a tool and a document are worked in, and their movement follows the interface. So the motion keys cover the chosen surfaces among `persuade` and `experience` only, and the bare key holds the first of those two in tile order rather than the run's leading surface: on an app UI plus portfolio run, `motion-energy` is the portfolio's answer. **When a run chooses neither of those surfaces the question is never asked, and no `motion-energy` key comes back at all.** Read it as absent rather than defaulted, and say nothing about movement in DESIGN.md; a default written as a decision is a decision the user never made.

`layout-structure` (how strict the composition is) is put to the same two surfaces, for the neighbouring reason: on a landing page and a portfolio the composition of the page is the thing being judged, where a tool's regions and a document's single measure come from what they have to hold. It is not a per-surface key, though. One answer is kept for the whole run and every surface is previewed on it, so **it comes back as the bare `layout-structure` and nothing else, owned by the first of `persuade` and `experience` in tile order, and it is absent entirely on a run of neither.** Read that absence the same way: no grid rule in DESIGN.md, and nothing borrowed from the interview to cover the gap.

The picker does not offer every option on every surface. A landing page can take any answer to all five questions, and the other three surfaces have options withheld from them: a page people work in or read at length is not offered the loudest color or the deepest shadow, a tool is not offered separation by spacing alone, and a portfolio is not offered four working colors or fully round controls. So a value that comes back is one that suits the surface it came from, and a difference between two surfaces is a decision rather than an inconsistency to reconcile.

When more than one surface comes back, DESIGN.md says what each of them does with color, movement, section separation, corner radius, and depth, instead of stating one answer for the product.

Tell the user in one line that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then run `node .trae-cn/skills/impeccable/scripts/picker-server.mjs` from the project root as a foreground command and parse its `PICKER_URL` line.

- **Cursor**: `browser_navigate` to the `PICKER_URL`; that is the in-IDE browser, where the questionnaire belongs. Do not skip this, and do not use the system opener while the tool works. The tab is the user's viewport only; never drive the questionnaire yourself, because the answers are the user's.
- **Another harness with a browser tool**: open the URL with that tool, on the same viewport-only rule.
- **No browser tool, or the tool call failed**: open the URL with the system opener (macOS `open`, Linux `xdg-open`), then tell the user in one line to finish in the opened tab.
- **Even the opener failed**: tell the user *"The design picker is running at [URL]; open it in your browser and finish there."*

Whichever branch ran, wait on the foreground process.

A relaunch on a project that has already been through this arrives with the previous answers filled in, and resumes an unfinished run from its own draft; `--fresh` starts blank. [design-context.md](design-context.md) owns that path.

The server process exiting is the completion signal; never poll or watch the answers file while it runs.

- **Exit 0**: read the `ANSWERS` path, tell the user the answers were received in one line, then return to [document.md](document.md) Steps 5-6 and write the seed DESIGN.md from that file (its questionnaire-seed mapping owns which key lands where). Do not show or describe the cues or ask for a pick in chat; the picker already settled the pick. The user's tab is meanwhile showing the design context document the picker built from the run, and that document is now a working surface: on submit the server forked a detached edit session (`picker-doc-session.mjs`) that keeps the tab connected. After the seed DESIGN.md is written, enter the edit loop below.
- **Exit 2**: tell the user the picker closed unanswered and that they can relaunch it with the same command. Never restart it unprompted.

## The document edit loop

The revealed document is editable in place, on live mode's division of labor:

- **Field edits are applied before you hear about them.** A palette color or a line of product truth is staged in the page, and pressing Apply sends the batch to the session, which writes every value into the store and journals it. What reaches you is the prose those values leave stale: a `save_batch` event naming each change and the document it is owed in.
- **Asks in words queue for you from the start.** Font changes (including uploaded faces, saved under `.impeccable/design-context/fonts/`) and freeform requests arrive as `edit_request` events, because there is no value to apply until you decide what it should be.
- **The session is the only writer of the store while it runs.** Never write `answers.json` or `context.json` yourself during the loop; attach the values to your reply instead (below) and let the session apply them. DESIGN.md and PRODUCT.md are yours.

After writing the seed DESIGN.md, tell the user in one line that the document in their tab is live for edits, then poll:

```
node .trae-cn/skills/impeccable/scripts/picker-doc-poll.mjs
```

One-shot, exactly like live mode's poll: it blocks until one event and prints it as JSON. Run it on live mode's harness policy: on Claude Code as a background task; on Cursor as a one-shot poll in a background terminal with notify on `"type":"(edit_request|exit)"`; on Codex as a yielded foreground exec; elsewhere one-shot foreground. Never `--timeout` it short.

- `{"type":"edit_request", "id", "kind", "prompt", "category", "payload"}`: do the work. Apply the change to DESIGN.md, move any uploaded font files where the project keeps assets, then reply and poll again. Where a questionnaire key names the same fact, attach it rather than writing it, so the tab re-renders it and one process stays in charge of the store:

  ```
  node .trae-cn/skills/impeccable/scripts/picker-doc-poll.mjs --reply <id> done "One line the user sees in the tab"
  node .trae-cn/skills/impeccable/scripts/picker-doc-poll.mjs --reply <id> done "Swapped the pair" --answers '{"font-heading":"Fraunces"}'
  ```

  Reply `error` with a reason when the ask cannot be applied; reply `retry` to put it back in the queue untouched.
- `{"type":"save_batch", "id", "changes", "downstream", "replyCommand"}`: the values are already in the store, so do not apply them again. Read `downstream` and bring each named document in line: `design-md` items are values DESIGN.md states (swap the value, and rename a color whose description no longer fits it), `product-md` items are product truth PRODUCT.md owns. Then reply with the command the event carries. A document that does not exist yet, or a value the document already carries, is success: reply `done`. Reply `error` only when a document exists and cannot be edited.
- `{"type":"timeout"}`: nothing arrived in the budget; poll again.
- `{"type":"exit"}`: the session ended (tab closed or timed out). Before moving on, read `runtime/journal.jsonl` for `change` entries you never saw a `save_batch` for, which is what a session that died mid-save leaves behind, and reconcile the prose around them. Then stop polling; the loop is over.

The user may keep working in chat while the document sits open; treat an `edit_request` like any other user instruction, just delivered through the tab.
