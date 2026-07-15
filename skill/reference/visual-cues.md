# Visual Cues Pipeline

Loaded by `{{command_prefix}}impeccable document` seed mode (Step 4) when image generation is available. Input: the five seed interview answers, the asset observations from seed Step 2, and PRODUCT.md. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

Tell the user once, before starting: *"Generating visual cues; this can take a minute or two."* Then work without narration. Chat carries no per-image commentary, no palette tables, no prompt dumps; the folder is the deliverable.

## The two images

Each cue is **two generations by the same agent**, in sequence:

```text
HERO  [slug].png (1500x1500)            ARTIFACT SHEET  masters/[slug]-artifacts.png
+---------------------------+           +-------------+-------------+ 1500x1500
|                           |           |   [obj A]   |   [obj B]   |
|   one full-bleed scene,   |           |  centered,  |  centered,  |
|   the product's world,    |           |  ~2/3 of    |  clear      |
|   all four artifact       |           |  its cell   |  margins    |
|   objects visible in it,  |           +-------------+-------------+ 750
|   four palette colors     |           |   [obj C]   |   [obj D]   |
|   with named carriers     |           |             |             |
|                           |           | flat cream #FDFCF6 across |
+---------------------------+           | the whole canvas, no cell |
     saved as-is, NO crop               | borders, soft shadows OK  |
                                        +-------------+-------------+
                                          quadrant-cropped into
                                          [slug]-2..5.png, NO matting
```

- The **hero** is the visual cue: one atmospheric full-bleed composition that stages the concept's palette and mood; this is what the user will pick between. No grid, no regions: the whole frame is the scene. The four artifact objects all appear inside it.
- The **artifact sheet** is the second generation, with the hero attached as the reference image: the same four objects re-photographed individually, one per quadrant, each isolated and centered on one continuous flat warm-cream background, `#FDFCF6`. The objects inherit the hero's materials and colors; only the setting changes. ("Sheet" is our name for the file; the prompt never uses it.)
- **No transparency, ever.** No alpha channels, no chroma keys, no "transparent background" in any prompt (image models paint a checkerboard instead). Crops keep the cream; soft contact shadows are welcome, they ground the objects.
- **Isolation is a hard rule on the sheet.** Every object centered on its quadrant's center point, filling about two-thirds of it, with clear cream margin on every side: nothing comes near the canvas edge, another object, or the quadrant midlines. The crop cuts exactly at the midlines, so anything crossing one gets clipped.

Example, hero = a flower atelier's worktable: sheet quadrants carry the wrapping ribbon, a single stem, a row of loose petals, and the ceramic vase. All four are visible in the hero scene.

## The studio

Palettes come from **six competing specialists**, not from you. One mind composing six palettes converges on one taste, and six versions of one mood defeat the pick round. Each specialist is a subagent locked to a **persona**: a different method of searching color space (object association, cultural reframing, remote analogy, self-imposed constraint, audience perspective-taking, emotional sequencing). Same brief, same output format, different search method; the separation is what makes the six palettes genuinely different.

The studio runs as **one parallel wave**. You carve six territories from the brief (Step 2), then all six personas spawn at once (Step 3), each composing a palette inside its own territory and staging it in two images. No chained reviews, no revision loops: distinctness is settled upfront by the territory assignments, and speed comes from doing everything in one wave.

Subagents start without your context, so every spawn task is self-contained: it carries the brief packet, the persona, the territory map, and every rule the subagent needs. Paste the shared blocks below into tasks **verbatim**; a summarized rule is a dropped rule.

## Step 1: Assemble the brief packet

Write one self-contained text block that a specialist with zero context can design from. Include, in full:

- **The product**: from PRODUCT.md, what it is, sells, or shows; the audience; the positioning; the personality words.
- **The interview**: Q1 color strategy and hue anchor, Q2 type direction, Q4 the three named references, Q5 the anti-reference. State that the anti-reference is a hard constraint on every palette.
- **The assets**: the seed Step 2 observations (logo colors, recurring materials, photo moods).

Label it `BRIEF PACKET` and reuse the same block verbatim in every spawn of both phases; a packet that drifts between spawns invalidates the comparison. Do **not** add your own palette leanings to it: the personas do the leaning.

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

