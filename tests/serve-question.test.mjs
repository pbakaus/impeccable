import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
    await fetch(`${url}answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: 'assigned', steer: '' }) });
    const collected = await run(['--wait', '--key', 'tk', '--poll', '5']);
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
      // --update delivers a re-rolled hand to a page that is already open; a
      // headless gate that eats it strands that page mid-shuffle (issue #469).
      const updated = await run(['--update', '--key', 'hk', '--payload', payloadPath]);
      assert.equal(updated.code, 0, `--update under CI must deliver, got ${updated.code}: ${updated.out}`);
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

  it('a heartbeating page keeps the daemon alive past --timeout; silence ends it after the idle grace', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('exit', (code) => resolve({ code, out }));
    });
    const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', 'life', '--timeout', '3', '--idle-grace', '3']);
    assert.equal(started.code, 0, started.out);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started.out);
    // Beat well past the 3s timeout: the timer must not fire under a live page.
    const beatUntil = Date.now() + 5500;
    while (Date.now() < beatUntil) {
      await fetch(`${url}heartbeat`, { method: 'POST' });
      await new Promise((r) => setTimeout(r, 400));
    }
    const alive = await fetch(url);
    assert.equal(alive.status, 200, 'the daemon outlives --timeout while the page heartbeats');
    // Then silence: the idle grace (3s here) plus the 2s check interval pass
    // with no beat, and the daemon must exit rather than leak. Poll rather
    // than sleep a fixed margin so a loaded runner cannot flake this.
    const deadline = Date.now() + 12000;
    let gone = false;
    while (Date.now() < deadline && !gone) {
      await new Promise((r) => setTimeout(r, 500));
      try { await fetch(url); } catch { gone = true; }
    }
    assert.ok(gone, 'the daemon exits after the idle grace passes with no heartbeat');
  });

  it('a page that never opens still ends the daemon at --timeout', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('exit', (code) => resolve({ code, out }));
    });
    const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', 'leak', '--timeout', '1']);
    assert.equal(started.code, 0, started.out);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    const deadline = Date.now() + 8000;
    let gone = false;
    while (Date.now() < deadline && !gone) {
      await new Promise((r) => setTimeout(r, 500));
      try { await fetch(url); } catch { gone = true; }
    }
    assert.ok(gone, 'with no heartbeat ever, the daemon still exits at --timeout');
  });

  it('--timeout 0 waits for a page forever, but a page that beat and went silent still ends the daemon', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const payloadPath = path.join(dir, 'q.json');
    writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
    const run = (args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('exit', (code) => resolve({ code, out }));
    });
    const started = await run(['--start', '--payload', payloadPath, '--no-open', '--key', 'zero', '--timeout', '0', '--idle-grace', '3']);
    assert.equal(started.code, 0, started.out);
    const url = started.out.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started.out);
    // No page yet: --timeout 0 means wait indefinitely, so the daemon must
    // survive well past where any small timeout would have fired.
    await new Promise((r) => setTimeout(r, 3000));
    const alive = await fetch(url);
    assert.equal(alive.status, 200, 'with --timeout 0 and no page yet, the daemon keeps waiting');
    // One beat, then silence: the idle grace must still reclaim the daemon.
    // Before the fix, the whole lifetime check sat inside timeoutSec > 0 and
    // a closed tab leaked this daemon forever.
    await fetch(`${url}heartbeat`, { method: 'POST' });
    const deadline = Date.now() + 12000;
    let gone = false;
    while (Date.now() < deadline && !gone) {
      await new Promise((r) => setTimeout(r, 500));
      try { await fetch(url); } catch { gone = true; }
    }
    assert.ok(gone, 'the idle grace applies under --timeout 0 once a page has beat');
  });

  it('--update trusts a fresh heartbeat over a failed kill probe, and still detects true death', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const qdir = path.join(dir, '.impeccable', 'questions');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(qdir, { recursive: true });
    const nextPath = path.join(dir, 'next.json');
    writeFileSync(nextPath, JSON.stringify(PAYLOAD));
    const run = (key) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--update', '--key', key, '--payload', nextPath], { cwd: dir, stdio: 'ignore' });
      child.on('exit', resolve);
    });
    // Fresh heartbeat + a pid the sandbox cannot signal (pid 1 throws EPERM):
    // --update is the documented re-roll delivery step, so a false "no live
    // server" here strands the page mid-shuffle. Must deliver, exit 0.
    writeFileSync(path.join(qdir, 'upbeat.state.json'), JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/', lastBeat: Date.now() }));
    assert.equal(await run('upbeat'), 0, 'fresh heartbeat must read as alive regardless of the kill probe');
    assert.ok(existsSync(path.join(qdir, 'upbeat.next.json')), 'the next hand landed');
    // Stale heartbeat + a genuinely dead pid: exit 2, nothing delivered.
    writeFileSync(path.join(qdir, 'updead.state.json'), JSON.stringify({ pid: 999999999 >>> 8, port: 1, url: 'http://127.0.0.1:1/' }));
    assert.equal(await run('updead'), 2, 'a truly missing process must still read as gone');
    assert.ok(!existsSync(path.join(qdir, 'updead.next.json')), 'no hand is delivered to a dead server');
  });

  it('renders anatomy, streams late sketches, and returns the chosen sketch', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serve-question-'));
    const sketchPath = path.join(dir, 'sketches', 'assigned.webp');
    const payload = {
      title: 'Choose the visual world',
      options: [
        {
          id: 'assigned', label: 'Fillmore Handbill', kicker: 'THE ROLL',
          thesis: 'The gig poster idea.', palette: ['#e8452c', '#f5d64c'], materials: ['letterpress'],
          viewport: 'Full-bleed dated bill.', risk: 'Nostalgia trap.',
          sketch: sketchPath, hero: 'https://impeccable.style/worlds/cards/x-hero.webp',
        },
        { id: 'challenger-1', label: 'Teletext Service', case: 'Fuses cleanly.' },
      ],
      reroll: true,
      canon: true,
      canonCard: { label: 'The category standard', thesis: 'What the category ships.' },
      steer: true,
    };
    const { child, url, read } = await startServer(payload);
    const html = await (await fetch(url)).text();
    // Anatomy renders: chips, tags, fact labels, thesis.
    assert.match(html, /swatches/);
    assert.match(html, /background:#e8452c/);
    assert.match(html, /class="tag">letterpress/);
    assert.match(html, /The gig poster idea\./);
    assert.match(html, /Fuses cleanly\./);
    // The inspiration image rides picture-in-picture beside the sketch slot.
    assert.match(html, /class="pip"/);
    assert.match(html, /media sketching/);
    // canonCard renders as a subordinate card and suppresses the footer action.
    assert.match(html, /card canon/);
    assert.match(html, /Play it straight</);
    assert.doesNotMatch(html, /<button id="canon"/);
    // The sketch slot 404s until the file lands, then serves it.
    const slot = html.match(/data-sketch="(\/img\/\d+)"/)?.[1];
    assert.ok(slot, 'sketch slot registered before the file exists');
    assert.equal((await fetch(url.replace(/\/$/, '') + slot)).status, 404);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(sketchPath), { recursive: true });
    writeFileSync(sketchPath, 'RIFFxxxxWEBP');
    assert.equal((await fetch(url.replace(/\/$/, '') + slot)).status, 200);
    // The page polls with a cache-busting query; the route must tolerate it.
    assert.equal((await fetch(url.replace(/\/$/, '') + slot + '?t=1')).status, 200);
    // The answer carries the chosen card's sketch for comp seeding.
    await fetch(`${url}answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'assigned', steer: '' }),
    });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
    assert.match(read(), /"sketch":/);
    assert.match(read(), /CHOSEN SKETCH:/);
  });
});
