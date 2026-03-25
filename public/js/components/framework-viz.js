/**
 * Periodic Table of Commands
 * Clean grid visualization showing all commands organized by category
 * Hover tooltips show description and relationships inline.
 */

import { commandCategories, commandRelationships, betaCommands } from '../data.js';

const categoryColors = {
	diagnostic: { bg: 'var(--cat-diagnostic-bg)', border: 'var(--cat-diagnostic-border)', text: 'var(--cat-diagnostic-text)' },
	quality: { bg: 'var(--cat-quality-bg)', border: 'var(--cat-quality-border)', text: 'var(--cat-quality-text)' },
	intensity: { bg: 'var(--cat-intensity-bg)', border: 'var(--cat-intensity-border)', text: 'var(--cat-intensity-text)' },
	adaptation: { bg: 'var(--cat-adaptation-bg)', border: 'var(--cat-adaptation-border)', text: 'var(--cat-adaptation-text)' },
	enhancement: { bg: 'var(--cat-enhancement-bg)', border: 'var(--cat-enhancement-border)', text: 'var(--cat-enhancement-text)' },
	system: { bg: 'var(--cat-system-bg)', border: 'var(--cat-system-border)', text: 'var(--cat-system-text)' }
};

const categoryLabels = {
	diagnostic: 'Diagnostic',
	quality: 'Quality',
	intensity: 'Intensity',
	adaptation: 'Adaptation',
	enhancement: 'Enhancement',
	system: 'System'
};

const commandSymbols = {
	'teach-impeccable': 'Ti',
	audit: 'Au',
	critique: 'Cr',
	normalize: 'No',
	polish: 'Po',
	optimize: 'Op',
	harden: 'Ha',
	clarify: 'Cl',
	distill: 'Di',
	adapt: 'Ad',
	extract: 'Ex',
	animate: 'An',
	colorize: 'Co',
	delight: 'De',
	bolder: 'Bo',
	quieter: 'Qu',
	onboard: 'On',
	typeset: 'Ty',
	arrange: 'Ar',
	overdrive: 'Od'
};

const commandNumbers = {
	'teach-impeccable': 0,
	audit: 1, critique: 2, normalize: 3, polish: 4, optimize: 5,
	harden: 6, clarify: 7, distill: 8, adapt: 9, extract: 10,
	animate: 11, colorize: 12, delight: 13, bolder: 14, quieter: 15,
	onboard: 16, typeset: 17, arrange: 18, overdrive: 19
};

export class PeriodicTable {
	constructor(container) {
		this.container = container;
		this.activeTooltip = null;
		this.activeElement = null;
		this.init();
	}

	init() {
		this.container.innerHTML = '';
		this.container.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 16px;
			padding: 20px;
			height: 100%;
			box-sizing: border-box;
			position: relative;
		`;

		this.renderTable();
	}

	renderTable() {
		const groups = {};
		Object.entries(commandCategories).forEach(([cmd, cat]) => {
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(cmd);
		});

		const categoryOrder = ['diagnostic', 'quality', 'adaptation', 'enhancement', 'intensity', 'system'];

		const grid = document.createElement('div');
		grid.style.cssText = `
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
			gap: 16px;
			flex: 1;
		`;

		categoryOrder.forEach(cat => {
			const commands = groups[cat];
			if (!commands) return;
			const group = this.createCategoryGroup(cat, commands);
			grid.appendChild(group);
		});

		this.container.appendChild(grid);
	}

	showTooltip(el, cmd) {
		this.hideTooltip();

		const rel = commandRelationships[cmd] || {};
		const toArray = (val) => {
			if (!val) return [];
			if (Array.isArray(val)) return val;
			return [val];
		};

		const pairs = toArray(rel.pairs);
		const leadsTo = toArray(rel.leadsTo);
		const combinesWith = toArray(rel.combinesWith);

		// Build relationships line
		let relParts = [];
		if (pairs.length > 0) relParts.push(`pairs with ${pairs.map(p => '/' + p).join(', ')}`);
		if (combinesWith.length > 0) relParts.push(`+ ${combinesWith.map(p => '/' + p).join(', ')}`);
		if (leadsTo.length > 0) relParts.push(`then ${leadsTo.map(p => '/' + p).join(', ')}`);

		// Strip category prefix from flow for cleaner display
		const flow = (rel.flow || '').replace(/^[^:]+:\s*/, '');

		const tooltip = document.createElement('div');
		tooltip.className = 'ptable-tooltip';
		tooltip.style.cssText = `
			position: absolute;
			z-index: 20;
			background: var(--color-paper);
			border: 1px solid var(--color-mist);
			border-radius: 6px;
			padding: 10px 14px;
			box-shadow: 0 8px 24px -4px rgba(0,0,0,0.12);
			pointer-events: none;
			max-width: 280px;
			opacity: 0;
			transition: opacity 0.15s ease;
		`;

		tooltip.innerHTML = `
			<div style="font-family: var(--font-body); font-size: 13px; color: var(--color-charcoal); line-height: 1.4; margin-bottom: ${relParts.length ? '6px' : '0'};">${flow}</div>
			${relParts.length ? `<div style="font-family: var(--font-mono); font-size: 11px; color: var(--color-ash); line-height: 1.4;">${relParts.join(' · ')}</div>` : ''}
		`;

		this.container.appendChild(tooltip);

		// Position relative to element
		const elRect = el.getBoundingClientRect();
		const containerRect = this.container.getBoundingClientRect();

		const left = elRect.left - containerRect.left;
		const top = elRect.bottom - containerRect.top + 6;

		tooltip.style.left = `${Math.min(left, containerRect.width - 290)}px`;
		tooltip.style.top = `${top}px`;

		// Fade in
		requestAnimationFrame(() => { tooltip.style.opacity = '1'; });

		this.activeTooltip = tooltip;
	}

	hideTooltip() {
		if (this.activeTooltip) {
			this.activeTooltip.remove();
			this.activeTooltip = null;
		}
	}

	createCategoryGroup(category, commands) {
		const colors = categoryColors[category];

		const group = document.createElement('div');
		group.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;

		const label = document.createElement('div');
		label.style.cssText = `
			font-family: var(--font-body);
			font-size: 10px;
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: ${colors.text};
			padding-left: 2px;
		`;
		label.textContent = categoryLabels[category];
		group.appendChild(label);

		const row = document.createElement('div');
		row.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px;`;

		commands.forEach(cmd => {
			const element = this.createElement(cmd, category);
			row.appendChild(element);
		});

		group.appendChild(row);
		return group;
	}

