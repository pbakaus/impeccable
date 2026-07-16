#!/usr/bin/env node
/**
 * Surface-concept seed: the dice half of new-work's task-composition procedure.
 *
 * The model derives a grounded shortlist of candidate FORMS from the
 * audience's world and the subject's cultural home (see
 * reference/new-work.md). Left alone, it then always builds its #1 —
 * and a single model's resonance ranking is deterministic, so every run
 * in a category ships the same one or two concepts. Measured: 30/35
 * identical concepts across 16 prompt framings; the model cannot roll
 * its own dice.
 *
 * This script rolls them from outside, the same trick that made the
 * palette seed work:
 *   - PROMOTED INDEX: which entry of the model's own resonance-ordered
 *     shortlist must be taken seriously beside its favorites. The dice never
 *     choose an ungrounded ingredient; they only refuse the argmax rut.
 *   - CHALLENGERS (3): outside forms from concept-ingredients.json, weighed
 *     against the derived candidates on exactly two axes — audience
 *     identification and product clarity. They win only when they beat the
 *     grounded list; measured behavior is that they lose to strong cultural
 *     material and win over thin categories, which is the intended shape.
 *
 * Usage:
 *   node scripts/concept-seed.mjs                 # roll at random
 *   node scripts/concept-seed.mjs --from <key>    # deterministic (hash key)
 *
 * Env vars:
 *   IMPECCABLE_CONCEPT_SEED — same as --from; for reproducible eval runs.
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pool = JSON.parse(readFileSync(join(here, 'concept-ingredients.json'), 'utf8'));

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
// When no key is supplied, generate one and print it: a user reporting a
// bad outcome can hand us the key and we replay the exact roll.
const key = fromIdx !== -1
  ? args[fromIdx + 1]
  : (process.env.IMPECCABLE_CONCEPT_SEED || crypto.randomBytes(4).toString('hex'));

function hashUnit(k, salt) {
  const h = crypto.createHash('sha256').update(`${salt}:${k}`).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}
const unit = (salt) => hashUnit(key, salt);

const buildIndex = 3 + Math.floor(unit('index') * 5); // 3..7

const entries = Object.entries(pool)
  .filter(([k]) => !k.startsWith('_'))
  .flatMap(([, list]) => list);
const picks = [];
const taken = new Set();
for (let i = 0; picks.length < 3 && i < 60; i++) {
  const idx = Math.floor(unit(`challenger-${i}`) * entries.length) % entries.length;
  if (!taken.has(idx)) {
    taken.add(idx);
    picks.push(entries[idx]);
  }
}

process.stdout.write(`CONCEPT SEED (key: ${key}; rerun with --from ${key} to reproduce this roll)
PROMOTED INDEX: ${buildIndex}
  After ordering the task's grounded structural candidates by resonance,
  promote candidate ${buildIndex} into the serious shortlist. In an attended
  run, present it beside the strongest materially different candidates and
  let the user select or revise the surface concept. In a truly unattended
  run, use it when it survives audience identification and product clarity.
  The promotion exists to refuse the model's ranking rut, not to outrank the
  user or the brief.
CHALLENGERS (weigh against your derived candidates on the same two axes,
audience identification and product clarity; a challenger wins only when
it beats the grounded list on both):
  1. ${picks[0]}
  2. ${picks[1]}
  3. ${picks[2]}
If a challenger survives, it may enter the shortlist as a structural option.
PRODUCT.md and DESIGN.md constrain every candidate's identity vocabulary;
they do not cancel task-level composition. A user- or brief-pinned surface
concept beats the roll, always. The seed never authorizes a new palette,
type system, material world, or unfamiliar control behavior.
`);
