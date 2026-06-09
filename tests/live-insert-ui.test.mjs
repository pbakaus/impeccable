/**
 * Unit tests for live-insert-ui.mjs
 * Run with: node --test tests/live-insert-ui.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEHOLDER_DEFAULT_HEIGHT,
  PLACEHOLDER_MIN_HEIGHT,
  PLACEHOLDER_MIN_WIDTH,
  detectInsertAxisFromStyle,
  computeInsertPosition,
  canCreateInsert,
  insertCreateDisabledReason,
  insertLineCoords,
  cursorForInsertAxis,
  hitSiblingInsertGap,
  resolveInsertHover,
  placeholderSizing,
  placeholderWidthIsImplicit,
  clampPlaceholderSize,
  cursorForPlaceholderEdge,
  resizePlaceholderFromEdge,
  applyPickToggle,
  applyInsertToggle,
  buildInsertGeneratePayload,
  isVariantShown,
  setVariantShown,
  resolveInsertSessionAnchor,
  buildInsertPlaceholderSnapshot,
  findInsertAnchorInDom,
} from '../skill/scripts/live/insert-ui.mjs';

describe('detectInsertAxisFromStyle', () => {
  it('maps flex row and grid multi-column to row axis', () => {
    assert.equal(detectInsertAxisFromStyle({ display: 'flex', flexDirection: 'row' }), 'row');
    assert.equal(detectInsertAxisFromStyle({ display: 'grid', gridTemplateColumns: '1fr 1fr' }), 'row');
  });

  it('maps flex column and block flow to column axis', () => {
    assert.equal(detectInsertAxisFromStyle({ display: 'flex', flexDirection: 'column' }), 'column');
    assert.equal(detectInsertAxisFromStyle({ display: 'block' }), 'column');
  });
});

describe('computeInsertPosition', () => {
  const rect = { top: 100, height: 40, left: 50, width: 200, bottom: 140, right: 250 };

  it('returns before when pointer is in the top half (column axis)', () => {
    assert.equal(computeInsertPosition(150, 110, rect, 'column'), 'before');
  });

  it('returns after when pointer is in the bottom half (column axis)', () => {
    assert.equal(computeInsertPosition(150, 130, rect, 'column'), 'after');
  });

  it('returns before/after from horizontal halves in row axis', () => {
    assert.equal(computeInsertPosition(120, 120, rect, 'row'), 'before');
    assert.equal(computeInsertPosition(200, 120, rect, 'row'), 'after');
  });

  it('defaults to after for invalid rects', () => {
    assert.equal(computeInsertPosition(0, 50, null), 'after');
    assert.equal(computeInsertPosition(0, 50, { top: 0, height: 0, left: 0, width: 0 }), 'after');
  });
});

describe('canCreateInsert', () => {
  it('requires a non-empty prompt when there are no annotations', () => {
    assert.equal(canCreateInsert({ prompt: '', comments: [], strokes: [] }), false);
    assert.equal(canCreateInsert({ prompt: '  ', comments: [], strokes: [] }), false);
    assert.equal(canCreateInsert({ prompt: 'Add a CTA', comments: [], strokes: [] }), true);
  });

  it('allows create with comment pins only', () => {
    assert.equal(canCreateInsert({
      prompt: '',
      comments: [{ x: 10, y: 20, text: 'headline' }],
      strokes: [],
    }), true);
  });

  it('allows create with strokes only (at least two points)', () => {
    assert.equal(canCreateInsert({
      prompt: '',
      comments: [],
      strokes: [{ points: [[0, 0]] }],
    }), false);
    assert.equal(canCreateInsert({
      prompt: '',
      comments: [],
      strokes: [{ points: [[0, 0], [40, 40]] }],
    }), true);
  });
});

describe('insertCreateDisabledReason', () => {
  it('returns null when create is allowed', () => {
    assert.equal(insertCreateDisabledReason({ prompt: 'x', comments: [], strokes: [] }), null);
  });

  it('explains why Create is disabled', () => {
    assert.match(
      insertCreateDisabledReason({ prompt: '', comments: [], strokes: [] }),
      /prompt or annotate/i,
    );
  });
});

describe('insertLineCoords', () => {
  it('places a horizontal line above the anchor for before', () => {
    const coords = insertLineCoords({ top: 100, left: 12, width: 300, height: 80, bottom: 180 }, 'before');
    assert.equal(coords.axis, 'column');
    assert.equal(coords.top, 98);
    assert.equal(coords.left, 12);
    assert.equal(coords.width, 300);
    assert.equal(coords.height, 0);
  });

  it('places a horizontal line below the anchor for after', () => {
    const coords = insertLineCoords({ top: 100, left: 12, width: 300, height: 80, bottom: 180 }, 'after');
    assert.equal(coords.top, 182);
  });

  it('places a vertical line for row axis', () => {
    const coords = insertLineCoords({ top: 40, left: 100, width: 120, height: 32, right: 220 }, 'after', 'row');
    assert.equal(coords.axis, 'row');
    assert.equal(coords.left, 222);
    assert.equal(coords.top, 40);
    assert.equal(coords.height, 32);
    assert.equal(coords.width, 0);
  });
});

describe('hitSiblingInsertGap', () => {
  const left = { el: 'left', rect: { top: 40, left: 20, width: 100, height: 36, right: 120, bottom: 76 } };
  const right = { el: 'right', rect: { top: 40, left: 140, width: 100, height: 36, right: 240, bottom: 76 } };

  it('detects hover in the horizontal gap between row siblings', () => {
    const hit = hitSiblingInsertGap(130, 58, [left, right]);
    assert.equal(hit?.anchor, 'right');
    assert.equal(hit?.position, 'before');
    assert.equal(hit?.axis, 'row');
    assert.equal(hit?.line.left, 130);
    assert.equal(hit?.line.height, 36);
  });

  it('detects hover in the vertical gap between stacked siblings', () => {
    const top = { el: 'top', rect: { top: 20, left: 40, width: 200, height: 40, right: 240, bottom: 60 } };
    const bottom = { el: 'bottom', rect: { top: 80, left: 40, width: 200, height: 40, right: 240, bottom: 120 } };
    const hit = hitSiblingInsertGap(120, 70, [top, bottom]);
    assert.equal(hit?.anchor, 'bottom');
    assert.equal(hit?.axis, 'column');
    assert.equal(hit?.line.top, 70);
    assert.equal(hit?.line.width, 200);
  });
});

describe('resolveInsertHover', () => {
  it('prefers sibling gap hits over element halves', () => {
    const siblings = [
      { el: 'a', rect: { top: 10, left: 0, width: 80, height: 30, right: 80, bottom: 40 } },
      { el: 'b', rect: { top: 10, left: 100, width: 80, height: 30, right: 180, bottom: 40 } },
    ];
    const resolved = resolveInsertHover({
      clientX: 90,
      clientY: 25,
      target: 'b',
      rect: siblings[1].rect,
      axis: 'row',
      siblings,
    });
    assert.equal(resolved.anchor, 'b');
    assert.equal(resolved.axis, 'row');
  });
});

describe('cursorForInsertAxis', () => {
  it('maps row to ew-resize and column to ns-resize', () => {
    assert.equal(cursorForInsertAxis('row'), 'ew-resize');
    assert.equal(cursorForInsertAxis('column'), 'ns-resize');
  });
});

describe('placeholderSizing', () => {
  it('uses flex sizing for row-axis inserts in flex containers', () => {
    assert.deepEqual(
      placeholderSizing({
        axis: 'row',
        parentDisplay: 'flex',
        parentWidth: 640,
        anchorFlex: '1 1 0%',
      }),
      { kind: 'flex', flex: '1 1 0%', minWidth: 0 },
    );
  });

  it('defaults flex siblings to 1 1 0 when anchor has no flex', () => {
    assert.deepEqual(
      placeholderSizing({ axis: 'row', parentDisplay: 'inline-flex', parentWidth: 400, anchorFlex: '0 1 auto' }),
      { kind: 'flex', flex: '1 1 0', minWidth: 0 },
    );
  });

  it('uses auto width for row-axis grid inserts', () => {
    assert.deepEqual(
      placeholderSizing({ axis: 'row', parentDisplay: 'grid', parentWidth: 500, anchorFlex: 'none' }),
      { kind: 'auto' },
    );
  });

  it('uses percent width for column-axis block inserts', () => {
    assert.deepEqual(
      placeholderSizing({ axis: 'column', parentDisplay: 'block', parentWidth: 480, anchorFlex: 'none' }),
      { kind: 'percent' },
    );
  });

  it('falls back to explicit px when parent width is unknown', () => {
    assert.deepEqual(
      placeholderSizing({ axis: 'column', parentDisplay: 'block', parentWidth: 0, anchorFlex: 'none' }),
      { kind: 'explicit', width: PLACEHOLDER_MIN_WIDTH },
    );
  });
});

describe('placeholderWidthIsImplicit', () => {
  it('treats flex, percent, and auto as implicit', () => {
    assert.equal(placeholderWidthIsImplicit('flex'), true);
    assert.equal(placeholderWidthIsImplicit('percent'), true);
    assert.equal(placeholderWidthIsImplicit('auto'), true);
    assert.equal(placeholderWidthIsImplicit('explicit'), false);
  });
});

describe('clampPlaceholderSize', () => {
  it('enforces minimum width and height', () => {
    const out = clampPlaceholderSize(10, 10, 400);
    assert.equal(out.width, PLACEHOLDER_MIN_WIDTH);
    assert.equal(out.height, PLACEHOLDER_MIN_HEIGHT);
  });

  it('defaults height to PLACEHOLDER_DEFAULT_HEIGHT at creation time via caller', () => {
    assert.equal(PLACEHOLDER_DEFAULT_HEIGHT, 80);
  });

  it('clamps width to parent width', () => {
    const out = clampPlaceholderSize(900, 200, 320);
    assert.equal(out.width, 320);
  });
});

describe('cursorForPlaceholderEdge', () => {
  it('maps vertical edges to ns-resize and horizontal to ew-resize', () => {
    assert.equal(cursorForPlaceholderEdge('n'), 'ns-resize');
    assert.equal(cursorForPlaceholderEdge('s'), 'ns-resize');
    assert.equal(cursorForPlaceholderEdge('e'), 'ew-resize');
    assert.equal(cursorForPlaceholderEdge('w'), 'ew-resize');
  });
});

describe('resizePlaceholderFromEdge', () => {
  it('grows east and south from fixed origin', () => {
    assert.deepEqual(
      resizePlaceholderFromEdge({ width: 200, height: 80, marginLeft: 0, marginTop: 0 }, 'e', 40, 0, 400),
      { width: 240, height: 80, marginLeft: 0, marginTop: 0 },
    );
    assert.deepEqual(
      resizePlaceholderFromEdge({ width: 200, height: 80, marginLeft: 0, marginTop: 0 }, 's', 0, 30, 400),
      { width: 200, height: 110, marginLeft: 0, marginTop: 0 },
    );
  });

  it('shrinks west with compensating marginLeft', () => {
    assert.deepEqual(
      resizePlaceholderFromEdge({ width: 200, height: 80, marginLeft: 0, marginTop: 0 }, 'w', 40, 0, 400),
      { width: 160, height: 80, marginLeft: 40, marginTop: 0 },
    );
  });

  it('shrinks north with compensating marginTop', () => {
    assert.deepEqual(
      resizePlaceholderFromEdge({ width: 200, height: 80, marginLeft: 0, marginTop: 0 }, 'n', 0, 20, 400),
      { width: 200, height: 60, marginLeft: 0, marginTop: 20 },
    );
  });

  it('keeps the far edge fixed when west resize hits min width', () => {
    assert.deepEqual(
      resizePlaceholderFromEdge({ width: 200, height: 80, marginLeft: 10, marginTop: 0 }, 'w', 100, 0, 400),
      { width: PLACEHOLDER_MIN_WIDTH, height: 80, marginLeft: 90, marginTop: 0 },
    );
  });
});

describe('pick / insert toggle state', () => {
  it('allows both modes to be off', () => {
    assert.deepEqual(applyPickToggle(false, false), { pickActive: true, insertActive: false });
    assert.deepEqual(applyInsertToggle(false, false), { pickActive: false, insertActive: true });
  });

  it('turning pick on disables insert', () => {
    assert.deepEqual(applyPickToggle(false, true), { pickActive: true, insertActive: false });
  });

  it('turning insert on disables pick', () => {
    assert.deepEqual(applyInsertToggle(true, false), { pickActive: false, insertActive: true });
  });

  it('turning pick off leaves insert off', () => {
    assert.deepEqual(applyPickToggle(true, false), { pickActive: false, insertActive: false });
  });

  it('turning insert off leaves pick off', () => {
    assert.deepEqual(applyInsertToggle(false, true), { pickActive: false, insertActive: false });
  });
});

describe('buildInsertGeneratePayload', () => {
  it('builds an insert-mode generate event without action', () => {
    const payload = buildInsertGeneratePayload({
      id: 'a1b2c3d4',
      count: 3,
      pageUrl: '/',
      anchorContext: { tagName: 'section', classes: ['hero'] },
      position: 'after',
      placeholder: { width: 320, height: 80 },
      freeformPrompt: '  Add a testimonial strip  ',
      comments: [{ x: 1, y: 2, text: 'quote here' }],
      strokes: [],
      screenshotPath: '/tmp/x.png',
    });

    assert.equal(payload.type, 'generate');
    assert.equal(payload.mode, 'insert');
    assert.equal(payload.id, 'a1b2c3d4');
    assert.equal(payload.count, 3);
    assert.equal(payload.insert.position, 'after');
    assert.equal(payload.insert.anchor.tagName, 'section');
    assert.deepEqual(payload.placeholder, { width: 320, height: 80 });
    assert.equal(payload.freeformPrompt, 'Add a testimonial strip');
    assert.equal(payload.action, undefined);
    assert.equal(payload.element, undefined);
    assert.equal(payload.screenshotPath, '/tmp/x.png');
    assert.equal(payload.comments.length, 1);
  });

  it('omits screenshotPath when annotations are absent', () => {
    const payload = buildInsertGeneratePayload({
      id: 'a1b2c3d4',
      count: 2,
      pageUrl: '/',
      anchorContext: { tagName: 'div' },
      position: 'before',
      placeholder: { width: 200, height: 80 },
      freeformPrompt: 'Banner',
      comments: [],
      strokes: [],
    });
    assert.equal(payload.screenshotPath, undefined);
  });
});

describe('isVariantShown / setVariantShown', () => {
  function mockVariant({ hidden = false, display = '' } = {}) {
    const style = { display };
    return {
      hidden,
      style,
      removeAttribute(name) {
        if (name === 'hidden') this.hidden = false;
      },
      setAttribute(name) {
        if (name === 'hidden') this.hidden = true;
      },
    };
  }

  it('treats hidden attribute and display:none as hidden', () => {
    assert.equal(isVariantShown(mockVariant()), true);
    assert.equal(isVariantShown(mockVariant({ hidden: true })), false);
    assert.equal(isVariantShown(mockVariant({ display: 'none' })), false);
  });

  it('setVariantShown clears hidden and display when showing', () => {
    const el = mockVariant({ hidden: true, display: 'none' });
    setVariantShown(el, true);
    assert.equal(el.hidden, false);
    assert.equal(el.style.display, '');
  });

  it('setVariantShown sets hidden and display when hiding', () => {
    const el = mockVariant();
    setVariantShown(el, false);
    assert.equal(el.hidden, true);
    assert.equal(el.style.display, 'none');
  });
});

describe('resolveInsertSessionAnchor', () => {
  it('prefers visible variant content once variants exist', () => {
    const vis = { id: 'vis' };
    const anchor = resolveInsertSessionAnchor({
      wrapper: {},
      variantCount: 3,
      visibleVariant: 2,
      placeholder: { id: 'ph' },
      insertAnchor: { id: 'anchor' },
      pickVariantContent: (_w, idx) => (idx === 2 ? vis : null),
    });
    assert.equal(anchor, vis);
  });

  it('falls back to placeholder then insert anchor while generating', () => {
    assert.equal(
      resolveInsertSessionAnchor({
        wrapper: {},
        variantCount: 0,
        visibleVariant: 0,
        placeholder: { id: 'ph' },
        insertAnchor: { id: 'anchor' },
      }).id,
      'ph',
    );
    assert.equal(
      resolveInsertSessionAnchor({
        wrapper: {},
        variantCount: 0,
        visibleVariant: 0,
        insertAnchor: { id: 'anchor' },
      }).id,
      'anchor',
    );
  });
});

describe('buildInsertPlaceholderSnapshot / findInsertAnchorInDom', () => {
  it('captures placeholder geometry and anchor fingerprint', () => {
    const snap = buildInsertPlaceholderSnapshot(
      { tagName: 'P', className: 'hero-rebuild-body', textContent: 'Your AI ships generic frontend' },
      { offsetWidth: 518, offsetHeight: 80, style: { marginLeft: '0', marginTop: '4px' } },
      { position: 'before', layoutAxis: 'column' },
    );
    assert.equal(snap.width, 518);
    assert.equal(snap.height, 80);
    assert.equal(snap.position, 'before');
    assert.equal(snap.anchorClasses, 'hero-rebuild-body');
  });

  it('re-finds anchor by class + text after HMR', () => {
    const snap = buildInsertPlaceholderSnapshot(
      { tagName: 'P', className: 'hero-rebuild-body', textContent: 'Your AI ships generic frontend' },
      { offsetWidth: 518, offsetHeight: 80, style: {} },
      { position: 'before', layoutAxis: 'column' },
    );
    const doc = {
      body: { contains: () => false },
      querySelectorAll(sel) {
        assert.equal(sel, 'p.hero-rebuild-body');
        return [{
          textContent: 'Your AI ships generic frontend by default.',
        }];
      },
    };
    const found = findInsertAnchorInDom(doc, snap, null);
    assert.equal(found.textContent.includes('Your AI ships'), true);
  });
});
