#!/usr/bin/env node
/**
 * Visual question server: present a decision to the user as a themed page
 * instead of a plain-text prompt, then block until they answer.
 *
 * The script IS the wait: run it via the shell, it serves the page, prints
 * the URL (and tries to open the default browser), and does not exit until
 * the user chooses. The answer lands on stdout as one line:
 *
 *   ANSWER: {"optionId":"...","steer":"..."}
 *
 * Exit codes: 0 answered · 2 timed out, closed without answering, or no
 * browser is available (IMPECCABLE_QUESTION_DISABLED, or a detected
 * CI/headless/remote environment; IMPECCABLE_QUESTION_FORCE=1 overrides
 * detection, --no-open skips it since the caller opens the URL itself).
 *
 * Payload (JSON file via --payload, or stdin):
 * {
 *   "title": "Choose the visual world",
 *   "question": "The roll assigned Fillmore Handbill. Keep it, take an alternate, or re-roll.",
 *   "options": [
 *     {
 *       "id": "assigned",                  // returned verbatim
 *       "label": "Fillmore Handbill",
 *       "kicker": "THE ROLL",              // optional badge; the assigned option leads
 *       "lineage": "1966-71 Fillmore ...", // optional
 *       "thesis": "one line: the idea this direction owns",       // optional
 *       "palette": ["#1a2f5e", "oklch(84% .19 80)", ...],         // optional, rendered as chips
 *       "materials": ["letterpress", "newsprint"],                // optional, rendered as tags
 *       "viewport": "one line: the first-viewport composition",   // optional
 *       "case": "one line: the fusion verdict, honest",           // optional
 *       "risk": "one line: the honest risk",                      // optional
 *       "body": "fallback prose when the structured fields are absent",
 *       "sketch": ".impeccable/sketches/assigned.webp",  // optional; may not exist
 *                                // yet: the page shimmer-waits and polls the
 *                                // slot until the file lands, so serve first
 *                                // and generate after
 *       "hero": "https://... or /abs/path.webp",   // optional inspiration image;
 *                                // rides picture-in-picture when a sketch exists
 *       "board": "https://... or /abs/path.webp"   // optional secondary image
 *     }, ...
 *   ],
 *   "reroll": true,          // adds a re-roll action (returns {"optionId":"reroll"})
 *   "canon": true,           // adds the "Play it straight" standing exit;
 *                            // direction rounds only (returns {"optionId":"canon"})
 *   "canonCard": { ... },    // optional: the standing exit as a full card with the
 *                            // same anatomy (label, thesis, palette, sketch, ...);
 *                            // rendered last and visually subordinate. Without it,
 *                            // canon stays a quiet footer action.
 *   "steer": true            // adds a free-text steer field returned with any answer
 * }
 *
 * Options render as large cards: the sketch leads when present, with the
 * inspiration image picture-in-picture; a hero alone renders full-bleed; a
 * text-only direction gets its identity from the palette chips and tags.
 * Local image paths are served by this server; nothing is uploaded anywhere.
 *
 * Modes:
 *   (default)  block until answered; ANSWER on stdout; exit 0.
 *   --schema   print the canonical payload example and exit.
 *   --start    for harnesses that cannot leave a shell blocked: daemonize the
 *              server, print QUESTION URL + QUESTION KEY, exit immediately.
 *              Never auto-opens a browser: the agent routes the URL to the
 *              best surface it has (in-app browser first, then the system
 *              opener); pass --open to force the system browser instead.
 *   --wait --key K [--poll 60]   poll for the answer: exit 0 + ANSWER line,
 *              exit 3 WAITING (run --wait again), exit 2 server gone,
 *              exit 4 PAGE CLOSED (the tab went away without an answer;
 *              re-present, reopen the URL, or fall back).
 *   --stop --key K               kill a daemonized question.
 *   --update --key K --payload F deliver the next hand after a re-roll: the
 *              live page swaps to loading cards when the user re-rolls, and
 *              reloads into this new payload the moment it lands. Always the
 *              same key the round started with; a second --start serves a new
 *              URL and strands the open tab on a hand that never arrives.
 *
 * --timeout bounds the wait for a page to arrive, never the user's decision:
 * once the page heartbeats, the server lives while the page does, and exits
 * only after --idle-grace seconds (default 600) pass with no beat, wide
 * enough to survive a closed laptop lid mid-decision.
 *
 *   node serve-question.mjs --payload question.json [--timeout 900] [--idle-grace 600] [--no-open] [--port 0]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openSystemBrowser } from './lib/open-system-browser.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

if (process.env.IMPECCABLE_QUESTION_DISABLED) {
  console.log('serve-question: disabled in this session (no browser); use the structured question tool instead.');
  process.exit(2);
}
// Headless self-detection, applied only where a browser is actually wanted.
// --no-open means the caller opens the URL itself, and --wait / --stop /
// --schema / --update never open anything: --wait polls a daemon whose
// browser question was already settled at --start, --stop kills one,
// --schema prints text, and --update hands the next round to a page that is
// already open. A spurious exit 2 from those breaks the documented loop,
// which polls --wait while it exits 3, reads --schema before building a
// payload, and delivers re-rolled hands with --update.
const wantsBrowser = !hasFlag('no-open') && !hasFlag('wait') && !hasFlag('stop') && !hasFlag('schema') && !hasFlag('update');
if (wantsBrowser && !process.env.IMPECCABLE_QUESTION_FORCE) {
  const headless =
    process.env.CI ||
    (process.env.SSH_CONNECTION && !process.env.DISPLAY) ||
    (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);
  if (headless) {
    console.log('serve-question: no browser detected in this environment (CI/headless/remote); use the structured question tool instead. Set IMPECCABLE_QUESTION_FORCE=1 to serve anyway.');
    process.exit(2);
  }
}

// Both answer channels (blocking stdout and --wait collection) print through
// this: the ANSWER line, then a directive to open the chosen card's imagery
// when it has any. The card viewing happens at the moment of choice, in the
// working turn, because a build that never reopens the chosen world's board
// and hero calibrates on nothing.
function printAnswer(raw) {
  console.log(`ANSWER: ${raw}`);
  try {
    const a = JSON.parse(raw);
    if (a.hero || a.board) {
      console.log("CHOSEN CARD: open the chosen world's board and hero images now, before any code. When your harness only reads files, or runs sandboxed, download them INTO the workspace and open the relative path; a sandboxed viewer rejects absolute paths outside it. They set the craft bar the build must reach.");
    }
    if (a.sketch) {
      console.log('CHOSEN SKETCH: the decision sketch at that path may seed one comp probe; the comp round still renders its full set, because a sketch chose the direction, not the composition.');
    }
    if (a.optionId === 'canon') {
      console.log('CANON CHOSEN: the user picked the category standard on purpose. Ask once for two or three products this should sit alongside; their craft level becomes the quality bar. Execute the canon at full commitment, conventions embraced without irony or smuggled quirk.');
    }
  } catch { /* raw answer */ }
}

const payloadPath = arg('payload');
const timeoutSec = Number(arg('timeout', '900'));
// How long the server (and the page's own delivery deadline) outlive the
// last heartbeat; a zero, negative, or unparseable value takes the default.
const idleGraceArg = Number(arg('idle-grace', '600'));
const idleGraceMs = (Number.isFinite(idleGraceArg) && idleGraceArg > 0 ? idleGraceArg : 600) * 1000;
const portArg = Number(arg('port', '0'));
const QUESTION_DIR = path.join(process.cwd(), '.impeccable', 'questions');
const stateFile = (key) => path.join(QUESTION_DIR, `${key}.state.json`);
const answerFile = (key) => path.join(QUESTION_DIR, `${key}.answer.json`);

