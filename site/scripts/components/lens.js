import { initSplitCompare } from "../effects/split-compare.js";

export function initLensEffect() {
	const container = document.getElementById("lens-comparison");
	if (!container) return;

	initSplitCompare(container, {
		defaultPosition: 50
	});
}



