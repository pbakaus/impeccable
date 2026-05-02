// Instant anchor scroll - no smooth scrolling for better UX on long pages.
// `behavior: 'instant'` explicitly overrides any CSS `scroll-behavior: smooth`
// from a stylesheet we don't own; `behavior: 'auto'` would defer to CSS.
export function initAnchorScroll() {
	document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
		anchor.addEventListener("click", (e) => {
			e.preventDefault();
			const target = document.querySelector(anchor.getAttribute("href"));
			if (target) {
				const offset = 40;
				const targetPosition = target.getBoundingClientRect().top + window.scrollY - offset;
				window.scrollTo({ top: targetPosition, behavior: 'instant' });
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
		// Don't override command deep links while user is in the commands section
		if (currentHash.startsWith('cmd-')) {
			const cmdEl = document.getElementById(currentHash);
			if (cmdEl) {
				const rect = cmdEl.getBoundingClientRect();
				// Only clear the cmd hash if user scrolled well away from commands section
				if (rect.top > window.innerHeight * 2 || rect.bottom < -window.innerHeight) {
					currentHash = '';
				} else {
					ticking = false;
					return;
				}
			}
		}

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

		// Don't set #hero — it's the default state, no hash needed
		if (activeSection === 'hero') activeSection = '';

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

	// Handle initial hash on page load — instant jump, retried on
	// fonts.ready and window `load`. A fixed setTimeout is unreliable
	// because async-loaded display fonts reflow the page by hundreds of
	// pixels when they swap in; computing target position before that
	// lands the user several sections above the right spot.
	if (window.location.hash) {
		const hash = window.location.hash.slice(1);
		const target = document.getElementById(hash);
		if (target) {
			currentHash = hash;
			let clicked = false;
			const jump = () => {
				const offset = 40;
				const targetPosition = target.getBoundingClientRect().top + window.scrollY - offset;
				window.scrollTo({ top: targetPosition, behavior: 'instant' });
				if (!clicked && hash.startsWith('cmd-') && target.classList.contains('manual-entry')) {
					target.click();
					clicked = true;
				}
			};
			jump();
			if (document.fonts?.ready) document.fonts.ready.then(jump).catch(() => {});
			window.addEventListener('load', jump, { once: true });
		}
	} else {
		// No hash — don't set one on initial load
	}
}

