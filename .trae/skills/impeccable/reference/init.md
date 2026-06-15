# Init Flow

Browser-first project setup. This command creates the project context files future Impeccable commands read:

- **`PRODUCT.md`**: product definition, first audience, differentiator, existing material, register, and practical context.
- **`BRAND.md`**: brand trust, audience fit and non-fit, selected visual cue images, route families, prompt history, and guardrails.
- **`DESIGN.md`**: implementation-ready palette, typography, component, motion, and accessibility direction linked back to `BRAND.md`.

Use this flow for new projects and greenfield brand/site work. Do not route this through MCP.

## Step 1: Launch the browser questionnaire

Start the local questionnaire server:

```bash
node .trae/skills/impeccable/scripts/questionnaire/init-questionnaire.mjs --prompt "<user prompt>"
```

Read the printed JSON. Open the returned `url` for the user. Keep the server process running until the flow finishes or the user cancels.

If the browser/server launch clearly fails, fall back to the same questions in chat and say the browser path failed. Do not silently skip init.

## Step 2: Poll browser events

Poll events with:

```bash
node .trae/skills/impeccable/scripts/questionnaire/init-poll.mjs --session-id <sessionId>
```

The server also exposes live-style HTTP routes:

- `GET /events?token=...&sessionId=...` streams browser state updates to the page.
- `GET /poll?token=...&sessionId=...&timeoutMs=...` lets the agent wait for browser events.
- `POST /poll` lets the agent send slide payloads, image batches, typography batches, messages, and completion replies.

Every answer after the first slide must feed back to the chat session. The server stores state, but the agent owns the intelligence.

## Step 3: Author each next slide

The first slide is static:

1. **What are we making?**
   `Name it, describe it, and say who it is for.`

After each answer, generate the next slide as a complete payload before the browser advances. This includes upload, visual cue, palette, and typography slides. Do not patch user words into canned templates, and do not let base schema copy leak through. Include:

- `title`
- `prompt`
- `placeholder` or upload/request copy
- 3-6 multiple-choice options when the slide is not an upload or generated-card slide
- concise option hints when useful

Use this underlying data flow, but rewrite every post-first slide in the user's brand language:

1. `What are we making?`
2. existing assets/material
3. differentiator
4. trust signal
5. first audience
6. anti-audience / anti-goals
7. visual cue selection
8. palette selection
9. typography selection

Use short, easy wording. Avoid startup-workshop language and generic titles like `Who should feel seen?`, `What should people trust?`, `What should it carry visually?`, `Which colors feel true?`, or `Which type feels right?`.

Good examples:

- `What should new puppy owners trust first?`
- `What should Puppy Wear refuse?`
- `What should Puppy Wear carry visually?`
- `Which colors fit soft paw protection?`
- `Which type fits Puppy Wear?`

## Step 4: Handle uploads and recommended defaults

The upload slide stores local assets under `.impeccable/init/uploads/<session-id>/`. Product photos, testimonials, process shots, GIFs, and MP4s are all valid. GIFs are best for quick visual review; MP4 works too.

Choice slides show a recommended option selected by default. If the user presses Continue without editing, treat that recommended option as the answer. There is no visible `Choose for me` control in this flow.

## Step 5: Generate visual cue cards

After the anti-audience answer, send a brand-specific visual cue slide payload before the browser advances. Then keep polling for the image request.

The image request payload includes an `imageProvider` field:

- `provider: "flux"` means `IMAGE_API_KEY` was found and the local server will attempt four parallel FLUX Pro requests automatically. Keep polling until the browser receives `image_batch`, or send a short message if the provider fails.
- `provider: "builtin-quadrant"` means no local image key was found. The browser shows a native alert once: `No IMAGE_API_KEY in .impeccable/.env. Using built-in images; Flux is faster.` Use the request's `builtInQuadrant.prompt` with the chat's built-in image generator, then send the resulting PNG sheet back with `action: "image_sheet"` so the server crops it into four normal cards.

