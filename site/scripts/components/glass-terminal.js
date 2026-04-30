import { renderCommandDemo, initCommandDemo } from "../demo-renderer.js";
import { initSplitCompare } from "../effects/split-compare.js";
import { commandProcessSteps, commandCategories, commandRelationships, alphaCommands } from "../data.js";

// Track current split instance and command for cleanup
let currentSplitInstance = null;
let currentCommandId = null;
let sourceCache = {}; // Cache fetched source content

const MOBILE_BREAKPOINT = 900;

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

export function initGlassTerminal() {
    // Initial setup if needed
}

export function renderTerminalLayout(commands) {
    const container = document.querySelector('.commands-gallery');
    if (!container) return;

    if (isMobile()) {
        renderMobileLayout(container, commands);
    } else {
        renderDesktopLayout(container, commands);
    }

    // Re-render on resize crossing breakpoint
    let wasMobile = isMobile();
    window.addEventListener('resize', () => {
        const nowMobile = isMobile();
        if (nowMobile !== wasMobile) {
            wasMobile = nowMobile;
            currentSplitInstance = null;
            currentCommandId = null;
            if (nowMobile) {
                renderMobileLayout(container, commands);
            } else {
                renderDesktopLayout(container, commands);
            }
        }
    });
}

// ============================================
// DESKTOP LAYOUT - Magazine Spread
// ============================================

let magazineState = {
    currentIndex: 0,
    commands: [],
    isTransitioning: false,
    keyboardBound: false,
    intersectionObserver: null
};

const categoryOrder = ['diagnostic', 'quality', 'intensity', 'adaptation', 'enhancement', 'system'];
const categoryLabels = {
    'create': 'Create',
    'evaluate': 'Evaluate',
    'refine': 'Refine',
    'simplify': 'Simplify',
    'harden': 'Harden',
    'system': 'System'
};

