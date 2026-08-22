/**
 * Just-in-time agent instructions for live mode.
 *
 * The live scripts, not the reference doc, own situational plumbing: every
 * event printed by live-poll carries an `_instructions` string describing
 * exactly what to do NEXT, with real ids, paths, and line numbers already
 * substituted and only the active path's rules included (a svelte-component
 * session never sees JSX guidance, and vice versa). live.md stays lean: the
 * session contract, harness policy, and design-quality guidance that is not
 * situational (identity lock, variation axes, parameter budgets).
 *
 * Keep these strings imperative, concrete, and short. They are read by an
 * agent mid-session; every sentence must earn its tokens. Instructions are
 * versioned with the scripts, so they cannot drift from behavior the way a
 * hand-maintained doc can.
 */

const PLAN_POINTER = 'Plan per live.md section 4: extract the identity lock, pick default vs departure mode, commit each variant to a DIFFERENT primary axis, squint-test the trio. Size parameter knobs per section 7 budgets.';

function pollCmd(scriptsPath) {
  return `node ${scriptsPath}/live-poll.mjs`;
}

function replyCmd(scriptsPath, id, rest) {
  return `${pollCmd(scriptsPath)} --reply ${id} ${rest}`;
}

export function instructionsForEvent(event, { scriptsPath = '{{scripts_path}}' } = {}) {
  if (!event || typeof event !== 'object') return undefined;
  switch (event.type) {
    case 'generate':
      return generateInstructions(event, scriptsPath);
    case 'steer':
      return `Do what the message asks (page edits, navigation help, or a short answer). Then reply exactly once: ${replyCmd(scriptsPath, event.id, 'steer_done ["optional short toast"]')} (on failure: --reply ${event.id} error "Short reason"). No pickup ack; poll again immediately after.`;
    case 'prefetch':
      return `Speculative pre-read, no reply owed: resolve ${JSON.stringify(event.pageUrl || '/')} to its source file (root "/" is usually the boot's pageFile; multi-page sites map /foo to public/foo/index.html; SPAs map all routes to one entry), read it into context, then poll again. Skip if you cannot resolve it confidently.`;
    case 'variant_mount_failed':
      return `The browser could NOT render variant ${event.variant}${event.url ? ` (module: ${event.url})` : ''}${event.error ? `: ${String(event.error).slice(0, 200)}` : ''}. The user sees a persistent error card, not variants. Fix the variant source files, then reply ${replyCmd(scriptsPath, event.id, 'done --file <manifest or source path>')}; the browser retries on its own. Poll again after the reply.`;
    case 'accept':
      return acceptInstructions(event, scriptsPath);
    case 'discard':
      return event?._completionAck?.ok === true
        ? 'Original restored and durable completion acknowledged; nothing to do. Poll again.'
        : `Completion was not acknowledged: run node ${scriptsPath}/live-complete.mjs --id ${event.id} --discarded, then poll again.`;
    case 'manual_edit_apply':
      return `The user already clicked Apply; never ask, discard, or redirect. Delegate the source edits to the impeccable_manual_edit_applier subagent when available (pass cwd, scripts path, event id, page URL, chunk/deadline, batch, evidencePath); it must not poll or reply. ${event.repair ? 'A `repair` payload is present: the previous Apply changed source but validation failed; fix the CURRENT source, never roll back yourself. ' : ''}Reply exactly once: ${replyCmd(scriptsPath, event.id, `done --data '{"status":"done","appliedEntryIds":[...],"failed":[],"files":[...],"notes":[]}'`)} (status "partial"/"error" with failed[] when not every entry applied). Then poll again.`;
    case 'timeout':
      return 'No event arrived; poll again immediately.';
    case 'exit':
      return `Session over: kill any background poll, then node ${scriptsPath}/live-server.mjs stop (removes the injected script tag). Sweep leftover impeccable-variants-start / impeccable-carbonize-start markers from source.`;
    default:
      return undefined;
  }
}

