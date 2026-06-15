import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function readReference(name) {
  return fs.readFileSync(path.join(ROOT, 'skill', 'reference', `${name}.md`), 'utf-8');
}

function readGeneratedSkillFile(...parts) {
  return fs.readFileSync(path.join(ROOT, '.agents', 'skills', 'impeccable', ...parts), 'utf-8');
}

describe('browser-first init questionnaire behavior', () => {
  it('/impeccable init owns the browser-first brand setup flow without MCP', () => {
    const init = readReference('init');

    assert.match(init, /init-questionnaire\.mjs/);
    assert.match(init, /init-poll\.mjs/);
    assert.match(init, /\/events/);
    assert.match(init, /\/poll/);
    assert.match(init, /PRODUCT\.md/);
    assert.match(init, /BRAND\.md/);
    assert.match(init, /DESIGN\.md/);
    assert.match(init, /Choose for me/);
    assert.match(init, /routeFamily/);
    assert.match(init, /material-object/);
    assert.match(init, /graphic-shape/);
    assert.match(init, /surreal-metaphor/);
    assert.match(init, /IMAGE_API_KEY/);
    assert.match(init, /flux-2-pro-preview/);
    assert.match(init, /built-in/);
    assert.match(init, /1024x1024/);
    assert.doesNotMatch(init, /start_identity_questionnaire/);
    assert.doesNotMatch(init, /start_design_questionnaire/);
    assert.doesNotMatch(init, /wait_for_questionnaire_event/);
    assert.doesNotMatch(init, /send_identity_image_batch/);
  });

  it('the installable .agents skill is synced to the browser-first init flow', () => {
    const skill = readGeneratedSkillFile('SKILL.md');
    const init = readGeneratedSkillFile('reference', 'init.md');
    const commandMetadata = readGeneratedSkillFile('scripts', 'command-metadata.json');

    assert.match(skill, /\| `init` \| Build \| Browser-first setup:/);
    assert.match(init, /Browser-first project setup/);
    assert.match(init, /scripts\/questionnaire\/init-questionnaire\.mjs|questionnaire\/init-questionnaire\.mjs/);
    assert.match(init, /scripts\/questionnaire\/init-poll\.mjs|questionnaire\/init-poll\.mjs/);
    assert.match(init, /PRODUCT\.md/);
    assert.match(init, /BRAND\.md/);
    assert.match(init, /DESIGN\.md/);
    assert.match(init, /IMAGE_API_KEY/);
    assert.match(commandMetadata, /Browser-first setup/);

    for (const rel of [
      ['scripts', 'questionnaire', 'init-questionnaire.mjs'],
      ['scripts', 'questionnaire', 'init-poll.mjs'],
      ['scripts', 'questionnaire', 'server.mjs'],
      ['scripts', 'questionnaire', 'init-schema.mjs'],
      ['scripts', 'questionnaire', 'init-md-builder.mjs'],
      ['scripts', 'questionnaire', 'init-image-provider.mjs'],
    ]) {
      assert.equal(
        fs.existsSync(path.join(ROOT, '.agents', 'skills', 'impeccable', ...rel)),
        true,
        `expected installable skill to include ${rel.join('/')}`,
      );
    }

    assert.doesNotMatch(init, /pre-configured so .*impeccable live/);
    assert.doesNotMatch(init, /Step 2: Explore the codebase/);
    assert.doesNotMatch(init, /\.impeccable\/live\/config\.json/);
    assert.doesNotMatch(init, /write PRODUCT\.md only after the user has confirmed/i);
  });

  it('/impeccable shape and craft no longer launch the browser questionnaire themselves', () => {
    const shape = readReference('shape');
    const craft = readReference('craft');

    assert.match(shape, /If PRODUCT\.md, BRAND\.md, or DESIGN\.md is missing, stop and run .*impeccable init first/);
    assert.match(craft, /If PRODUCT\.md, BRAND\.md, or DESIGN\.md is missing and the task depends on brand\/site direction, stop and run .*impeccable init first/);

    for (const reference of [shape, craft]) {
      assert.doesNotMatch(reference, /start_design_questionnaire/);
      assert.doesNotMatch(reference, /wait_for_questionnaire_event/);
      assert.doesNotMatch(reference, /update_questionnaire_slide/);
      assert.doesNotMatch(reference, /start_identity_questionnaire/);
      assert.doesNotMatch(reference, /IDENTITY\.md/);
    }
  });
});