function renderDesktopLayout(container, commands) {
    magazineState.commands = commands;

    let startIndex = -1;

    // Filter out deprecated shims. craft, teach, extract used to be filtered
    // too (when they were rendered as 'impeccable craft' etc.) but are now
    // first-class sub-commands that should appear in the gallery.
    const deprecated = new Set(['teach-impeccable', 'frontend-design', 'arrange', 'normalize', 'onboard', 'impeccable craft', 'impeccable teach', 'impeccable extract']);
    const filteredCommands = commands.filter(c => !deprecated.has(c.id));

    const categoryOrder = ['create', 'evaluate', 'refine', 'simplify', 'harden', 'system'];
    const categoryLabelsShort = {
        'create': 'Create', 'evaluate': 'Evaluate', 'refine': 'Refine',
        'simplify': 'Simplify', 'harden': 'Harden', 'system': 'System'
    };
    // Preferred order within each category (unlisted commands append at end)
    const categoryCommandOrder = {
        'create': ['impeccable', 'craft', 'shape'],
        'evaluate': ['critique', 'audit'],
        'refine': ['typeset', 'layout', 'colorize', 'animate', 'delight', 'bolder', 'quieter', 'overdrive'],
        'simplify': ['distill', 'clarify', 'adapt'],
        'harden': ['polish', 'optimize', 'harden'],
        'system': ['teach', 'extract']
    };
    const grouped = {};
    filteredCommands.forEach(cmd => {
        const cat = commandCategories[cmd.id] || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(cmd);
    });
    // Sort each group by preferred order
    Object.entries(grouped).forEach(([cat, cmds]) => {
        const order = categoryCommandOrder[cat] || [];
        cmds.sort((a, b) => {
            const ai = order.indexOf(a.id);
            const bi = order.indexOf(b.id);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
    });
    const orderedCommands = [];
    const headerIndices = [];
    categoryOrder.forEach(cat => {
        if (!grouped[cat]) return;
        headerIndices.push({ index: orderedCommands.length, label: categoryLabelsShort[cat] || cat });
        orderedCommands.push(...grouped[cat]);
    });
    // Use ordered list for everything
    filteredCommands.length = 0;
    filteredCommands.push(...orderedCommands);
    magazineState.commands = filteredCommands;

    // Determine starting index: URL hash takes priority, otherwise default to "clarify"
    const hash = window.location.hash;
    if (hash && hash.startsWith('#cmd-')) {
        const idx = filteredCommands.findIndex(c => c.id === hash.slice(5));
        if (idx >= 0) startIndex = idx;
    }
    if (startIndex < 0) {
        startIndex = Math.max(0, filteredCommands.findIndex(c => c.id === 'clarify'));
    }
    magazineState.currentIndex = startIndex;

    // Build spreads HTML (after ordering so indices match fisheye)
    const spreadsHTML = filteredCommands.map((cmd, i) => renderSpread(cmd, i, i === startIndex)).join('');

    const fisheyeHTML = filteredCommands.map((cmd, i) => {
        const cat = commandCategories[cmd.id] || 'other';
        const isAlpha = alphaCommands.includes(cmd.id);
        // The root skill is shown as "/impeccable", everything else is a sub-command
        // displayed without a slash (invocation is /impeccable <name>)
        const isRoot = cmd.id === 'impeccable';
        const label = isRoot
            ? `<span class="fisheye-slash">/</span>impeccable`
            : cmd.id;
        return `<button class="fisheye-item${i === startIndex ? ' is-active' : ''}" data-index="${i}" data-id="${cmd.id}" data-cat="${cat}">${label}${isAlpha ? '<span class="fisheye-beta">ALPHA</span>' : ''}</button>`;
    }).join('');

    container.innerHTML = `
        <div class="magazine-container">
            <div class="fisheye-list" id="fisheye-list">
                <div class="fisheye-scroll">${fisheyeHTML}</div>
            </div>
            <div class="magazine-viewport">
                ${spreadsHTML}
            </div>
        </div>
    `;

    // Init demo for active spread
    initSpreadDemo(startIndex);

    // Set up interactions
    setupFisheyeList(filteredCommands, headerIndices);
    setupMagazineKeyboard(filteredCommands);
    setupMagazineIntersection(container);
}

function renderSpread(cmd, index, isActive) {
    const cat = commandCategories[cmd.id] || 'other';
    const isAlpha = alphaCommands.includes(cmd.id);
    const relationship = commandRelationships[cmd.id];
    // Build relationship flow
    let flowHTML = '';
    if (relationship) {
        if (relationship.pairs) {
            flowHTML = `
                <div class="spread-flow">
                    <span class="spread-flow-icon">&#8596;</span>
                    <span class="spread-flow-label">pairs with</span>
                    <span class="spread-flow-cmd">/${relationship.pairs}</span>
                </div>`;
        } else if (relationship.leadsTo && relationship.leadsTo.length > 0) {
            flowHTML = `
                <div class="spread-flow">
                    <span class="spread-flow-icon">&#8594;</span>
                    <span class="spread-flow-label">leads to</span>
                    ${relationship.leadsTo.map(c => `<span class="spread-flow-cmd">/${c}</span>`).join(' ')}
                </div>`;
        } else if (relationship.combinesWith && relationship.combinesWith.length > 0) {
            flowHTML = `
                <div class="spread-flow">
                    <span class="spread-flow-icon">+</span>
                    <span class="spread-flow-label">combines with</span>
                    ${relationship.combinesWith.map(c => `<span class="spread-flow-cmd">/${c}</span>`).join(' ')}
                </div>`;
        }
        if (!flowHTML && relationship.flow) {
            flowHTML = `
                <div class="spread-flow">
                    <span class="spread-flow-label">${relationship.flow}</span>
                </div>`;
        }
    }

    // The root skill is rendered as /impeccable; sub-commands are rendered as
    // /impeccable on a smaller line above the command name, so the command name
    // stays the visual anchor at full display size.
    const isRoot = cmd.id === 'impeccable';
    const nameHTML = isRoot
        ? `<span class="spread-slash">/</span>impeccable`
        : `<span class="spread-namespace"><span class="spread-slash">/</span>impeccable</span>${cmd.id}`;

    return `
        <div class="magazine-spread${isActive ? ' active' : ''}" data-index="${index}" data-category="${cat}" data-id="${cmd.id}" id="cmd-${cmd.id}">
            <div class="spread-identity">
                <span class="spread-category-label">${categoryLabels[cat] || cat}</span>
                <h3 class="spread-command-name">${nameHTML}${isAlpha ? '<span class="beta-badge">ALPHA</span>' : ''}</h3>
                <p class="spread-description">${cmd.tagline || cmd.description}</p>
                ${flowHTML}
            </div>
            <div class="spread-demo-area" data-demo-index="${index}">
                <!-- Demo rendered lazily -->
            </div>
        </div>
    `;
}

function initSpreadDemo(index) {
    const cmd = magazineState.commands[index];
    if (!cmd) return;

    const spread = document.querySelector(`.magazine-spread[data-index="${index}"]`);
    if (!spread) return;

    const demoArea = spread.querySelector('.spread-demo-area');
    if (!demoArea) return;

    // Cleanup previous split instance
    if (currentSplitInstance) {
        currentSplitInstance.destroy();
        currentSplitInstance = null;
    }

    currentCommandId = cmd.id;

    // Only render HTML once; re-init split compare every time
    if (demoArea.dataset.loaded !== 'true') {
        demoArea.innerHTML = renderCommandDemo(cmd.id);
        demoArea.dataset.loaded = 'true';
    }

    const splitComparison = demoArea.querySelector('.demo-split-comparison');
    if (splitComparison) {
        currentSplitInstance = initSplitCompare(splitComparison, {
            defaultPosition: 50
        });
    }
    initCommandDemo(cmd.id, demoArea);
}

function goToSpread(newIndex, commands) {
    if (newIndex < 0 || newIndex >= commands.length) return;
    if (newIndex === magazineState.currentIndex) return;

    const oldIndex = magazineState.currentIndex;
    magazineState.currentIndex = newIndex;

    const spreads = document.querySelectorAll('.magazine-spread');

    // Destroy the old split instance before switching
    if (currentSplitInstance) {
        currentSplitInstance.destroy();
        currentSplitInstance = null;
    }

    // Mark old as exiting
    spreads[oldIndex]?.classList.remove('active');
    spreads[oldIndex]?.classList.add('exiting');

    // Mark new as active
    spreads[newIndex]?.classList.add('active');
    spreads[newIndex]?.classList.remove('exiting');

    // No fisheye sync here -- fisheye drives goToSpread, not the other way around

    // Update URL hash
    const cmd = commands[newIndex];
    if (cmd) {
        history.replaceState(null, '', `#cmd-${cmd.id}`);
    }

    // Init demo for new spread (lazy)
    initSpreadDemo(newIndex);

    // Clean exiting class after transition
    setTimeout(() => {
        spreads[oldIndex]?.classList.remove('exiting');
    }, 500);
}

function setupFisheyeList(commands, headerIndices = []) {
    const list = document.getElementById('fisheye-list');
    const scroll = list?.querySelector('.fisheye-scroll');
    const items = list ? [...list.querySelectorAll('.fisheye-item')] : [];
    if (!list || !scroll || !items.length) return;

    // Fixed item height (matches CSS). All math is index-based.
    // -- Fisheye with absolute positioning --
    // Each item is placed absolutely. Their Y positions are computed by
    // accumulating scaled heights, so small items cluster together
    // and the center item gets full space. Scroll position maps linearly
    // to a fractional "center index" which drives everything.

    const BASE_H = 36; // height of the center (scale=1) item
    const MIN_SCALE = 0.35;
    const RADIUS = 5;
    const count = items.length;
    const listH = list.clientHeight;
    const centerY = listH / 2;
    let currentActive = -1;

    // Total scroll range: one "step" per item
    const STEP = 30; // px of scroll per item advance
    const totalScroll = (count - 1) * STEP;

    // Set scroll container height to accommodate the range + centering padding
    const spacer = document.createElement('div');
    spacer.style.height = `${totalScroll + listH}px`;
    scroll.appendChild(spacer);
    // Initial scroll to center first item
    scroll.scrollTop = 0;

    // Map scrollTop to fractional center index
    const getCenterIndex = () => scroll.scrollTop / STEP;

    // Compute eased scale for a given distance from center
    const getScale = (dist) => {
        const ratio = Math.max(0, 1 - dist / RADIUS);
        const eased = ratio * ratio * (3 - 2 * ratio); // smoothstep
        return MIN_SCALE + eased * (1 - MIN_SCALE);
    };

    // Layout: position all items based on current center
    const layout = (center) => {
        // First, compute the Y position for each item by accumulating
        // scaled heights, centered around the center item
        const heights = items.map((_, i) => {
            const dist = Math.abs(i - center);
            return BASE_H * getScale(dist);
        });

        // Find the Y offset so the fractional center position lands at centerY.
        // Interpolate between the integer positions for smooth scrolling.
        const floorIdx = Math.max(0, Math.min(count - 1, Math.floor(center)));
        const frac = center - floorIdx;

        let yAtFloor = 0;
        for (let i = 0; i < floorIdx; i++) yAtFloor += heights[i];
        yAtFloor += heights[floorIdx] / 2;

        // If between two items, blend toward the next
        let yAtCeil = yAtFloor;
        if (floorIdx < count - 1) {
            yAtCeil = yAtFloor + heights[floorIdx] / 2 + heights[floorIdx + 1] / 2;
        }
        const yAtCenter = yAtFloor + (yAtCeil - yAtFloor) * frac;
        const offset = centerY - yAtCenter + scroll.scrollTop;

        // Position each item
        let y = offset;
        items.forEach((item, i) => {
            const h = heights[i];
            const scale = getScale(Math.abs(i - center));
            const opacity = 0.25 + (scale - MIN_SCALE) / (1 - MIN_SCALE) * 0.75;

            item.style.top = `${y}px`;
            item.style.transform = `scale(${scale})`;
            item.style.opacity = opacity;
            y += h;
        });
    };

    const activate = (idx) => {
        idx = Math.max(0, Math.min(count - 1, Math.round(idx)));
        if (idx === currentActive) return;
        currentActive = idx;
        items.forEach((it, i) => it.classList.toggle('is-active', i === idx));
        goToSpread(idx, commands);
    };

    const scrollToIndex = (idx, behavior = 'smooth') => {
        idx = Math.max(0, Math.min(count - 1, idx));
        scroll.scrollTo({ top: idx * STEP, behavior });
    };

    // Scroll handler
    let raf = null;
    scroll.addEventListener('scroll', () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            const center = getCenterIndex();
            layout(center);
            activate(Math.round(center));
        });
    }, { passive: true });


    // Click to jump
    items.forEach((item, i) => {
        item.addEventListener('click', () => scrollToIndex(i));
    });

    // Expose for keyboard/external nav
    list._scrollToCommand = (idx) => scrollToIndex(idx);

    // Init
    const startIdx = magazineState.currentIndex;
    currentActive = -1;
    scroll.scrollTop = startIdx * STEP;
    layout(startIdx);
    activate(startIdx);
}

