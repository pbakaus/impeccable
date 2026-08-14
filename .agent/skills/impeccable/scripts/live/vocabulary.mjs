/**
 * Canonical design-command vocabulary for Live Mode: each command's value, human
 * label, and SVG icon. Icons stack above the chip label; strokes use currentColor
 * so the icon recolors when its chip is selected.
 *
 * Single source of truth, consumed by:
 *   - skill/scripts/live/event-validation.mjs — re-exports VISUAL_ACTIONS.
 *   - skill/scripts/live-browser.js — the real picker. It is served raw and
 *     injected as an IIFE, so it cannot import this at runtime; live-server.mjs
 *     serializes LIVE_COMMANDS into window.__IMPECCABLE_VOCAB__ alongside the
 *     token/port, and live-browser.js builds its ICONS + ACTIONS from that.
 *   - site/components/LiveDemoPalette.astro — the marketing demo palette (imported
 *     at build time).
 *
 * Add, rename, or reorder a verb here and all three follow.
 */

const ICON_ATTRS = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"';

export const LIVE_COMMANDS = [
  { value: 'impeccable', label: 'Freeform',  icon: `<svg ${ICON_ATTRS}><path d="M4 20l4-1L18 9l-3-3L5 16z"/><path d="M14 7l3 3"/></svg>` },
  { value: 'bolder',     label: 'Bolder',    icon: `<svg ${ICON_ATTRS}><rect x="6" y="12" width="4" height="7" rx="0.5"/><rect x="14" y="5" width="4" height="14" rx="0.5"/></svg>` },
  { value: 'quieter',    label: 'Quieter',   icon: `<svg ${ICON_ATTRS}><rect x="6" y="5" width="4" height="14" rx="0.5"/><rect x="14" y="12" width="4" height="7" rx="0.5"/></svg>` },
  { value: 'distill',    label: 'Distill',   icon: `<svg ${ICON_ATTRS}><path d="M4 5h16l-6 8v7l-4-2v-5z"/></svg>` },
  { value: 'polish',     label: 'Polish',    icon: `<svg ${ICON_ATTRS}><path d="M15 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/><path d="M7 13l0.6 1.8 1.8 0.6-1.8 0.6-0.6 1.8-0.6-1.8-1.8-0.6 1.8-0.6z"/></svg>` },
  { value: 'typeset',    label: 'Typeset',   icon: `<svg ${ICON_ATTRS}><path d="M5 6h14" stroke-width="2.6"/><path d="M5 12h9" stroke-width="1.9"/><path d="M5 18h5" stroke-width="1.3"/></svg>` },
  { value: 'colorize',   label: 'Colorize',  icon: `<svg ${ICON_ATTRS}><circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/></svg>` },
  { value: 'layout',     label: 'Layout',    icon: `<svg ${ICON_ATTRS}><rect x="3" y="4" width="8" height="16" rx="0.5"/><rect x="13" y="4" width="8" height="7" rx="0.5"/><rect x="13" y="13" width="8" height="7" rx="0.5"/></svg>` },
  { value: 'adapt',      label: 'Adapt',     icon: `<svg ${ICON_ATTRS}><rect x="2.5" y="5" width="12" height="11" rx="1"/><line x1="2.5" y1="19" x2="14.5" y2="19"/><rect x="16.5" y="8" width="5" height="11" rx="1"/></svg>` },
  { value: 'animate',    label: 'Animate',   icon: `<svg ${ICON_ATTRS}><path d="M3 18c4-4 6-10 10-10"/><path d="M13 8c3 0 5 5 8 10"/><circle cx="13" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>` },
  { value: 'delight',    label: 'Delight',   icon: `<svg ${ICON_ATTRS}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>` },
  { value: 'overdrive',  label: 'Overdrive', icon: `<svg ${ICON_ATTRS}><path d="M13 3L5 13h5l-1 8 9-12h-6z"/></svg>` },
];

// Action values accepted by the live event protocol, in palette order.
export const VISUAL_ACTIONS = LIVE_COMMANDS.map((c) => c.value);