`IMAGE_API_KEY` is the canonical key name. Compatibility aliases are `IMPECCABLE_IMAGE_API_KEY`, `BFL_API_KEY`, and `FLUX_API_KEY`. The runtime checks process env first, then `.impeccable/.env`, then `.impeccable/env`. Never print, persist, screenshot, or echo the raw key.

When FLUX is available, generate exactly four independent 1:1 visual cue images in parallel and send them with `image_batch`. Do not send a contact sheet, collage, montage, sprite sheet, or one image cropped into four cards on the FLUX path.

Use FLUX Pro (`flux-2-pro-preview`) with `quality`-equivalent production prompts and `1024x1024` opaque outputs when the key exists. The BFL API uses `x-key`; never expose it to the browser. Follow OpenAI and BFL prompting guidance: put the most important concept early, use a consistent labeled structure, state intended use, and specify concrete medium, subject, composition, framing, lighting, palette/mood, texture, and constraints. Prefer positive visual direction, then keep the final negative line short. When uploads exist, reference them by index and role.

Each cue image payload must include:

- `id`
- `label`
- `routeFamily`
- `prompt`
- `dataUrl`

Allowed `routeFamily` values:

- `material-object`
- `graphic-shape`
- `gesture-motion`
- `atmosphere-light`
- `playful-character`
- `pattern-ornament`
- `surreal-metaphor`
- `editorial-cultural`

Each batch of four must include at least three different route families unless the user explicitly asks for a narrow direction. A batch should feel like four different art-direction doors, not four variations of the same object.

Prompt structure:

- `Intent`: first-round brand identity cue, not decoration.
- `Brand context`: prior answers plus uploaded product image context.
- `Route family`: one allowed route family.
- `Concept route`: specific motif and strategic reason.
- `Visual language`: medium, form, texture, composition, framing, light, color temperature.
- `Design translation`: how this could become spacing, surface, edge, image, icon, motion, or interaction behavior.
- `Constraints`: no text, lettering, numerals, logos, watermark, UI mockup, website, or fake packaging label.

## Step 6: Generate palette and typography cards

After visual cues are selected, send a brand-specific palette slide payload before the browser advances. Then generate exactly four palette cards from selected cues, prior answers, and uploaded product imagery. Each palette card needs:

- one independent image
- exactly four OKLCH colors
- role-aware color names
- no text inside the image

Palette prompts must inherit selected cue route families. Do not flatten the selected cues back into generic material fragments.

Palette image requests follow the same provider rule as visual cues. If the server has a Flux key, it may generate the four palette images automatically, but the payload still must include exactly four OKLCH colors per card. If no key exists, use the request's 2x2 quadrant prompt and return `image_sheet`; the server crops the sheet and preserves the normal browser `image_batch` shape.

After a palette is selected, send a brand-specific typography slide payload before the browser advances. Then generate exactly four typography cards. Typography cards are not images. Use real loadable fonts and include:

- Google Fonts CSS URL
- heading family, weights, style, fallback
- body family, weights, style, fallback
- brand-specific sample heading/body
- rationale, usage, and optional avoid notes

Use the typography guidance from the skill: avoid reflex fonts, pair on a real contrast axis, and make the font choice feel like the brand as an object.

## Step 7: Complete and report

On completion, the server writes:

- `PRODUCT.md`
- `BRAND.md`
- `DESIGN.md`

If any already exist, it stages:

- `.impeccable/init/PRODUCT.next.md`
- `.impeccable/init/BRAND.next.md`
- `.impeccable/init/DESIGN.next.md`

Never overwrite existing files silently. If files were staged, ask the user whether to merge or replace.

Report the written/staged paths, the selected visual cues, the selected palette, and the selected type direction. Then recommend the next command:

- `/impeccable craft <site or feature>` to build from the new context.
- `/impeccable shape <surface>` to plan a specific surface before code.
- `/impeccable live` once there is a running site to visually iterate in browser.
