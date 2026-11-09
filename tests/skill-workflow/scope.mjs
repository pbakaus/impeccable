import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';

const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];

async function capture(page, source) {
  await page.setContent(source, { waitUntil: 'load' });
  const header = page.locator('header[data-untouched="header"]');
  const footer = page.locator('footer[data-untouched="footer"]');
  const target = page.locator('#case-study');
  assert.equal(await header.count(), 1, 'header must remain present exactly once');
  assert.equal(await footer.count(), 1, 'footer must remain present exactly once');
  assert.equal(await target.count(), 1, 'target must remain present exactly once');
  const text = (value) => value.replace(/\s+/g, ' ').trim();
  const headerText = text(await header.textContent());
  const footerText = text(await footer.textContent());
  const links = await header.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute('href'),
    text: node.textContent.replace(/\s+/g, ' ').trim(),
  })));
  const targets = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    targets.push(await target.evaluate((root) => {
      const styles = (node, pseudo) => {
        const computed = getComputedStyle(node, pseudo);
        if (pseudo && ['none', 'normal'].includes(computed.content)) return null;
        return Object.fromEntries(Array.from(computed).filter((key) => !key.startsWith('--'))
          .map((key) => [key, computed.getPropertyValue(key)]));
      };
      return [root, ...root.querySelectorAll('*')].map((node) => ({
        tag: node.localName,
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        styles: styles(node),
        before: styles(node, '::before'),
        after: styles(node, '::after'),
      }));
    }));
  }
  return { headerText, footerText, links, targets };
}

// This fixture is a static, self-contained HTML page. Compare its protected
// content semantically and its target DOM/computed styles in the same browser.
// This keeps CSS-only refinements valid without accepting comments or unused CSS.
// The workflow's existing final desktop/mobile capture checks still apply.
export async function assertBolderArtifact(original, artifact) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const before = await capture(page, original);
    const after = await capture(page, artifact);
    assert.equal(after.headerText, before.headerText, 'header text must match the original page');
    assert.deepEqual(after.links, before.links, 'header links must match the original page');
    assert.equal(after.footerText, before.footerText, 'footer text must match the original page');
    assert.ok(!isDeepStrictEqual(after.targets, before.targets),
      'target must change in content or computed style at desktop or mobile size');
  } finally {
    await browser.close();
  }
}
