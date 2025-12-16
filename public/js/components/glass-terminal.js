import { renderCommandDemo } from "../demo-renderer.js";
import { initSplitCompare } from "../effects/split-compare.js";
import { commandProcessSteps, commandCategories, commandRelationships } from "../data.js";

export function initGlassTerminal() {
    // Initial setup if needed
}

export function renderTerminalLayout(commands) {
    const container = document.querySelector('.commands-gallery');
    if (!container) return;

    // Group commands by category
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

    // Build manual with category headers
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
                        <!-- Dynamic Content -->
                        <div class="terminal-line">
                            <span class="terminal-prompt">➜</span>
                            <span>Waiting for input...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    setupScrollSpy(commands);

    // Select first command initially
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

function setupScrollSpy(commands) {
    const entries = document.querySelectorAll('.manual-entry');
    const terminalContent = document.getElementById('terminal-content');

    // Intersection Observer for Scroll Spy - trigger around vertical center
    const observer = new IntersectionObserver((observerEntries) => {
        observerEntries.forEach(entry => {
            if (entry.isIntersecting) {
                // Update active state
                document.querySelectorAll('.manual-entry').forEach(e => e.classList.remove('active'));
                entry.target.classList.add('active');

                // Update terminal
                const cmdId = entry.target.dataset.id;
                const cmd = commands.find(c => c.id === cmdId);
                if (cmd) {
                    updateTerminal(cmd, terminalContent, commands);
                }
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: "-35% 0px -55% 0px" // Trigger zone biased toward upper-middle of viewport
    });

    entries.forEach(e => observer.observe(e));

    // Click interaction - immediate selection + smooth scroll
    entries.forEach(e => {
        e.addEventListener('click', () => {
            // Immediately update state
            document.querySelectorAll('.manual-entry').forEach(el => el.classList.remove('active'));
            e.classList.add('active');

            const cmdId = e.dataset.id;
            const cmd = commands.find(c => c.id === cmdId);
            if (cmd) {
                updateTerminal(cmd, terminalContent, commands);
            }

            // Then scroll into view
            e.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    });
}

// Track current split instance and command for cleanup
let currentSplitInstance = null;
let currentCommandId = null;

function updateTerminal(cmd, container, allCommands) {
    if (!cmd || !container) return;

    // Skip if already showing this command
    if (currentCommandId === cmd.id) return;
    currentCommandId = cmd.id;

    // Cleanup previous split instance
    if (currentSplitInstance) {
        currentSplitInstance.destroy();
        currentSplitInstance = null;
    }

    // Get process steps for this command (or use generic fallback)
    const steps = commandProcessSteps[cmd.id] || ['Analyze', 'Transform', 'Verify'];
    const stepsOutput = steps.map((step, i) =>
        `<span class="terminal-step">${i + 1}. ${step}...</span>`
    ).join('<br>');

    // Content update - no extra indentation to avoid whitespace
    container.innerHTML = `<div class="terminal-line"><span class="terminal-prompt">➜</span><span class="terminal-cmd">/${cmd.id}</span></div>
<div class="terminal-output">${stepsOutput}<br><span class="terminal-done">✓ Complete</span></div>
<div class="terminal-preview command-demo-area">${renderCommandDemo(cmd.id)}</div>
<div class="terminal-line terminal-cursor-line"><span class="terminal-prompt">➜</span><span class="terminal-cursor"></span></div>`;

    // Initialize split-compare effect for the demo
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


