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
	{ dt: 220,  action: 'cursor-show' },
	{ dt: 260,  action: 'cursor-to-target' },
	{ dt: 560,  action: 'outline-show', caption: 'Pick any element on your live page.' },
	{ dt: 300,  action: 'cursor-click' },
	{ dt: 180,  action: 'open-ctx' },
	{ dt: 340,  action: 'cursor-to-cmd' },
	{ dt: 320,  action: 'open-palette', caption: 'Open the command palette: the design vocabulary.' },
	{ dt: 950,  action: 'browse-palette', cmd: 'bolder' },
	{ dt: 700,  action: 'browse-palette', cmd: 'typeset' },
	{ dt: 700,  action: 'browse-target' },
	{ dt: 1000, action: 'pick-target', caption: 'Pick a design verb, or just describe it.' },
	{ dt: 560,  action: 'cursor-to-button' },
	{ dt: 250,  action: 'draw-circle', caption: 'Circle what’s off-brand…' },
	{ dt: 700,  action: 'drop-pin' },
	{ dt: 300,  action: 'type-note', text: 'match the suites below', caption: '…and say what you want.' },
	{ dt: 1800, action: 'hold', caption: 'Mark + note are sent to your agent.' },
	{ dt: 900,  action: 'cursor-to-go' },
	{ dt: 300,  action: 'click-go', caption: 'Generating three variants…' },
	{ dt: 1600, action: 'show-variant', n: 1, caption: 'Variant 1 of 3.' },
	{ dt: 1400, action: 'show-variant', n: 2, caption: 'Variant 2 of 3.' },
	{ dt: 1400, action: 'show-variant', n: 3, caption: 'Variant 3 of 3.' },
	{ dt: 900,  action: 'cursor-to-accept' },
	{ dt: 300,  action: 'click-accept', caption: 'Accepted. Written to source.' },
	{ dt: 1800, action: 'reset', caption: 'Pick any element on your live page.' },
];

// Steps that drive the command-palette switcher. Pages whose context bar has no
// [data-demo-palette] (e.g. /live-mode) get these filtered out of the timeline,
// so they don't sit through dead pauses for a UI they don't render.
const PALETTE_ACTIONS = new Set(['cursor-to-cmd', 'open-palette', 'browse-palette', 'browse-target', 'pick-target']);

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
	const noteText = root.querySelector('[data-demo-note-text]');
	const palette = root.querySelector('[data-demo-palette]');
	const cmdName = root.querySelector('[data-demo-cmd-name]');
	const defaultCmd = cmdName ? cmdName.textContent : '';
	// Drop the palette-switcher beats on pages that don't render the palette.
	const timeline = palette ? TIMELINE : TIMELINE.filter((s) => !PALETTE_ACTIONS.has(s.action));
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

	// Overlay the annotation layer (circle + comment pin) exactly on the target,
	// so the marks sit on the picked card rather than the stage center.
	const positionAnnotations = () => {
		if (!annotations) return;
		const stageRect = stage.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		annotations.style.left = (targetRect.left - stageRect.left) + 'px';
		annotations.style.top = (targetRect.top - stageRect.top) + 'px';
		annotations.style.width = targetRect.width + 'px';
		annotations.style.height = targetRect.height + 'px';
	};

	// Position the contextual bar below the target (or above if below would
	// collide with the global bar). Mirrors positionBar() in live-browser.js.
	const positionCtx = () => {
		const stageRect = stage.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const ctxRect = ctx.getBoundingClientRect();
		const GAP = 10;
		// Clearance kept below the bar inside the stage. The global bar lives
		// outside the stage, so this only needs to be a small visual margin.
		const BAR_RESERVE = 24;
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

		// Center the bar on the target horizontally (the target is no longer the
		// stage centre), clamped to the stage edges.
		const rawLeft = targetRect.left - stageRect.left + targetRect.width / 2 - ctxRect.width / 2;
		const maxLeft = stage.clientWidth - ctxRect.width - 8;
		ctx.style.left = Math.max(8, Math.min(rawLeft, maxLeft)) + 'px';
		ctx.style.transform = 'none';
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
		annotations.classList.remove('is-visible', 'is-pin-visible', 'is-note-visible');
		if (noteText) noteText.textContent = '';
		if (inputText) inputText.textContent = '';
		if (palette) palette.classList.remove('is-open');
		if (palette) palette.querySelectorAll('.live-demo-ctx-palette-chip').forEach((r) => r.classList.remove('is-highlight'));
		if (cmdName) cmdName.textContent = defaultCmd;
		showVariant(0);
	};

	const clearAnnotations = () =>
		annotations.classList.remove('is-visible', 'is-pin-visible', 'is-note-visible');

	const setPalette = (open) => {
		if (!palette) return;
		palette.classList.toggle('is-open', open);
		if (!open) palette.querySelectorAll('.live-demo-ctx-palette-chip').forEach((r) => r.classList.remove('is-highlight'));
	};

	const highlightCmd = (cmd) => {
		if (!palette) return null;
		const chip = palette.querySelector(`[data-cmd="${cmd}"]`);
		palette.querySelectorAll('.live-demo-ctx-palette-chip').forEach((r) => r.classList.toggle('is-highlight', r === chip));
		return chip;
	};

	const setCaption = (text) => {
		if (text && captionLabel) captionLabel.textContent = text;
	};

	const typeInto = (el, text, duration) => new Promise((resolve) => {
		if (!el) return resolve();
		el.textContent = '';
		const per = Math.max(30, Math.floor(duration / text.length));
		let i = 0;
		const tick = () => {
			if (i >= text.length) return resolve();
			el.textContent += text[i++];
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
			case 'cursor-to-cmd':
				moveCursor(root.querySelector('[data-demo-ctx-pill]'));
				break;
			case 'open-palette':
				setPalette(true);
				break;
			case 'browse-palette': {
				const chip = highlightCmd(s.cmd);
				if (chip) moveCursor(chip);
				break;
			}
			case 'browse-target': {
				// The verb each page lands on, declared via data-demo-pick on the palette.
				const chip = highlightCmd(palette && palette.dataset.demoPick);
				if (chip) moveCursor(chip);
				break;
			}
			case 'pick-target':
				cursor.classList.add('is-click');
				setTimeout(() => cursor.classList.remove('is-click'), 220);
				if (cmdName && palette && palette.dataset.demoPick) cmdName.textContent = palette.dataset.demoPick;
				setPalette(false);
				break;
			case 'cursor-to-button':
				// Over the purple "Book Now" button (lower-left).
				moveCursor(target, -150, 26);
				break;
			case 'draw-circle':
				positionAnnotations();
				annotations.classList.add('is-visible');
				break;
			case 'drop-pin':
				// Near the pin's CSS position (left 46%, top 78%).
				moveCursor(target, -16, 52);
				cursor.classList.add('is-click');
				setTimeout(() => cursor.classList.remove('is-click'), 220);
				annotations.classList.add('is-pin-visible');
				break;
			case 'type-note':
				annotations.classList.add('is-note-visible');
				await typeInto(noteText, s.text, 800);
				break;
			case 'hold':
				break;
			case 'cursor-to-go':
				moveCursor(root.querySelector('[data-demo-go]'));
				break;
			case 'click-go':
				cursor.classList.add('is-click');
				setTimeout(() => cursor.classList.remove('is-click'), 260);
				clearAnnotations();
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
			for (const s of timeline) {
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
		positionAnnotations();
		positionCtx();
	}));
}

