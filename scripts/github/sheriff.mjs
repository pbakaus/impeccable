#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;

export const LABEL_DEFS = [
  { name: 'waiting on contributor', color: 'fbca04', description: 'Waiting for the PR author to respond or make changes' },
  { name: 'needs maintainer review', color: '5319e7', description: 'Ready for a maintainer to review or decide' },
  { name: 'ready to merge', color: '0e8a16', description: 'Passing, resolved, and ready for a maintainer merge decision' },
  { name: 'stale', color: 'ededed', description: 'Inactive PR that may be closed soon' },
  { name: 'blocked: ci', color: 'd93f0b', description: 'Latest commit has failing required checks' },
  { name: 'blocked: review threads', color: 'd93f0b', description: 'Unresolved review feedback or requested changes remain' },
  { name: 'blocked: merge conflicts', color: 'd93f0b', description: 'PR cannot merge until conflicts are resolved' },
  { name: 'policy: needs issue', color: 'b60205', description: 'PR needs an issue and maintainer approval before continuing' },
  { name: 'policy: needs ai disclosure', color: 'b60205', description: 'PR needs required AI-assistance disclosure' },
  { name: 'policy: generated output', color: 'b60205', description: 'PR needs generated artifacts removed or regenerated appropriately' },
  { name: 'do not close', color: '1d76db', description: 'Maintainer opt-out from sheriff auto-close' },
];

export const STATE_LABELS = [
  'waiting on contributor',
  'needs maintainer review',
  'ready to merge',
  'stale',
];

export const BLOCKED_LABELS = [
  'blocked: ci',
  'blocked: review threads',
  'blocked: merge conflicts',
];

export const AUTO_MANAGED_LABELS = new Set([...STATE_LABELS, ...BLOCKED_LABELS]);
export const WARNING_MARKER = '<!-- impeccable-sheriff:stale-warning -->';
export const CLOSE_MARKER = '<!-- impeccable-sheriff:auto-close -->';

const DEFAULT_MAINTAINERS = ['pbakaus'];
const DEFAULT_REGULAR_CONTRIBUTORS = ['pbakaus', 'abdulwahabone'];
const DEFAULT_EXEMPT_LABELS = ['do not close', 'security'];
const DEFAULT_TRUSTED_MARKER_AUTHORS = ['github-actions', 'github-actions[bot]'];

const REVIEW_BLOCKING_STATES = new Set(['CHANGES_REQUESTED']);
const FAILING_STATUS_STATES = new Set(['ERROR', 'FAILURE']);
const SHERIFF_WAIT_COMMAND = /^\/sheriff\s+wait\s*$/i;

