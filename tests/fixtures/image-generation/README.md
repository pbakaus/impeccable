# Image model comparisons

`comps.json` holds fixed briefs for the new-world decision comp, surface
composition, portrait north-star, and reference-refinement paths. The products
and data are fixture content. Each model receives the same full prompt and
explicit size/quality. The edit uses the **same Image 2 editorial sample** for
every model, so input quality cannot advantage one model's edit.

This suite makes paid API calls and is deliberately outside `bun run test`:

```sh
node tests/image-generation-eval.mjs                   # plan only
node --env-file=.env tests/image-generation-eval.mjs --run
```

Defaults: Image 2, Image 2.5 Flare, Image 2.5 Sunburst; `high` quality;
two samples per case/model; 24 calls total; at most three concurrent requests.
Use `--quality medium`, `--repeats 3`, or `--out tmp/another-comparison` to change
the run. Exact prompts, image hashes, API request IDs, usage and elapsed times
are saved alongside the images. A matching successful result is reused on
rerun; failed requests are retried only by explicitly rerunning the script.
`index.html` is a full-resolution comparison gallery. Outputs are local and
gitignored by default.

The runner uses the same JSON generation and multipart `image[]` edit payloads
as the engine, directly against the Images API so it can capture usage and
latency. It measures the image models, not an LLM agent's ability to write
comp prompts or translate a comp into code. Engine routing and provenance are
separately covered by Rust mock-server tests.

Review every image against the case's four checks: requested structure,
copy/data fidelity, visual identity, and finish/usability (or preservation for
the edit). Record concrete defects rather than equating image similarity or
latency with visual quality. Two samples per cell are exploratory evidence,
not a statistically significant benchmark. Quality levels may consume
different tokens across models, so report usage as well as the quality label.

## Native transparency

`transparency.json` probes botanical cutouts (fine stems and white petals),
glass (continuous translucency and soft shadow), and reference-based plate
extraction (white sails, thin rigging, and three open holes). The plate input
is the opaque cream-ground rendering from `render-transparency-reference.py`; its
geometry is known, so background removal and reference fidelity can be
assessed separately. It requests 1024px output from a 640px reference.

```sh
node tests/image-generation-eval.mjs --suite transparency # 18-call plan
node --env-file=.env tests/image-generation-eval.mjs --suite transparency --run
python3 tests/image-transparency-review.py tmp/image-transparency-2.5
```

This suite explicitly sends `background: transparent` and `output_format:
png` to both Images API endpoints. These match the engine's `--background transparent` payload. This
is a model capability comparison, not a full asset-producer agent test. Defaults remain two samples per case/model, `high`, 1024×1024.

The review helper requires Pillow and makes no network requests. It records
alpha histograms, border alpha, fixed sail/hole probes, and a central glass
body probe, then renders each output over white, dark, and coral backgrounds
alongside its alpha mask. White in the mask means opaque; black means clear.
Inspect composites rather than RGB hidden under zero alpha. Distinguish
near-opaque alpha (250–255) from exactly opaque (255), and broad translucent
areas from ordinary edge antialiasing. Fixed reference probes only establish
the intended semantic behavior when visual inspection confirms alignment.

To reproduce the input and save the known-alpha original:

```sh
python3 tests/fixtures/image-generation/render-transparency-reference.py --transparent-out reference.png
python3 tests/image-transparency-review.py tmp/image-transparency-2.5 --reference-alpha reference.png
```

The generator checks white sails, rigging, and holes before flattening the
reference over `#F3EFE5`. The review helper's `--reference-alpha` measures
silhouette intersection-over-union after resizing the known reference to
the output dimensions. This uses alpha ≥128 without positional alignment:
scale and placement drift reduce the score even if the cutout itself is clean.
Do not chroma-key the API outputs: the experiment measures native alpha.
