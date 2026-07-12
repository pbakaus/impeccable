# Impeccable Live performance baseline and first optimization

## Goal

Measure the latency Impeccable controls in the Pick → Go → first usable variant loop, keep model time separate, expose the result in the development-only `/live-lab`, and use the evidence to define the optimization phase without regressing output quality or non-Codex harnesses.

## Benchmark contract

`bun run bench:live` reuses the Live runtime E2E fixture system. It stages a real framework project, starts the helper and framework dev servers, opens Chromium, drives the picker, and records monotonic boundaries for:

1. Playwright starts Go → generate POST begins (`browserPreparationMs`, includes automation actionability)
2. browser Go handler → generate fetch begins (`browserDispatchMs`)
3. Playwright actionability before the Go handler (`automationClickMs`)
4. generate POST → agent poll receives the event (`serverPickupMs`)
5. deterministic source scaffold (`scaffoldMs`)
6. agent generation (`generationMs`)
7. source write (`writeMs`)
8. write → first variant in the DOM (`writeToFirstVariantMs`)
9. first variant → all variants/cycling (`deliveryGapMs`)

The deterministic agent measures Impeccable’s fixed floor. An LLM-backed run uses the same orchestration seam, but remains opt-in because it sends staged fixture source to an external provider.

## Baseline and result, July 11 2026

Fixture: `vite8-react-plain`. Browser: local headless Chromium. Three variants. Warm interaction loop.

| Metric | Before, plain | After, plain | Annotated control |
|---|---:|---:|---:|
| Go → first variant | 916 ms | 414 ms | 423 ms |
| Browser preparation, including Playwright | 828 ms | 312 ms | 350 ms |
| Browser handler → generate fetch | — | 2.2 ms | 46.7 ms |
| Playwright actionability | — | 309 ms | 303 ms |
| Server pickup | 0.8 ms | 2.2 ms | 0.8 ms |
| Scaffold | 41 ms | 54 ms | 43 ms |
| Write → first variant | 47 ms | 44 ms | 28 ms |
| First → all variants | 1.3 ms | 1.3 ms | 1.2 ms |

Dispatch-before-capture reduces the median model-free Pick → first-variant loop by **54.8%**, from 916 ms to 414 ms on the same fixture and deterministic agent. The refined in-browser probe shows that Live begins the plain generate fetch in **2.2 ms median**; most of the remaining 414 ms total is Playwright actionability, not product work. The product-side estimate after subtracting that automation delay is about **105 ms**.

The annotated control still blocks on screenshot capture and upload by design. Its browser handler → fetch time is 46.7 ms median, and the E2E event retains comments, strokes, and `screenshotPath`.

## Harness evidence

- The current Codex desktop unified-exec probe did not surface delayed background output automatically. The sentinel appeared only after an explicit session read, and no app terminal was attached.
- Codex custom agents can set their own model and `model_reasoning_effort`, and can be resumed. Fresh subagents carry startup/context cost, so a Live producer needs a warm-vs-cold benchmark. [Official Codex subagent docs](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- Codex app-server exposes streaming command output plus `fs.watch`/`fs.changed` notifications. That proves the primitives exist, not that a watcher can wake a model turn quickly. [Official app-server API](https://learn.chatgpt.com/docs/app-server#api-overview)
- Claude Code subagents support model, effort, background execution, and resume. The docs explicitly warn that latency-sensitive tasks can be faster in the main conversation because a subagent starts with fresh context. [Official Claude Code subagent docs](https://code.claude.com/docs/en/sub-agents)

## Evidence-ranked experiments

### 1. Dispatch first, capture second

**Shipped.** Unannotated picks send `generate` and wait only for the helper to accept it, then continue shader capture off the critical path. Annotated capture remains blocking because the screenshot is semantic model input. This produced the 54.8% median reduction above without changing the agent payload or provider path.

### 2. Progressive variant delivery

Today all variants are written atomically. Add a per-variant ready protocol and reveal the first validated variant while the remaining work continues. Keep a central writer so parallel workers never edit the same file.

### 3. Warm harness-native producer

Ship provider-specific agents from the existing `skill/agents/` source:

- Codex: a narrow custom agent on a faster model/lower effort, resumed across Live events.
- Claude: a narrow background subagent using Haiku or the configured fast model, with the current main-thread flow retained as fallback.

Measure cold spawn, warm resume, prompt prefill, generation, validation failures, and visual-quality acceptance rate. Speed is a regression if users reject more variants.

### 4. Local selection prework

The old prefetch event was disabled because quick Go clicks paid an extra harness round trip. Replace it with debounced local work: resolve the source file, run wrap discovery in dry-run mode, summarize tokens/identity, and load the action reference. Cancel or reuse on Go without queueing another agent event.

### 5. Lazy parameters

Return preview HTML/CSS first. Infer coarse knobs locally or request parameters only for the visible/selected variant. Measure output-token reduction and time-to-first-variant separately from time-to-tunable-variant.

### 6. Structured parallel variant workers

Ask independent workers for one JSON variant each, then validate and write from a single coordinator. Stream the first valid result. Compare total token cost, diversity, failure rate, and first-ready latency against one-agent generation.

### 7. Compile a smaller producer contract

The full Live reference is authoritative but much larger than a single generation event needs. Build a generated provider-specific contract containing the output schema, identity lock, selected action reference, and current framework authoring mode. Keep stable content at the prompt-cache prefix.

### 8. Watch the durable journal

Benchmark an app-server/plugin bridge that watches `.impeccable/live/sessions/` and starts or steers a dedicated Live turn. Compare click → model-start against foreground poll and background terminal watchers. Do not ship it merely because `fs.watch` exists.

### 9. Deterministic scaffolds before the model

For common elements, create structural variant skeletons locally and ask the model only for design decisions and CSS. This reduces output shape failures, but must not force generic layouts or constrain the three directions.

### 10. Adaptive variant count

Return one high-confidence variant first, then let the user request two more, or predict 1/2/3 variants from element weight. Measure accepted-design latency, not only all-variants latency.

### 11. Quality-aware fast path

Run a fast producer first and validate identity, copy preservation, param wiring, and detector findings. Escalate only failed outputs to the main model. This creates a latency/quality cascade rather than a single global model choice.

### 12. Perceived-progress truth

Replace generic generating dots with truthful stage states from the journal: preparing capture, locating source, generating, previewing variant 1, and finishing alternatives. Never display fake percentage progress.

## Completed goal

Reduce the median plain Pick → first usable variant latency by at least 25% on the measured Vite/Chromium protocol baseline and materially reduce model-backed time-to-first-variant, while holding source validity, copy preservation, visual-quality acceptance, and Claude/Codex harness compatibility at or above baseline. Implement the unannotated dispatch-before-capture path first, then progressive delivery or a warm provider-specific producer only when their own benchmarks show a net win.

Result: **54.8% median reduction** on the deterministic protocol benchmark. The next goal should target model-dominated sessions: progressively reveal the first valid variant, then benchmark a warm provider-specific producer only if it beats main-thread generation without reducing visual acceptance.
