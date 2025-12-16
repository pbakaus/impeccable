import { inView } from "motion";

export function initScrollReveal() {
	const revealElements = document.querySelectorAll("[data-reveal]");

	revealElements.forEach((el) => {
		inView(
			el,
			() => {
				el.classList.add("revealed");
			},
			{ margin: "-50px" },
		);
	});
}


