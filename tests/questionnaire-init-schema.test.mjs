import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  INIT_ROUTE_FAMILIES,
  INIT_SLIDES,
  normalizeInitAnswer,
  normalizeInitImageBatch,
  normalizeInitSlidePatch,
  normalizeInitTypographyBatch,
  validateCompleteInitAnswers,
  validateInitCommand,
} from '../skill/scripts/questionnaire/init-schema.mjs';
import {
  SAMPLE_INIT_ANSWER_INPUTS,
  SAMPLE_INIT_IMAGES,
  SAMPLE_INIT_TYPOGRAPHY,
  sampleInitImageBatches,
  sampleInitTypographyBatches,
} from './questionnaire-fixtures.mjs';

describe('init questionnaire schema', () => {
  it('defines the browser-first init slide order', () => {
    assert.deepEqual(INIT_SLIDES.map((slide) => slide.id), [
      'product-overview',
      'assets',
      'differentiator',
      'trust',
      'audience-fit',
      'anti-audience',
      'visual-cues',
      'palette',
      'typography',
    ]);
    assert.deepEqual([...new Set(INIT_SLIDES.map((slide) => slide.section))], [
      'What exists',
      'What it means',
      'How it appears',
    ]);
  });

  it('accepts init and the deprecated identity alias', () => {
    assert.equal(validateInitCommand('init'), 'init');
    assert.equal(validateInitCommand('identity'), 'identity');
    assert.throws(() => validateInitCommand('shape'), /command must be one of/);
  });

  it('normalizes uploads, choice freeform, visual cues, palettes, and typography', () => {
    const imageBatches = sampleInitImageBatches();
    const typographyBatches = sampleInitTypographyBatches();
    const images = Object.values(imageBatches).flatMap((batches) => batches).flatMap((batch) => batch.images);
    const typography = Object.values(typographyBatches).flatMap((batches) => batches).flatMap((batch) => batch.fontSets);

    const upload = normalizeInitAnswer('assets', SAMPLE_INIT_ANSWER_INPUTS.assets);
    assert.equal(upload.assets[0].role, 'product-photo');

    const choice = normalizeInitAnswer('trust', { freeform: 'quiet proof' }, {
      slidePatches: { trust: { options: [{ label: 'Material honesty', value: 'material honesty' }] } },
    });
    assert.equal(choice.value, 'quiet proof');

    assert.deepEqual(
      normalizeInitAnswer('visual-cues', SAMPLE_INIT_ANSWER_INPUTS['visual-cues'], { images }).value,
      ['cue_material', 'cue_graphic', 'cue_motion'],
    );
    assert.equal(normalizeInitAnswer('palette', SAMPLE_INIT_ANSWER_INPUTS.palette, { images }).images[0].colors.length, 4);
    assert.equal(normalizeInitAnswer('typography', SAMPLE_INIT_ANSWER_INPUTS.typography, { typography }).typography[0].heading.family, 'Besley');
  });

  it('requires visual cue batches to include 4 cards and at least 3 route families', () => {
    const normalized = normalizeInitImageBatch({
      slideId: 'visual-cues',
      batchId: 'cue_batch',
      images: SAMPLE_INIT_IMAGES['visual-cues'],
    });
    assert.equal(normalized.length, 4);
    assert.ok(new Set(normalized.map((image) => image.routeFamily)).size >= 3);
    assert.ok(INIT_ROUTE_FAMILIES.includes(normalized[0].routeFamily));

    assert.throws(
      () => normalizeInitImageBatch({
        slideId: 'visual-cues',
        batchId: 'cue_batch_bad',
        images: SAMPLE_INIT_IMAGES['visual-cues'].map((image) => ({ ...image, routeFamily: 'material-object' })),
      }),
      /at least 3 different route families/,
    );
  });

  it('validates palette cards and typography batches', () => {
    assert.equal(normalizeInitImageBatch({
      slideId: 'palette',
      batchId: 'palette_batch',
      images: SAMPLE_INIT_IMAGES.palette,
    })[0].colors.length, 4);

    assert.throws(
      () => normalizeInitImageBatch({
        slideId: 'palette',
        batchId: 'palette_batch_bad',
        images: SAMPLE_INIT_IMAGES.palette.map((image, index) => index === 0 ? { ...image, colors: image.colors.slice(0, 3) } : image),
      }),
      /exactly 4 colors/,
    );

    assert.equal(normalizeInitTypographyBatch({
      slideId: 'typography',
      batchId: 'type_batch',
      fontSets: SAMPLE_INIT_TYPOGRAPHY,
    })[0].heading.family, 'Besley');
  });

  it('normalizes full agent slide payloads', () => {
    const patch = normalizeInitSlidePatch('trust', {
      title: 'What should Mira prove?',
      prompt: 'Choose the strongest trust signal.',
      placeholder: 'Or write the trust signal yourself.',
      options: [
        { label: 'Material honesty', value: 'material honesty', hint: 'The product proves itself through process and surface.' },
      ],
    });
    assert.equal(patch.title, 'What should Mira prove?');
    assert.equal(patch.options[0].hint, 'The product proves itself through process and surface.');
  });

  it('validates a complete init answer set', () => {
    const images = Object.values(sampleInitImageBatches()).flatMap((batches) => batches).flatMap((batch) => batch.images);
    const typography = Object.values(sampleInitTypographyBatches()).flatMap((batches) => batches).flatMap((batch) => batch.fontSets);
    assert.equal(validateCompleteInitAnswers(SAMPLE_INIT_ANSWER_INPUTS, { images, typography }), true);
    const missing = { ...SAMPLE_INIT_ANSWER_INPUTS };
    delete missing.palette;
    assert.throws(() => validateCompleteInitAnswers(missing, { images, typography }), /Missing required answers: palette/);
  });
});