Paste these into spawn tasks where the templates call for them. They are the single source of the craft rules; never restate them loosely.

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
- Name four artifact objects, each passing three tests: chosen from
  inside the scene, so it plausibly sits in the hero composition;
  compact, so it sits centered in a square-ish quadrant (no edge-to-edge
  ladles or full-width garlands); carrying no writing (no tags, labels,
  packaging, printed cards, or stationery), because text on an artifact
  ruins it.
- Name the concept with a two-word slug (amber-dusk, coastal-glass).
```

### HERO PROMPT skeleton

Written like screenplay direction, not a keyword list: subject doing something, in a place, in a light. Every palette color is named twice, as a plain-language color and as its hex, and tied to a physical carrier in the scene; a hex with no carrier gets ignored. Fill every `[bracketed]` slot; never leave template language in the prompt.

```text
One full-bleed photograph, 1500x1500 pixels: [one atmospheric scene from
the product's world: subject and what it is doing, setting, time of day].
The scene contains [artifact A], [artifact B], [artifact C], and
[artifact D], all plainly visible. Lighting: [direction and quality, e.g.
"low afternoon window light raking in from the left"]. Camera: [framing
and lens, e.g. "85mm still life at waist level, shallow depth of field"].
Mood: [two or three adjectives from the brief's personality]. The scene
is art-directed to a strict four-color story, every color plainly visible:
[color name] ([neutral hex]) as the dominant ground and backdrop, about
60% of the frame; [color name] ([primary hex]) carried by [the main
subject]; [color name] ([secondary hex]) on [a supporting element];
[color name] ([tertiary hex]) as one small vivid accent on [a specific
object]. Rich, saturated, editorial color. Photorealistic, real texture.
No text, no labels, no numbers, no borders, no watermark.
```

### SHEET PROMPT skeleton

Runs as the **second** generation with the hero attached as the reference/input image, so the objects match the scene instead of being reinvented. It describes plain product photography; any word that implies an editorial layout ("catalog", "sheet", "spread", "grid") invites the model to design a page with titles and captions. The cream is constant across all cues (`#FDFCF6`; the artifacts land on this exact surface downstream); never restyle it per concept.

```text
Using the attached photograph as the exact reference for objects, materials,
and colors: one square photograph, 1500x1500 pixels, of four objects from
that scene, each re-photographed individually from directly overhead in soft
even studio light. This is a plain photograph of objects resting on a bare
surface. Absolutely no text anywhere in the image: no letters, no words, no
numbers, no labels, no captions, no title.

The surface is one perfectly flat warm-cream background, hex #FDFCF6,
continuous edge to edge. Picture the canvas divided into four equal
quadrants: [artifact A] top-left, [artifact B] top-right, [artifact C]
bottom-left, [artifact D] bottom-right.

Each object sits exactly centered on its quadrant's center point, filling
about two-thirds of its quadrant, with clear cream margin on every side:
nothing comes anywhere near the canvas edges or the horizontal and vertical
centerlines of the image. A soft gentle contact shadow under each object is
welcome.

No frames, no cell borders, no dividing lines, no watermark, no typography
of any kind; the background stays one uninterrupted #FDFCF6 everywhere.
```

## Step 2: Carve the territories

Split the brief's color space into six **territories**, one per persona: each a one-line claim on a visual, emotional, or strategic ground the palette will own (a hue register, a mood, a positioning angle). Compose them the way the pick round needs them: six genuinely different color stories, each still defensible from the brief. Example set for a florist: "cold dawn blues, the delivery run before the city wakes", "dark lacquer evening register, the atelier after hours", "warm terracotta of the potting bench", "paper-white gallery restraint", "saturated market-stall abundance", "muted dried-botanical earth". The Q1 hue anchor leads one or two territories; the anti-reference (Q5) rules them all.

Assign each territory to the persona whose method suits it best (the Naturalist takes the most material ground, the Dramaturge the most emotional, the Empath the one closest to the audience's state).

Done when: six one-line territories exist, no two claiming the same ground, each assigned to a persona.

## Step 3: The wave (parallel)

If the harness exposes any subagent/spawn tool (Task, spawn_agent, agents, or similar), parallel is **required**, not preferred: emit all six spawns as **one tool-call batch, a single message carrying six spawn calls**, one persona per subagent, each doing the full job (palette, concept, both images), and only then wait for the reports. Spawning one, waiting for its report, then spawning the next is a serial loop and a failure even though every spawn "used a subagent"; so is generating any image yourself while a subagent tool exists. The whole run must take only as long as the slowest single persona. Attach the harness's image-generation skill to each spawn when the harness expects that (Codex: the `imagegen` skill). (No subagent tool at all: Step 4.)

Task template:

```text
You are a color specialist. You compose one brand palette inside an
assigned territory, then stage it in two images. Use the harness's native
image generation tool; do not fall back to CLIs or APIs; do not edit repo
files.

PERSONA: [the persona's full numbered entry from The six personas]

[the BRIEF PACKET, verbatim]

YOUR TERRITORY: [this persona's one-line territory]

The territories assigned to the other five specialists, all off-limits:
[the other five territories, one line each]

Your answer is unsuccessful if it occupies the same visual, emotional, or
strategic territory as another specialist. Stay inside your own.

1. Compose your palette, in your persona's method, inside your territory:

[the PALETTE RULES block, verbatim]

2. Draft the concept for the palette:

[the CONCEPT RULES block, verbatim]

3. Build the hero prompt from this skeleton and generate the HERO image,
   1500x1500 (or the nearest supported square):

[the HERO PROMPT skeleton, with its fill rules]

4. Build the sheet prompt from this skeleton and generate the ARTIFACT
   SHEET, same size, passing the hero you just generated as the
   reference/input image (the tool's image-edit or reference-image mode):

[the SHEET PROMPT skeleton, with its notes]

5. Look at the sheet you generated. If any object crosses the canvas edge
   or the horizontal or vertical centerline, or any text appears anywhere,
   regenerate the ARTIFACT SHEET once: same reference image, same prompt,
   plus this line appended: "Make every object smaller, at most half of
   its quadrant, pulled in tight to its quadrant's center, with even more
   empty cream between the objects and around the edges." Never retry more
   than once; keep the second sheet regardless.

6. Reply with exactly these four lines and nothing else:

COMPLETED [slug]
HERO [absolute path to the hero PNG]
ARTIFACTS [absolute path to the final sheet PNG]
PALETTE primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB

If either generation fails, reply instead with one line:
ERROR [persona number] [short reason]
```

Six spawns fit the observed Codex ceiling of 6 concurrent subagents, so the wave normally runs whole. If a spawn is rejected with a thread-limit error, collect the accepted spawns, close those agents to release their slots, then run a second pass for the rejects. If every spawn ERRORs because subagents lack the image tool, fall back to Step 4's loop using the territories you already carved. Close every agent after collecting its report. If two reports share a slug, rename one before Step 5 (the crop `--slug` flag controls the filenames).

Done when: every persona has either a four-line COMPLETED report or an ERROR line. An ERROR persona is dropped, not retried more than once; five good cues beat a stalled pipeline.

## Step 4: Serial path (no subagents)

Only when the harness has no subagent tool at all: keep the same six territories and play all **six** personas yourself, one at a time and honestly in-method (the Naturalist names physical sources; the Constraint Poet writes its constraints before composing), following the Step 3 task from its step 1 (palette inside the territory, concept, hero, sheet, look-and-retry) and recording the same four facts a subagent would report (slug, both paths, palette). The user still gets six cues; only the clock differs.

Same done-condition as Step 3, over all six personas.

## Step 5: Crop and compile

For each COMPLETED report, run one command, carrying the report's slug and its `PALETTE` line:

```text
node {{scripts_path}}/visual-cues.mjs crop [hero.png] [artifacts.png] \
  --slug [slug] \
  --palette "primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB" \
  --out .impeccable/visual-cues
```

The script copies the hero untouched to `[slug].png`, keeps the sheet under `masters/[slug]-artifacts.png`, and quadrant-crops the sheet into `[slug]-2.png` through `[slug]-5.png` (cream stays; nothing is matted). For each palette role it searches the hero for the closest rendered pixel (`snapped`, with its hero position), then updates `cues.json`:

```json
{
  "cues": ["amber-dusk", "coastal-glass"],
  "supporting-artifacts": {
    "amber-dusk": ["amber-dusk-2", "amber-dusk-3", "amber-dusk-4", "amber-dusk-5"]
  },
  "palette": {
    "amber-dusk": { "primary": { "hex": "#B8422E", "snapped": "#B4402F", "at": [312, 540] } }
  }
}
```

Done when: `cues.json` lists one entry per completed palette and every listed slug has its five PNGs on disk (hero plus four artifacts).

## Step 6: Pause

Tell the user in one or two lines that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then end your turn. The pick round is a separate later step: do not show or describe the images, do not ask which the user prefers, and do not write DESIGN.md in this turn.
