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

  it('(e) a text-only assigned card caps every card at thumb imagery (salience parity)', async () => {
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
      // Salience parity: with a text-only assigned card, a challenger's
      // catalog art may not render as a full-bleed face beside it; it demotes
      // to a labeled thumb in the body, so pretty pixels never outvote the
      // weighing. The thumb stays labeled as reference, never as the promise
      // of the build.
      const heroThumbLabel = await page.$eval('.card[data-id="challenger-hero"] .inspo figcaption', (el) => el.textContent);
      await context.close();
      assert.equal(textOnlyMedia, null, 'text-only card has no .media region');
      assert.ok(textOnlyFace, 'text-only card carries the .text-only face class');
      assert.equal(heroMedia, null, 'parity demotes the challenger hero from a full-bleed face');
      assert.equal(textOnlyBack, null, 'text-only card has no unreachable back face');
      assert.match(frontRead, /First viewport/, 'text-only front carries the first viewport fact');
      assert.match(frontRead, /The case/, 'text-only front carries the case fact');
      assert.equal(heroThumbLabel, 'inspired by', 'demoted catalog art is a labeled thumb');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(e1) a missing comp without inspiration settles into a complete text-only card', async () => {
    const cwd = makeWorkspace();
    const key = 'missing-comp';
    const board = makeFakeImage(cwd, 'board fallback', 'board-fallback.png');
    const payload = {
      title: 'Choose the visual world',
      options: [
        {
          id: 'assigned', label: 'Shotengai Chalkboard', kicker: 'THE ROLL',
          thesis: 'A hand-lettered neighborhood noticeboard.',
          body: 'Program notes explain how the board changes through the day.',
          palette: ['#18251d', '#f2e8cb'], materials: ['chalk', 'painted timber'],
          viewport: 'The daily program fills a ruled community board.',
          case: 'The audience already reads this visual language.',
          risk: 'Can become nostalgic if the type loses discipline.',
          comp: path.join(cwd, '.impeccable', 'mocks', 'decision', 'missing.webp'),
        },
        {
          id: 'kept-only', label: 'Kept Line Only',
          kept: 'Keep the hand-painted timetable as the organizing device.',
          comp: path.join(cwd, '.impeccable', 'mocks', 'decision', 'kept-missing.webp'),
        },
        {
          id: 'body-only', label: 'Body Line Only',
          thesis: 'A compact neighborhood notice.',
          body: 'Body copy must remain present exactly once.',
          comp: path.join(cwd, '.impeccable', 'mocks', 'decision', 'body-missing.webp'),
        },
        {
          id: 'plain-body', label: 'Plain Body',
          body: 'Plain body follows the promoted facts.',
          viewport: 'A compact neighborhood notice fills the first viewport.',
          comp: path.join(cwd, '.impeccable', 'mocks', 'decision', 'plain-body-missing.webp'),
        },
        {
          id: 'board-only', label: 'Board Fallback',
          board,
          comp: path.join(cwd, '.impeccable', 'mocks', 'decision', 'board-missing.webp'),
        },
      ],
      reroll: true,
      steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        const realNow = Date.now.bind(Date);
        let offset = 0;
        Date.now = () => realNow() + offset;
        window.__advanceDecisionClock = (ms) => { offset += ms; };
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('.card[data-id="assigned"] .media.comp-pending');

      await page.evaluate(() => window.__advanceDecisionClock(241000));
      await page.waitForFunction(() => ['assigned', 'kept-only', 'body-only', 'plain-body'].every((id) =>
        !document.querySelector(`.card[data-id="${id}"] .media`)), null, { timeout: 6000 });
      await page.waitForSelector('.card[data-id="board-only"] .media.stand-in');

      const faceClass = await page.getAttribute('.card[data-id="assigned"] .face.front', 'class');
      const back = await page.$('.card[data-id="assigned"] .face.back');
      const frontRead = await page.$eval('.card[data-id="assigned"] .face.front', (el) => el.textContent);
      const keptOnlyRead = await page.$eval('.card[data-id="kept-only"] .face.front', (el) => el.textContent);
      const bodyOnlyRead = await page.$eval('.card[data-id="body-only"] .face.front', (el) => el.textContent);
      const plainBodyOrder = await page.$$eval('.card[data-id="plain-body"] .body > .fact, .card[data-id="plain-body"] .body > .detail',
        (els) => els.map((el) => el.className));
      const boardFallbackLabel = await page.$eval('.card[data-id="board-only"] .stand-in-label', (el) => el.textContent);
      await context.close();

      assert.match(faceClass, /text-only/, 'the settled card uses the text-only layout');
      assert.equal(back, null, 'the settled card has no unreachable back face');
      assert.match(frontRead, /First viewport/, 'the full first-viewport fact moves to the front');
      assert.match(frontRead, /The case/, 'the full case moves to the front');
      assert.match(frontRead, /Risk/, 'the risk remains readable after the media collapses');
      assert.match(frontRead, /Program notes explain/, 'thesis-linked body prose moves off the removed back face');
      assert.match(keptOnlyRead, /Keep the hand-painted timetable/, 'kept-only content survives without a back face');
      assert.equal(bodyOnlyRead.match(/Body copy must remain present exactly once\./g)?.length, 1,
        'body prose already on a no-back front is not duplicated');
      assert.deepEqual(plainBodyOrder, ['fact', 'detail'],
        'thesis-less body prose follows the facts promoted from the missing comp');
      assert.equal(boardFallbackLabel, 'inspiration · comp pending', 'board-only art remains as the labeled fallback');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(e2) verdicts route the deck: declined cards demote, reorder to the end, and stay adoptable', async () => {
    const cwd = makeWorkspace();
    const key = 'verdicts';
    const hero = makeFakeImage(cwd, 'declined hero', 'declined-hero.png');
    const winnerHero = makeFakeImage(cwd, 'winner hero', 'winner-hero.png');
    const payload = {
      title: 'Choose the visual world',
      options: [
        {
          id: 'assigned', label: 'The Seedsman Catalog', kicker: 'THE ROLL', hero: winnerHero,
          raised: [{ from: 'challenger-deepsea', raise: 'The catalog now owns its whole viewport.' }],
        },
        // Declined dealt before a competitive card on purpose: the page owns
        // the reorder, so payload order cannot promote a demoted world.
        {
          id: 'challenger-deepsea', label: 'Deep Sea Survey', verdict: 'declined',
          case: 'Fuses poorly: buyers do not identify with abyssal instrumentation.',
          kept: 'Total environmental commitment.', hero,
          // A stray comp on a declined card must not re-promote it to a
          // full media face; the renderer ignores it outright. Declared with
          // the legacy `sketch` key, which doubles as alias coverage.
          sketch: '.impeccable/sketches/challenger-deepsea.webp',
        },
        { id: 'challenger-waxprint', label: 'Wax Print Market', verdict: 'competitive', hero: winnerHero },
      ],
      reroll: true, steer: true,
      canon: true,
      canonCard: { label: 'The category standard', thesis: 'What the category ships.' },
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('button.choose');
      const order = await page.$$eval('.card', (cards) => cards.map((c) => c.dataset.id));
      const declinedCard = await page.$('.card.declined[data-id="challenger-deepsea"]');
      const declinedMedia = await page.$('.card[data-id="challenger-deepsea"] .media');
      const declinedThumb = await page.$('.card[data-id="challenger-deepsea"] .inspo');
      const declinedFront = await page.$eval('.card[data-id="challenger-deepsea"] .face.front', (el) => el.textContent);
      const declinedButton = await page.$eval('.card[data-id="challenger-deepsea"] .face.front button.choose', (el) => el.textContent);
      const competitiveMedia = await page.$('.card[data-id="challenger-waxprint"] .media');
      const raise = await page.$eval('.card[data-id="assigned"] .raise', (el) => el.textContent);
      // A demoted card is still a real choice: adopting it must answer.
      await page.click('.card[data-id="challenger-deepsea"] .face.front button.choose');
      const collected = await waitLoop(cwd, key);
      await context.close();
      assert.equal(collected.code, 0, collected.out);
      const answer = JSON.parse(collected.out.match(/ANSWER: (\{.*\})/)[1]);
      assert.deepEqual(order, ['assigned', 'challenger-waxprint', 'canon', 'challenger-deepsea'], 'contenders, then the canon, then declined dead last');
      assert.ok(declinedCard, 'declined verdict adds the .declined card class');
      assert.equal(declinedMedia, null, 'declined catalog art never renders full-bleed');
      assert.ok(declinedThumb, 'declined catalog art rides as a labeled thumb');
      assert.match(declinedFront, /Kept/, 'the declined front carries its kept line');
      assert.equal(declinedButton, 'Adopt anyway', 'the declined action is adopt, not build');
      assert.ok(competitiveMedia, 'a competitive challenger keeps its full media face');
      assert.match(raise, /From Deep Sea Survey/, 'the assigned card names its donor');
      assert.equal(answer.optionId, 'challenger-deepsea', 'adopting a declined card answers with its id');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(e3) register steers ride the re-roll: the bolder button answers with its register', async () => {
    const cwd = makeWorkspace();
    const key = 'registers';
    const payload = {
      title: 'Choose the visual world',
      options: [{ id: 'assigned', label: 'The Seedsman Catalog', kicker: 'THE ROLL' }],
      reroll: { registers: ['safer', 'bolder'] },
      steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#reroll-bolder');
      assert.ok(await page.$('#reroll-safer'), 'the safer steer renders');
      assert.ok(await page.$('#reroll'), 'the plain re-roll stays between the registers');
      await page.click('#reroll-bolder');
      const collected = await waitLoop(cwd, key);
      await context.close();
      assert.equal(collected.code, 0, collected.out);
      const answer = JSON.parse(collected.out.match(/ANSWER: (\{.*\})/)[1]);
      assert.equal(answer.optionId, 'reroll');
      assert.equal(answer.register, 'bolder', 'the answer names the requested register');
      assert.match(collected.out, /REGISTER: .*bolder/, 'the register directive tells the agent to re-run the seed');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(e4) followup keeps the table open: direction pick, then the execution-contract round', async () => {
    const cwd = makeWorkspace();
    const key = 'followup';
    const directionRound = {
      title: 'Choose the visual world',
      options: [{ id: 'assigned', label: 'The Seedsman Catalog', kicker: 'THE ROLL' }],
      reroll: true, steer: true,
      followup: true,
    };
    const buildPathRound = {
      title: 'How should it be built?',
      question: 'Same direction, two execution contracts. Pick where the risk goes.',
      options: [
        { id: 'comp-led', label: 'Comp-led', kicker: 'BOLD', thesis: 'A first-viewport comp leads and the build matches it.', risk: 'Fix rounds expected; motion arrives last.' },
        { id: 'code-led', label: 'Code-led', kicker: 'CRAFTED', thesis: 'Code authors the page; the boards calibrate it.', risk: 'Composition stays closer to convention.' },
      ],
    };
    const { url } = await startDaemon(cwd, directionRound, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('button.choose');
      await page.click('.card[data-id="assigned"] .face.front button.choose');

      // First answer: the direction. Not terminal, and it says so.
      const first = await waitLoop(cwd, key);
      assert.equal(first.code, 0, first.out);
      const firstAnswer = JSON.parse(first.out.match(/ANSWER: (\{.*\})/)[1]);
      assert.equal(firstAnswer.optionId, 'assigned');
      assert.equal(firstAnswer.followup, true, 'the answer marks the table as still open');
      assert.match(first.out, /FOLLOWUP OPEN:/, 'the directive tells the agent to send the next round');
      assert.ok(existsSync(path.join(cwd, '.impeccable', 'questions', `${key}.state.json`)),
        'server state file survives a followup pick');

      // The page swapped to the loading hand instead of goodbye.
      await page.waitForSelector('.card.skeleton');

      // Deliver the execution-contract round; the page reloads into it.
      const nextPayloadPath = path.join(cwd, 'build-path.json');
      writeFileSync(nextPayloadPath, JSON.stringify(buildPathRound));
      const updated = await run(['--update', '--key', key, '--payload', nextPayloadPath], cwd);
      assert.equal(updated.code, 0, updated.out);
      await page.waitForSelector('.card[data-id="code-led"]');
      await page.click('.card[data-id="code-led"] .face.front button.choose');

      // Second answer: terminal, table cleaned up.
      const second = await waitLoop(cwd, key);
      await context.close();
      assert.equal(second.code, 0, second.out);
      const secondAnswer = JSON.parse(second.out.match(/ANSWER: (\{.*\})/)[1]);
      assert.equal(secondAnswer.optionId, 'code-led');
      assert.equal(secondAnswer.followup, undefined, 'the build-path round is terminal');
      assert.ok(!existsSync(path.join(cwd, '.impeccable', 'questions', `${key}.state.json`)),
        'the terminal pick removes the server state file');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(h) the build-path toggle: a code-to-comp flip shimmers the slots, surfaces through --wait, and rides the answer', async () => {
    const cwd = makeWorkspace();
    const key = 'bptoggle';
    const payload = {
      title: 'Choose the structure',
      buildPath: { value: 'code', toggle: true },
      steer: true,
      options: [
        {
          id: 'assigned', label: 'The Ledger Spine', kicker: 'THE ROLL',
          comp: '.impeccable/mocks/decision/assigned.webp',
          wireframe: { regions: [{ label: 'rail', x: 0, y: 0, w: 3, h: 10 }, { label: 'rows', x: 3, y: 0, w: 9, h: 10 }] },
        },
      ],
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      assert.equal(await page.$('.media.comp-pending'), null, 'code-led serves no shimmer');
      assert.ok(await page.$('.media.wire'), 'code-led serves the wireframe');
      await page.click('.bp-opt[data-bp="comp"]');
      await page.waitForSelector('#bp-confirm:not([hidden])');
      assert.equal(await page.$('.media.comp-pending'), null, 'nothing renders before the flip is confirmed');
      await page.click('#bp-confirm [data-confirm]');
      await page.waitForSelector('.media.comp-pending');
      const flipped = await waitLoop(cwd, key, { poll: 10 });
      assert.equal(flipped.code, 0, flipped.out);
      assert.match(flipped.out, /BUILD PATH FLIPPED: comp/, 'the flip surfaces through --wait');
      assert.doesNotMatch(flipped.out, /ANSWER:/, 'a flip is not an answer');
      // The agent generates the comp; the shimmer swaps for it.
      mkdirSync(path.join(cwd, '.impeccable', 'mocks', 'decision'), { recursive: true });
      makeFakeImage(path.join(cwd, '.impeccable', 'mocks', 'decision'), 'ledger spine comp', 'assigned.webp');
      await page.waitForSelector('.card[data-id="assigned"] .media img.comp:not([hidden])', { timeout: 15000 });
      await page.click('.card[data-id="assigned"] .face.front button.choose');
      const collected = await waitLoop(cwd, key, { poll: 10 });
      await context.close();
      assert.equal(collected.code, 0, collected.out);
      const answer = JSON.parse(collected.out.match(/ANSWER: (\{.*\})/)[1]);
      assert.equal(answer.buildPath, 'comp', 'the answer carries the flipped path');
      assert.equal(answer.buildPathFlipped, true, 'the answer marks the flip');
      assert.match(collected.out, /BUILD PATH: comp \(flipped/, 'the directive states session-only scope');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // The flip used to be tested only on a wireframe card, where the schematic
  // is hidden and a fresh slot inserted. A card carrying catalog art instead
  // took the other branch: the inspiration stayed the face and the comp slot
  // was inserted below it, so the card showed two stacked images. Comp-first
  // demotes the inspiration to the corner, and a flip has to reach the same
  // shape a comp-first render would have served.
  it('(f2) flipping to comp demotes an inspiration face to the corner instead of stacking a second slot', async () => {
    const cwd = makeWorkspace();
    const key = 'flipinspo';
    const hero = makeFakeImage(cwd, 'catalog inspiration', 'inspo.png');
    const payload = {
      title: 'Choose the visual world',
      buildPath: { value: 'code', toggle: true },
      options: [
        {
          id: 'assigned', label: 'The Ledger Spine', kicker: 'THE ROLL', hero,
          comp: '.impeccable/mocks/decision/assigned.webp',
          viewport: 'A ruled masthead over a dense grid.', risk: 'Reads editorial.',
        },
      ],
    };
    const { url } = await startDaemon(cwd, payload, key);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });

      const front = '.card[data-id="assigned"] .face.front';
      // Code-led: the catalog art is the face, labeled so it never reads as a promise.
      assert.equal(await page.$$eval(`${front} .media`, (els) => els.length), 1, 'one media slot before the flip');
      assert.ok(await page.$(`${front} .media .media-label`), 'the inspiration face is labeled');
      assert.equal(await page.$(`${front} .pip`), null, 'no corner inspiration while code-led');

      await page.click('.bp-opt[data-bp="comp"]');
      await page.waitForSelector('#bp-confirm:not([hidden])');
      await page.click('#bp-confirm [data-confirm]');
      await page.waitForSelector(`${front} .media.comp-pending`);

      // The whole point: one slot, not two.
      assert.equal(await page.$$eval(`${front} .media`, (els) => els.length), 1,
        'the flip converts the inspiration slot rather than stacking a second one');
      assert.ok(await page.$(`${front} .media.comp-pending .pip img`), 'the inspiration moved into the corner');
      assert.equal(await page.$(`${front} .media > .media-label`), null, 'it is no longer presented as the face');
      assert.ok(await page.$(`${front} .media .chip.expand`), 'the converted slot keeps its expand affordance');

      const flipped = await waitLoop(cwd, key, { poll: 10 });
      assert.match(flipped.out, /BUILD PATH FLIPPED: comp/);

      // A comp that streams in must be openable. The zoom handlers used to be
      // bound once at deal time, so anything built by the flip was inert.
      mkdirSync(path.join(cwd, '.impeccable', 'mocks', 'decision'), { recursive: true });
      makeFakeImage(path.join(cwd, '.impeccable', 'mocks', 'decision'), 'ledger spine comp', 'assigned.webp');
      await page.waitForSelector(`${front} .media img.comp:not([hidden])`, { timeout: 15000 });
      await page.click(`${front} .media .chip.expand`);
      await page.waitForSelector('#lightbox:not([hidden])');
      const compSrc = await page.$eval('#lightbox img', (img) => img.getAttribute('src'));
      assert.ok(compSrc, 'the streamed-in comp opens full screen');
      await page.click('#lightbox');
      await page.waitForSelector('#lightbox', { state: 'hidden' });

      // The corner inspiration opens the catalog art, not the comp behind it.
      // Both zoom targets are delegated to document, where stopPropagation
      // cannot stop a sibling listener, so split handlers let the media one
      // overwrite the lightbox the pip had just filled.
      const cornerSrc = await page.$eval(`${front} .media .pip img`, (img) => img.getAttribute('src'));
      await page.click(`${front} .media .pip`);
      await page.waitForSelector('#lightbox:not([hidden])');
      const pipSrc = await page.$eval('#lightbox img', (img) => img.getAttribute('src'));
      assert.notEqual(pipSrc, compSrc, 'the corner opens the inspiration, not the comp');
      assert.equal(pipSrc, cornerSrc, 'and it is exactly the art in the corner');
      await page.click('#lightbox');
      await page.waitForSelector('#lightbox', { state: 'hidden' });

      // Flipping back keeps a comp that already landed, by design, and must
      // still leave exactly one slot. exitComp is synchronous, so there is
      // nothing to wait for.
      await page.click('.bp-opt[data-bp="code"]');
      assert.equal(await page.$$eval(`${front} .media`, (els) => els.length), 1, 'still one slot after flipping back');
      assert.ok(await page.$(`${front} .media img.comp:not([hidden])`), 'the landed comp survives the flip back');
      await context.close();
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(g) a wireframe card draws its schematic in the media slot and keeps its full read on the front', async () => {
    const cwd = makeWorkspace();
    const key = 'wire';
    const payload = {
      title: 'Choose the structure',
      options: [
        {
          id: 'assigned', label: 'The Ledger Spine', kicker: 'THE ROLL',
          viewport: 'An alphabetical spine with a sticky category rail.',
          wireframe: { cols: 12, rows: 10, regions: [
            { label: 'category rail', x: 0, y: 0, w: 3, h: 10, accent: true },
            { label: 'ledger rows', x: 3, y: 0, w: 9, h: 10 },
          ] },
        },
        { id: 'alt', label: 'The Switchboard', wireframe: { regions: [{ label: 'board', x: 0, y: 0, w: 12, h: 10 }] } },
      ],
      reroll: true,
      steer: true,
    };
    await startDaemon(cwd, payload, key);
    const state = JSON.parse(readFileSync(path.join(cwd, '.impeccable', 'questions', `${key}.state.json`), 'utf8'));
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(state.url, { waitUntil: 'load' });
      const regions = await page.$$eval('.card[data-id="assigned"] .wire-region', (els) => els.length);
      const accent = await page.$('.card[data-id="assigned"] .wire-region.accent');
      const back = await page.$('.card[data-id="assigned"] .face.back');
      const front = await page.$eval('.card[data-id="assigned"] .face.front', (el) => el.textContent);
      await context.close();
      assert.equal(regions, 2, 'both wireframe regions render');
      assert.ok(accent, 'the accent region carries its class');
      assert.equal(back, null, 'a wireframe card has no back; the full read stays on the front');
      assert.match(front, /alphabetical spine/, 'the front keeps the full read beside the schematic');
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
          viewport: 'A ruled manifest.', case: 'Back facts must stay reachable.',
          // Port 1 refuses connections everywhere; the load fails offline
          // and deterministically, like a retired catalog URL in the field.
          hero: 'http://127.0.0.1:1/gone-hero.webp',
        },
        {
          id: 'challenger-bare', label: 'No Palette Direction',
          thesis: 'Broken art and no swatches to paint from.',
          hero: 'http://127.0.0.1:1/gone-too.webp',
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
      await page.waitForSelector('.card[data-id="challenger-bare"] .media.unavailable');
      const imgGone = await page.$('.card[data-id="assigned"] .media img');
      const label = await page.$eval('.card[data-id="assigned"] .media .media-label', (el) => el.textContent);
      const field = await page.$eval('.card[data-id="assigned"] .media', (el) => el.style.background);
      // The stale "Inspiration" tooltip goes with the art it described.
      const title = await page.$eval('.card[data-id="assigned"] .media', (el) => el.getAttribute('title'));
      // The scrim must not trap the flip controls: Details still flips.
      await page.click('.card[data-id="assigned"] .chip.flip');
      const flipped = await page.$('.card[data-id="assigned"].flipped');
      // A palette-less card keeps the label and leans on the CSS graphite
      // field instead of an inline gradient.
      const bareLabel = await page.$eval('.card[data-id="challenger-bare"] .media .media-label', (el) => el.textContent);
      const bareField = await page.$eval('.card[data-id="challenger-bare"] .media', (el) => el.style.background);
      await context.close();
      assert.equal(imgGone, null, 'the broken img is removed');
      assert.equal(label, 'artwork unavailable', 'the slot says what happened');
      assert.match(field, /linear-gradient/, 'the slot is painted from the card palette');
      assert.equal(title, null, 'the inspiration tooltip is removed with the art');
      assert.ok(flipped, 'the Details chip still flips the card under the scrim');
      assert.equal(bareLabel, 'artwork unavailable', 'a palette-less slot still says what happened');
      assert.equal(bareField, '', 'a palette-less slot takes the CSS fallback field, no inline gradient');
    } finally {
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(g) a server that dies mid-shuffle stops the poll and names the failure', async () => {
    const cwd = makeWorkspace();
    const key = 'gonemid';
    const payload = {
      title: 'Choose the visual world',
      options: [
        { id: 'assigned', label: 'First Hand', kicker: 'THE ROLL' },
        { id: 'challenger-a', label: 'Alt One' },
      ],
      reroll: true, steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.click('#reroll');
      await page.waitForSelector('.card.skeleton');
      // Collect the re-roll answer, then kill the daemon out from under the
      // still-open page: the poll must stop and say the server is gone
      // instead of spinning skeletons forever.
      const first = await waitLoop(cwd, key);
      assert.match(first.out, /"optionId":"reroll"/);
      await run(['--stop', '--key', key], cwd);
      await page.waitForSelector('.stall', { timeout: 30000 });
      const text = await page.$eval('.stall', (el) => el.textContent);
      assert.match(text, /The question server went away/);
      assert.ok(await page.$('.stall .choose'), 'a way out is offered');
    } finally {
      await context.close();
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(h) a round nobody delivers stops the poll at the deadline and says so', async () => {
    const cwd = makeWorkspace();
    const key = 'nodeal';
    const payload = {
      title: 'Choose the visual world',
      options: [{ id: 'assigned', label: 'First Hand', kicker: 'THE ROLL' }],
      reroll: true, steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      // Fake the page clock so the 10-minute delivery deadline is reachable;
      // the server keeps its real clock, so its own idle grace never fires.
      await page.clock.install();
      let beats = 0;
      page.on('request', (r) => { if (r.url().endsWith('/heartbeat')) beats += 1; });
      await page.goto(url, { waitUntil: 'load' });
      // Playwright actionability waits on rAF, which the fake clock owns, so
      // dispatch the click directly.
      await page.$eval('#reroll', (el) => el.click());
      // Walk the fake clock forward past the fly-out settle and the deadline.
      // page.$ runs over CDP, not in-page timers, so it stays safe to poll.
      let stalled = null;
      for (let i = 0; i < 40 && !stalled; i++) {
        await page.clock.fastForward(20000);
        await new Promise((r) => setTimeout(r, 100));
        stalled = await page.$('.stall');
      }
      assert.ok(stalled, 'the poll stops at the deadline instead of spinning forever');
      const text = await page.$eval('.stall', (el) => el.textContent);
      assert.match(text, /The next hand never arrived/);
      assert.ok(await page.$('.stall .choose'), 'a way out is offered');
      // The stalled page must also stop heartbeating: the beats are what keep
      // the daemon alive, so a stalled tab left open used to hold it past its
      // idle grace forever while --wait spun on WAITING.
      assert.ok(beats > 0, 'the heartbeat counter observes beats before the stall');
      const beatsAtStall = beats;
      await page.clock.fastForward(60000);
      await new Promise((r) => setTimeout(r, 750));
      assert.equal(beats, beatsAtStall, 'no heartbeat fires after the stall, so the idle grace can reclaim the daemon');
      // Reload must not revive the abandoned flow: with no hand delivered it
      // stays on the silent stall screen and says so, rather than re-serving
      // the unresolved round with a fresh heartbeat.
      await page.$eval('.stall .choose', (el) => el.click());
      // Poll over CDP, not in-page waiters: the fake clock owns rAF.
      let msg = '';
      for (let i = 0; i < 50 && !/Still nothing to deal/.test(msg); i++) {
        await new Promise((r) => setTimeout(r, 100));
        msg = await page.$eval('.stall p', (el) => el.textContent);
      }
      assert.match(msg, /Still nothing to deal/, 'the stall says a reload found nothing');
      await page.clock.fastForward(30000);
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(beats, beatsAtStall, 'a reload attempt with nothing to deal leaves the page silent');
      // A browser-native refresh bypasses the gated button entirely, so the
      // server serves the page in waiting mode: the refresh re-enters the
      // bounded shuffle wait (beating while it waits, like any live wait)
      // rather than resurrecting the answered cards with an unbounded
      // heartbeat -- and the deadline silences it all over again.
      await page.reload({ waitUntil: 'load' });
      let waitingAgain = null;
      for (let i = 0; i < 50 && !waitingAgain; i++) {
        await new Promise((r) => setTimeout(r, 100));
        waitingAgain = await page.$('.card.skeleton');
      }
      assert.ok(waitingAgain, 'a native refresh mid re-roll re-enters the shuffle wait, not the answered round');
      let restalled = null;
      for (let i = 0; i < 40 && !restalled; i++) {
        await page.clock.fastForward(20000);
        await new Promise((r) => setTimeout(r, 100));
        restalled = await page.$('.stall');
      }
      assert.ok(restalled, 'the refreshed wait still ends at the deadline');
      const beatsAtSecondStall = beats;
      await page.clock.fastForward(30000);
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(beats, beatsAtSecondStall, 'the refreshed page goes silent again at its own deadline');
      // Once a hand actually lands, the stalled page's beat-free watch deals
      // it on its own, no click owed, and the heartbeat legitimately resumes:
      // a live round is not an abandoned flow.
      const nextPayloadPath = path.join(cwd, 'next.json');
      writeFileSync(nextPayloadPath, JSON.stringify({
        title: 'Choose the visual world',
        options: [{ id: 'assigned', label: 'Second Hand', kicker: 'RE-ROLLED' }],
        reroll: true, steer: true,
      }));
      const updated = await run(['--update', '--key', key, '--payload', nextPayloadPath], cwd);
      assert.equal(updated.code, 0, updated.out);
      let dealt = null;
      for (let i = 0; i < 50 && !dealt; i++) {
        await page.clock.fastForward(2000);
        await new Promise((r) => setTimeout(r, 100));
        dealt = await page.$('button.choose');
      }
      assert.ok(dealt, 'the stalled page notices the delivered hand on its own and deals it');
      const label = await page.$eval('.card', (el) => el.textContent);
      assert.match(label, /Second Hand/, 'reload with a delivered hand serves the new round');
      assert.ok(beats > beatsAtSecondStall, 'the heartbeat resumes on the re-dealt round');
    } finally {
      await context.close();
      await stopDaemon(cwd, key);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(i) Build this against a dead server fails loudly instead of confirming', async () => {
    const cwd = makeWorkspace();
    const key = 'deadpick';
    const payload = {
      title: 'Choose the visual world',
      options: [{ id: 'assigned', label: 'First Hand', kicker: 'THE ROLL' }],
      reroll: true, steer: true,
    };
    const { url } = await startDaemon(cwd, payload, key);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('button.choose');
      await run(['--stop', '--key', key], cwd);
      await page.click('button.choose');
      await page.waitForSelector('.done', { timeout: 15000 });
      const text = await page.$eval('.done', (el) => el.textContent);
      assert.match(text, /went away before this choice could land/);
      assert.doesNotMatch(text, /Choice recorded/);
    } finally {
      await context.close();
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
