/**
 * Token budget: what the skill puts in an agent's context, held to the caps in
 * scripts/token-budget.json so it cannot creep back.
 *
 * Bytes stand in for tokens (about four bytes a token for this prose). Every
 * LLM-facing markdown file under skill/ (SKILL.src.md without its frontmatter,
 * reference/, agents/) has a cap, and each common use has a cap on the files it
 * loads before its first edit. A file with no cap fails too, so a new
 * reference is a budget decision rather than a silent addition.
 *
 * `node scripts/lib/token-budget.js` prints current sizes against the caps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function bodyBytes(file, rel) {
  let text = fs.readFileSync(file, 'utf-8');
  if (rel === 'SKILL.src.md' && text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  return Buffer.byteLength(text);
}

function skillFiles(rootDir) {
  const skillDir = path.join(rootDir, 'skill');
  const out = new Map();
  out.set('SKILL.src.md', bodyBytes(path.join(skillDir, 'SKILL.src.md'), 'SKILL.src.md'));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const rel = path.relative(skillDir, full).split(path.sep).join('/');
        out.set(rel, bodyBytes(full, rel));
      }
    }
  };
  for (const sub of ['reference', 'agents']) {
    const dir = path.join(skillDir, sub);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

/** Returns { errors: string[], rows: string[] } for the tree at rootDir. */
export function checkTokenBudget(rootDir) {
  const budget = JSON.parse(fs.readFileSync(path.join(rootDir, 'scripts', 'token-budget.json'), 'utf-8'));
  const sizes = skillFiles(rootDir);
  const errors = [];
  const rows = [];
  for (const [rel, bytes] of sizes) {
    const cap = budget.files[rel];
    if (cap === undefined) {
      errors.push(`${rel} (${bytes} bytes) has no cap in scripts/token-budget.json; add one, sized to what the file must carry`);
    } else if (bytes > cap) {
      errors.push(`${rel} is ${bytes} bytes, over its ${cap}-byte cap; cut it, or raise the cap in scripts/token-budget.json with the reason in the PR`);
    }
  }
  for (const rel of Object.keys(budget.files)) {
    if (!sizes.has(rel)) errors.push(`scripts/token-budget.json caps ${rel}, which no longer exists; drop its entry`);
  }
  for (const [use, { loads, max }] of Object.entries(budget.uses)) {
    const missing = loads.filter((rel) => !sizes.has(rel));
    if (missing.length) {
      errors.push(`use "${use}" loads ${missing.join(', ')}, which does not exist`);
      continue;
    }
    const total = loads.reduce((sum, rel) => sum + sizes.get(rel), 0);
    rows.push(`${use}: ${total} of ${max} bytes (about ${Math.round(total / 4)} tokens)`);
    if (total > max) {
      errors.push(`use "${use}" loads ${total} bytes before its first edit, over its ${max}-byte cap (${loads.join(' + ')})`);
    }
  }
  return { errors, rows, sizes, budget };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { errors, rows, sizes, budget } = checkTokenBudget(root);
  for (const [rel, bytes] of [...sizes].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(bytes).padStart(7)} / ${String(budget.files[rel] ?? '-').padStart(7)}  ${rel}`);
  }
  console.log('');
  for (const row of rows) console.log(row);
  for (const e of errors) console.error(`❌ ${e}`);
  process.exit(errors.length ? 1 : 0);
}
