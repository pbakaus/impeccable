import {
	initGlassTerminal,
	renderTerminalLayout,
} from "./js/components/glass-terminal.js";
import { initLensEffect } from "./js/components/lens.js";
import { initFrameworkViz } from "./js/components/framework-viz.js";
import { initHeroEffect } from "./js/effects/liquid-canvas.js";
import { initScrollReveal } from "./js/utils/reveal.js";
import { initScrollIndicator, initSmoothScroll, initHashTracking } from "./js/utils/scroll.js";

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

		allCommands = await commandsRes.json();
		const patternsData = await patternsRes.json();

		// Render commands (Glass Terminal)
		renderTerminalLayout(allCommands);

		// Render patterns with tabbed navigation
		renderPatternsWithTabs(patternsData.patterns, patternsData.antipatterns);
	} catch (error) {
		console.error("Failed to load content:", error);
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

	// Build tabs
	const tabsHTML = patterns
		.map((category, i) => `<button class="pattern-tab${i === 0 ? ' active' : ''}" data-tab="${category.name}">${category.name}</button>`)
		.join("");

	// Build panels
	const panelsHTML = patterns
		.map((category, i) => {
			const antiItems = antipatternMap[category.name] || [];
			return `
		<div class="pattern-panel${i === 0 ? ' active' : ''}" data-panel="${category.name}">
			<div class="pattern-columns">
				<div class="pattern-column pattern-column--anti">
					<span class="pattern-column-label">Don't</span>
					<ul class="pattern-list">
						${antiItems.map((item) => `<li class="pattern-item pattern-item--anti">${item}</li>`).join("")}
					</ul>
				</div>
				<div class="pattern-column pattern-column--do">
					<span class="pattern-column-label">Do</span>
					<ul class="pattern-list">
						${category.items.map((item) => `<li class="pattern-item pattern-item--do">${item}</li>`).join("")}
					</ul>
				</div>
			</div>
		</div>
	`;
		})
		.join("");

	container.innerHTML = `
		<div class="pattern-tabs">${tabsHTML}</div>
		<div class="pattern-panels">${panelsHTML}</div>
	`;

	// Tab click handling
	container.querySelectorAll('.pattern-tab').forEach(tab => {
		tab.addEventListener('click', () => {
			const tabName = tab.dataset.tab;

			// Update active tab
			container.querySelectorAll('.pattern-tab').forEach(t => t.classList.remove('active'));
			tab.classList.add('active');

			// Update active panel
			container.querySelectorAll('.pattern-panel').forEach(p => p.classList.remove('active'));
			container.querySelector(`[data-panel="${tabName}"]`).classList.add('active');
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
		window.location.href = `/api/download/bundle/${provider}`;
	}
});

// ============================================
// STARTUP
// ============================================

function init() {
	initSmoothScroll();
	initScrollIndicator();
	initHashTracking();
	initHeroEffect();
	initLensEffect();
	initScrollReveal();
	initGlassTerminal();
	initFrameworkViz();
	loadContent();

	document.body.classList.add("loaded");
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
