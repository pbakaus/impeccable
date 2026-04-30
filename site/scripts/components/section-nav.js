/**
 * Sticky Section Nav
 * Shows/hides based on scroll position and highlights current section.
 */

export function initSectionNav() {
	const nav = document.getElementById('section-nav');
	if (!nav) return;

	const items = nav.querySelectorAll('.section-nav-item');
	const sectionIds = Array.from(items).map(item => item.dataset.section);

	// Show/hide nav based on scroll position
	const hero = document.getElementById('hero');
	const footer = document.querySelector('.site-footer');
	if (!hero) return;

	let ticking = false;

	// Returns the element's top position relative to the document,
	// which works even when the element is inside a positioned parent.
	function docTop(el) {
		return el.getBoundingClientRect().top + window.scrollY;
	}

	function updateNav() {
		const scrollY = window.scrollY;
		const heroBottom = hero.offsetTop + hero.offsetHeight - 100;
		const footerTop = footer ? docTop(footer) : Infinity;
		const viewportBottom = scrollY + window.innerHeight;

		// Show nav after hero, hide when footer is visible
		if (scrollY > heroBottom && viewportBottom < footerTop + 60) {
			nav.classList.add('is-visible');
		} else {
			nav.classList.remove('is-visible');
		}

		// Find current section
		let currentSection = null;
		const viewportMiddle = scrollY + window.innerHeight * 0.4;

		for (let i = sectionIds.length - 1; i >= 0; i--) {
			const section = document.getElementById(sectionIds[i]);
			if (section && docTop(section) <= viewportMiddle) {
				currentSection = sectionIds[i];
				break;
			}
		}

		// If the current section shares its top row with siblings (e.g. side-by-side
		// changelog + FAQ on desktop), treat all of them as active.
		const activeSections = new Set();
		if (currentSection) {
			const currentEl = document.getElementById(currentSection);
			const currentTop = currentEl ? docTop(currentEl) : 0;
			sectionIds.forEach(id => {
				const el = document.getElementById(id);
				if (el && Math.abs(docTop(el) - currentTop) < 4) {
					activeSections.add(id);
				}
			});
		}

		// Update active state
		items.forEach(item => {
			if (activeSections.has(item.dataset.section)) {
				item.classList.add('is-active');
			} else {
				item.classList.remove('is-active');
			}
		});

		ticking = false;
	}

	window.addEventListener('scroll', () => {
		if (!ticking) {
			requestAnimationFrame(updateNav);
			ticking = true;
		}
	}, { passive: true });

	// Initial check
	updateNav();
}
