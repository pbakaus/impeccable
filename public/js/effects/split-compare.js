// ============================================
// SPLIT COMPARE - Reusable before/after split-screen effect
// ============================================

/**
 * Initialize split comparison effect on a container
 * @param {HTMLElement} container - The container element with .split-container inside
 * @param {Object} options - Configuration options
 */
export function initSplitCompare(container, options = {}) {
	const {
		defaultPosition = 70,
		skewOffset = 8,
		minPosition = -skewOffset,
		maxPosition = 100 + skewOffset,
		lerpSpeed = 0.15,
		animationThreshold = 40, // Re-trigger animations when crossing this threshold
		onCrossThreshold = null // Callback when crossing threshold toward "after" side
	} = options;

	const splitContainer = container.querySelector('.split-container');
	const splitAfter = container.querySelector('.split-after');
	const splitDivider = container.querySelector('.split-divider');

	if (!splitContainer || !splitAfter || !splitDivider) return null;

	let isHovering = false;
	let currentX = defaultPosition;
	let targetX = defaultPosition;
	let animationId = null;
	let wasAboveThreshold = defaultPosition > animationThreshold;

	function updateSplit(percent) {
		const clampedX = Math.max(minPosition, Math.min(maxPosition, percent));

		// Check if we crossed the threshold toward the "after" side (moving left)
		const isAboveThreshold = clampedX > animationThreshold;
		if (wasAboveThreshold && !isAboveThreshold) {
			// Crossed threshold - re-trigger animations
			retriggerAnimations();
			if (onCrossThreshold) onCrossThreshold(clampedX);
		}
		wasAboveThreshold = isAboveThreshold;

		// Angled clip-path matching divider's skewX(-10deg)
		splitAfter.style.clipPath = `polygon(${clampedX + skewOffset}% 0%, 100% 0%, 100% 100%, ${clampedX - skewOffset}% 100%)`;
		splitDivider.style.left = `${clampedX}%`;
	}

	function retriggerAnimations() {
		// Re-trigger CSS animations in the "after" content.
		// If there's a canvas (e.g. overdrive shader), we can't clone-and-replace
		// because that destroys JS-driven animations. In that case, retrigger
		// individual elements. Otherwise, use the fast clone approach.
		const afterContent = splitAfter.querySelector('.split-content');
		if (!afterContent) return;

		const hasCanvas = afterContent.querySelector('canvas, .od-burn, .od-sparks');
		if (hasCanvas) {
			// Safe path: retrigger CSS animations individually, skip canvas
			afterContent.querySelectorAll('*').forEach(el => {
				if (el.tagName === 'CANVAS') return;
				const anim = getComputedStyle(el).animationName;
				if (anim && anim !== 'none') {
					el.style.animation = 'none';
					el.offsetHeight;
					el.style.animation = '';
				}
			});
		} else {
			// Fast path: clone and replace to restart all CSS animations
			const clone = afterContent.cloneNode(true);
			afterContent.parentNode.replaceChild(clone, afterContent);
		}
	}

	function animate() {
		const diff = targetX - currentX;
		if (Math.abs(diff) > 0.1) {
			currentX += diff * lerpSpeed;
			updateSplit(currentX);
			animationId = requestAnimationFrame(animate);
		} else {
			currentX = targetX;
			updateSplit(currentX);
			animationId = null;
		}
	}

	function startAnimation() {
		if (!animationId) {
			animationId = requestAnimationFrame(animate);
		}
	}

	function handleMouseEnter() {
		isHovering = true;
	}

	function handleMouseLeave() {
		isHovering = false;
		targetX = defaultPosition;
		startAnimation();
	}

	function handleMouseMove(e) {
		if (isHovering) {
			const rect = splitContainer.getBoundingClientRect();
			const range = 100 + 2 * skewOffset;
			targetX = ((e.clientX - rect.left) / rect.width) * range - skewOffset;
			startAnimation();
		}
	}

	let touchStartX = 0;
	let touchStartY = 0;
	let isDragging = false;
	const DRAG_THRESHOLD = 10; // Minimum horizontal movement to start dragging

	function handleTouchStart(e) {
		const touch = e.touches[0];
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		isDragging = false;
		isHovering = true;
	}

	function handleTouchEnd() {
		isHovering = false;
		isDragging = false;
		targetX = defaultPosition;
		startAnimation();
	}

	function handleTouchMove(e) {
		const touch = e.touches[0];
		const deltaX = Math.abs(touch.clientX - touchStartX);
		const deltaY = Math.abs(touch.clientY - touchStartY);

		// Only start dragging if horizontal movement is greater than vertical
		// This allows vertical scrolling to pass through
		if (!isDragging) {
			if (deltaX > DRAG_THRESHOLD && deltaX > deltaY) {
				isDragging = true;
			} else if (deltaY > DRAG_THRESHOLD) {
				// User is scrolling vertically, don't interfere
				return;
			} else {
				// Not enough movement yet
				return;
			}
		}

		// Only prevent default when actively dragging horizontally
		if (isDragging) {
			e.preventDefault();
			const rect = splitContainer.getBoundingClientRect();
			targetX = ((touch.clientX - rect.left) / rect.width) * 100;
			startAnimation();
		}
	}

	// Use the parent container for mouse events to create a larger hit area
	const hitArea = splitContainer.parentElement || splitContainer;

	// Attach listeners — mouse events on the wider hit area
	hitArea.addEventListener('mouseenter', handleMouseEnter);
	hitArea.addEventListener('mouseleave', handleMouseLeave);
	hitArea.addEventListener('mousemove', handleMouseMove);
	splitContainer.addEventListener('touchstart', handleTouchStart);
	splitContainer.addEventListener('touchend', handleTouchEnd);
	splitContainer.addEventListener('touchmove', handleTouchMove, { passive: false });

	// Initialize
	updateSplit(defaultPosition);

	// Return cleanup function
	return {
		destroy() {
			hitArea.removeEventListener('mouseenter', handleMouseEnter);
			hitArea.removeEventListener('mouseleave', handleMouseLeave);
			hitArea.removeEventListener('mousemove', handleMouseMove);
			splitContainer.removeEventListener('touchstart', handleTouchStart);
			splitContainer.removeEventListener('touchend', handleTouchEnd);
			splitContainer.removeEventListener('touchmove', handleTouchMove);
			if (animationId) cancelAnimationFrame(animationId);
		},
		setPosition(percent) {
			targetX = percent;
			startAnimation();
		}
	};
}

/**
 * Initialize all split comparisons on the page
 */
export function initAllSplitCompare(selector = '.split-comparison', options = {}) {
	const containers = document.querySelectorAll(selector);
	const instances = [];

	containers.forEach(container => {
		const instance = initSplitCompare(container, options);
		if (instance) instances.push(instance);
	});

	return instances;
}
