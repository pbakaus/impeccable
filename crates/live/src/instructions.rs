//! JS: live/instructions.mjs (the boot half). The per-event `_instructions`
//! templates belong to the poll verb (part 3); the boot payload's text lives
//! here so `live` can ship without it.

/// JS: pollCmd(scriptsPath) — `node <scripts>/live-poll.mjs`, spelled as the
/// binary's own poll verb.
pub fn poll_cmd(self_cmd: &str) -> String {
    format!("{} live-poll", self_cmd)
}

/// JS: bootInstructions({ scriptsPath })
pub fn boot_instructions(self_cmd: &str) -> String {
    format!("Open the app URL that serves a pageFiles entry (never serverPort; that is the helper). Then start the poll loop per your harness policy in live.md and re-run {} immediately after every event or reply. Every event carries _instructions: follow them; they are the authoritative next step with real ids and paths filled in. A poll that is running is a poll you are SERVICING: never announce you are waiting and idle your turn; stay on the exec session until it returns an event, and never end a turn while a poll is outstanding.", poll_cmd(self_cmd))
}

// ---------------------------------------------------------------------------
// Per-event instructions (JS: instructionsForEvent). `self_cmd` stands in
// for `node <scripts>/<script>.mjs`: each sibling script is spelled as this
// binary's verb (`<self> live-poll`, `<self> live-complete`, ...).
// ---------------------------------------------------------------------------

use serde_json::{Map, Value};

const PLAN_POINTER: &str = "Plan per live.md section 4: extract the identity lock, pick default vs departure mode, commit each variant to a DIFFERENT primary axis, squint-test the trio. Size parameter knobs per section 7 budgets.";

fn reply_cmd(self_cmd: &str, id: &str, rest: &str) -> String {
    format!("{} --reply {} {}", poll_cmd(self_cmd), id, rest)
}

fn script_cmd(self_cmd: &str, verb: &str) -> String {
    format!("{} {}", self_cmd, verb)
}

fn truthy(v: Option<&Value>) -> bool {
    crate::event_validation::truthy(v)
}

/// JS `${value}` in a template string.
fn js_str(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(impeccable_context::util::js_number_to_string)
            .unwrap_or_default(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| js_str(Some(x)))
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

/// `String(x).slice(0, n)` (UTF-16 units)
fn slice16(s: &str, n: usize) -> String {
    let u: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&u)
}

/// JS: instructionsForEvent(event, { scriptsPath })
pub fn instructions_for_event(event: &Map<String, Value>, self_cmd: &str) -> Option<String> {
    let id = js_str(event.get("id"));
    match event.get("type").and_then(|t| t.as_str())? {
        "generate" => Some(generate_instructions(event, self_cmd)),
        "steer" => Some(format!(
            "Do what the message asks (page edits, navigation help, or a short answer). Then reply exactly once: {} (on failure: --reply {} error \"Short reason\"). No pickup ack; poll again immediately after.",
            reply_cmd(self_cmd, &id, "steer_done [\"optional short toast\"]"),
            id
        )),
        "prefetch" => {
            let page = match event.get("pageUrl") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => Value::String("/".to_string()),
            };
            Some(format!(
                "Speculative pre-read, no reply owed: resolve {} to its source file (root \"/\" is usually the boot's pageFile; multi-page sites map /foo to public/foo/index.html; SPAs map all routes to one entry), read it into context, then poll again. Skip if you cannot resolve it confidently.",
                serde_json::to_string(&page).unwrap_or_default()
            ))
        }
        "variant_mount_failed" => {
            let url = match event.get("url") {
                Some(v) if truthy(Some(v)) => format!(" (module: {})", js_str(Some(v))),
                _ => String::new(),
            };
            let err = match event.get("error") {
                Some(v) if truthy(Some(v)) => format!(": {}", slice16(&js_str(Some(v)), 200)),
                _ => String::new(),
            };
            Some(format!(
                "The browser could NOT render variant {}{}{}. The user sees a persistent error card, not variants. Fix the variant source files, then reply {}; the browser retries on its own. Poll again after the reply.",
                js_str(event.get("variant")),
                url,
                err,
                reply_cmd(self_cmd, &id, "done --file <manifest or source path>")
            ))
        }
        "accept" => Some(accept_instructions(event, self_cmd)),
        "discard" => {
            let ack_ok = event
                .get("_completionAck")
                .and_then(|a| a.get("ok"))
                == Some(&Value::Bool(true));
            Some(if ack_ok {
                "Original restored and durable completion acknowledged; nothing to do. Poll again.".to_string()
            } else {
                format!(
                    "Completion was not acknowledged: run {} --id {} --discarded, then poll again.",
                    script_cmd(self_cmd, "live-complete"),
                    id
                )
            })
        }
        "manual_edit_apply" => {
            let repair = if truthy(event.get("repair")) {
                "A `repair` payload is present: the previous Apply changed source but validation failed; fix the CURRENT source, never roll back yourself. "
            } else {
                ""
            };
            Some(format!(
                "The user already clicked Apply; never ask, discard, or redirect. Delegate the source edits to the impeccable_manual_edit_applier subagent when available (pass cwd, scripts path, event id, page URL, chunk/deadline, batch, evidencePath); it must not poll or reply. {}Reply exactly once: {} (status \"partial\"/\"error\" with failed[] when not every entry applied). Then poll again.",
                repair,
                reply_cmd(self_cmd, &id, "done --data '{\"status\":\"done\",\"appliedEntryIds\":[...],\"failed\":[],\"files\":[...],\"notes\":[]}'")
            ))
        }
        "timeout" => Some("No event arrived; poll again immediately.".to_string()),
        "exit" => Some(format!(
            "Session over: kill any background poll, then {} stop (removes the injected script tag). Sweep leftover impeccable-variants-start / impeccable-carbonize-start markers from source.",
            script_cmd(self_cmd, "live-server")
        )),
        _ => None,
    }
}

