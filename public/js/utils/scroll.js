import Lenis from "lenis";

// Check if user prefers reduced motion
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initSmoothScroll() {
	// Skip smooth scroll entirely if user prefers reduced motion
	if (prefersReducedMotion) {
		// Still handle anchor links but with instant scroll
		document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
			anchor.addEventListener("click", (e) => {
				e.preventDefault();
				const target = document.querySelector(anchor.getAttribute("href"));
				if (target) {
					target.scrollIntoView({ behavior: 'auto', block: 'start' });
				}
			});
		});
		return null;
	}

	const lenis = new Lenis({
		duration: 1.2,
		easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
		orientation: "vertical",
		gestureOrientation: "vertical",
		smoothWheel: true,
		wheelMultiplier: 1,
		touchMultiplier: 2,
	});

	function raf(time) {
		lenis.raf(time);
		requestAnimationFrame(raf);
	}

	requestAnimationFrame(raf);

	// Handle anchor links
	document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
		anchor.addEventListener("click", (e) => {
			e.preventDefault();
			const target = document.querySelector(anchor.getAttribute("href"));
			if (target) {
				lenis.scrollTo(target, { offset: -40 });
			}
		});
	});

    return lenis;
}

export function initScrollIndicator() {
	const indicator = document.querySelector(".hero-scroll-indicator");
	if (!indicator) return;

	function update() {
		if (window.scrollY > 20) {
			indicator.classList.add("hidden");
		} else {
			indicator.classList.remove("hidden");
		}
	}

	window.addEventListener("scroll", update, { passive: true });
	update();
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

	// Handle initial hash on page load
	if (window.location.hash) {
		const target = document.querySelector(window.location.hash);
		if (target) {
			setTimeout(() => {
				target.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}, 100);
		}
	}

	// Initial check
	updateHash();
}