const PR_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        isDraft
        createdAt
        updatedAt
        mergeable
        reviewDecision
        author { login }
        labels(first: 50) { nodes { name } }
        # This is only an initial seed; hydrateIssueComments() replaces it with
        # the full paginated issue comment history before evaluation.
        comments(last: 50) {
          nodes {
            author { login }
            createdAt
            body
          }
        }
        reviews(last: 50) {
          nodes {
            author { login }
            state
            submittedAt
            body
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              authoredDate
              committedDate
              author { user { login } }
              committer { user { login } }
              statusCheckRollup { state }
            }
          }
        }
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(last: 20) {
              nodes {
                author { login }
                createdAt
                body
              }
            }
          }
        }
        labelTimelineItems: timelineItems(last: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
          nodes {
            __typename
            ... on LabeledEvent {
              createdAt
              label { name }
              actor { login }
            }
            ... on UnlabeledEvent {
              createdAt
              label { name }
              actor { login }
            }
          }
        }
        draftTimelineItems: timelineItems(last: 100, itemTypes: [CONVERT_TO_DRAFT_EVENT, READY_FOR_REVIEW_EVENT]) {
          nodes {
            __typename
            ... on ConvertToDraftEvent {
              createdAt
              actor { login }
            }
            ... on ReadyForReviewEvent {
              createdAt
              actor { login }
            }
          }
        }
      }
    }
  }
}`;

export function evaluatePullRequest(pr, options = {}) {
  const now = toDate(options.now || new Date());
  const warningDays = Number.isFinite(options.warningDays) ? options.warningDays : 7;
  const closeDays = Number.isFinite(options.closeDays) ? options.closeDays : 14;
  const maintainers = loginSet(options.maintainers || DEFAULT_MAINTAINERS);
  const regularContributors = loginSet(options.regularContributors || DEFAULT_REGULAR_CONTRIBUTORS);
  const exemptLabels = new Set(options.exemptLabels || DEFAULT_EXEMPT_LABELS);
  const trustedMarkerAuthors = loginSet(options.trustedMarkerAuthors || DEFAULT_TRUSTED_MARKER_AUTHORS);
  const autoCloseRegulars = options.autoCloseRegulars === true;

  const labels = new Set(pr.labels || []);
  const author = normalizeLogin(pr.authorLogin || pr.author?.login || '');
  const daysOpen = Math.floor((now.getTime() - toDate(pr.createdAt).getTime()) / DAY_MS);
  const latestContributorCommitAt = latestCommitBelongsToAuthor(pr, author) ? pr.latestCommitAt : null;
  const latestContributorAt = latestDate([
    latestContributorCommitAt,
    ...commentsBy(pr.comments, author).map((comment) => comment.createdAt),
    ...reviewsBy(pr.reviews, author).map((review) => review.submittedAt),
    ...reviewThreadCommentsBy(pr.reviewThreads, author).map((comment) => comment.createdAt),
  ]);
  const latestMaintainerWaitAt = latestMaintainerWaitCommand(pr, maintainers);
  const latestBlockingReviewAt = pr.reviewDecision === 'CHANGES_REQUESTED'
    ? latestDate((pr.reviews || [])
      .filter((review) => REVIEW_BLOCKING_STATES.has(review.state))
      .map((review) => review.submittedAt))
    : null;
  const unresolvedThreadBlockers = unresolvedThreadsNeedingContributor(pr.reviewThreads || [], author);

  const blockers = [];
  const addBlocker = (blocker) => blockers.push({ contributorAction: false, ...blocker });
  const addContributorBlocker = (blocker) => blockers.push({ contributorAction: true, ...blocker });
  if (pr.isDraft) {
    addContributorBlocker({ kind: 'draft', at: currentDraftStartedAt(pr) });
  }

  if (FAILING_STATUS_STATES.has(pr.statusState)) {
    addBlocker({ kind: 'ci', label: 'blocked: ci', at: pr.latestCommitAt || pr.updatedAt });
  }

  if (pr.mergeable === 'CONFLICTING') {
    addBlocker({ kind: 'merge-conflicts', label: 'blocked: merge conflicts', at: pr.updatedAt });
  }

  if (latestBlockingReviewAt && !isAfter(latestContributorAt, latestBlockingReviewAt)) {
    addContributorBlocker({ kind: 'changes-requested', label: 'blocked: review threads', at: latestBlockingReviewAt });
  }

  if (unresolvedThreadBlockers.length > 0) {
    addContributorBlocker({
      kind: 'review-threads',
      label: 'blocked: review threads',
      at: latestDate(unresolvedThreadBlockers.map((thread) => thread.latestCommentAt)),
    });
  }

  if (latestMaintainerWaitAt && !isAfter(latestContributorAt, latestMaintainerWaitAt)) {
    addContributorBlocker({ kind: 'sheriff-wait', at: latestMaintainerWaitAt });
  }

  const waitingLabelAt = latestMaintainerLabelEventAt(
    pr.labelEvents || [],
    'waiting on contributor',
    'LabeledEvent',
    maintainers,
  );
  if (labels.has('waiting on contributor') && waitingLabelAt && !isAfter(latestContributorAt, waitingLabelAt)) {
    addContributorBlocker({ kind: 'manual-waiting', at: waitingLabelAt });
  }

  const contributorActionBlockerAt = latestDate(blockers
    .filter((blocker) => blocker.contributorAction)
    .map((blocker) => blocker.at || pr.createdAt));
  const contributorActionRequired = blockers.some((blocker) => blocker.contributorAction);
  const waitingDays = contributorActionRequired && contributorActionBlockerAt
    ? Math.floor((now.getTime() - contributorActionBlockerAt.getTime()) / DAY_MS)
    : 0;
  const unresolvedThreadCount = (pr.reviewThreads || []).filter((thread) => !thread.isResolved).length;
  const statusIsReady = pr.statusState === 'SUCCESS';
  const mergeableIsReady = pr.mergeable === 'MERGEABLE';
  const readyToMerge = !pr.isDraft
    && !contributorActionRequired
    && unresolvedThreadCount === 0
    && pr.reviewDecision !== 'CHANGES_REQUESTED'
    && statusIsReady
    && mergeableIsReady;

  const desiredLabels = new Set();
  if (contributorActionRequired) desiredLabels.add('waiting on contributor');
  else if (readyToMerge) desiredLabels.add('ready to merge');
  else desiredLabels.add('needs maintainer review');

  for (const blocker of blockers) {
    if (blocker.label) desiredLabels.add(blocker.label);
  }

  const staleEligible = contributorActionRequired && waitingDays >= warningDays;
  if (staleEligible) desiredLabels.add('stale');

  const warningPostedAt = latestMarkerAt(pr.comments, WARNING_MARKER, trustedMarkerAuthors);
  const warningAlreadyPosted = Boolean(warningPostedAt
    && (!contributorActionBlockerAt || !isAfter(contributorActionBlockerAt, warningPostedAt)));
  const closeAlreadyPosted = hasMarker(pr.comments, CLOSE_MARKER, trustedMarkerAuthors);
  const exemptFromClose = [...labels].some((label) => exemptLabels.has(label));
  const regularContributor = regularContributors.has(author);
  const shouldWarn = staleEligible && !warningAlreadyPosted;
  const shouldClose = contributorActionRequired
    && waitingDays >= closeDays
    && warningAlreadyPosted
    && !closeAlreadyPosted
    && !exemptFromClose
    && (autoCloseRegulars || !regularContributor);

  const labelsToAdd = [...desiredLabels].filter((label) => !labels.has(label)).sort();
  const labelsToRemove = [...labels]
    .filter((label) => AUTO_MANAGED_LABELS.has(label) && !desiredLabels.has(label))
    .sort();

  return {
    number: pr.number,
    title: pr.title,
    author,
    daysOpen,
    waitingDays,
    contributorActionRequired,
    readyToMerge,
    blockers: blockers.map((blocker) => blocker.kind),
    desiredLabels: [...desiredLabels].sort(),
    labelsToAdd,
    labelsToRemove,
    shouldWarn,
    shouldClose,
    warningComment: shouldWarn ? staleWarningComment(pr, { waitingDays, closeDays, contributorActionBlockerAt, now }) : '',
    closeComment: shouldClose ? staleCloseComment(pr, { waitingDays }) : '',
  };
}

export function normalizePullRequest(node) {
  const latestCommit = node.commits?.nodes?.[0]?.commit || null;
  const timelineNodes = node.timelineItems?.nodes || [];
  const labelTimelineNodes = node.labelTimelineItems?.nodes || timelineNodes;
  const draftTimelineNodes = node.draftTimelineItems?.nodes || timelineNodes;
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    mergeable: node.mergeable,
    reviewDecision: node.reviewDecision,
    authorLogin: node.author?.login || '',
    labels: (node.labels?.nodes || []).map((label) => label.name),
    comments: (node.comments?.nodes || []).map(normalizeComment),
    reviews: (node.reviews?.nodes || []).map((review) => ({
      authorLogin: review.author?.login || '',
      state: review.state,
      submittedAt: review.submittedAt,
      body: review.body || '',
    })),
    latestCommitAt: latestCommit?.committedDate || latestCommit?.authoredDate || null,
    latestCommitAuthorLogin: latestCommit?.author?.user?.login || '',
    latestCommitCommitterLogin: latestCommit?.committer?.user?.login || '',
    statusState: latestCommit?.statusCheckRollup?.state || null,
    reviewThreads: (node.reviewThreads?.nodes || []).map((thread) => ({
      isResolved: thread.isResolved,
      comments: (thread.comments?.nodes || []).map(normalizeComment),
    })),
    labelEvents: labelTimelineNodes
      .filter((event) => event.label?.name)
      .map((event) => ({
        type: event.__typename,
        label: event.label.name,
        actorLogin: event.actor?.login || '',
        createdAt: event.createdAt,
      })),
    draftEvents: draftTimelineNodes
      .filter((event) => ['ConvertToDraftEvent', 'ReadyForReviewEvent'].includes(event.__typename))
      .map((event) => ({
        type: event.__typename,
        actorLogin: event.actor?.login || '',
        createdAt: event.createdAt,
      })),
  };
}

export function mergeIssueLabelEvents(pr, events = []) {
  const labelEvents = pr.labelEvents || [];
  const existingKeys = new Set(labelEvents.map((event) => [
    event.type,
    event.label,
    event.actorLogin,
    event.createdAt,
  ].join('\0')));

  for (const event of events) {
    const type = issueEventType(event.event);
    const label = event.label?.name;
    if (!type || !label || !event.created_at) continue;

    const normalized = {
      type,
      label,
      actorLogin: event.actor?.login || '',
      createdAt: event.created_at,
    };
    const key = [
      normalized.type,
      normalized.label,
      normalized.actorLogin,
      normalized.createdAt,
    ].join('\0');
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    labelEvents.push(normalized);
  }

  pr.labelEvents = labelEvents;
  return pr;
}

export function mergeIssueComments(pr, comments = []) {
  pr.comments = comments.map(normalizeComment);
  return pr;
}

export function staleWarningComment(pr, {
  waitingDays,
  closeDays,
  contributorActionBlockerAt,
  now = new Date(),
}) {
  const scheduledCloseAt = addDays(toDate(contributorActionBlockerAt || now), closeDays);
  const earliestNewWarningCloseAt = addDays(toDate(now), 1);
  const closeDate = formatDate(scheduledCloseAt > earliestNewWarningCloseAt
    ? scheduledCloseAt
    : earliestNewWarningCloseAt);
  return [
    WARNING_MARKER,
    `Thanks for the PR. Impeccable is moving quickly, and this PR is currently waiting on contributor action.`,
    '',
    `It has been waiting for contributor action for ${waitingDays} days. Please address the outstanding review feedback, draft state, or explicit maintainer wait request. PRs that are still waiting on contributor action after ${closeDays} days are closed automatically.`,
    '',
    `If nothing changes, this PR may be closed on or after ${closeDate}. Happy to reopen when it is ready to continue.`,
  ].join('\n');
}

export function staleCloseComment(pr, { waitingDays }) {
  return [
    CLOSE_MARKER,
    `Closing this because it has been waiting on contributor action for ${waitingDays} days.`,
    '',
    'Please open a fresh PR, or ask for this one to be reopened, after the outstanding feedback is addressed.',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repo = options.repo || process.env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes('/')) {
    throw new Error('Missing repository. Pass --repo owner/name or set GITHUB_REPOSITORY.');
  }

  if (options.apply && options.ensureLabels) {
    ensureLabels(repo, options);
  }

  const prs = fetchOpenPullRequests(repo).map(normalizePullRequest);
  hydrateIssueComments(repo, prs);
  hydrateMissingWaitingLabelEvents(repo, prs);
  const plans = prs.map((pr) => evaluatePullRequest(pr, options));

  for (const plan of plans) {
    printPlan(plan, { apply: options.apply });
    if (options.apply) applyPlan(repo, plan, options);
  }

  console.log(`${options.apply ? 'Applied' : 'Dry run'} sheriff pass for ${plans.length} open PR(s).`);
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    ensureLabels: true,
    warningDays: 7,
    closeDays: 14,
    maintainers: DEFAULT_MAINTAINERS,
    regularContributors: DEFAULT_REGULAR_CONTRIBUTORS,
    exemptLabels: DEFAULT_EXEMPT_LABELS,
    autoCloseRegulars: false,
    now: new Date(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--no-label-ensure') options.ensureLabels = false;
    else if (arg === '--auto-close-regulars') options.autoCloseRegulars = true;
    else if (arg === '--repo') options.repo = requireValue(argv, ++i, arg);
    else if (arg === '--warning-days') options.warningDays = Number(requireValue(argv, ++i, arg));
    else if (arg === '--close-days') options.closeDays = Number(requireValue(argv, ++i, arg));
    else if (arg === '--maintainers') options.maintainers = splitList(requireValue(argv, ++i, arg));
    else if (arg === '--regular-contributors') options.regularContributors = splitList(requireValue(argv, ++i, arg));
    else if (arg === '--exempt-labels') options.exemptLabels = splitList(requireValue(argv, ++i, arg));
    else if (arg === '--now') options.now = new Date(requireValue(argv, ++i, arg));
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.warningDays) || options.warningDays < 0) {
    throw new Error('--warning-days must be a non-negative number.');
  }
  if (!Number.isFinite(options.closeDays) || options.closeDays < options.warningDays) {
    throw new Error('--close-days must be at least --warning-days.');
  }
  if (Number.isNaN(options.now.getTime())) throw new Error('--now must be a valid date.');

  return options;
}

function latestMaintainerWaitCommand(pr, maintainers) {
  return latestDate([
    ...(pr.comments || [])
      .filter((comment) => maintainers.has(normalizeLogin(comment.authorLogin)))
      .filter((comment) => hasSheriffWaitCommand(comment.body))
      .map((comment) => comment.createdAt),
    ...(pr.reviews || [])
      .filter((review) => maintainers.has(normalizeLogin(review.authorLogin)))
      .filter((review) => hasSheriffWaitCommand(review.body))
      .map((review) => review.submittedAt),
  ]);
}

function currentDraftStartedAt(pr) {
  const latestTransition = [...(pr.draftEvents || [])]
    .filter((event) => ['ConvertToDraftEvent', 'ReadyForReviewEvent'].includes(event.type))
    .sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt))[0];
  return latestTransition?.createdAt || pr.createdAt;
}

function hasSheriffWaitCommand(body) {
  return String(body || '')
    .split(/\r?\n/)
    .some((line) => SHERIFF_WAIT_COMMAND.test(line.trim()));
}

function unresolvedThreadsNeedingContributor(threads, author) {
  return threads
    .filter((thread) => !thread.isResolved)
    .map((thread) => {
      const comments = [...(thread.comments || [])].sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt));
      const latest = comments[comments.length - 1] || null;
      return {
        latestCommentAt: latest?.createdAt || null,
        latestCommentAuthor: normalizeLogin(latest?.authorLogin || ''),
      };
    })
    .filter((thread) => thread.latestCommentAt)
    .filter((thread) => thread.latestCommentAuthor !== author);
}

function applyPlan(repo, plan, options) {
  if (plan.shouldWarn) postComment(repo, plan.number, plan.warningComment, options);
  for (const label of plan.labelsToRemove) removeLabel(repo, plan.number, label, options);
  if (plan.labelsToAdd.length > 0) addLabels(repo, plan.number, plan.labelsToAdd, options);
  if (plan.shouldClose) {
    postComment(repo, plan.number, plan.closeComment, options);
    closePullRequest(repo, plan.number, options);
  }
}

function hydrateMissingWaitingLabelEvents(repo, prs) {
  for (const pr of prs) {
    if (!(pr.labels || []).includes('waiting on contributor')) continue;
    if (latestLabelEventAt(pr.labelEvents || [], 'waiting on contributor', 'LabeledEvent')) continue;
    mergeIssueLabelEvents(pr, fetchIssueEvents(repo, pr.number));
  }
}

function hydrateIssueComments(repo, prs) {
  for (const pr of prs) {
    mergeIssueComments(pr, fetchIssueComments(repo, pr.number));
  }
}

function fetchIssueComments(repo, number) {
  const pages = runGhJson([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/issues/${number}/comments?per_page=100`,
  ]);
  return Array.isArray(pages) ? pages.flat() : [];
}