function setupMagazineKeyboard(commands) {
    if (magazineState.keyboardBound) return;
    magazineState.keyboardBound = true;

    document.addEventListener('keydown', (e) => {
        // Only respond when magazine is visible (desktop)
        if (isMobile()) return;
        const magazineEl = document.querySelector('.magazine-container');
        if (!magazineEl) return;

        // Check if magazine is somewhat in the viewport
        const rect = magazineEl.getBoundingClientRect();
        const inView = rect.top < window.innerHeight && rect.bottom > 0;
        if (!inView) return;

        const fisheyeList = document.getElementById('fisheye-list');
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            fisheyeList?._scrollToCommand?.(magazineState.currentIndex + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            fisheyeList?._scrollToCommand?.(magazineState.currentIndex - 1);
        }
    });
}

function setupMagazineIntersection(container) {
    // When the magazine section enters the viewport, ensure the active demo is rendered
    if (magazineState.intersectionObserver) {
        magazineState.intersectionObserver.disconnect();
    }

    magazineState.intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                initSpreadDemo(magazineState.currentIndex);
            }
        });
    }, { threshold: 0.1 });

    const magazineEl = container.querySelector('.magazine-container');
    if (magazineEl) {
        magazineState.intersectionObserver.observe(magazineEl);
    }
}

