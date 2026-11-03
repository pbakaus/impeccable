import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../crates/browser/src/motion.js', import.meta.url), 'utf8');
function harness(setup = () => {}, pendingPause = false) {
  const animations = [];
  class Element {
    constructor() { this.id = 'card'; }
    animate() {
      const a = {
        currentTime: 0, playbackRate: 1, playState: 'running',
        effect: { target: this, getComputedTiming: () => ({ endTime: 600, delay: 0, duration: 600, iterations: 1 }), getKeyframes: () => [] },
        pause() { this.playState = 'paused'; },
        finish() { this.currentTime = this.playbackRate < 0 ? 0 : 600; this.playState = 'finished'; }
      };
      if (pendingPause) {
        let current = a.currentTime, completePause;
        Object.defineProperty(a, 'currentTime', { get: () => current, set: value => { current = value; completePause?.(); } });
        a.pause = () => { a.playState = 'paused'; a.ready = new Promise(resolve => { completePause = resolve; }); };
      }
      animations.push(a);
      return a;
    }
  }
  const context = { Element, document: { getAnimations: () => animations, children: [] }, CSS: { escape: s => s },
    requestAnimationFrame: fn => fn(), setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout };
  setup(() => new Element().animate());
  vm.createContext(context);
  vm.runInContext(source, context);
  return { motion: context.__impeccableMotion, create: () => new Element().animate() };
}

test('capture uses playback rate and current position as wall-clock timing', async () => {
  for (const [rate, origin, duration, halfway] of [[5, 0, 120, 300], [0.5, 100, 1000, 350], [-2, 600, 300, 300], [0, 200, 0, 200]]) {
    const { motion, create } = harness();
    const animation = create();
    animation.playbackRate = rate;
    animation.currentTime = origin;
    assert.equal((await motion.ready()).duration, duration, `rate ${rate}, origin ${origin}`);
    await motion.seek(duration / 2);
    assert.equal(animation.currentTime, halfway, `seek rate ${rate}`);
  }
});

test('finished filled entrances remain at rest while a new interaction is captured', async () => {
  let entrance;
  const { motion, create } = harness(make => {
    entrance = make();
    entrance.currentTime = 600;
    entrance.playState = 'finished';
  });
  const interaction = create();
  interaction.playbackRate = 5;
  assert.equal((await motion.ready()).duration, 120);
  await motion.seek(60);
  assert.equal(entrance.currentTime, 600);
  assert.equal(entrance.playState, 'finished');
  assert.equal(interaction.currentTime, 300);
});

test('pausing preserves position and resolves a pending pause on a frozen timeline', async () => {
  const { motion, create } = harness(() => {}, true);
  const animation = create();
  animation.playbackRate = 5;
  const result = await Promise.race([motion.ready(), new Promise(resolve => setTimeout(() => resolve('pending'), 30))]);
  assert.notEqual(result, 'pending');
  assert.equal(result.duration, 120);
});
