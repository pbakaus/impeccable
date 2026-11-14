import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const source = readFileSync('skill/scripts/live-browser.js', 'utf8');
function helper(name) {
  const body = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0];
  assert.ok(body, name);
  return body;
}

test('audit Vue bindings retain null setup state and render helpers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="app"></div>');
    await page.addScriptTag({ content: readFileSync(join(process.env.IMPECCABLE_TEST_VUE_MODULES, 'vue/dist/vue.global.js'), 'utf8') });
    const result = await page.evaluate((body) => {
      const Child = {
        props: { label: String },
        setup: () => ({ label: Vue.ref(null), formatLabel: value => value.toUpperCase() }),
        template: '<section>{{ label }}{{ formatLabel("imports") }}</section>',
      };
      Vue.createApp({ components: { Child }, template: '<Child label="wrong" />' }).mount('#app');
      const el = document.querySelector('section');
      const get = new Function(`${body}; return buildSveltePropValuesFromLiveElement;`)();
      const values = get(el, { previewMode: 'vue-component', propContract: [
        { prop: 'label', expr: 'label', kind: 'vue-binding' },
        { prop: 'formatLabel', expr: 'formatLabel', kind: 'vue-binding' },
      ] });
      return { original: el.textContent, isNull: values.label === null, formatted: values.formatLabel('imports') };
    }, helper('buildSveltePropValuesFromLiveElement'));
    assert.equal(result.original, 'IMPORTS');
    assert.equal(result.isNull, true, 'null setup binding must not fall through to parent prop');
    assert.equal(result.formatted, 'IMPORTS', 'render helpers must not become event no-ops');
  } finally { await browser.close(); }
});

test('audit Vue attributes do not enter the DOM attribute restoration path', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<section></section>');
    const result = await page.evaluate((bodies) => {
      const restore = new Function(`${bodies.join('\n')}; return applyOriginalAttrsToSvelteAnchor;`)();
      try {
        restore(document.querySelector('section'), '<section class="card" @click="increment" :title="label">text</section>');
        return { ok: true };
      } catch (error) { return { ok: false, error: `${error.name}: ${error.message}` }; }
    }, [helper('parseOriginalMarkupElement'), helper('applyOriginalAttrsToSvelteAnchor')]);
    assert.equal(result.ok, true, result.error);
  } finally { await browser.close(); }
});
