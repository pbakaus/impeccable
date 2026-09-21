// document.fonts.ready/check alone do not detect a removed @font-face: the
// browser considers a system fallback successful. Probe each visible text
// run's primary family against distinct generic fallbacks without changing DOM.
(() => {
  const generic = new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','math','fangsong']);
  const families = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (!node.textContent.trim()) continue;
    const element = node.parentElement;
    if (!element || element.closest('script,style,noscript')) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    if (![...range.getClientRects()].some(r => r.width > 0 && r.height > 0)) continue;
    const first = (style.fontFamily.match(/"[^"]*"|'[^']*'|[^,]+/g) || [])[0]?.trim();
    const family = first?.replace(/^(['"])(.*)\1$/, '$2');
    if (family && !generic.has(family.toLowerCase())) families.add(family);
  }
  const ctx = document.createElement('canvas').getContext('2d');
  const sample = 'mmmmmmmmWWWWiiii0123456789';
  const width = font => { ctx.font = `72px ${font}`; return ctx.measureText(sample).width; };
  const missing = [...families].filter(family => ['monospace','serif','sans-serif'].every(base =>
    Math.abs(width(`${JSON.stringify(family)}, ${base}`) - width(base)) < .001));
  if (missing.length) throw Error(`Primary fonts unavailable: ${missing.join(', ')}. Preserve the intended typography: include local font files and @font-face declarations in the preview dependencies. Removing font imports produces a fallback preview, not a faithful component capture.`);
  return {primaryFamilies: [...families].sort(), check: 'visible-primary-family-availability-v1'};
})()
