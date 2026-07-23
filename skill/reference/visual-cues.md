# Visual Cues Pipeline

Loaded by `{{command_prefix}}impeccable document` seed mode (Step 4) when image generation is available. Input: the five seed interview answers, the asset observations from seed Step 2, and PRODUCT.md. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

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
- **The interview**: Q1 color strategy and hue anchor, Q2 type direction, Q4 the three named references, Q5 the anti-reference. State that the anti-reference is a hard constraint on every palette.
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
  be. An off-white or near-white with a temperature tint, or a near-black
  when the mood calls for dark. Never pure #FFFFFF or #000000.
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

Light the scene to reveal color, not to set a mood. In a dim, dusky, or nocturnal rendering every color sinks into one warm-brown murk the user cannot sample from, so bright, generous light is a hard rule even when the concept's moment is dark: an "after hours" or "dawn" concept keeps its props and story but is lit like a studio still, not like the hour. Dark palettes are welcome; dark renderings are not; a near-black primary should read as a rich, clearly-lit surface, not as underexposure. Fill every `[bracketed]` slot; never leave template language in the prompt.

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
the ground and backdrop, about half the frame; [the primary's carrier],
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

Split the brief's color space into six **territories**, one per persona. Each is a one-line claim with two halves: a scene ground (a mood, a moment, a positioning angle) and, always, a **hue ground** it closes on (a named hue register). A hue-silent territory does not constrain color: give six specialists scenic territories and one shared brief, and every one of them will resolve to the brief's hue anchor; the hue ground is what makes the palettes diverge, the scene ground is what makes the stories diverge. Example set for a florist: "the delivery run before the city wakes: cold blue-teal dawn", "the atelier after hours: lacquer near-black with amber", "the potting bench: warm terracotta and unbleached paper", "gallery restraint: paper-white with one ink accent", "market-stall abundance: saturated market greens", "the drying room: muted botanical earth and rose".

Hard rules:

- **No two hue grounds share a hue family.** Six registers, six families.
- **The Q1 hue anchor belongs to exactly one territory** (two only when the brief argues for it). Name its owner; Step 3 tells everyone else the anchor is off-limits. An anchor left unassigned is an anchor every persona obeys.
- **A territory claims colors, not lighting.** "Lacquer near-black with amber" means those hues, staged in bright, clear light like every other palette; the HERO PROMPT skeleton forbids dim renderings, and a dark-moment territory ("after hours", "dawn") does not override it.
- The anti-reference (Q5) rules all six.

Assign each territory to the persona whose method suits it best (the Naturalist takes the most material ground, the Dramaturge the most emotional, the Empath the one closest to the audience's state).

Done when: six one-line territories exist, each closing on a hue ground, no two hue grounds in one family, the anchor owned by exactly one, each assigned to a persona.

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
The hue anchor ([the Q1 anchor]) belongs to row [N] alone. If that row
is yours, carry it; otherwise your primary must live in a different
hue family.
```

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
     colors sinking into shadow instead of reading bright and true,
     regenerate once, same prompt, plus "Render the scene in bright,
     generous daylight-quality studio light; every color fully lit and
     clearly readable, no darkness anywhere in the frame."

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
node {{scripts_path}}/visual-cues.mjs compile [hero.png] \
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

- **Q2 typography direction** from the seed interview. Treat it as the anchor; execute the direction instead of asking for it again.
- **Q4's three named references** and **Q5's anti-reference**. The anti-reference is a hard constraint on every pair.
- From PRODUCT.md, only `## Users`, `## Product Purpose`, `## Positioning`, and `## Brand Commitments`.
- The seed Step 2 asset observations when they exist, with the logo's letterforms as the strongest evidence.
- **Q1's hue anchor and color strategy** as mood only. Never use either to select a family.

Do **not** read PRODUCT.md wholesale into this task or add any other section to the composition context. The chosen palette does not exist yet; the picker joins it to the pairs later.

Compose six distinct territories, then resolve each into one heading and body pair:

- Keep at least five pairs inside Q2's chosen direction, varied by classification and voice within it. No two pairs may share a heading family or read as the same voice.
- Let the sixth bend the direction only when Q4, Q5, or asset letterforms argue for it, and name that reason in its `why`.
- Apply [new-work.md](new-work.md)'s `rule:skill-typo-reflex-faces` as the canonical denylist and subject-world test. A family the user named in the interview or supplied assets is the only exception.
- Follow [typeset.md](typeset.md)'s workhorse discipline. Give the heading a point of view; give the body a real text face that stays legible at 15px and provides regular and bold weights. A display face in the body slot fails the pair.
- Verify every family exists on Google Fonts under the exact current name. Spelling is part of correctness; use `Source Sans 3`, never a retired family name.
- Write one sentence in `why` that names the Q4 reference, Users fact, positioning line, commitment, or letterform observation the pair serves. Replace a sentence that could describe any brand.
- Order the pairs best-first. `pairs[0]` is the recommendation and reaches the picker pre-selected.

Choose two specimen strings from the product's own world: a headline of at most six words and one honest body sentence. Do not invent a claim or use placeholder prose.

Write `.impeccable/visual-cues/fonts.json` with this shape:

```json
{
  "version": 1,
  "specimen": {
    "headline": "Six words from the product's world",
    "body": "One honest sentence in the product's voice for the body face."
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

Write exactly six pair entries. Each role carries the single weight it needs; the picker also loads weight 700 for each body family. A per-pair `specimen` override may replace the shared strings when the brand evidence warrants it.

If Q2 is missing because the interview was skipped, say in one line that the typography set is direction-neutral, then compose all six from the four allowed PRODUCT.md sections alone. Still write the file.

Parse the finished file as JSON and verify its version, specimen, six unique ids, six unique heading families, role names, weights, and one-sentence `why` fields before continuing.

Done when: `fonts.json` is parseable, contains exactly six ranked pairs, and every family name has been checked against Google Fonts.

## Step 7: Launch the picker

Tell the user in one line that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then run `node {{scripts_path}}/picker-server.mjs` from the project root as a foreground command and parse its `PICKER_URL` line.

- **The harness has a browser tool**: open the URL with it and let the user drive. The tool is a viewport only; never drive the questionnaire yourself, because the answers are the user's.
- **No browser tool**: tell the user *"The design picker is running at [URL]; open it in your browser and finish there."* Then wait on the foreground process.

The server process exiting is the completion signal; never poll or watch the answers file while it runs.

- **Exit 0**: read the `ANSWERS` path, tell the user the answers were received in one line, then stop. Do not show or describe the cues, ask for a pick in chat, or write DESIGN.md in this turn.
- **Exit 2**: tell the user the picker closed unanswered and that they can relaunch it with the same command. Never restart it unprompted.
