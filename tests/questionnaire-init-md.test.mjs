import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildInitArtifacts,
  resolveInitWriteTargets,
  saveSelectedInitImages,
  writeInitArtifacts,
} from '../skill/scripts/questionnaire/init-md-builder.mjs';
import {
  SAMPLE_INIT_ANSWER_INPUTS,
  sampleInitImageBatches,
  sampleInitTypographyBatches,
} from './questionnaire-fixtures.mjs';

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-init-md-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('init markdown artifacts', () => {
  it('builds PRODUCT.md, BRAND.md, and DESIGN.md from selected cues, palette, and type', () => {
    const imageBatches = sampleInitImageBatches();
    const typographyBatches = sampleInitTypographyBatches();
    const selectedImagePaths = {
      cue_material: '.impeccable/init/generated/q_sample/cue_material.png',
      cue_graphic: '.impeccable/init/generated/q_sample/cue_graphic.png',
      cue_motion: '.impeccable/init/generated/q_sample/cue_motion.png',
      palette_clay_signal: '.impeccable/init/generated/q_sample/palette_clay_signal.png',
    };
    const artifacts = buildInitArtifacts({
      answers: SAMPLE_INIT_ANSWER_INPUTS,
      imageBatches,
      typographyBatches,
      selectedImagePaths,
      command: 'init',
    });

    assert.match(artifacts.productMd, /# Product/);
    assert.match(artifacts.productMd, /Mira is a ceramic lamp studio/);
    assert.match(artifacts.productMd, /warm-lamp-product-photo/);

    assert.match(artifacts.brandMd, /# Brand/);
    assert.match(artifacts.brandMd, /!\[Thrown clay\]\(.impeccable\/init\/generated\/q_sample\/cue_material\.png\)/);
    assert.match(artifacts.brandMd, /`material-object`/);
    assert.match(artifacts.brandMd, /Prompt History/);

    assert.match(artifacts.designMd, /Read `BRAND.md` before designing/);
    assert.match(artifacts.designMd, /Clay Ground/);
    assert.match(artifacts.designMd, /Besley/);
  });

  it('writes files directly when missing and stages next files when existing', () => {
    const artifacts = buildInitArtifacts({
      answers: SAMPLE_INIT_ANSWER_INPUTS,
      imageBatches: sampleInitImageBatches(),
      typographyBatches: sampleInitTypographyBatches(),
      selectedImagePaths: {},
    });

    const direct = writeInitArtifacts({ cwd: scratch, artifacts });
    assert.deepEqual(direct.targetPaths, {
      product: 'PRODUCT.md',
      brand: 'BRAND.md',
      design: 'DESIGN.md',
    });
    assert.equal(fs.existsSync(path.join(scratch, 'PRODUCT.md')), true);
    assert.equal(fs.existsSync(path.join(scratch, 'BRAND.md')), true);
    assert.equal(fs.existsSync(path.join(scratch, 'DESIGN.md')), true);

    fs.writeFileSync(path.join(scratch, 'PRODUCT.md'), '# Existing product\n');
    fs.writeFileSync(path.join(scratch, 'BRAND.md'), '# Existing brand\n');
    fs.writeFileSync(path.join(scratch, 'DESIGN.md'), '# Existing design\n');

    const staged = writeInitArtifacts({ cwd: scratch, artifacts });
    assert.deepEqual(staged.targetPaths, {
      product: path.join('.impeccable', 'init', 'PRODUCT.next.md'),
      brand: path.join('.impeccable', 'init', 'BRAND.next.md'),
      design: path.join('.impeccable', 'init', 'DESIGN.next.md'),
    });
    assert.equal(fs.readFileSync(path.join(scratch, 'BRAND.md'), 'utf-8'), '# Existing brand\n');
    assert.match(fs.readFileSync(path.join(scratch, staged.targetPaths.brand), 'utf-8'), /Selected Visual Cues/);
  });

  it('saves selected cue and palette images as local files for BRAND.md links', () => {
    const paths = saveSelectedInitImages({
      cwd: scratch,
      sessionId: 'q_sample',
      answers: SAMPLE_INIT_ANSWER_INPUTS,
      imageBatches: sampleInitImageBatches(),
    });
    assert.ok(paths.cue_material.endsWith('/cue_material.png'));
    assert.ok(paths.palette_clay_signal.endsWith('/palette_clay_signal.png'));
    assert.equal(fs.existsSync(path.join(scratch, paths.cue_material)), true);
    assert.equal(fs.existsSync(path.join(scratch, paths.palette_clay_signal)), true);
  });

  it('resolves staged targets independently per existing file', () => {
    fs.writeFileSync(path.join(scratch, 'BRAND.md'), '# Existing brand\n');
    const targets = resolveInitWriteTargets(scratch);
    assert.equal(targets.product.targetPath, 'PRODUCT.md');
    assert.equal(targets.brand.targetPath, path.join('.impeccable', 'init', 'BRAND.next.md'));
    assert.equal(targets.design.targetPath, 'DESIGN.md');
  });
});