function fetchIssueEvents(repo, number) {
  const pages = runGhJson([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/issues/${number}/events?per_page=100`,
  ]);
  return Array.isArray(pages) ? pages.flat() : [];
}

function fetchOpenPullRequests(repo) {
  const [owner, name] = repo.split('/');
  const nodes = [];
  let after = '';

  while (true) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${PR_QUERY}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
    ];
    if (after) args.push('-F', `after=${after}`);

    const data = runGhJson(args);
    const root = data.data || data;
    const connection = root.repository?.pullRequests;
    nodes.push(...(connection?.nodes || []));
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }

  return nodes;
}

function ensureLabels(repo, options) {
  for (const label of LABEL_DEFS) {
    const encoded = encodeURIComponent(label.name);
    const get = runGh(['api', `repos/${repo}/labels/${encoded}`], { allowFailure: true, quiet: true });
    if (get.status === 0) {
      runGh([
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/labels/${encoded}`,
        '-f',
        `color=${label.color}`,
        '-f',
        `description=${label.description}`,
      ], options);
      continue;
    }

    runGh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/labels`,
      '-f',
      `name=${label.name}`,
      '-f',
      `color=${label.color}`,
      '-f',
      `description=${label.description}`,
    ], options);
  }
}

function addLabels(repo, number, labels, options) {
  const args = ['api', '-X', 'POST', `repos/${repo}/issues/${number}/labels`];
  for (const label of labels) args.push('-f', `labels[]=${label}`);
  runGh(args, options);
}

function removeLabel(repo, number, label, options) {
  runGh([
    'api',
    '-X',
    'DELETE',
    `repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
  ], { ...options, allowFailure: true });
}