fn generate_instructions(event: &Map<String, Value>, self_cmd: &str) -> String {
    let id = js_str(event.get("id"));
    let count = js_str(event.get("count"));
    let scaffold = event.get("scaffold").filter(|s| truthy(Some(s)));
    let mut steps: Vec<String> = Vec::new();
    if truthy(event.get("screenshotPath")) {
        steps.push(format!(
            "Read the annotated screenshot first: {}. Comment {{x,y}} positions bind text to the child under that point; strokes read by shape (loop = emphasis on this thing, arrow = direction, cross = delete).",
            js_str(event.get("screenshotPath"))
        ));
    } else {
        steps.push("No screenshot was sent (the user did not annotate); do not ask for one and do not screenshot the page. Work from element.outerHTML, the computed styles, and the prompt.".to_string());
    }
    let preview_mode = scaffold
        .and_then(|s| s.get("previewMode"))
        .and_then(|p| p.as_str());
    let source_written_false =
        scaffold.and_then(|s| s.get("sourceWritten")) == Some(&Value::Bool(false));
    if event.get("mode").and_then(|m| m.as_str()) == Some("insert") {
        steps.push(insert_scaffold_instructions(event, self_cmd));
    } else if preview_mode == Some("svelte-component") {
        steps.push(svelte_component_instructions(event, scaffold.unwrap()));
    } else if scaffold.is_some() && source_written_false {
        steps.push(deferred_wrapper_instructions(event, scaffold.unwrap()));
    } else if let Some(s) = scaffold {
        steps.push(format!(
            "The wrapper is already written into {}. Splice preview CSS plus all {} variants at line {} in ONE edit, following the returned cssAuthoring contract (styleTag, selector strategy, forbidden patterns). Each variant div holds exactly ONE top-level element (same tag as the original); first visible, others display: none.",
            js_str(s.get("file")),
            count,
            js_str(s.get("insertLine"))
        ));
    } else {
        let err = match event.get("scaffoldError") {
            Some(v) if truthy(Some(v)) => format!(" ({})", js_str(Some(v))),
            _ => String::new(),
        };
        let el = event.get("element");
        let el_id = match el.and_then(|e| e.get("id")) {
            Some(v) if truthy(Some(v)) => js_str(Some(v)),
            _ => String::new(),
        };
        let classes = match el.and_then(|e| e.get("classes")) {
            Some(Value::Array(a)) => a
                .iter()
                .map(|c| js_str(Some(c)))
                .collect::<Vec<_>>()
                .join(","),
            Some(v) if truthy(Some(v)) => js_str(Some(v)),
            _ => String::new(),
        };
        let tag = match el.and_then(|e| e.get("tagName")) {
            Some(v) if truthy(Some(v)) => js_str(Some(v)),
            _ => String::new(),
        };
        steps.push(format!(
            "Preflight could not scaffold{}. Run {} --id {} --count {} --element-id \"{}\" --classes \"{}\" --tag \"{}\" --text \"<first ~80 chars of the picked element's textContent>\". Keep the flags separate; --text disambiguates repeated siblings. On a fallback error, follow live.md's Handle fallback.",
            err,
            script_cmd(self_cmd, "live-wrap"),
            id,
            count,
            el_id,
            classes,
            tag
        ));
    }
    let action = event.get("action").filter(|a| truthy(Some(a)));
    match action {
        Some(a) if a.as_str() != Some("impeccable") => steps.push(format!(
            "Action is \"{}\": read reference/{}.md before planning; its MUST params are non-negotiable. {}",
            js_str(Some(a)),
            js_str(Some(a)),
            PLAN_POINTER
        )),
        _ => steps.push(format!(
            "Freeform action: work from SKILL.md rules plus craft-floor.md; no sub-command file. {}",
            PLAN_POINTER
        )),
    }
    steps.push(format!(
        "When all {} variants are delivered: {}. Then poll again. If generation fails after the browser flipped to GENERATING, reply --reply {} error \"Short reason\" so the bar resets (never live-accept --discard for this).",
        count,
        reply_cmd(self_cmd, &id, "done --file <project-root-relative path you wrote>"),
        id
    ));
    steps
        .iter()
        .enumerate()
        .map(|(i, s)| format!("{}. {}", i + 1, s))
        .collect::<Vec<_>>()
        .join("\n")
}

