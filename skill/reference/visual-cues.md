# Visual Cues Pipeline

Loaded by `{{command_prefix}}impeccable document` seed mode (Step 4) when image generation is available. Input: the five seed interview answers, the asset observations from seed Step 2, and PRODUCT.md. Output: cue images plus `cues.json` under `.impeccable/visual-cues/`, ready for the user to pick from by eye in a later round.

Tell the user once, before starting: *"Generating visual cues; this can take a minute or two."* Then work without narration. Chat carries no per-image commentary, no palette tables, no prompt dumps; the folder is the deliverable.

## The images

Each cue is **two generations by the same agent**, in sequence: the hero, then the artifact sheet on a chroma-key background the specialist chooses.

```text
HERO  [slug].png (1500x1500)            ARTIFACT SHEET  masters/[slug]-artifacts.png
+---------------------------+           +-------------+-------------+ 1500x1500
|                           |           |   [obj A]   |   [obj B]   |
|   one close-framed scene, |           |  centered,  |  centered,  |
|   the product's world,    |           |  filling    |  thin       |
|   all four artifact       |           |  its cell   |  margins    |
|   objects visible in it,  |           +-------------+-------------+
|   four palette colors     |           |   [obj C]   |   [obj D]   |
|   as large color fields   |           |             |             |
|                           |           | one flat chroma-key color |
+---------------------------+           | everywhere, no shadows,   |
     saved as-is, NO crop               | crisp edges, no bounce    |
                                        +-------------+-------------+
                                          quadrant-cropped into
                                          [slug]-2..5.png, key kept;
                                          the browser keys it out
```

- The **hero** is the visual cue: one tightly framed full-bleed composition that stages the concept's palette in large color fields; this is what the user will pick between, so every palette color gets real estate. No grid, no regions: the whole frame is the scene. The four artifact objects all appear inside it.
- The **artifact sheet** is the second generation, with the hero attached as the reference image: the same four objects re-photographed individually, one per quadrant, on one continuous flat field of the cue's **chroma key**. The objects inherit the hero's materials and colors; only the setting changes. ("Sheet" is our name for the file; the prompt never uses it.)
- **The key is chosen per cue, and it ships.** Each specialist picks its key from the candidate set in the task, whichever sits farthest in hue from its palette and its artifact materials, and reports the hex. Crops keep the key; `cues.json` records it; the browser canvas keys it out downstream. No matting, no alpha work, no background removal anywhere in this pipeline.
- **Edges decide whether keying works.** Shadows, blurred silhouettes, and bounce light each blend key into object and leave an edge fringe no threshold removes cleanly; the SHEET PROMPT skeleton carries the counter-rules and the task's keying-plate check enforces them.
- **Isolation is a hard rule on the sheet.** Every object centered on its quadrant's center point, filling nearly the whole quadrant, with a thin clear margin on every side: nothing touches the canvas edge, another object, or the quadrant midlines. The crop cuts exactly at the midlines, so anything crossing one gets clipped.

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

Label it `BRIEF PACKET` and reuse the same block verbatim in every spawn; a packet that drifts between spawns invalidates the comparison. Do **not** add your own palette leanings to it: the personas do the leaning.

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

Written like screenplay direction, not a keyword list: subject doing something, in a place, in a light. Every palette color is named twice, as a plain-language color and as its hex, and tied to a physical carrier in the scene; a hex with no carrier gets ignored, and a carrier too small reads as noise. The cue's job is to show the palette, so the colors get **real estate**: frame tight on the subject rather than wide on the room, and stage each color as a large unbroken field. A wide atmospheric shot renders the palette as slivers the user cannot judge.

Light the scene to reveal color, not to set a mood. In a dim, dusky, or nocturnal rendering every hex sinks into one warm-brown murk the user cannot sample from, so bright, generous light is a hard rule even when the concept's moment is dark: an "after hours" or "dawn" concept keeps its props and story but is lit like a studio still, not like the hour. Dark palettes are welcome; dark renderings are not; a near-black primary should read as a rich, clearly-lit surface, not as underexposure. Fill every `[bracketed]` slot; never leave template language in the prompt.

