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
 *       "body": "why it fits, first viewport, risk ...",  // optional, plain text
 *       "hero": "https://... or /abs/path.webp",   // optional image
 *       "board": "https://... or /abs/path.webp"   // optional secondary image
 *     }, ...
 *   ],
 *   "reroll": true,          // adds a re-roll action (returns {"optionId":"reroll"})
 *   "canon": true,           // adds the quiet "Play it straight" standing exit
 *                            // (returns {"optionId":"canon"}); direction rounds only
 *   "steer": true            // adds a free-text steer field returned with any answer
 * }
 *
 * Options render as large cards: hero render first when present (the dealt
 * catalog worlds already have cards; grounded directions may present text-only
 * or a freshly generated mock). Local image paths are served by this server;
 * nothing is uploaded anywhere.
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
 *              reloads into this new payload the moment it lands.
 *
 *   node serve-question.mjs --payload question.json [--timeout 900] [--no-open] [--port 0]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
// --schema never open anything: --wait polls a daemon whose browser question
// was already settled at --start, --stop kills one, --schema prints text. A
// spurious exit 2 from those breaks the documented loop, which polls --wait
// while it exits 3 and reads --schema before building a payload.
const wantsBrowser = !hasFlag('no-open') && !hasFlag('wait') && !hasFlag('stop') && !hasFlag('schema');
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
      console.log("CHOSEN CARD: open the chosen world's board and hero images now, before any code (download local copies first when your harness only reads files); they set the craft bar the build must reach.");
    }
    if (a.optionId === 'canon') {
      console.log('CANON CHOSEN: the user picked the category standard on purpose. Ask once for two or three products this should sit alongside; their craft level becomes the quality bar. Execute the canon at full commitment, conventions embraced without irony or smuggled quirk.');
    }
  } catch { /* raw answer */ }
}

const payloadPath = arg('payload');
const timeoutSec = Number(arg('timeout', '900'));
const portArg = Number(arg('port', '0'));
const QUESTION_DIR = path.join(process.cwd(), '.impeccable', 'questions');
const stateFile = (key) => path.join(QUESTION_DIR, `${key}.state.json`);
const answerFile = (key) => path.join(QUESTION_DIR, `${key}.answer.json`);

