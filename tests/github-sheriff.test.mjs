import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLOSE_MARKER,
  WARNING_MARKER,
  evaluatePullRequest,
  mergeIssueComments,
  mergeIssueLabelEvents,
  normalizePullRequest,
  parseArgs,
} from '../scripts/github/sheriff.mjs';

const NOW = '2026-07-08T00:00:00Z';

describe('github sheriff', () => {
  it('warns a contributor-blocked PR after one week waiting on contributor action', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-30T00:00:00Z',
      latestCommitAt: '2026-06-30T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-07-01T00:00:00Z', '/sheriff wait'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.equal(plan.daysOpen, 8);
    assert.equal(plan.waitingDays, 7);
    assert.deepEqual(plan.labelsToAdd, ['stale', 'waiting on contributor']);
    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
    assert.match(plan.warningComment, /waiting on contributor action/);
    assert.match(plan.warningComment, /waiting for contributor action for 7 days/);
    assert.match(plan.warningComment, /2026-07-15/);
  });

  it('closes a non-regular contributor PR that is still waiting after two weeks open', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-06-21T00:00:00Z'),
      ],
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', 'Please fix the review feedback.'),
        comment('github-actions[bot]', '2026-06-27T00:00:00Z', WARNING_MARKER),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, true);
    assert.match(plan.closeComment, /Closing this because/);
  });

  it('warns instead of closing old waiting PRs that have not received a sheriff warning yet', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
    assert.match(plan.warningComment, /2026-07-09/);
    assert.doesNotMatch(plan.warningComment, /2026-07-04/);
  });

  it('does not treat a stale label without a current warning marker as proof of warning', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-06-21T00:00:00Z'),
      ],
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', 'Please fix the review feedback.'),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
  });

  it('ignores stale warning markers from untrusted commenters', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
        comment('drive-by', '2026-06-27T00:00:00Z', WARNING_MARKER),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
  });

  it('ignores close markers from untrusted commenters', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
        comment('github-actions[bot]', '2026-06-27T00:00:00Z', WARNING_MARKER),
        comment('drive-by', '2026-07-04T00:00:00Z', CLOSE_MARKER),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, true);
  });

  it('keeps old trusted warning markers after full issue comment hydration', () => {
    const prUnderReview = pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-06-21T00:00:00Z'),
      ],
      comments: Array.from({ length: 50 }, (_, index) => (
        comment('review-bot', `2026-06-28T00:${String(index).padStart(2, '0')}:00Z`, 'follow-up')
      )),
    });

    const truncatedPlan = evaluatePullRequest(prUnderReview, { now: NOW });
    mergeIssueComments(prUnderReview, [
      restComment('pbakaus', '2026-06-21T00:00:00Z', 'Please fix the review feedback.'),
      restComment('github-actions[bot]', '2026-06-27T00:00:00Z', WARNING_MARKER),
      ...prUnderReview.comments,
    ]);
    const hydratedPlan = evaluatePullRequest(prUnderReview, { now: NOW });

    assert.equal(truncatedPlan.shouldWarn, true);
    assert.equal(truncatedPlan.shouldClose, false);
    assert.equal(hydratedPlan.shouldWarn, false);
    assert.equal(hydratedPlan.shouldClose, true);
  });

  it('does not infer contributor blockers from maintainer prose', () => {
    for (const body of [
      'LGTM, merging after CI.',
      'Thanks for the update!',
      "I'll review this change tomorrow.",
      'Could you add a focused test for this?',
    ]) {
      const plan = evaluatePullRequest(pr({
        createdAt: '2026-07-01T00:00:00Z',
        latestCommitAt: '2026-07-01T01:00:00Z',
        statusState: 'SUCCESS',
        mergeable: 'MERGEABLE',
        comments: [
          comment('pbakaus', '2026-07-02T00:00:00Z', body),
        ],
      }), { now: NOW });

      assert.equal(plan.contributorActionRequired, false, body);
      assert.equal(plan.readyToMerge, true, body);
      assert.deepEqual(plan.labelsToAdd, ['ready to merge'], body);
    }
  });

  it('treats explicit maintainer wait commands as contributor blockers', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-04T00:00:00Z',
      latestCommitAt: '2026-07-04T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-07-05T00:00:00Z', [
          'This needs a maintainer-controlled wait state.',
          '/sheriff wait',
        ].join('\n')),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, ['waiting on contributor']);
  });

  it('ignores sheriff wait commands from non-maintainers', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      latestCommitAt: '2026-07-01T01:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      comments: [
        comment('contrib', '2026-07-02T00:00:00Z', '/sheriff wait'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.equal(plan.readyToMerge, true);
    assert.deepEqual(plan.labelsToAdd, ['ready to merge']);
  });

  it('moves back to maintainer review after the contributor responds', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-25T00:00:00Z',
      latestCommitAt: '2026-06-25T01:00:00Z',
      labels: ['waiting on contributor', 'stale', 'blocked: review threads'],
      comments: [
        comment('pbakaus', '2026-07-01T00:00:00Z', 'Can you split this up?'),
        comment('contrib', '2026-07-02T00:00:00Z', 'Done, pushed the split.'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
    assert.deepEqual(plan.labelsToRemove, ['blocked: review threads', 'stale', 'waiting on contributor']);
    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, false);
  });

  it('preserves a current waiting label applied after the latest contributor action', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-04T00:00:00Z',
      latestCommitAt: '2026-07-02T00:00:00Z',
      labels: ['waiting on contributor'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-07-03T00:00:00Z'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, []);
  });

  it('preserves a waiting label when the label event is hydrated from issue events', () => {
    const source = pr({
      createdAt: '2026-07-04T00:00:00Z',
      updatedAt: '2026-07-03T00:00:00Z',
      latestCommitAt: '2026-07-02T00:00:00Z',
      labels: ['waiting on contributor'],
      labelEvents: [],
    });
    mergeIssueLabelEvents(source, [
      issueEvent('labeled', 'waiting on contributor', 'pbakaus', '2026-07-03T00:00:00Z'),
    ]);

    const plan = evaluatePullRequest(source, { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, []);
    assert.deepEqual(plan.labelsToRemove, []);
  });

  it('does not pin a waiting label when no label timestamp is available', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-04T00:00:00Z',
      latestCommitAt: '2026-07-04T00:00:00Z',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
    assert.deepEqual(plan.labelsToRemove, ['stale', 'waiting on contributor']);
    assert.equal(plan.shouldClose, false);
  });

  it('allows a zero-day warning window for manual dry runs', () => {
    const parsed = parseArgs([
      '--warning-days', '0',
      '--close-days', '0',
    ]);

    assert.equal(parsed.warningDays, 0);
    assert.equal(parsed.closeDays, 0);
  });

  it('clears a waiting label once the contributor acts after it was applied', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      latestCommitAt: '2026-07-04T00:00:00Z',
      labels: ['waiting on contributor'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-07-03T00:00:00Z'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
    assert.deepEqual(plan.labelsToRemove, ['waiting on contributor']);
  });

  it('does not treat a non-author head commit as contributor activity', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-04T00:00:00Z',
      latestCommitAt: '2026-07-04T00:00:00Z',
      latestCommitAuthorLogin: 'github-actions[bot]',
      latestCommitCommitterLogin: 'web-flow',
      labels: ['waiting on contributor'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-07-02T00:00:00Z'),
      ],
      comments: [
        comment('pbakaus', '2026-07-02T00:00:00Z', '/sheriff wait'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, []);
    assert.deepEqual(plan.labelsToRemove, []);
  });

  it('treats unresolved threads as contributor-blocked when the latest thread comment is not from the author', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      reviewThreads: [
        {
          isResolved: false,
          comments: [
            comment('cursor', '2026-07-02T00:00:00Z', 'This path looks wrong.'),
          ],
        },
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.ok(plan.desiredLabels.includes('waiting on contributor'));
    assert.ok(plan.desiredLabels.includes('blocked: review threads'));
  });

  it('does not close when the contributor is the latest unresolved-thread commenter', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [
        labelEvent('LabeledEvent', 'waiting on contributor', 'pbakaus', '2026-06-21T12:00:00Z'),
      ],
      reviewThreads: [
        {
          isResolved: false,
          comments: [
            comment('cursor', '2026-06-21T00:00:00Z', 'This path looks wrong.'),
            comment('contrib', '2026-06-22T00:00:00Z', 'Fixed in the latest push.'),
          ],
        },
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
    assert.equal(plan.shouldClose, false);
  });

  it('marks failing checks as blocked without starting the contributor stale clock', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      statusState: 'FAILURE',
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.deepEqual(plan.labelsToAdd, ['blocked: ci', 'needs maintainer review']);
    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, false);
  });

  it('treats merge conflicts as contributor action and ages from the first conflict label', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      updatedAt: '2026-07-07T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      mergeable: 'CONFLICTING',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [
        labelEvent('LabeledEvent', 'blocked: merge conflicts', 'github-actions[bot]', '2026-06-21T00:00:00Z'),
        labelEvent('LabeledEvent', 'waiting on contributor', 'github-actions[bot]', '2026-07-01T00:00:00Z'),
      ],
      comments: [
        comment('github-actions[bot]', '2026-07-01T00:00:00Z', WARNING_MARKER),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, ['blocked: merge conflicts']);
    assert.deepEqual(plan.labelsToRemove, []);
    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, true);
  });

  it('blocks ready state and starts the stale clock for contributor-resolvable policy labels', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      labels: ['ready to merge', 'policy: generated output'],
      labelEvents: [
        labelEvent('LabeledEvent', 'policy: generated output', 'pbakaus', '2026-06-21T00:00:00Z'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.equal(plan.readyToMerge, false);
    assert.deepEqual(plan.labelsToAdd, ['stale', 'waiting on contributor']);
    assert.deepEqual(plan.labelsToRemove, ['ready to merge']);
    assert.equal(plan.shouldWarn, true);
  });

  it('keeps maintainer policy decisions out of ready state without blaming the contributor', () => {
    const plan = evaluatePullRequest(pr({
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      labels: ['ready to merge', 'policy: needs approval'],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.equal(plan.readyToMerge, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
    assert.deepEqual(plan.labelsToRemove, ['ready to merge']);
  });

  it('keeps draft PR #1195 with a pending maintainer decision out of contributor aging', () => {
    for (const comments of [[], [comment('github-actions[bot]', '2026-11-03T15:20:42Z', WARNING_MARKER)]]) {
      const plan = evaluatePullRequest(pr({
        number: 1195,
        authorLogin: 'mager',
        isDraft: true,
        createdAt: '2026-10-26T00:00:00Z',
        labels: ['policy: needs maintainer decision', 'waiting on contributor', 'stale'],
        comments: [
          ...comments,
          comment('mager', '2026-11-02T17:11:17Z', 'I have kept this PR in draft pending your decision.'),
        ],
      }), { now: '2026-11-20T00:00:00Z', autoCloseRegulars: true });

      assert.equal(plan.contributorActionRequired, false);
      assert.equal(plan.waitingDays, 0);
      assert.equal(plan.readyToMerge, false);
      assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
      assert.deepEqual(plan.labelsToRemove, ['stale', 'waiting on contributor']);
      assert.equal(plan.shouldWarn, false);
      assert.equal(plan.shouldClose, false);
    }
  });

  it('keeps other blockers visible without aging contributors during a maintainer decision', () => {
    const plan = evaluatePullRequest(pr({
      isDraft: true,
      mergeable: 'CONFLICTING',
      statusState: 'FAILURE',
      labels: ['policy: needs maintainer decision', 'policy: needs issue'],
      comments: [comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait')],
      reviewThreads: [{ isResolved: false, comments: [comment('pbakaus', '2026-06-21T00:00:00Z', 'Please fix this.')] }],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, false);
    assert.deepEqual(plan.desiredLabels, [
      'blocked: ci', 'blocked: merge conflicts', 'blocked: review threads', 'needs maintainer review',
    ]);
  });

  it('starts a fresh contributor window after the latest maintainer-decision handoff', () => {
    const source = pr({
      isDraft: true,
      createdAt: '2026-06-01T00:00:00Z',
      labels: ['waiting on contributor', 'stale'],
      labelEvents: [
        labelEvent('LabeledEvent', 'policy: needs maintainer decision', 'github-actions[bot]', '2026-06-02T00:00:00Z'),
        labelEvent('UnlabeledEvent', 'policy: needs maintainer decision', 'pbakaus', '2026-06-10T00:00:00Z'),
        labelEvent('LabeledEvent', 'policy: needs maintainer decision', 'github-actions[bot]', '2026-06-20T00:00:00Z'),
        labelEvent('UnlabeledEvent', 'policy: needs maintainer decision', 'github-actions[bot]', '2026-07-07T00:00:00Z'),
      ],
      comments: [comment('github-actions[bot]', '2026-06-15T00:00:00Z', WARNING_MARKER)],
    });
    const handoff = evaluatePullRequest(source, { now: NOW });
    assert.equal(handoff.contributorActionRequired, true);
    assert.equal(handoff.waitingDays, 1);
    assert.deepEqual(handoff.labelsToRemove, ['stale']);
    assert.equal(handoff.shouldWarn, false);
    assert.equal(handoff.shouldClose, false);

    for (const now of ['2026-07-14T00:00:00Z', '2026-07-21T00:00:00Z']) {
      const plan = evaluatePullRequest(source, { now });
      assert.equal(plan.shouldWarn, true);
      assert.equal(plan.shouldClose, false, 'the warning from the previous window cannot authorize closure');
    }
    source.comments.push(comment('github-actions[bot]', '2026-07-14T00:00:00Z', WARNING_MARKER));
    assert.equal(evaluatePullRequest(source, { now: '2026-07-20T00:00:00Z' }).shouldClose, false);
    assert.equal(evaluatePullRequest(source, { now: '2026-07-21T00:00:00Z' }).shouldClose, true);

    source.draftEvents = [draftEvent('ConvertToDraftEvent', '2026-07-08T00:00:00Z')];
    assert.equal(evaluatePullRequest(source, { now: NOW }).waitingDays, 0);
    source.isDraft = false;
    assert.equal(evaluatePullRequest(source, { now: NOW }).contributorActionRequired, false);
  });

  it('hydrates a multi-megabyte history beyond the GraphQL label window in the real CLI', { skip: process.platform === 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheriff-handoff-'));
    try {
      const recentLabels = Array.from({ length: 100 }, (_, i) => ({
        __typename: 'LabeledEvent', label: { name: `unrelated-${i}` },
        actor: { login: 'pbakaus' }, createdAt: '2026-07-07T12:00:00Z',
      }));
      const node = graphqlPrNode({
        isDraft: true, createdAt: '2026-06-01T00:00:00Z',
        // Test both no waiting label and one already present in the seed.
        labelTimelineItems: { nodes: recentLabels },
      });
      const events = Array.from({ length: 4 }, () => Array.from({ length: 100 }, () => ({
        event: 'referenced', created_at: '2026-07-01T00:00:00Z',
        irrelevant_payload: 'x'.repeat(16 * 1024),
      })));
      events[0][0] = issueEvent('labeled', 'policy: needs maintainer decision', 'github-actions[bot]', '2026-06-02T00:00:00Z');
      events.push([issueEvent('unlabeled', 'policy: needs maintainer decision', 'github-actions[bot]', '2026-07-07T00:00:00Z')]);
      assert.ok(Buffer.byteLength(JSON.stringify(events)) > 6 * 1024 * 1024);
      assert.ok(Buffer.byteLength(JSON.stringify(events[1])) > 1024 * 1024);

      fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nexec "' + process.execPath + '" "' + path.join(dir, 'gh.mjs') + '" "$@"\n', { mode: 0o755 });
      fs.writeFileSync(path.join(dir, 'gh.mjs'), `
        import fs from 'node:fs';
        const args = process.argv.slice(2);
        const fixture = JSON.parse(fs.readFileSync(new URL('./fixture.json', import.meta.url)));
        if (args[0] !== 'api') process.exit(2);
        if (args[1] === 'graphql') console.log(JSON.stringify({ data: { repository: { pullRequests: { nodes: [fixture.node], pageInfo: { hasNextPage: false } } } } }));
        else if (args.at(-1).includes('/comments?')) console.log(JSON.stringify([[{ user: { login: 'github-actions[bot]' }, created_at: '2026-06-15T00:00:00Z', body: ${JSON.stringify(WARNING_MARKER)} }]]));
        else if (args.some(arg => arg.includes('/events?'))) {
          if (args.includes('--slurp')) console.log(JSON.stringify(fixture.events));
          else {
            const url = new URL(args.find(arg => arg.includes('/events?')), 'https://api.github.com/');
            const page = fixture.events[Number(url.searchParams.get('page')) - 1] || [];
            // Emulate gh's projection before Node buffers its stdout. A page
            // containing no label events must not terminate pagination.
            if (!args.includes('--jq')) console.log(JSON.stringify(page));
            else console.log(JSON.stringify({ count: page.length, events: page
              .filter(event => ['labeled', 'unlabeled'].includes(event.event))
              .map(({ event, label, actor, created_at }) => ({ event, label, actor, created_at })) }));
          }
        }
        else process.exit(4);
      `);
      for (const hasWaitingLabel of [false, true]) {
        if (hasWaitingLabel) {
          node.labels.nodes = [{ name: 'waiting on contributor' }];
          recentLabels[0].label.name = 'waiting on contributor';
          recentLabels[0].actor.login = 'github-actions[bot]';
        }
        fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ node, events }));
        const result = spawnSync(process.execPath, [
          fileURLToPath(new URL('../scripts/github/sheriff.mjs', import.meta.url)),
          '--dry-run', '--repo', 'pbakaus/impeccable', '--now', NOW,
        ], { env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /stale|warn|close/);
        assert.match(result.stdout, /Dry run sheriff pass for 1 open PR/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not treat policy approval as a blocker', () => {
    const plan = evaluatePullRequest(pr({
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      labels: ['policy: approved'],
    }), { now: NOW });

    assert.equal(plan.readyToMerge, true);
    assert.deepEqual(plan.labelsToAdd, ['ready to merge']);
  });

  it('uses PR creation, not unrelated updates, for drafts opened as draft', () => {
    const plan = evaluatePullRequest(pr({
      isDraft: true,
      createdAt: '2026-06-20T00:00:00Z',
      updatedAt: '2026-07-07T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.equal(plan.waitingDays, 18);
    assert.deepEqual(plan.labelsToAdd, ['stale', 'waiting on contributor']);
    assert.equal(plan.shouldWarn, true);
  });

  it('uses the latest convert-to-draft event for PRs converted back to draft', () => {
    const plan = evaluatePullRequest(pr({
      isDraft: true,
      createdAt: '2026-06-20T00:00:00Z',
      updatedAt: '2026-07-07T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      draftEvents: [
        draftEvent('ReadyForReviewEvent', '2026-06-22T00:00:00Z'),
        draftEvent('ConvertToDraftEvent', '2026-07-06T00:00:00Z'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.equal(plan.waitingDays, 2);
    assert.deepEqual(plan.labelsToAdd, ['waiting on contributor']);
    assert.equal(plan.shouldWarn, false);
  });

  it('uses the latest ready-for-review event as a lower bound when the current draft conversion is missing', () => {
    const plan = evaluatePullRequest(pr({
      isDraft: true,
      createdAt: '2026-06-20T00:00:00Z',
      updatedAt: '2026-07-07T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      draftEvents: [
        draftEvent('ConvertToDraftEvent', '2026-06-22T00:00:00Z'),
        draftEvent('ReadyForReviewEvent', '2026-07-06T00:00:00Z'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.equal(plan.waitingDays, 2);
    assert.deepEqual(plan.labelsToAdd, ['waiting on contributor']);
    assert.equal(plan.shouldWarn, false);
  });

  it('normalizes draft transitions from a dedicated timeline slice', () => {
    const normalized = normalizePullRequest(graphqlPrNode({
      isDraft: true,
      createdAt: '2026-06-20T00:00:00Z',
      updatedAt: '2026-07-07T00:00:00Z',
      labelTimelineItems: {
        nodes: [
          {
            __typename: 'LabeledEvent',
            label: { name: 'waiting on contributor' },
            actor: { login: 'pbakaus' },
            createdAt: '2026-07-06T00:00:00Z',
          },
        ],
      },
      draftTimelineItems: {
        nodes: [
          {
            __typename: 'ConvertToDraftEvent',
            actor: { login: 'contrib' },
            createdAt: '2026-07-06T00:00:00Z',
          },
        ],
      },
    }));

    const plan = evaluatePullRequest(normalized, { now: NOW });

    assert.deepEqual(normalized.labelEvents, [
      {
        type: 'LabeledEvent',
        label: 'waiting on contributor',
        actorLogin: 'pbakaus',
        createdAt: '2026-07-06T00:00:00Z',
      },
    ]);
    assert.deepEqual(normalized.draftEvents, [
      {
        type: 'ConvertToDraftEvent',
        actorLogin: 'contrib',
        createdAt: '2026-07-06T00:00:00Z',
      },
    ]);
    assert.equal(plan.waitingDays, 2);
    assert.equal(plan.shouldWarn, false);
  });

  it('marks passing resolved PRs as ready to merge', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
    }), { now: NOW });

    assert.equal(plan.readyToMerge, true);
    assert.deepEqual(plan.labelsToAdd, ['ready to merge']);
  });

  it('does not mark an unknown mergeability PR as ready', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'UNKNOWN',
    }), { now: NOW });

    assert.equal(plan.readyToMerge, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
  });

  it('ignores stale changes-requested reviews after the current review decision clears', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      latestCommitAt: '2026-07-01T01:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      reviews: [
        {
          authorLogin: 'pbakaus',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-07-02T00:00:00Z',
          body: 'Needs changes.',
        },
        {
          authorLogin: 'pbakaus',
          state: 'APPROVED',
          submittedAt: '2026-07-03T00:00:00Z',
          body: 'Looks good now.',
        },
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.equal(plan.readyToMerge, true);
    assert.deepEqual(plan.labelsToAdd, ['ready to merge']);
  });

  it('does not warn immediately when an old PR receives fresh requested changes', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-21T00:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [
        {
          authorLogin: 'pbakaus',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-07-07T12:00:00Z',
          body: 'Needs one follow-up.',
        },
      ],
    }), { now: NOW });

    assert.equal(plan.daysOpen, 18);
    assert.equal(plan.waitingDays, 0);
    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, ['blocked: review threads', 'waiting on contributor']);
    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, false);
  });

  it('requires a warning after the current blocker before closing', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-21T00:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      reviewDecision: 'CHANGES_REQUESTED',
      comments: [
        comment('github-actions[bot]', '2026-06-30T00:00:00Z', WARNING_MARKER),
      ],
      reviews: [
        {
          authorLogin: 'pbakaus',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-07-07T00:00:00Z',
          body: 'Needs one follow-up.',
        },
      ],
    }), { now: '2026-07-15T00:00:00Z' });

    assert.equal(plan.waitingDays, 8);
    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
  });

  it('blocks current changes-requested reviews until the contributor responds', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-04T00:00:00Z',
      latestCommitAt: '2026-07-01T01:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [
        {
          authorLogin: 'pbakaus',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-07-02T00:00:00Z',
          body: 'Needs changes.',
        },
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.deepEqual(plan.labelsToAdd, ['blocked: review threads', 'waiting on contributor']);
  });

  it('keeps changes-requested PRs in maintainer review after the contributor pushes', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      latestCommitAt: '2026-07-03T00:00:00Z',
      statusState: 'SUCCESS',
      mergeable: 'MERGEABLE',
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [
        {
          authorLogin: 'pbakaus',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-07-02T00:00:00Z',
          body: 'Needs changes.',
        },
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, false);
    assert.equal(plan.readyToMerge, false);
    assert.deepEqual(plan.labelsToAdd, ['needs maintainer review']);
  });

  it('does not auto-close regular contributors by default', () => {
    const plan = evaluatePullRequest(pr({
      authorLogin: 'abdulwahabone',
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
  });

  it('auto-closes regular contributors in the scheduled mode unless explicitly exempted', () => {
    const source = {
      authorLogin: 'abdulwahabone',
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
        comment('github-actions[bot]', '2026-06-27T00:00:00Z', WARNING_MARKER),
      ],
    };
    const closePlan = evaluatePullRequest(pr(source), { now: NOW, autoCloseRegulars: true });
    const exemptPlan = evaluatePullRequest(pr({ ...source, labels: ['Do Not Close'] }), {
      now: NOW,
      autoCloseRegulars: true,
    });
    const customExemptPlan = evaluatePullRequest(pr({ ...source, labels: ['Keep Open'] }), {
      now: NOW,
      autoCloseRegulars: true,
      exemptLabels: ['keep open'],
    });

    assert.equal(closePlan.shouldClose, true);
    assert.equal(exemptPlan.shouldClose, false);
    assert.equal(customExemptPlan.shouldClose, false);
  });

  it('never warns or auto-closes a never-close author, even with auto-close-regulars', () => {
    const source = {
      authorLogin: 'MVanHorn',
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
      ],
    };
    const warnPlan = evaluatePullRequest(pr(source), { now: NOW, autoCloseRegulars: true });
    const closePlan = evaluatePullRequest(pr({
      ...source,
      comments: [
        ...source.comments,
        comment('github-actions[bot]', '2026-06-27T00:00:00Z', WARNING_MARKER),
      ],
    }), { now: NOW, autoCloseRegulars: true, regularContributors: ['mvanhorn'] });

    assert.equal(warnPlan.contributorActionRequired, true);
    assert.ok(warnPlan.labelsToAdd.includes('waiting on contributor'));
    assert.ok(!warnPlan.desiredLabels.includes('stale'));
    assert.equal(warnPlan.shouldWarn, false);
    assert.equal(warnPlan.shouldClose, false);
    assert.equal(closePlan.shouldClose, false);

    const otherList = evaluatePullRequest(pr(source), {
      now: NOW,
      autoCloseRegulars: true,
      neverCloseAuthors: ['someone-else'],
    });
    assert.equal(otherList.shouldWarn, true);
  });

  it('parses the never-close author list', () => {
    assert.deepEqual(parseArgs([]).neverCloseAuthors, ['mvanhorn']);
    assert.deepEqual(parseArgs(['--never-close-authors', 'mvanhorn,friend']).neverCloseAuthors, ['mvanhorn', 'friend']);
  });

  it('keeps stale comments idempotent', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', '/sheriff wait'),
        comment('github-actions[bot]', '2026-06-27T00:00:00Z', WARNING_MARKER),
        comment('github-actions[bot]', '2026-07-04T00:00:00Z', CLOSE_MARKER),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, false);
    assert.equal(plan.shouldClose, false);
  });

  it('parses aggressive stale windows from CLI args', () => {
    const parsed = parseArgs([
      '--repo', 'pbakaus/impeccable',
      '--apply',
      '--warning-days', '7',
      '--close-days', '14',
      '--maintainers', 'pbakaus,other',
    ]);

    assert.equal(parsed.apply, true);
    assert.equal(parsed.repo, 'pbakaus/impeccable');
    assert.equal(parsed.warningDays, 7);
    assert.equal(parsed.closeDays, 14);
    assert.deepEqual(parsed.maintainers, ['pbakaus', 'other']);
  });
});

