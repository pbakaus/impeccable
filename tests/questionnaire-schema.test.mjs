import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  answersByDesignKey,
  createAdaptiveSlidePatches,
  normalizeAnswer,
  QUESTIONNAIRE_SLIDES,
  validateCommand,
  validateCompleteAnswers,
} from '../skill/scripts/questionnaire/schema.mjs';
import { normalizedSampleAnswers } from './questionnaire-fixtures.mjs';

describe('questionnaire schema', () => {
  it('defines the browser-first DESIGN.md seed slides in a stable order', () => {
    assert.deepEqual(
      QUESTIONNAIRE_SLIDES.map((slide) => slide.id),
      [
        'project-identity',
        'purpose',
        'primary-user',
        'success',
        'content-data',
        'key-states',
        'color-strategy',
        'theme-scene',
        'visual-north-star',
        'typography-voice',
        'component-feel',
        'motion-access',
        'do-dont',
      ],
    );
    assert.equal(QUESTIONNAIRE_SLIDES.every((slide) => slide.designKey), true);
  });

  it('normalizes text, choice, and multi answers', () => {
    assert.deepEqual(normalizeAnswer('project-identity', { value: '  Acme   Billing  ' }), {
      value: 'Acme Billing',
      label: 'Acme Billing',
      freeform: undefined,
    });

    assert.deepEqual(normalizeAnswer('color-strategy', { value: 'drenched', freeform: '  Use carefully  ' }), {
      value: 'drenched',
      label: 'Drenched',
      freeform: 'Use carefully',
    });

    assert.deepEqual(normalizeAnswer('key-states', { value: ['default', 'error', 'default', 'unknown'] }), {
      value: ['default', 'error'],
      label: 'First impression, Form error',
      freeform: undefined,
    });
  });

  it('rejects invalid commands and invalid required answers', () => {
    assert.equal(validateCommand('shape'), 'shape');
    assert.equal(validateCommand('craft'), 'craft');
    assert.throws(() => validateCommand('polish'), /command must be one of/);
    assert.throws(() => normalizeAnswer('purpose', { value: '   ' }), /requires an answer/);
    assert.throws(() => normalizeAnswer('color-strategy', { value: 'blue' }), /must be one of/);
  });

  it('maps normalized answers to DESIGN.md keys and validates completion', () => {
    const answers = normalizedSampleAnswers();
    assert.equal(validateCompleteAnswers(answers), true);

    const keyed = answersByDesignKey(answers);
    assert.equal(keyed.siteOverview.value, 'A site for small architecture studios to understand billing before client calls.');
    assert.equal(keyed.projectIdentity.value, 'Orbit Ledger');
    assert.deepEqual(keyed.keyStates.value, ['default', 'loading', 'error', 'long-content', 'mobile']);

    const missing = { ...answers };
    delete missing.purpose;
    assert.throws(() => validateCompleteAnswers(missing), /Missing required answers: purpose/);
  });

  it('derives adaptive next-slide copy from the site overview and name answers', () => {
    const patches = createAdaptiveSlidePatches({
      'project-identity': normalizeAnswer('project-identity', {
        value: 'A site for an independent hotel with direct booking.',
      }),
    });

    assert.equal(patches.purpose.title, 'What should we call it?');
    assert.match(patches.purpose.prompt, /Give this site a public name/);
    assert.equal(patches.purpose.placeholder, 'The Maritime House');

    const namedPatches = createAdaptiveSlidePatches({
      'project-identity': normalizeAnswer('project-identity', {
        value: 'A site for small architecture studios to understand billing before client calls.',
      }),
      purpose: normalizeAnswer('purpose', { value: 'Orbit Ledger' }),
    });

    assert.equal(namedPatches['primary-user'].title, 'Who is Orbit Ledger for?');
    assert.match(namedPatches.success.title, /Orbit Ledger/);
  });
});
