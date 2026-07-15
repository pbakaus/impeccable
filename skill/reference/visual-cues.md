# Visual Cues Pipeline

Loaded by `{{command_prefix}}impeccable document` seed mode (Step 4) when image generation is available. Input: the five seed interview answers, the asset observations from seed Step 2, and PRODUCT.md. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

Tell the user once, before starting: *"Generating visual cues; this can take a few minutes."* Then work without narration. Chat carries no per-image commentary, no palette tables, no scorecards, no prompt dumps; the folder is the deliverable.

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

The studio runs three waves:

1. **Compose** (Step 2): each persona designs one palette from the brief and defends every color.
2. **Score** (Step 3): a similarity script flags overlapping palettes, and each persona critiques the other five. Each persona gets a scorecard.
3. **Revise and generate** (Step 4): each persona improves its palette against its scorecard, then builds its prompts and generates its two images.

Subagents start without your context, so every spawn task is self-contained: it carries the brief packet, the persona, and every rule the subagent needs. Paste the shared blocks below into tasks **verbatim**; a summarized rule is a dropped rule.

## Step 1: Assemble the brief packet

Write one self-contained text block that a specialist with zero context can design from. Include, in full:

- **The product**: from PRODUCT.md, what it is, sells, or shows; the audience; the positioning; the personality words.
- **The interview**: Q1 color strategy and hue anchor, Q2 type direction, Q4 the three named references, Q5 the anti-reference. State that the anti-reference is a hard constraint on every palette.
- **The assets**: the seed Step 2 observations (logo colors, recurring materials, photo moods).

Label it `BRIEF PACKET` and reuse the same block verbatim in every spawn of every wave; a packet that drifts between waves invalidates the comparison. Do **not** add your own palette leanings to it: the personas do the leaning.

## The six personas

The number is the persona's **priority** in the similarity check: on a collision, the lower number keeps its territory and the higher number moves.

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
Attach one one-line cue concept to your palette; the hero image stages it.

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

## Step 2: Compose (wave 1)

If the harness has any subagent/spawn tool, parallel is **required**: emit all six spawns in one tool-call batch, one persona per subagent. **Never run the studio's waves yourself one persona at a time when a subagent tool exists**; a serial loop in a subagent-capable harness is a failure, not a fallback. (No subagent tool at all: Step 5.)

Spawn each subagent with this task, filling the slots:

```text
You are a color specialist composing one brand palette. Reply in chat
only; do not edit repo files.

PERSONA: [the persona's full numbered entry from The six personas]

[the BRIEF PACKET, verbatim]

[the PALETTE RULES block, verbatim]

Design ONE palette in your persona's method. Reply with exactly this
format and nothing else:

MOOD [your mood phrase]
primary=#RRGGBB [one-line reason]
secondary=#RRGGBB [one-line reason]
tertiary=#RRGGBB [one-line reason]
neutral=#RRGGBB [one-line reason]
```

Collect all six replies and keep each persona's palette, mood, and reasons; every later wave needs them. Close each agent after collecting.

Done when: six palettes exist, one per persona, each in the reply format.

## Step 3: Score (wave 2)

Each persona gets a **scorecard** with two parts: the script's similarity verdict and the peers' critiques. Scorecards live in your context, not in chat.

**Similarity (scripted).** Run once with all six palettes, numbered by persona:

```text
node {{scripts_path}}/visual-cues.mjs similarity \
  "1:primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB" \
  "2:..." "3:..." "4:..." "5:..." "6:..."
```

The script compares every pair in OKLab and prints `verdicts`: per persona, either empty (clear) or the conflicts it must move away from (a primary sharing a hue family with a lower number's, or most roles near-duplicating a lower number's). Priority is the persona number: the lower number keeps its territory, the higher number revises.

**Peer critique (the wave).** Spawn six subagents in one tool-call batch; each persona reviews the other five. Task template:

```text
You are [persona name], one of six color specialists who each designed a
palette for the same brief. Every specialist is fighting for the palette
that serves this brand best, and so are you. Critique your five rivals:
not taste notes, but brand arguments grounded in the brief (wrong for the
audience, ignores the anti-reference, accent too weak against the neutral,
mood any brand could claim). Reply in chat only; do not edit repo files.

[the BRIEF PACKET, verbatim]

Your own palette (#[N]): [mood + palette + reasons]

The rivals:
[every other persona's number, mood, palette, and reasons]

Reply with exactly five lines, one per rival, and nothing else:
[rival number]: [your sharpest brand-grounded criticism, one sentence]
```

Assemble each persona's scorecard: its similarity verdict lines plus the five critiques it received. Close the critique agents after collecting.

Done when: six scorecards exist, each holding the script verdict and five peer critiques.

## Step 4: Revise and generate (wave 3)

Spawn six subagents in one tool-call batch, one per persona. Attach the harness's image-generation skill to each spawn when the harness expects that (Codex: the `imagegen` skill). Task template:

```text
You are [persona name], a color specialist. You designed a palette; the
studio reviewed it. Improve it, then stage it in two images. Use the
harness's native image generation tool; do not fall back to CLIs or APIs;
do not edit repo files.

PERSONA: [the persona's full numbered entry]

[the BRIEF PACKET, verbatim]

[the PALETTE RULES block, verbatim]

Your first-draft palette: [mood + palette + reasons]

Your scorecard:
[the similarity verdict lines, or "similarity: clear"]
[the five peer critiques]

1. Revise your palette against the scorecard. The similarity verdict is
   binding: if it names a conflict, move to a different hue territory;
   that ground belongs to the lower number. Weigh each peer critique for
   the brand, not for politeness: fix what it genuinely breaks, keep what
   it does not. Stay in your persona's method throughout.

2. Draft your concept for the revised palette:

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

Six spawns fit the observed Codex ceiling of 6 concurrent subagents, so each wave normally runs whole. If a spawn is rejected with a thread-limit error, collect the accepted spawns, close those agents to release their slots, then run a second pass for the rejects. If every spawn in this wave ERRORs because subagents lack the image tool, fall back to Step 5's generation loop using the wave-1 palettes and scorecards you already hold. Close every agent after collecting its report. If two reports share a slug, rename one before Step 6 (the crop `--slug` flag controls the filenames).

Done when: every persona has either a four-line COMPLETED report or an ERROR line. An ERROR persona is dropped, not retried more than once; five good cues beat a stalled pipeline.

## Step 5: Serial path (no subagents)

Only when the harness has no subagent tool at all: run the studio yourself at **4** palettes, playing personas 1-4, one at a time and honestly in-method (the Naturalist names physical sources; the Constraint Poet writes its constraints before composing). Then:

1. Run the similarity script with numbers 1-4. Where a verdict names a conflict, revise the higher-numbered palette into a different hue territory.
2. Skip peer critique: one mind reviewing itself produces agreement, not signal.
3. For each persona in turn, follow the wave-3 task yourself from its step 2 (concept, hero, sheet, look-and-retry) and record the same four facts a subagent would report (slug, both paths, final palette).

Same done-condition as Step 4, over 4 personas.

## Step 6: Crop and compile

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

Done when: `cues.json` lists one entry per completed persona and every listed slug has its five PNGs on disk (hero plus four artifacts).

## Step 7: Pause

Tell the user in one or two lines that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then end your turn. The pick round is a separate later step: do not show or describe the images, do not ask which the user prefers, and do not write DESIGN.md in this turn.
