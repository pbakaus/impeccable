/**
 * Periodic Table of Commands
 * Clean grid visualization showing all commands organized by category
 * Hover tooltips show description and relationships inline.
 */

import { commandCategories, commandRelationships, alphaCommands } from '../data.js';

const categoryColors = {
	create: { bg: 'var(--cat-create-bg)', border: 'var(--cat-create-border)', text: 'var(--cat-create-text)' },
	evaluate: { bg: 'var(--cat-evaluate-bg)', border: 'var(--cat-evaluate-border)', text: 'var(--cat-evaluate-text)' },
	refine: { bg: 'var(--cat-refine-bg)', border: 'var(--cat-refine-border)', text: 'var(--cat-refine-text)' },
	simplify: { bg: 'var(--cat-simplify-bg)', border: 'var(--cat-simplify-border)', text: 'var(--cat-simplify-text)' },
	harden: { bg: 'var(--cat-harden-bg)', border: 'var(--cat-harden-border)', text: 'var(--cat-harden-text)' },
	system: { bg: 'var(--cat-system-bg)', border: 'var(--cat-system-border)', text: 'var(--cat-system-text)' }
};

const categoryLabels = {
	create: 'Create',
	evaluate: 'Evaluate',
	refine: 'Refine',
	simplify: 'Simplify',
	harden: 'Harden',
	system: 'System'
};

const commandSymbols = {
	'impeccable': 'Im',
	'craft': 'Cf',
	'shape': 'Sh',
	'critique': 'Cr',
	'audit': 'Au',
	'typeset': 'Ty',
	'layout': 'La',
	'colorize': 'Co',
	'animate': 'An',
	'delight': 'De',
	'bolder': 'Bo',
	'quieter': 'Qu',
	'overdrive': 'Od',
	'distill': 'Di',
	'clarify': 'Cl',
	'adapt': 'Ad',
	'polish': 'Po',
	'optimize': 'Op',
	'harden': 'Ha',
	'onboard': 'On',
	'teach': 'Te',
	'document': 'Dc',
	'extract': 'Ex',
	'live': 'Li'
};

const commandNumbers = {
	'impeccable': 1, 'craft': 2, 'shape': 3,
	'critique': 4, 'audit': 5,
	'typeset': 6, 'layout': 7, 'colorize': 8, 'animate': 9,
	'delight': 10, 'bolder': 11, 'quieter': 12, 'overdrive': 13,
	'distill': 14, 'clarify': 15, 'adapt': 16,
	'polish': 17, 'optimize': 18, 'harden': 19, 'onboard': 20,
	'teach': 21, 'document': 22, 'extract': 23, 'live': 24
};

// After the v3.0 consolidation, all commands except the root "impeccable" are
// sub-commands of /impeccable. The renderer handles the display label directly
// (bare name for sub-commands, "/impeccable" for the root). This map is kept
// as an extension point for any future per-command display overrides.
const commandDisplay = {};

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

		const categoryOrder = ['create', 'evaluate', 'refine', 'simplify', 'harden', 'system'];

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

		// Build relationships line. Command names are shown bare (no slash)
		// because they're names, not invocations — the invocation is /impeccable <name>.
		let relParts = [];
		if (pairs.length > 0) relParts.push(`pairs with ${pairs.join(', ')}`);
		if (combinesWith.length > 0) relParts.push(`+ ${combinesWith.join(', ')}`);
		if (leadsTo.length > 0) relParts.push(`then ${leadsTo.join(', ')}`);

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
		const display = commandDisplay[cmd];

		const el = document.createElement('button');
		el.type = 'button';
		// Build accessible label with the full invocation
		const invocation = cmd === 'impeccable'
			? '/impeccable'
			: cmd.startsWith('impeccable ')
				? `/${cmd}`
				: `/impeccable ${cmd}`;
		el.setAttribute('aria-label', `${invocation} command - ${categoryLabels[category]}`);
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

		// Command name. The root "impeccable" is shown with its slash as the
		// entry point. All other commands are sub-commands and show their
		// bare name (the invocation is /impeccable <name>).
		const name = document.createElement('div');
		name.style.cssText = `
			font-family: var(--font-mono);
			font-size: 8px;
			color: ${colors.text};
			opacity: 0.7;
			margin-top: 3px;
			text-align: center;
			max-width: 52px;
			line-height: 1.3;
			white-space: nowrap;
		`;
		if (cmd === 'impeccable') {
			name.textContent = '/impeccable';
		} else if (display) {
			name.textContent = display.label;
		} else {
			name.textContent = cmd;
		}
		el.appendChild(name);

		// Alpha badge
		if (alphaCommands.includes(cmd)) {
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
			badge.textContent = 'α';
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
			const scrollTarget = display ? display.scrollTo : cmd;

			// Navigate the fisheye scroller to this command
			const fisheyeList = document.getElementById('fisheye-list');
			if (fisheyeList) {
				const items = [...fisheyeList.querySelectorAll('.fisheye-item')];
				const idx = items.findIndex(item => item.dataset.id === scrollTarget);
				if (idx >= 0 && fisheyeList._scrollToCommand) {
					// Scroll the commands section into view first
					const section = document.querySelector('.commands-subsection');
					if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
					fisheyeList._scrollToCommand(idx);
					return;
				}
			}

			// Fallback: scroll to the spread element
			const target = document.getElementById(`cmd-${scrollTarget}`);
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
