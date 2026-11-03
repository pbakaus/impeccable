/**
 * Skill-activation eval: does the frontmatter `description` in
 * skill/SKILL.src.md make a model load the skill when it should, and only then?
 *
 * Harnesses put every installed skill's name and description into every
 * session; the model decides from that line alone whether to load the skill.
 * This eval simulates that decision. The system prompt lists twelve skills
 * (impeccable plus the eleven neighbours in activation-cases.mjs), the user
 * message is one request, and the model has the Skill tool plus Read, Edit,
 * Write and Bash. An activation is a `Skill` call naming `impeccable`.
 * Starting the work directly or routing to another skill is a miss; that is
 * what the misses in issue #744 looked like (Read, then Edit, no Skill call).
 *
 * It reports recall on the positive cases, the false-positive rate on the
 * negatives, per-category misses and per-case counts. Under `node --test` (the
 * `bun run test:skill-activation` suite) it also asserts a floor: zero false
 * positives, and recall at or above the per-model floors in GATES below, which
 * sit well under the measured baseline in tests/skill-behavior/README.md.
 *
 * Run:
 *   bun run test:skill-activation                       # gate on the current description
 *   node tests/skill-behavior/activation.eval.mjs       # same eval, report only
 *
 * Knobs (environment):
 *   ACTIVATION_MODELS=claude-sonnet-5,gemini-3.7-flash  model lineup (default shown)
 *   ACTIVATION_VARIANTS=current,previous                descriptions to compare (see VARIANTS)
 *   ACTIVATION_DESCRIPTION_FILE=path.txt                add a draft description as variant "file"
 *   ACTIVATION_SAMPLES=2                                samples per case (default 2)
 *   ACTIVATION_STEPS=1                                  >1 lets Read/Bash return stubs so the
 *                                                       model can explore before deciding
 *   ACTIVATION_ONLY=id,id                               restrict to some case ids
 *   ACTIVATION_CONCURRENCY=8
 *   ACTIVATION_OUT=path.json                            write raw results
 *   ACTIVATION_REPORT=path.json                         re-print a report from saved results
 *
 * Cost: the default run is 54 cases x 2 samples x 2 models = 216 single-step
 * calls, about 2k input tokens each: roughly $1 on Sonnet and cents on Gemini.
 * Each extra variant adds the same again. ACTIVATION_STEPS=4 roughly doubles
 * the Sonnet cost even with prompt caching. Keys come from the repo-root .env;
 * a model whose key is unset is skipped.
 */
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProvider, getModel, hasKey, PROVIDERS } from './providers.mjs';
import { CASES, COMPETITORS } from './activation-cases.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Description variants
// ---------------------------------------------------------------------------

export function currentDescription() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'skill', 'SKILL.src.md'), 'utf8');
  const m = src.match(/^description:\s*"(.*)"\s*$/m);
  if (!m) throw new Error('could not read description from skill/SKILL.src.md');
  return m[1];
}

export const VARIANTS = {
  current: currentDescription(),
  // The 118-word description shipped through v4.5 (issue #375 baseline).
  previous: 'Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.',
  // The ~50-word rewrite measured for #375. Kept as the cautionary short form:
  // it gained the document and native cases but lost core UI asks.
  short: 'Design, redesign, critique, audit, or polish frontend UI: websites, landing pages, dashboards, app screens, components, and native iOS or Android views. Covers layout, typography, color, motion, UX copy, accessibility, responsive behavior, onboarding, empty states, and documenting design systems (DESIGN.md, tokens). Use when visual or UX quality matters. Not for backend or non-UI work.',
};
if (process.env.ACTIVATION_DESCRIPTION_FILE) {
  VARIANTS.file = fs.readFileSync(process.env.ACTIVATION_DESCRIPTION_FILE, 'utf8').trim();
}

