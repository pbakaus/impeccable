/**
 * Deterministic smoke tests for the new-work interactive flow.
 *
 * Covers the parts a user actually touches: the serve-question decision page
 * (pick, re-roll + steer + re-deal, canon, tab close) driven through a real
 * browser by the scripted user bot, plus the offline fake image generator.
 * No LLM calls; a real Chromium via Playwright supplies full page fidelity
 * (heartbeats, re-roll reload, tab close). Kept OUT of `bun run test` like
 * live-e2e; run it with `bun run test:new-work-e2e`.
 *
 * The concept-seed direction roll (challengers, ASSIGNED INDEX, the no
 * PRODUCT.md gate) is already covered by tests/concept-seed.test.mjs and is
 * not repeated here.
 *
 * One-time setup:  npx playwright install chromium
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runUserBot } from './new-work-e2e/user-bot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'skill', 'scripts', 'serve-question.mjs');
const GENERATE = path.join(ROOT, 'skill', 'scripts', 'generate-image.mjs');
const CATALOG_DIR = path.join(ROOT, 'tests', 'fixtures', 'concept-catalog');

let playwright;
let browser;

before(async () => {
  try {
    playwright = await import('playwright');
  } catch (err) {
    throw new Error(
      `Playwright is required for new-work-e2e tests (${err.message}). Run: npx playwright install chromium`,
    );
  }
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(`Failed to launch Chromium (${err.message}). Run: npx playwright install chromium`);
  }
});

after(async () => {
  if (browser) await browser.close();
});

// --------------------------------------------------------------------------
// Workspace + serve-question helpers
// --------------------------------------------------------------------------
function makeWorkspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'new-work-e2e-'));
  writeFileSync(
    path.join(dir, 'PRODUCT.md'),
    '# Product\n\n## Register\n\nbrand\n\n## Platform\n\nweb\n',
  );
  return dir;
}

// serve-question writes its state under cwd; run everything from the workspace.
function run(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVE, ...args], {
      cwd,
      env: { ...process.env, IMPECCABLE_QUESTION_FORCE: '1', IMPECCABLE_CATALOG_DIR: CATALOG_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

async function startDaemon(cwd, payload, key) {
  const payloadPath = path.join(cwd, `${key}.payload.json`);
  writeFileSync(payloadPath, JSON.stringify(payload));
  const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', key], cwd);
  assert.equal(started.code, 0, `--start failed: ${started.out} ${started.err}`);
  const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
  assert.ok(url, `no URL from --start: ${started.out}`);
  return { url, payloadPath };
}

// Poll --wait until it settles on a terminal exit code (0 answered, 2 gone,
// 4 page closed); loop while it reports WAITING (3).
async function waitLoop(cwd, key, { poll = 30, max = 20 } = {}) {
  for (let i = 0; i < max; i++) {
    const res = await run(['--wait', '--key', key, '--poll', String(poll)], cwd);
    if (res.code !== 3) return res;
  }
  throw new Error('waitLoop exceeded max iterations');
}

async function stopDaemon(cwd, key) {
  await run(['--stop', '--key', key], cwd).catch(() => {});
}

function makeFakeImage(cwd, prompt, outName) {
  const out = path.join(cwd, outName);
  const res = spawnSyncGen(prompt, out);
  assert.equal(res.status, 0, `generate-image fake failed: ${res.stderr}`);
  return out;
}

function spawnSyncGen(prompt, out, size = null) {
  const args = [GENERATE, '--prompt', prompt, '--out', out];
  if (size) args.push('--size', size);
  return spawnSync(process.execPath, args, {
    env: { ...process.env, IMPECCABLE_IMAGE_GEN_FAKE: '1' },
    encoding: 'buffer',
  });
}

// --------------------------------------------------------------------------
// serve-question interactive cycles
// --------------------------------------------------------------------------
describe('new-work-e2e: serve-question decision page', () => {
  it('(a) pick assigned returns the option, hero/board fields, and the CHOSEN CARD directive', async () => {
    const cwd = makeWorkspace();
    const key = 'pick';
    const hero = makeFakeImage(cwd, 'Fillmore handbill hero', 'hero.png');
    const board = makeFakeImage(cwd, 'Fillmore handbill board', 'board.png');
    const payload = {
      title: 'Choose the visual world',
      question: 'The roll assigned Fillmore Handbill.',
      options: [
        { id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL', hero, board },
        { id: 'challenger-teletext', label: 'Teletext Service', body: 'block-mosaic pages' },
      ],
      reroll: true,
      canon: true,
      steer: true,
    };
    await startDaemon(cwd, payload, key);
    try {
      const bot = await runUserBot({
        workspaceDir: cwd, key, browser,
        policy: [{ pick: 'assigned', steer: 'warmer palette' }],
      });
      assert.equal(bot.results[0].action, 'pick');
      const collected = await waitLoop(cwd, key);
      assert.equal(collected.code, 0, collected.out);
      assert.match(collected.out, /ANSWER: /);
      const answer = JSON.parse(collected.out.match(/ANSWER: (\{.*\})/)[1]);
      assert.equal(answer.optionId, 'assigned');
      assert.equal(answer.steer, 'warmer palette');
      assert.ok(answer.hero, 'answer carries the chosen hero path');
      assert.ok(answer.board, 'answer carries the chosen board path');
      assert.match(collected.out, /CHOSEN CARD:/);
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(b) re-roll with steer keeps the server alive; --update re-deals; the next pick is terminal', async () => {
    const cwd = makeWorkspace();
    const key = 'reroll';
    const payload1 = {
      title: 'Choose the visual world',
      options: [
        { id: 'assigned', label: 'First Hand', kicker: 'THE ROLL' },
        { id: 'challenger-a', label: 'Alt One' },
      ],
      reroll: true, steer: true, canon: true,
    };
    const payload2 = {
      title: 'Choose the visual world',
      options: [
        { id: 'assigned', label: 'Second Hand', kicker: 'THE ROLL' },
        { id: 'challenger-b', label: 'Alt Two' },
      ],
      reroll: true, steer: true,
    };
    await startDaemon(cwd, payload1, key);
    try {
      // Bot drives the whole page: re-roll (with steer) then, after the page
      // reloads into the next hand, pick the assigned card.
      const botPromise = runUserBot({
        workspaceDir: cwd, key, browser,
        policy: [{ reroll: true, steer: 'colder, more restraint' }, { pick: 'assigned' }],
      });

      // First answer: the re-roll. Server must stay alive afterwards.
      const first = await waitLoop(cwd, key);
      assert.equal(first.code, 0, first.out);
      assert.match(first.out, /"optionId":"reroll"/);
      assert.match(first.out, /colder, more restraint/);
      assert.ok(existsSync(path.join(cwd, '.impeccable', 'questions', `${key}.state.json`)),
        'server state file survives a re-roll');

      // Deliver the next hand; the live page reloads itself.
      const nextPayloadPath = path.join(cwd, 'next.json');
      writeFileSync(nextPayloadPath, JSON.stringify(payload2));
      const updated = await run(['--update', '--key', key, '--payload', nextPayloadPath], cwd);
      assert.equal(updated.code, 0, updated.out);

      // Second answer: the terminal pick on the re-dealt hand.
      const second = await waitLoop(cwd, key);
      assert.equal(second.code, 0, second.out);
      assert.match(second.out, /"optionId":"assigned"/);

      const bot = await botPromise;
      assert.equal(bot.results[0].action, 'reroll');
      assert.ok(bot.results[0].reloaded, 'page reloaded into the next hand');
      assert.equal(bot.results[1].action, 'pick');

      // Terminal pick cleans the state file up.
      assert.ok(!existsSync(path.join(cwd, '.impeccable', 'questions', `${key}.state.json`)),
        'terminal pick removes the server state file');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(c) canon click returns optionId canon and prints the CANON CHOSEN directive', async () => {
    const cwd = makeWorkspace();
    const key = 'canon';
    const payload = {
      title: 'Choose the visual world',
      options: [{ id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL' }],
      reroll: true, canon: true, steer: true,
    };
    await startDaemon(cwd, payload, key);
    try {
      await runUserBot({ workspaceDir: cwd, key, browser, policy: [{ canon: true }] });
      const collected = await waitLoop(cwd, key);
      assert.equal(collected.code, 0, collected.out);
      assert.match(collected.out, /"optionId":"canon"/);
      assert.match(collected.out, /CANON CHOSEN:/);
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(d) closing the tab makes --wait exit 4 PAGE CLOSED', async () => {
    const cwd = makeWorkspace();
    const key = 'close';
    const payload = {
      title: 'Choose the visual world',
      options: [{ id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL' }],
      reroll: true, steer: true,
    };
    await startDaemon(cwd, payload, key);
    try {
      const bot = await runUserBot({ workspaceDir: cwd, key, browser, policy: [{ close: true }] });
      assert.equal(bot.results[0].action, 'close');
      assert.ok(bot.results[0].beat > 0, 'a heartbeat landed before the tab closed');
      // --wait must observe the stale heartbeat and report the closed page.
      const res = await run(['--wait', '--key', key, '--poll', '30'], cwd);
      assert.equal(res.code, 4, `expected exit 4, got ${res.code}: ${res.out}`);
      assert.match(res.out, /PAGE CLOSED/);
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(e) an option with no hero renders a text-only card (no .media element)', async () => {
    const cwd = makeWorkspace();
    const key = 'textonly';
    const hero = makeFakeImage(cwd, 'has a hero', 'hero.png');
    const payload = {
      title: 'Choose the visual world',
      options: [
        {
          id: 'assigned', label: 'Text Only Direction', body: 'a grounded direction, no comp',
          viewport: 'A full-width ruled manifest with entries.', case: 'Grounded in the audience world.',
        },
        { id: 'challenger-hero', label: 'Has A Card', hero },
      ],
      reroll: true, steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('button.choose');
      const textOnlyMedia = await page.$('.card[data-id="assigned"] .media');
      const heroMedia = await page.$('.card[data-id="challenger-hero"] .media');
      const textOnlyFace = await page.$('.card[data-id="assigned"] .face.text-only');
      // No media means no back face to hide facts on: the full read renders
      // on the front, where nothing else would have used the room.
      const textOnlyBack = await page.$('.card[data-id="assigned"] .face.back');
      const frontRead = await page.$eval('.card[data-id="assigned"] .face.front', (el) => el.textContent);
      // Catalog art without a sketch is labeled as reference, never as the
      // promise of the build.
      const heroLabel = await page.$eval('.card[data-id="challenger-hero"] .media .media-label', (el) => el.textContent);
      await context.close();
      assert.equal(textOnlyMedia, null, 'text-only card has no .media region');
      assert.ok(textOnlyFace, 'text-only card carries the .text-only face class');
      assert.ok(heroMedia, 'the hero card still renders its .media region');
      assert.equal(textOnlyBack, null, 'text-only card has no unreachable back face');
      assert.match(frontRead, /First viewport/, 'text-only front carries the first viewport fact');
      assert.match(frontRead, /The case/, 'text-only front carries the case fact');
      assert.equal(heroLabel, 'inspiration', 'sketchless catalog art is labeled inspiration');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(f) a hero that never loads collapses to a labeled palette field, not a dark void', async () => {
    const cwd = makeWorkspace();
    const key = 'brokenart';
    const payload = {
      title: 'Choose the visual world',
      options: [
        {
          id: 'assigned', label: 'Broken Art Direction',
          thesis: 'The art is gone but the direction is not.',
          palette: ['#1a3a2e', '#f2ede2', '#c8452a'],
          risk: 'None.',
          // Port 1 refuses connections everywhere; the load fails offline
          // and deterministically, like a retired catalog URL in the field.
          hero: 'http://127.0.0.1:1/gone-hero.webp',
        },
      ],
      reroll: true, steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('.card[data-id="assigned"] .media.unavailable');
      const imgGone = await page.$('.card[data-id="assigned"] .media img');
      const label = await page.$eval('.card[data-id="assigned"] .media .media-label', (el) => el.textContent);
      const field = await page.$eval('.card[data-id="assigned"] .media', (el) => el.style.background);
      await context.close();
      assert.equal(imgGone, null, 'the broken img is removed');
      assert.equal(label, 'artwork unavailable', 'the slot says what happened');
      assert.match(field, /linear-gradient/, 'the slot is painted from the card palette');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// --------------------------------------------------------------------------
// Fake image generation
// --------------------------------------------------------------------------
describe('new-work-e2e: fake image generation', () => {
  it('is deterministic per prompt and encodes the SYNTHETIC marker', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'new-work-img-'));
    try {
      const a = path.join(cwd, 'a.png');
      const b = path.join(cwd, 'b.png');
      const r1 = spawnSyncGen('Fillmore psychedelic handbill, warm ink', a);
      const r2 = spawnSyncGen('Fillmore psychedelic handbill, warm ink', b);
      assert.equal(r1.status, 0, r1.stderr?.toString());
      assert.equal(r2.status, 0, r2.stderr?.toString());
      assert.ok(existsSync(a) && existsSync(b), 'both files exist');
      assert.match(r1.stdout.toString(), /\$0\.00/, 'cost line reads $0.00');
      const bytesA = readFileSync(a);
      const bytesB = readFileSync(b);
      assert.ok(bytesA.equals(bytesB), 'same prompt yields identical bytes');
      // Valid PNG signature + the SYNTHETIC marker (in the tEXt chunk).
      assert.equal(bytesA.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(bytesA.includes(Buffer.from('SYNTHETIC')), 'PNG carries the SYNTHETIC marker');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('renders a different palette for a different prompt', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'new-work-img-'));
    try {
      const a = path.join(cwd, 'a.png');
      const c = path.join(cwd, 'c.png');
      spawnSyncGen('Fillmore psychedelic handbill, warm ink', a);
      spawnSyncGen('Teletext broadcast mosaic, cold blue', c);
      const bytesA = readFileSync(a);
      const bytesC = readFileSync(c);
      assert.ok(!bytesA.equals(bytesC), 'different prompts produce different images');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('the SVG variant carries the readable prompt text and SYNTHETIC COMP label', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'new-work-img-'));
    try {
      const svg = path.join(cwd, 'comp.svg');
      const res = spawnSyncGen('teletext broadcast mosaic', svg, '800x600');
      assert.equal(res.status, 0, res.stderr?.toString());
      const text = readFileSync(svg, 'utf8');
      assert.match(text, /^<\?xml/, 'is an SVG document');
      assert.match(text, /SYNTHETIC COMP/);
      assert.match(text, /teletext/i, 'the prompt text is rendered');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