if (hasFlag('schema')) {
  console.log(JSON.stringify({
    title: 'Choose the visual world',
    question: 'The roll assigned Fillmore Handbill. Keep it, take an alternate, or re-roll.',
    options: [
      { id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL', lineage: '1966-71 Fillmore psychedelic handbills', body: 'Why it fits, the first viewport, the honest risk.', hero: 'https://impeccable.style/worlds/cards/fillmore-handbill-hero.webp', board: 'https://impeccable.style/worlds/cards/fillmore-handbill.webp' },
      { id: 'challenger-teletext', label: 'Teletext Service', lineage: 'broadcast teletext magazines', body: 'Fused alternate.', hero: 'https://impeccable.style/worlds/cards/broadcast-programming-teletext-service-hero.webp' },
    ],
    reroll: true,
    canon: true,
    steer: true,
  }, null, 2));
  console.log('\nOption ids return verbatim in ANSWER; "reroll" and "canon" are reserved. hero/board accept URLs or local paths. canon adds a quiet standing "Play it straight" action for direction decisions: the user\'s explicit door to the category standard. Include it only for visual-direction rounds; never present canon as your own recommendation.');
  process.exit(0);
}

if (hasFlag('wait')) {
  const key = arg('key');
  if (!key) { console.error('serve-question: --wait needs --key'); process.exit(1); }
  const pollSec = Number(arg('poll', '60'));
  const deadline = Date.now() + pollSec * 1000;
  const answered = () => fs.existsSync(answerFile(key));
  const alive = () => {
    try { process.kill(JSON.parse(fs.readFileSync(stateFile(key), 'utf8')).pid, 0); return true; }
    catch { return false; }
  };
  let sawClose = false;
  while (Date.now() < deadline) {
    if (answered()) break;
    if (!alive()) {
      console.log('serve-question: the question server is gone with no answer');
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
  try { process.kill(JSON.parse(fs.readFileSync(stateFile(key), 'utf8')).pid, 0); }
  catch { console.error('serve-question: no live question server for that key'); process.exit(2); }
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
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url), '--payload', payloadPath, '--detached-serve', '--key', key,
    '--timeout', String(timeoutSec), ...(hasFlag('open') ? [] : ['--no-open']),
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !fs.existsSync(stateFile(key))) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(stateFile(key))) { console.error('serve-question: server failed to start'); process.exit(1); }
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
  payload = parsed;
  options = parsed.options.map((option) => ({
    ...option,
    heroSrc: imageSrc(option.hero),
    boardSrc: imageSrc(option.board),
  }));
}
try { loadRound(raw); } catch (error) { console.error(`serve-question: ${error.message}`); process.exit(1); }
const detachedKey = hasFlag('detached-serve') ? arg('key') : null;
const nextFile = () => detachedKey ? path.join(QUESTION_DIR, `${detachedKey}.next.json`) : null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page() {
  const flipChip = (label) => `<button type="button" class="chip flip" aria-label="Flip the card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 5.5V12h6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label}</span></button>`;
  const expandChip = `<button type="button" class="chip expand" aria-label="Expand the image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const cards = options.map((option, index) => `
    <article class="card" style="--fan:${index === 0 ? '0deg' : (index % 2 ? '1.4deg' : '-1.2deg')};--deal:${index * 90}ms" data-id="${esc(option.id)}">
      <div class="card-inner">
        <div class="face front${index === 0 ? ' lead' : ''}${option.heroSrc || option.boardSrc ? '' : ' text-only'}">
          ${option.kicker ? `<span class="kicker">${esc(option.kicker)}</span>` : ''}
          ${option.heroSrc || option.boardSrc ? `<div class="media">
            <img src="${esc(option.heroSrc || option.boardSrc)}" alt="">
            <div class="chips">${expandChip}${option.boardSrc && option.heroSrc ? flipChip('Board') : ''}</div>
          </div>` : ''}
          <div class="body">
            ${option.lineage ? `<p class="tier">${esc(option.lineage)}</p>` : ''}
            <h2>${esc(option.label)}</h2>
            ${option.body ? `<p class="detail">${esc(option.body)}</p>` : ''}
            <button class="choose" data-id="${esc(option.id)}">Build this</button>
          </div>
        </div>
        ${option.boardSrc && option.heroSrc ? `<div class="face back${index === 0 ? ' lead' : ''}">
          <div class="media back-media">
            <img src="${esc(option.boardSrc)}" alt="">
            <div class="chips">${expandChip}${flipChip('Hero')}</div>
          </div>
          <div class="body back-bar">
            <p class="tier">Design-system board &middot; ${esc(option.label)}</p>
            <button class="choose" data-id="${esc(option.id)}">Build this</button>
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
  body { background: var(--ks-lacquer); color: var(--ks-text); font: 15px/1.55 var(--ks-font); padding: 1.8rem clamp(1rem, 5vw, 4rem) 2rem; min-height: 100dvh; display: flex; flex-direction: column; }
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
  .grid { display: grid; gap: 1.6rem; grid-template-columns: repeat(auto-fit, minmax(min(23rem, 100%), 1fr)); width: 100%; }
  .card { position: relative; perspective: 1400px; transform: rotate(var(--fan, 0deg)); transition: transform .25s cubic-bezier(.16, 1, .3, 1); }
  .card:hover { transform: rotate(0deg) translateY(-4px); }
  .card-inner { position: relative; height: 100%; transform-style: preserve-3d; transition: transform .7s cubic-bezier(.16, 1, .3, 1); }
  .card.flipped .card-inner { transform: rotateY(180deg); }
  .face { background: var(--ks-lacquer-raised); border: 1px solid var(--ks-rule); border-radius: 10px; box-shadow: 0 18px 40px oklch(0% 0 0 / 0.35); overflow: hidden; display: flex; flex-direction: column; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
  .face.front { position: relative; height: 100%; }
  .face.back { position: absolute; inset: 0; transform: rotateY(180deg); }
  .face.lead { border-color: var(--ks-kinpaku); box-shadow: 0 0 0 1px var(--ks-kinpaku), 0 18px 40px oklch(0% 0 0 / 0.45); }
  .card:hover .face { border-color: var(--ks-kinpaku-deep); }
  .card:hover .face.lead { border-color: var(--ks-kinpaku); }
  @media (prefers-reduced-motion: reduce) { .card-inner { transition: none; } }
  .kicker { position: absolute; z-index: 2; top: 12px; left: 12px; padding: 4px 10px; background: var(--ks-kinpaku); color: var(--ks-dark-ink); font-family: var(--ks-mono); font-size: .625rem; letter-spacing: .24em; text-transform: uppercase; border-radius: 4px; }
  /* Text-only card: a grounded direction with no rendered card drops the media
     region entirely instead of reserving a blank 16:9 void. */
  .face.text-only .kicker { position: static; align-self: flex-start; margin: 14px 0 0 14px; }
  .face.text-only .body { padding-top: 12px; }
  .media { position: relative; width: 100%; aspect-ratio: 16/9; flex: none; }
  .media img { width: 100%; height: 100%; object-fit: cover; display: block; background: linear-gradient(100deg, var(--ks-graphite) 40%, var(--ks-graphite-2) 50%, var(--ks-graphite) 60%); }
  .face.back { background: var(--ks-lacquer-deep); }
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
    <div class="grid">${cards}</div>
  </div>
</main>
<footer>
  ${payload.steer ? '<input id="steer" placeholder="Optional steer: what should be different or kept?">' : ''}
  ${payload.reroll ? '<button id="reroll"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8.4" cy="8.4" r="1.5" fill="currentColor"/><circle cx="15.6" cy="8.4" r="1.5" fill="currentColor"/><circle cx="8.4" cy="15.6" r="1.5" fill="currentColor"/><circle cx="15.6" cy="15.6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg><span>Re-roll</span></button>' : ''}
  ${payload.canon ? '<button id="canon" title="Skip the roll: build the page this category ships, executed impeccably">Play it straight</button>' : ''}
</footer>
<script>
  const steer = () => document.getElementById('steer')?.value || '';
  const beat = () => { try { navigator.sendBeacon('/heartbeat'); } catch { fetch('/heartbeat', { method: 'POST' }); } };
  beat();
  setInterval(beat, 5000);
  async function answer(optionId) {
    await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId, steer: steer() }) });
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
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && cards.length) {
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

  // Ambient: the hovered card's hero bleeds into the page ground under a scrim.
  const ambient = document.getElementById('ambient');
  document.querySelectorAll('.card').forEach(card => {
    const hero = card.querySelector('.face.front .media img');
    if (!hero) return;
    card.addEventListener('mouseenter', () => { ambient.style.backgroundImage = 'url("' + hero.getAttribute('src') + '")'; ambient.style.opacity = '1'; });
    card.addEventListener('mouseleave', () => { ambient.style.opacity = '0'; });
  });

  // Expand: lightbox for whichever face is showing.
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox.querySelector('img');
  document.querySelectorAll('.expand').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = b.closest('.card');
    const face = card.classList.contains('flipped') ? '.face.back' : '.face.front';
    const img = card.querySelector(face + ' .media img');
    if (!img) return;
    lightboxImg.src = img.getAttribute('src');
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('open'));
  }));
  const closeLightbox = () => { lightbox.classList.remove('open'); setTimeout(() => { lightbox.hidden = true; }, 250); };
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lightbox.hidden) closeLightbox(); });
  document.getElementById('canon')?.addEventListener('click', () => answer('canon'));
  document.getElementById('reroll')?.addEventListener('click', async () => {
    await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: 'reroll', steer: steer() }) });
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
    const poll = setInterval(async () => {
      try {
        const status = await (await fetch('/next-status')).json();
        if (status.ready) { clearInterval(poll); location.reload(); }
      } catch { /* server briefly busy */ }
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
  const imageMatch = req.method === 'GET' && req.url?.match(/^\/img\/(\d+)$/);
  if (imageMatch) {
    const abs = localImages[Number(imageMatch[1])];
    if (!abs) { res.writeHead(404); res.end(); return; }
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
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try { spawn(opener, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* URL printed anyway */ }
  }
  if (timeoutSec > 0) {
    setTimeout(() => {
      console.log('serve-question: timed out with no answer');
      process.exit(2);
    }, timeoutSec * 1000).unref?.();
  }
});