function pr(overrides = {}) {
  return {
    number: 123,
    title: 'Test PR',
    authorLogin: 'contrib',
    isDraft: false,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    labels: [],
    comments: [],
    reviews: [],
    reviewThreads: [],
    labelEvents: [],
    draftEvents: [],
    latestCommitAt: '2026-07-01T01:00:00Z',
    latestCommitAuthorLogin: 'contrib',
    latestCommitCommitterLogin: 'contrib',
    statusState: null,
    mergeable: 'MERGEABLE',
    ...overrides,
  };
}

function comment(authorLogin, createdAt, body) {
  return { authorLogin, createdAt, body };
}

function restComment(login, createdAt, body) {
  return { user: { login }, created_at: createdAt, body };
}

function labelEvent(type, label, actorLogin, createdAt) {
  return { type, label, actorLogin, createdAt };
}

function issueEvent(event, label, actorLogin, createdAt) {
  return {
    event,
    label: { name: label },
    actor: { login: actorLogin },
    created_at: createdAt,
  };
}

function draftEvent(type, createdAt, actorLogin = 'contrib') {
  return { type, createdAt, actorLogin };
}

function graphqlPrNode(overrides = {}) {
  return {
    number: 123,
    title: 'Test PR',
    url: 'https://github.com/pbakaus/impeccable/pull/123',
    isDraft: false,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    author: { login: 'contrib' },
    labels: { nodes: [] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    commits: { nodes: [] },
    reviewThreads: { nodes: [] },
    labelTimelineItems: { nodes: [] },
    draftTimelineItems: { nodes: [] },
    ...overrides,
  };
}