	createElement(cmd, category) {
		const colors = categoryColors[category];

		const el = document.createElement('button');
		el.type = 'button';
		el.setAttribute('aria-label', `/${cmd} command - ${categoryLabels[category]}`);
		el.style.cssText = `
			width: 56px;
			height: 64px;
			background: ${colors.bg};
			border: 1.5px solid ${colors.border};
			border-radius: 5px;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			transition: transform 0.15s ease, box-shadow 0.15s ease;
			position: relative;
			font-family: inherit;
			padding: 0;
		`;

		// Atomic number
		const number = document.createElement('div');
		number.style.cssText = `
			position: absolute;
			top: 3px;
			left: 5px;
			font-family: var(--font-mono);
			font-size: 7px;
			color: ${colors.text};
			opacity: 0.5;
		`;
		number.textContent = commandNumbers[cmd];
		el.appendChild(number);

		// Symbol
		const symbol = document.createElement('div');
		symbol.style.cssText = `
			font-family: var(--font-display);
			font-size: 20px;
			font-weight: 500;
			color: ${colors.text};
			line-height: 1;
		`;
		symbol.textContent = commandSymbols[cmd];
		el.appendChild(symbol);

		// Command name
		const name = document.createElement('div');
		name.style.cssText = `
			font-family: var(--font-mono);
			font-size: 8px;
			color: ${colors.text};
			opacity: 0.7;
			margin-top: 3px;
		`;
		name.textContent = `/${cmd}`;
		el.appendChild(name);

		// Beta badge
		if (betaCommands.includes(cmd)) {
			const badge = document.createElement('div');
			badge.style.cssText = `
				position: absolute;
				top: 2px;
				right: 3px;
				font-family: var(--font-mono);
				font-size: 5px;
				letter-spacing: 0.05em;
				color: ${colors.text};
				opacity: 0.45;
				text-transform: uppercase;
			`;
			badge.textContent = 'β';
			el.appendChild(badge);
		}

		// Hover/focus: show tooltip
		const activate = () => {
			el.style.transform = 'translateY(-2px)';
			el.style.boxShadow = `0 4px 12px ${colors.border}40`;
			this.showTooltip(el, cmd);

			if (this.activeElement && this.activeElement !== el) {
				this.activeElement.style.transform = 'translateY(0)';
				this.activeElement.style.boxShadow = 'none';
			}
			this.activeElement = el;
		};

		const deactivate = () => {
			el.style.transform = 'translateY(0)';
			el.style.boxShadow = 'none';
			this.hideTooltip();
		};

		el.addEventListener('mouseenter', activate);
		el.addEventListener('mouseleave', deactivate);
		el.addEventListener('focus', activate);
		el.addEventListener('blur', deactivate);

		el.addEventListener('touchstart', (e) => {
			e.preventDefault();
			activate();
		}, { passive: false });

		el.addEventListener('click', () => {
			activate();
			const target = document.getElementById(`cmd-${cmd}`);
			if (target) {
				target.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		});

		return el;
	}
}

export function initFrameworkViz() {
	const container = document.getElementById('framework-viz-container');
	if (container) {
		new PeriodicTable(container);
	}
}
