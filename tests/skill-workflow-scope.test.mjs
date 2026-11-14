import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXISTING_PAGE } from './skill-workflow/fixtures.mjs';
import { assertBolderArtifact } from './skill-workflow/scope.mjs';

const scopedText = EXISTING_PAGE.replace('Challenge. Approach. Outcome.', 'From 12 hours to 15 minutes.');
const scopedCss = EXISTING_PAGE.replace('</style>', '#case-study { padding: 48px; font-size: 24px; }\n</style>');

// Each protected-content failure starts from a valid target change. It must
// fail its own invariant, not accidentally pass because the target is unchanged.
describe('bolder artifact scope', () => {
  for (const [name, artifact] of [
    ['scoped text', scopedText],
    ['scoped CSS only', scopedCss],
    ['mobile-only scoped CSS', EXISTING_PAGE.replace('</style>', '@media (max-width: 500px) { #case-study { padding: 48px; } }\n</style>')],
    ['reformatted protected text and quote styles', scopedCss
      .replace('>Harbor Desk</a>', '>\n  Harbor   Desk\n</a>')
      .replace('>Operational since 1987</footer>', '>\n Operational since   1987 \n</footer>')
      .replaceAll('"', "'")],
  ]) {
    it(`accepts ${name}`, async () => {
      await assertBolderArtifact(EXISTING_PAGE, artifact);
    });
  }

  for (const [name, artifact, check] of [
    ['header link change', scopedText.replace('href="/"', 'href="/missing-page"'), 'header links'],
    ['header text change', scopedText.replace('>Harbor Desk</a>', '>Other Desk</a>'), 'header text'],
    ['footer text change', scopedText.replace('Operational since 1987', 'A different footer'), 'footer text'],
    ['missing header', scopedText.replace(/<header[\s\S]*?<\/header>/, ''), 'header must remain'],
    ['missing footer', scopedText.replace(/<footer[\s\S]*?<\/footer>/, ''), 'footer must remain'],
    ['missing target', scopedText.replace('id="case-study"', 'id="other"'), 'target must remain'],
    ['unchanged target', EXISTING_PAGE, 'target must change in content or computed style'],
    ['comment-only edit', `${EXISTING_PAGE}\n<!-- Refined the design -->`, 'target must change in content or computed style'],
    ['comment inside target', EXISTING_PAGE.replace('class="card">', 'class="card"><!-- bolder -->'), 'target must change in content or computed style'],
    ['unused CSS-only edit', EXISTING_PAGE.replace('</style>', '#absent { color: red; }\n</style>'), 'target must change in content or computed style'],
    ['unused custom property', EXISTING_PAGE.replace('</style>', '#case-study { --unused: red; }\n</style>'), 'target must change in content or computed style'],
    ['CSS comment-only edit', EXISTING_PAGE.replace('</style>', '/* Bolder now */\n</style>'), 'target must change in content or computed style'],
    ['formatting-only edit', EXISTING_PAGE.replace('><', '>\n<'), 'target must change in content or computed style'],
  ]) {
    it(`rejects ${name} on its named check`, async () => {
      await assert.rejects(assertBolderArtifact(EXISTING_PAGE, artifact), (error) => {
        assert.equal(error.code, 'ERR_ASSERTION');
        assert.ok(error.message.startsWith(check), `expected ${check}, got ${error.message}`);
        return true;
      });
    });
  }
});
