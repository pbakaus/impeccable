import {
	initGlassTerminal,
	renderTerminalLayout,
} from "./js/components/glass-terminal.js";
import { initLensEffect } from "./js/components/lens.js";
import { initFrameworkViz } from "./js/components/framework-viz.js";
import { initScrollReveal } from "./js/utils/reveal.js";
import { initAnchorScroll, initHashTracking } from "./js/utils/scroll.js";
import { initThemeToggle } from "./js/utils/theme.js";

// ============================================
// STATE
// ============================================

let allCommands = [];

// ============================================
// CONTENT LOADING
// ============================================

async function loadContent() {
	try {
		const [commandsRes, patternsRes] = await Promise.all([
			fetch("/api/commands"),
			fetch("/api/patterns"),
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

function renderPatternsWithTabs(patterns, antipatterns) {
	const container = document.getElementById("patterns-categories");
	if (!container || !patterns || !antipatterns) return;

	// Create a map of antipatterns by category name
	const antipatternMap = {};
	antipatterns.forEach(cat => {
		antipatternMap[cat.name] = cat.items;
	});

	// Generate unique IDs for tabs
	const tabId = (name) => `pattern-tab-${name.toLowerCase().replace(/\s+/g, '-')}`;
	const panelId = (name) => `pattern-panel-${name.toLowerCase().replace(/\s+/g, '-')}`;

	// Build tabs with WAI-ARIA attributes
	const tabsHTML = patterns
		.map((category, i) => `<button
			class="pattern-tab${i === 0 ? ' active' : ''}"
			data-tab="${category.name}"
			role="tab"
			id="${tabId(category.name)}"
			aria-selected="${i === 0 ? 'true' : 'false'}"
			aria-controls="${panelId(category.name)}"
			tabindex="${i === 0 ? '0' : '-1'}"
		>${category.name}</button>`)
		.join("");

	// Build panels with WAI-ARIA attributes
	const panelsHTML = patterns
		.map((category, i) => {
			const antiItems = antipatternMap[category.name] || [];
			return `
		<div
			class="pattern-panel${i === 0 ? ' active' : ''}"
			data-panel="${category.name}"
			role="tabpanel"
			id="${panelId(category.name)}"
			aria-labelledby="${tabId(category.name)}"
			${i !== 0 ? 'hidden' : ''}
		>
			<div class="pattern-columns">
				<div class="pattern-column pattern-column--anti">
					<span class="pattern-column-label" id="dont-label-${i}">Don't</span>
					<ul class="pattern-list" aria-labelledby="dont-label-${i}">
						${antiItems.map((item) => `<li class="pattern-item pattern-item--anti">${item}</li>`).join("")}
					</ul>
				</div>
				<div class="pattern-column pattern-column--do">
					<span class="pattern-column-label" id="do-label-${i}">Do</span>
					<ul class="pattern-list" aria-labelledby="do-label-${i}">
						${category.items.map((item) => `<li class="pattern-item pattern-item--do">${item}</li>`).join("")}
					</ul>
				</div>
			</div>
		</div>
	`;
		})
		.join("");

	container.innerHTML = `
		<div class="pattern-tabs" role="tablist" aria-label="Pattern categories">${tabsHTML}</div>
		<div class="pattern-panels">${panelsHTML}</div>
	`;

	const tabs = container.querySelectorAll('.pattern-tab');
	const panels = container.querySelectorAll('.pattern-panel');

	// Function to switch tabs
	const switchTab = (newTab) => {
		const tabName = newTab.dataset.tab;

		// Update ARIA attributes on all tabs
		tabs.forEach(t => {
			t.classList.remove('active');
			t.setAttribute('aria-selected', 'false');
			t.setAttribute('tabindex', '-1');
		});

		// Activate the new tab
		newTab.classList.add('active');
		newTab.setAttribute('aria-selected', 'true');
		newTab.setAttribute('tabindex', '0');
		newTab.focus();

		// Update panels
		panels.forEach(p => {
			p.classList.remove('active');
			p.setAttribute('hidden', '');
		});
		const activePanel = container.querySelector(`[data-panel="${tabName}"]`);
		activePanel.classList.add('active');
		activePanel.removeAttribute('hidden');
	};

	// Tab click handling
	tabs.forEach(tab => {
		tab.addEventListener('click', () => switchTab(tab));
	});

	// Keyboard navigation (Arrow keys, Home, End)
	tabs.forEach((tab, index) => {
		tab.addEventListener('keydown', (e) => {
			let targetIndex = index;

			switch (e.key) {
				case 'ArrowLeft':
				case 'ArrowUp':
					e.preventDefault();
					targetIndex = index === 0 ? tabs.length - 1 : index - 1;
					break;
				case 'ArrowRight':
				case 'ArrowDown':
					e.preventDefault();
					targetIndex = index === tabs.length - 1 ? 0 : index + 1;
					break;
				case 'Home':
					e.preventDefault();
					targetIndex = 0;
					break;
				case 'End':
					e.preventDefault();
					targetIndex = tabs.length - 1;
					break;
				default:
					return;
			}

			switchTab(tabs[targetIndex]);
		});
	});
}

// ============================================
// EVENT HANDLERS
// ============================================

// Handle bundle download clicks via event delegation
document.addEventListener("click", (e) => {
	const bundleBtn = e.target.closest("[data-bundle]");
	if (bundleBtn) {
		const { bundle: provider } = bundleBtn.dataset;
		const prefixToggle = document.getElementById('prefix-toggle');
		const usePrefixed = prefixToggle && prefixToggle.checked;
		const bundleName = usePrefixed ? `${provider}-prefixed` : provider;
		window.location.href = `/api/download/bundle/${bundleName}`;
	}

	// Handle copy button clicks
	const copyBtn = e.target.closest("[data-copy]");
	if (copyBtn) {
		const textToCopy = copyBtn.dataset.copy;
		navigator.clipboard.writeText(textToCopy).then(() => {
			copyBtn.classList.add('copied');
			setTimeout(() => copyBtn.classList.remove('copied'), 1500);
		});
	}
});

// ============================================
// CASE STUDIES TABS
// ============================================

function initCaseStudyTabs() {
	const container = document.querySelector('.transformations-tabbed');
	if (!container) return;

	const tabs = container.querySelectorAll('.transformation-tab');
	const panels = container.querySelectorAll('.transformation-panel');

	tabs.forEach(tab => {
		tab.addEventListener('click', () => {
			const tabIndex = tab.dataset.tab;

			// Update tabs
			tabs.forEach(t => {
				t.classList.remove('active');
				t.setAttribute('aria-selected', 'false');
			});
			tab.classList.add('active');
			tab.setAttribute('aria-selected', 'true');

			// Update panels
			panels.forEach(p => {
				p.classList.remove('active');
			});
			const activePanel = container.querySelector(`[data-panel="${tabIndex}"]`);
			if (activePanel) {
				activePanel.classList.add('active');
			}
		});
	});
}

// ============================================
// LIGHTBOX
// ============================================

function initLightbox() {
	const lightbox = document.getElementById('image-lightbox');
	if (!lightbox) return;

	const lightboxImage = lightbox.querySelector('.lightbox-image');
	const closeBtn = lightbox.querySelector('.lightbox-close');

	// Click on transformation images to open lightbox
	document.querySelectorAll('.transformation-before img, .transformation-after img').forEach(img => {
		img.addEventListener('click', () => {
			lightboxImage.src = img.src;
			lightboxImage.alt = img.alt;
			lightbox.classList.add('active');
			document.body.style.overflow = 'hidden';
		});
	});

	// Close lightbox
	function closeLightbox() {
		lightbox.classList.remove('active');
		document.body.style.overflow = '';
	}

	closeBtn.addEventListener('click', closeLightbox);
	lightbox.addEventListener('click', (e) => {
		if (e.target === lightbox) closeLightbox();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && lightbox.classList.contains('active')) {
			closeLightbox();
		}
	});
}

// ============================================
// STARTUP
// ============================================

function init() {
	initThemeToggle();
	initAnchorScroll();
	initHashTracking();
	initLensEffect();
	initScrollReveal();
	initGlassTerminal();
	initFrameworkViz();
	initLightbox();
	initCaseStudyTabs();
	loadContent();

	document.body.classList.add("loaded");
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
