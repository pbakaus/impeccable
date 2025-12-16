import { readySkills, skillFocusAreas } from "../data.js";
import { renderSkillDemo, setupDemoTabs } from "../demo-renderer.js";
import { setupDemoToggles } from "../demo-toggles.js";

export function initArtGallery() {
	// Initial setup if needed
}

export function renderGallery(skills) {
	const container = document.querySelector(".skills-gallery");
	if (!container) return;

	// Filter skills (hide frontend-design as per original)
	const filteredSkills = skills.filter((s) => s.id !== "frontend-design");

	container.innerHTML = `
        <div class="gallery-track">
            ${filteredSkills.map((skill, index) => renderFrame(skill, index)).join("")}
        </div>
        <div class="gallery-map">
            ${filteredSkills.map((_, index) => `<div class="gallery-dot ${index === 0 ? "active" : ""}" data-index="${index}"></div>`).join("")}
        </div>
    `;

	setupInteractions();
	setupDemoTabs();
	setupDemoToggles();
}

function renderFrame(skill, index) {
	const isReady = readySkills.includes(skill.id);
	const focusAreas = skillFocusAreas[skill.id] || [];
	const displayName = formatName(skill.id);

	return `
        <article class="gallery-frame ${index === 0 ? "active" : ""}" data-index="${index}" id="skill-${skill.id}">
            <div class="gallery-content">
                <div class="gallery-visual">
                    ${isReady ? renderSkillDemo(skill.id) : renderComingSoonVisual(skill.id)}
                </div>
                <div class="gallery-info">
                    <div class="gallery-header">
                        <h3 class="gallery-title">${displayName}</h3>
                        <div class="gallery-meta">
                            Skill · ${isReady ? "Available" : "Coming Soon"}
                        </div>
                    </div>
                    <p class="gallery-desc">${skill.description}</p>
                    
                    ${
											focusAreas.length > 0
												? `
                        <div class="gallery-tags">
                            ${focusAreas
															.slice(0, 4)
															.map(
																(area) => `
                                <span class="gallery-tag">${area.area}</span>
                            `,
															)
															.join("")}
                        </div>
                    `
												: ""
										}
                </div>
            </div>
        </article>
    `;
}

function renderComingSoonVisual(id) {
	return `
        <div class="coming-soon-placeholder" style="text-align: center;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.3">
                <path d="M12 6v6l4 2M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
            </svg>
            <p style="margin-top: 1rem; color: var(--color-ash); font-size: 0.875rem;">Coming Soon</p>
        </div>
    `;
}

function formatName(id) {
	return id
		.split("-")
		.map((word) =>
			word === "ux" ? "UX" : word.charAt(0).toUpperCase() + word.slice(1),
		)
		.join(" ");
}

function setupInteractions() {
	const track = document.querySelector(".gallery-track");
	const frames = document.querySelectorAll(".gallery-frame");
	const dots = document.querySelectorAll(".gallery-dot");

	if (!track) return;

	// Intersection Observer for Active State
	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					const index = entry.target.dataset.index;

					// Update frames
					frames.forEach((f) => f.classList.remove("active"));
					entry.target.classList.add("active");

					// Update dots
					dots.forEach((d) => d.classList.remove("active"));
					if (dots[index]) dots[index].classList.add("active");
				}
			});
		},
		{
			root: track,
			threshold: 0.6,
		},
	);

	frames.forEach((frame) => observer.observe(frame));

	// Dot navigation
	dots.forEach((dot, index) => {
		dot.addEventListener("click", () => {
			const frame = frames[index];
			if (frame) {
				frame.scrollIntoView({ behavior: "smooth", inline: "center" });
			}
		});
	});
}


