export const foundationAnimations = {
	'Typography': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<path d="M10 30L20 10L30 30" stroke="var(--color-mist)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M10 30L20 10L30 30" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="anim-draw"/>
			<path d="M15 22H25" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" class="anim-draw-delay"/>
		</svg>
	`,
	'Color & Contrast': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<circle cx="16" cy="20" r="8" stroke="var(--color-ink)" stroke-width="1.5" class="anim-move-x"/>
			<circle cx="24" cy="20" r="8" stroke="var(--color-accent)" stroke-width="1.5" class="anim-move-x-opp"/>
			<path d="M20 14.5C21.5 16 22.5 18 22.5 20C22.5 22 21.5 24 20 25.5C18.5 24 17.5 22 17.5 20C17.5 18 18.5 16 20 14.5Z" fill="var(--color-accent)" class="anim-fade-in"/>
		</svg>
	`,
	'Spatial Design': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<rect x="5" y="10" width="30" height="18.5" stroke="var(--color-mist)" stroke-width="1"/>
			<line x1="23.5" y1="10" x2="23.5" y2="28.5" stroke="var(--color-mist)" stroke-width="1"/>
			<line x1="23.5" y1="21.5" x2="35" y2="21.5" stroke="var(--color-mist)" stroke-width="1"/>
			<path d="M5 28.5C5 18.28 13.28 10 23.5 10C29.85 10 35 15.15 35 21.5C35 25.42 31.82 28.5 27.9 28.5" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" class="anim-draw"/>
		</svg>
	`,
	'Responsive': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<rect x="6" y="8" width="28" height="24" rx="2" stroke="var(--color-ink)" stroke-width="1.5" class="anim-res-frame"/>
			<rect x="9" y="12" width="10" height="8" rx="1" fill="var(--color-accent)" class="anim-res-img"/>
			<rect x="22" y="12" width="10" height="2" rx="0.5" fill="var(--color-ink)" class="anim-res-title"/>
			<rect x="22" y="16.5" width="10" height="1.5" rx="0.5" fill="var(--color-ash)" class="anim-res-line-1"/>
			<rect x="22" y="20" width="8" height="1.5" rx="0.5" fill="var(--color-ash)" class="anim-res-line-2"/>
		</svg>
	`,
	'Interaction': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<rect x="10" y="14" width="20" height="12" rx="6" stroke="var(--color-ink)" stroke-width="1.5"/>
			<circle cx="16" cy="20" r="4" fill="var(--color-mist)" class="anim-toggle-move"/>
		</svg>
	`,
	'Motion': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<line x1="5" y1="32" x2="35" y2="32" stroke="var(--color-ink)" stroke-width="1.5"/>
			<circle cx="20" cy="15" r="5" fill="var(--color-accent)" class="anim-squash-ball"/>
		</svg>
	`,
	'UX Writing': `
		<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="foundation-svg">
			<rect x="8" y="12" width="18" height="2" rx="1" fill="var(--color-ink)"/>
			<rect x="8" y="18" width="22" height="2" rx="1" fill="var(--color-ash)"/>
			<rect x="8" y="24" width="14" height="2" rx="1" fill="var(--color-accent)"/>
			<line x1="24" y1="23" x2="24" y2="27" stroke="var(--color-accent)" stroke-width="1.5" class="anim-blink"/>
		</svg>
	`
};
