import { skillFocusAreas, slopFocusAreas, dimensionGuidelineCounts } from '../data.js';
import { foundationAnimations } from './foundation-animations.js';

// Renders the seven-discipline grid. The container picks its data source via
// `data-source="foundation"` (the original "loaded on every command" copy) or
// `data-source="slop"` (the slop-tells-we-prevent copy used on /catch-the-slop).
// Both share the icon + plinth + card chrome so we get the elegant magazine
// rail twice without two parallel components.
export function initFoundationGrid() {
	const containers = document.querySelectorAll('.foundation-grid');
	if (!containers.length) return;

	containers.forEach((container) => {
		const source = container.dataset.source || 'foundation';
		const data = source === 'slop' ? slopFocusAreas['impeccable'] : skillFocusAreas['impeccable'];
		if (!data) return;
		const showCount = source !== 'slop';

		container.innerHTML = data.map((dim, i) => `
			<div class="foundation-column">
				<div class="foundation-card">
					<div class="foundation-card-viz">
						${foundationAnimations[dim.area] || ''}
					</div>
					<div class="foundation-card-header">
						<span class="foundation-card-label">${dim.area}</span>
						${showCount ? `<span class="foundation-card-count">${dimensionGuidelineCounts[dim.area] || ''}</span>` : ''}
					</div>
					<p class="foundation-card-detail">${dim.detail}</p>
				</div>
				<div class="foundation-plinth plinth-${i + 1}"></div>
			</div>
		`).join('');
	});
}
