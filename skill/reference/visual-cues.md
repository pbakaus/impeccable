# Visual Cues Pipeline

Loaded by `{{command_prefix}}impeccable document` seed mode (Step 4) when image generation is available. Input: the five seed interview answers, the asset observations from seed Step 2, and PRODUCT.md. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

Tell the user once, before generating: *"Generating visual cues; this can take a minute or two."* Then work without narration. Chat carries no per-image commentary, no prompt dumps, no palette tables; the folder is the deliverable.

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

## Step 1: Compose the palettes from the brief

The palette is designed before any image exists; the image stages it. Do **not** generate first and read colors off the result: that yields moody near-monochromes, not a usable system. And do not pull colors from a generator or seed bank: everything a designer would research is already in hand. Work the way designers work, brief first:

1. **Reread the brief.** PRODUCT.md (personality, audience, positioning, what the product sells or shows), the interview answers (Q1 color strategy and hue anchor, Q4 the three named references, Q5 the anti-reference), and the seed Step 2 asset observations. This is the moodboard material.
2. **Write one mood phrase per palette**, specific enough to compose from. Good: "dawn delivery run, cut stems in cold water, the city still gray". Bad: "modern and clean", "warm and inviting"; a phrase that fits any brand composes nothing.
3. **Map the mood to color.** Pick each palette's hue territory from what the mood should make this audience feel and what the named references actually look like: color psychology plus reference study, not a random draw. The Q1 hue anchor leads one or two palettes; the others take territories the brief also supports (an adjacent hue, a complement, a dark register, a warm register). Six palettes on one hue are six versions of one mood; the pick round exists so the user can choose between genuinely different color stories. The anti-reference (Q5) is a hard constraint on all six.

Then compose each palette as four exact hex values with a **60-30-10 balance**. These are website/app colors, headed for tokens, not scene colors:

- **neutral** (~60%, the dominant): the surface, what most of a screen will be. An off-white or near-white with a temperature tint, or a near-black when the mood calls for dark. Never pure `#FFFFFF` or `#000000`.
- **primary** (~30%): the brand color, the mood's main carrier. Must read clearly against the neutral.
- **secondary**: structure and support: an adjacent hue, or the primary shifted in lightness and chroma. Visibly a different swatch, not a darker copy of primary.
- **tertiary** (~10%, the accent): the most saturated of the four and used smallest; distinct in hue from primary so it keeps signal value.

Hard rules:

- **Every color earns its place.** For each role, state in one line what it does and why it fits this product. A color you can't justify in one line gets replaced, not kept because it looks nice. The lines guide your composition; they don't go in chat or `cues.json`.
- **Contrast is non-negotiable.** Primary must read clearly on the neutral; tertiary must pop against both. A palette that fails either is not done.
- Within one palette, any two roles must be nameable apart at a glance. A dark green primary next to a dark green neutral is one color, not two.
- Across the set, every palette takes a **different direction**: a different mood phrase and a different harmony scheme (analogous deepened, complementary accent, dark-dominant, warm neutral with the anchor demoted to accent, near-monochrome with one vivid accent). At most two palettes may share a hue family; if two would look alike as four swatches side by side, replace one.

Done when: 6 (or 4 when serial, Step 5b) palettes exist, each with a mood phrase from the brief, four hexes with roles and reasons, and no two palettes interchangeable.

## Step 2: Draft the concepts

Attach one one-line cue concept to each palette. **Every concept lives in the product's own world.** Reread PRODUCT.md first: what the product is, who it serves, what it sells or shows. The subject of every hero scene comes from that world, named with the product's own nouns. A concept that could belong to any other product is not done; sharpen it until it could only be this brand. Diversity comes from the rest of the matrix:

- Each concept leads with a different anchor from what you already hold: its palette's mood phrase, the color strategy (interview Q1), the type direction (Q2), the three named references (Q4), PRODUCT.md's positioning and personality, the seed Step 2 asset observations.
- Give each concept a distinct **material world**: botanical, ceramic, paper/print, textile, metal, glass, stone, food. The material world is the supporting cast around the product's subject, never a replacement for it. For a florist, ceramic means the vases and the kiln-room shelf behind the arrangement; paper means the wrapping bench; the flowers stay in frame.
- Vary the scene's register too: one concept at work (hands mid-task), one at rest (the finished thing displayed), one in detail (macro), one in place (the room). Six takes on one world beats six unrelated worlds.
- Name the four artifact objects now. Three tests, each against a known failure: chosen **from inside the scene**, so each plausibly sits in the hero composition; **compact**, so it sits centered in a square-ish quadrant (no edge-to-edge ladles or full-width garlands); carrying **no writing** (no tags, labels, packaging, printed cards, or stationery), because a branded tag invites the model to render typography, and text on an artifact ruins it.
- The anti-reference (Q5) is a shared negative constraint on every concept.
- Name each concept with a two-word slug (`amber-dusk`, `coastal-glass`). The slug is the cue id in filenames and `cues.json`.

Done when: every palette has a concept with a slug, a subject from the product's world, a material world no other concept uses, and four named artifacts.

