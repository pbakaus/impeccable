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
 *       "verdict": "competitive", // optional routing tier: "wins" |
 *                                // "competitive" | "declined". Declined cards
 *                                // render demoted after the full cards:
 *                                // narrow, quiet, catalog art as a labeled
 *                                // thumb, "Adopt anyway" instead of "Build
 *                                // this". Still choosable; never deleted.
 *       "kept": "one line: what the direction kept from this declined world",
 *       "raised": [ { "from": "challenger-x", "raise": "one line" } ],
 *                                // assigned card only: donations taken from
 *                                // declined challengers, rendered as named
 *                                // raise lines under the identity row
 *       "risk": "one line: the honest risk",                      // optional
 *       "body": "fallback prose when the structured fields are absent",
 *       "comp": ".impeccable/mocks/decision/assigned.webp",  // optional; the card's
 *                                // full-fidelity direction comp (the legacy
 *                                // key "sketch" is accepted as an alias). May
 *                                // not exist yet: the page shimmer-waits and
 *                                // polls the slot until the file lands, so
 *                                // serve first and generate after
 *       "hero": "https://... or /abs/path.webp",   // optional inspiration image;
 *                                // rides picture-in-picture when a comp exists
 *       "board": "https://... or /abs/path.webp"   // optional secondary image
 *     }, ...
 *   ],
 *   "reroll": true,          // adds a re-roll action (returns {"optionId":"reroll"})
 *                            // or { "registers": ["safer", "bolder"] } to add
 *                            // the register steers beside it: the answer then
 *                            // carries "register" and the agent re-runs
 *                            // concept-seed with --register <value>
 *   "canon": true,           // adds the "Play it straight" standing exit;
 *                            // direction rounds only (returns {"optionId":"canon"})
 *   "canonCard": { ... },    // optional: the standing exit as a full card with the
 *                            // same anatomy (label, thesis, palette, comp, ...);
 *                            // rendered last and visually subordinate. Without it,
 *                            // canon stays a quiet footer action.
 *   "steer": true,           // adds a free-text steer field returned with any answer
 *   "followup": true         // this round's pick is not terminal: the server
 *                            // stays open awaiting --update with the next
 *                            // round (detached mode only), the page shows a
 *                            // loading hand instead of goodbye, and the
 *                            // answer carries followup:true so --wait knows
 *                            // to keep the table. Use it when a decision has
 *                            // a known second half, e.g. direction first,
 *                            // then the execution contract.
 * }
 *
 * Options render as large cards: the comp leads when present, with the
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
    if (a.comp) {
      console.log('CHOSEN COMP: the decision comp at that path is compositional option one. On a comp-led build the comp round adds two variations beside it; on a code-led build it returns at the finish review as the critique reference. Never regenerate it from scratch.');
    }
    if (a.optionId === 'canon') {
      console.log('CANON CHOSEN: the user picked the category standard on purpose. Ask once for two or three products this should sit alongside; their craft level becomes the quality bar. Execute the canon at full commitment, conventions embraced without irony or smuggled quirk.');
    }
    if (a.optionId === 'reroll' && a.register) {
      console.log(`REGISTER: the user steered the next hand to the ${a.register} register. Re-run concept-seed with the same key, the next --reroll round, and --register ${a.register}, then follow what it prints; the register is the user's steering, never yours to pre-select.`);
    }
    if (a.followup && a.optionId !== 'reroll') {
      console.log('FOLLOWUP OPEN: the table stays open and the page is showing a loading hand. Deliver the next round now with --update --key <key> --payload <file>, then collect it with --wait; never leave the page waiting on a round you have not sent.');
    }
    if (a.buildPath === 'comp' || a.buildPath === 'code') {
      // The page never writes the flip itself, but "never write it" overstated
      // that into a rule the agent then applied to new-work's one-time offer,
      // which exists for exactly this case: a flip on a project that had no
      // recorded default is the only moment the preference is ever asked for.
      const origin = a.buildPathFlipped
        ? 'flipped on the page, so it binds this session only, and the page never writes it back; the sole exception is new-work’s one-time offer, on a project that had no recorded default at all, which asks after the round closes and writes the answer to .impeccable/config.json'
        : 'the round’s recorded default';
      console.log(`BUILD PATH: ${a.buildPath} (${origin}). ${a.buildPath === 'comp'
        ? 'Comp-led: the chosen card’s comp is law; generate it before building when it does not exist yet, and the finish review audits the build against it.'
        : 'Code-led: no comp is owed; a comp that already rendered rides at the finish review as the critique reference, and the ambition lives in the direction contract.'}`);
    }
  } catch { /* raw answer */ }
}

const payloadPath = arg('payload');
// --timeout bounds only the wait for a page to open; 0 is the explicit
// wait-forever. A negative or unparseable value takes the default, so a
// typo cannot disarm the no-page exit and leak the daemon.
const timeoutArg = Number(arg('timeout', '900'));
const timeoutSec = Number.isFinite(timeoutArg) && timeoutArg >= 0 ? timeoutArg : 900;
// How long the server (and the page's own delivery deadline) outlive the
// last heartbeat; a zero, negative, or unparseable value takes the default.
const idleGraceArg = Number(arg('idle-grace', '600'));
const idleGraceMs = (Number.isFinite(idleGraceArg) && idleGraceArg > 0 ? idleGraceArg : 600) * 1000;
// How long a delivered next hand may sit unclaimed before it means no page
// is coming back: --wait reads it to keep a stalled page from counting as
// closed mid-delivery, and the daemon reads it to survive until the page's
// watch claims a hand delivered moments before the idle deadline.
const NEXT_CLAIM_GRACE_MS = 10000;
const portArg = Number(arg('port', '0'));
const QUESTION_DIR = path.join(process.cwd(), '.impeccable', 'questions');
const stateFile = (key) => path.join(QUESTION_DIR, `${key}.state.json`);
const answerFile = (key) => path.join(QUESTION_DIR, `${key}.answer.json`);
// A code-to-comp flip mid-round: the page records it here and --wait
// surfaces it as its own event, because the agent must start generating
// comps while the round is still open. Comp-to-code needs no event; it is
// free and rides the final ANSWER.
const flipFile = (key) => path.join(QUESTION_DIR, `${key}.flip.json`);

