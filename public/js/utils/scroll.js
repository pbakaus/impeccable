// Instant anchor scroll - no smooth scrolling for better UX on long pages
export function initAnchorScroll() {
	document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
		anchor.addEventListener("click", (e) => {
			e.preventDefault();
			const target = document.querySelector(anchor.getAttribute("href"));
			if (target) {
				// Instant jump with small offset for visual breathing room
				const offset = 40;
				const targetPosition = target.getBoundingClientRect().top + window.scrollY - offset;
				window.scrollTo({ top: targetPosition, behavior: 'auto' });
			}
		});
	});
}

export function initHashTracking() {
	const sections = document.querySelectorAll('section[id]');
	if (!sections.length) return;

	let currentHash = window.location.hash.slice(1) || '';
	let ticking = false;

	function updateHash() {
		const scrollY = window.scrollY;
		const viewportHeight = window.innerHeight;
		const triggerPoint = scrollY + viewportHeight * 0.3;

		let activeSection = '';

		sections.forEach(section => {
			const rect = section.getBoundingClientRect();
			const sectionTop = scrollY + rect.top;
			const sectionBottom = sectionTop + rect.height;

			if (triggerPoint >= sectionTop && triggerPoint < sectionBottom) {
				activeSection = section.id;
			}
		});

		if (activeSection !== currentHash) {
			currentHash = activeSection;
			if (activeSection) {
				history.replaceState(null, '', `#${activeSection}`);
			} else {
				history.replaceState(null, '', window.location.pathname);
			}
		}

		ticking = false;
	}

	window.addEventListener('scroll', () => {
		if (!ticking) {
			requestAnimationFrame(updateHash);
			ticking = true;
		}
	}, { passive: true });

	// Handle initial hash on page load - instant jump
	if (window.location.hash) {
		const target = document.querySelector(window.location.hash);
		if (target) {
			setTimeout(() => {
				const offset = 40;
				const targetPosition = target.getBoundingClientRect().top + window.scrollY - offset;
				window.scrollTo({ top: targetPosition, behavior: 'auto' });
			}, 100);
		}
	}

	// Initial check
	updateHash();
}