function truncateDescription(text, maxLen = 120) {
    if (text.length <= maxLen) return text;
    // Cut at last sentence boundary within limit, or last word boundary
    const truncated = text.slice(0, maxLen);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > maxLen * 0.5) return truncated.slice(0, lastPeriod + 1);
    const lastSpace = truncated.lastIndexOf(' ');
    return truncated.slice(0, lastSpace) + '...';
}

// ============================================
// MOBILE LAYOUT - Carousel + Sticky Demo
// ============================================

function renderMobileLayout(container, commands) {
    // Build carousel pills
    // Carousel pills show bare command names for sub-commands, and /impeccable
    // for the root entry.
    const carouselHTML = commands.map((cmd, i) => `
        <button class="mobile-cmd-pill${i === 0 ? ' active' : ''}" data-id="${cmd.id}">
            ${cmd.id === 'impeccable' ? '/impeccable' : cmd.id}
        </button>
    `).join('');

    // Build command info cards (one per command, only active one shown)
    const infoCardsHTML = commands.map((cmd, i) => {
        const relationship = commandRelationships[cmd.id];
        let relationshipHTML = '';

        // Relationships show bare command names (e.g., "pairs with quieter")
        // because the invocation is /impeccable <name>, not /<name>.
        if (relationship) {
            if (relationship.pairs) {
                relationshipHTML = `<div class="mobile-cmd-rel">↔ pairs with <code>${relationship.pairs}</code></div>`;
            } else if (relationship.leadsTo && relationship.leadsTo.length > 0) {
                relationshipHTML = `<div class="mobile-cmd-rel">→ leads to ${relationship.leadsTo.map(c => `<code>${c}</code>`).join(', ')}</div>`;
            }
        }

        const cardName = cmd.id === 'impeccable'
            ? '/impeccable'
            : `<span class="mobile-cmd-namespace">/impeccable</span> ${cmd.id}`;

        return `
            <div class="mobile-cmd-info${i === 0 ? ' active' : ''}" data-id="${cmd.id}">
                <h3 class="mobile-cmd-name">${cardName}</h3>
                <p class="mobile-cmd-desc">${cmd.tagline || cmd.description}</p>
                ${relationshipHTML}
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="mobile-commands-layout">
            <div class="mobile-carousel-wrapper">
                <div class="mobile-carousel">
                    ${carouselHTML}
                </div>
            </div>
            <div class="mobile-demo-area" id="mobile-demo-content">
                ${renderCommandDemo(commands[0]?.id || 'audit')}
            </div>
            <div class="mobile-info-area">
                ${infoCardsHTML}
            </div>
        </div>
    `;

    setupMobileInteractions(commands);
}

function setupMobileInteractions(commands) {
    const pills = document.querySelectorAll('.mobile-cmd-pill');
    const demoArea = document.getElementById('mobile-demo-content');
    const infoCards = document.querySelectorAll('.mobile-cmd-info');

    // Initialize first demo's split compare
    const initialSplit = demoArea.querySelector('.demo-split-comparison');
    if (initialSplit) {
        currentSplitInstance = initSplitCompare(initialSplit, {
            defaultPosition: 50,
            minPosition: 10,
            maxPosition: 90
        });
    }
    if (commands[0]) initCommandDemo(commands[0].id, demoArea);

    // Pill click/tap handler
    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            const cmdId = pill.dataset.id;
            const cmd = commands.find(c => c.id === cmdId);
            if (!cmd || currentCommandId === cmdId) return;

            currentCommandId = cmdId;

            // Update active pill
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');

            // Scroll pill into view horizontally
            pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

            // Update info card
            infoCards.forEach(card => {
                card.classList.toggle('active', card.dataset.id === cmdId);
            });

            // Cleanup previous split
            if (currentSplitInstance) {
                currentSplitInstance.destroy();
                currentSplitInstance = null;
            }

            // Update demo
            demoArea.innerHTML = renderCommandDemo(cmdId);

            // Init new split compare
            const splitComparison = demoArea.querySelector('.demo-split-comparison');
            if (splitComparison) {
                currentSplitInstance = initSplitCompare(splitComparison, {
                    defaultPosition: 50
                });
            }
            initCommandDemo(cmdId, demoArea);
        });
    });
}

