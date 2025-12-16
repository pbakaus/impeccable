/**
 * Periodic Table of Commands
 * Clean grid visualization showing all commands organized by category
 */

import { commandCategories, commandRelationships } from '../data.js';

const categoryColors = {
	diagnostic: { bg: '#fdf4ff', border: '#d946ef', text: '#a21caf' },
	quality: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' },
	intensity: { bg: '#fffbeb', border: '#f59e0b', text: '#b45309' },
	adaptation: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' },
	enhancement: { bg: '#fdf2f8', border: '#ec4899', text: '#be185d' },
	system: { bg: '#f9fafb', border: '#6b7280', text: '#374151' }
};

const categoryLabels = {
	diagnostic: 'Diagnostic',
	quality: 'Quality',
	intensity: 'Intensity',
	adaptation: 'Adaptation',
	enhancement: 'Enhancement',
	system: 'System'
};

// Short symbols for each command (like element symbols)
const commandSymbols = {
	audit: 'Au',
	normalize: 'No',
	polish: 'Po',
	optimize: 'Op',
	harden: 'Ha',
	clarify: 'Cl',
	simplify: 'Si',
	adapt: 'Ad',
	extract: 'Ex',
	animate: 'An',
	colorize: 'Co',
	delight: 'De',
	bolder: 'Bo',
	quieter: 'Qu',
	onboard: 'On'
};

// Atomic numbers (just for visual interest)
const commandNumbers = {
	audit: 1,
	normalize: 2,
	polish: 3,
	optimize: 4,
	harden: 5,
	clarify: 6,
	simplify: 7,
	adapt: 8,
	extract: 9,
	animate: 10,
	colorize: 11,
	delight: 12,
	bolder: 13,
	quieter: 14,
	onboard: 15
};

export class PeriodicTable {
	constructor(container) {
		this.container = container;
		this.infoPanel = null;
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
		`;

		this.renderTable();
		this.renderInfoPanel();
	}

	renderTable() {
		// Group commands by category
		const groups = {};
		Object.entries(commandCategories).forEach(([cmd, cat]) => {
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(cmd);
		});

		// Category order
		const categoryOrder = ['diagnostic', 'quality', 'adaptation', 'enhancement', 'intensity', 'system'];

		// Create grid container
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

	renderInfoPanel() {
		this.infoPanel = document.createElement('div');
		this.infoPanel.style.cssText = `
			background: var(--color-cream);
			border: 1px solid var(--color-mist);
			border-radius: 8px;
			padding: 16px 20px;
			height: 96px;
			display: flex;
			align-items: center;
			gap: 20px;
			flex-shrink: 0;
			overflow: hidden;
		`;

		// Default state
		this.showDefaultInfo();

		this.container.appendChild(this.infoPanel);
	}

	showDefaultInfo() {
		this.infoPanel.innerHTML = `
			<div style="
				font-family: var(--font-body);
				font-size: 14px;
				color: var(--color-ash);
				font-style: italic;
			">
				Hover over a command to see details
			</div>
		`;
	}

	showCommandInfo(cmd) {
		const category = commandCategories[cmd];
		const colors = categoryColors[category];
		const rel = commandRelationships[cmd] || {};

		// Normalize to arrays (pairs can be string or array)
		const toArray = (val) => {
			if (!val) return [];
			if (Array.isArray(val)) return val;
			return [val];
		};

		const pairs = toArray(rel.pairs);
		const leadsTo = toArray(rel.leadsTo);
		const combinesWith = toArray(rel.combinesWith);

		// Build related info
		let relatedHtml = '';

		if (pairs.length > 0) {
			const list = pairs.map(p => `<span style="font-family: var(--font-mono); color: var(--color-ink)">/${p}</span>`).join(', ');
			relatedHtml += `<span style="color: var(--color-ash)">Pairs with:</span> ${list}`;
		}
		if (combinesWith.length > 0) {
			const list = combinesWith.map(p => `<span style="font-family: var(--font-mono); color: var(--color-ink)">/${p}</span>`).join(', ');
			if (relatedHtml) relatedHtml += '<span style="color: var(--color-mist); margin: 0 8px;">•</span>';
			relatedHtml += `<span style="color: var(--color-ash)">Combines with:</span> ${list}`;
		}
		if (leadsTo.length > 0) {
			const list = leadsTo.map(p => `<span style="font-family: var(--font-mono); color: var(--color-ink)">/${p}</span>`).join(', ');
			if (relatedHtml) relatedHtml += '<span style="color: var(--color-mist); margin: 0 8px;">•</span>';
			relatedHtml += `<span style="color: var(--color-ash)">Then:</span> ${list}`;
		}

		this.infoPanel.innerHTML = `
			<div style="flex: 1; min-width: 0;">
				<div style="
					display: flex;
					align-items: baseline;
					gap: 10px;
					margin-bottom: 4px;
				">
					<span style="
						font-family: var(--font-mono);
						font-size: 15px;
						font-weight: 500;
						color: var(--color-ink);
					">/${cmd}</span>
					<span style="
						font-size: 11px;
						text-transform: uppercase;
						letter-spacing: 0.05em;
						color: ${colors.text};
						font-weight: 500;
					">${categoryLabels[category]}</span>
				</div>
				<div style="
					font-family: var(--font-body);
					font-size: 13px;
					color: var(--color-charcoal);
					line-height: 1.4;
					margin-bottom: ${relatedHtml ? '6px' : '0'};
				">${rel.flow || 'Design command'}</div>
				${relatedHtml ? `<div style="font-size: 12px; line-height: 1.4;">${relatedHtml}</div>` : ''}
			</div>
		`;
	}

	createCategoryGroup(category, commands) {
		const colors = categoryColors[category];

		const group = document.createElement('div');
		group.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 6px;
		`;

		// Category label
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

		// Elements row
		const row = document.createElement('div');
		row.style.cssText = `
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		`;

		commands.forEach(cmd => {
			const element = this.createElement(cmd, category);
			row.appendChild(element);
		});

		group.appendChild(row);
		return group;
	}

	createElement(cmd, category) {
		const colors = categoryColors[category];

		const el = document.createElement('div');
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

		// Hover effects
		el.addEventListener('mouseenter', () => {
			// Visual feedback
			el.style.transform = 'translateY(-2px)';
			el.style.boxShadow = `0 4px 12px ${colors.border}40`;

			// Update info panel
			this.showCommandInfo(cmd);

			// Track active element
			if (this.activeElement) {
				this.activeElement.style.transform = 'translateY(0)';
				this.activeElement.style.boxShadow = 'none';
			}
			this.activeElement = el;
		});

		el.addEventListener('mouseleave', () => {
			el.style.transform = 'translateY(0)';
			el.style.boxShadow = 'none';
		});

		// Click to scroll to command
		el.addEventListener('click', () => {
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
