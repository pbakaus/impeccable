export function initHeroEffect() {
	const canvas = document.getElementById("hero-canvas");
	if (!canvas) return;

	const ctx = canvas.getContext("2d");
	let width, height;
	let points = [];
	let gap = 50; // Grid gap
	const mouse = { x: -1000, y: -1000, radius: 150 }; // Moderate radius
	let animationId;

	// Physics params - Elegant & Fluid
	const friction = 0.9; // Higher friction = less slippery
	const ease = 0.1; // Standard spring
	const forceMultiplier = 3; // Subtle push, not a splash

	class Point {
		constructor(x, y) {
			this.x = x;
			this.y = y;
			this.ox = x; // original x
			this.oy = y; // original y
			this.vx = 0;
			this.vy = 0;
		}

		update() {
			// Mouse interaction
			const dx = mouse.x - this.x;
			const dy = mouse.y - this.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const force = Math.max(0, (mouse.radius - dist) / mouse.radius);

			if (force > 0) {
				const angle = Math.atan2(dy, dx);
				// Gentle push
				this.vx -= Math.cos(angle) * force * forceMultiplier;
				this.vy -= Math.sin(angle) * force * forceMultiplier;
			}

			// Spring back to original position
			this.vx += (this.ox - this.x) * ease;
			this.vy += (this.oy - this.y) * ease;

			// Friction
			this.vx *= friction;
			this.vy *= friction;

			// Update position
			this.x += this.vx;
			this.y += this.vy;
		}
	}

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		width = rect.width;
		height = rect.height;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.scale(dpr, dpr);
		
		initGrid();
	}

	function initGrid() {
		points = [];
		// Responsive gap
		gap = width < 768 ? 40 : 50;
		
		const cols = Math.ceil(width / gap);
		const rows = Math.ceil(height / gap);

		for (let i = 0; i <= cols; i++) {
			for (let j = 0; j <= rows; j++) {
				points.push(new Point(i * gap, j * gap));
			}
		}
	}

	function draw() {
		ctx.clearRect(0, 0, width, height);
		
		// Update points
		points.forEach(p => p.update());

		// Draw grid lines
		ctx.beginPath();
		ctx.strokeStyle = "rgba(100, 40, 50, 0.06)"; // Very subtle base
		ctx.lineWidth = 1;

		const cols = Math.ceil(width / gap) + 1;
		
		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			
			// Draw Horizontal
			if ((i + 1) % cols !== 0 && i + 1 < points.length) {
				const next = points[i + 1];
				// Use Bezier for fluid curves instead of straight lines
				const xc = (p.x + next.x) / 2;
				const yc = (p.y + next.y) / 2;
				ctx.moveTo(p.x, p.y);
				// ctx.quadraticCurveTo(p.x, p.y, xc, yc); // Slightly more expensive but smoother? 
				// Actually straight lines with high enough density look fine and are faster.
				// Let's stick to lineTo for performance, the points themselves move smoothly.
				ctx.lineTo(next.x, next.y);
			}

			// Draw Vertical
			if (i + cols < points.length) {
				const next = points[i + cols];
				ctx.moveTo(p.x, p.y);
				ctx.lineTo(next.x, next.y);
			}
		}
		ctx.stroke();

		animationId = requestAnimationFrame(draw);
	}

	function handleMouseMove(e) {
		const rect = canvas.getBoundingClientRect();
		mouse.x = e.clientX - rect.left;
		mouse.y = e.clientY - rect.top;
	}
	
	function handleMouseLeave() {
		mouse.x = -1000;
		mouse.y = -1000;
	}

	window.addEventListener("resize", resize);
	canvas.parentElement.addEventListener("mousemove", handleMouseMove);
	canvas.parentElement.addEventListener("mouseleave", handleMouseLeave);

	resize();
	draw();

	// Cleanup
	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (entry.isIntersecting) {
				if (!animationId) draw();
			} else {
				if (animationId) {
					cancelAnimationFrame(animationId);
					animationId = null;
				}
			}
		});
	});

	observer.observe(canvas);
}


