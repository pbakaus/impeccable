# Visual Cues Pipeline

Loaded by `{{command_prefix}}impeccable document` seed mode (Step 4) when image generation is available. Input: the five seed interview answers, the asset observations from seed Step 2, and PRODUCT.md. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

Tell the user once, before starting: *"Generating visual cues; this can take a minute or two."* Then work without narration. Chat carries no per-image commentary, no palette tables, no prompt dumps; the folder is the deliverable.

## The image

Each cue is **one generation**: the hero.

```text
HERO  [slug].png (1500x1500)
+---------------------------+
|                           |
|   one close-framed scene, |
|   the product's world,    |
|   four scene objects      |
|   carrying the palette,   |
|   four palette colors     |
|   as large color fields   |
|                           |
+---------------------------+
     saved as-is, NO crop
```

The **hero** is the visual cue: one tightly framed full-bleed composition that stages the concept's palette in large color fields; this is what the user will pick between, so every palette color gets real estate. No grid, no regions: the whole frame is the scene, with the concept's four objects inside it as the palette's physical carriers.

Example, hero = a flower atelier's worktable: the wrapping ribbon, a single stem, a row of loose petals, and the ceramic vase, each carrying one of the palette's colors.

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
  two tests: it lives inside the scene, so it plausibly sits in the hero
  composition; and it carries no writing (no tags, labels, packaging,
  printed cards, or stationery), because text on an object ruins the cue.
- Name the concept with a two-word slug (amber-dusk, coastal-glass).
```

### HERO PROMPT skeleton

Written like screenplay direction, not a keyword list: subject doing something, in a place, in a light. Every palette color is named twice, as a plain-language color and as its hex, and tied to a physical carrier in the scene; a hex with no carrier gets ignored, and a carrier too small reads as noise. The cue's job is to show the palette, so the colors get **real estate**: frame tight on the subject rather than wide on the room, and stage each color as a large unbroken field. A wide atmospheric shot renders the palette as slivers the user cannot judge.

Light the scene to reveal color, not to set a mood. In a dim, dusky, or nocturnal rendering every hex sinks into one warm-brown murk the user cannot sample from, so bright, generous light is a hard rule even when the concept's moment is dark: an "after hours" or "dawn" concept keeps its props and story but is lit like a studio still, not like the hour. Dark palettes are welcome; dark renderings are not; a near-black primary should read as a rich, clearly-lit surface, not as underexposure. Fill every `[bracketed]` slot; never leave template language in the prompt.

```text
One full-bleed photograph, 1500x1500 pixels, framed close: [one scene from
the product's world: subject and what it is doing, setting], the subject
filling most of the frame, not a wide view of the room. The scene contains
[object A], [object B], [object C], and [object D], all plainly
visible. Lighting: bright, clean, and generous, [direction and quality,
e.g. "soft daylight flooding in from a large window on the left"]; the
whole frame clearly lit, no area lost to darkness. Camera: [close framing
and lens, e.g. "85mm still life close-up at waist level, shallow depth of
field"]. Mood: [two or three adjectives from the brief's personality]. The
scene is art-directed as bold color blocking in a strict four-color story,
every color a large unbroken field, none reduced to a sliver: [color name]
([neutral hex]) as the ground, about half the frame; [color name]
([primary hex]) as one continuous mass over roughly a third of the frame,
carried by [the main subject]; [color name] ([secondary hex]) as a clear
supporting field on [a supporting element]; [color name] ([tertiary hex])
as one vivid accent, small but big enough to read at a glance, on
[a specific object]. Every color reads true and fully saturated in the
light, none sunk in shadow. Rich, saturated, editorial color; not a dim,
dusky, nocturnal, or candlelit image. Photorealistic, real texture. No
text, no labels, no numbers, no borders, no watermark.
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

**Pick the generation path first.** The harness's native image-generation tool is the path whenever one exists; the `IMAGE_GEN_API_KEY` wrapper exists only for harnesses that have none. A key in `.impeccable/.env` or a wrapper script left by an earlier run in another harness does not outrank a native tool: check for the native tool first, and touch the wrapper only after confirming there is none.

**Do not smoke-test the path.** Presence is the whole check: a tool the harness lists works, and the wrapper spec in [document.md](document.md) already retries transient failures internally, so a preflight generation buys nothing the first persona's report would not carry, and it costs a generation call and half a minute on every clean run. Instead, fill the brief file's tool slot with the exact call the spawns will make: the tool or wrapper command, the square-size parameter to pass, and where it writes output files (some native tools ignore directory paths and save to a fixed folder of their own; say so in the slot, so no specialist rediscovers it alone).

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
   generate the HERO image, 1500x1500 (or the nearest supported
   square). The image must be square: a "1500x1500" line inside the
   prompt does not pin the canvas, so whenever the tool accepts a size
   or aspect-ratio parameter, pass square (1:1) explicitly; the compile
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

   Open the result and inspect it once. Ownership: the scene is yours,
   staging your palette; a wrong subject or palette means you picked up
   a sibling's file from the race above, so regenerate once with the
   [slug] filename. Light: if the image is dim, dusky, or nocturnal,
   with palette colors sinking into shadow instead of reading bright
   and true, regenerate the HERO once, same prompt, plus this line
   appended: "Render the scene in bright, generous daylight-quality
   studio light; every color fully lit and clearly readable, no
   darkness anywhere in the frame." Never retry more than once per
   check, inside the three-call budget; keep the last result
   regardless.

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

The script copies the hero untouched to `[slug].png`; for each palette role it searches the hero for the closest rendered pixel (`snapped`, with its hero position), then updates `cues.json`:

```json
{
  "cues": ["amber-dusk", "coastal-glass"],
  "palette": {
    "amber-dusk": { "primary": { "hex": "#B8422E", "snapped": "#B4402F", "at": [312, 540] } }
  }
}
```

Done when: `cues.json` lists one entry per completed palette and every listed slug has its hero PNG on disk.

## Step 6: Pause

Tell the user in one or two lines that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then end your turn. The pick round is a separate later step: do not show or describe the images, do not ask which the user prefers, and do not write DESIGN.md in this turn.
