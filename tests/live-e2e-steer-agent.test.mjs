/**
 * Steer handler unit tests (no Playwright).
 * Run with: node --test tests/live-e2e-steer-agent.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFakeAgent, findSteerTargetFile, runAgentLoop, STEER_MARKER_ATTR } from './live-e2e/agent.mjs';
import { stageFixture, startLiveServer, stopLiveServer, FIXTURES_DIR } from './live-e2e/session.mjs';
import { SCRIPTS_DIR } from './live-e2e/session.mjs';

const FIXTURE_NAME = 'vite8-react-plain';

describe('live-e2e steer agent handler', () => {
  let tmp;
  let live;
  let abort;
  let loopDone;

  before(async () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, FIXTURE_NAME, 'fixture.json'), 'utf-8'));
    tmp = stageFixture(FIXTURE_NAME, fixture);
    live = startLiveServer(tmp);
    abort = new AbortController();
    loopDone = runAgentLoop({
      tmp,
      scriptsDir: SCRIPTS_DIR,
      port: live.port,
      token: live.token,
      agent: createFakeAgent(),
      signal: abort.signal,
      log: () => {},
    });
  });

  after(async () => {
    abort?.abort();
    await loopDone?.catch(() => {});
    if (live) stopLiveServer(tmp);
  });

  it('findSteerTargetFile locates the hero source file', () => {
    const file = findSteerTargetFile(tmp);
    assert.match(file, /App\.jsx$/);
    const body = readFileSync(file, 'utf-8');
    assert.match(body, /hero-title/);
  });

  it('agent loop handles steer POST and writes the marker', async () => {
    const sourceFile = findSteerTargetFile(tmp);
    const before = readFileSync(sourceFile, 'utf-8');
    assert.doesNotMatch(before, new RegExp(STEER_MARKER_ATTR + '="e2e"'));

    const post = await fetch(`http://127.0.0.1:${live.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: live.token,
        type: 'steer',
        id: 'cafebabe',
        message: 'steer-e2e mark hero',
        pageUrl: 'http://127.0.0.1:5173/',
      }),
    });
    assert.equal(post.status, 200);

    const deadline = Date.now() + 10_000;
    let updated = before;
    while (Date.now() < deadline) {
      updated = readFileSync(sourceFile, 'utf-8');
      if (updated.includes(`${STEER_MARKER_ATTR}="e2e"`)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(
      updated,
      new RegExp(STEER_MARKER_ATTR + '="e2e"'),
      'fake agent should mark hero after steer event',
    );
  });
});
