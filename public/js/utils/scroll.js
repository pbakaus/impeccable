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

	// Handle initial hash on page load - instant jump
	if (window.location.hash) {
		const hash = window.location.hash.slice(1);
		const target = document.getElementById(hash);
		if (target) {
			currentHash = hash;
			setTimeout(() => {
				const offset = 40;
				const targetPosition = target.getBoundingClientRect().top + window.scrollY - offset;
				window.scrollTo({ top: targetPosition, behavior: 'auto' });

				// If it's a command deep link, activate it
				if (hash.startsWith('cmd-') && target.classList.contains('manual-entry')) {
					target.click();
				}
			}, 100);
		}
	} else {
		// No hash — don't set one on initial load
	}
}