function postComment(repo, number, body, options) {
  runGh([
    'api',
    '-X',
    'POST',
    `repos/${repo}/issues/${number}/comments`,
    '-f',
    `body=${body}`,
  ], options);
}

function closePullRequest(repo, number, options) {
  runGh([
    'api',
    '-X',
    'PATCH',
    `repos/${repo}/issues/${number}`,
    '-f',
    'state=closed',
    '-f',
    'state_reason=not_planned',
  ], options);
}

function printPlan(plan, { apply }) {
  const changes = [
    plan.labelsToAdd.length ? `add=${plan.labelsToAdd.join(',')}` : '',
    plan.labelsToRemove.length ? `remove=${plan.labelsToRemove.join(',')}` : '',
    plan.shouldWarn ? 'warn' : '',
    plan.shouldClose ? 'close' : '',
  ].filter(Boolean);
  if (changes.length === 0) return;
  console.log(`${apply ? 'apply' : 'dry-run'} #${plan.number} ${plan.title}: ${changes.join(' ')}`);
}

function normalizeComment(comment) {
  return {
    authorLogin: comment.authorLogin || comment.author?.login || comment.user?.login || '',
    createdAt: comment.createdAt || comment.created_at,
    body: comment.body || '',
  };
}

function commentsBy(comments = [], login) {
  return comments.filter((comment) => normalizeLogin(comment.authorLogin) === login);
}

