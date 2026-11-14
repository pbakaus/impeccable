import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const source = readFileSync(new URL('../skill/scripts/live-browser.js', import.meta.url), 'utf8');
const body = source.match(/function buildSveltePropValuesFromLiveElement\([^\n]*\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(body);

for (const production of [false, true]) {
  test(`Options API snapshots preserve data, null, computed values and inert methods (production=${production})`, {
    skip: process.env.IMPECCABLE_TEST_VUE_MODULES === undefined && 'IMPECCABLE_TEST_VUE_MODULES is unset',
  }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="original"></div>');
      await page.addScriptTag({ content: readFileSync(join(process.env.IMPECCABLE_TEST_VUE_MODULES, `vue/dist/vue.global${production ? '.prod' : ''}.js`), 'utf8') });
      const result = await page.evaluate((body) => {
        const vm = Vue.createApp({
          data: () => ({ count: 3, label: null }),
          computed: { summary() { return `Count ${this.count}`; } },
          methods: { increment() { this.count++; } },
          template: '<p>{{ summary }}</p>',
        }).mount('#original');
        const el = document.querySelector('#original p');
        // Production Vue omits the development DOM marker; expose the real
        // instance explicitly to exercise the adapter's lookup contract.
        el.__vueParentComponent = vm.$;
        const get = new Function(`${body}; return buildSveltePropValuesFromLiveElement;`)();
        const values = get(el, { previewMode: 'vue-component', propContract: [
          ...['count', 'label', 'summary'].map(name => ({ prop: name, expr: name, kind: 'vue-binding' })),
          { prop: 'increment', expr: 'increment', kind: 'vue-handler' },
        ] });
        values.increment();
        return { count: values.count, isNull: values.label === null, summary: values.summary, originalCount: vm.count };
      }, body);
      assert.equal(result.count, 3);
      assert.equal(result.isNull, true);
      assert.equal(result.summary, 'Count 3');
      assert.equal(result.originalCount, 3);
    } finally { await browser.close(); }
  });
}

test('legacy manifests cannot share event-writable reactive objects with previews', {
  skip: process.env.IMPECCABLE_TEST_VUE_MODULES === undefined && 'IMPECCABLE_TEST_VUE_MODULES is unset',
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="original"></div><div id="preview"></div>');
    await page.addScriptTag({ content: readFileSync(join(process.env.IMPECCABLE_TEST_VUE_MODULES, 'vue/dist/vue.global.js'), 'utf8') });
    const result = await page.evaluate(async (body) => {
      const vm = Vue.createApp({ setup: () => ({ form: Vue.reactive({ count: 0 }) }), template: '<p>{{ form.count }}</p>' }).mount('#original');
      const get = new Function(`${body}; return buildSveltePropValuesFromLiveElement;`)();
      let values;
      try {
        values = get(document.querySelector('#original p'), { previewMode: 'vue-component', propContract: [
          { prop: 'form', expr: 'form', kind: 'vue-callable-mixed' },
        ] });
      } catch (error) {
        if (!/event bindings.*ordinary preview/i.test(error.message)) throw error;
        return { refused: true, originalCount: vm.form.count };
      }
      Vue.createApp({ props: ['form'], template: '<button @click="form.count++">{{ form.count }}</button>' }, values).mount('#preview');
      document.querySelector('#preview button').click();
      await Vue.nextTick();
      return { refused: false, originalCount: vm.form.count, previewCount: Number(document.querySelector('#preview button').textContent) };
    }, body);
    assert.equal(result.originalCount, 0, 'preview event must not write original reactive state');
    assert.ok(result.refused || result.previewCount === 1);
  } finally { await browser.close(); }
});
