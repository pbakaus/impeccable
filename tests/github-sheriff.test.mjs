import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSE_MARKER,
  WARNING_MARKER,
  evaluatePullRequest,
  parseArgs,
} from '../scripts/github/sheriff.mjs';

const NOW = '2026-07-08T00:00:00Z';

describe('github sheriff', () => {
  it('warns a contributor-blocked PR after one week open', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-30T00:00:00Z',
      latestCommitAt: '2026-06-30T01:00:00Z',
      comments: [
        comment('pbakaus', '2026-07-03T00:00:00Z', 'Could you address this?'),
      ],
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.equal(plan.daysOpen, 8);
    assert.deepEqual(plan.labelsToAdd, ['stale', 'waiting on contributor']);
    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
    assert.match(plan.warningComment, /waiting on contributor action/);
    assert.match(plan.warningComment, /2026-07-14/);
  });

  it('closes a non-regular contributor PR that is still waiting after two weeks open', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      latestCommitAt: '2026-06-20T01:00:00Z',
      labels: ['waiting on contributor', 'stale'],
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
        comment('pbakaus', '2026-06-21T00:00:00Z', 'Please fix the review feedback.'),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
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

  it('marks failing checks as waiting on contributor', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-07-01T00:00:00Z',
      statusState: 'FAILURE',
    }), { now: NOW });

    assert.equal(plan.contributorActionRequired, true);
    assert.ok(plan.desiredLabels.includes('blocked: ci'));
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
        comment('pbakaus', '2026-06-21T00:00:00Z', 'Please update this.'),
      ],
    }), { now: NOW });

    assert.equal(plan.shouldWarn, true);
    assert.equal(plan.shouldClose, false);
  });

  it('keeps stale comments idempotent', () => {
    const plan = evaluatePullRequest(pr({
      createdAt: '2026-06-20T00:00:00Z',
      comments: [
        comment('pbakaus', '2026-06-21T00:00:00Z', 'Please update this.'),
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
    latestCommitAt: '2026-07-01T01:00:00Z',
    statusState: null,
    mergeable: 'MERGEABLE',
    ...overrides,
  };
}

function comment(authorLogin, createdAt, body) {
  return { authorLogin, createdAt, body };
}

function labelEvent(type, label, actorLogin, createdAt) {
  return { type, label, actorLogin, createdAt };
}
