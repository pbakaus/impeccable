import { describe, expect, test } from 'bun:test';
import { clearDecision, planView, decide, defaultAssetKind, extraRegions, flagMessage, isFlagged, isPlanPacket, itemState, medianColor, newPlanDraft, nextPending, pairLayout, planQueue, planSubmission, planSummary, ringSamples, setRegionReclassify, type PlanPacket } from './plan-model';

const packet: PlanPacket = {
  schemaVersion: 3, stage: 'components', id: 'review-1', revision: 'rev-1', title: 'Harbour', round: 1,
  comp: { url: '/comp.png', width: 1440, height: 900 },
  components: [
    { id: 'figure', revision: 'f1', name: 'Hero figure', kind: 'plate', role: 'asset', box: { x: .52, y: .1, w: .4, h: .6 }, note: 'Illustrated fisherman', preview: { kind: 'image', url: '/files/r/figure.png' } },
    { id: 'rule', revision: 'r1', name: 'Hairline', kind: 'chrome', role: 'plan', box: { x: 0, y: .6, w: 1, h: .01 }, note: 'Thin divider', preview: { kind: 'comp-crop' } },
    { id: 'panel', revision: 'p1', name: 'Brushed panel', kind: 'chrome', role: 'plan', box: { x: 0, y: .7, w: 1, h: .1 }, note: 'Brushed steel band under the nav', preview: { kind: 'comp-crop' }, flags: [{ id: 'painted-pixels', message: 'The comp shows photographic shading here.' }] },
  ],
  codeRegions: [
    { id: 'headline', name: 'Headline', kind: 'text', box: { x: .06, y: .2, w: .4, h: .2 }, note: 'A little closer to the sea.' },
    { id: 'rule', name: 'Hairline', kind: 'chrome', box: { x: 0, y: .6, w: 1, h: .01 } },
  ],
};
const [figure, rule, panel] = packet.components;