## Step 3: Build the hero prompt

Expand each concept into a self-contained hero prompt using this template. Write it like screenplay direction, not a keyword list: subject doing something, in a place, in a light. Name every palette color twice, as a plain-language color and as its hex, and tie each to a physical carrier in the scene; a hex with no carrier gets ignored. Keep prohibitions to the final guardrail line.

```text
One full-bleed photograph, 1500x1500 pixels: [one atmospheric scene from
the product's world: subject and what it is doing, setting, time of day].
The scene contains [artifact A], [artifact B], [artifact C], and
[artifact D], all plainly visible. Lighting: [direction and quality, e.g.
"low afternoon window light raking in from the left"]. Camera: [framing
and lens, e.g. "85mm still life at waist level, shallow depth of field"].
Mood: [two or three adjectives from PRODUCT.md's personality]. The scene
is art-directed to a strict four-color story, every color plainly visible:
[color name] ([neutral hex]) as the dominant ground and backdrop, about
60% of the frame; [color name] ([primary hex]) carried by [the main
subject]; [color name] ([secondary hex]) on [a supporting element];
[color name] ([tertiary hex]) as one small vivid accent on [a specific
object]. Rich, saturated, editorial color. Photorealistic, real texture.
No text, no labels, no numbers, no borders, no watermark.
```

Fill every `[bracketed]` slot from the concept; never leave template language in the prompt. Done when every concept has a complete hero prompt whose four colors each have a named carrier.

## Step 4: Build the artifact-sheet prompt

The sheet prompt is the same for every concept except the object list. It runs as the **second** generation, with the concept's hero attached as the reference/input image, so the objects match the scene instead of being reinvented. Describe it as plain product photography; any word that implies an editorial layout ("catalog", "sheet", "spread", "grid") invites the model to design a page with titles and captions instead of photographing objects:

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

The cream is constant across all cues (`#FDFCF6`; the artifacts land on this exact surface downstream), so never restyle it per concept. Done when every concept has its sheet prompt with the four artifacts assigned to quadrants.

## Step 5a: Generate in parallel (harness has subagents)

If the harness has any subagent/spawn tool, parallel is **required**: run all 6 concepts as one **wave**, every spawn call emitted in the same tool-call round, one concept per subagent, each with a self-contained task (subagents start without your context). **Never generate the images yourself one at a time when a subagent tool exists**; a serial loop in a subagent-capable harness is a failure, not a fallback. Attach the harness's image-generation skill to each spawn when the harness expects that (Codex: the `imagegen` skill).

Spawn each subagent with this task, filling the slots:

```text
You generate exactly two images in sequence and report. Use the harness's
native image generation tool. Do not fall back to CLIs or APIs; do not edit
repo files.

1. Generate the HERO image, 1500x1500 (or the nearest supported square),
   with this prompt:

[the full Step 3 hero prompt for this concept]

2. Generate the ARTIFACT SHEET, same size, passing the hero image you just
   generated as the reference/input image (the tool's image-edit or
   reference-image mode), with this prompt:

[the full Step 4 sheet prompt for this concept]

3. Look at the sheet you generated. If any object crosses the canvas edge or
   the horizontal or vertical centerline, or any text appears anywhere,
   regenerate the ARTIFACT SHEET once: same reference image, same prompt,
   plus this line appended: "Make every object smaller, at most half of its
   quadrant, pulled in tight to its quadrant's center, with even more empty
   cream between the objects and around the edges." Never retry more than
   once; keep the second sheet regardless.
4. Reply with exactly these three lines and nothing else:

COMPLETED [slug]
HERO [absolute path to the hero PNG]
ARTIFACTS [absolute path to the final sheet PNG]

If either generation fails, reply instead with one line:
ERROR [slug] [short reason]
```

Six concepts fit the observed Codex ceiling of 6 concurrent subagents, so one wave normally covers everything. If a spawn is rejected with a thread-limit error, collect the accepted wave, close those agents to release their slots, then run a second wave for the rejects. If every spawn in the first wave ERRORs because subagents lack the image tool, fall back to Step 5b. Close every agent after collecting its report.

Done when: every concept has either a three-line COMPLETED report or an ERROR line. An ERROR concept is dropped, not retried more than once; five good cues beat a stalled pipeline.

## Step 5b: Generate in series (no subagents)

Only when the harness has no subagent tool at all: generate **4** concepts yourself, one pair at a time (hero, then sheet with the hero as reference), with the same Step 3 and Step 4 prompts. After each pair: apply the same look-and-retry rule as the subagent task, and record the same facts a subagent would report (slug, both paths). Same done-condition as 5a, over 4 concepts.

## Step 6: Crop and compile

For each completed concept, run one command, carrying the slug and that concept's **planned palette from Step 1** (you composed it; no subagent echo needed):

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

Done when: `cues.json` lists one entry per completed concept and every listed slug has its five PNGs on disk (hero plus four artifacts).

## Step 7: Pause

Tell the user in one or two lines that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then end your turn. The pick round is a separate later step: do not show or describe the images, do not ask which the user prefers, and do not write DESIGN.md in this turn.
