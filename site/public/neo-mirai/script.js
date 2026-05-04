const header = document.querySelector(".site-header");
const nav = document.querySelector("#site-nav");
const navToggle = document.querySelector(".nav-toggle");
const revealTargets = document.querySelectorAll("[data-reveal]");
const navLinks = document.querySelectorAll(".site-nav a");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const setHeaderState = () => {
  header.classList.toggle("is-scrolled", window.scrollY > 12);
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!isOpen));
    nav.classList.toggle("is-open", !isOpen);
  });

  nav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      navToggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    }
  });
}

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
);

revealTargets.forEach((target) => {
  const section = target.closest("section");
  const localTargets = section
    ? Array.from(section.querySelectorAll("[data-reveal]"))
    : Array.from(revealTargets);
  const localIndex = Math.max(localTargets.indexOf(target), 0);
  const delay = Math.min(localIndex, 4) * 110;

  target.style.setProperty("--reveal-delay", `${delay}ms`);
  revealObserver.observe(target);
});

window.setTimeout(() => {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
}, 1600);

const sections = Array.from(document.querySelectorAll("main section[id]"));
let activeNavFrame = 0;

const setActiveNavLink = (sectionId) => {
  navLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === `#${sectionId}`;
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
};

const getCurrentSectionId = () => {
  const anchorY = (header?.offsetHeight ?? 0) + Math.min(window.innerHeight * 0.32, 260);
  let currentSection = sections[0];

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    if (rect.top <= anchorY && rect.bottom > anchorY) {
      return section.id;
    }

    if (rect.top <= anchorY) {
      currentSection = section;
    }
  }

  return currentSection?.id;
};

const updateActiveNav = () => {
  activeNavFrame = 0;
  const currentSectionId = getCurrentSectionId();
  if (currentSectionId) {
    setActiveNavLink(currentSectionId);
  }
};

const requestActiveNavUpdate = () => {
  if (activeNavFrame) return;
  activeNavFrame = window.requestAnimationFrame(updateActiveNav);
};

updateActiveNav();
window.addEventListener("scroll", requestActiveNavUpdate, { passive: true });
window.addEventListener("resize", requestActiveNavUpdate);
window.addEventListener("hashchange", requestActiveNavUpdate);

const speakerCarousel = document.querySelector(".speaker-carousel");

if (speakerCarousel) {
  const speakerTrack = speakerCarousel.querySelector(".speaker-track");
  const speakerSlides = Array.from(speakerCarousel.querySelectorAll(".speaker-slide"));
  const speakerDots = Array.from(speakerCarousel.querySelectorAll(".speaker-dot"));
  let activeSpeakerIndex = 0;
  let speakerTimer = null;

  const setSpeakerSlide = (index) => {
    activeSpeakerIndex = (index + speakerSlides.length) % speakerSlides.length;
    speakerCarousel.style.setProperty("--speaker-index", activeSpeakerIndex);
    speakerCarousel.style.setProperty("--speaker-offset", `${activeSpeakerIndex * -100}%`);

    speakerSlides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeSpeakerIndex;
      slide.classList.toggle("is-active", isActive);
      slide.toggleAttribute("aria-hidden", !isActive);
    });

    speakerDots.forEach((dot, dotIndex) => {
      const isActive = dotIndex === activeSpeakerIndex;
      dot.classList.toggle("is-active", isActive);
      if (isActive) {
        dot.setAttribute("aria-current", "true");
      } else {
        dot.removeAttribute("aria-current");
      }
    });
  };

  const stopSpeakerTimer = () => {
    if (!speakerTimer) return;
    window.clearInterval(speakerTimer);
    speakerTimer = null;
  };

  const startSpeakerTimer = () => {
    if (reducedMotion.matches || speakerSlides.length < 2 || speakerTimer) return;
    speakerTimer = window.setInterval(() => {
      setSpeakerSlide(activeSpeakerIndex + 1);
    }, 5600);
  };

  speakerDots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const slideIndex = Number(dot.dataset.slide);
      if (Number.isNaN(slideIndex)) return;
      setSpeakerSlide(slideIndex);
      stopSpeakerTimer();
      startSpeakerTimer();
    });
  });

  speakerCarousel.addEventListener("pointerenter", stopSpeakerTimer);
  speakerCarousel.addEventListener("pointerleave", startSpeakerTimer);
  speakerCarousel.addEventListener("focusin", stopSpeakerTimer);
  speakerCarousel.addEventListener("focusout", startSpeakerTimer);
  speakerCarousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setSpeakerSlide(activeSpeakerIndex + 1);
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setSpeakerSlide(activeSpeakerIndex - 1);
    }
  });

  if (speakerTrack) {
    setSpeakerSlide(0);
    startSpeakerTimer();
  }
}