fn svelte_component_instructions(event: &Map<String, Value>, scaffold: &Value) -> String {
    let dir = js_str(scaffold.get("componentDir"));
    let count = js_str(event.get("count"));
    format!(
        "Svelte component preview. EDIT the existing stubs {dir}/v1.svelte ... v{count}.svelte in place; never delete or recreate them; do not read them back (the prop-substituted markup is in scaffold.componentStubMarkup). Keep the stub's control flow ({{#each}}, {{#if}}) and propContract prop names exactly; never flatten a loop into literal items. The stub <style> is seeded with the source rules that style the selection; restyle or delete freely, and know that any seeded rule you do not re-declare is REMOVED from source on accept (the preview never applied it). ALL your CSS goes inside that ONE existing <style> block: Svelte forbids a second top-level style element, and a publish with a non-compiling variant is bounced back to you with file and line. Semantic class selectors only: no @scope, no data-impeccable-* attributes. Params go in {dir}/params.json keyed by variant number (never an attribute); author knob CSS against var(--p-<id>, default) and :global([data-p-<id>=\"...\"]). Reply with --file {file}. Accept later merges everything into {source} mechanically; you have no post-accept cleanup.",
        dir = dir,
        count = count,
        file = js_str(scaffold.get("file")),
        source = js_str(scaffold.get("sourceFile"))
    )
}

fn deferred_wrapper_instructions(event: &Map<String, Value>, scaffold: &Value) -> String {
    let start = crate::util::js_number(scaffold.get("replaceStartLine"));
    let end = crate::util::js_number(scaffold.get("replaceEndLine"));
    let insert_note = match (start, end) {
        (Some(s), Some(e)) if e < s => format!(
            " (replaceEndLine < replaceStartLine: this is an INSERTION at line {}; remove nothing)",
            js_str(scaffold.get("replaceStartLine"))
        ),
        _ => String::new(),
    };
    format!(
        "The wrapper is NOT in source yet. In ONE edit to {}: splice preview CSS plus all {} variants into scaffold.wrapperBlock at the \"Variants: insert below this line\" marker, then replace lines {}-{}{} with the result. Two separate writes reload the framework mid-publish and strand the browser at 0/N. Author CSS per the returned cssAuthoring contract; each variant div holds exactly ONE top-level element (same tag as the original); first visible, others display: none. On JSX/TSX wrap the <style> content in a template literal and use className / style={{{{...}}}}.",
        js_str(scaffold.get("file")),
        js_str(event.get("count")),
        js_str(scaffold.get("replaceStartLine")),
        js_str(scaffold.get("replaceEndLine")),
        insert_note
    )
}

