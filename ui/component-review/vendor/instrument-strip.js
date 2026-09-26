// VENDORED from impeccable-site/site/scripts/instrument-strip.js (the source of truth).
// Do not edit here: change the site, then run node scripts/sync-kinpaku-kit.mjs.
// Instrument strip: the sliding thumb.
//
// Every .ks-instrument-strip gets one raised cap that slides between keys.
// The page's own handlers still toggle is-active / aria-selected /
// aria-pressed on the keys; this script only measures the active key and
// writes --thumb-x / --thumb-w on the strip, on load, on any class or aria
// change, and on resize. Dragging the thumb selects the nearest key by
// clicking it, so the page's handler runs unchanged.

const ACTIVE = '.is-active, [aria-selected="true"], [aria-pressed="true"]';

// Writes only when a value changes: the observer below watches class
// changes on the strip's subtree, and an unconditional classList.add would
// re-trigger it forever.
function place(strip) {
	const key = strip.querySelector(`.ks-instrument-key:is(${ACTIVE})`);
	if (!key) {
		if (strip.classList.contains('has-thumb')) strip.classList.remove('has-thumb');
		return;
	}
	const s = strip.getBoundingClientRect();
	const k = key.getBoundingClientRect();
	const styles = getComputedStyle(strip);
	// Rects include CSS zoom; the thumb's CSS dimensions use layout pixels.
	const scale = s.width / parseFloat(styles.width) || 1;
	const border = parseFloat(styles.borderLeftWidth) || 0;
	const x = Math.round(((k.left - s.left) / scale - border + strip.scrollLeft) * 100) / 100;
	const w = Math.round(k.width / scale * 100) / 100;
	let thumb = strip.querySelector(':scope > .ks-thumb');
	if (!thumb) {
		thumb = document.createElement('span');
		thumb.className = 'ks-thumb';
		thumb.setAttribute('aria-hidden', 'true');
		strip.appendChild(thumb);
	}
	if (thumb.style.width !== `${w}px`) thumb.style.width = `${w}px`;
	const t = `translateX(${x}px)`;
	if (thumb.style.transform !== t) thumb.style.transform = t;
	if (!strip.classList.contains('has-thumb')) strip.classList.add('has-thumb');
}

function attach(strip) {
	if (strip.dataset.thumb) return;
	strip.dataset.thumb = '1';
	place(strip);
	// Observe the keys, not the strip itself, so the strip's own class and
	// style writes never feed back into the observer.
	const mo = new MutationObserver((records) => {
		if (records.some((r) => r.target !== strip && !r.target.classList?.contains('ks-thumb'))) place(strip);
	});
	mo.observe(strip, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-pressed'], childList: true });
	if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => place(strip)).observe(strip);

	// Mouse and pen can scrub between keys. Touch keeps native taps and
	// scrolling, including sideways drift before the browser starts a pan.
	// No pointer capture: a plain press and release stays a normal click.
	let pointerId = null;
	let dragging = false;
	let startX = 0;
	let last = null;
	const keyAt = (x, y) => document.elementFromPoint(x, y)?.closest('.ks-instrument-key');
	strip.addEventListener('pointerdown', (e) => {
		if (!['mouse', 'pen'].includes(e.pointerType) || !e.isPrimary || e.button !== 0 || pointerId !== null) return;
		pointerId = e.pointerId;
		dragging = false;
		startX = e.clientX;
		last = keyAt(e.clientX, e.clientY);
	});
	strip.addEventListener('pointermove', (e) => {
		if (e.pointerId !== pointerId) return;
		if (!dragging && Math.abs(e.clientX - startX) < 6) return;
		dragging = true;
		const key = keyAt(e.clientX, e.clientY);
		if (key && key !== last && strip.contains(key)) {
			last = key;
			key.click();
		}
	});
	const resetDrag = () => {
		pointerId = null;
		dragging = false;
		last = null;
	};
	const end = (e) => {
		if (e.pointerId === pointerId) resetDrag();
	};
	window.addEventListener('pointerup', end);
	window.addEventListener('pointercancel', end);
	// A release outside the focused window may never send either event.
	window.addEventListener('blur', resetDrag);
}

export function initInstrumentStrips(root = document) {
	root.querySelectorAll('.ks-instrument-strip').forEach(attach);
	// Strips rendered later (the command palette, the mobile picker).
	const mo = new MutationObserver((records) => {
		for (const r of records) {
			for (const n of r.addedNodes) {
				if (!(n instanceof Element)) continue;
				if (n.matches('.ks-instrument-strip')) attach(n);
				n.querySelectorAll?.('.ks-instrument-strip').forEach(attach);
			}
		}
	});
	mo.observe(root.body || root, { childList: true, subtree: true });
	window.addEventListener('resize', () => root.querySelectorAll('.ks-instrument-strip').forEach(place));
	if (document.fonts?.ready) document.fonts.ready.then(() => root.querySelectorAll('.ks-instrument-strip').forEach(place));
}

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initInstrumentStrips());
	else initInstrumentStrips();
}
