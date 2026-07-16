# Image API Path (keyless harnesses)

Loaded when a pipeline needs image generation and the harness has **no usable native tool**. It answers, upfront, every question an agent has historically stopped to ask on this path; with a funded key in place, a run through this file asks the user nothing and debugs nothing.

**This file never overrides a working native tool.** A harness with native image generation skips this path entirely; the precedence rule lives where the path is picked ([visual-cues.md](visual-cues.md) Step 3, [document.md](document.md) seed Step 4), not here. One refinement to that rule: a native tool that **cannot generate** (zero credits, failed auth, disabled account) counts as absent. Fall through to this path silently and mention the swap in the final report; do not stop to ask which path to use. A stopped question costs hours when the user is away; the swap costs nothing.

## The setup, already answered

- **Key**: `IMAGE_GEN_API_KEY` in `.impeccable/.env` at the project root. The wrapper reads that file itself; never `source` it, never export the key by hand, never rename the variable. Never delete or truncate that file either, cleanup included: it is the user's stored credential, not run output, and a wiped key turns the next run's silent keyless path into a stalled question.
- **Provider**: `IMAGE_GEN_PROVIDER` in the same file: `bfl` (FLUX / Black Forest Labs) or `gemini` (Google Nano Banana), both built into the wrapper; any other value routes to a custom wrapper (below). Loose spellings from earlier runs (`flux`, `google`, `nano-banana`) normalize to the built-ins, and a missing provider line is inferred from the key's shape (Google keys start with `AIza` or `AQ.`; anything else runs as `bfl`), so a misworded or absent line is never a reason to stop and ask.
- **Wrapper**: `{{scripts_path}}/image-gen.mjs`, shipped with the skill. Do **not** write a new wrapper for a built-in provider, edit this one, or fall back to raw `curl`/`fetch` calls; every known failure mode below is already handled inside it. Wrappers left by earlier runs under other names (`flux-gen.mjs`, project-local copies) are superseded by the shipped one.
- **No smoke test.** A funded key plus the shipped wrapper is a working path; the first real generation is the test, and the wrapper turns transient failures into internal retries rather than failed calls.

## The command

One command regardless of provider; the provider switch happens inside the wrapper, so calling pipelines never branch on it:

```text
node {{scripts_path}}/image-gen.mjs --prompt "..." --out /abs/path.png \
  [--ref /abs/reference.png] [--width 1408] [--height 1408]
```

Run it from the project root (that is where it finds `.impeccable/.env`). It prints the absolute output path on success and exits non-zero with the error on stderr. `--ref` switches text-to-image to image-to-image where the provider supports it.

## Provider facts, so no one re-derives them

**bfl** (FLUX):

- **Models**: `flux-pro-1.1` text-to-image; with `--ref`, `flux-kontext-max` image-to-image (reference sent as base64, aspect ratio pinned 1:1).
- **Size**: BFL accepts 256-1440 px in multiples of 32. The default `1408x1408` is the largest clean square; passing `--width 1500` fails validation locally, before any credit is spent. Output is always square unless you pass unequal values.
- **Concurrency**: BFL allows 24 active tasks (`flux-kontext-max`: 6). A six-spawn wave fits both caps; do not throttle it.
- **Protocol**: submit returns a `polling_url`; the wrapper polls exactly that URL (the global endpoint requires it) and downloads the signed result URL immediately, inside its 10-minute expiry. None of this is the caller's concern.

**gemini** (Nano Banana):

- **Model**: `gemini-3.1-flash-image` by default; a `IMAGE_GEN_MODEL` line in `.impeccable/.env` overrides it, and the wrapper retries the `-preview` sibling once when Google's model naming drifts.
- **Size**: the wrapper pins aspect ratio 1:1, so output is always square; Gemini picks the pixel size for its tier (1024 by default) and ignores `--width`/`--height`. A 1024 square passes the pipelines' square gate as a "nearest supported square"; do not upscale it.
- **Format**: Gemini frequently returns JPEG bytes regardless of the `--out` filename; the wrapper converts them, so the written file is always a real PNG. Do not re-check or re-convert it.
- **Protocol**: synchronous; one call returns the image inline, no polling. Moderation arrives as an imageless response, which the wrapper turns into a clear error, not as an HTTP failure.
- **Text rendering**: Gemini paints text well and eagerly, so a prompt that mentions codes, numbers, or labels tends to get them rendered onto the image (hex codes come back as a printed swatch strip). The calling pipeline's prompt rules ([visual-cues.md](visual-cues.md)'s HERO PROMPT skeleton) keep those out of prompts; follow them, not looser habits from other models.

**Any other provider**: the user names it, so the integration cannot be pre-shipped. Write `.impeccable/image-gen.mjs` implementing the same CLI (same flags, print the absolute output path on success, non-zero exit with the error on stderr, transient retries handled inside), set `IMAGE_GEN_PROVIDER` to the provider's name, and the shipped wrapper delegates to it automatically; calling pipelines keep using the shipped command unchanged. Build it from the provider's API docs, and give it square output; do **not** modify the shipped wrapper to add the provider inline.

## Failures and what they mean

The wrapper retries transient failures internally (DNS, network blips, 429 back-pressure, poll hiccups, expired-download re-fetches), so an error that reaches the caller is real and carries its own explanation:

- **"out of credits"** (bfl, HTTP 402): a human must top up at dashboard.bfl.ai. Report it and stop this path; retrying is pointless, and so is asking the user to choose an alternative that does not exist.
- **"quota or rate limit exhausted"** (gemini, HTTP 429 after the wrapper's own retries): the key's plan is out of headroom. Report it and stop this path; the fix is billing, not retries.
- **"rejected the key"** (either provider): the key in `.impeccable/.env` is wrong or revoked. Report it; do not mint debugging sessions around a dead key.
- **Moderation** ("Content Moderated" / "Request Moderated" / "Prompt was moderated"): the prompt tripped the provider's filter; rewording the prompt is the fix, within the caller's normal generation budget.
- **"cannot resolve"**: the wrapper already tried the system resolver, `dig`, Google, and Cloudflare. **Never debug DNS beyond this**: no `/etc/hosts` edits, no new resolvers, no rewriting the wrapper to use `fetch()` (sandboxed harnesses block the default resolver for these hosts; the wrapper pins IPs via `curl --resolve` for exactly that reason). Report the failure and let the parent decide.

Subagents on this path inherit the generation-failure budget from their own pipeline ([visual-cues.md](visual-cues.md)'s three-call budget, or the calling pipeline's equivalent); the wrapper's internal retries do not count against it, only whole failed invocations do.