if (hasFlag('schema')) {
  console.log(JSON.stringify({
    title: 'Choose the visual world',
    question: 'The roll assigned Fillmore Handbill. Keep it, take an alternate, or re-roll.',
    options: [
      { id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL', lineage: '1966-71 Fillmore psychedelic handbills', thesis: 'The gig poster that treats every release like a one-night stand.', palette: ['#e8452c', '#f5d64c', '#1b2a52', '#f3ead8'], materials: ['letterpress', 'split-fountain ink'], viewport: 'A full-bleed dated bill with the product name in warped display type.', risk: 'Reads nostalgic when the type is set timidly.', raised: [{ from: 'challenger-microfiche', raise: 'The bill now owns its whole viewport as one continuous printed sheet.' }], comp: '.impeccable/mocks/decision/assigned.webp', hero: 'https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill-hero.webp', board: 'https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill.webp' },
      { id: 'model-pick', label: 'The Broadside Ballad', kicker: 'IMPECCABLE’S PICK', lineage: 'street-sold ballad sheets', thesis: 'Every release printed as the day’s ballad sheet.', palette: ['#1f1c18', '#efe5d0', '#a33327'], materials: ['woodcut', 'rag paper'], viewport: 'One tall sheet, the newest release as today’s ballad.', risk: 'Also the direction most runs in this category land on.', comp: '.impeccable/mocks/decision/model-pick.webp' },
      { id: 'challenger-teletext', label: 'Teletext Service', verdict: 'competitive', lineage: 'broadcast teletext magazines', thesis: 'The catalog as a broadcast index: pages, not sections.', palette: ['#0000c0', '#ffff00', '#00c000', '#ffffff'], materials: ['block mosaic', 'phosphor glow'], viewport: 'P100 index page, releases as numbered rows.', case: 'Fuses cleanly: releases map to numbered pages; loses narrowly on clarity.', risk: 'Reads retro-novelty when the grid is not strict.', comp: '.impeccable/mocks/decision/challenger-teletext.webp', hero: 'https://impeccable.style/worlds/cards/broadcast-programming-teletext-service-hero.webp' },
      { id: 'challenger-microfiche', label: 'Microfiche Reader', verdict: 'declined', lineage: 'library microfiche stations', palette: ['#101418', '#9fb4c0'], materials: ['film grain', 'backlit glass'], case: 'Fuses poorly: listeners do not identify with archival retrieval.', kept: 'Total environmental commitment.', hero: 'https://impeccable.style/worlds/cards/archives-microfiche-reader-hero.webp' },
    ],
    reroll: { registers: ['safer', 'bolder'] },
    buildPath: { value: 'comp', toggle: true },
    canon: true,
    canonCard: { label: 'The category standard', thesis: 'What this category ships, executed impeccably.', palette: ['#ffffff', '#111827', '#2563eb'], materials: ['clean grid', 'product photography'], viewport: 'The arrangement a visitor expects, at full craft.', risk: 'Indistinguishable from the competition by design.', comp: '.impeccable/mocks/decision/canon.webp' },
    steer: true,
  }, null, 2));
  console.log('\nOption ids return verbatim in ANSWER; "reroll" and "canon" are reserved. hero/board/comp accept URLs or local paths; comp slots may point at files that do not exist yet (serve first, generate after; the page polls until they land, so never block serving on generation). hero on a challenger is the inspiration it draws from and renders picture-in-picture beside the comp, never as the promise of the build. verdict routes rendering: "wins" and "competitive" challengers keep full cards, "declined" ones render demoted after them (narrow, quiet, art as a labeled thumb, "Adopt anyway"), with their kept line on the front; the page reorders declined cards to the end on its own. raised on the assigned card renders each donation as a named raise line. Salience parity: when the assigned card declares no comp (no image generation this round), catalog art on every card demotes to a labeled thumb, so what looks important is the verdict’s call, never rendering luck. canonCard renders the standing exit as a subordinate card with the same anatomy; without it, canon stays a quiet footer action. Include canon only for visual-direction rounds; never present it as your own recommendation. The pick card is a kicker convention, not a field: kicker "IMPECCABLE’S PICK" on your top-ranked grounded candidate, one at most, never in the lead slot. Every card gets the full anatomy, challengers, canon, and declined included: thesis, palette, materials, viewport, risk; the seed already hands you each challenger’s system rules, so a card with no palette chips is an authoring gap, not a data gap. Keep thesis and each fact to one short sentence: the card front shows thesis, identity, and a two-line risk, while first viewport and the case read on the card back behind the Details chip, so long facts cost the reader a flip, not the page its scanability. A card with no imagery at all has no back; its full read renders on the front, so a text-only round loses nothing. A card may instead declare "wireframe" ({"cols":12,"rows":10,"regions":[{"label":"nav rail","x":0,"y":0,"w":3,"h":10,"accent":true}]}): the page draws it as a layout schematic in the media slot; surface-scope rounds use it on code-led builds, it never counts toward salience, and the card keeps its full read on the front. The comp slot carries the card’s full-fidelity direction comp (the legacy key "sketch" is accepted as an alias). Comp aspect follows the surface: portrait at device viewport for native or mobile-first surfaces, landscape otherwise; the page adapts its cards to either. reroll accepts true or { "registers": ["safer", "bolder"] }: the register buttons steer the next hand along the familiar-to-bold axis, the answer carries "register", and you re-run concept-seed with --register <value> for the next round; offer the registers on direction rounds, and never pre-select one. buildPath rides the payload as { "value": "comp"|"code", "toggle": true }: the value is the recorded default (.impeccable/config.json buildPath, or .impeccable/config.local.json where one machine differs) and the toggle renders a footer switch whose flip binds that session only; the ANSWER then carries buildPath plus buildPathFlipped. On a code-led round each card still declares its comp path as a flip reserve: wireframes render, and a flip to comp makes --wait return once with BUILD PATH FLIPPED so you generate the comps into the declared slots while the round stays open; a flip back to code is free, and a comp that already landed stays as the critique reference. The toggle may only be offered when image generation exists: a harness with no image tool and no API key never sets toggle: true, so the choice never renders where comps cannot be made, and code-led simply rides as the untoggleable value. followup: true keeps the table open after a pick for a second round via --update; send the next payload immediately, the page is waiting on it.');
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
    // A build-path flip is its own event, not an answer: the round stays
    // open, and the agent's job right now is comps, not code.
    if (fs.existsSync(flipFile(key))) {
      try { fs.rmSync(flipFile(key)); } catch { /* consumed elsewhere */ }
      console.log('BUILD PATH FLIPPED: comp (for this session only; never write it to settings). The table is still open and the page shows shimmer where the images will land: generate each open card’s comp into its declared path now, lead first, then collect the answer with --wait again. A card whose comp already exists needs nothing.');
      process.exit(0);
    }
    if (!alive()) {
      console.log('serve-question: the question server is gone with no answer. This is a server failure, not a user decision: restart it with --start and the same payload, reopen the URL for the user, and wait again. Never proceed without their choice while their browser session is open.');
      process.exit(2);
    }
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
      // A silent page is not a closed one while a freshly delivered next
      // hand sits unclaimed: a stalled page stops beating by design and its
      // watch reloads, beating again, within seconds of the file landing.
      // The suppression is age-bound because a closed tab never claims the
      // hand: a file still there after the grace means no page is coming.
      const midDelivery = (() => {
        try { return Date.now() - fs.statSync(path.join(QUESTION_DIR, `${key}.next.json`)).mtimeMs < NEXT_CLAIM_GRACE_MS; }
        catch { return false; }
      })();
      if (!midDelivery && state.lastBeat && Date.now() - state.lastBeat > 15000) { sawClose = true; break; }
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
  // A re-roll or a followup-round pick keeps the table open: the server stays
  // alive awaiting --update, so only the answer file is consumed. Terminal
  // choices clean up fully.
  let keepsTableOpen = false;
  try {
    const parsedAnswer = JSON.parse(collected);
    keepsTableOpen = parsedAnswer.optionId === 'reroll' || parsedAnswer.followup === true;
  } catch { /* treat as terminal */ }
  try { fs.rmSync(answerFile(key)); } catch { /* already gone */ }
  if (!keepsTableOpen) { try { fs.rmSync(stateFile(key)); } catch { /* already gone */ } }
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
  // A hand the server cannot load must fail here, at the sender: delivered
  // anyway, the page would see ready:true for a round that never renders.
  const nextRound = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  if (!nextRound || !Array.isArray(nextRound.options) || nextRound.options.length === 0) {
    console.error('serve-question: --update payload needs an options array; nothing was delivered. Fix the payload and rerun --update on the same key.');
    process.exit(1);
  }
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
  const deliveredFile = path.join(QUESTION_DIR, `${key}.next.json`);
  fs.copyFileSync(payloadPath, deliveredFile);
  // The file's mtime is the delivery clock --wait's grace reads: stamp it
  // here, because a copy that preserves the source payload's older mtime
  // would start the grace already spent.
  const deliveredAt = new Date();
  fs.utimesSync(deliveredFile, deliveredAt, deliveredAt);
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
// Build path (comp-led vs code-led): the payload carries the recorded
// default; the page's toggle updates the live value per session. The server
// owns both so the final ANSWER states the path and whether it was flipped
// even when the round never rendered a toggle.
let buildPathDefault = null;
let liveBuildPath = null;
// True between a collected re-roll or followup answer and the --update that
// replaces the round: the window where GET / must serve the wait, not the
// answered cards. The timestamp anchors the delivery deadline server-side,
// so a native refresh re-enters the wait with the time already spent, never
// with a fresh allowance.
let awaitingNext = false;
let awaitingNextSince = 0;

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
  // Comps stream in after the page is served, so their slots register
  // whether or not the file exists yet; /img answers 404 until it lands and
  // the page polls the slot. Remote comp URLs pass through untouched.
  const compSrc = (value) => {
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
    compSrc: compSrc(option.comp ?? option.sketch),
  });
  options = parsed.options.map(decorate);
  // The verdict routes rendering: full cards first, then the canon, then the
  // declined cards dead last in their own payload order. The reorder happens
  // here so a payload that interleaves them still renders the weighing's
  // shape, and the deck reads as a gradient of standing: contenders, the
  // familiar door, then the demoted row.
  const declined = options.filter((o) => o.verdict === 'declined');
  options = options.filter((o) => o.verdict !== 'declined');
  // The standing exit as a full card: same anatomy, reserved id, rendered
  // subordinate by the page. Without it, canon stays the quiet footer action.
  if (parsed.canonCard && typeof parsed.canonCard === 'object') {
    options = [...options, { ...decorate(parsed.canonCard), id: 'canon', isCanon: true }];
  }
  options = [...options, ...declined];
  buildPathDefault = (parsed.buildPath && (parsed.buildPath.value === 'comp' || parsed.buildPath.value === 'code'))
    ? { value: parsed.buildPath.value, toggle: parsed.buildPath.toggle === true }
    : null;
  liveBuildPath = buildPathDefault?.value ?? null;
  // Last: a round that failed to load anywhere above must leave the waiting
  // window open, never resurrect the answered cards.
  awaitingNext = false;
}
try { loadRound(raw); } catch (error) { console.error(`serve-question: ${error.message}`); process.exit(1); }
const detachedKey = hasFlag('detached-serve') ? arg('key') : null;
const nextFile = () => detachedKey ? path.join(QUESTION_DIR, `${detachedKey}.next.json`) : null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(waiting = false) {
  // The delivery deadline survives refreshes: a waiting page gets whatever
  // remains of the original allowance, so reloading cannot renew it. Spent
  // means the page renders already stalled and never starts a heartbeat.
  const waitBudgetMs = waiting ? Math.max(0, awaitingNextSince + idleGraceMs - Date.now()) : idleGraceMs;
  const flipChip = (label) => `<button type="button" class="chip flip" aria-label="Flip the card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 5.5V12h6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label}</span></button>`;
  const expandChip = `<button type="button" class="chip expand" aria-label="Expand the image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  // Structured anatomy: chips and one-line facts render when the payload
  // carries them; a plain body falls back to the prose block. Palette chips
  // and material tags give a text-only direction an immediate identity that
  // no generation luck can distort.
  const fact = (label, value, cls = '') => value ? `<p class="fact${cls ? ` ${cls}` : ''}"><span class="fact-label">${label}</span>${esc(value)}</p>` : '';
  const demoted = (option) => option.verdict === 'declined';
  // The build path (comp-led vs code-led) is a workflow preference, not a
  // design decision: the payload carries the recorded default and whether
  // the page offers the toggle. On a code-led round a declared comp path is
  // a flip reserve, not a face: wireframes render, and the slot only starts
  // shimmering when the user flips to comp.
  const buildPath = buildPathDefault;
  const codeLed = buildPath?.value === 'code';
  // Salience parity: a card's imagery weight is capped by the assigned card's.
  // When the lead card has no media at all (no image generation this round,
  // and no catalog art of its own), full-bleed catalog art beside a text-only
  // assigned card would let rendering luck outvote the weighing: users click
  // the colorful thing. Declined cards are thumb-only regardless; the verdict
  // demoted them, and a full-bleed hero would promote them right back.
  const identityRound = !(options[0] && (options[0].compSrc || options[0].heroSrc || options[0].boardSrc));
  // A declined card never renders a full media face, comp included: even a
  // declared comp would buy back the salience the verdict took away.
  const faceComp = (option) => (demoted(option) || codeLed) ? null : option.compSrc;
  const thumbOnly = (option) => !faceComp(option) && Boolean(option.heroSrc || option.boardSrc) && (demoted(option) || identityRound);
  const hasMedia = (option) => Boolean(faceComp(option) || ((option.heroSrc || option.boardSrc) && !thumbOnly(option)));
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
    // Donations from declined challengers render as named raise lines: the
    // assigned card arrives already raised by the hand it beat, and the raise
    // is readable, because a raise nobody can read did not happen. One raise
    // renders inline; several become a compact cycler (click advances), so a
    // generous hand cannot blow the card out of proportion.
    if (Array.isArray(option.raised) && option.raised.length) {
      const nameOf = (id) => options.find((o) => o.id === id)?.label || String(id ?? '');
      const raiseLines = option.raised.slice(0, 6).map((r) => `<p class="raise"><span class="fact-label">From ${esc(nameOf(r.from))}</span>${esc(r.raise || r.kept || '')}</p>`);
      const raisesHead = (count) => `<div class="raises-head"><span class="fact-label">Improved by Impeccable's worlds</span>${count > 1 ? `<span class="raises-count" data-raises-count>1/${count}</span>` : ''}</div>`;
      if (raiseLines.length > 1) {
        rows.push(`<div class="raises raises-cycle" role="button" tabindex="0" title="Click or press Enter for the next improvement" aria-label="How Impeccable's worlds improved this direction; activate to see the next improvement">
              ${raisesHead(raiseLines.length)}
              ${raiseLines.join('')}
              <span class="sr-live" aria-live="polite"></span>
            </div>`);
      } else {
        rows.push(`<div class="raises">${raisesHead(1)}${raiseLines[0]}</div>`);
      }
    }
    // Demoted art stays reachable as a labeled thumb: the catalog world
    // explains where the direction comes from without buying it back the
    // salience the verdict took away.
    if (thumbOnly(option)) {
      rows.push(`<figure class="inspo" title="Inspiration: the world this direction draws from. Your page will not look like this image."><img src="${esc(option.heroSrc || option.boardSrc)}" alt=""><figcaption>inspired by</figcaption></figure>`);
    }
    // The front carries only what the choice needs: thesis, identity, and the
    // honest risk clamped to two lines. First viewport and the case read on
    // the card's back; once the comp lands, the first viewport is a picture.
    // With no art there is no back, so the full read fills the room the
    // image would have taken.
    if (hasMedia(option)) {
      rows.push(fact('Risk', option.risk, 'clamp'));
    } else {
      rows.push(fact('First viewport', option.viewport));
      rows.push(fact('The case', option.case));
      rows.push(fact('Kept', option.kept));
      rows.push(fact('Risk', option.risk));
    }
    if (!option.thesis && option.body) rows.push(`<p class="detail">${esc(option.body)}</p>`);
    else if (option.body && option.thesis && !hasBack(option)) rows.push(`<p class="detail more">${esc(option.body)}</p>`);
    return rows.join('\n            ');
  };
  const backFacts = (option) => [
    fact('First viewport', option.viewport),
    fact('The case', option.case),
    fact('Kept', option.kept),
    fact('Risk', option.risk),
    option.body && option.thesis ? `<p class="detail more">${esc(option.body)}</p>` : '',
  ].filter(Boolean).join('\n            ');
  const media = (option) => {
    const inspirationSrc = option.heroSrc || option.boardSrc;
    const inspiration = inspirationSrc ? `<figure class="pip" title="Inspiration: the world this direction draws from. Your page will not look like this image.">
              <img src="${esc(inspirationSrc)}" alt="">
              <figcaption>inspiration</figcaption>
            </figure>` : '';
    const details = hasBack(option) ? flipChip('Details') : '';
    // Thumb-only art renders inside the body via anatomy(), never as a face,
    // and a declined card's comp slot is ignored outright.
    if (thumbOnly(option)) return '';
    if (faceComp(option)) {
      const textOnlyFacts = backFacts(option);
      return `<div class="media comp-pending" data-comp="${esc(option.compSrc)}">
            <div class="shimmer"><span class="comp-note">rendering&hellip;</span></div>
            <img class="comp" alt="" hidden>
            ${inspiration}
            <template class="text-only-facts">${textOnlyFacts}</template>
            <div class="chips">${expandChip}${details}</div>
          </div>`;
    }
    if (option.heroSrc || option.boardSrc) {
      // Without a comp the catalog art is the card's face; it stays a
      // labeled reference so it never reads as the promise of the build.
      return `<div class="media" title="Inspiration: the world this direction draws from. Your page will not look like this image.">
            <img src="${esc(option.heroSrc || option.boardSrc)}" alt="">
            <p class="media-label">inspiration</p>
            <div class="chips">${expandChip}${details}</div>
          </div>`;
    }
    return '';
  };
  // Wireframe media: a code-led card's layout schematic, authored as grid
  // regions in the payload and drawn by the page; boxes and labels, no art.
  // It fills the media slot only when the card has no imagery, and it never
  // counts toward salience or earns a card back: the full read stays on the
  // front, exactly like a text-only card.
  const wire = (option) => {
    const frame = option.wireframe;
    if (!frame || !Array.isArray(frame.regions) || !frame.regions.length || media(option) || demoted(option)) return '';
    const cols = Number(frame.cols) > 0 ? Number(frame.cols) : 12;
    const rows = Number(frame.rows) > 0 ? Number(frame.rows) : 10;
    const pct = (n, total) => `${Math.max(0, Math.min(100, (n / total) * 100)).toFixed(2)}%`;
    const cells = frame.regions.slice(0, 12).map((region) => {
      const x = Number(region.x) || 0;
      const y = Number(region.y) || 0;
      const w = Math.max(Number(region.w) || 1, 0.5);
      const h = Math.max(Number(region.h) || 1, 0.5);
      return `<div class="wire-region${region.accent ? ' accent' : ''}" style="left:${pct(x, cols)};top:${pct(y, rows)};width:${pct(w, cols)};height:${pct(h, rows)}"><span>${esc(region.label || '')}</span></div>`;
    }).join('');
    return `<div class="media wire" role="img" aria-label="Layout schematic">
            <div class="wire-field">${cells}</div>
            <p class="media-label">layout</p>
          </div>`;
  };
  const chooseLabel = (option) => option.isCanon ? 'Play it straight' : demoted(option) ? 'Adopt anyway' : 'Build this';
  const cards = options.map((option, index) => `
    <article class="card${option.isCanon ? ' canon' : ''}${demoted(option) ? ' declined' : ''}" style="--fan:${index === 0 ? '0deg' : (index % 2 ? '1.4deg' : '-1.2deg')};--deal:${index * 90}ms" data-id="${esc(option.id)}"${codeLed && option.compSrc && !demoted(option) ? ` data-comp-slot="${esc(option.compSrc)}"` : ''}>
      <div class="card-inner">
        <div class="face front${index === 0 ? ' lead' : ''}${(media(option) || wire(option)) ? '' : ' text-only'}">
          ${option.kicker ? `<span class="kicker">${esc(option.kicker)}</span>` : demoted(option) ? '<span class="kicker declined-k">Declined</span>' : option.isCanon ? '<span class="kicker standing">The standing door</span>' : ''}
          ${media(option) || wire(option)}
          <div class="body">
            ${option.lineage ? `<p class="tier">${esc(option.lineage)}</p>` : ''}
            <h2>${esc(option.label)}</h2>
            ${anatomy(option)}
            <button class="choose" data-id="${esc(option.id)}">${chooseLabel(option)}</button>
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
            <button class="choose" data-id="${esc(option.id)}">${chooseLabel(option)}</button>
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
    /* One inset shared by the content column, the deck's snap padding, and
       the sticky footer, so all three align on the same 90rem column. */
    --page-inset: max(clamp(1rem, 5vw, 4rem), calc((100vw - 90rem) / 2));
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--ks-lacquer); color: var(--ks-text); font: 15px/1.55 var(--ks-font); padding: 1.8rem clamp(1rem, 5vw, 4rem) 0; min-height: 100dvh; display: flex; flex-direction: column; overflow-x: clip; }
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
  .headline { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
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
  .grid { --deck-inset: var(--page-inset); display: flex; gap: 1.6rem; width: 100%; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; padding: 6px var(--deck-inset); scroll-padding-inline: var(--deck-inset); align-items: stretch; }
  .grid::-webkit-scrollbar { display: none; }
  /* Wide enough that the comp carries the card: at 27vw the imagery read
     as a thumbnail above a column of copy, and the copy won the attention
     contest the comp is supposed to win. */
  .grid > .card { flex: 0 0 clamp(24rem, 34vw, 34rem); scroll-snap-align: center; }
  /* Short landscape viewports (13-inch laptops): header, a 34vw card, and the
     footer do not fit 800px of height, so the headline compacts and the deck
     narrows. Height is the axis that gives; the sticky footer keeps the
     round's verbs on screen while a too-tall card scrolls. */
  @media (min-aspect-ratio: 1/1) and (max-height: 900px) {
    body { padding-top: 1.1rem; }
    h1 { font-size: clamp(2rem, 3.4vw, 2.9rem); }
    .question { margin-top: .45rem; }
    .stage { gap: 1rem; }
    .grid > .card { flex-basis: clamp(20rem, 27vw, 27rem); }
    .grid > .card.declined { flex-basis: clamp(13rem, 18vw, 18rem); }
  }
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
    /* In the vertical deck the cross axis is horizontal: flex-start would
       shrink a declined card to content WIDTH, not height, so it stretches
       like every other card and its height is already its own. */
    .grid > .card.declined { align-self: stretch; }
    /* The sticky bar is a wide-viewport fix. Here it would sit over the
       deck's More pager and cost a third of a phone screen, and the deck
       already scrolls internally, so the footer stays in the page flow. */
    footer { position: static; width: auto; margin: 1rem 0 0; padding: .7rem 0 1.2rem; background: transparent; border-top: 0; backdrop-filter: none; }
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
  /* 16/10 matches the landscape comp frame; portrait art overrides the
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
  /* Hovering the inspiration takes over the whole media region; the comp is
     the promise, the inspiration is a glance, so the glance must cost nothing. */
  .pip { position: absolute; z-index: 2; left: 10px; bottom: 10px; margin: 0; width: 84px; height: 64px; border: 1px solid var(--ks-rule); border-radius: 6px; overflow: hidden; background: var(--ks-lacquer); cursor: zoom-in; transition: left .35s cubic-bezier(.16,1,.3,1), bottom .35s cubic-bezier(.16,1,.3,1), width .35s cubic-bezier(.16,1,.3,1), height .35s cubic-bezier(.16,1,.3,1), border-radius .35s ease; box-shadow: 0 6px 18px oklch(0% 0 0 / 0.45); }
  .pip img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .pip figcaption { position: absolute; left: 0; right: 0; bottom: 0; font-family: var(--ks-mono); font-size: .5rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text); text-align: center; padding: 3px 0 4px; background: oklch(7% 0.006 95 / 0.72); backdrop-filter: blur(3px); }
  .pip:hover { left: 0; bottom: 0; width: 100%; height: 100%; border-radius: 0; z-index: 3; }
  .comp-note { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--ks-mono); font-size: .66rem; letter-spacing: .22em; text-transform: uppercase; color: var(--ks-text-faint); }
  /* Catalog art standing in for a comp-less card is a reference, and says so
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
     the real comp whenever it lands. */
  .media.stand-in img.comp { filter: brightness(.72) saturate(.85); }
  .media.stand-in .pip { display: none; }
  .stand-in-label { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; margin: 0; font-family: var(--ks-mono); font-size: .56rem; letter-spacing: .2em; text-transform: uppercase; color: var(--ks-text); text-align: center; padding: 4px 0 5px; background: oklch(7% 0.006 95 / 0.78); backdrop-filter: blur(3px); }
  .media.comp-pending { position: relative; }
  .media.comp-pending .shimmer { position: absolute; inset: 0; }
  .media img.comp { position: relative; z-index: 1; }
  /* The generic .media img display:block would defeat [hidden] and float an
     empty block over the shimmer; an unloaded comp must truly not render. */
  .media img[hidden] { display: none; }
  /* Declined challengers: the weighing demoted them, so the card is narrower
     and quieter, its catalog art rides as a labeled thumb in the body, and
     the action reads "Adopt anyway". Adoptable, never deleted: the demoted
     row is the hand's proof of judgment. */
  /* Narrow AND short: without align-self the stretch default drags a thin
     declined card to the tallest contender's height, a strange stilt of a
     card beside the full hand. */
  .grid > .card.declined { flex: 0 0 clamp(15rem, 21vw, 21rem); align-self: flex-start; }
  .card.declined .face { background: var(--ks-graphite); }
  .card.declined:hover .face { border-color: var(--ks-text-faint); }
  .card.declined h2 { font-size: 1rem; color: var(--ks-text); }
  .kicker.declined-k { background: transparent; border: 1px solid var(--ks-rule); color: var(--ks-text-faint); }
  .card.declined button.choose { background: transparent; color: var(--ks-text-muted); border: 1px solid var(--ks-rule); font-size: .85rem; padding: 8px 22px; }
  .card.declined button.choose:hover { background: var(--ks-graphite-2); border-color: var(--ks-text-muted); }
  /* Wireframe media: the code-led schematic. Quiet boxes in the card's own
     chrome; uniform salience across cards by construction, so it needs no
     parity rules. */
  .media.wire { background: var(--ks-lacquer); border-bottom: 1px solid var(--ks-rule); }
  .wire-field { position: absolute; inset: 12px 12px 26px; }
  .wire-region { position: absolute; border: 1px solid oklch(78% 0 0 / 0.26); border-radius: 3px; background: oklch(78% 0 0 / 0.05); display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .wire-region span { font-family: var(--ks-mono); font-size: .55rem; letter-spacing: .1em; text-transform: uppercase; color: var(--ks-text-faint); text-align: center; padding: 2px 4px; }
  .wire-region.accent { border-color: oklch(84% 0.19 80.46 / 0.5); background: oklch(84% 0.19 80.46 / 0.06); }
  .wire-region.accent span { color: var(--ks-kinpaku-rich); }
  /* Thumb-scale inspiration: present, labeled, zoomable, and incapable of
     outshouting a text-only assigned card. */
  .inspo { position: relative; flex: none; margin: 2px 0; width: 104px; height: 64px; border: 1px solid var(--ks-rule); border-radius: 6px; overflow: hidden; cursor: zoom-in; background: var(--ks-lacquer); }
  .inspo img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .inspo figcaption { position: absolute; left: 0; right: 0; bottom: 0; font-family: var(--ks-mono); font-size: .48rem; letter-spacing: .16em; text-transform: uppercase; color: var(--ks-text); text-align: center; padding: 2px 0 3px; background: oklch(7% 0.006 95 / 0.72); }
  /* Raises: the improvements the dealt worlds donated to the assigned
     direction, each named for its donor world. Patina, not kinpaku:
     provenance, not a call to action. A quiet contained panel, never an
     accent side-tab. */
  .raises { display: flex; flex-direction: column; gap: 4px; margin: 2px 0; padding: 7px 10px 8px; background: oklch(70% 0.12 188 / 0.06); border: 1px solid oklch(70% 0.12 188 / 0.22); border-radius: 8px; }
  .raise { font-size: .78rem; color: var(--ks-text-muted); line-height: 1.45; }
  .raise .fact-label { color: var(--ks-patina); }
  /* Several kept ideas cycle instead of stacking: one visible at a time, a
     counter for the rest, the whole block advances on click. */
  .raises-cycle { cursor: pointer; transition: border-color .2s ease; }
  .raises-cycle:hover { border-color: oklch(70% 0.12 188 / 0.45); }
  .raises-cycle .raise { display: none; }
  .raises-cycle .raise.active { display: block; }
  .raises-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .raises-head .fact-label { color: var(--ks-patina); }
  .raises-count { font-family: var(--ks-mono); font-size: .58rem; letter-spacing: .14em; color: var(--ks-text-faint); }
  .raises-count::after { content: " \\203A"; }
  .raises-cycle:hover .raises-count { color: var(--ks-patina); }
  .sr-live { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  /* The standing exit as a card: present with full anatomy, never dressed as a
     contender. Graphite instead of kinpaku, and it never takes the lead ring. */
  .card.canon .face { border-color: var(--ks-rule); background: var(--ks-graphite); }
  .card.canon:hover .face { border-color: var(--ks-text-faint); }
  .card.canon .kicker.standing { background: transparent; border: 1px solid var(--ks-rule); color: var(--ks-text-faint); }
  .card.canon button.choose { background: transparent; color: var(--ks-text); border: 1px solid var(--ks-rule); }
  .card.canon button.choose:hover { border-color: var(--ks-text-muted); background: var(--ks-graphite-2); }
  button.choose { margin-top: auto; align-self: start; background: var(--ks-kinpaku); color: var(--ks-dark-ink); border: 0; font-family: var(--ks-font); font-size: 1rem; font-weight: 500; line-height: 1.35; padding: 10px 38px; border-radius: 6px; cursor: pointer; transition: background .15s; }
  button.choose:hover { background: var(--ks-kinpaku-pale); }
  /* The round's verbs stay reachable on short viewports: the footer is a
     full-bleed bar stuck to the viewport bottom and the deck scrolls under
     it. Same inset as the content column, so the controls stay aligned. */
  footer { position: sticky; bottom: 0; z-index: 10; width: 100vw; margin: 1.2rem calc(50% - 50vw) 0; padding: .7rem var(--page-inset) calc(.7rem + env(safe-area-inset-bottom, 0px)); display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; background: oklch(7% 0.006 95 / 0.82); backdrop-filter: blur(10px); border-top: 1px solid var(--ks-rule); }
  #steer { flex: 1; min-width: 16rem; background: var(--ks-lacquer-raised); color: var(--ks-text); border: 1px solid var(--ks-rule); border-radius: 7px; padding: .6rem .85rem; font: inherit; }
  #steer:focus { outline: none; border-color: var(--ks-patina); }
  /* Build-path toggle: a workflow preference surfaced as a quiet segmented
     control on the headline row, right-aligned opposite the title, its trade stated in
     one line that changes with the selection. The default comes from the
     payload (settings); flipping binds this session only, and the agent
     learns about a code-to-comp flip live. Rendered only when the payload
     offers it, which the agent does only when image generation exists. */
  #build-path { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; flex: none; margin-left: auto; }
  .bp-switch { display: inline-flex; border: 1px solid var(--ks-rule); border-radius: 6px; overflow: hidden; }
  .bp-note { text-align: right; }
  .bp-opt { font-family: var(--ks-mono); font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; padding: 7px 12px; background: transparent; border: 0; color: var(--ks-text-faint); cursor: pointer; transition: color .2s ease, background-color .2s ease; }
  .bp-opt + .bp-opt { border-left: 1px solid var(--ks-rule); }
  .bp-opt.active { color: var(--ks-dark-ink); background: var(--ks-kinpaku-rich); }
  .bp-opt:not(.active):hover { color: var(--ks-text); }
  .bp-note { font-family: var(--ks-mono); font-size: .58rem; letter-spacing: .04em; color: var(--ks-text-faint); max-width: 21rem; line-height: 1.5; }
  /* Flipping to comp starts billed, minutes-long generation, so it asks
     first; flipping back is free and never does. */
  #bp-confirm { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: oklch(4% 0.004 95 / 0.72); opacity: 0; transition: opacity .2s ease; }
  #bp-confirm[hidden] { display: none; }
  #bp-confirm.open { opacity: 1; }
  .bp-confirm-panel { max-width: 26rem; margin: 1rem; background: var(--ks-lacquer-raised); border: 1px solid var(--ks-rule); border-radius: 10px; padding: 1.4rem 1.5rem 1.3rem; box-shadow: 0 30px 80px oklch(0% 0 0 / 0.55); }
  .bp-confirm-panel h2 { font-family: var(--ks-font); font-size: 1.125rem; font-weight: 500; color: var(--ks-champagne); margin-bottom: .55rem; }
  .bp-confirm-panel p { font-size: .875rem; line-height: 1.55; color: var(--ks-text-muted); }
  .bp-confirm-actions { display: flex; gap: .6rem; margin-top: 1.1rem; }
  .bp-confirm-go { background: var(--ks-kinpaku); color: var(--ks-dark-ink); border: 0; font: inherit; font-weight: 500; padding: 9px 22px; border-radius: 6px; cursor: pointer; }
  .bp-confirm-go:hover { background: var(--ks-kinpaku-pale); }
  .bp-confirm-stay { background: transparent; color: var(--ks-text-muted); border: 1px solid var(--ks-rule); font: inherit; padding: 9px 18px; border-radius: 6px; cursor: pointer; }
  .bp-confirm-stay:hover { color: var(--ks-text); border-color: var(--ks-text-faint); }
  .reroll-btn { display: inline-flex; align-items: center; align-self: stretch; gap: 8px; padding: 0 16px; font-family: var(--ks-mono); font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ks-kinpaku); background: transparent; border: 1px solid var(--ks-rule); border-radius: 6px; cursor: pointer; transition: border-color .2s ease, color .2s ease; }
  .reroll-btn:hover { color: var(--ks-kinpaku-pale); border-color: var(--ks-kinpaku-deep); }
  .reroll-btn svg { width: 15px; height: 15px; }
  .reroll-btn[disabled] { opacity: .4; cursor: default; }
  /* The register steers read quieter than the plain roll: they are exits from
     the current register, not the round's main verbs. */
  #reroll-safer, #reroll-bolder { color: var(--ks-text-muted); min-height: 38px; }
  #reroll-safer:hover, #reroll-bolder:hover { color: var(--ks-text); border-color: var(--ks-text-faint); }
  /* The quiet exit: always available, never argued with, visually subordinate
     to the dealt cards and the re-roll so it reads as the user's own door,
     not a recommendation. */
  #canon { align-self: center; padding: 0 4px; font-family: var(--ks-mono); font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: inherit; opacity: .45; background: transparent; border: none; border-bottom: 1px dotted currentColor; cursor: pointer; transition: opacity .2s ease; }
  #canon:hover { opacity: .85; }
  #canon[disabled] { opacity: .18; cursor: default; }
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
<template id="tpl-expand-chip">${expandChip}</template>
${buildPath?.toggle ? `<div id="bp-confirm" role="dialog" aria-modal="true" aria-labelledby="bp-confirm-title" hidden>
  <div class="bp-confirm-panel">
    <h2 id="bp-confirm-title">Flip to comp-first?</h2>
    <p>The agent starts rendering a comp for every open card right away, about a minute or two per card on your image provider, and the images land on the cards as they finish. This flip binds this session only.</p>
    <div class="bp-confirm-actions">
      <button type="button" class="bp-confirm-go" data-confirm>Render comps</button>
      <button type="button" class="bp-confirm-stay" data-cancel>Keep code-first</button>
    </div>
  </div>
</div>` : ''}
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
      ${buildPath?.toggle ? `<div id="build-path" data-default="${buildPath.value}">
        <div class="bp-switch" role="radiogroup" aria-label="Build path">
          <button type="button" class="bp-opt" data-bp="comp" role="radio" aria-checked="false">Comp first</button>
          <button type="button" class="bp-opt" data-bp="code" role="radio" aria-checked="false">Code first</button>
        </div>
        <p class="bp-note" data-bp-note></p>
      </div>` : ''}
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
  ${(() => {
    if (!payload.reroll) return '';
    const die = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8.4" cy="8.4" r="1.5" fill="currentColor"/><circle cx="15.6" cy="8.4" r="1.5" fill="currentColor"/><circle cx="8.4" cy="15.6" r="1.5" fill="currentColor"/><circle cx="15.6" cy="15.6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>';
    const registers = Array.isArray(payload.reroll.registers) ? payload.reroll.registers.filter((r) => r === 'safer' || r === 'bolder') : [];
    // The registers are the user's steering wheel on the familiar-to-bold
    // axis; the plain re-roll sits between them so the spatial order matches
    // the axis it names.
    const safer = registers.includes('safer') ? '<button class="reroll-btn" id="reroll-safer" title="Deal the familiar register: conventional grounded directions plus the category standard against named competitors"><span>&larr; Safer hand</span></button>' : '';
    const bolder = registers.includes('bolder') ? '<button class="reroll-btn" id="reroll-bolder" title="Deal foreign forms only, at full commitment"><span>Bolder hand &rarr;</span></button>' : '';
    return `${safer}<button class="reroll-btn" id="reroll">${die}<span>Re-roll</span></button>${bolder}`;
  })()}
  ${payload.canon && !payload.canonCard ? '<button id="canon" title="Skip the roll: build the page this category ships, executed impeccably">Play it straight</button>' : ''}
</footer>
<script>
  const steer = () => document.getElementById('steer')?.value || '';
  // A followup round's pick keeps the tab: the next round arrives via
  // --update, so the page shows the loading hand instead of goodbye. Detached
  // mode only, and the page must agree with the server: a blocking server
  // exits on any pick and has no update channel, so a followup payload there
  // still gets the goodbye screen, never a loading hand nothing will resolve.
  const FOLLOWUP = ${payload.followup === true && Boolean(detachedKey) ? 'true' : 'false'};
  const beat = () => { try { navigator.sendBeacon('/heartbeat'); } catch { fetch('/heartbeat', { method: 'POST' }); } };
  ${waiting && waitBudgetMs <= 0 ? '' : 'beat();'}
  const beatTimer = setInterval(beat, 5000);
  // A dead server must fail loudly: awaiting a rejected fetch here used to
  // swallow the click and never print the confirmation, so the user believed
  // a choice had landed that no one would ever collect.
  async function answer(optionId) {
    // Quiet at the click: a re-roll or canon posted while this pick's POST
    // is in flight would overwrite the answer being collected.
    document.querySelectorAll('.reroll-btn, #canon').forEach(b => b.setAttribute('disabled', ''));
    try {
      await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId, steer: steer() }) });
    } catch {
      document.body.innerHTML = '<div class="done">The question server went away before this choice could land.<br>Tell the agent your pick in the chat instead.</div>';
      return;
    }
    if (FOLLOWUP) { await awaitNextRound(true); return; }
    document.body.innerHTML = '<div class="done"><svg viewBox="0 0 24 24" width="38" height="38" fill="oklch(84% 0.19 80.46)" aria-hidden="true"><path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"/><path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"/></svg>Choice recorded. The agent is resuming; you can close this tab.</div>';
  }
  document.querySelectorAll('button.choose').forEach(b => b.addEventListener('click', () => answer(b.dataset.id)));
  document.querySelectorAll('.flip').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.closest('.card').classList.toggle('flipped');
  }));

  // Raise cycler: click (or Enter) advances to the next donation.
  document.querySelectorAll('.raises-cycle').forEach(cycle => {
    const raises = [...cycle.querySelectorAll('.raise')];
    const count = cycle.querySelector('[data-raises-count]');
    let at = 0;
    const live = cycle.querySelector('.sr-live');
    const show = (announce) => {
      raises.forEach((raise, i) => raise.classList.toggle('active', i === at));
      if (count) count.textContent = (at + 1) + '/' + raises.length;
      // Screen readers hear the raise they just advanced to; the initial
      // render stays quiet so page load does not narrate every card.
      if (announce && live) live.textContent = 'Improvement ' + (at + 1) + ' of ' + raises.length + ': ' + (raises[at]?.textContent || '');
    };
    show(false);
    const advance = (e) => { e.stopPropagation(); at = (at + 1) % raises.length; show(true); };
    cycle.addEventListener('click', advance);
    cycle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(e); } });
  });

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

  // Comps stream in after the deal: poll each slot until the file lands,
  // then swap the shimmer for the image. Generation is genuinely slow and a
  // sequential batch puts the last card many minutes out, so patience is the
  // default: a slot only shows its inspiration as a stand-in when it has
  // waited four minutes AND nothing has landed anywhere for four minutes, the
  // stand-in is labeled as such, and polling continues so the real comp
  // still swaps in whenever it arrives. Progress anywhere resets patience.
  const landTracker = { last: Date.now() };
  const pollComp = (m) => {
    const url = m.dataset.comp;
    // A converted slot is the SAME node across flip cycles, so a probe from an
    // earlier cycle can still be in flight when the next one starts. Without a
    // generation stamp its late onload settles the new slot: shimmer stripped,
    // pending state cleared, comp still hidden, live poll stopped.
    const generation = String(Number(m.dataset.pollGen || 0));
    const current = () => String(Number(m.dataset.pollGen || 0)) === generation;
    const img = m.querySelector('img.comp');
    const note = m.querySelector('.comp-note');
    const started = Date.now();
    // A live elapsed count is the difference between "working" and "frozen".
    const tick = setInterval(() => { if (note) note.textContent = 'rendering · ' + Math.round((Date.now() - started) / 1000) + 's'; }, 1000);
    const settle = () => { clearInterval(tick); m.classList.remove('comp-pending', 'stand-in'); m.querySelector('.shimmer')?.remove(); m.querySelector('.stand-in-label')?.remove(); };
    const fallback = () => {
      const pip = m.querySelector('.pip img');
      if (pip) {
        if (m.classList.contains('stand-in')) return false;
        img.src = pip.getAttribute('src'); img.hidden = false;
        m.classList.add('stand-in');
        m.querySelector('.shimmer')?.remove();
        clearInterval(tick);
        const label = document.createElement('p');
        label.className = 'stand-in-label';
        label.textContent = 'inspiration · comp pending';
        m.appendChild(label);
        return false;
      }

      // No comp and no inspiration is the text-only card the payload would
      // have rendered without a comp declaration. Bring the complete read
      // forward before removing the now-unreachable back face.
      const card = m.closest('.card');
      const front = card?.querySelector('.face.front');
      const body = front?.querySelector('.body');
      const back = card?.querySelector('.face.back');
      const textOnlyFacts = m.querySelector('template.text-only-facts');
      const choose = body?.querySelector(':scope > button.choose');
      if (body && textOnlyFacts && choose) {
        const plainDetail = body.querySelector(':scope > .detail:not(.more)');
        [...body.children].filter((el) => el.classList.contains('fact') || el.matches('.detail.more')).forEach((el) => el.remove());
        choose.before(textOnlyFacts.content.cloneNode(true));
        if (plainDetail) choose.before(plainDetail);
      }
      card?.classList.remove('flipped');
      front?.classList.add('text-only');
      back?.remove();
      settle();
      m.remove();
      return true;
    };
    const tryLoad = () => {
      // A slot the user flipped back out of either leaves the DOM or, when it
      // was an inspiration face converted in place, stays and loses its
      // pending state. Either way its loop is done.
      if (!m.isConnected || !m.classList.contains('comp-pending') || !current()) { clearInterval(tick); return; }
      const probe = new Image();
      probe.onload = () => {
        // A stale generation also ends this run's clock. tryLoad clears it on
        // re-entry, and an in-flight probe that finishes stale schedules no
        // re-entry, so returning without clearing ran the interval for the rest
        // of the page's life.
        if (!current()) { clearInterval(tick); return; }
        landTracker.last = Date.now();
        const target = m.querySelector('img.comp') || img;
        target.src = probe.src;
        target.hidden = false;
        settle();
      };
      probe.onerror = () => {
        if (!current()) { clearInterval(tick); return; }
        const quiet = Date.now() - landTracker.last > 240000;
        if (Date.now() - started > 240000 && quiet && fallback()) return;
        setTimeout(tryLoad, m.classList.contains('stand-in') ? 5000 : 2500);
      };
      probe.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    };
    tryLoad();
  };
  document.querySelectorAll('.media.comp-pending').forEach(pollComp);

  // Build-path toggle: the default is the round's recorded preference and
  // flipping binds this session only. Flipping code to comp swaps every
  // reserve slot (data-comp-slot) to its shimmer and tells the server, so
  // the waiting agent starts generating; flipping back is free: pending
  // slots return to their wireframes, a comp that already landed stays.
  const bp = document.getElementById('build-path');
  if (bp) {
    const notes = {
      comp: 'An image sets the bar first and the build must match it. Bolder composition; comps render before code.',
      code: 'Code builds directly; the ambition is written into the contract and audited at the finish. Leaner, faster.',
    };
    const noteEl = bp.querySelector('[data-bp-note]');
    let current = bp.dataset.default;
    const set = (value) => {
      current = value;
      bp.querySelectorAll('.bp-opt').forEach(b => {
        const on = b.dataset.bp === value;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
      if (noteEl) noteEl.textContent = notes[value];
    };
    set(current);
    const INSPO_TITLE = 'Inspiration: the world this direction draws from. Your page will not look like this image.';
    // Every media slot carries the expand affordance. A slot built here after
    // the deal used to ship without one, so a comp the user waited minutes for
    // could not be opened.
    const ensureChips = (m) => {
      if (m.querySelector('.chips')) return;
      const tpl = document.getElementById('tpl-expand-chip');
      if (!tpl) return;
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.appendChild(tpl.content.cloneNode(true));
      m.appendChild(chips);
    };
    const shimmerHtml = '<div class="shimmer"><span class="comp-note">rendering&hellip;</span></div><img class="comp" alt="" hidden>';
    const enterComp = () => {
      document.querySelectorAll('.card[data-comp-slot]').forEach(card => {
        const front = card.querySelector('.face.front');
        if (!front || front.querySelector('.media.comp-pending') || front.querySelector('.media img.comp:not([hidden])')) return;
        // On a code-led card the inspiration IS the face. Comp-first demotes it
        // to the corner, so convert that slot in place rather than inserting a
        // second one: two stacked images say the catalog art and the comp are
        // peers, and the whole point of the corner is that they are not.
        const inspo = front.querySelector('.media:not(.wire):not(.comp-pending)');
        let m;
        if (inspo) {
          m = inspo;
          m.dataset.compRestore = 'inspiration';
          m.dataset.comp = card.dataset.compSlot;
          m.classList.add('comp-pending');
          m.removeAttribute('title');
          m.querySelector('.media-label')?.remove();
          const art = m.querySelector(':scope > img');
          if (art) {
            const pip = document.createElement('figure');
            pip.className = 'pip';
            pip.title = INSPO_TITLE;
            const cap = document.createElement('figcaption');
            cap.textContent = 'inspiration';
            pip.append(art, cap);
            m.appendChild(pip);
          }
          m.insertAdjacentHTML('afterbegin', shimmerHtml);
        } else {
          m = document.createElement('div');
          m.className = 'media comp-pending';
          m.dataset.comp = card.dataset.compSlot;
          m.innerHTML = shimmerHtml;
          const wireEl = front.querySelector('.media.wire');
          if (wireEl) { wireEl.hidden = true; front.insertBefore(m, wireEl); }
          else { front.classList.remove('text-only'); front.insertBefore(m, front.querySelector('.body')); }
        }
        ensureChips(m);
        pollComp(m);
      });
    };
    const exitComp = () => {
      document.querySelectorAll('.card[data-comp-slot]').forEach(card => {
        const front = card.querySelector('.face.front');
        const pending = front?.querySelector('.media.comp-pending');
        if (!pending) return; // landed comps stay; they exist either way
        // A converted slot is restored, not removed: the inspiration goes back
        // to being the face, so flipping back leaves the card as it was dealt.
        if (pending.dataset.compRestore === 'inspiration') {
          // Everything the pending state added has to leave, presentation
          // included: a slot that reached stand-in kept its "inspiration comp
          // pending" label beside a fresh one, and a slot whose art had failed
          // came back still marked unavailable.
          pending.classList.remove('comp-pending', 'stand-in');
          delete pending.dataset.compRestore;
          delete pending.dataset.comp;
          pending.dataset.pollGen = String(Number(pending.dataset.pollGen || 0) + 1);
          pending.querySelector('.shimmer')?.remove();
          pending.querySelector('img.comp')?.remove();
          pending.querySelector('.stand-in-label')?.remove();
          pending.querySelectorAll('.media-label').forEach((el) => el.remove());
          const pip = pending.querySelector('.pip');
          const art = pip?.querySelector('img');
          if (art) pending.insertBefore(art, pending.firstChild);
          pip?.remove();
          // No art means the image failed to load before the flip, so hand the
          // slot back to the same honest treatment rather than calling it art.
          const label = document.createElement('p');
          label.className = 'media-label';
          label.textContent = art ? 'inspiration' : 'artwork unavailable';
          pending.insertBefore(label, pending.querySelector('.chips'));
          if (art) pending.title = INSPO_TITLE; else pending.classList.add('unavailable');
          return;
        }
        pending.remove();
        const wireEl = front.querySelector('.media.wire');
        if (wireEl) wireEl.hidden = false;
        else if (!front.querySelector('.media')) front.classList.add('text-only');
      });
    };
    const apply = (value) => {
      set(value);
      fetch('/build-path', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
      if (value === 'comp') enterComp(); else exitComp();
    };
    // Flipping to comp starts real generation, so it confirms first; the
    // flip back is free and applies immediately.
    const confirm = document.getElementById('bp-confirm');
    const closeConfirm = () => { confirm.classList.remove('open'); confirm.hidden = true; };
    confirm.querySelector('[data-confirm]').addEventListener('click', () => { closeConfirm(); apply('comp'); });
    confirm.querySelector('[data-cancel]').addEventListener('click', closeConfirm);
    confirm.addEventListener('click', (e) => { if (e.target === confirm) closeConfirm(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !confirm.hidden) closeConfirm(); });
    bp.querySelectorAll('.bp-opt').forEach(b => b.addEventListener('click', () => {
      const value = b.dataset.bp;
      if (value === current) return;
      if (value === 'comp') {
        confirm.hidden = false;
        requestAnimationFrame(() => confirm.classList.add('open'));
        return;
      }
      apply(value);
    }));
  }

  // A declared image that never loads (missing catalog asset, offline shell)
  // must not sit as a dark void: the slot collapses to the card's own
  // palette, labeled honestly, and the card competes on its facts. Sketch
  // slots are excluded; their polling owns the wait.
  const artFailed = (img) => {
    const m = img.closest('.media');
    if (!m || m.classList.contains('comp-pending') || m.classList.contains('unavailable')) return;
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
  document.querySelectorAll('.media:not(.comp-pending) > img').forEach(img => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) artFailed(img);
    else img.addEventListener('error', () => artFailed(img), { once: true });
  });
  // A broken inspiration PIP or thumb just leaves; nothing depends on it.
  document.querySelectorAll('.pip img, .inspo img').forEach(img => {
    const gone = () => img.closest('.pip, .inspo')?.remove();
    if (img.complete && img.naturalWidth === 0) gone();
    else img.addEventListener('error', gone, { once: true });
  });

  // Every zoom target resolves in ONE delegated listener, in priority order.
  // Delegation is what lets a slot built by a build-path flip work at all, and
  // a single listener is what keeps the targets from fighting: stopPropagation
  // ends bubbling, not other listeners on the same target, so split across two
  // handlers a click on the corner inspiration opened the inspiration and then
  // the comp overwrote it in the lightbox. Per-element handlers elsewhere (the
  // flip chip, the raise cycler) still stop bubbling before the event lands
  // here, so they keep their own behavior.
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    // The corner inspiration wins over the slot it sits inside.
    const pip = target.closest('.pip, .inspo');
    if (pip) {
      const art = pip.querySelector('img');
      if (art) openLightbox(art);
      return;
    }
    const chip = target.closest('.chip');
    if (chip) {
      // Only expand zooms. Any other chip owns its click and must not fall
      // through to the media underneath it.
      if (!chip.classList.contains('expand')) return;
      const card = chip.closest('.card');
      const face = card && card.classList.contains('flipped') ? '.face.back' : '.face.front';
      const shown = card && card.querySelector(face + ' .media img:not([hidden])');
      if (shown && shown.getAttribute('src')) openLightbox(shown);
      return;
    }
    // The whole image is the zoom target, not just the chip; the chip stays as
    // the visible affordance.
    const media = target.closest('.media');
    if (!media) return;
    const art = media.querySelector(':scope > img:not([hidden])');
    if (art && art.getAttribute('src')) openLightbox(art);
  });

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
      const art = card.querySelector('.face.front .media img:not([hidden])') || card.querySelector('.face.front .pip img') || card.querySelector('.face.front .inspo img');
      if (!art || !art.getAttribute('src')) return;
      ambient.style.backgroundImage = 'url("' + art.getAttribute('src') + '")'; ambient.style.opacity = '1';
    });
    card.addEventListener('mouseleave', () => { ambient.style.opacity = '0'; });
  });

  // Expand: lightbox for whichever face is showing.
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox.querySelector('img');
  // Declared, not assigned to a const, so the delegated handlers above can call
  // it wherever they sit in this file.
  function openLightbox(img) {
    lightboxImg.src = img.getAttribute('src');
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('open'));
  }
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
  const closeLightbox = () => { lightbox.classList.remove('open'); setTimeout(() => { lightbox.hidden = true; }, 250); };
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lightbox.hidden) closeLightbox(); });
  document.getElementById('canon')?.addEventListener('click', () => answer('canon'));
  const dealAgain = async (register) => {
    // Quiet at the click, not after the fly-out: the POST round-trip plus
    // the 700ms animation was a window where a second click posted another
    // re-roll and renewed the delivery deadline.
    document.querySelectorAll('.reroll-btn, #canon').forEach(b => b.setAttribute('disabled', ''));
    try {
      await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: 'reroll', steer: steer(), ...(register ? { register } : {}) }) });
    } catch {
      document.body.innerHTML = '<div class="done">The question server went away before this choice could land.<br>Tell the agent your pick in the chat instead.</div>';
      return;
    }
    await awaitNextRound(true);
  };
  async function awaitNextRound(animate, budgetMs = ${idleGraceMs}) {
    const grid = document.querySelector('.grid');
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
      // delivered hand first and only reload when one exists. The re-roll
      // buttons and the canon exit go too: a stalled page served already
      // expired never disabled them, a re-roll would renew the deadline the
      // stall just enforced, and a canon pick would overwrite a re-roll
      // --wait already collected, closing the table under the agent.
      clearInterval(beatTimer);
      document.querySelectorAll('.reroll-btn, #canon').forEach(b => b.setAttribute('disabled', ''));
      // Silence is for heartbeats only: a hand delivered after the deadline
      // must still land without a click, so a beat-free watch keeps checking
      // and reloads into it. /next-status never beats, so the daemon's idle
      // grace still reclaims a flow nobody resumes.
      const watch = setInterval(async () => {
        try { if ((await (await fetch('/next-status')).json()).ready) { clearInterval(watch); location.reload(); } } catch { /* server gone; the screen already says so */ }
      }, 1500);
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
    // A refresh that lands after the delivery deadline has nothing left to
    // wait for: stall before the heartbeat timer's first tick can fire, so
    // the served page stays silent.
    if (budgetMs <= 0) { stall('The next hand never arrived. Check the agent session, then reload.'); return; }
    const cardsNow = [...grid.querySelectorAll('.card')];
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const g = grid.getBoundingClientRect();
      const cx = g.left + g.width / 2, cy = g.top + g.height / 2;
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
    // Canon goes quiet with the re-roll buttons: a pick posted mid-wait can
    // never be collected once --wait has the re-roll, only close the table.
    document.querySelectorAll('.reroll-btn, #canon').forEach(b => b.setAttribute('disabled', ''));
    // The wait must be able to end: a dead server rejects every tick and a
    // round nobody delivers stays ready:false forever, and both used to spin
    // the skeletons indefinitely. Distinguish them, say so, and offer a way
    // out. The delivery deadline is the server's own idle grace, so the page
    // never gives up on a server that would still accept the hand.
    poll = setInterval(async () => {
      try {
        const status = await (await fetch('/next-status')).json();
        misses = 0;
        if (status.ready) { clearInterval(poll); location.reload(); }
        else if (Date.now() - shuffleStart > budgetMs) stall('The next hand never arrived. Check the agent session, then reload.');
      } catch {
        misses += 1;
        if (misses >= 8) stall('The question server went away. Ask the agent to restart it, or answer in the chat instead.');
      }
    }, 1200);
  }
  document.getElementById('reroll')?.addEventListener('click', () => dealAgain());
  document.getElementById('reroll-safer')?.addEventListener('click', () => dealAgain('safer'));
  document.getElementById('reroll-bolder')?.addEventListener('click', () => dealAgain('bolder'));
  // A native refresh must not resurrect an answered round: while the server
  // holds a collected re-roll or followup pick with no replacement delivered,
  // it serves the page in waiting mode and the refresh re-enters the same
  // bounded wait, with only the time the original deadline has left, instead
  // of showing dead cards whose heartbeat props the daemon forever.
  ${waiting ? `awaitNextRound(false, ${waitBudgetMs});` : ''}
</script>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const pending = nextFile();
    if (pending && fs.existsSync(pending)) {
      // A next file the round cannot load has to leave the disk either way:
      // kept, /next-status stays ready:true and the waiting page reloads
      // into the same failure without bound.
      try { loadRound(fs.readFileSync(pending, 'utf8')); } catch { /* keep current round */ }
      try { fs.rmSync(pending); } catch { /* already gone */ }
      // The claim consumes the file the idle-exit hold reads, and the
      // reloading page cannot beat until it has parsed: stamp the claim so
      // the same bounded grace covers the gap between them.
      server.lastClaimAt = Date.now();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page(awaitingNext));
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
  if (req.method === 'POST' && req.url === '/build-path') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      let value = null;
      try { value = JSON.parse(body).value; } catch { /* ignore */ }
      if (value !== 'comp' && value !== 'code') return;
      const wasComp = liveBuildPath === 'comp';
      liveBuildPath = value;
      // Only a flip TO comp needs the agent mid-round: comps must start
      // rendering into the declared slots. The reverse is free.
      if (detachedKey && value === 'comp' && !wasComp) {
        fs.mkdirSync(QUESTION_DIR, { recursive: true });
        fs.writeFileSync(flipFile(detachedKey), JSON.stringify({ buildPath: 'comp' }) + '\n');
      }
    });
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
      const isReroll = parsed.optionId === 'reroll';
      // A followup round's pick is not terminal: the table stays open for the
      // next round (--update), exactly like a re-roll. Detached mode only;
      // the blocking mode has no update channel, so its picks stay terminal.
      const followupOpen = Boolean(detachedKey) && payload.followup === true && !isReroll;
      const answer = JSON.stringify({
        optionId: parsed.optionId ?? null,
        steer: parsed.steer ?? '',
        ...(isReroll && (parsed.register === 'safer' || parsed.register === 'bolder') ? { register: parsed.register } : {}),
        ...(followupOpen ? { followup: true } : {}),
        ...(chosen?.hero || chosen?.board ? { hero: chosen.hero ?? null, board: chosen.board ?? null } : {}),
        ...((chosen?.comp ?? chosen?.sketch) ? { comp: chosen.comp ?? chosen.sketch } : {}),
        ...(liveBuildPath && !isReroll ? { buildPath: liveBuildPath, buildPathFlipped: liveBuildPath !== (buildPathDefault?.value ?? null) } : {}),
      });
      // The delivery deadline is single-issue: a duplicate answer racing the
      // page's disable must not restamp the allowance already inherited.
      const wasAwaiting = awaitingNext;
      awaitingNext = (isReroll || followupOpen) && Boolean(detachedKey);
      if (awaitingNext && !wasAwaiting) awaitingNextSince = Date.now();
      if (detachedKey) {
        fs.mkdirSync(QUESTION_DIR, { recursive: true });
        fs.writeFileSync(answerFile(detachedKey), answer + '\n');
      } else {
        printAnswer(answer);
      }
      // A re-roll or followup pick in detached mode keeps the table open: the
      // client shows a loading hand and reloads when --update delivers the
      // next round.
      if (!((isReroll || followupOpen) && detachedKey)) setTimeout(() => process.exit(0), 150);
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
      // A hand delivered moments before this deadline still gets its claim
      // window: the stalled page's watch reloads into it and beats again
      // within seconds, while a file unclaimed past the grace means no page
      // is coming back (the same verdict --wait reads from its age). The
      // claim itself holds the daemon too: GET / deletes the file before the
      // reloaded page can beat, so a tick in that gap must not exit under
      // the hand just claimed.
      const pending = nextFile();
      let deliveredAt = 0;
      if (pending) { try { deliveredAt = fs.statSync(pending).mtimeMs; } catch { /* nothing delivered */ } }
      if (Date.now() - Math.max(deliveredAt, server.lastClaimAt || 0) > NEXT_CLAIM_GRACE_MS) {
        console.log('serve-question: the page stopped beating and never came back; exiting');
        process.exit(2);
      }
    }
  }, 2000);
  lifetime.unref?.();
});