function reviewsBy(reviews = [], login) {
  return reviews.filter((review) => normalizeLogin(review.authorLogin) === login);
}

function latestCommitBelongsToAuthor(pr, author) {
  if (!pr.latestCommitAt || !author) return false;
  return [
    pr.latestCommitAuthorLogin,
    pr.latestCommitCommitterLogin,
  ].map(normalizeLogin).filter(Boolean).includes(author);
}

function reviewThreadCommentsBy(threads = [], login) {
  return threads.flatMap((thread) => commentsBy(thread.comments, login));
}

function hasMarker(comments = [], marker, trustedAuthors = null) {
  return comments.some((comment) => isTrustedMarkerComment(comment, marker, trustedAuthors));
}

function latestMarkerAt(comments = [], marker, trustedAuthors = null) {
  return latestDate(comments
    .filter((comment) => isTrustedMarkerComment(comment, marker, trustedAuthors))
    .map((comment) => comment.createdAt));
}

function isTrustedMarkerComment(comment, marker, trustedAuthors) {
  if (typeof comment?.body !== 'string' || !comment.body.includes(marker)) return false;
  if (!trustedAuthors) return true;
  return trustedAuthors.has(normalizeLogin(comment.authorLogin || comment.author?.login));
}

function latestLabelEventAt(events, label, type) {
  return latestDate(events
    .filter((event) => event.type === type && event.label === label)
    .map((event) => event.createdAt));
}

