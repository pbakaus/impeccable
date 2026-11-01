import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('skill reference authoring contracts', () => {
  it('keeps direction contracts in development-only surface briefs', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const recordDecision = newWork.match(/## 5\. Record the decision\n([\s\S]*?)\n## 6\./)?.[1] ?? '';

    assert.match(recordDecision, /development-only contract/);
    assert.match(recordDecision, /under `## Direction contract` in the relevant surface brief/);
    assert.match(recordDecision, /read the brief once more/i);
    assert.match(recordDecision, /all six contract blocks and the seed reference/);
    assert.match(recordDecision, /SEED REFERENCE concept-seed printed .*never the raw seed key/);

    for (const block of ['THESIS', 'OWN-WORLD', 'STORY', 'FIRST VIEWPORT', 'FORM', 'FINISH']) {
      assert.match(recordDecision, new RegExp(`${block}:`));
    }

    for (const browserArtifact of [
      /HTML or framework comments/,
      /hidden DOM/,
      /<template>/,
      /`data-\*` attributes/,
      /serialized props or state/,
      /React Server Component payloads/,
      /client bundles/,
      /metadata or JSON-LD/,
      /accessibility-only text/,
    ]) {
      assert.match(recordDecision, browserArtifact);
    }

    assert.match(recordDecision, /Never copy the direction contract into implementation source or any browser-delivered artifact/);
    assert.doesNotMatch(newWork, /contract in the artifact's opening comment/);
    assert.doesNotMatch(newWork, /survives the production build/);
    assert.doesNotMatch(newWork, /grep the built output/);
    assert.doesNotMatch(newWork, /emitted markup/);
    assert.doesNotMatch(newWork, /first child of the document's body/);
  });

  it('collects the existing-DESIGN.md choice before the documenter writes', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const documenter = readFileSync(join(ROOT, 'skill/agents/impeccable-documenter.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const handoff = newWork.match(/After the last correction[\s\S]*?<!-- rule:skill-documenter-records-the-world -->/)?.[0] ?? '';
    const inputContract = documenter.match(/## Input Contract\n([\s\S]*?)\n## Workflow/)?.[1] ?? '';

    assert.match(handoff, /\{\{ask_instruction\}\} Offer refresh, overwrite, or merge/);
    assert.ok(handoff.indexOf('{{ask_instruction}}') < handoff.indexOf('spawn the shipped documenter'), 'the choice is collected before the documenter is spawned');
    assert.match(inputContract, /refresh, overwrite, or merge/);
    assert.doesNotMatch(documenter, /update, not replace/);
    assert.match(documenter, /no choice arrived, write nothing/);
  });

  it('skips the detector and its degraded banner on native critique targets', () => {
    const critique = readFileSync(join(ROOT, 'skill/reference/critique.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const orchestration = critique.match(/### Assessment Orchestration\n([\s\S]*?)\n<codex>/)?.[1] ?? '';

    assert.match(orchestration, /\*\*Native platforms\*\* \(`ios` \/ `android` \/ `adaptive`\): Assessment B does not apply/);
    assert.match(orchestration, /skip both sub-agent gates below, the Codex permission question included/);
    assert.match(critique, /Native platforms run A alone \(see Assessment Orchestration\)/);
    assert.match(critique, /- Native: `Method: design review only \(detector not applicable, native platform\)`/);
    assert.match(critique, /write `not applicable \(native platform\)` instead/);
  });

  it('makes the first critique complete and every rerun ledger-driven', () => {
    const critique = readFileSync(join(ROOT, 'skill/reference/critique.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const rerun = critique.match(/### Rerun\n([\s\S]*?)\n### Generate Combined Critique Report/)?.[1] ?? '';

    assert.doesNotMatch(critique, /3-5 (priority issues|most impactful)/);
    assert.doesNotMatch(critique, /Most real interfaces score/);
    assert.match(critique, /#### All Findings/);
    assert.match(critique, /"base":"<commit>"/);
    assert.match(rerun, /\*\*Assessment A stays blind to the ledger\.\*\*/);
    assert.match(rerun, /reports a defect only when a change introduced it/);
    assert.match(rerun, /skipping `\.impeccable\/`/);
    assert.match(rerun, /drops a new finding whose named lines are unchanged since `base`/);
    assert.match(rerun, /\*\*Scores move only by verified rows\.\*\*/);
    assert.match(rerun, /takes one point from the first heuristic it names/);
    assert.match(rerun, /numbered on from the ledger's last row/);
    assert.match(rerun, /`Method: unchanged since <timestamp>`/);
    assert.match(critique, /leave its rows unread, for Assessment B only/);
  });

  it('keeps reduced-motion guidance on the animation build path', () => {
    const animate = readFileSync(join(ROOT, 'skill/reference/animate.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const accessibility = animate.match(/## Accessibility and control\n([\s\S]*?)\n## Verify/)?.[1] ?? '';
    const verify = animate.match(/## Verify\n([\s\S]*?)(?:\n## |$)/)?.[1] ?? '';

    assert.match(accessibility, /prefers-reduced-motion/);
    assert.match(accessibility, /intentional alternative/);
    assert.match(accessibility, /not disabling all motion/);
    assert.match(verify, /reduced[- ]motion/i);
  });

  it('uses an exact content fingerprint before inheriting a critique snapshot', () => {
    const critique = readFileSync(join(ROOT, 'skill/reference/critique.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const polish = readFileSync(join(ROOT, 'skill/reference/polish.md'), 'utf-8').replace(/\r\n?/g, '\n');

    assert.match(critique, /records an exact content fingerprint/);
    assert.match(polish, /compares the file's exact current content fingerprint/);
    assert.match(polish, /Unchanged staged, unstaged, or untracked content remains current/);
    assert.match(polish, /any byte change, deletion, or replacement with a non-file closes the backlog/);
    assert.match(polish, /latest "<resolved target>" --json/);
    assert.match(polish, /exact `snapshot_file` identity/);
    assert.match(polish, /close "<resolved target>" "<snapshot_file returned by latest>"/);
    assert.match(polish, /if a newer critique landed meanwhile, its backlog stays live/);
    assert.doesNotMatch(polish, /git status|git log/);
  });

  it('routes visual decision fallback through wait capability and start failure', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const visualDecisionPage = newWork.match(
      /A harness that can leave a shell blocked[\s\S]*?<!-- rule:skill-visual-decision-page -->/,
    )?.[0] ?? '';

    assert.match(visualDecisionPage, /cannot hold a blocking `--wait`/);
    assert.match(visualDecisionPage, /without starting the page/);
    assert.match(visualDecisionPage, /structured tool/);
    assert.match(visualDecisionPage, /first reply/);
    assert.match(visualDecisionPage, /exit code 2 from starting it/);
    assert.match(visualDecisionPage, /wait check before starting/);
    // Codex's exec_command returns a still-running --wait as a pollable session;
    // that is not a harness that backgrounds the command away (astra/sol, 2026-10-04).
    assert.match(visualDecisionPage, /session you can poll holds the wait/);
    assert.match(visualDecisionPage, /rerun `--wait` only after it exits without an answer/);
    assert.doesNotMatch(
      visualDecisionPage,
      /only exit code 2 from starting it routes the decision to the structured tool; that exit is the fallback/,
    );
  });

  it('lists every card kind the engine accepts in the identity rule', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const telemetry = readFileSync(join(ROOT, 'crates/context/src/telemetry.rs'), 'utf-8');
    const cardKinds = telemetry.match(/pub const CARD_KINDS: .*? = \[(.*?)\];/)?.[1].match(/[a-z]+/g) ?? [];
    const identityRule = newWork.match(/Every option declares its identity: ([\s\S]*?), and each challenger carries/)?.[1] ?? '';

    assert.ok(cardKinds.includes('dealt'));
    for (const kind of cardKinds) {
      assert.match(identityRule, new RegExp(`\`${kind}\``));
    }
  });

  it('sizes the hand by the verdicts, never by a requested count', () => {
    const newWork = readFileSync(join(ROOT, 'skill/reference/new-work.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const handComposition = newWork.match(
      /A hand holds at most three full-card challengers[\s\S]*?Add one card for your own top-ranked grounded candidate/,
    )?.[0] ?? '';

    assert.match(handComposition, /follows the verdicts, never a number the user named/);
    assert.match(handComposition, /say in one line why it is smaller, and offer a re-roll/);
    assert.match(handComposition, /A declined challenger is never promoted to fill a slot/);
    assert.match(handComposition, /standing exit does not count toward a requested number once the user has seen and rejected it/);
  });

  it('keeps touch-gesture verification in the adapt, audit, and harden references', () => {
    const adapt = readFileSync(join(ROOT, 'skill/reference/adapt.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const audit = readFileSync(join(ROOT, 'skill/reference/audit.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const harden = readFileSync(join(ROOT, 'skill/reference/harden.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const verifyAdaptations = adapt.match(/## Verify Adaptations\n([\s\S]*?)\n## /)?.[1] ?? '';
    const responsive = audit.match(/### 4\. Responsive Design\n([\s\S]*?)\n### 5\./)?.[1] ?? '';
    const edgeCases = harden.match(/### Edge Cases & Boundary Conditions\n([\s\S]*?)\n### /)?.[1] ?? '';
    const verifyHardening = harden.match(/## Verify Hardening\n([\s\S]*?)(?:\n## |$)/)?.[1] ?? '';

    assert.match(verifyAdaptations, /\*\*Primary gesture\*\*/);
    assert.match(verifyAdaptations, /produced the evidence/);
    assert.match(verifyAdaptations, /verify layout, never a gesture/);
    assert.match(verifyAdaptations, /reported gap, not a blocker/);
    assert.match(verifyAdaptations, /\*\*Scroll across it\*\*[\s\S]*without activating it/);
    assert.match(responsive, /\*\*Broken touch interaction\*\*/);
    assert.match(responsive, /what stayed untested/);
    assert.match(responsive, /Exercise the gesture when a browser tool can synthesize touch/);
    assert.match(edgeCases, /\*\*Interrupted gestures\*\*[\s\S]*works without a reload/);
    assert.match(edgeCases, /clear the dragging state and release capture/);
    assert.match(verifyHardening, /\*\*Interrupted gestures\*\*/);
  });

  it('keeps audit score-table dimensions aligned with their numbered sections', () => {
    for (const filename of ['audit.md', 'audit.native.md']) {
      const audit = readFileSync(join(ROOT, `skill/reference/${filename}`), 'utf-8').replace(/\r\n?/g, '\n');
      const sections = [...audit.matchAll(/^### ([1-5])\. (.+?)(?: \([^\n]+\))?$/gm)].map((match) => [
        match[1],
        match[2],
      ]);
      const scores = [...audit.matchAll(/^\| ([1-5]) \| ([^|]+?) \|/gm)].map((match) => [
        match[1],
        match[2].trim(),
      ]);

      assert.deepEqual(scores, sections, filename);
    }
  });
});

describe('mode rule files', () => {
  it('each shipped mode file has exactly the Directions and Comps sections the engine prints', () => {
    for (const mode of ['persuade', 'operate', 'read']) {
      const text = readFileSync(join(ROOT, `skill/reference/mode-${mode}.md`), 'utf-8').replace(/\r\n?/g, '\n');
      const headings = text.split('\n').filter((line) => line.startsWith('## '));
      assert.deepEqual(headings, ['## Directions', '## Comps'], `mode-${mode}.md`);
      for (const section of text.split(/^## (?:Directions|Comps)\n/m).slice(1)) {
        assert.ok(section.trim().length > 200, `mode-${mode}.md has an empty or stub section`);
      }
    }
  });
});