// ============================================
// STACKED WINDOWS - Tab Switching
// ============================================

function setupStackTabs() {
    const tabs = document.querySelectorAll('.terminal-stack-tab');
    const demoWindow = document.querySelector('.terminal-window--demo');
    const sourceWindow = document.querySelector('.terminal-window--source');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;

            // Update tab states
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Switch windows
            if (view === 'source') {
                demoWindow.classList.add('is-back');
                sourceWindow.classList.add('is-front');
            } else {
                demoWindow.classList.remove('is-back');
                sourceWindow.classList.remove('is-front');
            }
        });
    });
}

async function fetchCommandSource(cmdId) {
    // Check cache first
    if (sourceCache[cmdId]) {
        return sourceCache[cmdId];
    }

    try {
        const response = await fetch(`/api/command-source/${cmdId}`);
        if (!response.ok) throw new Error('Failed to fetch source');
        const data = await response.json();
        sourceCache[cmdId] = data.content;
        return data.content;
    } catch (error) {
        console.error('Error fetching command source:', error);
        return null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function updateSourceContent(cmdId) {
    const titleEl = document.getElementById('source-title');
    const contentEl = document.getElementById('source-content');

    if (!titleEl || !contentEl) return;

    titleEl.textContent = `${cmdId}.md`;
    contentEl.innerHTML = '<span class="source-loading">Loading...</span>';

    const source = await fetchCommandSource(cmdId);
    if (source) {
        contentEl.textContent = source;
    } else {
        contentEl.innerHTML = '<span class="source-loading">Source not available</span>';
    }
}