function latestMaintainerLabelEventAt(events, label, type, maintainers) {
  return latestDate(events
    .filter((event) => event.type === type && event.label === label)
    .filter((event) => maintainers.has(normalizeLogin(event.actorLogin)))
    .map((event) => event.createdAt));
}

function issueEventType(event) {
  if (event === 'labeled') return 'LabeledEvent';
  if (event === 'unlabeled') return 'UnlabeledEvent';
  return null;
}

function latestDate(values) {
  let latest = null;
  for (const value of values) {
    if (!value) continue;
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function isAfter(left, right) {
  if (!left || !right) return false;
  return toDate(left).getTime() > toDate(right).getTime();
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loginSet(logins) {
  return new Set(logins.map(normalizeLogin).filter(Boolean));
}

function normalizeLogin(login) {
  return String(login || '').toLowerCase();
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function runGhJson(args) {
  const result = runGh(args, { quiet: true });
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (err) {
    throw new Error(`Failed to parse gh JSON output: ${err.message}`);
  }
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf-8',
    env: process.env,
  });
  if (!options.quiet && result.stdout) process.stdout.write(result.stdout);
  if (!options.quiet && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`gh ${args.join(' ')} failed with exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/github/sheriff.mjs [--repo owner/name] [--apply]

Default mode is a dry run. The scheduled workflow runs with:
  --apply --warning-days 7 --close-days 14

Options:
  --apply                         mutate labels, comments, and stale PR state
  --dry-run                       print changes without mutating GitHub
  --repo owner/name               repository to inspect (defaults to GITHUB_REPOSITORY)
  --warning-days n                warn waiting PRs after n days open (default: 7)
  --close-days n                  close waiting PRs after n days open (default: 14)
  --maintainers a,b               maintainer logins allowed to use /sheriff wait
  --regular-contributors a,b      contributors exempt from auto-close unless --auto-close-regulars is set
  --auto-close-regulars           also auto-close regular contributor PRs
  --no-label-ensure               skip creating/updating sheriff labels
`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