describe('plan and asset review model', () => {
  test('recognises only v3 component packets', () => {
    expect(isPlanPacket(packet)).toBe(true);
    expect(isPlanPacket({ ...packet, schemaVersion: 2 })).toBe(false);
    expect(isPlanPacket({ ...packet, stage: 'hero' })).toBe(false);
  });
  test('queue puts flagged plan items first, then assets, then remaining plan items', () => {
    expect(planQueue(packet).map(c => c.id)).toEqual(['panel', 'figure', 'rule']);
    expect(isFlagged({ ...rule, codeDrawn: true })).toBe(true);
    expect(isFlagged({ ...figure, flags: [{ id: 'x', message: 'y' }] })).toBe(false);
  });
  test('code regions already in the component list are not listed twice', () => {
    expect(extraRegions(packet).map(r => r.id)).toEqual(['headline']);
  });
  test('approval requires every item approved and nothing changed; it confirms inventory', () => {
    let draft = newPlanDraft(packet);
    expect(planSummary(packet, draft)).toMatchObject({ pending: 3, canSubmit: false, mode: 'approve' });
    for (const c of packet.components) draft = decide(draft, c, 'approve');
    expect(planSummary(packet, draft)).toMatchObject({ approved: 3, canApprove: true, canSubmit: true });
    const body = planSubmission(packet, draft);
    expect(body).toMatchObject({ schemaVersion: 1, requestId: 'review-1', packetRevision: 'rev-1', inventoryConfirmed: true, missing: [] });
    expect(body).not.toHaveProperty('reclassify');
    expect(Object.keys(body.decisions).sort()).toEqual(['figure', 'panel', 'rule']);
  });
  test('reclassifying a plan item is a change, carries its kind, and never confirms inventory', () => {
    let draft = newPlanDraft(packet);
    draft = decide(draft, panel, 'reclassify', { feedback: '  keep it subtle ' });
    expect(draft.decisions.panel).toEqual({ revision: 'p1', action: 'reclassify', feedback: 'keep it subtle', split: false, kind: 'texture' });
    const summary = planSummary(packet, draft);
    expect(summary).toMatchObject({ reclassify: 1, pending: 2, hasChanges: true, canSubmit: true, mode: 'changes' });
    expect(planSubmission(packet, draft).inventoryConfirmed).toBe(false);
  });
  test('code regions without a component entry travel in submission.reclassify', () => {
    let draft = setRegionReclassify(newPlanDraft(packet), 'headline', { kind: 'plate', feedback: 'hand lettered' });
    draft = setRegionReclassify(draft, 'rule', { kind: 'texture' });
    const body = planSubmission(packet, draft);
    expect(body.reclassify).toEqual([{ id: 'headline', kind: 'plate', feedback: 'hand lettered' }]);
    expect(body.decisions).toEqual({});
    draft = setRegionReclassify(draft, 'headline', null);
    expect(planSummary(packet, draft).hasChanges).toBe(false);
  });
  test('revise is for assets, reclassify for plan items', () => {
    const draft = newPlanDraft(packet);
    expect(() => decide(draft, rule, 'revise')).toThrow();
    expect(() => decide(draft, figure, 'reclassify')).toThrow();
    expect(itemState(figure, decide(draft, figure, 'revise', { feedback: 'Warmer' }))).toBe('revise');
  });
  test('missing marks need a name and a valid box; stale drafts cannot submit', () => {
    const draft = newPlanDraft(packet);
    draft.missing.push({ id: 'm1', name: 'Boat', box: { x: .1, y: .1, w: .1, h: .1 }, feedback: '' });
    expect(planSummary(packet, draft)).toMatchObject({ hasChanges: true, canSubmit: true });
    expect(planSubmission(packet, draft).inventoryConfirmed).toBe(false);
    draft.missing[0].name = ' ';
    expect(planSummary(packet, draft).canSubmit).toBe(false);
    draft.missing[0].name = 'Boat';
    expect(() => planSubmission({ ...packet, revision: 'rev-2' }, draft)).toThrow('stale');
  });
  test('a changed component revision reopens only that item', () => {
    let draft = newPlanDraft(packet);
    for (const c of packet.components) draft = decide(draft, c, 'approve');
    const changed = { ...packet, components: packet.components.map(c => c.id === 'figure' ? { ...c, revision: 'f2' } : c) };
    expect(planSummary(changed, draft)).toMatchObject({ approved: 2, pending: 1, canSubmit: false });
    expect(Object.keys(planSubmission(packet, draft).decisions)).toHaveLength(3);
  });
  test('next pending follows queue order and wraps', () => {
    let draft = newPlanDraft(packet);
    expect(nextPending(packet, draft)).toBe('panel');
    draft = decide(draft, panel, 'approve');
    expect(nextPending(packet, draft, 'panel')).toBe('figure');
    expect(nextPending(packet, draft, 'rule')).toBe('figure');
    draft = decide(decide(draft, figure, 'approve'), rule, 'approve');
    expect(nextPending(packet, draft, 'rule')).toBeUndefined();
    expect(itemState(rule, clearDecision(draft, 'rule'))).toBe('pending');
  });
  test('default image kind follows the words that describe the region', () => {
    expect(defaultAssetKind(panel)).toBe('texture');
    expect(defaultAssetKind({ note: 'Fisherman mending a net', flags: [{ id: 'painted-pixels', message: 'photographic shading, soft gradients' }] })).toBe('plate');
    expect(defaultAssetKind({ note: 'A photo of the harbour at dawn' })).toBe('image');
    expect(defaultAssetKind({ note: 'Linen paper grain behind the menu' })).toBe('texture');
  });
  test('painted-pixel flags read as a plain statement', () => {
    expect(flagMessage(panel.flags![0])).toBe('This looks painted: The comp shows photographic shading here.');
    expect(flagMessage({ id: 'other', message: 'Custom.' })).toBe('Custom.');
  });
  test('the backdrop colour is the median of the pixels around the box', () => {
    const w = 10, h = 10, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([240, 230, 220, 255], i * 4);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) data.set([10, 10, 10, 255], (y * w + x) * 4);
    expect(medianColor(ringSamples(data, w, h, { x: .3, y: .3, w: .4, h: .4 }, .1))).toBe('#f0e6dc');
    expect(medianColor([])).toBeUndefined();
  });
  test('pair layout picks the larger of side by side and stacked', () => {
    expect(pairLayout(1, 800, 500, 16, 24).direction).toBe('row');
    const band = pairLayout(16, 800, 500, 16, 24);
    expect(band.direction).toBe('column');
    expect(band.w).toBeCloseTo(800);
    const capped = pairLayout(1, 800, 500, 16, 24, 4, { w: 40, h: 40 });
    expect(capped.w).toBe(160);
  });
  test('plan crops frame the region tightly and fill the pane width', () => {
    const strip = planView({ x: 0, y: 0, w: 1, h: 102 / 900 }, 1440, 900, 590, 330);
    expect(strip.width).toBeCloseTo(590);
    expect(strip.view.h * 900).toBeLessThan(102 + 70);
    expect(strip.view.y).toBe(0);
    const card = planView({ x: .5, y: .5, w: .1, h: .1 }, 1440, 900, 590, 330);
    expect(card.height).toBeCloseTo(330);
    expect(card.view.w * 1440).toBeLessThan(144 + 40);
    const tiny = planView({ x: .5, y: .5, w: .01, h: .01 }, 1440, 900, 590, 330);
    expect(tiny.scale).toBe(4);
    const hairline = planView({ x: 0, y: .5, w: 1, h: 2 / 900 }, 1440, 900, 590, 330);
    expect(2 * hairline.scale).toBeGreaterThanOrEqual(8);
    expect(hairline.width).toBeLessThanOrEqual(590.01);
    const edge = planView({ x: 0, y: 0, w: .05, h: .002 }, 1440, 900, 590, 330);
    expect(edge.view.x).toBe(0); expect(edge.view.y).toBe(0);
  });
});
