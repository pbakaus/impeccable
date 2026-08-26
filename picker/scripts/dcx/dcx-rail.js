import { dcxAsset } from './assets.js';

(() => {
  "use strict";

  const DESKTOP_QUERY = "(min-width: 921px)";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const CATEGORY_TRANSITION_MS = 520;
  const BRANCH_TRANSITION_MS = 320;
  const BRANCH_RETRACT_MS = 140;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const bezierValue = (time, pointOne, pointTwo) => {
    const coefficientA = 1 - 3 * pointTwo + 3 * pointOne;
    const coefficientB = 3 * pointTwo - 6 * pointOne;
    const coefficientC = 3 * pointOne;
    return ((coefficientA * time + coefficientB) * time + coefficientC) * time;
  };

  const bezierSlope = (time, pointOne, pointTwo) => {
    const coefficientA = 1 - 3 * pointTwo + 3 * pointOne;
    const coefficientB = 3 * pointTwo - 6 * pointOne;
    const coefficientC = 3 * pointOne;
    return 3 * coefficientA * time * time + 2 * coefficientB * time + coefficientC;
  };

  const materialEase = (progress) => {
    const target = Math.max(0, Math.min(1, progress));
    let time = target;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const slope = bezierSlope(time, 0.4, 0.2);
      if (Math.abs(slope) < 0.000001) break;
      time -= (bezierValue(time, 0.4, 0.2) - target) / slope;
      time = Math.max(0, Math.min(1, time));
    }
    return bezierValue(time, 0, 1);
  };

  let railInstance = 0;
  let controller = null;
  let syncFrame = 0;

  const makeSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, value));
    return element;
  };

  class DcxMaterialRail {
    constructor(expander) {
      this.expander = expander;
      this.nav = expander.querySelector(".dcx-nav");
      this.main = expander.querySelector(".dcx-main");
      this.desktop = window.matchMedia(DESKTOP_QUERY);
      this.reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
      this.instanceId = ++railInstance;
      this.currentArticle = null;
      this.currentCategory = "";
      this.currentSubnav = null;
      this.contentSignature = "";
      this.entries = [];
      this.segments = new Map();
      this.railLength = 0;
      this.railReady = false;
      this.pinnedNode = null;
      this.scrollFrame = 0;
      this.rebuildFrame = 0;
      this.rebuildTimers = [];
      this.categoryTransitionBeginFrame = 0;
      this.categoryTransitionFrame = 0;
      this.categoryTransitionHandoffFrame = 0;
      this.categoryTransitionCleanupTimer = 0;
      this.categoryTransitionGeneration = 0;
      this.categoryTransitionActive = false;
      this.categoryTransitionStart = 0;
      this.categoryTransitionTarget = null;
      this.categoryTransitionFinalTarget = null;
      this.categoryTransitionNode = null;
      this.categoryTransitionBranchPoints = null;
      this.categoryTransitionBranchProgress = 0;
      this.categoryTransitionRetractPoints = null;
      this.categoryTransitionRetractProgress = 0;
      this.categoryTransitionRetractStart = 0;
      this.categoryTransitionRenderedPoints = null;
      this.categoryTransitionRenderedProgress = 0;
      this.currentPaintNode = null;

      if (!this.nav || !this.main) return;

      this.handleScroll = this.handleScroll.bind(this);
      this.handleResize = this.handleResize.bind(this);
      this.handleMediaChange = this.handleMediaChange.bind(this);
      this.handleReducedMotionChange = this.handleReducedMotionChange.bind(this);
      this.handleRailClick = this.handleRailClick.bind(this);
      this.handleContinuousCategoryWillChange = this.handleContinuousCategoryWillChange.bind(this);
      this.handleContinuousCategoryChange = this.handleContinuousCategoryChange.bind(this);
      this.clearPinnedNode = this.clearPinnedNode.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);

      this.createRail();
      this.nav.classList.add("dcx-material-rail-host");
      this.remeasureSubnavs();
      this.main.addEventListener("scroll", this.handleScroll, { passive: true });
      this.main.addEventListener("wheel", this.clearPinnedNode, { passive: true });
      this.main.addEventListener("touchstart", this.clearPinnedNode, { passive: true });
      this.main.addEventListener("pointerdown", this.clearPinnedNode, { passive: true });
      this.nav.addEventListener("click", this.handleRailClick);
      this.expander.addEventListener("dcx:continuouscategorywillchange", this.handleContinuousCategoryWillChange);
      this.expander.addEventListener("dcx:continuouscategorychange", this.handleContinuousCategoryChange);
      window.addEventListener("resize", this.handleResize, { passive: true });
      window.addEventListener("keydown", this.handleKeydown);
      this.desktop.addEventListener("change", this.handleMediaChange);
      this.reducedMotion.addEventListener("change", this.handleReducedMotionChange);

      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.nav);

      document.fonts?.ready.then(() => {
        if (controller !== this) return;
        this.remeasureSubnavs();
        this.scheduleRebuild(true);
      });
    }

    createRail() {
      const patinaId = `dcx-material-rail-patina-${this.instanceId}`;
      const goldId = `dcx-material-rail-gold-${this.instanceId}`;
      const svg = makeSvgElement("svg", {
        class: "dcx-material-rail",
        "aria-hidden": "true",
        focusable: "false",
      });
      const defs = makeSvgElement("defs");
      const patinaPattern = makeSvgElement("pattern", {
        id: patinaId,
        width: "72",
        height: "48",
        patternUnits: "userSpaceOnUse",
      });
      const goldPattern = makeSvgElement("pattern", {
        id: goldId,
        width: "72",
        height: "48",
        patternUnits: "userSpaceOnUse",
      });

      patinaPattern.append(
        makeSvgElement("rect", {
          class: "dcx-material-rail__patina-base",
          width: "72",
          height: "48",
        }),
        makeSvgElement("image", {
          class: "dcx-material-rail__patina-image",
          href: dcxAsset("/assets/audience/verdigris-patina.png"),
          width: "72",
          height: "48",
          preserveAspectRatio: "xMidYMid slice",
        }),
      );
      goldPattern.append(
        makeSvgElement("rect", {
          class: "dcx-material-rail__gold-base",
          width: "72",
          height: "48",
        }),
        makeSvgElement("image", {
          class: "dcx-material-rail__gold-image",
          href: dcxAsset("/assets/audience/kinpaku-gold-leaf.png"),
          width: "72",
          height: "48",
          preserveAspectRatio: "xMidYMid slice",
        }),
      );

      this.track = makeSvgElement("path", {
        class: "dcx-material-rail__track",
        "data-dcx-rail-track": "",
      });
      this.active = makeSvgElement("path", {
        class: "dcx-material-rail__active",
        "data-dcx-rail-active": "",
      });
      this.transitionTrack = makeSvgElement("path", {
        class: "dcx-material-rail__transition-track",
      });
      this.transitionActive = makeSvgElement("line", {
        class: "dcx-material-rail__transition-active",
      });
      this.track.style.stroke = `url("#${patinaId}")`;
      this.active.style.stroke = `url("#${goldId}")`;
      this.transitionTrack.style.stroke = `url("#${patinaId}")`;
      this.transitionActive.style.stroke = `url("#${goldId}")`;

      defs.append(patinaPattern, goldPattern);
      svg.append(
        defs,
        this.transitionTrack,
        this.track,
        this.active,
        this.transitionActive,
      );
      this.svg = svg;
      this.nav.prepend(svg);
    }

    prepareAudienceSubnav(subnav, blocks) {
      const descriptors = [
        { label: "Overview", targetLabels: [], overview: true },
        { label: "People", targetLabels: ["Who they are", "Emotional journey", "Emotional state"] },
        { label: "Decision factors", targetLabels: ["Needs", "Trust triggers"] },
        { label: "Inclusion", targetLabels: ["Who must not be excluded"] },
      ];
      const available = new Map(blocks.map((block, index) => [block.dataset.label, { block, index }]));
      const resolved = descriptors.map((descriptor) => {
        if (descriptor.overview) return descriptor;
        const firstTarget = descriptor.targetLabels.find((label) => available.has(label));
        return firstTarget ? { ...descriptor, firstTarget } : null;
      }).filter(Boolean);
      const expected = resolved.map((descriptor) => descriptor.label).join("|");
      const existing = [...subnav.querySelectorAll(":scope > .dcx-sub-link[data-dcx-rail-summary]")]
        .map((button) => button.textContent.trim())
        .join("|");

      subnav.classList.add("dcx-subnav--summary");
      subnav.dataset.dcxRailSummary = "true";
      if (existing === expected && subnav.childElementCount === resolved.length) return;

      const buttons = resolved.map((descriptor) => {
        const button = document.createElement("button");
        button.className = "dcx-sub-link";
        button.type = "button";
        button.textContent = descriptor.label;
        button.dataset.dcxRailSummary = "";
        button.dataset.dcxRailTarget = descriptor.overview ? "__overview__" : descriptor.firstTarget;
        if (!descriptor.overview) {
          button.dataset.dcxSubsection = String(available.get(descriptor.firstTarget).index);
        }
        return button;
      });
      subnav.replaceChildren(...buttons);
    }

    refresh() {
      const activeItem = this.nav.querySelector(".dcx-nav-list > li.is-active[data-category]");
      const category = activeItem?.dataset.category || "";
      const continuous = this.main.dataset.dcxContinuous === "true";
      const article = continuous
        ? this.main.querySelector(`:scope > .dcx-article[data-dcx-category="${category}"]`)
        : this.main.querySelector(":scope > .dcx-article");
      if (!activeItem || !article) {
        this.nav.removeAttribute("data-rail-ready");
        return;
      }

      const subnav = activeItem.querySelector(":scope > .dcx-subnav");
      const blocks = [...article.querySelectorAll(":scope > .dcx-block[data-label]")];
      if (!subnav) return;

      if (!continuous) {
        this.nav.querySelectorAll(".dcx-subnav").forEach((candidate) => {
          if (candidate === subnav && category === "audience") return;
          candidate.classList.remove("dcx-subnav--summary");
          delete candidate.dataset.dcxRailSummary;
        });
      }
      if (category === "audience" && !continuous) this.prepareAudienceSubnav(subnav, blocks);

      const buttonLabels = [...subnav.querySelectorAll(":scope > .dcx-sub-link")]
        .map((button) => button.textContent.trim())
        .join("|");
      const blockLabels = blocks.map((block) => block.dataset.label).join("|");
      const signature = `${category}::${buttonLabels}::${blockLabels}`;
      const liveRailNodes = [
        ...this.nav.querySelectorAll(".dcx-nav-list > li > .dcx-nav-link"),
        ...subnav.querySelectorAll(":scope > .dcx-sub-link"),
      ];
      const railMarkupReady = liveRailNodes.length > 0
        && liveRailNodes.every((node) => node.hasAttribute("data-dcx-rail-node"));
      const sameContent = this.currentArticle === article
        && this.currentCategory === category
        && this.currentSubnav === subnav
        && this.contentSignature === signature
        && railMarkupReady;
      if (sameContent) return;

      this.currentArticle = article;
      this.currentCategory = category;
      this.currentSubnav = subnav;
      this.contentSignature = signature;
      this.pinnedNode = null;
      this.rebuildTimers.forEach((timer) => window.clearTimeout(timer));
      this.rebuildTimers = [];

      this.nav.querySelectorAll("[data-dcx-rail-node]").forEach((node) => {
        node.removeAttribute("data-dcx-rail-node");
      });
      this.nav.querySelectorAll('.dcx-sub-link[aria-current="location"]').forEach((button) => {
        button.removeAttribute("aria-current");
      });

      const topLinks = [...this.nav.querySelectorAll(".dcx-nav-list > li > .dcx-nav-link")];
      const subLinks = [...subnav.querySelectorAll(":scope > .dcx-sub-link")];
      topLinks.forEach((link) => link.setAttribute("data-dcx-rail-node", ""));
      subLinks.forEach((link) => link.setAttribute("data-dcx-rail-node", ""));

      const activeTopLink = activeItem.querySelector(":scope > .dcx-nav-link");
      const blockForIndex = (button) => blocks[Number(button.dataset.dcxSubsection)];
      const entries = [];

      if ((continuous || category !== "audience") && activeTopLink) {
        entries.push({ node: activeTopLink, target: article.querySelector(":scope > header") || article });
      }
      subLinks.forEach((button) => {
        const summaryTarget = button.dataset.dcxRailTarget;
        const documentTarget = button.dataset.dcxDocumentTarget;
        const target = documentTarget
          ? this.main.querySelector(`#${CSS.escape(documentTarget)}`)
          : summaryTarget === "__overview__"
            ? article.querySelector(":scope > header") || article
            : summaryTarget
              ? blocks.find((block) => block.dataset.label === summaryTarget)
              : blockForIndex(button);
        if (target) entries.push({ node: button, target });
      });
      this.entries = entries;
      this.railReady = false;
      this.rebuild(true);

      if (!this.categoryTransitionActive) {
        [0, 320, 650].forEach((delay) => {
          this.rebuildTimers.push(window.setTimeout(() => {
            if (controller === this && this.currentArticle === article) this.rebuild(true);
          }, delay));
        });
      }
    }

    measureRailPoints() {
      if (!this.desktop.matches || !this.nav.offsetHeight || !this.track || !this.active) return [];
      const navRect = this.nav.getBoundingClientRect();
      const nodes = [...this.nav.querySelectorAll("[data-dcx-rail-node]")]
        .filter((node) => node.getClientRects().length > 0);
      if (!nodes.length) return [];

      return nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          node,
          x: rect.left - navRect.left + 1,
          yTop: rect.top - navRect.top,
          yBottom: rect.bottom - navRect.top,
        };
      });
    }

    pathDataForProgress(points, progress = 1) {
      if (!points.length) return "";
      const spineX = points[0].x;
      const morphX = (value) => spineX + (value - spineX) * progress;
      let pathData = "";
      let previous = null;

      points.forEach((point, index) => {
        const pointX = morphX(point.x);
        if (index === 0) {
          pathData = `M ${pointX} ${point.yTop} `;
        } else if (Math.abs(point.x - previous.x) < 0.5) {
          pathData += `L ${pointX} ${point.yTop} `;
        } else {
          const previousX = morphX(previous.x);
          const midpoint = (previous.yBottom + point.yTop) / 2;
          pathData += `C ${previousX} ${midpoint}, ${pointX} ${midpoint}, ${pointX} ${point.yTop} `;
        }
        pathData += `L ${pointX} ${point.yBottom} `;
        previous = point;
      });
      return pathData;
    }

    buildPath() {
      const points = this.measureRailPoints();
      if (!points.length) return false;
      let pathData = "";
      let previous = null;
      const nextSegments = new Map();

      points.forEach((point, index) => {
        if (index === 0) {
          pathData = `M ${point.x} ${point.yTop} `;
        } else if (Math.abs(point.x - previous.x) < 0.5) {
          pathData += `L ${point.x} ${point.yTop} `;
        } else {
          const midpoint = (previous.yBottom + point.yTop) / 2;
          pathData += `C ${previous.x} ${midpoint}, ${point.x} ${midpoint}, ${point.x} ${point.yTop} `;
        }

        this.active.setAttribute("d", pathData);
        const start = this.active.getTotalLength();
        pathData += `L ${point.x} ${point.yBottom} `;
        this.active.setAttribute("d", pathData);
        const end = this.active.getTotalLength();
        nextSegments.set(point.node, { start, length: Math.max(1, end - start) });
        previous = point;
      });

      this.track.setAttribute("d", pathData);
      this.active.setAttribute("d", pathData);
      this.segments = nextSegments;
      this.railLength = this.active.getTotalLength();
      return Number.isFinite(this.railLength) && this.railLength > 0;
    }

    moveRail(node, instant = false) {
      const segment = this.segments.get(node);
      if (!segment || !this.railLength) return;
      this.currentPaintNode = node;

      if (instant || this.reducedMotion.matches) {
        this.active.setAttribute("data-initial", "true");
        this.active.getBoundingClientRect();
      }
      this.active.style.strokeDasharray = `${segment.length} ${this.railLength + 1}`;
      this.active.style.strokeDashoffset = `${-segment.start}`;

      requestAnimationFrame(() => {
        if (controller !== this) return;
        this.active.setAttribute("data-ready", "true");
        this.nav.setAttribute("data-rail-ready", "true");
        requestAnimationFrame(() => this.active.removeAttribute("data-initial"));
      });
      this.railReady = true;
    }

    updateCurrent(instant = false) {
      if (!this.entries.length || !this.desktop.matches) return;
      const mainRect = this.main.getBoundingClientRect();
      const marker = mainRect.top + this.main.clientHeight * 0.25;
      let current = this.entries.find((entry) => entry.node === this.pinnedNode)
        || this.entries.find((entry) => entry.node === this.categoryTransitionNode)
        || this.entries[0];

      if (!this.pinnedNode && !this.categoryTransitionNode) {
        if (this.main.scrollTop > 4) {
          this.entries.forEach((entry) => {
            if (entry.target.getBoundingClientRect().top <= marker) current = entry;
          });
          if (this.main.scrollTop + this.main.clientHeight >= this.main.scrollHeight - 4) {
            current = this.entries.at(-1);
          }
        }
      }

      this.nav.querySelectorAll('.dcx-sub-link[aria-current="location"]').forEach((button) => {
        if (button !== current.node) button.removeAttribute("aria-current");
      });
      if (current.node.matches(".dcx-sub-link")) {
        current.node.setAttribute("aria-current", "location");
      }
      this.moveRail(current.node, instant || !this.railReady);
    }

    rebuild(instant = false) {
      if (!this.desktop.matches) {
        this.nav.removeAttribute("data-rail-ready");
        this.active.removeAttribute("data-ready");
        return;
      }
      if (!this.buildPath()) return;
      this.updateCurrent(instant);
    }

    scheduleRebuild(instant = false) {
      if (this.rebuildFrame) cancelAnimationFrame(this.rebuildFrame);
      this.rebuildFrame = requestAnimationFrame(() => {
        this.rebuildFrame = 0;
        this.rebuild(instant);
      });
    }

    handleScroll() {
      if (this.scrollFrame || !this.desktop.matches) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        if (this.main.dataset.dcxContinuous === "true") this.refresh();
        this.updateCurrent();
      });
    }

    nodeLine(node) {
      if (!node?.getClientRects().length) return null;
      const navRect = this.nav.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - navRect.left + 1,
        yTop: rect.top - navRect.top,
        yBottom: rect.bottom - navRect.top,
      };
    }

    scrollTargetNode(category, topLink) {
      const article = this.main.querySelector(`:scope > .dcx-article[data-dcx-category="${CSS.escape(category)}"]`);
      const subnav = this.nav.querySelector(
        `.dcx-nav-list > li[data-category="${CSS.escape(category)}"] > .dcx-subnav`,
      );
      if (!article || !subnav) return topLink;

      const mainRect = this.main.getBoundingClientRect();
      const marker = mainRect.top + this.main.clientHeight * 0.25;
      let visibleBlock = null;
      article.querySelectorAll(":scope > .dcx-block[data-label]").forEach((block) => {
        if (block.getBoundingClientRect().top <= marker) visibleBlock = block;
      });
      if (!visibleBlock) return topLink;

      const exact = [...subnav.querySelectorAll(":scope > .dcx-sub-link[data-dcx-document-target]")]
        .find((link) => link.dataset.dcxDocumentTarget === visibleBlock.id);
      if (exact) return exact;
      if (category !== "audience") return topLink;

      const label = visibleBlock.dataset.label;
      const group = label === "Who they are" || label === "Emotional journey" || label === "Emotional state"
        ? "People"
        : label === "Needs" || label === "Trust triggers"
          ? "Decision factors"
          : label === "Who must not be excluded"
            ? "Inclusion"
            : null;
      if (!group) return topLink;
      return [...subnav.querySelectorAll(":scope > .dcx-sub-link")]
        .find((link) => link.textContent.trim() === group) || topLink;
    }

    remeasureSubnavs() {
      if (!this.desktop.matches) return;
      this.nav.querySelectorAll(".dcx-nav-list > li[data-category] > .dcx-subnav").forEach((subnav) => {
        const links = [...subnav.querySelectorAll(":scope > .dcx-sub-link")];
        const heights = links.map((link) => link.getBoundingClientRect().height);
        if (!heights.some((height) => height > 0)) return;
        const summary = subnav.classList.contains("dcx-subnav--summary");
        const gap = summary ? 0 : 2;
        const padding = summary ? 14 : 10;
        const height = heights.reduce((total, value) => total + value, 0)
          + Math.max(0, links.length - 1) * gap
          + padding;
        subnav.style.setProperty("--dcx-subnav-height", `${Math.ceil(height)}px`);
      });
    }

    finalNodeLine(toCategory, target) {
      const links = [...this.nav.querySelectorAll(".dcx-nav-list > li[data-category] > .dcx-nav-link")];
      const toIndex = links.findIndex((link) => link.dataset.dcxNav === toCategory);
      const targetTopLink = links[toIndex];
      if (!target || !targetTopLink || toIndex < 0 || !links.length) return null;

      const navRect = this.nav.getBoundingClientRect();
      const firstRect = links[0].getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      let yTop = firstRect.top - navRect.top;
      for (let index = 0; index < toIndex; index += 1) {
        yTop += links[index].getBoundingClientRect().height;
      }

      if (target === targetTopLink) {
        return {
          x: targetRect.left - navRect.left + 1,
          yTop,
          yBottom: yTop + targetRect.height,
        };
      }

      const subnav = targetTopLink.closest("li[data-category]")
        ?.querySelector(":scope > .dcx-subnav");
      const subLinks = [...subnav?.querySelectorAll(":scope > .dcx-sub-link") || []];
      const targetIndex = subLinks.indexOf(target);
      if (!subnav || targetIndex < 0) return null;

      const summary = subnav.classList.contains("dcx-subnav--summary");
      const gap = summary ? 0 : 2;
      const paddingTop = summary ? 4 : 2;
      yTop += targetTopLink.getBoundingClientRect().height + paddingTop;
      for (let index = 0; index < targetIndex; index += 1) {
        yTop += subLinks[index].getBoundingClientRect().height + gap;
      }
      return {
        x: targetRect.left - navRect.left + 1,
        yTop,
        yBottom: yTop + targetRect.height,
      };
    }

    transitionLineGeometry() {
      if (!this.transitionActive.hasAttribute("data-visible")) return null;
      const navRect = this.nav.getBoundingClientRect();
      const rect = this.transitionActive.getBoundingClientRect();
      if (!rect.height) return null;
      return {
        x: rect.left - navRect.left + rect.width / 2,
        yTop: rect.top - navRect.top,
        yBottom: rect.bottom - navRect.top,
      };
    }

    measureStraightTrack() {
      if (!this.desktop.matches) return false;
      const links = [...this.nav.querySelectorAll(".dcx-nav-list > li[data-category] > .dcx-nav-link")]
        .filter((link) => link.getClientRects().length > 0);
      if (!links.length) return false;
      const navRect = this.nav.getBoundingClientRect();
      const firstRect = links[0].getBoundingClientRect();
      const lastRect = links.at(-1).getBoundingClientRect();
      const x = firstRect.left - navRect.left + 1;
      const yTop = firstRect.top - navRect.top;
      const yBottom = lastRect.bottom - navRect.top;
      return { x, yTop, yBottom };
    }

    buildStraightTrack() {
      const spine = this.measureStraightTrack();
      if (!spine) return false;
      this.transitionTrack.setAttribute(
        "d",
        `M ${spine.x} ${spine.yTop} L ${spine.x} ${spine.yBottom}`,
      );
      return true;
    }

    fitPointsToStraightTrack(points, spine) {
      if (!points?.length || !spine) return [];
      const sourceTop = points[0].yTop;
      const sourceBottom = points.at(-1).yBottom;
      const sourceHeight = Math.max(1, sourceBottom - sourceTop);
      const heightScale = (spine.yBottom - spine.yTop) / sourceHeight;
      const sourceX = points[0].x;
      return points.map((point) => ({
        ...point,
        x: spine.x + point.x - sourceX,
        yTop: spine.yTop + (point.yTop - sourceTop) * heightScale,
        yBottom: spine.yTop + (point.yBottom - sourceTop) * heightScale,
      }));
    }

    moveTransitionActive(target) {
      if (!target) return;
      const sourceHeight = Math.max(1, Number(this.transitionActive.getAttribute("y2"))
        - Number(this.transitionActive.getAttribute("y1")));
      const sourceX = Number(this.transitionActive.getAttribute("x1"));
      const sourceTop = Number(this.transitionActive.getAttribute("y1"));
      const targetHeight = Math.max(1, target.yBottom - target.yTop);
      const deltaX = target.x - sourceX;
      const deltaY = target.yTop - sourceTop + (targetHeight - sourceHeight) / 2;
      const scaleY = targetHeight / sourceHeight;
      this.transitionActive.style.transform = `translate(${deltaX}px, ${deltaY}px) scaleY(${scaleY})`;
    }

    clearCategoryTransitionVisuals() {
      window.clearTimeout(this.categoryTransitionCleanupTimer);
      this.categoryTransitionCleanupTimer = 0;
      this.transitionTrack.removeAttribute("data-visible");
      this.transitionTrack.removeAttribute("data-initial");
      this.transitionTrack.removeAttribute("data-settling");
      this.transitionActive.removeAttribute("data-visible");
      this.transitionActive.removeAttribute("data-initial");
      this.transitionActive.removeAttribute("data-settling");
      this.transitionActive.removeAttribute("data-handoff");
      this.track.removeAttribute("data-entering");
      this.track.removeAttribute("data-settling");
      this.track.removeAttribute("data-morphing");
      this.active.removeAttribute("data-entering");
      this.active.removeAttribute("data-handoff");
      this.transitionActive.style.removeProperty("transform");
      this.nav.removeAttribute("data-category-transition");
    }

    cancelCategoryTransitionFrames() {
      if (this.categoryTransitionBeginFrame) cancelAnimationFrame(this.categoryTransitionBeginFrame);
      if (this.categoryTransitionFrame) cancelAnimationFrame(this.categoryTransitionFrame);
      if (this.categoryTransitionHandoffFrame) cancelAnimationFrame(this.categoryTransitionHandoffFrame);
      this.categoryTransitionBeginFrame = 0;
      this.categoryTransitionFrame = 0;
      this.categoryTransitionHandoffFrame = 0;
    }

    cancelCategoryTransition() {
      this.categoryTransitionGeneration += 1;
      this.cancelCategoryTransitionFrames();
      this.categoryTransitionActive = false;
      this.categoryTransitionTarget = null;
      this.categoryTransitionFinalTarget = null;
      this.categoryTransitionNode = null;
      this.categoryTransitionBranchPoints = null;
      this.categoryTransitionBranchProgress = 0;
      this.categoryTransitionRetractPoints = null;
      this.categoryTransitionRetractProgress = 0;
      this.categoryTransitionRetractStart = 0;
      this.categoryTransitionRenderedPoints = null;
      this.categoryTransitionRenderedProgress = 0;
      this.clearCategoryTransitionVisuals();
      this.transitionTrack.removeAttribute("d");
      this.transitionActive.removeAttribute("x1");
      this.transitionActive.removeAttribute("x2");
      this.transitionActive.removeAttribute("y1");
      this.transitionActive.removeAttribute("y2");
    }

    snapshotCategoryTransition(event) {
      if (!this.desktop.matches || this.reducedMotion.matches || !this.railReady) return false;
      const sourceLine = this.transitionLineGeometry() || this.nodeLine(this.currentPaintNode);
      const topLink = this.nav.querySelector(
        `.dcx-nav-list > li[data-category="${CSS.escape(event.detail?.to || "")}"] > .dcx-nav-link`,
      );
      const targetNode = event.detail?.source === "scroll"
        ? this.scrollTargetNode(event.detail?.to, topLink)
        : topLink;
      const spineTarget = this.finalNodeLine(event.detail?.to, topLink);
      const finalTarget = this.finalNodeLine(event.detail?.to, targetNode);
      if (!sourceLine || !spineTarget || !finalTarget) return false;
      const branchPoints = this.categoryTransitionBranchPoints?.length
        && this.categoryTransitionBranchProgress > 0
        ? this.categoryTransitionBranchPoints
        : null;
      const renderedPoints = this.categoryTransitionRenderedPoints?.length
        && this.categoryTransitionRenderedProgress > 0
        ? this.categoryTransitionRenderedPoints
        : null;
      const retractSource = branchPoints || renderedPoints;
      const retractPoints = retractSource?.map((point) => ({ ...point })) || null;
      const retractProgress = branchPoints
        ? this.categoryTransitionBranchProgress
        : renderedPoints
          ? this.categoryTransitionRenderedProgress
          : 0;

      this.categoryTransitionGeneration += 1;
      this.cancelCategoryTransitionFrames();
      this.clearCategoryTransitionVisuals();

      if (retractPoints) {
        this.transitionTrack.setAttribute("d", this.pathDataForProgress(retractPoints, retractProgress));
      } else {
        this.buildStraightTrack();
      }
      this.transitionActive.setAttribute("x1", sourceLine.x);
      this.transitionActive.setAttribute("x2", sourceLine.x);
      this.transitionActive.setAttribute("y1", sourceLine.yTop);
      this.transitionActive.setAttribute("y2", sourceLine.yBottom);
      this.transitionActive.style.transform = "translate(0px, 0px) scaleY(1)";
      this.transitionTrack.setAttribute("data-visible", "true");
      this.transitionActive.setAttribute("data-visible", "true");
      this.transitionTrack.setAttribute("data-initial", "true");
      this.transitionActive.setAttribute("data-initial", "true");
      this.track.setAttribute("data-entering", "true");
      this.active.setAttribute("data-entering", "true");
      this.nav.setAttribute("data-category-transition", "layout");
      this.svg.getBoundingClientRect();

      this.categoryTransitionTarget = spineTarget;
      this.categoryTransitionFinalTarget = finalTarget;
      this.categoryTransitionNode = targetNode;
      this.categoryTransitionBranchPoints = null;
      this.categoryTransitionBranchProgress = 0;
      this.categoryTransitionRetractPoints = retractPoints;
      this.categoryTransitionRetractProgress = retractProgress;
      this.categoryTransitionRetractStart = 0;
      this.categoryTransitionRenderedPoints = retractPoints?.map((point) => ({ ...point })) || null;
      this.categoryTransitionRenderedProgress = retractProgress;
      this.categoryTransitionActive = true;
      return true;
    }

    beginCategoryTransition(generation) {
      if (generation !== this.categoryTransitionGeneration
        || !this.categoryTransitionActive
        || !this.categoryTransitionTarget
        || !this.categoryTransitionFinalTarget) return;

      this.transitionTrack.removeAttribute("data-initial");
      this.transitionActive.removeAttribute("data-initial");
      this.moveTransitionActive(this.categoryTransitionTarget);
      const startTime = performance.now();
      this.categoryTransitionStart = startTime;
      if (this.categoryTransitionRetractPoints) this.categoryTransitionRetractStart = startTime;
      this.categoryTransitionFrame = requestAnimationFrame((time) => {
        this.animateCategoryTransition(time, generation);
      });
    }

    animateCategoryTransition(time, generation) {
      this.categoryTransitionFrame = 0;
      if (generation !== this.categoryTransitionGeneration
        || !this.categoryTransitionActive
        || controller !== this) return;
      if (this.categoryTransitionRetractPoints) {
        const spine = this.measureStraightTrack();
        const fittedPoints = this.fitPointsToStraightTrack(this.categoryTransitionRetractPoints, spine);
        const retractTime = Math.min(
          1,
          (time - this.categoryTransitionRetractStart) / BRANCH_RETRACT_MS,
        );
        const progress = this.categoryTransitionRetractProgress * (1 - materialEase(retractTime));
        if (fittedPoints.length) {
          this.transitionTrack.setAttribute("d", this.pathDataForProgress(fittedPoints, progress));
          this.categoryTransitionRenderedPoints = fittedPoints.map((point) => ({ ...point }));
          this.categoryTransitionRenderedProgress = progress;
        }
        if (retractTime >= 1 || !fittedPoints.length) {
          this.categoryTransitionRetractPoints = null;
          this.categoryTransitionRetractProgress = 0;
          this.categoryTransitionRetractStart = 0;
          this.categoryTransitionRenderedPoints = null;
          this.categoryTransitionRenderedProgress = 0;
          this.buildStraightTrack();
        }
      } else {
        this.buildStraightTrack();
      }
      if (time - this.categoryTransitionStart < CATEGORY_TRANSITION_MS) {
        this.categoryTransitionFrame = requestAnimationFrame((nextTime) => {
          this.animateCategoryTransition(nextTime, generation);
        });
        return;
      }
      this.beginBranchTransition(generation);
    }

    beginBranchTransition(generation) {
      if (generation !== this.categoryTransitionGeneration
        || !this.categoryTransitionActive
        || !this.categoryTransitionFinalTarget) return;
      if (this.categoryTransitionFrame) cancelAnimationFrame(this.categoryTransitionFrame);
      this.categoryTransitionFrame = 0;
      this.buildStraightTrack();
      const points = this.measureRailPoints();
      if (!points.length || !this.buildPath()) {
        this.cancelCategoryTransition();
        this.remeasureSubnavs();
        this.scheduleRebuild(true);
        return;
      }
      this.updateCurrent(false);
      this.categoryTransitionBranchPoints = points;
      this.categoryTransitionBranchProgress = 0;
      this.categoryTransitionRetractPoints = null;
      this.categoryTransitionRetractProgress = 0;
      this.categoryTransitionRetractStart = 0;
      this.categoryTransitionRenderedPoints = points.map((point) => ({ ...point }));
      this.categoryTransitionRenderedProgress = 0;
      this.track.setAttribute("d", this.pathDataForProgress(points, 0));
      this.track.setAttribute("data-morphing", "true");
      this.transitionTrack.setAttribute("data-initial", "true");
      this.transitionActive.setAttribute("data-settling", "true");
      this.nav.setAttribute("data-category-transition", "branch");
      this.track.removeAttribute("data-entering");
      this.transitionTrack.removeAttribute("data-visible");
      this.svg.getBoundingClientRect();
      this.moveTransitionActive(this.categoryTransitionFinalTarget);
      this.categoryTransitionStart = performance.now();
      this.categoryTransitionFrame = requestAnimationFrame((time) => {
        this.animateBranchTransition(time, generation);
      });
    }

    animateBranchTransition(time, generation) {
      this.categoryTransitionFrame = 0;
      if (generation !== this.categoryTransitionGeneration
        || !this.categoryTransitionActive
        || !this.categoryTransitionBranchPoints
        || controller !== this) return;
      const progress = Math.min(1, (time - this.categoryTransitionStart) / BRANCH_TRANSITION_MS);
      const easedProgress = materialEase(progress);
      this.categoryTransitionBranchProgress = easedProgress;
      this.categoryTransitionRenderedPoints = this.categoryTransitionBranchPoints
        .map((point) => ({ ...point }));
      this.categoryTransitionRenderedProgress = easedProgress;
      this.track.setAttribute(
        "d",
        this.pathDataForProgress(this.categoryTransitionBranchPoints, easedProgress),
      );
      if (progress < 1) {
        this.categoryTransitionFrame = requestAnimationFrame((nextTime) => {
          this.animateBranchTransition(nextTime, generation);
        });
        return;
      }
      this.completeBranchTransition(generation);
    }

    completeBranchTransition(generation) {
      if (generation !== this.categoryTransitionGeneration || !this.categoryTransitionActive) return;
      this.categoryTransitionActive = false;
      this.categoryTransitionTarget = null;
      this.categoryTransitionFinalTarget = null;
      this.categoryTransitionBranchPoints = null;
      this.categoryTransitionBranchProgress = 0;
      this.categoryTransitionRetractPoints = null;
      this.categoryTransitionRetractProgress = 0;
      this.categoryTransitionRetractStart = 0;
      this.categoryTransitionRenderedPoints = null;
      this.categoryTransitionRenderedProgress = 0;
      this.buildPath();
      this.track.removeAttribute("data-morphing");
      this.updateCurrent(false);
      this.active.setAttribute("data-handoff", "true");
      this.transitionActive.setAttribute("data-handoff", "true");
      this.svg.getBoundingClientRect();
      this.active.removeAttribute("data-entering");
      this.transitionActive.removeAttribute("data-visible");
      this.categoryTransitionHandoffFrame = requestAnimationFrame(() => {
        this.categoryTransitionHandoffFrame = 0;
        if (generation === this.categoryTransitionGeneration) {
          this.active.removeAttribute("data-handoff");
          this.transitionActive.removeAttribute("data-handoff");
        }
      });
      this.nav.removeAttribute("data-category-transition");
      this.categoryTransitionCleanupTimer = window.setTimeout(() => {
        if (generation !== this.categoryTransitionGeneration) return;
        this.categoryTransitionCleanupTimer = 0;
        this.transitionTrack.removeAttribute("d");
        this.transitionTrack.removeAttribute("data-initial");
        this.transitionTrack.removeAttribute("data-settling");
        this.transitionActive.removeAttribute("data-settling");
        this.track.removeAttribute("data-settling");
        this.transitionActive.style.removeProperty("transform");
        this.transitionActive.removeAttribute("x1");
        this.transitionActive.removeAttribute("x2");
        this.transitionActive.removeAttribute("y1");
        this.transitionActive.removeAttribute("y2");
        this.categoryTransitionNode = null;
        this.updateCurrent(false);
      }, 220);
    }

    handleContinuousCategoryWillChange(event) {
      this.snapshotCategoryTransition(event);
    }

    handleContinuousCategoryChange() {
      this.refresh();
      if (this.categoryTransitionActive) {
        const generation = this.categoryTransitionGeneration;
        if (this.categoryTransitionBeginFrame) cancelAnimationFrame(this.categoryTransitionBeginFrame);
        this.categoryTransitionBeginFrame = requestAnimationFrame(() => {
          this.categoryTransitionBeginFrame = 0;
          this.beginCategoryTransition(generation);
        });
      } else {
        this.scheduleRebuild(true);
      }
    }

    handleResize() {
      if (this.categoryTransitionActive) return;
      this.remeasureSubnavs();
      this.scheduleRebuild(true);
    }

    handleMediaChange() {
      this.cancelCategoryTransition();
      this.remeasureSubnavs();
      this.scheduleRebuild(true);
    }

    handleReducedMotionChange() {
      this.cancelCategoryTransition();
      this.remeasureSubnavs();
      this.scheduleRebuild(true);
    }

    handleRailClick(event) {
      const railButton = event.target.closest(".dcx-sub-link[data-dcx-rail-node]");
      if (railButton && this.nav.contains(railButton)) {
        this.pinnedNode = railButton;
        this.updateCurrent();
      }

      const button = event.target.closest(".dcx-sub-link[data-dcx-rail-summary]");
      if (!button || !this.nav.contains(button)) return;
      if (this.main.dataset.dcxContinuous === "true") return;
      const targetName = button.dataset.dcxRailTarget;
      const target = targetName === "__overview__"
        ? this.currentArticle?.querySelector(":scope > header") || this.currentArticle
        : [...this.main.querySelectorAll(".dcx-block[data-label]")]
          .find((block) => block.dataset.label === targetName);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      const mainRect = this.main.getBoundingClientRect();
      const top = targetName === "__overview__"
        ? 0
        : target.getBoundingClientRect().top - mainRect.top + this.main.scrollTop - 18;
      this.main.scrollTo({
        top: Math.max(0, top),
        behavior: this.reducedMotion.matches ? "auto" : "smooth",
      });
    }

    clearPinnedNode() {
      if (!this.pinnedNode) return;
      this.pinnedNode = null;
    }

    handleKeydown(event) {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        this.clearPinnedNode();
      }
    }

    destroy() {
      this.cancelCategoryTransition();
      this.main?.removeEventListener("scroll", this.handleScroll);
      this.main?.removeEventListener("wheel", this.clearPinnedNode);
      this.main?.removeEventListener("touchstart", this.clearPinnedNode);
      this.main?.removeEventListener("pointerdown", this.clearPinnedNode);
      this.nav?.removeEventListener("click", this.handleRailClick);
      this.expander?.removeEventListener("dcx:continuouscategorywillchange", this.handleContinuousCategoryWillChange);
      this.expander?.removeEventListener("dcx:continuouscategorychange", this.handleContinuousCategoryChange);
      window.removeEventListener("resize", this.handleResize);
      window.removeEventListener("keydown", this.handleKeydown);
      this.desktop?.removeEventListener("change", this.handleMediaChange);
      this.reducedMotion?.removeEventListener("change", this.handleReducedMotionChange);
      this.resizeObserver?.disconnect();
      this.rebuildTimers.forEach((timer) => window.clearTimeout(timer));
      if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
      if (this.rebuildFrame) cancelAnimationFrame(this.rebuildFrame);
      this.svg?.remove();
      this.nav?.classList.remove("dcx-material-rail-host");
      this.nav?.removeAttribute("data-rail-ready");
    }
  }

  const syncRail = () => {
    syncFrame = 0;
    const expander = document.querySelector(".dcx-expander");
    if (!expander) {
      controller?.destroy();
      controller = null;
      return;
    }
    if (!controller || controller.expander !== expander) {
      controller?.destroy();
      controller = new DcxMaterialRail(expander);
    }
    controller.refresh();
  };

  const scheduleSync = () => {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(syncRail);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleSync);
  scheduleSync();
})();