/*
 * ---------------------------------------------------------------------------
 * Protocol vocabulary
 * ---------------------------------------------------------------------------
 * The enums below are the wire contract between the browser overlay, the live
 * helper server, and the durable session journal. They live here rather than in
 * the modules that use them so a value cannot be added to the validator without
 * the store and the server seeing it too.
 *
 * live-browser.js still cannot import this file (it is served raw and injected
 * as an IIFE), so its local phase table repeats the agent-phase names. Anything
 * the server can broadcast must appear in AGENT_PHASES here first.
 */

/**
 * Phases the live server broadcasts as `agent_phase`, in lifecycle order.
 * Every one of these is emitted by `recordAgentPhase()` in live-server.mjs;
 * the validator rejects anything else, so a typo in a phase name fails loudly
 * instead of quietly ranking as an unknown phase in the browser's progress bar.
 */
export const AGENT_PHASES = Object.freeze([
  'picked_up',
  'scaffolding',
  'source_ready',
  'scaffold_fallback',
  'generation_ready',
  'first_reviewable',
  'second_reviewable',
  'all_variants_ready',
]);

/** Event types the helper server accepts from the browser over POST /events. */
export const CLIENT_EVENT_TYPES = Object.freeze([
  'generate',
  'accept',
  'discard',
  'checkpoint',
  'agent_phase',
  'variant_mounted',
  'variant_mount_failed',
  'exit',
  'prefetch',
  'manual_edits',
  'steer',
  'carbonize_cleanup',
]);

/**
 * Event types the durable journal applies. A superset of CLIENT_EVENT_TYPES:
 * the agent-side helpers (live-poll, live-complete) and the server itself
 * append the rest. An event type missing here lands as `unknown_event_type`
 * in the snapshot diagnostics.
 */
export const JOURNAL_EVENT_TYPES = Object.freeze([
  'generate',
  'variant_plan',
  'detector_waivers',
  'agent_phase',
  'variants_ready',
  'agent_done',
  'variant_mounted',
  'variant_mount_failed',
  'checkpoint',
  'accept',
  'accept_intent',
  'manual_edit_apply',
  'steer',
  'steer_done',
  'carbonize_cleanup',
  'discard',
  'discarded',
  'complete',
  'agent_error',
]);

/** Phases the session store assigns to a snapshot. */
export const SESSION_PHASES = Object.freeze([
  'new',
  'generate_requested',
  'variants_ready',
  'carbonize_required',
  'carbonize_cleanup_requested',
  'manual_edit_apply_requested',
  'steer_requested',
  'steer_done',
  'accept_requested',
  'discard_requested',
  'discarded',
  'completed',
  'agent_error',
]);

/** Phases that retire a session from the active list. */
export const COMPLETED_SESSION_PHASES = Object.freeze(['completed', 'discarded']);

/**
 * Phases after which a late generation write is a ghost from a canceled cycle.
 * The store journals such an event as a diagnostic instead of applying it.
 */
export const GENERATION_FENCED_SESSION_PHASES = Object.freeze([
  'accept_requested',
  'discard_requested',
  'carbonize_required',
  'completed',
  'discarded',
]);

/**
 * `reason` values carried on checkpoint events. Not validated (an unknown
 * reason is journaled, never rejected) because the reason is diagnostic
 * breadcrumb, not control flow. Two exceptions drive behavior and are split
 * out below.
 */
export const CHECKPOINT_REASONS = Object.freeze([
  'generate_started',
  'variants_progress',
  'variants_ready',
  'browser_resumed',
  'browser_resumed_svelte_component',
  'param_changed',
  'variant_anchor_missing',
  'component_preview_anchor_missing',
  'steer_input_focused',
  'steer_submitted',
  'steer_send_failed',
  'steer_done',
  'steer_error',
]);

/** Checkpoint reasons the server reads as variant-publication progress. */
export const VARIANT_PROGRESS_CHECKPOINT_REASONS = Object.freeze([
  'variants_progress',
  'variants_ready',
]);