```text
One full-bleed photograph, 1500x1500 pixels, framed close: [one scene from
the product's world: subject and what it is doing, setting], the subject
filling most of the frame, not a wide view of the room. The scene contains
[artifact A], [artifact B], [artifact C], and [artifact D], all plainly
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

### SHEET PROMPT skeleton

Runs as the **second** generation with the hero attached as the reference/input image, so the objects match the scene instead of being reinvented. It describes plain product photography; any word that implies an editorial layout ("catalog", "sheet", "spread", "grid") invites the model to design a page with titles and captions.

**Choose the chroma key first.** Candidates: chroma green `#00FF00`, chroma magenta `#FF00FF`, chroma cyan `#00FFFF`, chroma blue `#0000FF`. Pick the one farthest in hue from every palette color and every artifact material (a florist's green stems rule out green; a magenta-flowered concept rules out magenta), and fill it into every `[key color name]` and `[key hex]` slot. The key ships in the crops and gets keyed out later, so the prompt's one job beyond the objects is a keyable backdrop: one pure, flat field of the key, crisp silhouettes, and no shadow, blur, or bounce light at the edges, because each of those blends key into object and leaves a fringe no threshold removes.

```text
Using the attached photograph as the exact reference for objects, materials,
and colors: one square photograph, 1500x1500 pixels, of four objects from
that scene, each re-photographed individually from directly overhead in
flat, even, shadowless studio light. This is a plain photograph of objects
laid on a professional chroma-key backdrop. Absolutely no text anywhere in
the image: no letters, no words, no numbers, no labels, no captions.

The backdrop is one perfectly flat, uniform [key color name] field, hex
[key hex], the identical pure color from edge to edge, like a keying
screen in a studio. The objects cast no shadow onto it and pick up none
of its color; every silhouette is crisp and in sharp focus against the
flat [key color name], and the [key color name] appears nowhere on the
objects themselves.

Picture the canvas divided into four equal quadrants: [artifact A]
top-left, [artifact B] top-right, [artifact C] bottom-left, [artifact D]
bottom-right. Each object sits exactly centered on its quadrant's center
point and fills its quadrant almost completely, as large as it can be
while a thin clear band of backdrop stays visible on every side: nothing
touches the canvas edges or the horizontal and vertical centerlines of
the image.

No frames, no cell borders, no dividing lines, no watermark, no shadows,
no reflections, no gradients; the backdrop stays one uninterrupted
[key hex] everywhere.
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

If the harness exposes any subagent/spawn tool (Task, spawn_agent, agents, or similar), parallel is **required**, not preferred: emit all six spawns as **one tool-call batch, a single message carrying six spawn calls**, one persona per subagent, each doing the full job (palette, concept, both images), and only then wait for the reports. Spawning one, waiting for its report, then spawning the next is a serial loop and a failure even though every spawn "used a subagent"; so is generating any image yourself while a subagent tool exists. The whole run must take only as long as the slowest single persona. Attach the harness's image-generation skill to each spawn when the harness expects that (Codex: the `imagegen` skill). (No subagent tool at all: Step 4.)

Every spawn gets the same full template text, slots filled, shared blocks pasted verbatim. Writing spawn 1 in full and compressing spawns 2-6 down to summaries drops the rules exactly where the convergence risk is highest.

Task template:

```text
You are a color specialist. You compose one brand palette inside an
assigned territory, then stage it in images. Use the harness's native
image generation tool; do not fall back to CLIs or APIs; do not edit repo
files.

