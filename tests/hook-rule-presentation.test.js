/**
 * Sync guard for the design context document's Hooks page.
 *
 * The document lists the detector's rules from picker/data/hook-rules.json,
 * which build:picker regenerates from the canonical registry plus the
 * presentation mapping in scripts/lib/hook-rule-presentation.js. This pins
 * both directions: a rule added to the registry without a discipline fails
 * here (so the document can never silently miss one), and a stale committed
 * JSON fails against a fresh composition.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTIPATTERNS } from '../cli/engine/registry/antipatterns.mjs';
import { FINGERPRINT_IDS, DISCIPLINES, composeHookRules } from '../scripts/lib/hook-rule-presentation.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('hook rule presentation', () => {
  test('gives every registry rule a discipline, and maps nothing else', () => {
    const registryIds = new Set(ANTIPATTERNS.map((rule) => rule.id));
    for (const rule of ANTIPATTERNS) {
      if (!DISCIPLINES[rule.id]) {
        throw new Error(`rule ${rule.id} has no discipline; add it to scripts/lib/hook-rule-presentation.js`);
      }
    }
    for (const id of Object.keys(DISCIPLINES)) {
      if (!registryIds.has(id)) throw new Error(`mapped id ${id} is not in the registry`);
    }
    for (const id of FINGERPRINT_IDS) {
      const rule = ANTIPATTERNS.find((entry) => entry.id === id);
      if (!rule) throw new Error(`fingerprint id ${id} is not in the registry`);
      expect(rule.category).toBe('slop');
    }
    expect(Object.keys(DISCIPLINES).length).toBe(ANTIPATTERNS.length);
  });

  test('matches the committed picker/data/hook-rules.json', () => {
    const committed = JSON.parse(readFileSync(path.join(here, '../picker/data/hook-rules.json'), 'utf8'));
    expect(committed).toEqual(composeHookRules(ANTIPATTERNS));
  });
});