// Floors for the node --test gate, per model family. The baseline (README)
// measured 55% (Sonnet) and 89% (Gemini) recall for the shipped description
// at n=3; the floors leave room for sampling noise at n=2.
const GATES = {
  anthropic: { recall: 0.4, documentRecall: 0.5 },
  google: { recall: 0.75, documentRecall: 0.5 },
  default: { recall: 0.4, documentRecall: 0.5 },
};

// ---------------------------------------------------------------------------
// Simulated harness
// ---------------------------------------------------------------------------

export function systemPrompt(impeccableDescription) {
  const skills = [...COMPETITORS.slice(0, 5), ['impeccable', impeccableDescription], ...COMPETITORS.slice(5)];
  const listing = skills.map(([n, d]) => `- ${n}: ${d}`).join('\n');
  return [
    'You are a coding agent working in the user\'s repository at /work (a React + Vite web app with src/, a package.json and an api/ folder, unless the request says otherwise).',
    'Use the tools available to you to complete the user\'s request.',
    '',
    'Skills are packaged instructions for particular kinds of task. When a task matches one of the skills listed below, call the Skill tool to load it BEFORE doing anything else; its instructions replace your default approach. If no skill fits, just start the work with your other tools.',
    '',
    'The following skills are available for use with the Skill tool:',
    '',
    listing,
  ].join('\n');
}

const STUB = {
  Read: ({ file_path }) => `// ${file_path}\nexport default function Page() {\n  return (<main className="page">\n    <h1>Title</h1>\n    <p>Body copy.</p>\n    <button className="btn">Continue</button>\n  </main>);\n}\n`,
  Bash: () => 'README.md\napi/\npackage.json\nsrc/\n  components/\n  routes/\n  lib/\n  styles/\n  tokens.css\nvite.config.ts',
};

// No `execute` on any tool by default, so generateText stops after the first
// step and the model's first decision is what gets scored.
const BASE_TOOLS = {
  Skill: tool({
    description: 'Load a skill by name. Use when the request matches one of the listed skills.',
    inputSchema: z.object({ skill: z.string().describe('Exact skill name from the listing'), args: z.string().optional() }),
  }),
  Read: tool({ description: 'Read a file from the repository.', inputSchema: z.object({ file_path: z.string() }) }),
  Edit: tool({ description: 'Replace a string in a file.', inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }) }),
  Write: tool({ description: 'Write a file.', inputSchema: z.object({ file_path: z.string(), content: z.string() }) }),
  Bash: tool({ description: 'Run a shell command.', inputSchema: z.object({ command: z.string() }) }),
};

function toolsFor(steps) {
  if (steps <= 1) return BASE_TOOLS;
  return {
    ...BASE_TOOLS,
    Read: tool({ ...BASE_TOOLS.Read, execute: async (i) => STUB.Read(i) }),
    Bash: tool({ ...BASE_TOOLS.Bash, execute: async (i) => STUB.Bash(i) }),
  };
}

async function runOne(modelId, description, prompt, steps) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await generateText({
        model: getModel(modelId),
        instructions: { role: 'system', content: systemPrompt(description), providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
        prompt,
        tools: toolsFor(steps),
        stopWhen: stepCountIs(steps),
        maxOutputTokens: 2048,
      });
      const calls = result.steps.flatMap((st) => st.toolCalls ?? []);
      // A response can load several skills (frontend-dev, then impeccable).
      // Any impeccable load counts; otherwise report the first skill named.
      const loaded = calls
        .filter((t) => t.toolName === 'Skill')
        .map((t) => String(t.input?.skill ?? '').replace(/^\//, ''));
      return {
        skill: loaded.includes('impeccable') ? 'impeccable' : (loaded[0] ?? null),
        skillsLoaded: loaded,
        firstTool: calls[0]?.toolName ?? 'text',
        steps: result.steps.length,
        usage: result.totalUsage ?? result.usage,
      };
    } catch (err) {
      if (attempt === 3) return { error: String(err?.message ?? err) };
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

async function pool(jobs, n, fn) {
  let i = 0;
  const out = new Array(jobs.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const k = i++;
      out[k] = await fn(jobs[k]);
    }
  }));
  return out;
}

