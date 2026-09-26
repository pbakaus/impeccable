/** Port of impeccable-site/site/scripts/instrument-strip.js (vendored at vendor/instrument-strip.js,
 * the source of truth) for views that live in a shadow root and re-render with innerHTML.
 * Same behavior: one .ks-thumb per .ks-instrument-strip, measured from the active key and
 * slid on the kit's curve; mouse and pen can scrub between keys; touch keeps native taps.
 * The one addition: a strip with data-ks-strip="<name>" remembers where its thumb was, so a
 * re-render slides the cap from the old key instead of drawing it in place. */
const ACTIVE = '.is-active, [aria-selected="true"], [aria-pressed="true"]';
const memory = new Map<string, { x: number; w: number }>();

function place(strip: HTMLElement) {
  const key = strip.querySelector<HTMLElement>(`.ks-instrument-key:is(${ACTIVE})`);
  if (!key) {
    if (strip.classList.contains('has-thumb')) strip.classList.remove('has-thumb');
    return;
  }
  const s = strip.getBoundingClientRect();
  const k = key.getBoundingClientRect();
  if (!s.width) return;
  const styles = getComputedStyle(strip);
  const scale = s.width / parseFloat(styles.width) || 1;
  const border = parseFloat(styles.borderLeftWidth) || 0;
  const x = Math.round(((k.left - s.left) / scale - border + strip.scrollLeft) * 100) / 100;
  const w = Math.round(k.width / scale * 100) / 100;
  let thumb = strip.querySelector<HTMLElement>(':scope > .ks-thumb');
  const name = strip.dataset.ksStrip;
  if (!thumb) {
    thumb = document.createElement('span');
    thumb.className = 'ks-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    strip.appendChild(thumb);
    const was = name ? memory.get(name) : undefined;
    if (was && (was.x !== x || was.w !== w)) {
      // Start where the cap was before this render, then let the kit's transition carry it.
      thumb.style.transition = 'none';
      thumb.style.width = `${was.w}px`;
      thumb.style.transform = `translateX(${was.x}px)`;
      void thumb.offsetWidth;
      thumb.style.transition = '';
    }
  }
  if (name) memory.set(name, { x, w });
  if (thumb.style.width !== `${w}px`) thumb.style.width = `${w}px`;
  const t = `translateX(${x}px)`;
  if (thumb.style.transform !== t) thumb.style.transform = t;
  if (!strip.classList.contains('has-thumb')) strip.classList.add('has-thumb');
}

function attach(strip: HTMLElement, root: Document | ShadowRoot, cleanups: (() => void)[]) {
  if (strip.dataset.thumb) return;
  strip.dataset.thumb = '1';
  place(strip);
  const mo = new MutationObserver(records => {
    if (records.some(r => r.target !== strip && !(r.target as Element).classList?.contains('ks-thumb'))) place(strip);
  });
  mo.observe(strip, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-pressed'], childList: true });
  const ro = new ResizeObserver(() => place(strip));
  ro.observe(strip);
  let pointerId: number | null = null, dragging = false, startX = 0;
  let last: Element | null = null;
  const keyAt = (x: number, y: number) => root.elementFromPoint(x, y)?.closest('.ks-instrument-key') ?? null;
  strip.addEventListener('pointerdown', e => {
    if (!['mouse', 'pen'].includes(e.pointerType) || !e.isPrimary || e.button !== 0 || pointerId !== null) return;
    pointerId = e.pointerId; dragging = false; startX = e.clientX; last = keyAt(e.clientX, e.clientY);
  });
  strip.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId) return;
    if (!dragging && Math.abs(e.clientX - startX) < 6) return;
    dragging = true;
    const key = keyAt(e.clientX, e.clientY);
    if (key && key !== last && strip.contains(key)) { last = key; (key as HTMLElement).click(); }
  });
  const resetDrag = () => { pointerId = null; dragging = false; last = null; };
  const end = (e: PointerEvent) => { if (e.pointerId === pointerId) resetDrag(); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', resetDrag);
  cleanups.push(() => { mo.disconnect(); ro.disconnect(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', resetDrag); });
}

/** Attach every strip under `root`. Call after each render; returns a cleanup for the previous DOM. */
export function initInstrumentStrips(root: Document | ShadowRoot): () => void {
  const cleanups: (() => void)[] = [];
  root.querySelectorAll<HTMLElement>('.ks-instrument-strip').forEach(strip => attach(strip, root, cleanups));
  document.fonts?.ready.then(() => root.querySelectorAll<HTMLElement>('.ks-instrument-strip').forEach(place));
  return () => cleanups.forEach(fn => fn());
}
