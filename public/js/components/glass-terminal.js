import { renderCommandDemo } from "../demo-renderer.js";
import { initSplitCompare } from "../effects/split-compare.js";
import { commandProcessSteps, commandCategories, commandRelationships } from "../data.js";

// Track current split instance and command for cleanup
let currentSplitInstance = null;
let currentCommandId = null;

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
// DESKTOP LAYOUT (unchanged)
// ============================================

function renderDesktopLayout(container, commands) {
    const categoryOrder = ['diagnostic', 'quality', 'intensity', 'adaptation', 'enhancement', 'system'];
    const categoryLabels = {
        'diagnostic': 'Diagnose',
        'quality': 'Quality',
        'intensity': 'Intensity',
        'adaptation': 'Adaptation',
        'enhancement': 'Enhancement',
        'system': 'System'
    };

    const grouped = {};
    commands.forEach(cmd => {
        const cat = commandCategories[cmd.id] || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(cmd);
    });

    let manualHTML = '';
    categoryOrder.forEach(cat => {
        if (grouped[cat] && grouped[cat].length > 0) {
            manualHTML += `<div class="command-category-header">${categoryLabels[cat] || cat}</div>`;
            manualHTML += grouped[cat].map(cmd => renderManualEntry(cmd)).join('');
        }
    });

    container.innerHTML = `
        <div class="commands-container">
            <div class="command-manual">
                ${manualHTML}
            </div>
            <div class="glass-terminal-wrapper">
                <div class="glass-terminal">
                    <div class="terminal-header">
                        <span class="terminal-dot red"></span>
                        <span class="terminal-dot yellow"></span>
                        <span class="terminal-dot green"></span>
                        <span class="terminal-title">zsh — 80x24</span>
                    </div>
                    <div class="terminal-body" id="terminal-content">
                        <div class="terminal-line">
                            <span class="terminal-prompt">➜</span>
                            <span>Waiting for input...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    setupDesktopScrollSpy(commands);

    if (commands.length > 0) {
        updateTerminal(commands[0], document.getElementById('terminal-content'), commands);
        const firstEntry = document.querySelector('.manual-entry');
        if (firstEntry) firstEntry.classList.add('active');
    }
}

function renderManualEntry(cmd) {
    const relationship = commandRelationships[cmd.id];
    let relationshipHTML = '';

    if (relationship) {
        if (relationship.pairs) {
            relationshipHTML = `<div class="manual-cmd-rel"><span class="rel-icon">↔</span> pairs with <code>/${relationship.pairs}</code></div>`;
        } else if (relationship.leadsTo && relationship.leadsTo.length > 0) {
            relationshipHTML = `<div class="manual-cmd-rel"><span class="rel-icon">→</span> leads to ${relationship.leadsTo.map(c => `<code>/${c}</code>`).join(', ')}</div>`;
        } else if (relationship.combinesWith && relationship.combinesWith.length > 0) {
            relationshipHTML = `<div class="manual-cmd-rel"><span class="rel-icon">+</span> combines with ${relationship.combinesWith.map(c => `<code>/${c}</code>`).join(', ')}</div>`;
        }
    }

    return `
        <div class="manual-entry" data-id="${cmd.id}" id="cmd-${cmd.id}">
            <h3 class="manual-cmd-name">/${cmd.id}</h3>
            <p class="manual-cmd-desc">${cmd.description}</p>
            ${relationshipHTML}
        </div>
    `;
}

function setupDesktopScrollSpy(commands) {
    const entries = document.querySelectorAll('.manual-entry');
    const terminalContent = document.getElementById('terminal-content');

    const observer = new IntersectionObserver((observerEntries) => {
        observerEntries.forEach(entry => {
            if (entry.isIntersecting) {
                document.querySelectorAll('.manual-entry').forEach(e => e.classList.remove('active'));
                entry.target.classList.add('active');

                const cmdId = entry.target.dataset.id;
                const cmd = commands.find(c => c.id === cmdId);
                if (cmd) {
                    updateTerminal(cmd, terminalContent, commands);
                }
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: "-35% 0px -55% 0px"
    });

    entries.forEach(e => observer.observe(e));

    entries.forEach(e => {
        e.addEventListener('click', () => {
            document.querySelectorAll('.manual-entry').forEach(el => el.classList.remove('active'));
            e.classList.add('active');

            const cmdId = e.dataset.id;
            const cmd = commands.find(c => c.id === cmdId);
            if (cmd) {
                updateTerminal(cmd, terminalContent, commands);
            }

            e.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    });
}

function updateTerminal(cmd, container, allCommands) {
    if (!cmd || !container) return;

    if (currentCommandId === cmd.id) return;
    currentCommandId = cmd.id;

    if (currentSplitInstance) {
        currentSplitInstance.destroy();
        currentSplitInstance = null;
    }

    const steps = commandProcessSteps[cmd.id] || ['Analyze', 'Transform', 'Verify'];
    const stepsOutput = steps.map((step, i) =>
        `<span class="terminal-step">${i + 1}. ${step}...</span>`
    ).join('<br>');

    container.innerHTML = `<div class="terminal-line"><span class="terminal-prompt">➜</span><span class="terminal-cmd">/${cmd.id}</span></div>
<div class="terminal-output">${stepsOutput}<br><span class="terminal-done">✓ Complete</span></div>
<div class="terminal-preview command-demo-area">${renderCommandDemo(cmd.id)}</div>
<div class="terminal-line terminal-cursor-line"><span class="terminal-prompt">➜</span><span class="terminal-cursor"></span></div>`;

    const splitComparison = container.querySelector('.demo-split-comparison');
    if (splitComparison) {
        currentSplitInstance = initSplitCompare(splitComparison, {
            defaultPosition: 50,
            skewOffset: 8,
            minPosition: 5,
            maxPosition: 95
        });
    }
}

// ============================================
// MOBILE LAYOUT - Carousel + Sticky Demo
// ============================================

function renderMobileLayout(container, commands) {
    // Build carousel pills
    const carouselHTML = commands.map((cmd, i) => `
        <button class="mobile-cmd-pill${i === 0 ? ' active' : ''}" data-id="${cmd.id}">
            /${cmd.id}
        </button>
    `).join('');

    // Build command info cards (one per command, only active one shown)
    const infoCardsHTML = commands.map((cmd, i) => {
        const relationship = commandRelationships[cmd.id];
        let relationshipHTML = '';

        if (relationship) {
            if (relationship.pairs) {
                relationshipHTML = `<div class="mobile-cmd-rel">↔ pairs with <code>/${relationship.pairs}</code></div>`;
            } else if (relationship.leadsTo && relationship.leadsTo.length > 0) {
                relationshipHTML = `<div class="mobile-cmd-rel">→ leads to ${relationship.leadsTo.map(c => `<code>/${c}</code>`).join(', ')}</div>`;
            }
        }

        return `
            <div class="mobile-cmd-info${i === 0 ? ' active' : ''}" data-id="${cmd.id}">
                <h3 class="mobile-cmd-name">/${cmd.id}</h3>
                <p class="mobile-cmd-desc">${cmd.description}</p>
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
            skewOffset: 6,
            minPosition: 10,
            maxPosition: 90
        });
    }

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
                    defaultPosition: 50,
                    skewOffset: 6,
                    minPosition: 10,
                    maxPosition: 90
                });
            }
        });
    });
}
