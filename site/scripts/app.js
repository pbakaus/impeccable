import {
	initGlassTerminal,
	renderTerminalLayout,
} from "./components/glass-terminal.js";
import { initLensEffect } from "./components/lens.js";
import { initFrameworkViz } from "./components/framework-viz.js";
import { initScrollReveal } from "./utils/reveal.js";
import { initAnchorScroll, initHashTracking } from "./utils/scroll.js";
import { initSectionNav } from "./components/section-nav.js";
import { initFoundationGrid } from "./components/foundation-grid.js";
import { initLiveDemo } from "./components/live-demo.js";

// ============================================
// STATE
// ============================================

let allCommands = [];

// ============================================
// CONTENT LOADING
// ============================================

function escapeHtml(value) {
	if (typeof value !== "string") return "";
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

async function loadContent() {
	try {
		const [commandsRes, patternsRes] = await Promise.all([
			fetch("/_data/api/commands.json"),
			fetch("/_data/api/patterns.json"),
		]);

		// Check for HTTP errors
		if (!commandsRes.ok) {
			throw new Error(`Commands API failed: ${commandsRes.status}`);
		}
		if (!patternsRes.ok) {
			throw new Error(`Patterns API failed: ${patternsRes.status}`);
		}

		allCommands = await commandsRes.json();
		const patternsData = await patternsRes.json();

		// Render commands (Glass Terminal)
		renderTerminalLayout(allCommands);

		// Initialize gallery card stack
		initGalleryStack();

		// Render patterns with tabbed navigation
		renderPatternsWithTabs(patternsData.patterns, patternsData.antipatterns);
	} catch (error) {
		console.error("Failed to load content:", error);
		showLoadError(error);
	}
}

function showLoadError(error) {
	// Show error in commands section
	const commandsGallery = document.querySelector('.commands-gallery');
	if (commandsGallery) {
		commandsGallery.innerHTML = `
			<div class="load-error" role="alert">
				<div class="load-error-icon" aria-hidden="true">⚠</div>
				<h3 class="load-error-title">Failed to load commands</h3>
				<p class="load-error-text">There was a problem loading the content. Please check your connection and try again.</p>
				<button class="btn btn-secondary load-error-retry" onclick="location.reload()">
					Retry
				</button>
			</div>
		`;
	}

	// Show error in patterns section
	const patternsContainer = document.getElementById("patterns-categories");
	if (patternsContainer) {
		patternsContainer.innerHTML = `
			<div class="load-error" role="alert">
				<div class="load-error-icon" aria-hidden="true">⚠</div>
				<h3 class="load-error-title">Failed to load patterns</h3>
				<p class="load-error-text">There was a problem loading the content. Please check your connection and try again.</p>
				<button class="btn btn-secondary load-error-retry" onclick="location.reload()">
					Retry
				</button>
			</div>
		`;
	}
}

function initGalleryStack() {
	const container = document.querySelector('.gallery-stack-container');
	const stack = document.getElementById('gallery-stack');
	if (!stack || !container) return;

	const cards = stack.querySelectorAll('.gallery-stack-card');
	const counter = container.querySelector('.gallery-stack-counter');
	const total = cards.length;
	let current = 0;
	let lastScroll = 0;

	function update() {
		cards.forEach((card, i) => {
			const offset = (i - current + total) % total;
			card.dataset.offset = offset;
		});
	}

	function next() { current = (current + 1) % total; update(); }
	function prev() { current = (current - 1 + total) % total; update(); }

	container.querySelector('.gallery-stack-prev').addEventListener('click', prev);
	container.querySelector('.gallery-stack-next').addEventListener('click', next);

	stack.addEventListener('wheel', (e) => {
		e.preventDefault();
		const now = Date.now();
		if (now - lastScroll < 350) return;
		lastScroll = now;
		if (e.deltaY > 0) next(); else prev();
	}, { passive: false });

	update();
}

function renderPatternsWithTabs(patterns, antipatterns) {
	const container = document.getElementById("patterns-categories");
	if (!container || !patterns || !antipatterns) return;

	const antipatternMap = {};
	antipatterns.forEach(cat => { antipatternMap[cat.name] = cat.items; });

	const tabsHTML = patterns.map((cat, i) =>
		`<button class="patterns-tab${i === 0 ? ' is-active' : ''}" data-index="${i}">${escapeHtml(cat.name)}</button>`
	).join('');

	const panelsHTML = patterns.map((cat, i) => {
		const antiItems = antipatternMap[cat.name] || [];
		return `
		<div class="patterns-content${i === 0 ? ' is-active' : ''}" data-index="${i}">
			<div class="patterns-col patterns-col--dont">
				<ul>${antiItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
			</div>
			<div class="patterns-col patterns-col--do">
				<ul>${cat.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
			</div>
		</div>`;
	}).join('');

	container.innerHTML = `<div class="patterns-tabs-wrap"><div class="patterns-tabs" data-scroll="start">${tabsHTML}</div></div>${panelsHTML}`;

	const tabsEl = container.querySelector('.patterns-tabs');
	const tabsWrap = container.querySelector('.patterns-tabs-wrap');

	container.addEventListener('click', (e) => {
		const tab = e.target.closest('.patterns-tab');
		if (!tab) return;
		const index = tab.dataset.index;
		container.querySelectorAll('.patterns-tab').forEach(t => t.classList.remove('is-active'));
		container.querySelectorAll('.patterns-content').forEach(p => p.classList.remove('is-active'));
		tab.classList.add('is-active');
		container.querySelector(`.patterns-content[data-index="${index}"]`).classList.add('is-active');
		// Center the clicked tab inside the tabs strip (not the page). Using
		// scrollBy on the container keeps the page scroll untouched.
		if (tabsEl) {
			const tabRect = tab.getBoundingClientRect();
			const stripRect = tabsEl.getBoundingClientRect();
			const offset = (tabRect.left + tabRect.width / 2) - (stripRect.left + stripRect.width / 2);
			tabsEl.scrollBy({ left: offset, behavior: 'smooth' });
		}
	});

	// Track scroll position so the edge-fade mask only appears on sides where
	// there's actually more content. At the start, no left fade; at the end,
	// no right fade; if no overflow, no fade at all.
	const updateScrollState = () => {
		if (!tabsEl) return;
		const { scrollLeft, scrollWidth, clientWidth } = tabsEl;
		const max = scrollWidth - clientWidth;
		let state;
		if (max <= 1) state = 'none';
		else if (scrollLeft <= 1) state = 'start';
		else if (scrollLeft >= max - 1) state = 'end';
		else state = 'middle';
		tabsEl.dataset.scroll = state;
		if (tabsWrap) tabsWrap.dataset.scroll = state;
	};
	tabsEl?.addEventListener('scroll', updateScrollState, { passive: true });
	window.addEventListener('resize', updateScrollState);
	updateScrollState();
}

// ============================================
// EVENT HANDLERS
// ============================================

// Handle bundle download clicks via event delegation.
// Each download button carries the full bundle name in data-bundle
// (currently just "universal") so the handler is just a redirect.
document.addEventListener("click", (e) => {
	const bundleBtn = e.target.closest("[data-bundle]");
	if (bundleBtn) {
		const bundleName = bundleBtn.dataset.bundle;
		window.location.href = `/api/download/bundle/${bundleName}`;
	}

	// Handle copy button clicks
	const copyBtn = e.target.closest("[data-copy]");
	if (copyBtn) {
		const textToCopy = copyBtn.dataset.copy;
		const onCopied = () => {
			copyBtn.classList.add('copied');
			setTimeout(() => copyBtn.classList.remove('copied'), 1500);
		};
		if (navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(textToCopy).then(onCopied).catch(() => {});
		} else {
			// Fallback for non-HTTPS or older browsers
			const ta = Object.assign(document.createElement('textarea'), { value: textToCopy, style: 'position:fixed;left:-9999px' });
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand('copy'); onCopied(); } catch {}
			ta.remove();
		}
	}
});


