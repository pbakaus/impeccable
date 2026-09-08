# Comp model comparison

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