function generateInstructions(event, scriptsPath) {
  const id = event.id;
  const scaffold = event.scaffold;
  const steps = [];

  if (event.screenshotPath) {
    steps.push(`Read the annotated screenshot first: ${event.screenshotPath}. Comment {x,y} positions bind text to the child under that point; strokes read by shape (loop = emphasis on this thing, arrow = direction, cross = delete).`);
  } else {
    steps.push('No screenshot was sent (the user did not annotate); do not ask for one and do not screenshot the page. Work from element.outerHTML, the computed styles, and the prompt.');
  }

  if (event.mode === 'insert') {
    steps.push(insertScaffoldInstructions(event, scriptsPath));
  } else if (scaffold?.previewMode === 'svelte-component') {
    steps.push(svelteComponentInstructions(event, scaffold, scriptsPath));
  } else if (scaffold && scaffold.sourceWritten === false) {
    steps.push(deferredWrapperInstructions(event, scaffold, scriptsPath));
  } else if (scaffold) {
    steps.push(`The wrapper is already written into ${scaffold.file}. Splice preview CSS plus all ${event.count} variants at line ${scaffold.insertLine} in ONE edit, following the returned cssAuthoring contract (styleTag, selector strategy, forbidden patterns). Each variant div holds exactly ONE top-level element (same tag as the original); first visible, others display: none.`);
  } else {
    steps.push(`Preflight could not scaffold${event.scaffoldError ? ` (${event.scaffoldError})` : ''}. Run node ${scriptsPath}/live-wrap.mjs --id ${id} --count ${event.count} --element-id "${event.element?.id || ''}" --classes "${(event.element?.classes || []).join(',')}" --tag "${event.element?.tagName || ''}" --text "<first ~80 chars of the picked element's textContent>". Keep the flags separate; --text disambiguates repeated siblings. On a fallback error, follow live.md's Handle fallback.`);
  }

  steps.push(event.action && event.action !== 'impeccable'
    ? `Action is "${event.action}": read reference/${event.action}.md before planning; its MUST params are non-negotiable. ${PLAN_POINTER}`
    : `Freeform action: work from SKILL.md rules plus craft-floor.md; no sub-command file. ${PLAN_POINTER}`);

  steps.push(`When all ${event.count} variants are delivered: ${replyCmd(scriptsPath, id, 'done --file <project-root-relative path you wrote>')}. Then poll again. If generation fails after the browser flipped to GENERATING, reply --reply ${id} error "Short reason" so the bar resets (never live-accept --discard for this).`);

  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function svelteComponentInstructions(event, scaffold, scriptsPath) {
  const dir = scaffold.componentDir;
  const count = event.count;
  return `Svelte component preview. EDIT the existing stubs ${dir}/v1.svelte ... v${count}.svelte in place; never delete or recreate them; do not read them back (the prop-substituted markup is in scaffold.componentStubMarkup). Keep the stub's control flow ({#each}, {#if}) and propContract prop names exactly; never flatten a loop into literal items. The stub <style> is seeded with the source rules that style the selection; restyle or delete freely, and know that any seeded rule you do not re-declare is REMOVED from source on accept (the preview never applied it). ALL your CSS goes inside that ONE existing <style> block: Svelte forbids a second top-level style element, and a publish with a non-compiling variant is bounced back to you with file and line. Semantic class selectors only: no @scope, no data-impeccable-* attributes. Params go in ${dir}/params.json keyed by variant number (never an attribute); author knob CSS against var(--p-<id>, default) and :global([data-p-<id>="..."]). Reply with --file ${scaffold.file}. Accept later merges everything into ${scaffold.sourceFile} mechanically; you have no post-accept cleanup.`;
}

function deferredWrapperInstructions(event, scaffold, scriptsPath) {
  const insertNote = Number(scaffold.replaceEndLine) < Number(scaffold.replaceStartLine)
    ? ` (replaceEndLine < replaceStartLine: this is an INSERTION at line ${scaffold.replaceStartLine}; remove nothing)`
    : '';
  return `The wrapper is NOT in source yet. In ONE edit to ${scaffold.file}: splice preview CSS plus all ${event.count} variants into scaffold.wrapperBlock at the "Variants: insert below this line" marker, then replace lines ${scaffold.replaceStartLine}-${scaffold.replaceEndLine}${insertNote} with the result. Two separate writes reload the framework mid-publish and strand the browser at 0/N. Author CSS per the returned cssAuthoring contract; each variant div holds exactly ONE top-level element (same tag as the original); first visible, others display: none. On JSX/TSX wrap the <style> content in a template literal and use className / style={{...}}.`;
}

function insertScaffoldInstructions(event, scriptsPath) {
  const scaffold = event.scaffold;
  const base = `Insert mode: net-new content sized around ${event.placeholder?.width || '?'}x${event.placeholder?.height || '?'} at the chosen anchor; load craft-floor.md before writing net-new markup.`;
  if (scaffold?.previewMode === 'svelte-component') {
    return `${base} Write each inserted variant as a single-root Svelte component under ${scaffold.componentDir} (no data-impeccable-* attributes, CSS in each component's <style>). Never edit the route during generation; reply with --file ${scaffold.file}.`;
  }
  if (scaffold && scaffold.sourceWritten === false) {
    return `${base} Splice your variants into scaffold.wrapperBlock at the marker and insert the result at line ${scaffold.replaceStartLine} of ${scaffold.file} in ONE edit.`;
  }
  return `${base} If no scaffold payload is present, run node ${scriptsPath}/live-insert.mjs --id ${event.id} --count ${event.count} --position ${event.insert?.position || 'after'} with the anchor flags from event.insert.anchor, then splice variants at the returned insertLine.`;
}

function acceptInstructions(event, scriptsPath) {
  const result = event._acceptResult || {};
  const ackOk = event._completionAck?.ok === true;
  const prefix = ackOk ? '' : `Completion was NOT acknowledged: run node ${scriptsPath}/live-status.mjs, finish any cleanup, then node ${scriptsPath}/live-complete.mjs --id ${event.id}. `;

  if (result.handled === true && result.carbonize === true) {
    return `${prefix}Carbonize cleanup is REQUIRED now, before the next poll, in ${result.file}: (1) locate the impeccable-carbonize-start/end block and read the impeccable-param-values comment; (2) move the CSS rules into the stylesheet that owns this area; (3) bake params while rewriting selectors (@scope wrappers to semantic classes, keep only the chosen data-p branch, substitute range literals); (4) unwrap the accepted content and drop every data-impeccable-* / data-p-* attribute; (5) delete the inline <style>, the param-values comment, and both markers plus dead @scope rules. Then run node ${scriptsPath}/live-complete.mjs --id ${event.id} and verify phase "completed"; it refuses with source_dirty while leftovers remain. Poll again only after that.`;
  }
  if (result.handled === true) {
    return `${prefix}Accept was merged into source mechanically; nothing to clean up. Poll again.`;
  }
  if (result.mode === 'fallback') {
    return `${prefix}The session lived in a generated file, so accept refused to persist there. Write the accepted variant into the true source you identified during Handle fallback, remove the temporary wrapper from the served file, then poll again.`;
  }
  if (result.mode === 'error') {
    if (result.error === 'source_locked') {
      return `${prefix}The source file is briefly locked by a publisher. Re-run the exact same live-accept.mjs command (idempotent); do NOT hand-edit the file, and do not poll past this.`;
    }
    if (result.error === 'accept_receipt_conflict') {
      return `${prefix}This session already resolved as ${result.priorOperation || 'a prior operation'}; do not edit anything. Run node ${scriptsPath}/live-status.mjs and tell the user what the session resolved to.`;
    }
    return `${prefix}Accept failed: ${result.error || 'unknown error'}. Source was not touched; do not hand-edit. Run node ${scriptsPath}/live-status.mjs before continuing.`;
  }
  return `${prefix}No mechanical accept result; read ${result.file || 'the session source file'}, find the impeccable markers, and finish the merge by hand. Poll again after.`;
}

/** Boot instructions attached to live.mjs's success payload. */
export function bootInstructions({ scriptsPath = '{{scripts_path}}' } = {}) {
  return `Open the app URL that serves a pageFiles entry (never serverPort; that is the helper). Then start the poll loop per your harness policy in live.md and re-run ${pollCmd(scriptsPath)} immediately after every event or reply. Every event carries _instructions: follow them; they are the authoritative next step with real ids and paths filled in. A poll that is running is a poll you are SERVICING: never announce you are waiting and idle your turn; stay on the exec session until it returns an event, and never end a turn while a poll is outstanding.`;
}