if (hasFlag('schema')) {
  console.log(JSON.stringify({
    title: 'Choose the visual world',
    question: 'The roll assigned Fillmore Handbill. Keep it, take an alternate, or re-roll.',
    options: [
      { id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL', lineage: '1966-71 Fillmore psychedelic handbills', thesis: 'The gig poster that treats every release like a one-night stand.', palette: ['#e8452c', '#f5d64c', '#1b2a52', '#f3ead8'], materials: ['letterpress', 'split-fountain ink'], viewport: 'A full-bleed dated bill with the product name in warped display type.', risk: 'Reads nostalgic when the type is set timidly.', sketch: '.impeccable/sketches/assigned.webp', hero: 'https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill-hero.webp', board: 'https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill.webp' },
      { id: 'challenger-teletext', label: 'Teletext Service', lineage: 'broadcast teletext magazines', thesis: 'The catalog as a broadcast index: pages, not sections.', case: 'Fuses cleanly: releases map to numbered pages.', sketch: '.impeccable/sketches/challenger-teletext.webp', hero: 'https://impeccable.style/worlds/cards/broadcast-programming-teletext-service-hero.webp' },
    ],
    reroll: true,
    canon: true,
    canonCard: { label: 'The category standard', thesis: 'What this category ships, executed impeccably.', viewport: 'The arrangement a visitor expects, at full craft.', sketch: '.impeccable/sketches/canon.webp' },
    steer: true,
  }, null, 2));
  console.log('\nOption ids return verbatim in ANSWER; "reroll" and "canon" are reserved. hero/board/sketch accept URLs or local paths; sketch slots may point at files that do not exist yet (serve first, generate after; the page polls until they land, so never block serving on generation). hero on a challenger is the inspiration it draws from and renders picture-in-picture beside the sketch, never as the promise of the build. canonCard renders the standing exit as a subordinate card with the same anatomy; without it, canon stays a quiet footer action. Include canon only for visual-direction rounds; never present it as your own recommendation. Keep thesis and each fact to one short sentence: the card front shows thesis, identity, and a two-line risk, while first viewport and the case read on the card back behind the Details chip, so long facts cost the reader a flip, not the page its scanability. A card with no imagery at all has no back; its full read renders on the front, so a text-only round loses nothing. Sketch aspect follows the surface: portrait at device viewport for native or mobile-first surfaces, landscape otherwise; the page adapts its cards to either.');
  process.exit(0);
}

if (hasFlag('wait')) {
  const key = arg('key');
  if (!key) { console.error('serve-question: --wait needs --key'); process.exit(1); }
  const pollSec = Number(arg('poll', '60'));
  const deadline = Date.now() + pollSec * 1000;
  const answered = () => fs.existsSync(answerFile(key));
  // Liveness must survive sandboxes: a sandboxed --wait cannot signal the
  // daemon (kill throws EPERM even for a living process), so a fresh page
  // heartbeat in the state file is the primary proof of life, the kill probe
  // is secondary, and EPERM specifically means "exists, but the sandbox
  // blocks signals", never "dead". Treating EPERM as death told one session
  // the user had walked away while they were still reading the board.
  const alive = () => {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
      if (state.lastBeat && Date.now() - state.lastBeat < 12000) return true;
      try { process.kill(state.pid, 0); return true; }
      catch (err) { return err.code === 'EPERM'; }
    } catch { return false; }
  };
  let sawClose = false;
  while (Date.now() < deadline) {
    if (answered()) break;
    if (!alive()) {
      console.log('serve-question: the question server is gone with no answer. This is a server failure, not a user decision: restart it with --start and the same payload, reopen the URL for the user, and wait again. Never proceed without their choice while their browser session is open.');
      process.exit(2);
    }
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
      if (state.lastBeat && Date.now() - state.lastBeat > 15000) { sawClose = true; break; }
    } catch { /* state mid-write */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (sawClose && !answered()) {
    console.log('PAGE CLOSED: the question page went away without an answer; re-present, reopen the URL, or fall back to the structured question tool');
    process.exit(4);
  }
  if (!answered()) { console.log(`WAITING: no answer yet after ${pollSec}s; run --wait --key ${key} again`); process.exit(3); }
  const collected = fs.readFileSync(answerFile(key), 'utf8').trim();
  printAnswer(collected);
  // A re-roll keeps the table open: the server stays alive awaiting --update,
  // so only the answer file is consumed. Terminal choices clean up fully.
  let isRerollAnswer = false;
  try { isRerollAnswer = JSON.parse(collected).optionId === 'reroll'; } catch { /* treat as terminal */ }
  try { fs.rmSync(answerFile(key)); } catch { /* already gone */ }
  if (!isRerollAnswer) { try { fs.rmSync(stateFile(key)); } catch { /* already gone */ } }
  process.exit(0);
}

if (hasFlag('stop')) {
  const key = arg('key');
  if (!key) { console.error('serve-question: --stop needs --key'); process.exit(1); }
  try { process.kill(JSON.parse(fs.readFileSync(stateFile(key), 'utf8')).pid); } catch { /* dead already */ }
  try { fs.rmSync(answerFile(key)); } catch {}
  try { fs.rmSync(stateFile(key)); } catch {}
  console.log('stopped');
  process.exit(0);
}

if (hasFlag('update')) {
  const key = arg('key');
  if (!key || !payloadPath) { console.error('serve-question: --update needs --key and --payload'); process.exit(1); }
  JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  // Liveness mirrors --wait: a fresh page heartbeat is the primary proof, the
  // kill probe is secondary, and EPERM means a sandbox blocked the signal,
  // never a dead server. This is the documented re-roll delivery step, so a
  // false "no live server" here strands the page mid-shuffle.
  const live = (() => {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
      if (state.lastBeat && Date.now() - state.lastBeat < 12000) return true;
      try { process.kill(state.pid, 0); return true; }
      catch (err) { return err.code === 'EPERM'; }
    } catch { return false; }
  })();
  if (!live) { console.error('serve-question: no live question server for that key; the page it served is gone too. Re-present the round with --start and a fresh key, or fall back to the structured question tool.'); process.exit(2); }
  fs.copyFileSync(payloadPath, path.join(QUESTION_DIR, `${key}.next.json`));
  console.log('next round delivered; the page reloads itself');
  process.exit(0);
}

if (hasFlag('start')) {
  if (!payloadPath) { console.error('serve-question: --start needs --payload <file>'); process.exit(1); }
  JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  fs.mkdirSync(QUESTION_DIR, { recursive: true });
  const key = arg('key') || Math.random().toString(16).slice(2, 10);
  // In start mode the agent is alive and owns browser routing; the server
  // only opens the system browser itself when --open forces it.
  // The daemon's output lands in a per-key log so a startup failure can say
  // what actually went wrong instead of only that it did.
  const logFile = path.join(QUESTION_DIR, `${key}.log`);
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url), '--payload', payloadPath, '--detached-serve', '--key', key,
    '--timeout', String(timeoutSec), ...(arg('idle-grace') ? ['--idle-grace', arg('idle-grace')] : []),
    ...(hasFlag('open') ? [] : ['--no-open']),
  ], { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.closeSync(logFd);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !fs.existsSync(stateFile(key))) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(stateFile(key))) {
    let tail = '';
    try { tail = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-4).join('\n  '); } catch { /* log never written */ }
    console.error(`serve-question: server failed to start${tail ? `\n  ${tail}` : ''}`);
    console.error(`serve-question: log at ${path.relative(process.cwd(), logFile) || logFile}. A sandboxed exec that cannot listen on localhost causes exactly this; rerun this command once through the harness's network-enabled or unsandboxed command tool before falling back.`);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
  console.log(`QUESTION URL: ${state.url}`);
  console.log(`QUESTION KEY: ${key}`);
  console.log('Open the URL for the user now: in-app browser when the harness has one, otherwise the system opener (macOS `open`, Linux `xdg-open`), otherwise show the URL.');
  console.log(`Then collect the answer with: node ${fileURLToPath(import.meta.url)} --wait --key ${key}`);
  process.exit(0);
}

let raw;
if (payloadPath) raw = fs.readFileSync(payloadPath, 'utf8');
else raw = fs.readFileSync(0, 'utf8');

// Round state is mutable: a re-roll keeps this server alive and --update
// swaps in the next hand, so payload, options, and the local-image table
// rebuild per round.
let payload;
let options;
let localImages = [];

