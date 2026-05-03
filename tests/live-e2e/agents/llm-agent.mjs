/**
 * LLM-backed VariantAgent for the live-mode E2E suite.
 *
 * Implements the same one-method interface as createFakeAgent() in
 * tests/live-e2e/agent.mjs: generateVariants(event, context) returns
 * { scopedCss, variants[] }. The orchestrator handles wrap, write, accept,
 * and carbonize cleanup deterministically, so this module's only job is
 * producing variant content for the wrapper.
 *
 * Default model: Claude Haiku 4.5 — fast, cheap, smart enough for variant
 * generation in test fixtures. Override via { model } when constructing,
 * or via the IMPECCABLE_E2E_LLM_MODEL env var at the call site (test runner).
 *
 * Prompt caching: live.md (the live-mode skill spec) is the bulk of the
 * system prompt and is stable across calls. We mark a cache_control breakpoint
 * on the last system block so both the JSON-contract instructions and the
 * spec are cached as one prefix. Subsequent calls in the same run pay only
 * the cache-read rate (~0.1× input).
 *
 * Returns null from createLlmAgent() when ANTHROPIC_API_KEY is unset; the
 * test runner reads that and skips the case rather than failing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIVE_MD_PATH = path.join(
  REPO_ROOT,
  'source',
  'skills',
  'impeccable',
  'reference',
  'live.md',
);

const DEFAULT_MODEL = 'claude-haiku-4-5';

const SYSTEM_INSTRUCTIONS = [
  'You are an automated subagent inside Impeccable\'s live-mode test harness.',
  'Given an element the user picked, an action, and a count, you produce variant DOM content in a strict JSON shape.',
  '',
  'OUTPUT CONTRACT — return ONLY a JSON object with this exact shape. No prose, no code fences, no commentary:',
  '',
  '{',
  '  "scopedCss": "string — contents of the preview CSS block, authored according to wrapInfo.cssAuthoring",',
  '  "variants": [',
  '    {',
  '      "innerHtml": "string — single top-level HTML element matching the picked element\'s tag, e.g. <h1 class=\\"hero-title\\">Title</h1>",',
  '      "params": [/* optional 0-4 ParamSpec entries */]',
  '    }',
  '  ]',
  '}',
  '',
  'ParamSpec is one of:',
  '  { "id": "string", "kind": "range",  "min": number, "max": number, "step": number, "default": number, "label": "string" }',
  '  { "id": "string", "kind": "steps",  "default": "string", "label": "string", "options": [{ "value": "string", "label": "string" }, ...] }',
  '  { "id": "string", "kind": "toggle", "default": boolean, "label": "string" }',
  '',
  'REQUIREMENTS',
  '- Each variant.innerHtml must be a single top-level HTML element. Use the EXACT same tag as the picked element.',
  '- PRESERVE the original element\'s className verbatim. If the picked element\'s outerHTML contains class="hero-title", every variant\'s innerHtml MUST contain the same class="hero-title" string (you may add additional class names alongside, never remove or rename the original). This is a hard requirement — automated harnesses verify the original class survives across the variant set.',
  '- Generate exactly event.count variants — no more, no fewer.',
  '- Mix the param kinds across the variant set: include at least one range, one steps, and one toggle when count >= 3.',
  '- The scopedCss must follow wrapInfo.cssAuthoring exactly: use its selector strategy, rulePattern, requirements, and forbidden patterns.',
  '- Wire scopedCss rules against the params you emit (CSS vars for range/toggle, attribute selectors for steps/toggle).',
  '- Use HTML attribute syntax in innerHtml (class=, not className=). The orchestrator translates per file syntax.',
  '- Do NOT emit the wrapping <div data-impeccable-variant="N">. The orchestrator wraps your content.',
  '- Do NOT emit the outer <style data-impeccable-css> tag. Only its contents go in scopedCss.',
  '- Do NOT include any <!-- comments --> in scopedCss; CSS comments use /* */.',
  '',
  'CONTEXT — full live-mode skill spec follows. Use it as the source of truth for any nuance in the variant format.',
].join('\n');

/**
 * @typedef {object} LlmAgentOptions
 * @property {string=} apiKey  Override ANTHROPIC_API_KEY env var.
 * @property {string=} model   Default 'claude-haiku-4-5'. Override to 'claude-sonnet-4-6' if Haiku produces unreliable JSON.
 * @property {(msg: string) => void=} log  Optional logger for debug output.
 */

/**
 * @param {LlmAgentOptions} [opts]
 * @returns {Promise<{generateVariants: (event: object, context: object) => Promise<{scopedCss: string, variants: object[]}>} | null>}
 */
export async function createLlmAgent(opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model = opts.model || DEFAULT_MODEL;
  const log = opts.log || (() => {});

  const liveMd = await fs.readFile(LIVE_MD_PATH, 'utf-8');
  const client = new Anthropic({ apiKey });

  return {
    async generateVariants(event, context = {}) {
      const userMessage = [
        'Produce variants for the following pick. Reply with the JSON object only — no prose.',
        '',
        '```json',
        JSON.stringify(
          {
            id: event.id,
            action: event.action,
            count: event.count,
            element: {
              outerHTML: event.element?.outerHTML,
              tagName: event.element?.tagName,
              className: event.element?.className,
              textContent: event.element?.textContent?.slice(0, 200),
            },
            wrapInfo: {
              styleMode: context.wrapInfo?.styleMode,
              styleTag: context.wrapInfo?.styleTag,
              cssAuthoring: context.wrapInfo?.cssAuthoring,
            },
          },
          null,
          2,
        ),
        '```',
      ].join('\n');

      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        system: [
          { type: 'text', text: SYSTEM_INSTRUCTIONS },
          // Cacheable: the entire stable prefix (instructions + spec) is
          // cached up to this breakpoint. The user message holds all the
          // per-call volatile content.
          { type: 'text', text: liveMd, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const cacheRead = response.usage?.cache_read_input_tokens ?? 0;
      const cacheWrite = response.usage?.cache_creation_input_tokens ?? 0;
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      log(
        `model=${model} input=${inputTokens} output=${outputTokens} cache_read=${cacheRead} cache_write=${cacheWrite}`,
      );

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const cleaned = stripCodeFence(text.trim());
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        throw new Error(
          `LLM agent: response was not valid JSON (${err.message}). First 500 chars:\n${cleaned.slice(0, 500)}`,
        );
      }

      if (typeof parsed.scopedCss !== 'string') {
        throw new Error(`LLM agent: missing or non-string scopedCss in response`);
      }
      if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
        throw new Error(`LLM agent: variants must be a non-empty array`);
      }
      for (const [i, v] of parsed.variants.entries()) {
        if (typeof v.innerHtml !== 'string' || !v.innerHtml.trim()) {
          throw new Error(`LLM agent: variants[${i}].innerHtml missing or empty`);
        }
        if (v.params !== undefined && !Array.isArray(v.params)) {
          throw new Error(`LLM agent: variants[${i}].params must be an array if present`);
        }
      }

      return parsed;
    },
  };
}

/**
 * Some models wrap JSON in ```json … ``` fences despite the instruction not to.
 * Strip a single optional fence, leave anything else alone.
 */
function stripCodeFence(s) {
  return s
    .replace(/^```(?:json)?\s*\n/, '')
    .replace(/\n```\s*$/, '');
}