/** Collapsed page-chat pill on marketing gbars — mirrors live-browser.js expand UX. */
export function initGbarPageChat() {
	const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
	document.querySelectorAll('[data-demo-gbar-chat]').forEach((chat) => {
		const input = chat.querySelector('.live-demo-gbar-chat-input');
		const hint = chat.querySelector('.live-demo-gbar-chat-hint');
		const voice = chat.querySelector('.live-demo-gbar-chat-voice');
		if (!input) return;

		const expand = () => {
			chat.classList.add('is-expanded');
			chat.dataset.expanded = 'true';
			if (hint) hint.hidden = true;
			input.style.pointerEvents = '';
			requestAnimationFrame(() => input.focus());
		};

		const collapse = () => {
			chat.classList.remove('is-expanded');
			chat.dataset.expanded = 'false';
			if (hint) hint.hidden = false;
			input.style.pointerEvents = 'none';
			input.blur();
		};

		const syncVisual = () => {
			if (input.value.length > 0 && !chat.classList.contains('is-expanded')) expand();
			else if (!input.value.length && chat.classList.contains('is-expanded')) {
				chat.classList.remove('is-expanded');
				chat.dataset.expanded = 'false';
				if (hint) hint.hidden = false;
			}
		};

		chat.style.transition = `width 0.28s ${EASE}, border-color 0.15s ease`;

		input.addEventListener('input', syncVisual);

		chat.addEventListener('click', (e) => {
			if (voice?.contains(e.target)) return;
			expand();
		});

		let demoRec = null;

		voice?.addEventListener('click', (e) => {
			e.stopPropagation();
			expand();
			const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
			if (!Ctor) return;
			if (voice.dataset.listening === 'true') {
				if (demoRec) {
					try { demoRec.stop(); } catch { /* ignore */ }
				}
				return;
			}
			const demoBase = input.value.trim() ? input.value.trim() + ' ' : '';
			const rec = new Ctor();
			rec.continuous = false;
			rec.interimResults = true;
			rec.lang = document.documentElement.lang || navigator.language || 'en-US';
			rec.onstart = () => {
				voice.classList.add('is-active');
				voice.dataset.listening = 'true';
				voice.setAttribute('aria-pressed', 'true');
			};
			rec.onresult = (event) => {
				let transcript = '';
				for (let i = 0; i < event.results.length; i++) {
					transcript += event.results[i][0]?.transcript || '';
				}
				input.value = (demoBase + transcript).trim();
				syncVisual();
			};
			rec.onend = () => {
				voice.classList.remove('is-active');
				voice.dataset.listening = 'false';
				voice.setAttribute('aria-pressed', 'false');
				demoRec = null;
			};
			rec.onerror = () => {
				voice.classList.remove('is-active');
				voice.dataset.listening = 'false';
				voice.setAttribute('aria-pressed', 'false');
				demoRec = null;
			};
			demoRec = rec;
			try { rec.start(); } catch { /* ignore */ }
		});

		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Escape') {
				e.preventDefault();
				if (input.value.trim()) {
					input.value = '';
					syncVisual();
				} else {
					collapse();
				}
			}
		});

		input.addEventListener('blur', () => {
			window.setTimeout(() => {
				if (chat.contains(document.activeElement)) return;
				if (!input.value.trim()) collapse();
			}, 120);
		});
	});
}
