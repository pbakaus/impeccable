// Every word a person reads from this extension, in one place: the side panel, the badge on the walked tab and the
// manifest. The person sees a "workflow" and a "walk"; no internal name appears here.
//
// Voice (AGENTS.md): short and plain, a little human where nothing failed, never cute about a failure, said once.

const issues = (n) => (n === 1 ? '1 issue' : `${n} issues`);
const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

export const COPY = {
  product: 'Impeccable',

  // manifest.json carries these three by hand, since a manifest cannot import: change both together.
  manifest: {
    name: 'Impeccable Walks',
    description: 'Watch someone from your cast try a workflow in your app, in a tab of its own.',
    action: 'Open the walk panel',
  },

  /** How a walk is started: the command as it is published (the server's tests hold the two together). */
  command: 'npx @impeccable/reviews walk',

  signedOut: {
    line: 'Sign in to Impeccable, then start a walk from your terminal.',
    action: 'Sign in',
    href: 'https://impeccable.reviews/app',
  },

  idle: { line: 'No walk running.', how: 'Start one from your terminal:' },
  copy: { action: 'Copy command', done: 'Copied' },

  waiting: { line: (name) => `${name || 'Your walker'} is on the way.` },

  who: {
    visit: { new: 'New here', returning: 'Has been here before' },
    device: { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' },
  },

  walking: {
    steps: 'Steps',
    follow: 'Follow along',
    checks: 'Done when',
    progress: (met, all) => `${met} of ${all} done`,
    first: (name) => `${name || 'Your walker'} is taking a first look.`,
    issue: 'Issue',
    now: 'Now',
    earlier: (n) => (n === 1 ? '1 earlier step' : `${n} earlier steps`),
    all: (n) => (n === 1 ? 'The 1 step so far' : `All ${n} steps so far`),
  },

  controls: { pause: 'Pause', resume: 'Resume', takeover: 'Take over', handback: 'Hand back', stop: 'Stop' },
  /** The same three, as one switch: who is driving the tab. */
  drive: { walker: (name) => `${name || 'Walker'} drives`, paused: 'Paused', you: 'You drive' },

  paused: { line: (name) => `Paused. ${name || 'Your walker'} waits right here.` },
  takeover: { line: (name) => `Your turn. ${name || 'Your walker'} picks up where you leave off.` },

  done: {
    clean: (name) => `${name || 'Your walker'} finished. No issues.`,
    issues: (name, n) => `${name || 'Your walker'} finished and found ${issues(n)}.`,
    unfinished: (name, n) => (n > 0 ? `${name || 'Your walker'} could not finish, and found ${issues(n)}.` : `${name || 'Your walker'} could not finish.`),
    plain: 'This walk is over.',
    again: 'Watch it again',
    step: (n) => `Step ${n}`,
  },

  stopped: { line: 'You stopped this walk.', how: 'Start another from your terminal:' },

  failed: {
    'tab-closed': 'The tab was closed, so the walk ended.',
    connection: 'The connection dropped, so the walk ended.',
    'left-site': (site) => `The page left ${hostOf(site) || 'the allowed address'}, so the walk ended.`,
    how: 'Start it again from your terminal:',
  },

  /** What the guard stopped, told in the feed where it happened. */
  kept: {
    navigation: (url) => (hostOf(url) ? `Kept on this site: ${hostOf(url)} was not opened.` : 'Kept on this site.'),
    popup: () => 'A new tab was closed.',
    download: () => 'A download was refused.',
    'file-picker': () => 'A file picker stayed shut.',
  },

  badge: {
    here: (name) => `${name || 'Your walker'} is here`,
    paused: (name) => `${name || 'Your walker'} is paused`,
    yours: 'Your turn',
    step: (n) => (n > 0 ? `Step ${n}` : 'Starting'),
    stop: 'Stop',
  },

  tabGroup: (name) => `Impeccable · ${name}`,
};
