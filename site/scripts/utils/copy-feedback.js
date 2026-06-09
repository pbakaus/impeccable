const copyResetTimers = new WeakMap();

function copyWithTextareaFallback(text) {
	const ta = Object.assign(document.createElement('textarea'), {
		value: text,
		style: 'position:fixed;left:-9999px',
	});

	document.body.appendChild(ta);
	ta.focus();
	ta.select();

	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		ta.remove();
	}
}

function showCopiedState(button, { copiedClass = 'copied', resetMs = 1200 } = {}) {
	window.clearTimeout(copyResetTimers.get(button));
	button.classList.remove(copiedClass);
	void button.offsetWidth;
	button.classList.add(copiedClass);
	copyResetTimers.set(
		button,
		window.setTimeout(() => button.classList.remove(copiedClass), resetMs),
	);
}

async function copyText(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {}
	}

	return copyWithTextareaFallback(text);
}

export function initCopyFeedback({
	selector = '[data-copy]',
	copiedClass = 'copied',
	resetMs = 1200,
} = {}) {
	document.addEventListener('click', async (event) => {
		if (!(event.target instanceof Element)) return;

		const button = event.target.closest(selector);
		if (!(button instanceof HTMLElement)) return;

		const text = button.getAttribute('data-copy');
		if (!text) return;

		if (await copyText(text)) {
			showCopiedState(button, { copiedClass, resetMs });
		}
	});
}
