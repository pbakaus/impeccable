import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

import { browserOpenCommand, openSystemBrowser } from '../skill/scripts/lib/open-system-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'skill', 'scripts', 'serve-question.mjs');

function startServer(payload, extraArgs = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
  const payloadPath = path.join(dir, 'q.json');
  writeFileSync(payloadPath, JSON.stringify(payload));
  const child = spawn(process.execPath, [SCRIPT, '--payload', payloadPath, '--no-open', '--timeout', '30', ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no URL in output: ${out}`)), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/QUESTION URL: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) { clearTimeout(timer); resolve({ child, url: match[1], read: () => out }); }
    });
  });
}

const PAYLOAD = {
  title: 'Choose the visual world',
  question: 'The roll assigned Fillmore Handbill.',
  options: [
    { id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL', lineage: '1966-71 psychedelic handbills' },
    { id: 'challenger-1', label: 'Teletext Service', body: 'block-mosaic broadcast pages' },
  ],
  reroll: true,
  steer: true,
};

function rawRequest(port, { method = 'GET', path: reqPath = '/', headers = {} } = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('serve-question', () => {
  it('opens Windows URLs through cmd.exe and reserves the start title argument', () => {
    assert.deepEqual(
      browserOpenCommand('http://127.0.0.1:1234/', { platform: 'win32', comspec: 'cmd.exe' }),
      { command: 'cmd.exe', args: ['/c', 'start', '', 'http://127.0.0.1:1234/'] },
    );
  });

  it('absorbs asynchronous system-opener failures after printing the URL', () => {
    const child = new EventEmitter();
    child.unref = () => {};
    assert.equal(openSystemBrowser('http://127.0.0.1:1234/', {
      platform: 'linux',
      spawnImpl: () => child,
    }), true);
    assert.equal(child.listenerCount('error'), 1);
    assert.doesNotThrow(() => child.emit('error', Object.assign(new Error('missing opener'), { code: 'ENOENT' })));
  });

  it('serves the page, records the answer, prints ANSWER, exits 0', async () => {
    const { child, url, read } = await startServer(PAYLOAD);
    const html = await (await fetch(url)).text();
    assert.match(html, /Fillmore Handbill/);
    assert.match(html, /THE ROLL/);
    assert.match(html, /Re-roll/);
    const post = await fetch(`${url}answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'assigned', steer: 'warmer palette' }),
    });
    assert.equal(post.status, 200);
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
    assert.match(read(), /ANSWER: \{"optionId":"assigned","steer":"warmer palette"\}/);
  });

  it('re-roll answers round-trip with their own id', async () => {
    const { child, url, read } = await startServer(PAYLOAD);
    await fetch(`${url}answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'reroll', steer: '' }),
    });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
    assert.match(read(), /"optionId":"reroll"/);
  });

  it('start/wait cycle: daemonize, poll WAITING, then collect the answer', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('exit', (code) => resolve({ code, out }));
    });
    const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', 'tk']);
    assert.equal(started.code, 0);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started.out);
    const waiting = await run(['--wait', '--key', 'tk', '--poll', '1']);
    assert.equal(waiting.code, 3);
    await fetch(`${url}answer?key=tk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: 'assigned', steer: '' }) });
    const collected = await run(['--wait', '--key', 'tk', '--poll', '5']);
    assert.equal(collected.code, 0);
    assert.match(collected.out, /"optionId":"assigned"/);
  });

  it('rejects detached POSTs without the session key or with bad Host/Origin', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    const key = 'seckey';
    const answerPath = path.join(dir, '.impeccable', 'questions', `${key}.answer.json`);
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('exit', (code) => resolve({ code, out }));
    });
    const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', key]);
    assert.equal(started.code, 0);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started.out);
    const port = Number(new URL(url).port);
    const goodHost = `127.0.0.1:${port}`;
    const body = JSON.stringify({ optionId: 'assigned', steer: '' });
    const jsonHeaders = { 'content-type': 'application/json', Host: goodHost };

    const noKey = await fetch(`http://${goodHost}/answer`, { method: 'POST', headers: jsonHeaders, body });
    assert.equal(noKey.status, 401);
    assert.equal(existsSync(answerPath), false);
    const waiting = await run(['--wait', '--key', key, '--poll', '1']);
    assert.equal(waiting.code, 3);

    const wrongKey = await fetch(`http://${goodHost}/answer?key=wrong`, { method: 'POST', headers: jsonHeaders, body });
    assert.equal(wrongKey.status, 401);

    const evilOrigin = await rawRequest(port, {
      method: 'POST',
      path: `/answer?key=${key}`,
      headers: { ...jsonHeaders, Origin: 'https://evil.example' },
    }, body);
    assert.equal(evilOrigin.status, 403);
    assert.equal(existsSync(answerPath), false);

    const spoofedHostPost = await rawRequest(port, {
      method: 'POST',
      path: `/answer?key=${key}`,
      headers: { ...jsonHeaders, Host: `evil.example:${port}` },
    }, body);
    assert.equal(spoofedHostPost.status, 403);

    const noKeyBeat = await fetch(`http://${goodHost}/heartbeat`, { method: 'POST', headers: { Host: goodHost } });
    assert.equal(noKeyBeat.status, 401);

    const spoofedHostGet = await rawRequest(port, {
      path: '/',
      headers: { Host: `evil.example:${port}` },
    });
    assert.equal(spoofedHostGet.status, 403);

    // The bare-host allowance exists only for --port 80, where browsers omit
    // the suffix; on any other port a portless Host stays rejected.
    const bareHostGet = await rawRequest(port, {
      path: '/',
      headers: { Host: '127.0.0.1' },
    });
    assert.equal(bareHostGet.status, 403);

    const slashSlash = await rawRequest(port, {
      path: '//',
      headers: { Host: goodHost },
    });
    assert.equal(slashSlash.status, 400);
    assert.equal((await fetch(url)).status, 200);

    // The build-path flip commands the agent through --wait, so it takes the
    // same key and Origin gate as /answer.
    const flipPath = path.join(dir, '.impeccable', 'questions', `${key}.flip.json`);
    const flipBody = JSON.stringify({ value: 'comp' });
    const noKeyFlip = await fetch(`http://${goodHost}/build-path`, { method: 'POST', headers: jsonHeaders, body: flipBody });
    assert.equal(noKeyFlip.status, 401);
    assert.equal(existsSync(flipPath), false);
    const evilOriginFlip = await rawRequest(port, {
      method: 'POST',
      path: `/build-path?key=${key}`,
      headers: { ...jsonHeaders, Origin: 'https://evil.example' },
    }, flipBody);
    assert.equal(evilOriginFlip.status, 403);
    assert.equal(existsSync(flipPath), false);
    const okFlip = await fetch(`http://${goodHost}/build-path?key=${key}`, { method: 'POST', headers: jsonHeaders, body: flipBody });
    assert.equal(okFlip.status, 200);
    assert.equal(existsSync(flipPath), true);
    const flipped = await run(['--wait', '--key', key, '--poll', '2']);
    assert.equal(flipped.code, 0);
    assert.match(flipped.out, /BUILD PATH FLIPPED/);

    const html = await (await fetch(url)).text();
    assert.match(html, /const KEY = "seckey"/);
    assert.match(html, /\/answer' \+ keyQ/);
    assert.match(html, /\/heartbeat' \+ keyQ/);
    assert.match(html, /\/build-path' \+ keyQ/);

    const ok = await fetch(`http://${goodHost}/answer?key=${key}`, { method: 'POST', headers: jsonHeaders, body });
    assert.equal(ok.status, 200);
    const collected = await run(['--wait', '--key', key, '--poll', '5']);
    assert.equal(collected.code, 0);
    assert.match(collected.out, /"optionId":"assigned"/);
  });

  it('headless detection spares the modes that never open a browser', async () => {
    // Only the blocking serve path auto-opens a URL. --wait polls a daemon
    // that is already running, --stop kills one, --schema just prints text,
    // so a headless environment must not turn any of them into exit 2: the
    // documented flow polls --wait while it exits 3, and new-work.md tells
    // the agent to read --schema first.
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const headlessEnv = { ...process.env, CI: '1' };
    delete headlessEnv.IMPECCABLE_QUESTION_FORCE;
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, env: headlessEnv, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('exit', (code) => resolve({ code, out }));
    });

    const schema = await run(['--schema']);
    assert.equal(schema.code, 0, `--schema under CI must print, got ${schema.code}: ${schema.out}`);

    const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', 'hk']);
    assert.equal(started.code, 0, started.out);
    try {
      const waiting = await run(['--wait', '--key', 'hk', '--poll', '1']);
      assert.equal(waiting.code, 3, `--wait under CI must report WAITING, got ${waiting.code}: ${waiting.out}`);
    } finally {
      const stopped = await run(['--stop', '--key', 'hk']);
      assert.equal(stopped.code, 0, `--stop under CI must kill the daemon, got ${stopped.code}: ${stopped.out}`);
    }
  });

  it('headless detection still blocks the path that would open a browser', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const headlessEnv = { ...process.env, CI: '1' };
    delete headlessEnv.IMPECCABLE_QUESTION_FORCE;
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--payload', payloadPath], { cwd: dir, env: headlessEnv, stdio: 'ignore' });
      child.on('exit', resolve);
    });
    assert.equal(code, 2);
  });

  it('rejects an empty payload', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify({ options: [] }));
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--payload', payloadPath, '--no-open'], { stdio: 'ignore' });
      child.on('exit', resolve);
    });
    assert.equal(code, 1);
  });

  it('trusts a fresh heartbeat over a failed kill probe, and still detects true death', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const qdir = path.join(dir, '.impeccable', 'questions');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(qdir, { recursive: true });
    // Fresh heartbeat + a pid that cannot be signaled (throws like a sandbox
    // EPERM or a recycled pid): the wait must keep WAITING (exit 3), never
    // declare the server gone (exit 2). Pid 1 throws EPERM for a normal user.
    writeFileSync(path.join(qdir, 'beat1.state.json'), JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/', lastBeat: Date.now() }));
    const waiting = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--wait', '--key', 'beat1', '--poll', '2'], { cwd: dir, stdio: 'ignore' });
      child.on('exit', resolve);
    });
    assert.equal(waiting, 3, 'fresh heartbeat must read as alive regardless of the kill probe');
    // Stale heartbeat + a pid that is genuinely gone (ESRCH): server dead, exit 2.
    writeFileSync(path.join(qdir, 'dead1.state.json'), JSON.stringify({ pid: 999999999 >>> 8, port: 1, url: 'http://127.0.0.1:1/' }));
    const dead = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--wait', '--key', 'dead1', '--poll', '2'], { cwd: dir, stdio: 'ignore' });
      child.on('exit', resolve);
    });
    assert.equal(dead, 2, 'a truly missing process must still read as gone');
  });

  it('renders anatomy, streams late comps, and returns the chosen comp', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const compPath = path.join(dir, 'comps', 'assigned.webp');
    const payload = {
      title: 'Choose the visual world',
      options: [
        {
          id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL',
          thesis: 'The gig poster idea.', palette: ['#e8452c', '#f5d64c'], materials: ['letterpress'],
          viewport: 'Full-bleed dated bill.', risk: 'Nostalgia trap.',
          // The legacy key: a payload authored against the sketch-era schema
          // must keep rendering, so the lead card declares its comp as `sketch`.
          sketch: compPath, hero: 'https://impeccable.style/worlds/cards/x-hero.webp',
        },
        { id: 'challenger-1', label: 'Teletext Service', case: 'Fuses cleanly.' },
      ],
      reroll: true,
      canon: true,
      canonCard: { label: 'The category standard', thesis: 'What the category ships.' },
      steer: true,
      followup: true,
    };
    const { child, url, read } = await startServer(payload);
    const html = await (await fetch(url)).text();
    // Anatomy renders: chips, tags, fact labels, thesis.
    assert.match(html, /swatches/);
    // A blocking server has no update channel, so even a followup payload
    // must not arm the page's loading-hand path (detached mode arms it; the
    // new-work e2e suite covers that side).
    assert.match(html, /const FOLLOWUP = false/);
    assert.match(html, /background:#e8452c/);
    assert.match(html, /class="tag">letterpress/);
    assert.match(html, /The gig poster idea\./);
    assert.match(html, /Fuses cleanly\./);
    // The inspiration image rides picture-in-picture beside the comp slot.
    assert.match(html, /class="pip"/);
    assert.match(html, /media comp-pending/);
    // canonCard renders as a subordinate card and suppresses the footer action.
    assert.match(html, /card canon/);
    assert.match(html, /Play it straight</);
    assert.doesNotMatch(html, /<button id="canon"/);
    // The comp slot 404s until the file lands, then serves it.
    const slot = html.match(/data-comp="(\/img\/\d+)"/)?.[1];
    assert.ok(slot, 'comp slot registered before the file exists');
    assert.equal((await fetch(url.replace(/\/$/, '') + slot)).status, 404);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(compPath), { recursive: true });
    writeFileSync(compPath, 'RIFFxxxxWEBP');
    assert.equal((await fetch(url.replace(/\/$/, '') + slot)).status, 200);
    // The page polls with a cache-busting query; the route must tolerate it.
    assert.equal((await fetch(url.replace(/\/$/, '') + slot + '?t=1')).status, 200);
    // The answer carries the chosen card's comp for comp seeding, under the
    // canonical key even when the payload declared it with the legacy one.
    await fetch(`${url}answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'assigned', steer: '' }),
    });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
    assert.match(read(), /"comp":/);
    assert.match(read(), /CHOSEN COMP:/);
  });
});