fn insert_scaffold_instructions(event: &Map<String, Value>, self_cmd: &str) -> String {
    let scaffold = event.get("scaffold").filter(|s| truthy(Some(s)));
    let ph = event.get("placeholder");
    let dim = |k: &str| -> String {
        match ph.and_then(|p| p.get(k)) {
            Some(v) if truthy(Some(v)) => js_str(Some(v)),
            _ => "?".to_string(),
        }
    };
    let base = format!(
        "Insert mode: net-new content sized around {}x{} at the chosen anchor; load craft-floor.md before writing net-new markup.",
        dim("width"),
        dim("height")
    );
    if scaffold
        .and_then(|s| s.get("previewMode"))
        .and_then(|p| p.as_str())
        == Some("svelte-component")
    {
        let s = scaffold.unwrap();
        return format!(
            "{} Write each inserted variant as a single-root Svelte component under {} (no data-impeccable-* attributes, CSS in each component's <style>). Never edit the route during generation; reply with --file {}.",
            base,
            js_str(s.get("componentDir")),
            js_str(s.get("file"))
        );
    }
    if let Some(s) = scaffold {
        if s.get("sourceWritten") == Some(&Value::Bool(false)) {
            return format!(
                "{} Splice your variants into scaffold.wrapperBlock at the marker and insert the result at line {} of {} in ONE edit.",
                base,
                js_str(s.get("replaceStartLine")),
                js_str(s.get("file"))
            );
        }
    }
    let position = match event.get("insert").and_then(|i| i.get("position")) {
        Some(v) if truthy(Some(v)) => js_str(Some(v)),
        _ => "after".to_string(),
    };
    format!(
        "{} If no scaffold payload is present, run {} --id {} --count {} --position {} with the anchor flags from event.insert.anchor, then splice variants at the returned insertLine.",
        base,
        script_cmd(self_cmd, "live-insert"),
        js_str(event.get("id")),
        js_str(event.get("count")),
        position
    )
}

fn accept_instructions(event: &Map<String, Value>, self_cmd: &str) -> String {
    let id = js_str(event.get("id"));
    let empty = Value::Object(Map::new());
    let result = match event.get("_acceptResult") {
        Some(v) if truthy(Some(v)) => v,
        _ => &empty,
    };
    let ack_ok = event.get("_completionAck").and_then(|a| a.get("ok")) == Some(&Value::Bool(true));
    let prefix = if ack_ok {
        String::new()
    } else {
        format!(
            "Completion was NOT acknowledged: run {}, finish any cleanup, then {} --id {}. ",
            script_cmd(self_cmd, "live-status"),
            script_cmd(self_cmd, "live-complete"),
            id
        )
    };
    let handled = result.get("handled") == Some(&Value::Bool(true));
    if handled && result.get("carbonize") == Some(&Value::Bool(true)) {
        return format!(
            "{}Carbonize cleanup is REQUIRED now, before the next poll, in {}: (1) locate the impeccable-carbonize-start/end block and read the impeccable-param-values comment; (2) move the CSS rules into the stylesheet that owns this area; (3) bake params while rewriting selectors (@scope wrappers to semantic classes, keep only the chosen data-p branch, substitute range literals); (4) unwrap the accepted content and drop every data-impeccable-* / data-p-* attribute; (5) delete the inline <style>, the param-values comment, and both markers plus dead @scope rules. Then run {} --id {} and verify phase \"completed\"; it refuses with source_dirty while leftovers remain. Poll again only after that.",
            prefix,
            js_str(result.get("file")),
            script_cmd(self_cmd, "live-complete"),
            id
        );
    }
    if handled {
        return format!(
            "{}Accept was merged into source mechanically; nothing to clean up. Poll again.",
            prefix
        );
    }
    let mode = result.get("mode").and_then(|m| m.as_str());
    if mode == Some("fallback") {
        return format!("{}The session lived in a generated file, so accept refused to persist there. Write the accepted variant into the true source you identified during Handle fallback, remove the temporary wrapper from the served file, then poll again.", prefix);
    }
    if mode == Some("error") {
        let err = result.get("error").and_then(|e| e.as_str());
        if err == Some("source_locked") {
            return format!("{}The source file is briefly locked by a publisher. Re-run the exact same live-accept command (idempotent); do NOT hand-edit the file, and do not poll past this.", prefix);
        }
        if err == Some("accept_receipt_conflict") {
            let prior = match result.get("priorOperation") {
                Some(v) if truthy(Some(v)) => js_str(Some(v)),
                _ => "a prior operation".to_string(),
            };
            return format!(
                "{}This session already resolved as {}; do not edit anything. Run {} and tell the user what the session resolved to.",
                prefix,
                prior,
                script_cmd(self_cmd, "live-status")
            );
        }
        let e = match result.get("error") {
            Some(v) if truthy(Some(v)) => js_str(Some(v)),
            _ => "unknown error".to_string(),
        };
        return format!(
            "{}Accept failed: {}. Source was not touched; do not hand-edit. Run {} before continuing.",
            prefix,
            e,
            script_cmd(self_cmd, "live-status")
        );
    }
    let file = match result.get("file") {
        Some(v) if truthy(Some(v)) => js_str(Some(v)),
        _ => "the session source file".to_string(),
    };
    format!(
        "{}No mechanical accept result; read {}, find the impeccable markers, and finish the merge by hand. Poll again after.",
        prefix, file
    )
}
