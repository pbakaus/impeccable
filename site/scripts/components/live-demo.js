// Interactive Live Mode demo loop. Matches the real picker flow:
// - a persistent dark global bar stays at the bottom of the frame the whole time
// - a light contextual bar floats above the picked element during a session,
//   morphing between configure → generating → cycling → accepted
//
// Plays only while the section is in view. Respects prefers-reduced-motion.

const PHASE = {
	HIDDEN: 'hidden',
	CONFIGURING: 'configuring',
	GENERATING: 'generating',
	CYCLING: 'cycling',
	ACCEPTED: 'accepted',
};

const TIMELINE = [
	{ dt: 400,  action: 'cursor-show' },
	{ dt: 400,  action: 'cursor-to-target' },
	{ dt: 900,  action: 'outline-show', caption: 'Hover to pick.' },
	{ dt: 500,  action: 'cursor-click' },
	{ dt: 200,  action: 'open-ctx', caption: 'Picked. Contextual bar appears.' },
	{ dt: 700,  action: 'cursor-to-input' },
	{ dt: 300,  action: 'type', text: 'more playful', caption: 'Type a refinement, or skip.' },
	{ dt: 1200, action: 'draw-stroke', caption: 'Annotate on the page, if you want.' },
	{ dt: 900,  action: 'cursor-to-go' },
	{ dt: 300,  action: 'click-go', caption: 'Generating three variants…' },
	{ dt: 1600, action: 'show-variant', n: 1, caption: 'Variant 1 of 3.' },
	{ dt: 1400, action: 'show-variant', n: 2, caption: 'Variant 2 of 3.' },
	{ dt: 1400, action: 'show-variant', n: 3, caption: 'Variant 3 of 3.' },
	{ dt: 900,  action: 'cursor-to-accept' },
	{ dt: 300,  action: 'click-accept', caption: 'Accepted. Written to source.' },
	{ dt: 1800, action: 'reset', caption: 'Hover to pick.' },
];

