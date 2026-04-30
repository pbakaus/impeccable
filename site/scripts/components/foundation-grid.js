import { skillFocusAreas, dimensionGuidelineCounts } from '../data.js';
import { foundationAnimations } from './foundation-animations.js';

export function initFoundationGrid() {
	const container = document.querySelector('.foundation-grid');
	if (!container) return;

	const dimensions = skillFocusAreas['impeccable'];
	if (!dimensions) return;

	container.innerHTML = dimensions.map((dim, i) => `
		<div class="foundation-column">
			<div class="foundation-card">
				<div class="foundation-card-viz">
					${foundationAnimations[dim.area] || ''}
				</div>
				<div class="foundation-card-header">
					<span class="foundation-card-label">${dim.area}</span>
					<span class="foundation-card-count">${dimensionGuidelineCounts[dim.area] || ''}</span>
				</div>
				<p class="foundation-card-detail">${dim.detail}</p>
			</div>
			<div class="foundation-plinth plinth-${i + 1}"></div>
		</div>
	`).join('');
}