export function resolveOptions(env = process.env) {
  const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
  const only = env.ACTIVATION_ONLY ? new Set(list(env.ACTIVATION_ONLY)) : null;
  return {
    models: list(env.ACTIVATION_MODELS, 'claude-sonnet-5,gemini-3.7-flash'),
    variants: list(env.ACTIVATION_VARIANTS, 'current'),
    samples: Number(env.ACTIVATION_SAMPLES || 2),
    steps: Number(env.ACTIVATION_STEPS || 1),
    concurrency: Number(env.ACTIVATION_CONCURRENCY || 8),
    cases: only ? CASES.filter((c) => only.has(c.id)) : CASES,
  };
}

export async function runEval({ models, variants, samples, steps, concurrency, cases }) {
  for (const v of variants) if (!VARIANTS[v]) throw new Error(`unknown variant "${v}" (have: ${Object.keys(VARIANTS).join(', ')})`);
  const jobs = [];
  for (const m of models) for (const v of variants) for (const c of cases) for (let s = 0; s < samples; s++) jobs.push({ m, v, c, s });
  return pool(jobs, concurrency, async (j) => ({
    model: j.m, variant: j.v, id: j.c.id, cat: j.c.cat, expect: j.c.expect, sample: j.s,
    ...(await runOne(j.m, VARIANTS[j.v], j.c.prompt, steps)),
  }));
}

// ---------------------------------------------------------------------------
// Scoring and report
// ---------------------------------------------------------------------------

const fired = (r) => r.skill === 'impeccable';

export function score(results, model, variant) {
  const rs = results.filter((r) => !r.error && r.model === model && r.variant === variant);
  const pos = rs.filter((r) => r.expect);
  const neg = rs.filter((r) => !r.expect);
  const doc = pos.filter((r) => r.cat === 'document');
  return {
    tp: pos.filter(fired).length, positives: pos.length,
    fp: neg.filter(fired).length, negatives: neg.length,
    docTp: doc.filter(fired).length, documents: doc.length,
    otherSkill: pos.filter((r) => r.skill && r.skill !== 'impeccable').length,
    errors: results.filter((r) => r.error && r.model === model && r.variant === variant).length,
  };
}

function pct(a, b) { return b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a'; }

export function report(results, log = console.log) {
  const models = [...new Set(results.map((r) => r.model))];
  const variants = [...new Set(results.map((r) => r.variant))];
  const ids = new Set(results.map((r) => r.id));
  const cases = CASES.filter((c) => ids.has(c.id));
  const ok = results.filter((r) => !r.error);

  log('Descriptions:');
  for (const v of variants) log(`  ${v}: ${VARIANTS[v] ? VARIANTS[v].split(/\s+/).length : '?'} words`);

  log('\nRecall on positives / false positives on negatives:');
  for (const m of models) for (const v of variants) {
    const s = score(results, m, v);
    log(`  ${m.padEnd(18)} ${v.padEnd(9)} recall ${s.tp}/${s.positives} (${pct(s.tp, s.positives)})  document ${s.docTp}/${s.documents}  FP ${s.fp}/${s.negatives}  routed elsewhere ${s.otherSkill}${s.errors ? `  errors ${s.errors}` : ''}`);
  }

  log('\nPer-case activations (fired/samples):');
  const cols = models.flatMap((m) => variants.map((v) => ({ m, v, label: `${m.split('-')[0]}:${v}` })));
  log(`  ${'case'.padEnd(26)} ${cols.map((c) => c.label.padStart(16)).join(' ')}`);
  for (const c of cases) {
    const cells = cols.map(({ m, v }) => {
      const rs = ok.filter((r) => r.model === m && r.variant === v && r.id === c.id);
      return `${rs.filter(fired).length}/${rs.length}`.padStart(16);
    });
    log(`  ${((c.expect ? '+ ' : '- ') + c.id).padEnd(26)} ${cells.join(' ')}`);
  }

  log('\nMisses by category (positives):');
  const cats = [...new Set(cases.filter((c) => c.expect).map((c) => c.cat))];
  for (const m of models) for (const v of variants) {
    const misses = cats.map((cat) => {
      const rs = ok.filter((r) => r.model === m && r.variant === v && r.cat === cat && r.expect);
      const miss = rs.filter((r) => !fired(r)).length;
      return miss ? `${cat} ${miss}/${rs.length}` : null;
    }).filter(Boolean);
    log(`  ${m} ${v}: ${misses.join(', ') || 'none'}`);
  }

  if (variants.length > 1) {
    const [base, ...rest] = variants;
    log(`\nCases where a variant differs from "${base}" (positives lost, negatives gained):`);
    for (const m of models) for (const v of rest) for (const c of cases) {
      const n = (vv) => ok.filter((r) => r.model === m && r.variant === vv && r.id === c.id).filter(fired).length;
      const a = n(base);
      const b = n(v);
      if ((c.expect && b < a) || (!c.expect && b > a)) log(`  ${m} ${v} ${c.id}: ${base} ${a} -> ${v} ${b}`);
    }
  }

  log('\nUsage:');
  for (const m of models) {
    const rs = ok.filter((r) => r.model === m);
    const inTok = rs.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0);
    const outTok = rs.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0);
    log(`  ${m}: ${rs.length} calls, ${inTok} input tokens, ${outTok} output tokens`);
  }
}