PERSONA: [the persona's full numbered entry from The six personas]

[the BRIEF PACKET, verbatim]

YOUR TERRITORY: [this persona's one-line territory]

The territories assigned to the other five specialists, all off-limits:
[the other five territories, one line each]

The brief's hue anchor ([the Q1 anchor]) belongs to [its owner territory];
[if this persona owns it: "that is yours to carry" / otherwise: "your
primary must live in a different hue family"].

Your answer is unsuccessful if it occupies the same visual, emotional, or
strategic territory as another specialist, or if your primary lands in a
hue family another territory claims. Stay inside your own.

1. Compose your palette, in your persona's method, inside your territory:

[the PALETTE RULES block, verbatim]

2. Draft the concept for the palette:

[the CONCEPT RULES block, verbatim]

3. Critique your own work before touching any image. Check the palette
   against every PALETTE RULES line, against your territory's hue ground,
   and against the off-limits list; check the concept against every
   CONCEPT RULES line. Name each failure and fix it. A primary that
   drifted into another territory's hue family, or into an anchor you do
   not own, is a failure to fix now, not one to ship.

4. Build the hero prompt from this skeleton and generate the HERO image,
   1500x1500 (or the nearest supported square). Every image you generate
   must be square: a "1500x1500" line inside the prompt does not pin the
   canvas, so whenever the tool accepts a size or aspect-ratio parameter,
   pass square (1:1) explicitly, on this and every later generation. Five
   sibling specialists share the generation tool's output folder, so a
   default output name is a race that hands you a sibling's image: if the
   tool accepts an output filename, pass [slug]-hero.png, and work only
   with the exact file path the tool reports back for YOUR generation:

[the HERO PROMPT skeleton, with its fill rules]

   Open the result before moving on and check its light: if the image is
   dim, dusky, or nocturnal, with palette colors sinking into shadow
   instead of reading bright and true, regenerate the HERO once, same
   prompt, plus this line appended: "Render the scene in bright, generous
   daylight-quality studio light; every color fully lit and clearly
   readable, no darkness anywhere in the frame." Keep the second result
   regardless; the sheet in step 5 must reference whichever hero you
   keep.

5. Choose your chroma key by the skeleton's rule, then build the sheet
   prompt and generate the ARTIFACT SHEET, square again, output filename
   [slug]-artifacts.png, passing the hero file path the tool reported in
   step 4 as the reference/input image (the tool's image-edit or
   reference-image mode). Never point the reference at a generic hero.png
   in a shared folder:

[the SHEET PROMPT skeleton, with its notes]

6. Open both files you are about to ship and check them. First the
   canvas: each must be exactly square; the compile step rejects
   non-square images, so a landscape or portrait result is a failed
   generation, and the fix is regenerating with the tool's square (1:1)
   size/aspect parameter actually set, not editing the file. Then confirm
   they are yours: the hero shows your scene staging your palette, the
   sheet shows your four artifacts on your chroma key. A wrong subject or
   palette means you picked up a sibling's file from the race in step 4:
   regenerate that image once with the [slug] filename. Then check the
   sheet as a keying plate: the backdrop one flat field of your key, the
   silhouettes crisp, the objects free of shadows, blur, and key-colored
   bounce at their edges, and the key color absent from the objects
   themselves. If the backdrop fails any of that, regenerate the ARTIFACT
   SHEET once: same reference image, same prompt, plus this line
   appended: "The backdrop must be one perfectly uniform [key hex] with
   zero shadows and zero color bounce; every object edge razor-sharp
   against it." Finally check the geometry: if any object crosses the
   canvas edge or the horizontal or vertical centerline, or any text
   appears anywhere, regenerate the ARTIFACT SHEET once: same reference
   image, same prompt, plus this line appended: "Make every object
   smaller, at most two-thirds of its quadrant, pulled in tight to its
   quadrant's center, with a wider band of clear backdrop between the
   objects and around the edges." Never retry more than once per check;
   keep the second result regardless.

7. Reply with exactly these five lines and nothing else, the paths being
   the files you verified in step 6 and the key being the hex you filled
   into the sheet prompt:

COMPLETED [slug]
HERO [absolute path to the hero PNG]
ARTIFACTS [absolute path to the final sheet PNG]
CHROMA #RRGGBB
PALETTE primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB

If either generation fails, reply instead with one line:
ERROR [persona number] [short reason]
```

Six spawns fit the observed Codex ceiling of 6 concurrent subagents, so the wave normally runs whole. If a spawn is rejected with a thread-limit error, collect the accepted spawns, close those agents to release their slots, then run a second pass for the rejects. If every spawn ERRORs because subagents lack the image tool, fall back to Step 4's loop using the territories you already carved. Close every agent after collecting its report. If two reports share a slug, rename one before Step 5 (the crop `--slug` flag controls the filenames).

Done when: every persona has either a five-line COMPLETED report or an ERROR line. An ERROR persona is dropped, not retried more than once; five good cues beat a stalled pipeline.

## Step 4: Serial path (no subagents)

Only when the harness has no subagent tool at all: keep the same six territories and play all **six** personas yourself, one at a time and honestly in-method (the Naturalist names physical sources; the Constraint Poet writes its constraints before composing), following the Step 3 task from its step 1 (palette inside the territory, concept, hero, sheet, look-and-retry) and recording the same facts a subagent would report (slug, both paths, chroma key, palette). The user still gets six cues; only the clock differs.

Same done-condition as Step 3, over all six personas.

## Step 5: Crop and compile

Before anything else, two gates on the reported files:

- **Unique**: hash every reported hero (`md5 [paths]`); each must be unique. Two identical heroes mean two subagents raced on a shared default output filename; re-spawn one of the pair (same task) and take its fresh files before compiling.
- **Square**: check every reported image's dimensions (`sips -g pixelWidth -g pixelHeight [paths]` on macOS); width must equal height. The crop script rejects non-square inputs, and squaring after the fact is off the table (cropping eats scene, padding invents background), so a non-square hero or sheet is a failed generation: re-spawn that persona once, with its same task, and take the fresh files. Still non-square after the re-spawn: drop the cue.

For each COMPLETED report, run one command, carrying the report's slug and its `CHROMA` and `PALETTE` lines:

```text
node {{scripts_path}}/visual-cues.mjs crop [hero.png] [artifacts.png] \
  --slug [slug] \
  --chroma "#RRGGBB" \
  --palette "primary=#RRGGBB;secondary=#RRGGBB;tertiary=#RRGGBB;neutral=#RRGGBB" \
  --out .impeccable/visual-cues
```

The script copies the hero untouched to `[slug].png`, keeps the sheet under `masters/[slug]-artifacts.png`, and quadrant-crops it into `[slug]-2.png` through `[slug]-5.png`. The crops keep the key background: keying happens later in the browser canvas, which reads each cue's key from `cues.json`, so `--chroma` must carry the report's exact hex. For each palette role the script searches the hero for the closest rendered pixel (`snapped`, with its hero position), then updates `cues.json`:

```json
{
  "cues": ["amber-dusk", "coastal-glass"],
  "supporting-artifacts": {
    "amber-dusk": ["amber-dusk-2", "amber-dusk-3", "amber-dusk-4", "amber-dusk-5"]
  },
  "chroma": {
    "amber-dusk": "#FF00FF"
  },
  "palette": {
    "amber-dusk": { "primary": { "hex": "#B8422E", "snapped": "#B4402F", "at": [312, 540] } }
  }
}
```

Done when: `cues.json` lists one entry per completed palette, every listed slug has its five PNGs on disk (hero plus four artifacts), and every slug has its chroma key recorded.

## Step 6: Pause

Tell the user in one or two lines that the visual cues are ready at `.impeccable/visual-cues/` (name the count), then end your turn. The pick round is a separate later step: do not show or describe the images, do not ask which the user prefers, and do not write DESIGN.md in this turn.