// ============================================
// STARTUP
// ============================================

function init() {
	initAnchorScroll();
	initHashTracking();
	initLensEffect();
	initScrollReveal();
	initGlassTerminal();
	initFrameworkViz();
	initFoundationGrid();
	initSectionNav();
	initWhyTabs();
	initLanguageTabs();
	initLiveDemo();
	loadContent();

	document.body.classList.add("loaded");
}

function initLanguageTabs() {
	const toggle = document.querySelector('.language-view-toggle');
	if (!toggle) return;
	const tabs = Array.from(toggle.querySelectorAll('.language-view-tab'));
	const panels = Array.from(document.querySelectorAll('.language-view[data-view-panel]'));
	if (!tabs.length || !panels.length) return;

	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const view = tab.dataset.view;
			tabs.forEach((t) => {
				const on = t === tab;
				t.classList.toggle('is-active', on);
				t.setAttribute('aria-selected', on ? 'true' : 'false');
			});
			panels.forEach((p) => {
				const on = p.dataset.viewPanel === view;
				p.classList.toggle('is-active', on);
				if (on) p.removeAttribute('hidden');
				else p.setAttribute('hidden', '');
			});
		});
	});
}

function initWhyTabs() {
	const container = document.querySelector('.why-layout');
	if (!container) return;
	const tabs = Array.from(container.querySelectorAll('.why-tab'));
	const panels = Array.from(container.querySelectorAll('.why-panel'));
	if (!tabs.length || !panels.length) return;

	const CYCLE_MS = 7000;
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	let current = Math.max(tabs.findIndex((tab) => tab.classList.contains('is-active')), 0);
	let timer = null;
	let autoRotate = !reducedMotion;
	let visible = false;

	const tabStrip = container.querySelector('.why-tabs');
	const getPanelForTab = (tab) => {
		const panelId = tab?.getAttribute('aria-controls');
		return panelId ? container.querySelector(`#${CSS.escape(panelId)}`) : null;
	};

	const centerActiveInStrip = (active) => {
		// On mobile the tab list is a horizontal scroll strip. Keep the
		// active pill visible without touching the page scroll. Using
		// scrollTo with behavior:auto + direct scrollLeft assignment,
		// because smooth-scroll on this container is disabled by the
		// parent's mask-image compositing and silently no-ops.
		if (!tabStrip || tabStrip.scrollWidth <= tabStrip.clientWidth + 1) return;
		const tabRect = active.getBoundingClientRect();
		const stripRect = tabStrip.getBoundingClientRect();
		const offset = (tabRect.left + tabRect.width / 2) - (stripRect.left + stripRect.width / 2);
		if (Math.abs(offset) < 2) return;
		tabStrip.scrollLeft += offset;
	};

	const activate = (index, fromAuto = false) => {
		const targetTab = tabs[index];
		const targetPanel = getPanelForTab(targetTab);
		if (!targetTab || !targetPanel) return;
		current = index;
		tabs.forEach((tab, i) => {
			const on = i === index;
			tab.classList.toggle('is-active', on);
			tab.setAttribute('aria-selected', on ? 'true' : 'false');
			// Reset cycling class, re-add on the new active tab so the
			// progress indicator restarts cleanly.
			tab.classList.remove('is-cycling');
		});
		panels.forEach((panel) => {
			const on = panel === targetPanel;
			panel.classList.toggle('is-active', on);
			if (on) panel.removeAttribute('hidden');
			else panel.setAttribute('hidden', '');
		});
		if (autoRotate && visible) {
			// Force reflow so the animation restart is picked up.
			void targetTab.offsetWidth;
			targetTab.classList.add('is-cycling');
		}
		centerActiveInStrip(targetTab);
	};

	const scheduleNext = () => {
		clearTimeout(timer);
		if (!autoRotate || !visible) return;
		timer = setTimeout(() => {
			const next = (current + 1) % tabs.length;
			activate(next, true);
			scheduleNext();
		}, CYCLE_MS);
	};

	const stopAuto = () => {
		autoRotate = false;
		clearTimeout(timer);
		tabs.forEach((t) => t.classList.remove('is-cycling'));
	};

	tabs.forEach((tab, index) => {
		tab.addEventListener('click', () => {
			stopAuto();
			activate(index);
		});
		tab.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			e.preventDefault();
			stopAuto();
			const dir = e.key === 'ArrowDown' ? 1 : -1;
			const next = (index + dir + tabs.length) % tabs.length;
			tabs[next].focus();
			activate(next);
		});
	});

	container.addEventListener('mouseenter', () => {
		// Pause auto-rotation on hover. Resume only if still allowed and
		// user hasn't interacted (stopAuto flips autoRotate off).
		clearTimeout(timer);
		tabs.forEach((t) => t.classList.remove('is-cycling'));
	});
	container.addEventListener('mouseleave', () => {
		if (autoRotate && visible) {
			// Re-apply cycling class to current tab and resume the timer.
			const active = tabs[current];
			void active.offsetWidth;
			active.classList.add('is-cycling');
			scheduleNext();
		}
	});

	// Observe visibility so we only rotate while the user can see it.
	const io = new IntersectionObserver((entries) => {
		entries.forEach((e) => {
			visible = e.isIntersecting;
			if (visible) {
				if (autoRotate) {
					const active = tabs[current];
					void active.offsetWidth;
					active.classList.add('is-cycling');
					scheduleNext();
				}
			} else {
				clearTimeout(timer);
				tabs.forEach((t) => t.classList.remove('is-cycling'));
			}
		});
	}, { threshold: 0.35 });
	io.observe(container);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