// ---------------------------------------------------------------------------
// Entry points: `node --test` (gated suite) or plain `node` (report only)
// ---------------------------------------------------------------------------

async function runAsTest() {
  const { describe, it } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;
  const opts = resolveOptions();
  for (const modelId of opts.models) {
    const provider = detectProvider(modelId);
    describe(`skill activation :: ${modelId}`, () => {
      if (!hasKey(provider)) {
        it(`skipped, ${PROVIDERS[provider].envKey} is unset`, { skip: true }, () => {});
        return;
      }
      it(`clears the activation floor for: ${opts.variants.join(', ')}`, async () => {
        const results = await runEval({ ...opts, models: [modelId] });
        report(results, (line) => console.log(line));
        const gate = GATES[provider] ?? GATES.default;
        for (const v of opts.variants) {
          const s = score(results, modelId, v);
          assert.ok(s.errors <= Math.ceil(0.05 * (s.positives + s.negatives + s.errors)), `${v}: ${s.errors} calls errored`);
          assert.equal(s.fp, 0, `${v}: ${s.fp} false activations on negative cases`);
          assert.ok(s.tp / s.positives >= gate.recall, `${v}: recall ${pct(s.tp, s.positives)} is under the ${gate.recall * 100}% floor`);
          if (s.documents) {
            assert.ok(s.docTp / s.documents >= gate.documentRecall, `${v}: document-shaped recall ${s.docTp}/${s.documents} is under the ${gate.documentRecall * 100}% floor`);
          }
        }
      });
    });
  }
}

async function runAsScript() {
  if (process.env.ACTIVATION_REPORT) {
    report(JSON.parse(fs.readFileSync(process.env.ACTIVATION_REPORT, 'utf8')));
    return;
  }
  const opts = resolveOptions();
  opts.models = opts.models.filter((m) => {
    const ok = hasKey(detectProvider(m));
    if (!ok) console.error(`skip ${m}: ${PROVIDERS[detectProvider(m)].envKey} is unset`);
    return ok;
  });
  const total = opts.models.length * opts.variants.length * opts.cases.length * opts.samples;
  console.error(`${total} calls (${opts.models.join(', ')} x ${opts.variants.join(', ')} x ${opts.cases.length} cases x ${opts.samples})`);
  const results = await runEval(opts);
  if (process.env.ACTIVATION_OUT) fs.writeFileSync(process.env.ACTIVATION_OUT, JSON.stringify(results, null, 2));
  report(results);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entry = process.env.NODE_TEST_CONTEXT ? runAsTest() : runAsScript();
  entry.catch((e) => { console.error(e); process.exit(1); });
}
