// `querySelectorAll` for a selector that may pass through open shadow roots
// with ` >>> ` (`topo-card >>> span.lbl`, Playwright-style): the form a
// finding's selector takes inside a shadow tree. Throws on an invalid
// selector, as `querySelectorAll` does. Shared by the in-page bundle, the
// extension's snapshot and overlay pieces, and the URL engine's page scripts.
function __impeccableQueryAll(selector) {
  const parts = selector.split(' >>> ');
  let found = [...document.querySelectorAll(parts[0])];
  for (const part of parts.slice(1)) {
    const next = [];
    for (const host of found) if (host.shadowRoot) next.push(...host.shadowRoot.querySelectorAll(part));
    found = next;
  }
  return found;
}