function loadRound(json) {
  const parsed = JSON.parse(json);
  if (!parsed || !Array.isArray(parsed.options) || parsed.options.length === 0) {
    throw new Error('payload needs an options array');
  }
  localImages = [];
  const imageSrc = (value) => {
    if (!value) return null;
    if (/^https?:\/\//.test(value)) return value;
    const abs = path.resolve(value);
    if (!fs.existsSync(abs)) return null;
    localImages.push(abs);
    return `/img/${localImages.length - 1}`;
  };
  // Sketches stream in after the page is served, so their slots register
  // whether or not the file exists yet; /img answers 404 until it lands and
  // the page polls the slot. Remote sketch URLs pass through untouched.
  const sketchSrc = (value) => {
    if (!value) return null;
    if (/^https?:\/\//.test(value)) return value;
    localImages.push(path.resolve(value));
    return `/img/${localImages.length - 1}`;
  };
  payload = parsed;
  const decorate = (option) => ({
    ...option,
    heroSrc: imageSrc(option.hero),
    boardSrc: imageSrc(option.board),
    sketchSrc: sketchSrc(option.sketch),
  });
  options = parsed.options.map(decorate);
  // The standing exit as a full card: same anatomy, reserved id, rendered
  // subordinate by the page. Without it, canon stays the quiet footer action.
  if (parsed.canonCard && typeof parsed.canonCard === 'object') {
    options = [...options, { ...decorate(parsed.canonCard), id: 'canon', isCanon: true }];
  }
}
try { loadRound(raw); } catch (error) { console.error(`serve-question: ${error.message}`); process.exit(1); }
const detachedKey = hasFlag('detached-serve') ? arg('key') : null;
const nextFile = () => detachedKey ? path.join(QUESTION_DIR, `${detachedKey}.next.json`) : null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page() {
  const flipChip = (label) => `<button type="button" class="chip flip" aria-label="Flip the card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 5.5V12h6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label}</span></button>`;
  const expandChip = `<button type="button" class="chip expand" aria-label="Expand the image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  // Structured anatomy: chips and one-line facts render when the payload
  // carries them; a plain body falls back to the prose block. Palette chips
  // and material tags give a text-only direction an immediate identity that
  // no generation luck can distort.
  const fact = (label, value, cls = '') => value ? `<p class="fact${cls ? ` ${cls}` : ''}"><span class="fact-label">${label}</span>${esc(value)}</p>` : '';
  const hasMedia = (option) => Boolean(option.sketchSrc || option.heroSrc || option.boardSrc);
  // The back exists to keep long facts off a card whose front is an image;
  // a card with no art has no flip chip to reach it, so it gets no back and
  // the full read lives on the front instead.
  const hasBack = (option) => hasMedia(option) && Boolean(option.viewport || option.case || (option.boardSrc && option.heroSrc));
  const anatomy = (option) => {
    const rows = [];
    if (option.thesis) rows.push(`<p class="thesis">${esc(option.thesis)}</p>`);
    const idBits = [];
    if (Array.isArray(option.palette) && option.palette.length) {
      idBits.push(`<span class="swatches">${option.palette.slice(0, 6).map((c) => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join('')}</span>`);
    }
    if (Array.isArray(option.materials) && option.materials.length) {
      idBits.push(option.materials.slice(0, 4).map((m) => `<span class="tag">${esc(m)}</span>`).join(''));
    }
    if (idBits.length) rows.push(`<div class="identity">${idBits.join('')}</div>`);
    // The front carries only what the choice needs: thesis, identity, and the
    // honest risk clamped to two lines. First viewport and the case read on
    // the card's back; once the sketch lands, the first viewport is a picture.
    // With no art there is no back, so the full read fills the room the
    // image would have taken.
    if (hasMedia(option)) {
      rows.push(fact('Risk', option.risk, 'clamp'));
    } else {
      rows.push(fact('First viewport', option.viewport));
      rows.push(fact('The case', option.case));
      rows.push(fact('Risk', option.risk));
    }
    if (!option.thesis && option.body) rows.push(`<p class="detail">${esc(option.body)}</p>`);
    else if (option.body && option.thesis && !hasBack(option)) rows.push(`<p class="detail more">${esc(option.body)}</p>`);
    return rows.join('\n            ');
  };
  const backFacts = (option) => [
    fact('First viewport', option.viewport),
    fact('The case', option.case),
    fact('Risk', option.risk),
    option.body && option.thesis ? `<p class="detail more">${esc(option.body)}</p>` : '',
  ].filter(Boolean).join('\n            ');
  const media = (option) => {
    const inspiration = option.heroSrc ? `<figure class="pip" title="Inspiration: the world this direction draws from. Your page will not look like this image.">
              <img src="${esc(option.heroSrc)}" alt="">
              <figcaption>inspiration</figcaption>
            </figure>` : '';
    const details = hasBack(option) ? flipChip('Details') : '';
    if (option.sketchSrc) {
      return `<div class="media sketching" data-sketch="${esc(option.sketchSrc)}">
            <div class="shimmer"><span class="sketch-note">sketching&hellip;</span></div>
            <img class="sketch" alt="" hidden>
            ${inspiration}
            <div class="chips">${expandChip}${details}</div>
          </div>`;
    }
    if (option.heroSrc || option.boardSrc) {
      // Without a sketch the catalog art is the card's face; it stays a
      // labeled reference so it never reads as the promise of the build.
      return `<div class="media" title="Inspiration: the world this direction draws from. Your page will not look like this image.">
            <img src="${esc(option.heroSrc || option.boardSrc)}" alt="">
            <p class="media-label">inspiration</p>
            <div class="chips">${expandChip}${details}</div>
          </div>`;
    }
    return '';
  };
  const cards = options.map((option, index) => `
    <article class="card${option.isCanon ? ' canon' : ''}" style="--fan:${index === 0 ? '0deg' : (index % 2 ? '1.4deg' : '-1.2deg')};--deal:${index * 90}ms" data-id="${esc(option.id)}">
      <div class="card-inner">
        <div class="face front${index === 0 ? ' lead' : ''}${media(option) ? '' : ' text-only'}">
          ${option.kicker ? `<span class="kicker">${esc(option.kicker)}</span>` : option.isCanon ? '<span class="kicker standing">The standing door</span>' : ''}
          ${media(option)}
          <div class="body">
            ${option.lineage ? `<p class="tier">${esc(option.lineage)}</p>` : ''}
            <h2>${esc(option.label)}</h2>
            ${anatomy(option)}
            <button class="choose" data-id="${esc(option.id)}">${option.isCanon ? 'Play it straight' : 'Build this'}</button>
          </div>
        </div>
        ${hasBack(option) ? `<div class="face back${index === 0 ? ' lead' : ''}">
          ${option.boardSrc ? `<div class="media back-media">
            <img src="${esc(option.boardSrc)}" alt="">
            <div class="chips">${expandChip}${flipChip('Front')}</div>
          </div>` : `<div class="back-head"><p class="tier">The full read &middot; ${esc(option.label)}</p>${flipChip('Front')}</div>`}
          <div class="body back-body">
            ${option.boardSrc ? `<p class="tier">The full read &middot; ${esc(option.label)}</p>` : ''}
            ${backFacts(option)}
            <button class="choose" data-id="${esc(option.id)}">${option.isCanon ? 'Play it straight' : 'Build this'}</button>
          </div>
        </div>` : ''}
      </div>
    </article>`).join('\n');
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(payload.title || 'impeccable · decision')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600&family=Alumni+Sans:wght@100;400&display=swap" rel="stylesheet">
<style>
  /* Neo kinpaku tokens, mirrored from impeccable.style kinpaku-tokens.css */
  :root {
    color-scheme: dark;
    --ks-kinpaku: oklch(84% 0.19 80.46);
    --ks-kinpaku-pale: oklch(86% 0.07 84);
    --ks-kinpaku-rich: oklch(77% 0.13 82);
    --ks-kinpaku-deep: oklch(61% 0.085 78);
    --ks-dark-ink: oklch(14% 0.018 95);
    --ks-patina: oklch(70% 0.12 188);
    --ks-lacquer: oklch(7% 0.006 95);
    --ks-lacquer-raised: oklch(11% 0.006 95);
    --ks-graphite: oklch(15% 0.008 95);
    --ks-graphite-2: oklch(19% 0.008 95);
    --ks-champagne: oklch(91% 0 0);
    --ks-text: oklch(88% 0 0);
    --ks-text-muted: oklch(72% 0 0);
    --ks-text-faint: oklch(62% 0 0);
    --ks-rule: oklch(78% 0 0 / 0.16);
    --ks-font-display: "Alumni Sans", "Albert Sans", Arial, sans-serif;
    --ks-font: "Albert Sans", "Avenir Next", "Helvetica Neue", Arial, system-ui, sans-serif;
    --ks-mono: "SFMono-Regular", "Roboto Mono", "JetBrains Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--ks-lacquer); color: var(--ks-text); font: 15px/1.55 var(--ks-font); padding: 1.8rem clamp(1rem, 5vw, 4rem) 2rem; min-height: 100dvh; display: flex; flex-direction: column; overflow-x: clip; }
  #ambient { position: fixed; inset: -40px; z-index: 0; background-size: cover; background-position: center; filter: blur(34px) saturate(1.05); opacity: 0; transition: opacity .55s ease, background-image .2s; pointer-events: none; }
  #scrim { position: fixed; inset: 0; z-index: 0; background: linear-gradient(180deg, oklch(7% 0.006 95 / 0.62), oklch(7% 0.006 95 / 0.78)); pointer-events: none; }
  header, main, footer { position: relative; z-index: 1; }
  #lightbox { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: oklch(4% 0.004 95 / 0.93); cursor: zoom-out; opacity: 0; transition: opacity .25s ease; }
  #lightbox[hidden] { display: none; }
  #lightbox.open { opacity: 1; }
  #lightbox img { max-width: 94vw; max-height: 94vh; border: 1px solid var(--ks-rule); border-radius: 8px; box-shadow: 0 30px 80px oklch(0% 0 0 / 0.6); }
  header { width: 100%; max-width: 90rem; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: .55rem; color: var(--ks-kinpaku); }
  .brand svg { width: 22px; height: 22px; }
  .wordmark { font-family: var(--ks-font-display); font-weight: 400; font-size: 1.125rem; letter-spacing: 0.15em; text-transform: uppercase; line-height: 1; color: var(--ks-kinpaku); }
  .headline { display: flex; align-items: center; gap: .9rem; }
  .headline-die { flex: none; width: 34px; height: 34px; color: var(--ks-kinpaku); }
  h1 { font-family: var(--ks-font-display); font-weight: 100; font-size: clamp(2.6rem, 5vw, 4.2rem); letter-spacing: -0.01em; line-height: 1.02; color: var(--ks-champagne); }
  .question { color: var(--ks-text-muted); margin-top: .7rem; max-width: 52rem; }
  main { flex: 1; display: flex; align-items: center; width: 100%; max-width: 90rem; margin: 0 auto; }
  .stage { width: 100%; display: flex; flex-direction: column; gap: 1.5rem; }
  /* The deck bleeds to the viewport edges while the first card aligns with the
     content column; a carousel cut off at an invisible container edge reads as
     a rendering bug, but one cut off at the screen edge reads as more cards. */
  .deck-shell { position: relative; width: 100vw; margin-left: calc(50% - 50vw); }
  /* One row in a wide viewport, one column in a tall one; the deck scrolls on
     its axis with snap points and the arrows page it card by card. */
  .grid { --deck-inset: max(clamp(1rem, 5vw, 4rem), calc((100vw - 90rem) / 2)); display: flex; gap: 1.6rem; width: 100%; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; padding: 6px var(--deck-inset); scroll-padding-inline: var(--deck-inset); align-items: stretch; }
  .grid::-webkit-scrollbar { display: none; }
  /* Wide enough that the sketch carries the card: at 27vw the imagery read
     as a thumbnail above a column of copy, and the copy won the attention
     contest the sketch is supposed to win. */
  .grid > .card { flex: 0 0 clamp(24rem, 34vw, 34rem); scroll-snap-align: center; }
  .nav { position: absolute; z-index: 6; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: oklch(7% 0.006 95 / 0.78); border: 1px solid var(--ks-rule); color: var(--ks-kinpaku); cursor: pointer; backdrop-filter: blur(6px); transition: border-color .2s, color .2s, opacity .2s; }
  .nav:hover { border-color: var(--ks-kinpaku-deep); color: var(--ks-kinpaku-pale); }
  .nav[disabled] { opacity: .25; cursor: default; }
  .nav[hidden] { display: none; }
  .nav svg { width: 16px; height: 16px; }
  .nav.prev { left: 14px; top: 50%; transform: translateY(-50%); }
  .nav.next { right: 14px; top: 50%; transform: translateY(-50%); }
  /* A side that hides more cards fades out; a hard edge means the end. */
  .fade { position: absolute; z-index: 5; pointer-events: none; opacity: 0; transition: opacity .3s ease; }
  .fade-prev { left: 0; top: 0; bottom: 0; width: 88px; background: linear-gradient(90deg, var(--ks-lacquer), transparent); }
  .fade-next { right: 0; top: 0; bottom: 0; width: 88px; background: linear-gradient(270deg, var(--ks-lacquer), transparent); }
  .deck-shell.can-prev .fade-prev { opacity: 1; }
  .deck-shell.can-next .fade-next { opacity: 1; }
  @media (max-aspect-ratio: 1/1) {
    .grid { flex-direction: column; overflow-x: hidden; overflow-y: auto; scroll-snap-type: y mandatory; max-height: min(68dvh, 44rem); scroll-padding-block: 6px; }
    .grid > .card { flex: 0 0 auto; }
    /* In the vertical deck the pager is the primary way forward, so it grows
       into a labeled pill instead of a bare chevron nobody notices. */
    .nav { width: auto; height: 38px; border-radius: 19px; padding: 0 16px; gap: 8px; border-color: var(--ks-kinpaku-deep); background: oklch(7% 0.006 95 / 0.88); font-family: var(--ks-mono); font-size: .62rem; letter-spacing: .2em; text-transform: uppercase; }
    .nav svg { transform: rotate(90deg); }
    .nav.prev::after { content: "Back"; }
    .nav.next::after { content: "More"; }
    .nav.prev { left: 50%; top: 6px; transform: translate(-50%, 0); }
    .nav.next { right: auto; left: 50%; top: auto; bottom: 6px; transform: translate(-50%, 0); }
    .fade-prev { top: 0; left: 0; right: 0; bottom: auto; width: auto; height: 72px; background: linear-gradient(180deg, var(--ks-lacquer), transparent); }
    .fade-next { top: auto; left: 0; right: 0; bottom: 0; width: auto; height: 72px; background: linear-gradient(0deg, var(--ks-lacquer), transparent); }
  }
  .card { position: relative; perspective: 1400px; transform: rotate(var(--fan, 0deg)); transition: transform .25s cubic-bezier(.16, 1, .3, 1); }
  .card:hover { transform: rotate(0deg) translateY(-4px); }
  .card-inner { position: relative; height: 100%; transform-style: preserve-3d; transition: transform .7s cubic-bezier(.16, 1, .3, 1); }
  .card.flipped .card-inner { transform: rotateY(180deg); }
  .face { background: var(--ks-lacquer-raised); border: 1px solid var(--ks-rule); border-radius: 10px; box-shadow: 0 18px 40px oklch(0% 0 0 / 0.35); overflow: hidden; display: flex; flex-direction: column; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
  .face.front { position: relative; height: 100%; }
  .face.back { position: absolute; inset: 0; transform: rotateY(180deg); }
  /* Only the visible face is interactive: a hidden backface still hit-tests
     in Chrome, so the front's pip would otherwise sit invisibly over the
     back's chips, showing its zoom cursor and eating the flip-back click. */
  .face.back { pointer-events: none; }
  .card.flipped .face.back { pointer-events: auto; }
  .card.flipped .face.front { pointer-events: none; }
  .face.lead { border-color: var(--ks-kinpaku); box-shadow: 0 0 0 1px var(--ks-kinpaku), 0 18px 40px oklch(0% 0 0 / 0.45); }
  .card:hover .face { border-color: var(--ks-kinpaku-deep); }
  .card:hover .face.lead { border-color: var(--ks-kinpaku); }
  @media (prefers-reduced-motion: reduce) { .card-inner { transition: none; } }
  .kicker { position: absolute; z-index: 2; top: 12px; left: 12px; padding: 4px 10px; background: var(--ks-kinpaku); color: var(--ks-dark-ink); font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .24em; text-transform: uppercase; border-radius: 4px; }
  /* Text-only card: a grounded direction with no rendered card drops the media
     region entirely instead of reserving a blank 16:9 void. */
  .face.text-only .kicker { position: static; align-self: flex-start; margin: 14px 0 0 14px; }
  .face.text-only .body { padding-top: 12px; }
  /* 16/10 matches the landscape sketch frame; portrait art overrides the
     slot with its own exact ratio at load (see the load listener), and the
     deck narrows so portrait cards line up side by side. */
  .media { position: relative; width: 100%; aspect-ratio: 16/10; flex: none; }
  .grid.portrait-media > .card { flex-basis: clamp(14rem, 19vw, 19rem); }
  .media img { width: 100%; height: 100%; object-fit: cover; display: block; background: linear-gradient(100deg, var(--ks-graphite) 40%, var(--ks-graphite-2) 50%, var(--ks-graphite) 60%); }
  .media > img:not([hidden]) { cursor: zoom-in; }
  .face.back { background: var(--ks-lacquer-raised); }
  .back-bar { margin-top: auto; background: var(--ks-lacquer-raised); }
  .hero-blank { width: 100%; height: 100%; background: linear-gradient(100deg, var(--ks-graphite) 40%, var(--ks-graphite-2) 50%, var(--ks-graphite) 60%); }
  .back-bar { flex: none; flex-direction: row; align-items: center; justify-content: space-between; gap: .8rem; }
  .chips { position: absolute; z-index: 1; right: 10px; bottom: 10px; display: flex; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .18em; text-transform: uppercase; color: var(--ks-text); background: oklch(7% 0.006 95 / 0.72); border: 1px solid var(--ks-rule); border-radius: 5px; cursor: pointer; backdrop-filter: blur(4px); transition: color .2s, border-color .2s; }
  .chip:hover { color: var(--ks-kinpaku); border-color: var(--ks-kinpaku-deep); }
  .chip svg { width: 12px; height: 12px; }
  .body { padding: .95rem 1.1rem 1.2rem; display: flex; flex-direction: column; gap: .5rem; flex: 1; }
  .tier { font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .24em; text-transform: uppercase; color: var(--ks-text-faint); }
  h2 { font-family: var(--ks-font); font-size: 1.125rem; font-weight: 500; line-height: 1.35; color: var(--ks-champagne); }
  .detail { color: var(--ks-text-muted); font-size: .88rem; white-space: pre-wrap; }
  .detail.more { font-size: .8rem; color: var(--ks-text-faint); }
  .thesis { color: var(--ks-text); font-size: .95rem; line-height: 1.45; }
  .identity { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 2px 0; }
  .swatches { display: inline-flex; gap: 4px; margin-right: 4px; }
  .swatches i { width: 18px; height: 18px; border-radius: 5px; border: 1px solid oklch(100% 0 0 / 0.18); box-shadow: inset 0 0 0 1px oklch(0% 0 0 / 0.25); }
  .tag { font-family: var(--ks-mono); font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--ks-text-muted); border: 1px solid var(--ks-rule); border-radius: 4px; padding: 3px 7px; }
  .fact { font-size: .8rem; color: var(--ks-text-muted); line-height: 1.45; }
  .fact-label { display: inline-block; font-family: var(--ks-mono); font-size: .6rem; letter-spacing: .18em; text-transform: uppercase; color: var(--ks-text-faint); margin-right: .55em; transform: translateY(-1px); }
  .fact.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  /* The back is the full read: first viewport, the case, the whole risk, and
     the board when the world has one. */
  .back-head { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: 14px 14px 0; }
  .media.back-media { aspect-ratio: 16/6; }
  .media.back-media img { width: 100%; height: 100%; object-fit: cover; }
  .body.back-body { overflow-y: auto; flex: 1; scrollbar-width: thin; }
  /* Inspiration rides picture-in-picture: the catalog world explains where the
     direction comes from without promising what the build will look like. */
  /* Hovering the inspiration takes over the whole media region; the sketch is
     the promise, the inspiration is a glance, so the glance must cost nothing. */
  .pip { position: absolute; z-index: 2; left: 10px; bottom: 10px; margin: 0; width: 84px; height: 64px; border: 1px solid var(--ks-rule); border-radius: 6px; overflow: hidden; background: var(--ks-lacquer); cursor: zoom-in; transition: left .35s cubic-bezier(.16,1,.3,1), bottom .35s cubic-bezier(.16,1,.3,1), width .35s cubic-bezier(.16,1,.3,1), height .35s cubic-bezier(.16,1,.3,1), border-radius .35s ease; box-shadow: 0 6px 18px oklch(0% 0 0 / 0.45); }
  .pip img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .pip figcaption { position: absolute; left: 0; right: 0; bottom: 0; font-family: var(--ks-mono); font-size: .5rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text); text-align: center; padding: 3px 0 4px; background: oklch(7% 0.006 95 / 0.72); backdrop-filter: blur(3px); }
  .pip:hover { left: 0; bottom: 0; width: 100%; height: 100%; border-radius: 0; z-index: 3; }
  .sketch-note { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--ks-mono); font-size: .66rem; letter-spacing: .22em; text-transform: uppercase; color: var(--ks-text-faint); }
  /* Catalog art standing in for a sketchless card is a reference, and says so
     on its face; the same pill later carries "artwork unavailable". */
  .media-label { position: absolute; z-index: 2; left: 10px; bottom: 10px; margin: 0; font-family: var(--ks-mono); font-size: .5rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text); padding: 3px 8px 4px; background: oklch(7% 0.006 95 / 0.72); border: 1px solid var(--ks-rule); border-radius: 4px; backdrop-filter: blur(3px); }
  /* Art that never arrives collapses to the card's own palette (painted
     inline from its swatches) instead of sitting as a dark void wearing a
     zoom cursor; the scrim keeps the label legible over saturated fields,
     passes clicks through, and the flip chips stay above it. A card with no
     palette falls back to the quiet graphite field. */
  .media.unavailable { background: linear-gradient(100deg, var(--ks-graphite) 40%, var(--ks-graphite-2) 50%, var(--ks-graphite) 60%); }
  .media.unavailable::after { content: ""; position: absolute; inset: 0; z-index: 1; background: oklch(10% 0.008 95 / 0.45); pointer-events: none; }
  .media.unavailable .chips { z-index: 2; }
  /* A stand-in is honest about being one: dimmed, labeled, and replaced by
     the real sketch whenever it lands. */
  .media.stand-in img.sketch { filter: brightness(.72) saturate(.85); }
  .media.stand-in .pip { display: none; }
  .stand-in-label { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; margin: 0; font-family: var(--ks-mono); font-size: .56rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text); text-align: center; padding: 4px 0 5px; background: oklch(7% 0.006 95 / 0.78); backdrop-filter: blur(3px); }
  .media.sketching { position: relative; }
  .media.sketching .shimmer { position: absolute; inset: 0; }
  .media img.sketch { position: relative; z-index: 1; }
  /* The generic .media img display:block would defeat [hidden] and float an
     empty block over the shimmer; an unloaded sketch must truly not render. */
  .media img[hidden] { display: none; }
  /* The standing exit as a card: present with full anatomy, never dressed as a
     contender. Graphite instead of kinpaku, and it never takes the lead ring. */
  .card.canon .face { border-color: var(--ks-rule); background: var(--ks-graphite); }
  .card.canon:hover .face { border-color: var(--ks-text-faint); }
  .card.canon .kicker.standing { background: transparent; border: 1px solid var(--ks-rule); color: var(--ks-text-faint); }
  .card.canon button.choose { background: transparent; color: var(--ks-text); border: 1px solid var(--ks-rule); }
  .card.canon button.choose:hover { border-color: var(--ks-text-muted); background: var(--ks-graphite-2); }
  button.choose { margin-top: auto; align-self: start; background: var(--ks-kinpaku); color: var(--ks-dark-ink); border: 0; font-family: var(--ks-font); font-size: 1rem; font-weight: 500; line-height: 1.35; padding: 10px 38px; border-radius: 6px; cursor: pointer; transition: background .15s; }
  button.choose:hover { background: var(--ks-kinpaku-pale); }
  footer { width: 100%; max-width: 90rem; margin: 1.6rem auto 0; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  #steer { flex: 1; min-width: 16rem; background: var(--ks-lacquer-raised); color: var(--ks-text); border: 1px solid var(--ks-rule); border-radius: 7px; padding: .6rem .85rem; font: inherit; }
  #steer:focus { outline: none; border-color: var(--ks-patina); }
  #reroll { display: inline-flex; align-items: center; align-self: stretch; gap: 8px; padding: 0 16px; font-family: var(--ks-mono); font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ks-kinpaku); background: transparent; border: 1px solid var(--ks-rule); border-radius: 6px; cursor: pointer; transition: border-color .2s ease, color .2s ease; }
  #reroll:hover { color: var(--ks-kinpaku-pale); border-color: var(--ks-kinpaku-deep); }
  #reroll svg { width: 15px; height: 15px; }
  /* The quiet exit: always available, never argued with, visually subordinate
     to the dealt cards and the re-roll so it reads as the user's own door,
     not a recommendation. */
  #canon { align-self: center; padding: 0 4px; font-family: var(--ks-mono); font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: inherit; opacity: .45; background: transparent; border: none; border-bottom: 1px dotted currentColor; cursor: pointer; transition: opacity .2s ease; }
  #canon:hover { opacity: .85; }
  .card.skeleton .media { background: var(--ks-graphite); }
  .shimmer { width: 100%; height: 100%; background: linear-gradient(100deg, var(--ks-graphite) 35%, var(--ks-graphite-2) 50%, var(--ks-graphite) 65%); background-size: 220% 100%; animation: shimmer 1.4s linear infinite; }
  .card.skeleton .line { height: 11px; border-radius: 4px; background: linear-gradient(100deg, var(--ks-graphite) 35%, var(--ks-graphite-2) 50%, var(--ks-graphite) 65%); background-size: 220% 100%; animation: shimmer 1.4s linear infinite; }
  .card.skeleton .line.tier { height: 8px; }
  .card.skeleton .line.title { height: 17px; border-radius: 5px; }
  .card.skeleton .line.button { height: 38px; width: 128px; border-radius: 6px; margin-top: auto; }
  .card.skeleton .w40 { width: 40%; } .card.skeleton .w70 { width: 70%; } .card.skeleton .w90 { width: 90%; } .card.skeleton .w80 { width: 80%; } .card.skeleton .w60 { width: 60%; }
  .card.skeleton .body { flex: 1; }
  @keyframes shimmer { from { background-position: 120% 0; } to { background-position: -80% 0; } }
  @media (prefers-reduced-motion: reduce) { .shimmer, .card.skeleton .line { animation: none; } }
  .done { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 7rem 1rem; font-family: var(--ks-font-display); font-size: 1.4rem; color: var(--ks-champagne); text-align: center; }
  .stall { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 1.2rem; padding: 4.5rem 1rem; font-family: var(--ks-font-display); font-size: 1.4rem; color: var(--ks-champagne); text-align: center; }
  .stall .choose { align-self: center; margin-top: 0; }
</style>
<div id="ambient" aria-hidden="true"></div>
<div id="scrim" aria-hidden="true"></div>
<div id="lightbox" hidden><img alt=""></div>
<header>
  <div class="brand">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"/><path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"/></svg>
    <span class="wordmark">Impeccable</span>
  </div>
</header>
<main>
  <div class="stage">
    <div class="headline">
      <svg class="headline-die" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8.4" cy="8.4" r="1.5" fill="currentColor"/><circle cx="15.6" cy="8.4" r="1.5" fill="currentColor"/><circle cx="8.4" cy="15.6" r="1.5" fill="currentColor"/><circle cx="15.6" cy="15.6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
      <h1>${esc(payload.title || 'Choose a direction')}</h1>
    </div>
    ${payload.question ? `<p class="question">${esc(payload.question)}</p>` : ''}
    <div class="deck-shell">
      <div class="grid">${cards}</div>
      <div class="fade fade-prev" aria-hidden="true"></div>
      <div class="fade fade-next" aria-hidden="true"></div>
      <button class="nav prev" hidden aria-label="Previous card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5 8 12l6.5 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="nav next" hidden aria-label="Next card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5 16 12l-6.5 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
  </div>
</main>
<footer>
  ${payload.steer ? '<input id="steer" placeholder="Optional steer: what should be different or kept?">' : ''}
  ${payload.reroll ? '<button id="reroll"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8.4" cy="8.4" r="1.5" fill="currentColor"/><circle cx="15.6" cy="8.4" r="1.5" fill="currentColor"/><circle cx="8.4" cy="15.6" r="1.5" fill="currentColor"/><circle cx="15.6" cy="15.6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg><span>Re-roll</span></button>' : ''}
  ${payload.canon && !payload.canonCard ? '<button id="canon" title="Skip the roll: build the page this category ships, executed impeccably">Play it straight</button>' : ''}
</footer>
<script>
  const steer = () => document.getElementById('steer')?.value || '';
  const beat = () => { try { navigator.sendBeacon('/heartbeat'); } catch { fetch('/heartbeat', { method: 'POST' }); } };
  beat();
  const beatTimer = setInterval(beat, 5000);
  // A dead server must fail loudly: awaiting a rejected fetch here used to
  // swallow the click and never print the confirmation, so the user believed
  // a choice had landed that no one would ever collect.
  async function answer(optionId) {
    try {
      await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId, steer: steer() }) });
    } catch {
      document.body.innerHTML = '<div class="done">The question server went away before this choice could land.<br>Tell the agent your pick in the chat instead.</div>';
      return;
    }
    document.body.innerHTML = '<div class="done"><svg viewBox="0 0 24 24" width="38" height="38" fill="oklch(84% 0.19 80.46)" aria-hidden="true"><path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"/><path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"/></svg>Choice recorded. The agent is resuming; you can close this tab.</div>';
  }
  document.querySelectorAll('button.choose').forEach(b => b.addEventListener('click', () => answer(b.dataset.id)));
  document.querySelectorAll('.flip').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.closest('.card').classList.toggle('flipped');
  }));

  // Deal from the stack: cards begin piled at the grid's center, blurred,
  // then travel to their seats with a stagger.
  const cards = [...document.querySelectorAll('.card')];
  // The deal is decoration: a hidden tab throttles rAF, so never let the
  // animation hold the cards at opacity 0. Skip it when hidden, and force
  // the final state after a beat no matter what the animation did.
  setTimeout(() => cards.forEach(c => { c.style.opacity = ''; c.style.transform = ''; c.style.filter = ''; c.style.transition = ''; c.style.zIndex = ''; }), 1600);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && cards.length && !document.hidden) {
    const grid = document.querySelector('.grid').getBoundingClientRect();
    const cx = grid.left + grid.width / 2, cy = grid.top + grid.height / 2;
    cards.forEach((card, i) => {
      const r = card.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      card.style.transition = 'none';
      card.style.transform = 'translate(' + dx + 'px,' + (dy + 14) + 'px) rotate(' + (i % 2 ? 5 : -4) + 'deg) scale(.9)';
      card.style.opacity = '0';
      card.style.filter = 'blur(10px)';
      card.style.zIndex = String(cards.length - i);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cards.forEach((card, i) => {
        const delay = i * 110;
        card.style.transition = 'transform .7s cubic-bezier(.16,1,.3,1) ' + delay + 'ms, opacity .45s ease ' + delay + 'ms, filter .55s ease ' + delay + 'ms';
        card.style.transform = ''; card.style.opacity = '1'; card.style.filter = '';
        card.addEventListener('transitionend', function done(e) {
          if (e.propertyName !== 'transform') return;
          card.style.transition = ''; card.style.opacity = ''; card.style.zIndex = '';
          card.removeEventListener('transitionend', done);
        });
      });
    }));
  }

  // Sketches stream in after the deal: poll each slot until the file lands,
  // then swap the shimmer for the image. Generation is genuinely slow and a
  // sequential batch puts the last card many minutes out, so patience is the
  // default: a slot only shows its inspiration as a stand-in when it has
  // waited four minutes AND nothing has landed anywhere for four minutes, the
  // stand-in is labeled as such, and polling continues so the real sketch
  // still swaps in whenever it arrives. Progress anywhere resets patience.
  const landTracker = { last: Date.now() };
  document.querySelectorAll('.media.sketching').forEach(m => {
    const url = m.dataset.sketch;
    const img = m.querySelector('img.sketch');
    const note = m.querySelector('.sketch-note');
    const started = Date.now();
    // A live elapsed count is the difference between "working" and "frozen".
    const tick = setInterval(() => { if (note) note.textContent = 'sketching · ' + Math.round((Date.now() - started) / 1000) + 's'; }, 1000);
    const settle = () => { clearInterval(tick); m.classList.remove('sketching', 'stand-in'); m.querySelector('.shimmer')?.remove(); m.querySelector('.stand-in-label')?.remove(); };
    const standIn = () => {
      const pip = m.querySelector('.pip img');
      if (!pip || m.classList.contains('stand-in')) return;
      img.src = pip.getAttribute('src'); img.hidden = false;
      m.classList.add('stand-in');
      m.querySelector('.shimmer')?.remove();
      clearInterval(tick);
      const label = document.createElement('p');
      label.className = 'stand-in-label';
      label.textContent = 'inspiration · sketch pending';
      m.appendChild(label);
    };
    const tryLoad = () => {
      const probe = new Image();
      probe.onload = () => { landTracker.last = Date.now(); img.src = probe.src; img.hidden = false; settle(); };
      probe.onerror = () => {
        const quiet = Date.now() - landTracker.last > 240000;
        if (Date.now() - started > 240000 && quiet) standIn();
        setTimeout(tryLoad, m.classList.contains('stand-in') ? 5000 : 2500);
      };
      probe.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    };
    tryLoad();
  });

  // A declared image that never loads (missing catalog asset, offline shell)
  // must not sit as a dark void: the slot collapses to the card's own
  // palette, labeled honestly, and the card competes on its facts. Sketch
  // slots are excluded; their polling owns the wait.
  const artFailed = (img) => {
    const m = img.closest('.media');
    if (!m || m.classList.contains('sketching') || m.classList.contains('unavailable')) return;
    m.classList.add('unavailable');
    const colors = [...(img.closest('.card')?.querySelectorAll('.swatches i') || [])].map(i => i.style.background).filter(Boolean);
    if (colors.length) m.style.background = 'linear-gradient(135deg, ' + colors.map((c, i) => c + ' ' + Math.round(i * 100 / colors.length) + '% ' + Math.round((i + 1) * 100 / colors.length) + '%').join(', ') + ')';
    m.querySelector('.media-label')?.remove();
    m.querySelector('.chip.expand')?.remove();
    m.removeAttribute('title');
    img.remove();
    const label = document.createElement('p');
    label.className = 'media-label';
    label.textContent = 'artwork unavailable';
    m.appendChild(label);
  };
  document.querySelectorAll('.media:not(.sketching) > img').forEach(img => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) artFailed(img);
    else img.addEventListener('error', () => artFailed(img), { once: true });
  });
  // A broken inspiration PIP just leaves; nothing depends on it.
  document.querySelectorAll('.pip img').forEach(img => {
    const gone = () => img.closest('.pip')?.remove();
    if (img.complete && img.naturalWidth === 0) gone();
    else img.addEventListener('error', gone, { once: true });
  });

  // Inspiration PIP opens the full catalog card in the lightbox.
  document.querySelectorAll('.pip').forEach(p => p.addEventListener('click', (e) => {
    e.stopPropagation();
    const img = p.querySelector('img');
    if (!img) return;
    lightboxImg.src = img.getAttribute('src');
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('open'));
  }));

  // Deck paging: arrows appear only when the deck overflows its axis, page
  // one card at a time, and follow the aspect-ratio flip between row and column.
  const deck = document.querySelector('.grid');
  const prevBtn = document.querySelector('.nav.prev');
  const nextBtn = document.querySelector('.nav.next');
  const vertical = () => matchMedia('(max-aspect-ratio: 1/1)').matches;
  function updateNav() {
    if (!deck || !prevBtn) return;
    const shell = deck.closest('.deck-shell');
    const v = vertical();
    const overflow = v ? deck.scrollHeight > deck.clientHeight + 4 : deck.scrollWidth > deck.clientWidth + 4;
    prevBtn.hidden = nextBtn.hidden = !overflow;
    const pos = v ? deck.scrollTop : deck.scrollLeft;
    const max = v ? deck.scrollHeight - deck.clientHeight : deck.scrollWidth - deck.clientWidth;
    const canPrev = overflow && pos > 2;
    const canNext = overflow && pos < max - 2;
    prevBtn.toggleAttribute('disabled', !canPrev);
    nextBtn.toggleAttribute('disabled', !canNext);
    shell?.classList.toggle('can-prev', canPrev);
    shell?.classList.toggle('can-next', canNext);
  }
  function pageDeck(dir) {
    const card = deck.querySelector('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const step = (vertical() ? r.height : r.width) + 26;
    deck.scrollBy(vertical() ? { top: dir * step, behavior: 'smooth' } : { left: dir * step, behavior: 'smooth' });
  }
  prevBtn?.addEventListener('click', () => pageDeck(-1));
  nextBtn?.addEventListener('click', () => pageDeck(1));
  deck?.addEventListener('scroll', updateNav, { passive: true });
  addEventListener('resize', updateNav);
  updateNav();

  // Ambient: the hovered card's visible art bleeds into the page ground.
  const ambient = document.getElementById('ambient');
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      const art = card.querySelector('.face.front .media img:not([hidden])') || card.querySelector('.face.front .pip img');
      if (!art || !art.getAttribute('src')) return;
      ambient.style.backgroundImage = 'url("' + art.getAttribute('src') + '")'; ambient.style.opacity = '1';
    });
    card.addEventListener('mouseleave', () => { ambient.style.opacity = '0'; });
  });

  // Expand: lightbox for whichever face is showing.
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox.querySelector('img');
  document.querySelectorAll('.expand').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = b.closest('.card');
    const face = card.classList.contains('flipped') ? '.face.back' : '.face.front';
    const img = card.querySelector(face + ' .media img:not([hidden])');
    if (!img || !img.getAttribute('src')) return;
    lightboxImg.src = img.getAttribute('src');
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('open'));
  }));
  // Portrait art (native / mobile-first surfaces): the slot takes the
  // image's own ratio so nothing crops, and the whole deck narrows so
  // portrait cards sit side by side. Load events don't bubble; capture.
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('.media > img')) return;
    if (img.naturalHeight > img.naturalWidth * 1.05) {
      const m = img.closest('.media');
      m.classList.add('portrait');
      m.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
      document.querySelector('.grid')?.classList.add('portrait-media');
    }
  }, true);

  // The whole image is the zoom target, not just the expand chip; the chip
  // stays as the visible affordance. Chip and PIP handlers stop propagation,
  // so this fires only for clicks on the art itself.
  document.querySelectorAll('.media').forEach(m => m.addEventListener('click', () => {
    const img = m.querySelector(':scope > img:not([hidden])');
    if (!img || !img.getAttribute('src')) return;
    lightboxImg.src = img.getAttribute('src');
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('open'));
  }));
  const closeLightbox = () => { lightbox.classList.remove('open'); setTimeout(() => { lightbox.hidden = true; }, 250); };
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lightbox.hidden) closeLightbox(); });
  document.getElementById('canon')?.addEventListener('click', () => answer('canon'));
  document.getElementById('reroll')?.addEventListener('click', async () => {
    try {
      await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: 'reroll', steer: steer() }) });
    } catch {
      document.body.innerHTML = '<div class="done">The question server went away before this choice could land.<br>Tell the agent your pick in the chat instead.</div>';
      return;
    }
    const grid = document.querySelector('.grid');
    const cardsNow = [...grid.querySelectorAll('.card')];
    const g = grid.getBoundingClientRect();
    const cx = g.left + g.width / 2, cy = g.top + g.height / 2;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cardsNow.forEach((card, i) => {
        const r = card.getBoundingClientRect();
        card.style.transition = 'transform .5s cubic-bezier(.5,0,.75,0) ' + (i * 60) + 'ms, opacity .4s ease ' + (i * 60 + 120) + 'ms, filter .45s ease ' + (i * 60) + 'ms';
        card.style.transform = 'translate(' + (cx - (r.left + r.width / 2)) + 'px,' + (cy - (r.top + r.height / 2) + 14) + 'px) rotate(' + (i % 2 ? 6 : -5) + 'deg) scale(.9)';
        card.style.opacity = '0';
        card.style.filter = 'blur(8px)';
      });
      await new Promise(r => setTimeout(r, 700));
    }
    const cardHeight = cardsNow[0] ? cardsNow[0].getBoundingClientRect().height : 0;
    grid.innerHTML = cardsNow.map(() => '<article class="card skeleton"' + (cardHeight ? ' style="height:' + cardHeight + 'px"' : '') + '><div class="card-inner"><div class="face front"><div class="media"><div class="shimmer"></div></div><div class="body"><div class="line tier w40"></div><div class="line title w70"></div><div class="line w90"></div><div class="line w80"></div><div class="line w60"></div><div class="line button"></div></div></div></div></article>').join('');
    document.getElementById('reroll')?.setAttribute('disabled', '');
    // The wait must be able to end: a dead server rejects every tick and a
    // round nobody delivers stays ready:false forever, and both used to spin
    // the skeletons indefinitely. Distinguish them, say so, and offer a way
    // out. The delivery deadline is the server's own idle grace, so the page
    // never gives up on a server that would still accept the hand.
    let poll;
    let misses = 0;
    const shuffleStart = Date.now();
    const stall = (message) => {
      clearInterval(poll);
      // A stalled page is an abandoned flow: keep heartbeating and the
      // daemon never reaches its idle grace, so --wait spins on WAITING
      // forever. Go silent and let the server reclaim itself. Reload must
      // not undo that silence: an unconditional reload re-serves the same
      // unresolved round and its fresh page beats again, so check for a
      // delivered hand first and only reload when one exists.
      clearInterval(beatTimer);
      grid.innerHTML = '<div class="stall"><p>' + message + '</p><button type="button" class="choose">Reload</button></div>';
      grid.querySelector('.stall .choose').addEventListener('click', async () => {
        try {
          if ((await (await fetch('/next-status')).json()).ready) { location.reload(); return; }
          grid.querySelector('.stall p').textContent = 'Still nothing to deal. Check the agent session, or answer in the chat instead.';
        } catch {
          grid.querySelector('.stall p').textContent = 'The question server went away. Ask the agent to restart it, or answer in the chat instead.';
        }
      });
    };
    poll = setInterval(async () => {
      try {
        const status = await (await fetch('/next-status')).json();
        misses = 0;
        if (status.ready) { clearInterval(poll); location.reload(); }
        else if (Date.now() - shuffleStart > ${idleGraceMs}) stall('The next hand never arrived. Check the agent session, then reload.');
      } catch {
        misses += 1;
        if (misses >= 8) stall('The question server went away. Ask the agent to restart it, or answer in the chat instead.');
      }
    }, 1200);
  });
</script>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const pending = nextFile();
    if (pending && fs.existsSync(pending)) {
      try { loadRound(fs.readFileSync(pending, 'utf8')); fs.rmSync(pending); } catch { /* keep current round */ }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page());
    return;
  }
  if (req.method === 'POST' && req.url === '/heartbeat') {
    res.writeHead(204); res.end();
    server.lastBeatSeen = Date.now();
    if (detachedKey) {
      const now = Date.now();
      if (!server.lastBeatWrite || now - server.lastBeatWrite > 4000) {
        server.lastBeatWrite = now;
        try {
          const state = JSON.parse(fs.readFileSync(stateFile(detachedKey), 'utf8'));
          state.lastBeat = now;
          fs.writeFileSync(stateFile(detachedKey), JSON.stringify(state));
        } catch { /* state file recreated on next beat */ }
      }
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/next-status') {
    const pending = nextFile();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ready: Boolean(pending && fs.existsSync(pending)) }));
    return;
  }
  const imageMatch = req.method === 'GET' && req.url?.match(/^\/img\/(\d+)(?:\?.*)?$/);
  if (imageMatch) {
    const abs = localImages[Number(imageMatch[1])];
    if (!abs || !fs.existsSync(abs)) { res.writeHead(404); res.end(); return; }
    const type = abs.endsWith('.webp') ? 'image/webp'
      : abs.endsWith('.png') ? 'image/png'
      : abs.endsWith('.svg') ? 'image/svg+xml'
      : abs.endsWith('.gif') ? 'image/gif'
      : 'image/jpeg';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(abs).pipe(res);
    return;
  }
  if (req.method === 'POST' && req.url === '/answer') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* empty steer */ }
      const chosen = options.find((o) => o.id === parsed.optionId);
      const answer = JSON.stringify({
        optionId: parsed.optionId ?? null,
        steer: parsed.steer ?? '',
        ...(chosen?.hero || chosen?.board ? { hero: chosen.hero ?? null, board: chosen.board ?? null } : {}),
        ...(chosen?.sketch ? { sketch: chosen.sketch } : {}),
      });
      const isReroll = parsed.optionId === 'reroll';
      if (detachedKey) {
        fs.mkdirSync(QUESTION_DIR, { recursive: true });
        fs.writeFileSync(answerFile(detachedKey), answer + '\n');
      } else {
        printAnswer(answer);
      }
      // A re-roll in detached mode keeps the table open: the client shows a
      // loading hand and reloads when --update delivers the next round.
      if (!(isReroll && detachedKey)) setTimeout(() => process.exit(0), 150);
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(portArg, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  if (hasFlag('detached-serve')) {
    fs.mkdirSync(QUESTION_DIR, { recursive: true });
    fs.writeFileSync(stateFile(arg('key')), JSON.stringify({ pid: process.pid, port, url }));
  } else {
    console.log(`QUESTION URL: ${url}`);
    console.log('Waiting for the user to choose in the browser (Ctrl-C aborts)...');
  }
  if (!hasFlag('no-open')) {
    openSystemBrowser(url);
  }
  // The timeout bounds the wait for a page, never the user's decision: an
  // absolute guillotine counted from start used to kill the server under a
  // still-open tab (a slow re-rolled round easily outlived it), leaving the
  // page polling skeletons that could never resolve. Once the page beats,
  // the server's lifetime tracks the beats, and it exits only after the idle
  // grace passes with none, long enough to survive a closed laptop lid.
  // --timeout 0 waits for a page forever, but the idle grace still applies
  // once one has beat: a page that arrived and went silent is a closed tab,
  // and no timeout setting should let that daemon leak.
  const startedAt = Date.now();
  const lifetime = setInterval(() => {
    if (!server.lastBeatSeen) {
      if (timeoutSec > 0 && Date.now() - startedAt > timeoutSec * 1000) {
        console.log('serve-question: timed out with no answer');
        process.exit(2);
      }
    } else if (Date.now() - server.lastBeatSeen > idleGraceMs) {
      console.log('serve-question: the page stopped beating and never came back; exiting');
      process.exit(2);
    }
  }, 2000);
  lifetime.unref?.();
});