export function initLiveDemo() {
	const root = document.getElementById('live-demo');
	if (!root) return;

	const stage = root.querySelector('.live-demo-stage');
	const target = root.querySelector('[data-demo-target]');
	const outline = root.querySelector('[data-demo-outline]');
	const annotations = root.querySelector('[data-demo-annotations]');
	const cursor = root.querySelector('[data-demo-cursor]');
	const ctx = root.querySelector('[data-demo-ctx]');
	const inputText = root.querySelector('[data-demo-input-text]');
	const counter = root.querySelector('[data-demo-counter]');
	const captionLabel = root.querySelector('[data-demo-caption-label]');
	const variants = Array.from(root.querySelectorAll('.live-demo-variant'));

	if (!stage || !target || !ctx) return;

	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Position the outline around the target.
	const positionOutline = () => {
		const stageRect = stage.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		outline.style.left = (targetRect.left - stageRect.left - 4) + 'px';
		outline.style.top = (targetRect.top - stageRect.top - 4) + 'px';
		outline.style.width = (targetRect.width + 8) + 'px';
		outline.style.height = (targetRect.height + 8) + 'px';
	};

	// Position the contextual bar below the target (or above if below would
	// collide with the global bar). Mirrors positionBar() in live-browser.js.
	const positionCtx = () => {
		const stageRect = stage.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const ctxRect = ctx.getBoundingClientRect();
		const GAP = 10;
		const BAR_RESERVE = 60;
		const belowTop = targetRect.bottom - stageRect.top + GAP;
		const aboveTop = targetRect.top - stageRect.top - ctxRect.height - GAP;
		let top;
		if (belowTop + ctxRect.height + GAP <= stage.clientHeight - BAR_RESERVE) {
			top = belowTop;
		} else if (aboveTop >= GAP) {
			top = aboveTop;
		} else {
			top = stage.clientHeight - ctxRect.height - BAR_RESERVE;
		}
		ctx.style.top = top + 'px';
	};

	const moveCursor = (selector, offsetX = 0, offsetY = 0) => {
		const stageRect = stage.getBoundingClientRect();
		const el = typeof selector === 'string' ? root.querySelector(selector) : selector;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const x = rect.left - stageRect.left + rect.width / 2 + offsetX;
		const y = rect.top - stageRect.top + rect.height / 2 + offsetY;
		cursor.style.transform = `translate(${x}px, ${y}px)`;
	};

	const showVariant = (n) => {
		variants.forEach((v) => {
			const match = (n === 0 && v.dataset.variant === 'original') || v.dataset.variant === String(n);
			v.classList.toggle('is-active', match);
		});
		counter.textContent = n + ' / 3';
		requestAnimationFrame(() => {
			positionOutline();
			positionCtx();
		});
	};

	const setCtxPhase = (phase) => {
		ctx.dataset.phase = phase;
		if (phase !== PHASE.HIDDEN) requestAnimationFrame(positionCtx);
	};

	const reset = () => {
		setCtxPhase(PHASE.HIDDEN);
		cursor.classList.remove('is-visible', 'is-click');
		outline.classList.remove('is-visible');
		annotations.classList.remove('is-visible', 'is-comment-visible');
		inputText.textContent = '';
		showVariant(0);
	};

	const setCaption = (text) => {
		if (text && captionLabel) captionLabel.textContent = text;
	};

	const typeText = (text, duration) => new Promise((resolve) => {
		inputText.textContent = '';
		const per = Math.max(30, Math.floor(duration / text.length));
		let i = 0;
		const tick = () => {
			if (i >= text.length) return resolve();
			inputText.textContent += text[i++];
			setTimeout(tick, per);
		};
		tick();
	});

	const step = async (s) => {
		switch (s.action) {
			case 'cursor-show':
				moveCursor(target, -120, 40);
				cursor.classList.add('is-visible');
				break;
			case 'cursor-to-target':
				moveCursor(target);
				break;
			case 'outline-show':
				positionOutline();
				outline.classList.add('is-visible');
				break;
			case 'cursor-click':
				cursor.classList.add('is-click');
				setTimeout(() => cursor.classList.remove('is-click'), 260);
				break;
			case 'open-ctx':
				setCtxPhase(PHASE.CONFIGURING);
				break;
			case 'cursor-to-input':
				moveCursor(root.querySelector('[data-demo-input]'));
				break;
			case 'type':
				await typeText(s.text, 700);
				break;
			case 'draw-stroke':
				annotations.classList.add('is-visible');
				setTimeout(() => annotations.classList.add('is-comment-visible'), 600);
				break;
			case 'cursor-to-go':
				moveCursor(root.querySelector('[data-demo-go]'));
				break;
			case 'click-go':
				cursor.classList.add('is-click');
				setTimeout(() => cursor.classList.remove('is-click'), 260);
				annotations.classList.remove('is-visible', 'is-comment-visible');
				setCtxPhase(PHASE.GENERATING);
				break;
			case 'show-variant':
				if (ctx.dataset.phase !== PHASE.CYCLING) setCtxPhase(PHASE.CYCLING);
				showVariant(s.n);
				break;
			case 'cursor-to-accept':
				moveCursor(root.querySelector('[data-demo-accept]'));
				break;
			case 'click-accept':
				cursor.classList.add('is-click');
				setTimeout(() => cursor.classList.remove('is-click'), 260);
				setCtxPhase(PHASE.ACCEPTED);
				outline.classList.remove('is-visible');
				break;
			case 'reset':
				reset();
				break;
		}
		setCaption(s.caption);
	};

	let running = false;
	let cancelToken = 0;
	const sleep = (ms, token) => new Promise((resolve) => setTimeout(() => resolve(token === cancelToken), ms));

	const run = async () => {
		if (running) return;
		running = true;
		const myToken = ++cancelToken;
		while (running && myToken === cancelToken) {
			reset();
			for (const s of TIMELINE) {
				const stillMe = await sleep(s.dt, myToken);
				if (!stillMe || !running) return;
				await step(s);
			}
		}
	};

	const stop = () => {
		running = false;
		cancelToken++;
	};

	if (reduced) {
		// Freeze on a representative still: cycling, variant 3.
		showVariant(3);
		counter.textContent = '3 / 3';
		positionOutline();
		outline.classList.add('is-visible');
		setCtxPhase(PHASE.CYCLING);
		setCaption('Three variants. Pick the one you want.');
		return;
	}

	const io = new IntersectionObserver((entries) => {
		entries.forEach((e) => {
			if (e.isIntersecting) run();
			else stop();
		});
	}, { threshold: 0.35 });
	io.observe(root);

	window.addEventListener('resize', () => requestAnimationFrame(() => {
		positionOutline();
		positionCtx();
	}));
}
